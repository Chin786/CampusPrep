import test from 'node:test'
import assert from 'node:assert/strict'
import { db, migration, actor, user } from './harness.mjs'
test('new identities stay pending students, can read only their profile and cannot promote themselves', async () => {
  await migration('20261113000100_foundation')
  const a = await user(1)
  await user(2)
  await actor(a)
  const { rows } = await db.query('select * from public.profiles')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].role, 'student')
  assert.equal(
    (await db.query("update public.profiles set role='admin' returning *")).rows
      .length,
    0,
  )
  assert.equal((await db.query('select * from questions')).rows.length, 0)
  await db.close()
})
