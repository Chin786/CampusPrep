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
