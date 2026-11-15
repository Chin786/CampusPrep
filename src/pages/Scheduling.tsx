import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db, rpc, unwrap } from '../lib/db'
import type { Profile, Schedule, Test } from '../types'
import {
  Dialog,
  Feedback,
  Loading,
  Title,
  useData,
  useTask,
  fetchAll,
} from '../components/Common'
const time = (s: string) => new Date(s).toLocaleString()
export function Scheduling() {
  const d = useData(async () => {
      const [tests, students, schedules, groups, setting] = await Promise.all([
        fetchAll<Test>((f, t) =>
          db
            .from('tests')
            .select('*')
            .eq('status', 'published')
            .eq('is_demo', false)
            .order('id')
            .range(f, t),
        ),
        fetchAll<Profile>((f, t) =>
          db
            .from('profiles')
            .select('*')
            .eq('role', 'student')
            .eq('status', 'approved')
            .order('id')
            .range(f, t),
        ),
        fetchAll<Schedule>((f, t) =>
          db.from('schedules').select('*').order('start_at').range(f, t),
        ),
        unwrap(db.from('groups').select('*').order('name')),
        unwrap<{ require_seb: boolean }>(
          db.from('settings').select('require_seb').single(),
        ),
      ])
      return { tests, students, schedules, groups, setting }
    }),
    task = useTask(),
    [aud, A] = useState('all'),
    [ids, I] = useState<string[]>([]),
    [share, Share] = useState<Schedule | null>(null),
    [cal, C] = useState(false),
    [month, M] = useState(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    )
  if (!d.data) return <Loading error={d.error} />
  const v = d.data
  const name = (s: Schedule) => s.paper_title
  return (
    <>
      <Title kicker="Administration" title="Schedule tests" />
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget,
            f = new FormData(form)
          task.run(async () => {
            await rpc('create_schedule', {
              details: {
                test_id: f.get('test'),
                start_at: new Date(String(f.get('start'))).toISOString(),
                end_at: new Date(String(f.get('end'))).toISOString(),
                late_entry_min: +String(f.get('late')),
                max_warnings: +String(f.get('max')),
                require_fullscreen: f.has('full'),
                require_seb: f.has('seb'),
                review_after_close: f.has('delay_key'),
              },
              audience: aud,
              members: ids,
              cohort: f.get('group') || null,
            })
            form.reset()
            I([])
            d.reload()
          }, 'Schedule created')
        }}
      >
        <label>
          Published test
          <select required name="test">
            <option value="">Select paper</option>
            {v.tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <div className="two">
          <label>
            Opens
            <input name="start" required type="datetime-local" />
          </label>
          <label>
            Closes
            <input name="end" required type="datetime-local" />
          </label>
          <label>
            Late entry after opening (minutes)
            <input
              type="number"
              name="late"
              required
              min="0"
              defaultValue="10"
            />
          </label>
          <label>
            Maximum warnings
            <input
              name="max"
              type="number"
              required
              min="1"
              max="100"
              defaultValue="3"
            />
          </label>
        </div>
        <p className="muted">
          Times are entered in{' '}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}.
        </p>
        <div className="tools">
          <label className="check">
            <input type="checkbox" defaultChecked name="full" />
            Require fullscreen
          </label>
          <label className="check">
            <input
              type="checkbox"
              defaultChecked={v.setting?.require_seb}
              name="seb"
            />
            Require Safe Exam Browser
          </label>
        </div>
        <label className="check">
          <input type="checkbox" name="delay_key" defaultChecked />
          Release answer keys and explanations when this schedule closes
        </label>
        <p className="muted">
          Students see their score on submission. Each scheduled paper is frozen
          when you create the schedule.
        </p>
        <label>
          Assign to
          <select value={aud} onChange={(e) => A(e.target.value)}>
            <option value="all">All currently approved students</option>
            <option value="selected">Selected students</option>
            <option value="group">Student group</option>
          </select>
        </label>
        {aud === 'selected' &&
          v.students.map((p) => (
            <label className="check" key={p.id}>
              <input
                type="checkbox"
                checked={ids.includes(p.id)}
                onChange={(e) =>
                  I(
                    e.target.checked
                      ? [...ids, p.id]
                      : ids.filter((i) => i !== p.id),
                  )
                }
              />
              {p.full_name} · {p.roll_no}
            </label>
          ))}
        {aud === 'group' && (
          <label>
            Group
            <select required name="group">
              {v.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="primary" disabled={task.busy}>
          Schedule and assign
        </button>
        <Feedback {...task} />
      </form>
      <section className="card">
        <div className="title-row">
          <h2>Assessment calendar</h2>
          <button onClick={() => C(!cal)}>
            {cal ? 'List view' : 'Calendar view'}
          </button>
        </div>
        {cal ? (
          <>
            <div className="tools">
              <button
                aria-label="Previous month"
                onClick={() =>
                  M(new Date(month.getFullYear(), month.getMonth() - 1, 1))
                }
              >
                ←
              </button>
              <b>
                {month.toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              </b>
              <button
                aria-label="Next month"
                onClick={() =>
                  M(new Date(month.getFullYear(), month.getMonth() + 1, 1))
                }
              >
                →
              </button>
            </div>
            <div className="calendar">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <b key={day}>{day}</b>
              ))}
              {Array.from({ length: month.getDay() }, (_, i) => (
                <i key={'b' + i} />
              ))}
              {Array.from(
                {
                  length: new Date(
                    month.getFullYear(),
                    month.getMonth() + 1,
                    0,
                  ).getDate(),
                },
                (_, i) => {
                  const date = new Date(
                    month.getFullYear(),
                    month.getMonth(),
                    i + 1,
                  )
                  return (
                    <div key={i}>
                      <b>{i + 1}</b>
                      {v.schedules
                        .filter(
                          (s) =>
                            new Date(s.start_at).toDateString() ===
                            date.toDateString(),
                        )
                        .map((s) => (
                          <small key={s.id}>{name(s)}</small>
                        ))}
                    </div>
                  )
                },
              )}
            </div>
          </>
        ) : (
          v.schedules.map((s) => (
            <div className="listrow" key={s.id}>
              <div>
                <b>{name(s)}</b>
                <small>
                  {time(s.start_at)} – {time(s.end_at)}
                </small>
              </div>
              <div className="actions">
                <button onClick={() => Share(s)}>Share link</button>
                <Link to={'/admin/results?schedule=' + s.id}>Results</Link>
              </div>
            </div>
          ))
        )}
        {!v.schedules.length && <p>No schedules yet.</p>}
      </section>
      {share && (
        <Dialog close={() => Share(null)} title="Share the scheduled test">
          <p>
            {name(share)} · {time(share.start_at)}
          </p>
          <label>
            Common link for assigned students
            <input
              readOnly
              onFocus={(e) => e.target.select()}
              value={
                location.origin +
                '/instructions/' +
                share.test_id +
                '?schedule=' +
                share.id
              }
            />
          </label>
          <div className="actions">
            <button
              onClick={() =>
                task.run(async () => {
                  await navigator.clipboard.writeText(
                    location.origin +
                      '/instructions/' +
                      share.test_id +
                      '?schedule=' +
                      share.id,
                  )
                }, 'Link copied')
              }
            >
              Copy link
            </button>
            <a
              className="button"
              target="_blank"
              rel="noreferrer"
              href={
                'https://mail.google.com/mail/?' +
                new URLSearchParams({
                  view: 'cm',
                  fs: '1',
                  su: 'Exam invitation: ' + name(share),
                  body:
                    'Please sign in with your registered account. Your test opens ' +
                    time(share.start_at) +
                    ' (' +
                    Intl.DateTimeFormat().resolvedOptions().timeZone +
                    ').\n\n' +
                    location.origin +
                    '/instructions/' +
                    share.test_id +
                    '?schedule=' +
                    share.id,
                })
              }
            >
              Open Gmail draft
            </a>
            <button onClick={() => Share(null)}>Close</button>
          </div>
          <Feedback error={task.error} />
        </Dialog>
      )}
    </>
  )
}
