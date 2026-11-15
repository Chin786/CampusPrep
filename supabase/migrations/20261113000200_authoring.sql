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
