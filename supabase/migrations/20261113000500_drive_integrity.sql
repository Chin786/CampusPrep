-- A scheduled sitting uses a single paper revision, even when the bank changes.
alter table public.schedules
  add column paper_title text,
  add column paper_description text,
  add column paper_instructions text,
  add column paper_duration_min integer,
  add column paper_total_marks numeric,
  add column review_after_close boolean not null default false,
  add column comparable_cohort boolean not null default true;
-- Retain the review policy that existed when older schedules were issued.
alter table public.schedules alter column review_after_close set default true;

create table private.schedule_items (
  schedule_id uuid not null references public.schedules on delete cascade,
  question_id uuid not null,
  section text not null, section_pos integer not null,
  prompt text not null, options jsonb not null, image_url text,
  correct_index integer not null, explanation text not null,
  marks numeric not null, negative_marks numeric not null,
  primary key (schedule_id, question_id)
);
alter table private.schedule_items enable row level security;
revoke all on private.schedule_items from public, anon, authenticated;

-- Earlier versions froze per attempt. Keep every existing attempt untouched and
-- use the first starter's copy for the rest of an already-started sitting.
insert into private.schedule_items
select a.schedule_id, i.question_id, i.section, i.section_pos, i.prompt, i.options,
       i.image_url, i.correct_index, i.explanation, i.marks, i.negative_marks
from (select distinct on (schedule_id) id, schedule_id from public.attempts
      where schedule_id is not null order by schedule_id, started_at, id) a
join private.items i on i.attempt_id = a.id;

insert into private.schedule_items
select s.id, q.id, sec.name, sec.position, q.question_text, q.options,
       q.image_url, q.correct_index, q.explanation, q.marks, q.negative_marks
from public.schedules s
join public.test_questions tq on tq.test_id = s.test_id
join public.test_sections sec on sec.id = tq.section_id
join public.questions q on q.id = tq.question_id
where not exists (select from public.attempts a where a.schedule_id = s.id);

update public.schedules s
set paper_title = t.title, paper_description = t.description,
    paper_instructions = t.instructions, paper_duration_min = t.duration_min,
    paper_total_marks = coalesce((select sum(i.marks) from private.schedule_items i where i.schedule_id = s.id),0),
    comparable_cohort = not exists (select from public.attempts a where a.schedule_id = s.id)
from public.tests t where t.id = s.test_id;
alter table public.schedules
  alter column paper_title set not null, alter column paper_description set not null,
  alter column paper_instructions set not null, alter column paper_duration_min set not null,
  alter column paper_total_marks set not null;

create function private.schedule_header() returns trigger
language plpgsql security definer set search_path = '' as $$
declare paper public.tests;
begin
  select * into strict paper from public.tests where id = new.test_id and status = 'published' and not is_demo for share;
  new.paper_title := paper.title;
  new.paper_description := paper.description;
  new.paper_instructions := paper.instructions;
  new.paper_duration_min := paper.duration_min;
  new.paper_total_marks := 0;
  new.comparable_cohort := true;
  return new;
end $$;

create function private.freeze_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.schedule_items
  select new.id, q.id, sec.name, sec.position, q.question_text, q.options,
         q.image_url, q.correct_index, q.explanation, q.marks, q.negative_marks
  from public.test_questions tq join public.test_sections sec on sec.id = tq.section_id
  join public.questions q on q.id = tq.question_id where tq.test_id = new.test_id;
  if not found then raise exception 'Cannot schedule an empty paper'; end if;
  update public.schedules set paper_total_marks =
    (select sum(marks) from private.schedule_items where schedule_id = new.id)
  where id = new.id;
  return null;
end $$;
create trigger prepare_schedule before insert on public.schedules for each row execute function private.schedule_header();
create trigger freeze_schedule after insert on public.schedules for each row execute function private.freeze_schedule();

