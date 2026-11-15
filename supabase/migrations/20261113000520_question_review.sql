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
