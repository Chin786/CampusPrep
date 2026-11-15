import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db, migration } from './harness.mjs'

// Execute the real seed script and its HTTP requests against a disposable SQL fixture.
test('seed produces the requested roster, two papers and assignments, and is safe to rerun', async () => {
  for (const name of [
    '20261113000100_foundation',
    '20261113000200_authoring',
    '20261113000300_exam',
    '20261113000400_monitoring',
    '20261113000500_drive_integrity',
    '20261113000510_author_role',
    '20261113000520_question_review',
  ])
    await migration(name)
  const tables = new Set([
    'profiles',
    'subjects',
    'questions',
    'tests',
    'test_sections',
    'test_questions',
    'schedules',
    'schedule_assignments',
  ])
  const ident = (s) => {
    assert.match(s, /^[a-z_]+$/)
    return '"' + s + '"'
  }
  const server = http.createServer(async (req, res) => {
    try {
      const parts = []
      for await (const part of req) parts.push(part)
      const payload = parts.length ? JSON.parse(Buffer.concat(parts)) : null
      const url = new URL(req.url, 'http://localhost')
      const table = url.pathname.split('/').pop()
      let output = null
      if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
        const id = randomUUID()
        await db.query('insert into auth.users values($1,$2,$3)', [
          id,
          payload.email,
          JSON.stringify(payload.user_metadata),
        ])
        output = { id, email: payload.email }
      } else {
        assert(tables.has(table))
        const filters = [...url.searchParams.entries()].filter(
          ([k]) => !['select', 'columns', 'on_conflict'].includes(k),
        )
        const vals = []
        const where = () =>
          filters.length
            ? ' where ' +
              filters
                .map(([k, v]) => {
                  assert(v.startsWith('eq.'))
                  vals.push(v.slice(3))
                  return ident(k) + '=$' + vals.length
                })
                .join(' and ')
            : ''
        if (req.method === 'GET') {
          output = (
            await db.query(
              'select ' +
                url.searchParams.get('select').split(',').map(ident).join(',') +
                ' from ' +
                ident(table) +
                where(),
              vals,
            )
          ).rows
        } else if (req.method === 'PATCH') {
          const changes = Object.entries(payload).map(([k, v]) => {
            vals.push(v)
            return ident(k) + '=$' + vals.length
          })
          await db.query(
            'update ' + ident(table) + ' set ' + changes.join(',') + where(),
            vals,
          )
        } else if (req.method === 'POST') {
          for (const row of Array.isArray(payload) ? payload : [payload]) {
            const cols = Object.keys(row)
            const conflict = (req.headers.prefer || '').includes('resolution=')
            const keys = (url.searchParams.get('on_conflict') || 'id').split(
              ',',
            )
            const updates = cols.filter((k) => !keys.includes(k))
            const action =
              (req.headers.prefer || '').includes('ignore-duplicates') ||
              !updates.length
                ? 'nothing'
                : 'update set ' +
                  updates
                    .map((k) => ident(k) + '=excluded.' + ident(k))
                    .join(',')
            const sql =
              'insert into ' +
              ident(table) +
              ' (' +
              cols.map(ident).join(',') +
              ') values (' +
              cols.map((_, n) => '$' + (n + 1)).join(',') +
              ')' +
              (conflict
                ? ' on conflict (' +
                  keys.map(ident).join(',') +
                  ') do ' +
                  action
                : '')
            await db.query(
              sql,
              cols.map((k) =>
                k === 'options' ? JSON.stringify(row[k]) : row[k],
              ),
            )
          }
        } else throw Error('Unexpected fixture request')
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(output))
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: e.message }))
    }
  })
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'campusprep-seed-'))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    for (let run = 0; run < 2; run++) {
      const child = spawn(
        process.execPath,
        [path.resolve('scripts/seed.mjs')],
        {
          cwd: dir,
          env: {
            ...process.env,
            SUPABASE_URL: 'http://127.0.0.1:' + server.address().port,
            SUPABASE_SERVICE_ROLE_KEY: 'test-fixture-only',
            NO_PROXY: '127.0.0.1,localhost',
            no_proxy: '127.0.0.1,localhost',
          },
        },
      )
      let err = ''
      child.stderr.on('data', (s) => (err += s))
      const code = await new Promise((r) => child.once('exit', r))
      assert.equal(code, 0, err)
    }
    const count = async (sql) => (await db.query(sql)).rows[0].n
    assert.equal(
      await count("select count(*)::int n from profiles where role='admin'"),
      1,
    )
    assert.equal(
      await count(
        "select count(*)::int n from profiles where role='student' and status='approved'",
      ),
      3,
    )
    assert.equal(
      await count(
        'select count(*)::int n from test_questions join tests on test_id=tests.id where is_demo',
      ),
      9,
    )
    assert.equal(
      await count(
        "select count(*)::int n from test_questions join tests on test_id=tests.id where not is_demo and status='published'",
      ),
      20,
    )
    assert.equal(await count('select count(*)::int n from schedules'), 1)
    assert.equal(
      await count('select count(*)::int n from private.schedule_items'),
      20,
    )
    assert.equal(
      await count('select count(*)::int n from schedule_assignments'),
      3,
    )
  } finally {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    await fs.rm(dir, { recursive: true, force: true })
    await db.close()
  }
})
