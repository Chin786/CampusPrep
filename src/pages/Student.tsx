import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { db, rpc, unwrap } from '../lib/db'
import type { Schedule, Test, Paper } from '../types'
import {
  Title,
  Loading,
  Feedback,
  useData,
  useTask,
  fetchAll,
} from '../components/Common'
import { useSession } from '../store/session'
import { PaletteLegend } from '../components/Palette'
export const clock = (n: number) =>
  [Math.floor(n / 3600), Math.floor(n / 60) % 60, Math.floor(n) % 60]
    .map((x) => String(Math.max(0, x)).padStart(2, '0'))
    .join(':')
export function Student({ mode = 'overview' }: { mode?: string }) {
  const d = useData(async () => {
      const [tests, ss, aa] = await Promise.all([
        fetchAll<Test>((f, t) =>
          db.from('tests').select('*').order('id').range(f, t),
        ),
        fetchAll<Schedule>((f, t) =>
          db.from('schedules').select('*').order('start_at').range(f, t),
        ),
        unwrap(
          db
            .from('attempts')
            .select(
              'id,test_id,schedule_id,status,is_demo,title,score,deadline_at',
            )
            .order('started_at', { ascending: false }),
        ),
      ])
      return { tests, ss, aa }
    }),
    [now, N] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => N(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])
  if (!d.data) return <Loading error={d.error} />
  const { tests, ss, aa } = d.data
  const demoDone = aa.some(
    (a) =>
      a.is_demo &&
      (a.status !== 'in_progress' || Date.parse(a.deadline_at) < now),
  )
  return (
    <>
      <Title
        kicker="Candidate portal"
        title={
          {
            overview: 'Student dashboard',
            demo: 'Demo tests',
            tests: 'Scheduled tests',
            results: 'My results',
          }[mode] || 'Overview'
        }
      />
      {mode === 'overview' && !demoDone && (
        <div className="banner">
          <div>
            <h2>Try the exam interface</h2>
            <p>
              Practise moving through the question palette and submitting a
              paper before your first scheduled test.
            </p>
          </div>
          <Link className="button" to="/student/demo">
            Open demo tests
          </Link>
        </div>
      )}
      {['overview', 'tests'].includes(mode) && (
        <section className="card">
          <h2>Assigned schedules</h2>
          {!ss.length && <p>No tests have been assigned yet.</p>}
          {ss.map((s) => {
            const a = aa.find((a) => a.schedule_id === s.id),
              start = Date.parse(s.start_at),
              end = Date.parse(s.end_at)
            const allowed =
              now >= start &&
              now < end &&
              now <= start + s.late_entry_min * 60000
            return (
              <div className="listrow" key={s.id}>
                <div>
                  <b>{s.paper_title}</b>
                  <small>
                    {new Date(start).toLocaleString()} · {s.paper_duration_min}{' '}
                    min
                  </small>
                  <small>
                    {now < start
                      ? 'Opens in ' + clock((start - now) / 1000)
                      : now >= end
                        ? 'Closed'
                        : allowed
                          ? 'Entry open'
                          : 'Entry window closed'}
                  </small>
                </div>
                {a ? (
                  <Link
                    to={
                      a.status === 'in_progress' &&
                      Date.parse(a.deadline_at) > now
                        ? '/exam/' + a.id
                        : '/result/' + a.id
                    }
                  >
                    {a.status === 'in_progress' &&
                    Date.parse(a.deadline_at) > now
                      ? 'Resume'
                      : 'Result'}
                  </Link>
                ) : allowed ? (
                  <Link
                    className="button"
                    to={'/instructions/' + s.test_id + '?schedule=' + s.id}
                  >
                    Start
                  </Link>
                ) : (
                  <button disabled>Start</button>
                )}
              </div>
            )
          })}
        </section>
      )}
      {mode === 'demo' && (
        <div className="cards">
          {tests
            .filter((t) => t.is_demo)
            .map((t) => (
              <section className="card" key={t.id}>
                <div className="eyebrow">Practice paper</div>
                <h2>{t.title}</h2>
                <p>{t.description}</p>
                <p>
                  {t.duration_min} minutes · {t.total_marks} marks
                </p>
                <Link className="button" to={'/instructions/' + t.id}>
                  Open instructions
                </Link>
              </section>
            ))}
          {!tests.some((t) => t.is_demo) && (
            <p>No demo papers have been published.</p>
          )}
        </div>
      )}
      {['overview', 'results'].includes(mode) && (
        <section className="card">
          <h2>Recent attempts</h2>
          {!aa.length && (
            <p>Your results will appear after your first attempt.</p>
          )}
          {aa.map((a) => {
            const done =
              a.status !== 'in_progress' || Date.parse(a.deadline_at) <= now
            return (
              <div className="listrow" key={a.id}>
                <div>
                  <b>{a.title}</b>
                  <small>
                    {a.is_demo ? 'Demo · ' : ''}
                    {done ? 'Completed' : 'In progress'}
                  </small>
                </div>
                <Link to={(done ? '/result/' : '/exam/') + a.id}>
                  {done ? 'View score and analysis' : 'Resume'}
                </Link>
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}
type Displays = {
  screens: unknown[]
  addEventListener: (s: string, f: () => void) => void
  removeEventListener: (s: string, f: () => void) => void
}
export const displays = () =>
  (
    window as Window & { getScreenDetails?: () => Promise<Displays> }
  ).getScreenDetails?.()
export function Instructions() {
  const { id } = useParams(),
    [sp] = useSearchParams(),
    schedule = sp.get('schedule'),
    p = useSession((s) => s.profile)!,
    nav = useNavigate(),
    d = useData(
      async () => ({
        test: schedule
          ? await unwrap<
              Pick<
                Test,
                'title' | 'duration_min' | 'instructions' | 'total_marks'
              > & { is_demo?: boolean }
            >(
              db
                .from('schedules')
                .select(
                  'title:paper_title,duration_min:paper_duration_min,instructions:paper_instructions,total_marks:paper_total_marks',
                )
                .eq('id', schedule)
                .eq('test_id', id)
                .single(),
            )
          : await unwrap<Test>(
              db.from('tests').select('*').eq('id', id).single(),
            ),
        rules: await rpc('exam_rules', { schedule }),
      }),
      id + String(schedule),
    ),
    task = useTask(),
    [read, R] = useState(false),
    [step, S] = useState(0),
    [screen, Screen] = useState('Not checked'),
    [full, F] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const f = () => F(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  if (!d.data) return <Loading error={d.error} />
  const { test, rules } = d.data
  if (!rules) return <Loading error="No access to this schedule." />
  const supported =
      typeof crypto.randomUUID === 'function' &&
      typeof window.fetch === 'function' &&
      (!rules.require_fullscreen || document.fullscreenEnabled),
    seb = /SafeExamBrowser|SEB\//i.test(navigator.userAgent)
  return (
    <main className="standalone">
      <Title
        kicker={test.is_demo ? 'Practice examination' : 'Scheduled examination'}
        title={test.title}
      />
      <section className="card">
        <div className="steps">
          <span className={!step ? 'active' : ''}>1. Instructions</span>
          <span className={step ? 'active' : ''}>2. System check</span>
        </div>
        <p>
          <b>{p.full_name}</b> · {p.roll_no} · {test.duration_min} min ·{' '}
          {test.total_marks} marks
        </p>
        {!step ? (
          <>
            <h2>General instructions</h2>
            <p className="pre">{test.instructions}</p>
            <p>
              Selected answers, including answered questions marked for review,
              count towards your score. Unanswered questions earn zero. Each
              question shows its marks and deduction.
            </p>
            <PaletteLegend />
            <p>
              This browser records detectable focus, display and clipboard
              events. At {rules.max_warnings} warnings, the server submits the
              attempt. Operating-system actions and screen mirroring may be
              invisible to the browser.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={read}
                onChange={(e) => R(e.target.checked)}
              />
              I have read the instructions
            </label>
            <button disabled={!read} className="primary" onClick={() => S(1)}>
              Continue to system check
            </button>
          </>
        ) : (
          <>
            <h2>System check</h2>
            <div className="listrow">
              Browser capabilities{' '}
              <b>{supported ? 'Supported' : 'Required features unavailable'}</b>
            </div>
            <div className="listrow">
              Fullscreen{' '}
              <button
                onClick={() =>
                  task.run(async () => {
                    await document.documentElement.requestFullscreen()
                  })
                }
              >
                {full
                  ? 'Active'
                  : rules.require_fullscreen
                    ? 'Enter fullscreen'
                    : 'Optional'}
              </button>
            </div>
            <div className="listrow">
              Displays · {screen}
              <button
                onClick={() =>
                  task.run(async () => {
                    try {
                      const v = await displays()
                      const multi = v
                        ? v.screens.length > 1
                        : Boolean(
                            (window.screen as Screen & { isExtended?: boolean })
                              .isExtended,
                          )
                      Screen(
                        multi
                          ? 'Multiple displays detected'
                          : v
                            ? 'One display'
                            : 'Detailed detection unavailable',
                      )
                      sessionStorage.setItem('cbt-multi', String(multi))
                    } catch {
                      Screen('Permission unavailable')
                    }
                  })
                }
              >
                Check displays
              </button>
            </div>
            <p>
              Safe Exam Browser ·{' '}
              {rules.require_seb
                ? seb
                  ? 'Detected'
                  : 'Required to start'
                : 'Optional'}
            </p>
            <div className="actions">
              <button onClick={() => S(0)}>Back</button>
              <button
                className="primary"
                disabled={
                  task.busy ||
                  !supported ||
                  (rules.require_fullscreen && !full) ||
                  (rules.require_seb && !seb)
                }
                onClick={() =>
                  task.run(async () => {
                    const a = await rpc('start_attempt', { test: id, schedule })
                    nav('/exam/' + a)
                  })
                }
              >
                Start examination
              </button>
            </div>
          </>
        )}
        <Feedback {...task} />
      </section>
    </main>
  )
}
type ResultItem = Paper['items'][number] & {
  correct_index: number
  earned: number
  explanation: string
}
export function Result() {
  const { id } = useParams(),
    d = useData(
      async () =>
        (await rpc('attempt_result', { attempt_id: id })) as {
          title: string
          score: number
          is_demo: boolean
          status: string
          total_marks: number
          review_available: boolean
          review_at: string | null
          rank_eligible: boolean
          standing: { rank: number; count: number } | null
          items: ResultItem[]
        },
      id,
    )
  if (!d.data) return <Loading error={d.error} />
  const r = d.data,
    warningCount = sessionStorage.getItem('cbt-final-warning-' + id)
  return (
    <main className="standalone">
      {warningCount && (
        <p role="alert" className="notice">
          Warning {warningCount} of {warningCount}. The warning limit was
          reached and your attempt was automatically submitted.
        </p>
      )}
      <Link to="/">← Dashboard</Link>
      <Title
        kicker={r.is_demo ? 'Demo result' : 'Exam result'}
        title={r.title}
      />
      <div className="banner">
        <div>
          <small>Final score</small>
          <h1>
            {r.score} / {r.total_marks}
          </h1>
        </div>
        <b>{r.status.replace('_', ' ')}</b>
      </div>
      {!r.is_demo && (
        <section className="card">
          <h2>Schedule standing</h2>
          {r.standing ? (
            <p>
              Rank <strong>{r.standing.rank}</strong> among {r.standing.count}{' '}
              submitted attempts. Equal scores share a rank.
            </p>
          ) : r.rank_eligible ? (
            <p>
              Your rank will appear after the schedule closes and all started
              attempts are graded.
            </p>
          ) : (
            <p>
              Ranking is unavailable for this schedule because it began before
              shared paper versions were recorded.
            </p>
          )}
          {!r.review_available && r.review_at && (
            <p>
              Answers and explanations will be released on{' '}
              {new Date(r.review_at).toLocaleString()}.
            </p>
          )}
          {((!r.standing && r.rank_eligible) || !r.review_available) && (
            <button onClick={d.reload}>Refresh result</button>
          )}
        </section>
      )}
      {[...new Set(r.items.map((q) => q.section_pos))].map((s) => {
        const items = r.items.filter((q) => q.section_pos === s)
        return (
          <section className="card" key={s}>
            <h2>
              {items[0].section} · {items.reduce((n, q) => n + q.earned, 0)} /{' '}
              {items.reduce((n, q) => n + q.marks, 0)}
            </h2>
            {items.map((q, i) => (
              <details className="review" key={q.question_id}>
                <summary>
                  {i + 1}. {q.prompt} · {q.earned} marks
                </summary>
                <p>
                  Your answer:{' '}
                  {q.selected_index == null
                    ? 'Unanswered'
                    : q.options[q.selected_index]}
                </p>
                <p>Correct answer: {q.options[q.correct_index]}</p>
                <p>{q.explanation}</p>
              </details>
            ))}
          </section>
        )
      })}
    </main>
  )
}
