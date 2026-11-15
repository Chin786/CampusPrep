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

  -- Rule: A Super Administrator account can NEVER be blocked
  if target_profile.role = 'super_admin' and target_status = 'blocked' then
    raise exception 'A Super Administrator account cannot be blocked';
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

-- 6. Fix foreign key constraints so attempts and violations cascade cleanly on user deletion
alter table public.violations drop constraint if exists violations_attempt_id_fkey,
  add constraint violations_attempt_id_fkey foreign key (attempt_id) references public.attempts(id) on delete cascade;

alter table public.attempts drop constraint if exists attempts_student_id_fkey,
  add constraint attempts_student_id_fkey foreign key (student_id) references public.profiles(id) on delete cascade;

alter table public.questions drop constraint if exists questions_created_by_fkey,
  add constraint questions_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.tests drop constraint if exists tests_created_by_fkey,
  add constraint tests_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;

-- 7. Create public.delete_user_account function
create or replace function public.delete_user_account(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
  caller_role public.user_role;
  target_profile public.profiles;
begin
  select role into caller_role from public.profiles where id=auth.uid() and status='approved';
  if caller_role is null or caller_role not in ('admin', 'super_admin') then
    raise exception 'Administrator or Super Administrator access required';
  end if;

  if target_id = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;

  select * into target_profile from public.profiles where id=target_id;
  if not found then
    raise exception 'User profile not found';
  end if;

  -- A Super Admin account can NEVER be deleted
  if target_profile.role = 'super_admin' then
    raise exception 'A Super Administrator account cannot be deleted';
  end if;

  -- Only Super Admin can delete an Admin account
  if target_profile.role = 'admin' and caller_role <> 'super_admin' then
    raise exception 'Only Super Administrators can delete an Administrator account';
  end if;

  -- Clean associated records
  delete from public.violations where attempt_id in (select id from public.attempts where student_id = target_id);
  delete from public.responses where attempt_id in (select id from public.attempts where student_id = target_id);
  delete from public.attempts where student_id = target_id;
  delete from public.schedule_assignments where student_id = target_id;
  delete from public.group_members where student_id = target_id;
  update public.questions set created_by = null where created_by = target_id;
  update public.tests set created_by = null where created_by = target_id;

  delete from auth.users where id = target_id;
  delete from public.profiles where id = target_id;
end $$;

revoke all on function public.delete_user_account(uuid) from public, anon;
grant execute on function public.delete_user_account(uuid) to authenticated;

-- 8. Create public.update_user_profile function
create or replace function public.update_user_profile(
  target_id uuid,
  new_name text,
  new_roll text,
  new_phone text,
  new_role public.user_role,
  new_status public.account_status
) returns void
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

  -- Super admin cannot be blocked
  if (target_profile.role = 'super_admin' or new_role = 'super_admin') and new_status = 'blocked' then
    raise exception 'A Super Administrator account cannot be blocked';
  end if;

  -- Self-demotion / self-block check
  if target_id = auth.uid() then
    if new_status <> 'approved' then
      raise exception 'Cannot change your own active status';
    end if;
    if target_profile.role = 'super_admin' and new_role <> 'super_admin' then
      if (select count(*) from public.profiles where role='super_admin' and status='approved') <= 1 then
        raise exception 'Cannot demote the only active Super Administrator';
      end if;
    end if;
  end if;

  -- Only super_admin can modify admins or assign admin/super_admin roles
  if (target_profile.role in ('admin', 'super_admin') or new_role in ('admin', 'super_admin')) and caller_role <> 'super_admin' then
    raise exception 'Only Super Administrators can modify Administrator or Super Administrator accounts';
  end if;

  update public.profiles
  set full_name = trim(new_name),
      roll_no = upper(trim(new_roll)),
      phone = trim(new_phone),
      role = new_role,
      status = new_status
  where id = target_id;
end $$;

revoke all on function public.update_user_profile(uuid, text, text, text, public.user_role, public.account_status) from public, anon;
grant execute on function public.update_user_profile(uuid, text, text, text, public.user_role, public.account_status) to authenticated;

-- 8. Create public.admin_confirm_user_email function
create or replace function public.admin_confirm_user_email(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
  caller_role public.user_role;
begin
  select role into caller_role from public.profiles where id=auth.uid() and status='approved';
  if caller_role is null or caller_role not in ('admin', 'super_admin') then
    raise exception 'Administrator or Super Administrator access required';
  end if;

  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = target_id;
end $$;

revoke all on function public.admin_confirm_user_email(uuid) from public, anon;
grant execute on function public.admin_confirm_user_email(uuid) to authenticated;

-- 9. Promote the main account to super_admin
update public.profiles
set role = 'super_admin', status = 'approved'
where email = 'chinmaychouhan155@gmail.com';
