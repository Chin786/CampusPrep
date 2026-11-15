import assert from 'node:assert/strict'
import test from 'node:test'
import { actor, db, migration, user } from './harness.mjs'

test('storage policy keeps question images private and migration creates the restricted bucket', async () => {
  await migration('20261113000100_foundation')
  await db.exec(
    'create schema storage; grant usage on schema storage to authenticated; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;grant select,insert on storage.objects to authenticated',
  )
  await migration('20261113000210_storage')
  const policy = await db.query(
    "select public,file_size_limit from storage.buckets where id='question-images'",
  )
  assert.equal(policy.rows[0].public, false)
  assert.equal(Number(policy.rows[0].file_size_limit), 5242880)
  const staff = await user(1),
    student = await user(2)
  await db.query(
    "update profiles set role='admin',status='approved' where id=$1",
    [staff],
  )
  await db.query("update profiles set status='approved' where id=$1", [student])
  await actor(staff)
  await db.query(
    "insert into storage.objects(bucket_id,name) values ('question-images','item.png')",
  )
  await actor(student)
  assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
  await actor(null)
  assert(
    (
      await db.query(
        "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' and not c.relrowsecurity",
      )
    ).rows.length === 0,
  )
  await db.close()
})
