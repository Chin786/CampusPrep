import { db, unwrap } from '../lib/db'
import {
  useData,
  useTask,
  Title,
  Feedback,
  Loading,
} from '../components/Common'
import { Link } from 'react-router-dom'
export function Overview() {
  const d = useData(async () => {
    const counts = await Promise.all([
      db
        .from('profiles')
        .select('id', { head: true, count: 'exact' })
        .eq('role', 'student'),
      db.from('tests').select('id', { head: true, count: 'exact' }),
      db
        .from('schedules')
        .select('id', { head: true, count: 'exact' })
        .gte('start_at', new Date().toISOString()),
      db
        .from('violations')
        .select('id', { head: true, count: 'exact' })
        .gte('occurred_at', new Date(Date.now() - 86400000).toISOString()),
    ])
    for (const c of counts) if (c.error) throw c.error
    const next = await unwrap(
      db
        .from('schedules')
        .select('id,start_at,end_at,paper_title')
        .gte('end_at', new Date().toISOString())
        .order('start_at')
        .limit(8),
    )
    const logs = await unwrap(
      db
        .from('violations')
        .select('id,type,occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(5),
    )
    return { counts: counts.map((c) => c.count || 0), next, logs }
  })
  if (!d.data) return <Loading error={d.error} />
  return (
    <>
      <Title kicker="Exam administration" title="Assessment overview">
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="button" to="/admin/users">
            User & Roles
          </Link>
          <Link className="button" to="/admin/tests">
            Manage test papers
          </Link>
        </div>
      </Title>
      <div className="metrics">
        {[
          'Students',
          'Test papers',
          'Upcoming schedules',
          'Warnings in 24 hours',
        ].map((x, i) => (
          <div className="metric" key={x}>
            <small>{x}</small>
            <b>{d.data!.counts[i]}</b>
          </div>
        ))}
      </div>
      <div className="two">
        <section className="card">
          <h2>Exam timetable</h2>
          {!d.data.next.length && <p>No upcoming or open schedules.</p>}
          {d.data.next.map((s) => (
            <div className="listrow" key={s.id}>
              <div>
                <b>{s.paper_title}</b>
                <small>{new Date(s.start_at).toLocaleString()}</small>
              </div>
              <Link to="/admin/schedules">View</Link>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Recent proctoring events</h2>
          {!d.data.logs.length && <p>No browser warnings recorded.</p>}
          {d.data.logs.map((l) => (
            <p key={l.id}>
              {l.type.replaceAll('_', ' ')}
              <small>{new Date(l.occurred_at).toLocaleString()}</small>
            </p>
          ))}
          <Link to="/admin/proctoring">Open proctoring report →</Link>
        </section>
      </div>
    </>
  )
}
export function Settings() {
  const d = useData(() =>
      unwrap<{ require_seb: boolean }>(
        db.from('settings').select('require_seb').single(),
      ),
    ),
    task = useTask()
  return (
    <>
      <Title kicker="Centre administration" title="Exam settings" />
      <section className="card">
        <h2>Browser and workstation controls</h2>
        <p>
          The exam records events exposed by the browser. Students may use
          another device or OS shortcuts that never reach the page. A warning is
          an observation for the invigilator to review.
        </p>
        <p>
          For workstation lockdown, configure Safe Exam Browser or Windows kiosk
          mode at the centre. The SEB option checks the browser’s user-agent
          string; it cannot authenticate the workstation configuration.
        </p>
        <p>
          For a second TFT, the centre administrator can select{' '}
          <b>Win + P → Duplicate</b> in Windows. The web app cannot configure or
          reliably detect mirrored outputs.
        </p>
        {d.data ? (
          <label className="check">
            <input
              type="checkbox"
              disabled={task.busy}
              checked={d.data.require_seb}
              onChange={(e) => {
                const value = e.target.checked
                task.run(async () => {
                  await unwrap(
                    db
                      .from('settings')
                      .update({ require_seb: value })
                      .eq('id', true),
                  )
                  d.reload()
                }, 'Default updated')
              }}
            />
            Require Safe Exam Browser for demos and by default for new schedules
          </label>
        ) : (
          <Loading error={d.error} />
        )}
        <Feedback {...task} />
      </section>
    </>
  )
}
