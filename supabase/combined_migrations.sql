create schema if not exists private;
revoke all on schema private from public;
create type public.user_role as enum ('admin','student');
create type public.account_status as enum ('pending','approved','rejected','blocked');
create type public.test_status as enum ('draft','published');
create type public.attempt_status as enum ('in_progress','submitted','auto_submitted');
create type public.response_status as enum ('not_visited','not_answered','answered','marked','answered_marked');
create type public.violation_type as enum ('tab_switch','fullscreen_exit','window_blur','multi_display','copy_paste','right_click','devtools');
create table public.profiles(id uuid primary key references auth.users on delete cascade, full_name text not null, email text not null, roll_no text unique not null, phone text not null, role public.user_role not null default 'student', status public.account_status not null default 'pending',created_at timestamptz not null default now());
create table public.subjects(id uuid primary key default gen_random_uuid(), name text not null unique check(length(trim(name))>0));
create table public.questions(id uuid primary key default gen_random_uuid(),subject_id uuid not null references public.subjects,section_name text not null,question_text text not null check(length(trim(question_text))>0),options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options)=4 and not jsonb_path_exists(options,'$[*] ? (@.type() != "string" || @ == "")')),correct_index int not null check(correct_index between 0 and 3),explanation text not null,marks numeric not null default 2 check(marks>0),negative_marks numeric not null default 0 check(negative_marks>=0),difficulty text not null check(difficulty in ('easy','medium','hard')),image_url text,created_by uuid references public.profiles default auth.uid(),created_at timestamptz not null default now());
create table public.tests(id uuid primary key default gen_random_uuid(),title text not null check(length(trim(title))>0),description text not null default '',duration_min int not null check(duration_min between 1 and 600),total_marks numeric not null default 0,instructions text not null default '',is_demo boolean not null default false,status public.test_status not null default 'draft',created_by uuid references public.profiles default auth.uid(),created_at timestamptz not null default now());
create table public.test_sections(id uuid primary key default gen_random_uuid(),test_id uuid not null references public.tests on delete cascade,name text not null check(length(trim(name))>0),position int not null,unique(test_id,position),unique(test_id,id));
create table public.test_questions(id uuid primary key default gen_random_uuid(),test_id uuid not null references public.tests on delete cascade,section_id uuid not null,question_id uuid not null references public.questions,position int not null,foreign key(test_id,section_id) references public.test_sections(test_id,id) on delete cascade,unique(test_id,question_id),unique(section_id,position));
create table public.schedules(id uuid primary key default gen_random_uuid(),test_id uuid not null references public.tests,start_at timestamptz not null,end_at timestamptz not null,late_entry_min int not null default 10 check(late_entry_min>=0),max_warnings int not null default 3 check(max_warnings between 1 and 100),require_fullscreen boolean not null default true,require_seb boolean not null default false,check(start_at<end_at));
create table public.schedule_assignments(id uuid primary key default gen_random_uuid(),schedule_id uuid not null references public.schedules on delete cascade,student_id uuid not null references public.profiles on delete cascade,unique(schedule_id,student_id));
create table public.groups(id uuid primary key default gen_random_uuid(),name text not null unique);
create table public.group_members(group_id uuid references public.groups on delete cascade,student_id uuid references public.profiles on delete cascade,primary key(group_id,student_id));
create table public.attempts(id uuid primary key default gen_random_uuid(),schedule_id uuid references public.schedules,test_id uuid not null references public.tests,student_id uuid not null references public.profiles,started_at timestamptz not null default now(),submitted_at timestamptz,status public.attempt_status not null default 'in_progress',score numeric,warning_count int not null default 0,is_demo boolean not null,remaining_seconds int not null,deadline_at timestamptz not null,warning_limit int not null,fullscreen boolean not null,seb boolean not null,title text not null,unique(schedule_id,student_id));
create unique index one_active_demo on public.attempts(test_id,student_id) where is_demo and status='in_progress';
create index attempt_expiry on public.attempts(deadline_at) where status='in_progress';
create table private.items(attempt_id uuid references public.attempts on delete cascade,question_id uuid not null,section text not null,section_pos int not null,position int not null,prompt text not null,options jsonb not null,image_url text,correct_index int not null,explanation text not null,marks numeric not null,negative_marks numeric not null,primary key(attempt_id,question_id));
create table public.responses(id uuid primary key default gen_random_uuid(),attempt_id uuid not null,question_id uuid not null,selected_index int check(selected_index between 0 and 3),status public.response_status not null,updated_at timestamptz not null default now(),unique(attempt_id,question_id),foreign key(attempt_id,question_id) references private.items on delete cascade,check((selected_index is not null)=(status in ('answered','answered_marked'))));
create table public.violations(id uuid primary key default gen_random_uuid(),attempt_id uuid not null references public.attempts,type public.violation_type not null,occurred_at timestamptz not null default now(),meta jsonb not null default '{}',event_id uuid not null,unique(attempt_id,event_id));
create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_id uuid,action text not null,entity text not null,entity_id uuid,created_at timestamptz not null default now());
create table public.settings(id boolean primary key default true check(id),require_seb boolean not null default false);
insert into public.settings default values;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from public.profiles where id=auth.uid() and role='admin' and status='approved')
$$;
create function private.approved() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from public.profiles where id=auth.uid() and status='approved')
$$;
create function private.register_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare n text:=trim(new.raw_user_meta_data->>'full_name'); r text:=upper(trim(new.raw_user_meta_data->>'roll_no')); p text:=trim(new.raw_user_meta_data->>'phone');
begin
 if coalesce(length(n),0) not between 2 and 120 or coalesce(r,'') !~ '^[A-Z0-9][A-Z0-9./_-]{2,49}$' or coalesce(p,'') !~ '^[+0-9 ()-]{7,20}$' then raise exception 'Valid full name, roll number and phone required'; end if;
 insert into public.profiles(id,full_name,email,roll_no,phone) values(new.id,n,new.email,r,p); return new;
