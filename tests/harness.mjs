import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
export const db = new PGlite()
await db.exec(
  "create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon;",
)
export async function migration(part) {
  await db.exec(fs.readFileSync('supabase/migrations/' + part + '.sql', 'utf8'))
}
export async function actor(id) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || '',
  ])
  if (id) await db.exec('set role authenticated')
}
export async function user(n) {
  let id = '10000000-0000-4000-8000-' + String(n).padStart(12, '0')
  await db.query('insert into auth.users values ($1,$2,$3)', [
    id,
    'user' + n + '@example.test',
    JSON.stringify({
      full_name: 'Student ' + n,
      phone: '9990000000',
      roll_no: 'TEST' + n,
      role: 'admin',
      status: 'approved',
    }),
  ])
  return id
}