create function private.keep_scheduled_paper() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.test_id is distinct from old.test_id or
     (new.paper_title, new.paper_description, new.paper_instructions, new.paper_duration_min, new.comparable_cohort)
     is distinct from (old.paper_title, old.paper_description, old.paper_instructions, old.paper_duration_min, old.comparable_cohort)
  then raise exception 'Create a new schedule to change its paper'; end if;
  if new.paper_total_marks is distinct from old.paper_total_marks and
     (old.paper_total_marks <> 0 or new.paper_total_marks is distinct from
       (select sum(i.marks) from private.schedule_items i where i.schedule_id=old.id))
  then raise exception 'Scheduled marks come from the frozen paper'; end if;
  return new;
end $$;
create trigger keep_scheduled_paper before update on public.schedules
for each row execute function private.keep_scheduled_paper();
revoke all on function private.schedule_header(), private.freeze_schedule(), private.keep_scheduled_paper() from public, anon, authenticated;

create or replace function public.create_schedule(details jsonb, audience text, members uuid[], cohort uuid default null) returns uuid language plpgsql set search_path='' as $$
declare sid uuid;begin
 if not private.is_admin() then raise exception 'Administrator required';end if;
 if not exists(select from public.tests where id=(details->>'test_id')::uuid and status='published' and not is_demo) then raise exception 'Choose a published scheduled-test paper';end if;
 insert into public.schedules(test_id,start_at,end_at,late_entry_min,max_warnings,require_fullscreen,require_seb,review_after_close) values((details->>'test_id')::uuid,(details->>'start_at')::timestamptz,(details->>'end_at')::timestamptz,(details->>'late_entry_min')::int,(details->>'max_warnings')::int,(details->>'require_fullscreen')::boolean,(details->>'require_seb')::boolean,coalesce((details->>'review_after_close')::boolean,true)) returning id into sid;
 insert into public.schedule_assignments(schedule_id,student_id) select sid,p.id from public.profiles p where role='student' and status='approved' and (audience='all' or (audience='selected' and p.id=any(members)) or (audience='group' and exists(select from public.group_members g where g.group_id=cohort and g.student_id=p.id)));
 if not found then raise exception 'Select at least one approved student';end if;return sid;end $$;
create or replace function public.start_attempt(test uuid, schedule uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tests;s public.schedules;a public.attempts;me uuid:=auth.uid();ts timestamptz;deadline timestamptz;aid uuid;seb_default boolean;begin
 if not exists(select from public.profiles where id=me and role='student' and status='approved') then raise exception 'Approved student required';end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text||coalesce(schedule,test)::text,0));ts:=clock_timestamp();
 if schedule is not null then
 select * into s from public.schedules where id=schedule and test_id=test and exists(select from public.schedule_assignments sa where sa.schedule_id=schedule and sa.student_id=me);
 if not found then raise exception 'Schedule unavailable';end if;
 t.title:=s.paper_title; t.duration_min:=s.paper_duration_min; t.is_demo:=false;
 select * into a from public.attempts where schedule_id=schedule and student_id=me;
 else
 select * into strict t from public.tests where id=test and status='published' for share;
 if not t.is_demo then raise exception 'Assignment required';end if;
 select * into a from public.attempts where test_id=test and student_id=me and is_demo and status='in_progress';
 end if;
 if a.id is not null then a:=private.owned(a.id);if schedule is not null or a.status='in_progress' then return a.id;end if;end if;
 if schedule is not null and (ts<s.start_at or ts>=s.end_at or ts>s.start_at+make_interval(mins=>s.late_entry_min)) then raise exception 'Outside permitted entry window';end if;
 select require_seb into seb_default from public.settings where id;
 if coalesce(s.require_seb,seb_default,false) and coalesce((nullif(current_setting('request.headers',true),'')::jsonb)->>'user-agent','') !~* '(SafeExamBrowser|SEB/)' then raise exception 'Safe Exam Browser required';end if;
 deadline:=least(ts+make_interval(mins=>t.duration_min),coalesce(s.end_at,'infinity'::timestamptz));
 insert into public.attempts(schedule_id,test_id,student_id,started_at,deadline_at,remaining_seconds,is_demo,warning_limit,fullscreen,seb,title) values(schedule,test,me,ts,deadline,floor(extract(epoch from deadline-ts)),t.is_demo,coalesce(s.max_warnings,3),coalesce(s.require_fullscreen,true),coalesce(s.require_seb,seb_default,false),t.title) returning id into aid;
 if schedule is not null then
   insert into private.items
   select aid, i.question_id, i.section, i.section_pos,
          (row_number() over (partition by i.section_pos order by random()))::int,
          i.prompt, i.options, i.image_url, i.correct_index, i.explanation, i.marks, i.negative_marks
   from private.schedule_items i where i.schedule_id=schedule;
 else
 insert into private.items select aid,q.id,sec.name,sec.position,(row_number() over(partition by sec.id order by random()))::int,q.question_text,q.options,q.image_url,q.correct_index,q.explanation,q.marks,q.negative_marks from public.test_questions tq join public.questions q on q.id=tq.question_id join public.test_sections sec on sec.id=tq.section_id where tq.test_id=test;
 end if;
 if not found then raise exception 'Paper is empty';end if;
 insert into public.responses(attempt_id,question_id,status) select aid,question_id,'not_visited' from private.items where attempt_id=aid;
 return aid;end$$;