end $$;
create trigger register_profile after insert on auth.users for each row execute function private.register_profile();
create function private.sync_email() returns trigger language plpgsql security definer set search_path='' as $$begin update public.profiles set email=new.email where id=new.id;return new;end$$;
create trigger sync_profile_email after update of email on auth.users for each row when (new.email is distinct from old.email) execute function private.sync_email();
do $$ declare t text;begin
 foreach t in array array['profiles','subjects','questions','tests','test_sections','test_questions','schedules','schedule_assignments','groups','group_members','attempts','responses','violations','audit_logs','settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated,service_role',t);
 execute format('create policy admin_control on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',t);
 end loop;
end $$;
alter table private.items enable row level security;
revoke all on private.items from public,anon,authenticated;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_admin(),private.approved() to authenticated;
create policy own_profile on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy own_assignments on public.schedule_assignments for select to authenticated using(student_id=(select auth.uid()) and (select private.approved()));
create policy assigned_schedule on public.schedules for select to authenticated using(exists(select from public.schedule_assignments a where a.schedule_id=schedules.id));
create policy visible_tests on public.tests for select to authenticated using(status='published' and (select private.approved()) and (is_demo or exists(select from public.schedules s where s.test_id=tests.id)));
create policy own_attempts on public.attempts for select to authenticated using(student_id=(select auth.uid()) and (select private.approved()));
create policy own_responses on public.responses for select to authenticated using(exists(select from public.attempts a where a.id=responses.attempt_id));
create policy own_violations on public.violations for select to authenticated using(exists(select from public.attempts a where a.id=violations.attempt_id));
create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.audit_logs(actor_id,action,entity,entity_id) values(auth.uid(),tg_op,tg_table_name,coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(old)->>'id')::uuid));return null;end $$;
do $$declare t text;begin foreach t in array array['profiles','subjects','questions','tests','test_sections','test_questions','schedules','schedule_assignments','groups','group_members','settings'] loop
if t not in ('settings') then execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);end if;end loop;end$$;

--- END MIGRATION: 20261113000100_foundation.sql ---

