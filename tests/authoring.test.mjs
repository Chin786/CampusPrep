import test from 'node:test'
import assert from 'node:assert/strict'
import { db, migration, actor, user } from './harness.mjs'
test('publish and group assignment are atomic and administrator-only', async () => {
  await migration('20261113000100_foundation')
  await migration('20261113000200_authoring')
  const a = await user(1),
    b = await user(2)
  await db.query(
    "update profiles set status='approved',role=case when id=$1 then 'admin'::user_role else 'student'::user_role end",
    [a],
  )
  await actor(a)
  const sub = (
    await db.query("insert into subjects(name) values('CS') returning id")
  ).rows[0].id
  const q = (
    await db.query(
      "insert into questions(subject_id,section_name,question_text,options,correct_index,explanation,difficulty) values($1,'A','Q','[\"1\",\"2\",\"3\",\"4\"]',1,'E','easy') returning id",
      [sub],
    )
  ).rows[0].id
  const t = (
    await db.query('select save_test($1,$2) id', [
      JSON.stringify({ title: 'Paper', duration_min: 30, status: 'published' }),
      JSON.stringify([{ name: 'A', questions: [q] }]),
    ])
  ).rows[0].id
  const g = (await db.query('select save_group($1,$2) id', ['Batch', [b]]))
    .rows[0].id
  const detail = JSON.stringify({
    test_id: t,
    start_at: new Date(),
    end_at: new Date(Date.now() + 3600000),
    late_entry_min: 10,
    max_warnings: 3,
    require_fullscreen: true,
    require_seb: false,
  })
  await db.query("select create_schedule($1,'group','{}',$2)", [detail, g])
  await actor(b)
  assert.equal((await db.query('select * from schedules')).rows.length, 1)
  await assert.rejects(
    db.query("select create_schedule($1,'all','{}',null)", [detail]),
  )
  await db.close()
})
