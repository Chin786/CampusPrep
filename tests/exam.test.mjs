import test from 'node:test'
import assert from 'node:assert/strict'
import { db, migration, actor, user } from './harness.mjs'
test('scoped paper, scoring, late entry, idempotent autosave, expiry and demo retakes', async () => {
  for (const f of [
    '20261113000100_foundation',
    '20261113000200_authoring',
    '20261113000300_exam',
  ])
    await migration(f)
  const admin = await user(1),
    s = await user(2),
    other = await user(3)
  await db.query(
    "update profiles set status='approved',role=case when id=$1 then 'admin'::user_role else 'student'::user_role end",
    [admin],
  )
  await actor(admin)
  const subject = (
    await db.query("insert into subjects(name) values('CS') returning id")
  ).rows[0].id
  const ids = []
  for (let i = 0; i < 3; i++)
    ids.push(
      (
        await db.query(
          "insert into questions(subject_id,section_name,question_text,options,correct_index,explanation,difficulty,negative_marks) values($1,'Section','Question','[\"A\",\"B\",\"C\",\"D\"]',0,'Explanation','medium',0.5) returning id",
          [subject],
        )
      ).rows[0].id,
    )
  const make = async (demo) =>
    (
      await db.query('select save_test($1,$2) id', [
        JSON.stringify({
          title: 'Trial',
          duration_min: 30,
          status: 'published',
          is_demo: demo,
        }),
        JSON.stringify([{ name: 'Section', questions: ids }]),
      ])
    ).rows[0].id
  const tid = await make(false),
    demo = await make(true)
  const sched = async (start) =>
    (
      await db.query("select create_schedule($1,'selected',$2,null) id", [
        JSON.stringify({
          test_id: tid,
          start_at: new Date(start),
          end_at: new Date(Date.now() + 3600000),
          late_entry_min: 10,
          max_warnings: 2,
          require_fullscreen: false,
          require_seb: false,
        }),
        [s],
      ])
    ).rows[0].id
  const sid = await sched(Date.now() - 2000),
    past = await sched(Date.now() - 900000)
  await actor(s)
  const start = async (t, sch) =>
    (await db.query('select start_attempt($1,$2) id', [t, sch])).rows[0].id
  await assert.rejects(start(tid, past))
  const a = await start(tid, sid)
  assert.equal(a, await start(tid, sid))
  const paper = async (x) =>
    (await db.query('select get_test_paper($1) p', [x])).rows[0].p
  assert.equal((await paper(a)).items.length, 3)
  assert(!JSON.stringify(await paper(a)).includes('correct_index'))
  assert(!JSON.stringify(await paper(a)).includes('explanation'))
  await assert.rejects(db.query('select attempt_result($1)', [a]))
  await actor(other)
  await assert.rejects(paper(a))
  await actor(s)
  const save = async (id, i, state = 'answered', op = crypto.randomUUID()) =>
    (
      await db.query('select save_response($1,$2,$3,$4,0,$5) r', [
        a,
        id,
        i,
        state,
        op,
      ])
    ).rows[0].r
  const op = crypto.randomUUID()
  await save(ids[0], 0, 'answered_marked', op)
  assert((await save(ids[0], 0, 'answered_marked', op)).replayed)
  assert((await save(ids[0], 1)).conflict)
  await save(ids[1], 1)
  await db.query('select submit_attempt($1)', [a])
  const result = (await db.query('select attempt_result($1) r', [a])).rows[0].r
  assert.equal(result.score, 1.5)
  assert.equal(result.items.length, 3)
  assert((await save(ids[2], 1)).closed)
  const da = await start(demo, null)
  await actor(null)
  await db.query(
    "update attempts set deadline_at=now()-interval '1 second' where id=$1",
    [da],
  )
  await actor(s)
  assert.equal((await paper(da)).status, 'auto_submitted')
  assert.notEqual(da, await start(demo, null))
  await actor(admin)
  await db.query('update settings set require_seb = true')
  await actor(s)
  await db.query('select submit_attempt($1)', [await start(demo, null)])
  await assert.rejects(start(demo, null), /Safe Exam Browser required/)
  const setAgent = (agent) =>
    db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'user-agent': agent })])
  await setAgent('SafeExamBrowser/3.8')
  const protectedAttempt = await start(demo, null)
  await setAgent('Regular browser')
  await assert.rejects(paper(protectedAttempt), /Safe Exam Browser required/)
  await assert.rejects(start(demo, null), /Safe Exam Browser required/)
  await setAgent('SafeExamBrowser/3.8')
  assert.equal((await paper(protectedAttempt)).status, 'in_progress')
  await db.close()
})
