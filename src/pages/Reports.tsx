import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db, rpc } from '../lib/db'
import {
  useData,
  Title,
  Loading,
  fetchAll,
  useTask,
  Feedback,
} from '../components/Common'
import { csv } from '../lib/files'
type Row = Record<string, string | number>
const reports = {
  leaderboard: {
    title: 'Leaderboard',
    cols: ['rank', 'roll_no', 'full_name', 'score', 'status', 'warning_count'],
  },
  sections: {
    title: 'Section scores',
    cols: ['roll_no', 'full_name', 'section', 'score', 'possible'],
  },
  questions: {
    title: 'Question analysis',
    cols: [
      'section',
      'prompt',
      'candidates',
      'correct',
      'incorrect',
      'skipped',
    ],
  },
} as const
export function Reports() {
  const exportTask = useTask(),
    [params] = useSearchParams(),
    [id, I] = useState(params.get('schedule') || ''),
    [view, V] = useState<keyof typeof reports>('leaderboard'),
    d = useData(() =>
      fetchAll<{ id: string; start_at: string; paper_title: string }>(
        (f, t) =>
          db
            .from('schedules')
            .select('id,start_at,paper_title')
            .order('start_at', { ascending: false })
            .range(f, t) as never,
      ),
    ),
    r = useData(
      async () =>
        id
          ? ((await rpc('schedule_report', { schedule: id })) as Record<
              keyof typeof reports,
              Row[]
            >)
          : null,
      id,
    )
  if (!d.data) return <Loading error={d.error} />
  return (
    <>
      <Title kicker="Results and reporting" title="Schedule reports" />
      <section className="card noprint">
        <label>
          Schedule
          <select value={id} onChange={(e) => I(e.target.value)}>
            <option value="">Select a scheduled test</option>
            {d.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.paper_title} · {new Date(s.start_at).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        {id && (
          <div className="tools">
            {(Object.keys(reports) as (keyof typeof reports)[]).map((k) => (
              <button key={k} aria-pressed={k === view} onClick={() => V(k)}>
                {reports[k].title}
              </button>
            ))}
            <button
              disabled={!r.data}
              onClick={() => {
                const cols = reports[view].cols
                csv(view + '.csv', [
                  [...cols],
                  ...r.data![view].map((row) => cols.map((k) => row[k])),
                ])
              }}
            >
              Export CSV
            </button>
            <button
              disabled={!r.data || exportTask.busy}
              onClick={() =>
                exportTask.run(async () => {
                  const { downloadReportPdf } = await import('../lib/reportPdf')
                  const schedule = d.data!.find((s) => s.id === id)!
                  downloadReportPdf(
                    reports[view].title,
                    schedule.paper_title +
                      ' - ' +
                      new Date(schedule.start_at).toLocaleString(),
                    reports[view].cols,
                    r.data![view],
                  )
                })
              }
            >
              Export PDF
            </button>
            <button disabled={!r.data} onClick={() => window.print()}>
              Print
            </button>
          </div>
        )}
        <Feedback {...exportTask} />
      </section>
      {id &&
        (r.data ? (
          <section className="card scroll">
            <h2>{reports[view].title}</h2>
            <p>
              {d.data.find((s) => s.id === id)?.paper_title} ·{' '}
              {new Date(
                d.data.find((s) => s.id === id)?.start_at || '',
              ).toLocaleString()}
            </p>
            <table>
              <thead>
                <tr>
                  {reports[view].cols.map((c) => (
                    <th key={c}>{c.replaceAll('_', ' ')}</th>
                  ))}
                  {view === 'leaderboard' && <th>Review</th>}
                </tr>
              </thead>
              <tbody>
                {r.data[view].map((row, i) => (
                  <tr key={i}>
                    {reports[view].cols.map((c) => (
                      <td key={c}>{row[c]}</td>
                    ))}
                    {view === 'leaderboard' && (
                      <td>
                        <Link to={'/admin/result/' + row.id}>Review</Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!r.data[view].length && <p>No submitted attempts yet.</p>}
          </section>
        ) : (
          <Loading error={r.error} />
        ))}
    </>
  )
}
type Monitor = {
  id: string
  title: string
  warning_count: number
  warning_limit: number
  status: string
  profiles: { full_name: string; roll_no: string }
  violations: {
    id: string
    type: string
    occurred_at: string
    meta: { detail?: string }
  }[]
}
export function ProctorReport() {
  const [flag, F] = useState(false),
    [q, Q] = useState(''),
    d = useData(() =>
      fetchAll<Monitor>(
        (f, t) =>
          db
            .from('attempts')
            .select(
              'id,title,warning_count,warning_limit,status,profiles(full_name,roll_no),violations(id,type,occurred_at,meta)',
            )
            .gt('warning_count', 0)
            .order('started_at', { ascending: false })
            .range(f, t) as never,
      ),
    )
  if (!d.data) return <Loading error={d.error} />
  const rows = d.data.filter(
    (r) =>
      (!flag || r.warning_count >= r.warning_limit) &&
      [r.title, r.profiles.full_name, r.profiles.roll_no]
        .join(' ')
        .toLowerCase()
        .includes(q.toLowerCase()),
  )
  return (
    <>
      <Title kicker="Invigilation" title="Proctoring report">
        <button onClick={d.reload}>Refresh</button>
      </Title>
      <div className="card tools">
        <input
          aria-label="Search attempts"
          placeholder="Search test, candidate or roll number"
          value={q}
          onChange={(e) => Q(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={flag}
            onChange={(e) => F(e.target.checked)}
          />
          Flagged attempts only
        </label>
      </div>
      <div className="card">
        {rows.map((r) => (
          <details className="review" key={r.id}>
            <summary>
              {r.profiles.full_name} · {r.profiles.roll_no} · {r.title} ·{' '}
              {r.warning_count}/{r.warning_limit} warnings{' '}
              {r.warning_count >= r.warning_limit ? ' · Flagged' : ''}
            </summary>
            {r.violations
              .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
              .map((v) => (
                <p key={v.id}>
                  <b>{v.type.replaceAll('_', ' ')}</b> ·{' '}
                  {new Date(v.occurred_at).toLocaleString()}
                  <small>{v.meta.detail}</small>
                </p>
              ))}
          </details>
        ))}
        {!rows.length && <p>No matching violations.</p>}
      </div>
    </>
  )
}