create function public.save_test(details jsonb, sections jsonb) returns uuid language plpgsql set search_path='' as $$
declare tid uuid:=coalesce((details->>'id')::uuid,gen_random_uuid()); s jsonb; sid uuid; q jsonb; i int:=0; j int; begin
 if not private.is_admin() then raise exception 'Administrator required'; end if;
 if jsonb_typeof(sections) is distinct from 'array' or jsonb_array_length(sections)=0 then raise exception 'Add at least one section'; end if;
 insert into public.tests(id,title,description,duration_min,instructions,is_demo,status) values(tid,details->>'title',coalesce(details->>'description',''),(details->>'duration_min')::int,coalesce(details->>'instructions',''),coalesce((details->>'is_demo')::boolean,false),(details->>'status')::public.test_status)
 on conflict(id) do update set title=excluded.title,description=excluded.description,duration_min=excluded.duration_min,instructions=excluded.instructions,is_demo=excluded.is_demo,status=excluded.status;
 if exists(select from public.schedules where test_id=tid) and ((details->>'is_demo')::boolean or details->>'status'='draft') then raise exception 'Scheduled tests must remain published and non-demo';end if;
 delete from public.test_sections where test_id=tid;
 for s in select value from jsonb_array_elements(sections) loop
 if jsonb_typeof(s->'questions') is distinct from 'array' or jsonb_array_length(s->'questions')=0 then raise exception 'Each section needs questions';end if;
 insert into public.test_sections(test_id,name,position) values(tid,s->>'name',i) returning id into sid; i:=i+1;j:=0;
 for q in select value from jsonb_array_elements(s->'questions') loop insert into public.test_questions(test_id,section_id,question_id,position) values(tid,sid,(q#>>'{}')::uuid,j);j:=j+1;end loop;end loop;
 update public.tests set total_marks=(select sum(q.marks) from public.test_questions tq join public.questions q on tq.question_id=q.id where tq.test_id=tid) where id=tid;return tid;end$$;
create function public.create_schedule(details jsonb, audience text, members uuid[], cohort uuid default null) returns uuid language plpgsql set search_path='' as $$
declare sid uuid;begin
 if not private.is_admin() then raise exception 'Administrator required';end if;
 if not exists(select from public.tests where id=(details->>'test_id')::uuid and status='published' and not is_demo) then raise exception 'Choose a published scheduled-test paper';end if;
 insert into public.schedules(test_id,start_at,end_at,late_entry_min,max_warnings,require_fullscreen,require_seb) values((details->>'test_id')::uuid,(details->>'start_at')::timestamptz,(details->>'end_at')::timestamptz,(details->>'late_entry_min')::int,(details->>'max_warnings')::int,(details->>'require_fullscreen')::boolean,(details->>'require_seb')::boolean) returning id into sid;
 insert into public.schedule_assignments(schedule_id,student_id) select sid,p.id from public.profiles p where role='student' and status='approved' and (audience='all' or (audience='selected' and p.id=any(members)) or (audience='group' and exists(select from public.group_members g where g.group_id=cohort and g.student_id=p.id)));
 if not found then raise exception 'Select at least one approved student';end if;return sid;end $$;
create function public.save_group(label text, members uuid[]) returns uuid language plpgsql set search_path='' as $$declare gid uuid;begin
 if not private.is_admin() then raise exception 'Administrator required';end if;
 insert into public.groups(name) values(trim(label)) returning id into gid;
 insert into public.group_members select gid,id from public.profiles where id=any(members) and role='student';
 if not found then raise exception 'Choose group members';end if;return gid;end$$;
revoke all on function public.save_group(text,uuid[]),public.save_test(jsonb,jsonb),public.create_schedule(jsonb,text,uuid[],uuid) from public,anon;
grant execute on function public.save_group(text,uuid[]),public.save_test(jsonb,jsonb),public.create_schedule(jsonb,text,uuid[],uuid) to authenticated;

--- END MIGRATION: 20261113000200_authoring.sql ---

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('question-images','question-images',false,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy manage_question_images on storage.objects for all to authenticated using(bucket_id='question-images' and private.is_admin()) with check(bucket_id='question-images' and private.is_admin());
create function private.can_view_image(path text) returns boolean language sql stable security definer set search_path='' as $$
 select private.approved() and exists(select from private.items i join public.attempts a on a.id=i.attempt_id where a.student_id=auth.uid() and i.image_url=path)
$$;
revoke all on function private.can_view_image(text) from public,anon;
grant execute on function private.can_view_image(text) to authenticated;
create policy read_attempt_images on storage.objects for select to authenticated using(bucket_id='question-images' and private.can_view_image(name));

--- END MIGRATION: 20261113000210_storage.sql ---

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

--- END MIGRATION: 20261113000300_exam.sql ---

create function public.log_violation(attempt_id uuid,event_id uuid,kind public.violation_type,details jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attempts:=private.owned($1);n int;begin
 if a.status<>'in_progress' then return jsonb_build_object('closed',true);end if;
 if jsonb_typeof(details)<>'object' or length(details::text)>4096 then raise exception 'Invalid event metadata';end if;
 insert into public.violations(attempt_id,event_id,type,meta) values($1,$2,kind,details) on conflict on constraint violations_attempt_id_event_id_key do nothing;
 if found then update public.attempts set warning_count=warning_count+1 where id=$1 returning warning_count into n;else n:=a.warning_count;end if;
 if n>=a.warning_limit then perform private.finalize(a.id,true);end if;
 return jsonb_build_object('closed',n>=a.warning_limit,'warning_count',n);end$$;
create function private.sweep_expired() returns int language plpgsql security definer set search_path='' as $$
declare a uuid;n int:=0;begin for a in select id from public.attempts where status='in_progress' and deadline_at<=clock_timestamp() order by deadline_at limit 500 for update skip locked loop perform private.finalize(a,true);n:=n+1;end loop;return n;end$$;
create function public.schedule_report(schedule uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare leaders jsonb;sections jsonb;items jsonb;begin
 if not private.is_admin() then raise exception 'Administrator required';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.rank,r.roll_no),'[]') into leaders from (select dense_rank() over(order by a.score desc) rank,a.id,a.student_id,p.full_name,p.roll_no,a.score,a.status,a.warning_count from public.attempts a join public.profiles p on p.id=a.student_id where a.schedule_id=$1 and a.status<>'in_progress' and not a.is_demo) r;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.roll_no,r.section_pos),'[]') into sections from (select a.id,p.roll_no,p.full_name,i.section_pos,i.section,sum(i.marks) possible,sum(case when x.selected_index is null then 0 when x.selected_index=i.correct_index then i.marks else -i.negative_marks end) score from private.items i join public.responses x using(attempt_id,question_id) join public.attempts a on a.id=i.attempt_id join public.profiles p on p.id=a.student_id where a.schedule_id=$1 and a.status<>'in_progress' group by a.id,p.roll_no,p.full_name,i.section_pos,i.section) r;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.section,r.prompt),'[]') into items from (select i.question_id,i.section,i.prompt,count(*) candidates,count(*) filter(where x.selected_index=i.correct_index) correct,count(*) filter(where x.selected_index<>i.correct_index) incorrect,count(*) filter(where x.selected_index is null) skipped from private.items i join public.responses x using(attempt_id,question_id) join public.attempts a on a.id=i.attempt_id where a.schedule_id=$1 and a.status<>'in_progress' group by i.question_id,i.prompt,i.section) r;
 return jsonb_build_object('leaderboard',leaders,'sections',sections,'questions',items);end$$;
