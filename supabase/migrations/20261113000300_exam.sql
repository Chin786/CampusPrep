alter table public.responses add column rev int not null default 0;
create table private.operations(attempt_id uuid references public.attempts on delete cascade,op_id uuid,primary key(attempt_id,op_id));
alter table private.operations enable row level security;
create function private.finalize(aid uuid,automatic boolean) returns void language plpgsql security definer set search_path='' as $$
declare a public.attempts; points numeric;begin
 select * into strict a from public.attempts where id=aid for update;if a.status<>'in_progress' then return;end if;
 select coalesce(sum(case when r.selected_index is null then 0 when r.selected_index=i.correct_index then i.marks else -i.negative_marks end),0) into points from private.items i left join public.responses r using(attempt_id,question_id) where i.attempt_id=aid;
 update public.attempts set submitted_at=least(clock_timestamp(),deadline_at),status=case when automatic or clock_timestamp()>=deadline_at then 'auto_submitted'::public.attempt_status else 'submitted'::public.attempt_status end,score=points,remaining_seconds=greatest(0,floor(extract(epoch from deadline_at-clock_timestamp()))::int) where id=aid;
 insert into public.audit_logs(actor_id,action,entity,entity_id) values(auth.uid(),'submit','attempts',aid);end$$;
create function private.owned(aid uuid) returns public.attempts language plpgsql security definer set search_path='' as $$
declare a public.attempts;begin
 if not private.approved() then raise exception 'Approved account required';end if;
 select * into a from public.attempts where id=aid and student_id=auth.uid() for update;if not found then raise exception 'Attempt unavailable';end if;
 if a.status='in_progress' and clock_timestamp()>=a.deadline_at then
  perform private.finalize(aid,true);
  select * into a from public.attempts where id=aid;
 elsif a.status='in_progress' and a.seb and
  coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'user-agent','') !~* '(SafeExamBrowser|SEB/)' then
  raise exception 'Safe Exam Browser required';
 end if;
 return a;end$$;
create function public.start_attempt(test uuid, schedule uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tests;s public.schedules;a public.attempts;me uuid:=auth.uid();ts timestamptz;deadline timestamptz;aid uuid;seb_default boolean;begin
 if not exists(select from public.profiles where id=me and role='student' and status='approved') then raise exception 'Approved student required';end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text||coalesce(schedule,test)::text,0));ts:=clock_timestamp();
 select * into strict t from public.tests where id=test and status='published' for share;
 if schedule is not null then
 select * into s from public.schedules where id=schedule and test_id=test and exists(select from public.schedule_assignments sa where sa.schedule_id=schedule and sa.student_id=me);
 if not found or t.is_demo then raise exception 'Schedule unavailable';end if;
 select * into a from public.attempts where schedule_id=schedule and student_id=me;
 else
 if not t.is_demo then raise exception 'Assignment required';end if;
 select * into a from public.attempts where test_id=test and student_id=me and is_demo and status='in_progress';
 end if;
 if a.id is not null then a:=private.owned(a.id);if schedule is not null or a.status='in_progress' then return a.id;end if;end if;
 if schedule is not null and (ts<s.start_at or ts>=s.end_at or ts>s.start_at+make_interval(mins=>s.late_entry_min)) then raise exception 'Outside permitted entry window';end if;
 select require_seb into seb_default from public.settings where id;
 if coalesce(s.require_seb,seb_default,false) and coalesce((nullif(current_setting('request.headers',true),'')::jsonb)->>'user-agent','') !~* '(SafeExamBrowser|SEB/)' then raise exception 'Safe Exam Browser required';end if;
 deadline:=least(ts+make_interval(mins=>t.duration_min),coalesce(s.end_at,'infinity'::timestamptz));
 insert into public.attempts(schedule_id,test_id,student_id,started_at,deadline_at,remaining_seconds,is_demo,warning_limit,fullscreen,seb,title) values(schedule,test,me,ts,deadline,floor(extract(epoch from deadline-ts)),t.is_demo,coalesce(s.max_warnings,3),coalesce(s.require_fullscreen,true),coalesce(s.require_seb,seb_default,false),t.title) returning id into aid;
 insert into private.items select aid,q.id,sec.name,sec.position,(row_number() over(partition by sec.id order by random()))::int,q.question_text,q.options,q.image_url,q.correct_index,q.explanation,q.marks,q.negative_marks from public.test_questions tq join public.questions q on q.id=tq.question_id join public.test_sections sec on sec.id=tq.section_id where tq.test_id=test;
 if not found then raise exception 'Paper is empty';end if;
 insert into public.responses(attempt_id,question_id,status) select aid,question_id,'not_visited' from private.items where attempt_id=aid;
 return aid;end$$;
