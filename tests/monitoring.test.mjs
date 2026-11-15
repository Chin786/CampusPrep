import test from 'node:test'
import assert from 'node:assert/strict'
import { db, migration, actor, user } from './harness.mjs'

test('enforces the warning limit, keeps duplicate signals idempotent, grades once, and reports submitted attempts', async () => {
  for (const filename of [
    '20261113000100_foundation',
    '20261113000200_authoring',
    '20261113000300_exam',
    '20261113000400_monitoring',
  ])
    await migration(filename)
  const admin = await user(1),
    student = await user(2),
    other = await user(3)
  await db.query(
    "update profiles set status='approved',role=case when id=$1 then 'admin'::user_role else 'student'::user_role end",
    [admin],
  )
  await actor(admin)
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const { id: subject } = await one(
    "insert into subjects(name) values ('Research') returning id",
  )
  const { id: question } = await one(
    "insert into questions(subject_id,section_name,question_text,options,correct_index,explanation,difficulty) values($1,'I','Sample question','[\"A\",\"B\",\"C\",\"D\"]',1,'Correct because…','medium') returning id",
    [subject],
  )
  const { id: testId } = await one('select save_test($1,$2) id', [
    JSON.stringify({
      title: 'Practice',
      duration_min: 20,
      status: 'published',
    }),
    JSON.stringify([{ name: 'I', questions: [question] }]),
  ])
  const { id: schedule } = await one(
    "select create_schedule($1,'all','{}',null) id",
    [
      JSON.stringify({
        test_id: testId,
        start_at: new Date(Date.now() - 3000),
        end_at: new Date(Date.now() + 1200000),
        late_entry_min: 10,
        max_warnings: 2,
        require_fullscreen: true,
        require_seb: false,
      }),
    ],
  )
  await actor(student)
  const { id: attempt } = await one('select start_attempt($1,$2) id', [
    testId,
    schedule,
  ])
  await one("select save_response($1,$2,1,'answered_marked',0,$3)", [
    attempt,
    question,
    crypto.randomUUID(),
  ])
  const warn = async (event) =>
    (
      await one("select log_violation($1,$2,'tab_switch','{}') v", [
        attempt,
        event,
      ])
    ).v
  const first = crypto.randomUUID()
  assert.deepEqual(await warn(first), { closed: false, warning_count: 1 })
  assert.deepEqual(await warn(first), { closed: false, warning_count: 1 })
  await actor(other)
  await assert.rejects(warn(crypto.randomUUID()), /unavailable/)
  await actor(student)
  assert.deepEqual(await warn(crypto.randomUUID()), {
    closed: true,
    warning_count: 2,
  })
  assert.equal((await one('select count(*)::int n from violations')).n, 2)
  const { r } = await one('select attempt_result($1) r', [attempt])
  assert.equal(r.score, 2)
  assert.equal(r.status, 'auto_submitted')
  await assert.rejects(
    one('select schedule_report($1)', [schedule]),
    /Administrator required/,
  )
  await actor(admin)
  const { r: report } = await one('select schedule_report($1) r', [schedule])
  assert.equal(report.leaderboard[0].rank, 1)
  assert.equal(report.leaderboard[0].warning_count, 2)
  assert.equal(report.sections[0].score, 2)
  assert.equal(report.questions[0].correct, 1)
  await actor(other)
  const { id: second } = await one('select start_attempt($1,$2) id', [
    testId,
    schedule,
  ])
  await actor(null)
  await db.query(
    "update attempts set deadline_at=now()-interval '5 seconds' where id=$1",
    [second],
  )
  assert.equal((await one('select private.sweep_expired() n')).n, 1)
  assert.equal((await one('select private.sweep_expired() n')).n, 0)
  await actor(other)
  assert.equal(
    (await one('select attempt_result($1) r', [second])).r.status,
    'auto_submitted',
  )
  await db.close()
})