revoke all on function private.sweep_expired(),public.log_violation(uuid,uuid,public.violation_type,jsonb),public.schedule_report(uuid) from public,anon,authenticated;
grant execute on function public.log_violation(uuid,uuid,public.violation_type,jsonb),public.schedule_report(uuid) to authenticated;

--- END MIGRATION: 20261113000400_monitoring.sql ---

create extension if not exists pg_cron;
select cron.schedule('campusprep-expire-attempts','* * * * *','select private.sweep_expired()');

--- END MIGRATION: 20261113000410_cron.sql ---

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

--- END MIGRATION: 20261113000500_drive_integrity.sql ---

alter type public.user_role add value if not exists 'content_author';

--- END MIGRATION: 20261113000510_author_role.sql ---

create table public.question_drafts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  state text not null check(state in ('draft','submitted','changes_requested','published')),
  revision integer not null default 1,
  reviewer_id uuid references public.profiles,
  feedback text not null default '',
  published_question_id uuid references public.questions on delete set null,
  updated_at timestamptz not null default now()
);
create index drafts_by_author on public.question_drafts(author_id,updated_at desc);
alter table public.question_drafts enable row level security;
revoke all on public.question_drafts from public, anon, authenticated;
grant select on public.question_drafts to authenticated;
grant select,insert,update,delete on public.question_drafts to service_role;

create function private.is_author() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select from public.profiles where id=auth.uid() and status='approved' and role='content_author')
$$;
revoke all on function private.is_author() from public, anon;
grant execute on function private.is_author() to authenticated;
create policy read_subjects_for_author on public.subjects for select to authenticated using ((select private.is_author()));
create policy review_drafts on public.question_drafts for select to authenticated using (
  (select private.is_admin()) or (author_id=(select auth.uid()) and (select private.is_author()))
);
create trigger audit_draft after insert or update or delete on public.question_drafts for each row execute function private.audit_change();