create function public.get_test_paper(attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attempts:=private.owned($1);data jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('question_id',i.question_id,'section',i.section,'section_pos',i.section_pos,'position',i.position,'prompt',i.prompt,'options',i.options,'image_url',i.image_url,'marks',i.marks,'negative_marks',i.negative_marks,'selected_index',r.selected_index,'status',r.status,'rev',r.rev) order by i.section_pos,i.position),'[]') into data from private.items i join public.responses r using(attempt_id,question_id) where i.attempt_id=$1;
 return jsonb_build_object('id',a.id,'title',a.title,'status',a.status,'remaining_seconds',greatest(0,ceil(extract(epoch from a.deadline_at-clock_timestamp()))),'warning_count',a.warning_count,'warning_limit',a.warning_limit,'fullscreen',a.fullscreen,'seb',a.seb,'items',data);end $$;
create function public.save_response(attempt_id uuid,question_id uuid,choice int,state public.response_status,expected_rev int,op_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attempts:=private.owned($1);r public.responses;begin
 if a.status<>'in_progress' then return jsonb_build_object('closed',true);end if;
 select * into strict r from public.responses x where x.attempt_id=$1 and x.question_id=$2;
 if exists(select from private.operations x where x.attempt_id=$1 and x.op_id=$6) then return jsonb_build_object('rev',r.rev,'replayed',true);end if;
 if r.rev<>expected_rev then return jsonb_build_object('conflict',true,'rev',r.rev);end if;
 if clock_timestamp()>=a.deadline_at then perform private.finalize(a.id,true);return jsonb_build_object('closed',true);end if;
 update public.responses x set selected_index=choice,status=state,rev=x.rev+1,updated_at=clock_timestamp() where x.attempt_id=$1 and x.question_id=$2 returning x.* into r;
 insert into private.operations values($1,$6);return jsonb_build_object('rev',r.rev);end $$;
create function public.submit_attempt(attempt_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare a public.attempts:=private.owned($1);begin perform private.finalize(a.id,false);return (select status::text from public.attempts where id=$1);end$$;
create function public.attempt_result(attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attempts;details jsonb;begin
 if private.is_admin() then select * into strict a from public.attempts where id=$1;
 else a:=private.owned($1);end if;
 if a.status='in_progress' then raise exception 'Submit the attempt to view results';end if;
 select jsonb_agg(to_jsonb(i)-'attempt_id'||jsonb_build_object('selected_index',r.selected_index,'earned',case when r.selected_index is null then 0 when r.selected_index=i.correct_index then i.marks else -i.negative_marks end) order by i.section_pos,i.position) into details from private.items i join public.responses r using(attempt_id,question_id) where i.attempt_id=$1;
 return jsonb_build_object('title',a.title,'score',a.score,'is_demo',a.is_demo,'status',a.status,'items',details);end$$;
create function public.exam_rules(schedule uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin if not private.approved() then raise exception 'Approval required';end if;
 if schedule is null then return jsonb_build_object('require_fullscreen',true,'require_seb',(select require_seb from public.settings where id),'max_warnings',3);end if;
 return (select jsonb_build_object('require_fullscreen',s.require_fullscreen,'require_seb',s.require_seb,'max_warnings',s.max_warnings) from public.schedules s join public.schedule_assignments sa on sa.schedule_id=s.id where s.id=schedule and sa.student_id=auth.uid());end$$;
revoke all on function private.owned(uuid),private.finalize(uuid,boolean) from public,anon,authenticated;
revoke all on function public.start_attempt(uuid,uuid),public.get_test_paper(uuid),public.save_response(uuid,uuid,int,public.response_status,int,uuid),public.submit_attempt(uuid),public.attempt_result(uuid),public.exam_rules(uuid) from public,anon;
grant execute on function public.start_attempt(uuid,uuid),public.get_test_paper(uuid),public.save_response(uuid,uuid,int,public.response_status,int,uuid),public.submit_attempt(uuid),public.attempt_result(uuid),public.exam_rules(uuid) to authenticated;
