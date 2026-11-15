insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('question-images','question-images',false,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy manage_question_images on storage.objects for all to authenticated using(bucket_id='question-images' and private.is_admin()) with check(bucket_id='question-images' and private.is_admin());
create function private.can_view_image(path text) returns boolean language sql stable security definer set search_path='' as $$
 select private.approved() and exists(select from private.items i join public.attempts a on a.id=i.attempt_id where a.student_id=auth.uid() and i.image_url=path)
$$;
revoke all on function private.can_view_image(text) from public,anon;
grant execute on function private.can_view_image(text) to authenticated;
create policy read_attempt_images on storage.objects for select to authenticated using(bucket_id='question-images' and private.can_view_image(name));
