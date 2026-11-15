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