create function public.save_question_draft(draft_id uuid, contents jsonb, send_for_review boolean, expected_revision integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare current_draft public.question_drafts; q public.questions; target_state text;
begin
  if not private.is_author() then raise exception 'Approved content author required'; end if;
  if contents is null or jsonb_typeof(contents)<>'object' or octet_length(contents::text)>65536 then
    raise exception 'Question contents are missing or too long';
  end if;
  q := jsonb_populate_record(null::public.questions, contents);
  if nullif(trim(q.question_text),'') is null then raise exception 'Enter a question prompt'; end if;
  if send_for_review and
    (not exists(select from public.subjects where id=q.subject_id)
     or nullif(trim(q.section_name),'') is null or nullif(trim(q.explanation),'') is null
     or jsonb_typeof(q.options) is distinct from 'array'
     or jsonb_array_length(q.options)<>4
     or exists(select from jsonb_array_elements(q.options) option where jsonb_typeof(option)<>'string' or trim(option#>>'{}')='')
     or q.correct_index is null or q.correct_index not between 0 and 3
     or q.difficulty is null or q.difficulty not in ('easy','medium','hard')
     or q.marks is null or q.marks<=0 or q.marks::text in ('NaN','Infinity')
     or q.negative_marks is null or q.negative_marks<0 or q.negative_marks::text in ('NaN','Infinity')) then
    raise exception 'Complete the subject, section, options, scoring and explanation before sending';
  end if;
  -- Every saved draft is safe for the editor to reopen, including incomplete drafts.
  if q.options is not null then
    if jsonb_typeof(q.options)<>'array' or jsonb_array_length(q.options)<>4 or
       exists(select from jsonb_array_elements(q.options) opt where jsonb_typeof(opt)<>'string')
    then raise exception 'Use four text options'; end if;
  end if;
  contents := jsonb_build_object('subject_id',q.subject_id,'section_name',coalesce(q.section_name,''),
    'question_text',q.question_text,'options',coalesce(q.options,'["","","",""]'::jsonb),
    'correct_index',coalesce(q.correct_index,0),'difficulty',coalesce(q.difficulty,'medium'),
    'explanation',coalesce(q.explanation,''),'marks',coalesce(q.marks,2),
    'negative_marks',coalesce(q.negative_marks,0),'image_url',null);
  target_state := case when send_for_review then 'submitted' else 'draft' end;
  if draft_id is null then
    insert into public.question_drafts(author_id,payload,state) values(auth.uid(),contents,target_state)
    returning id into draft_id;
  else
    select * into current_draft from public.question_drafts where id=draft_id and author_id=auth.uid() for update;
    if not found or current_draft.state not in ('draft','changes_requested') then raise exception 'Draft is unavailable for editing'; end if;
    if expected_revision is distinct from current_draft.revision then raise exception 'This draft changed. Refresh before editing.'; end if;
    update public.question_drafts set payload=contents,state=target_state,revision=revision+1,updated_at=now() where id=draft_id;
  end if;
  return draft_id;
end $$;

create function public.review_question_draft(draft_id uuid, approve boolean, note text, expected_revision integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.question_drafts; q public.questions; question_id uuid;
begin
  if not private.is_admin() then raise exception 'Administrator required'; end if;
  select * into d from public.question_drafts where id=draft_id for update;
  if not found or d.state<>'submitted' or d.revision is distinct from expected_revision then
    raise exception 'Submission changed. Refresh the review queue.'; end if;
  if d.author_id=auth.uid() then raise exception 'A different reviewer must review your submission'; end if;
  if approve then
    q:=jsonb_populate_record(null::public.questions,d.payload);
    insert into public.questions(subject_id,section_name,question_text,options,correct_index,explanation,marks,negative_marks,difficulty,created_by)
      values(q.subject_id,q.section_name,q.question_text,q.options,q.correct_index,q.explanation,q.marks,q.negative_marks,q.difficulty,d.author_id)
      returning id into question_id;
  elsif nullif(trim(note),'') is null then raise exception 'Describe the requested changes'; end if;
  update public.question_drafts set state=case when approve then 'published' else 'changes_requested' end,
    feedback=coalesce(trim(note),''), reviewer_id=auth.uid(), published_question_id=question_id,
    revision=revision+1,updated_at=now() where id=draft_id;
  return question_id;
end $$;

create function public.set_content_author(account_id uuid, enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
  if not private.is_admin() then raise exception 'Administrator required'; end if;
  select * into p from public.profiles where id=account_id for update;
  if not found or p.role='admin' or p.status<>'approved' then raise exception 'Select an approved student or faculty account'; end if;
  if exists(select from public.attempts where student_id=p.id and status='in_progress') then raise exception 'Wait for the active exam to finish'; end if;
  update public.profiles set role=case when enabled then 'content_author'::public.user_role else 'student'::public.user_role end where id=p.id;
end $$;
revoke all on function public.save_question_draft(uuid,jsonb,boolean,integer), public.review_question_draft(uuid,boolean,text,integer), public.set_content_author(uuid,boolean) from public, anon;
grant execute on function public.save_question_draft(uuid,jsonb,boolean,integer), public.review_question_draft(uuid,boolean,text,integer), public.set_content_author(uuid,boolean) to authenticated;

--- END MIGRATION: 20261113000520_question_review.sql ---

-- Migration: Super Admin role and Role Management
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/erxszcnpjlioqdrqysdk/sql/new

-- 1. Add 'super_admin' to user_role enum
alter type public.user_role add value if not exists 'super_admin';

-- 2. Update private.is_admin() to include both 'admin' and 'super_admin'
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from public.profiles where id=auth.uid() and role in ('admin','super_admin') and status='approved')
$$;

-- 3. Add private.is_super_admin()
create or replace function private.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from public.profiles where id=auth.uid() and role='super_admin' and status='approved')
$$;
revoke all on function private.is_super_admin() from public, anon;
grant execute on function private.is_super_admin() to authenticated;

-- 4. Create public.manage_user_role function
create or replace function public.manage_user_role(target_id uuid, target_role public.user_role) returns void
language plpgsql security definer set search_path='' as $$
declare
  caller_role public.user_role;
  target_profile public.profiles;
begin
  select role into caller_role from public.profiles where id=auth.uid() and status='approved';
  if caller_role is null or caller_role not in ('admin', 'super_admin') then
    raise exception 'Administrator or Super Administrator access required';
  end if;

  select * into target_profile from public.profiles where id=target_id for update;
  if not found then
    raise exception 'User profile not found';
  end if;

  -- Only super_admin can create or change other admins and super_admins
  if (target_role in ('admin', 'super_admin') or target_profile.role in ('admin', 'super_admin')) and caller_role <> 'super_admin' then
    raise exception 'Only Super Administrators can assign or modify Administrator and Super Administrator roles';
  end if;

  -- Prevent a super admin from demoting themselves if they are the only super admin
  if target_id = auth.uid() and target_role <> 'super_admin' then
    if (select count(*) from public.profiles where role='super_admin' and status='approved') <= 1 then
      raise exception 'Cannot demote the only active Super Administrator';
    end if;
  end if;

  update public.profiles set role = target_role where id = target_id;
end $$;

revoke all on function public.manage_user_role(uuid, public.user_role) from public, anon;
grant execute on function public.manage_user_role(uuid, public.user_role) to authenticated;

-- 5. Create public.manage_user_status function
create or replace function public.manage_user_status(target_id uuid, target_status public.account_status) returns void
language plpgsql security definer set search_path='' as $$
declare
  caller_role public.user_role;
  target_profile public.profiles;
begin
  select role into caller_role from public.profiles where id=auth.uid() and status='approved';
  if caller_role is null or caller_role not in ('admin', 'super_admin') then
    raise exception 'Administrator or Super Administrator access required';
  end if;

  select * into target_profile from public.profiles where id=target_id for update;
  if not found then
    raise exception 'User profile not found';
  end if;

  -- Only super_admin can change status of admin/super_admin
  if target_profile.role in ('admin', 'super_admin') and caller_role <> 'super_admin' then
    raise exception 'Only Super Administrators can change the status of an Administrator';
  end if;

  if target_id = auth.uid() and target_status <> 'approved' then
    raise exception 'Cannot change your own active status';
  end if;

  update public.profiles set status = target_status where id = target_id;
end $$;

revoke all on function public.manage_user_status(uuid, public.account_status) from public, anon;
grant execute on function public.manage_user_status(uuid, public.account_status) to authenticated;

-- 6. Promote the main account to super_admin
update public.profiles
set role = 'super_admin', status = 'approved'
where email = 'chinmaychouhan155@gmail.com';