create or replace function public.attempt_result(attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.attempts; s public.schedules; staff boolean := private.is_admin();
  show_key boolean; items jsonb := '[]'; possible numeric; standing jsonb;
begin
  if staff then select * into strict a from public.attempts where id = $1;
  else a := private.owned($1); end if;
  if a.status = 'in_progress' then raise exception 'Submit the attempt to view results'; end if;
  if a.schedule_id is not null then select * into strict s from public.schedules where id = a.schedule_id; end if;
  show_key := staff or a.is_demo or not s.review_after_close or clock_timestamp() >= s.end_at;
  select sum(i.marks) into possible from private.items i where i.attempt_id = a.id;
  if show_key then
    select jsonb_agg(to_jsonb(i) - 'attempt_id' || jsonb_build_object(
      'selected_index', r.selected_index, 'earned', case when r.selected_index is null then 0
        when r.selected_index = i.correct_index then i.marks else -i.negative_marks end
    ) order by i.section_pos, i.position) into items
    from private.items i join public.responses r using (attempt_id, question_id) where i.attempt_id = a.id;
  end if;
  if a.schedule_id is not null and s.comparable_cohort and clock_timestamp() >= s.end_at and
     not exists (select from public.attempts x where x.schedule_id = s.id and x.status = 'in_progress') then
    select jsonb_build_object('rank', r.place, 'count', r.n) into standing from (
      select x.id, dense_rank() over (order by x.score desc) place, count(*) over () n
      from public.attempts x where x.schedule_id = s.id and x.status <> 'in_progress' and not x.is_demo
    ) r where r.id = a.id;
  end if;
  return jsonb_build_object('title',a.title, 'score',a.score, 'total_marks',possible, 'is_demo',a.is_demo,
    'status',a.status, 'review_available',show_key, 'review_at',s.end_at, 'standing',standing,
    'rank_eligible',coalesce(s.comparable_cohort,false), 'items',items);
end $$;
create index assignments_by_student on public.schedule_assignments(student_id,schedule_id);
create index scheduled_attempt_scores on public.attempts(schedule_id,score desc) where schedule_id is not null;

create function public.attempt_heartbeat(attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts := private.owned($1);
begin
  return jsonb_build_object('status', a.status, 'warning_count', a.warning_count,
    'remaining_seconds', greatest(0, ceil(extract(epoch from a.deadline_at - clock_timestamp()))),
    'revision_sum', (select coalesce(sum(r.rev),0) from public.responses r where r.attempt_id = a.id));
end $$;
revoke all on function public.attempt_heartbeat(uuid) from public, anon, authenticated;
grant execute on function public.attempt_heartbeat(uuid) to authenticated;
