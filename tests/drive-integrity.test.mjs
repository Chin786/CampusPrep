import assert from 'node:assert/strict'
import test from 'node:test'
import { actor, db, migration, user } from './harness.mjs'

test('drive revision, result release, private rank, small heartbeat and upgrade compatibility', async () => {
  for (const file of [
    '20261113000100_foundation',
    '20261113000200_authoring',
    '20261113000300_exam',
    '20261113000400_monitoring',
  ])
    await migration(file)
  const [admin, first, second, third, absent] = await Promise.all(
    [1, 2, 3, 4, 5].map(user),
  )
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const call = async (sql, args = []) =>
    (await one('select ' + sql + ' as result', args)).result
  await db.query(
    "update profiles set status='approved',role=case when id=$1 then 'admin'::user_role else 'student'::user_role end",
    [admin],
  )
  await actor(admin)
  const { id: subject } = await one(
    "insert into subjects(name) values('Quantitative aptitude') returning id",
  )
  const { id: question } = await one(
    `insert into questions(subject_id,section_name,question_text,options,correct_index,explanation,difficulty)
    values($1,'Math','Original prompt','["2","4","6","8"]',1,'Original solution','easy') returning id`,
    [subject],
  )
  const spec = {
    title: 'Original drive',
    duration_min: 30,
    status: 'published',
    instructions: 'Original rules',
  }
  const sections = [{ name: 'Aptitude', questions: [question] }]
  const paper = await call('save_test($1,$2)', [spec, JSON.stringify(sections)])
  const demo = await call('save_test($1,$2)', [
    { ...spec, is_demo: true },
    JSON.stringify(sections),
  ])
  const schedule = async (overrides = {}) =>
    call("create_schedule($1,'all','{}',null)", [
      {
        test_id: paper,
        start_at: new Date(Date.now() - 120000),
        end_at: new Date(Date.now() + 3600000),
        late_entry_min: 10,
        max_warnings: 3,
        require_fullscreen: false,
        require_seb: false,
        ...overrides,
      },
    ])
  const start = (s) => call('start_attempt($1,$2)', [paper, s])
  const paperFor = (a) => call('get_test_paper($1)', [a])
  const result = (a) => call('attempt_result($1)', [a])
  const pulse = (a) => call('attempt_heartbeat($1)', [a])
  const finish = (a) => call('submit_attempt($1)', [a])
  const old = await schedule()
  const future = await schedule()
  await actor(first)
  const oldAttempt = await start(old)
  await finish(oldAttempt)
  await actor(null)
  await migration('20261113000500_drive_integrity')
  await actor(first)
  assert.equal((await result(oldAttempt)).review_available, true)
  assert.equal((await result(oldAttempt)).rank_eligible, false)
  await actor(admin)
  assert.equal(
    (await one('select comparable_cohort from schedules where id=$1', [future]))
      .comparable_cohort,
    true,
  )
  const drive = await schedule()
  await db.query(
    "update questions set correct_index=0, marks=5, explanation='New solution', question_text='New prompt' where id=$1",
    [question],
  )
  await call('save_test($1,$2)', [
    {
      ...spec,
      id: paper,
      title: 'Revised drive',
      instructions: 'Revised rules',
      duration_min: 5,
    },
    JSON.stringify(sections),
  ])
  const newer = await schedule({ review_after_close: false })
  const duplicate = await call('save_test($1,$2)', [
    { ...spec, title: 'Copy', status: 'draft' },
    JSON.stringify(sections),
  ])
  assert.notEqual(duplicate, paper)
  await actor(first)
  const {
    paper_title,
    paper_total_marks,
    paper_duration_min,
    paper_instructions,
    review_after_close,
  } = await one('select * from schedules where id=$1', [drive])
  assert.deepEqual(
    [
      paper_title,
      paper_total_marks,
      paper_duration_min,
      paper_instructions,
      review_after_close,
    ],
    ['Original drive', '2', 30, 'Original rules', true],
  )
  await assert.rejects(
    db.query('select * from private.schedule_items'),
    /permission denied/,
  )
  const a = await start(drive)
  const view = await paperFor(a)
  assert.equal(view.title, 'Original drive')
  assert.equal(view.items[0].prompt, 'Original prompt')
  assert.equal(view.items[0].marks, 2)
  assert(view.remaining_seconds > 1700)
  await assert.rejects(result(a), /Submit the attempt/)
  assert.equal((await pulse(a)).revision_sum, 0)
  await call("save_response($1,$2,1,'answered',0,$3)", [
    a,
    question,
    crypto.randomUUID(),
  ])
  const heartbeat = await pulse(a)
  assert.equal(heartbeat.revision_sum, 1)
  assert.deepEqual(Object.keys(heartbeat).sort(), [
    'remaining_seconds',
    'revision_sum',
    'status',
    'warning_count',
  ])
  await finish(a)
  assert.equal(await finish(a), 'submitted')
  const sealed = await result(a)
  assert.equal(sealed.score, 2)
  assert.equal(sealed.total_marks, 2)
  assert.equal(sealed.review_available, false)
  assert.deepEqual(sealed.items, [])
  assert.equal(sealed.standing, null)
  assert.doesNotMatch(
    JSON.stringify(sealed),
    /correct_index|Original solution|Original prompt/,
  )
  const revised = await start(newer)
  assert.equal((await paperFor(revised)).items[0].prompt, 'New prompt')
  await finish(revised)
  assert.equal((await result(revised)).items[0].correct_index, 0)
  const practice = await call('start_attempt($1,null)', [demo])
  await finish(practice)
  assert.equal((await result(practice)).review_available, true)
  assert.equal((await result(practice)).standing, null)
  await actor(second)
  await assert.rejects(result(a), /unavailable/)
  await assert.rejects(pulse(a), /unavailable/)
  const b = await start(drive)
  assert.equal((await paperFor(b)).items[0].prompt, 'Original prompt')
  await call("save_response($1,$2,1,'answered',0,$3)", [
    b,
    question,
    crypto.randomUUID(),
  ])
  await finish(b)
  await actor(third)
  const c = await start(drive)
  await actor(admin)
  assert.equal((await result(a)).items[0].correct_index, 1)
  await db.query(
    "update schedules set end_at=clock_timestamp()-interval '1 second' where id=$1",
    [drive],
  )
  await actor(first)
  const released = await result(a)
  assert.equal(released.items[0].explanation, 'Original solution')
  assert.equal(released.standing, null)
  await actor(null)
  await db.query(
    "update attempts set deadline_at=clock_timestamp()-interval '1 second' where id=$1",
    [c],
  )
  await call('private.sweep_expired()')
  await actor(first)
  assert.deepEqual((await result(a)).standing, { rank: 1, count: 3 })
  await actor(second)
  assert.deepEqual((await result(b)).standing, { rank: 1, count: 3 })
  await actor(third)
  assert.deepEqual((await result(c)).standing, { rank: 2, count: 3 })
  await actor(absent)
  await assert.rejects(result(c), /unavailable/)
  await actor(admin)
  const report = await call('schedule_report($1)', [drive])
  assert.deepEqual(
    report.leaderboard.map((x) => x.rank),
    [1, 1, 2],
  )
  await db.close()
})
