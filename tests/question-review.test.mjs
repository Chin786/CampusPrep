import assert from 'node:assert/strict'
import test from 'node:test'
import { actor, db, migration, user } from './harness.mjs'

test('faculty draft ownership, revisions, independent review, publication and role revocation', async () => {
  for (const m of [
    '20261113000100_foundation',
    '20261113000510_author_role',
    '20261113000520_question_review',
  ])
    await migration(m)
  const [admin, faculty, other, student] = await Promise.all(
    [1, 2, 3, 4].map(user),
  )
  const call = async (sql, args = []) =>
    (await db.query('select ' + sql + ' x', args)).rows[0].x
  await db.query(
    "update profiles set status='approved',role=case when id=$1 then 'admin'::user_role else 'student'::user_role end",
    [admin],
  )
  await actor(admin)
  const { id: subject } = (
    await db.query("insert into subjects(name) values('Quant') returning id")
  ).rows[0]
  for (const id of [faculty, other])
    await call('set_content_author($1,true)', [id])
  const content = {
    subject_id: subject,
    section_name: 'Aptitude',
    question_text: 'What is 2 + 2?',
    options: ['2', '3', '4', '5'],
    correct_index: 2,
    marks: 2,
    negative_marks: 0,
    difficulty: 'easy',
    explanation: 'Two pairs make four.',
  }
  const save = (id, payload, submit, rev) =>
    call('save_question_draft($1,$2,$3,$4)', [id, payload, submit, rev])
  const review = (id, approve, note, rev) =>
    call('review_question_draft($1,$2,$3,$4)', [id, approve, note, rev])
  await actor(student)
  await assert.rejects(save(null, content, true, null), /author required/)
  await actor(faculty)
  assert.equal((await db.query('select id from subjects')).rows.length, 1)
  const id = await save(
    null,
    { question_text: 'Starting outline' },
    false,
    null,
  )
  await assert.rejects(save(id, { question_text: 'Incomplete' }, true, 1))
  await save(id, content, true, 1)
  await assert.rejects(review(id, true, '', 2), /Administrator required/)
  await actor(other)
  assert.equal((await db.query('select * from question_drafts')).rows.length, 0)
  await assert.rejects(save(id, content, false, 2), /unavailable/)
  await actor(admin)
  await assert.rejects(review(id, false, '  ', 2), /Describe/)
  await review(id, false, 'Clarify explanation', 2)
  await actor(faculty)
  await assert.rejects(save(id, content, true, 1), /changed/)
  await save(id, content, true, 3)
  await actor(null)
  await db.query("update profiles set role='admin' where id=$1", [faculty])
  await actor(faculty)
  await assert.rejects(review(id, true, '', 4), /different reviewer/)
  await actor(admin)
  const question = await review(id, true, 'Ready', 4)
  assert.equal(
    (await db.query('select created_by from questions where id=$1', [question]))
      .rows[0].created_by,
    faculty,
  )
  await assert.rejects(review(id, true, '', 4), /changed/)
  await actor(student)
  assert.equal((await db.query('select * from question_drafts')).rows.length, 0)
  await actor(admin)
  await call('set_content_author($1,false)', [other])
  await actor(other)
  await assert.rejects(save(null, content, true, null), /author required/)
  await db.close()
})
