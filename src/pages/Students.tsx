import { useState } from 'react'
import { db, unwrap, rpc } from '../lib/db'
import { readRows, csv } from '../lib/files'
import {
  Feedback,
  Loading,
  Title,
  fetchAll,
  useData,
  useTask,
} from '../components/Common'
import type { Profile } from '../types'
export function Students() {
  const d = useData(() =>
      fetchAll<Profile>((f, t) =>
        db
          .from('profiles')
          .select('*')
          .eq('role', 'student')
          .order('roll_no')
          .range(f, t),
      ),
    ),
    task = useTask(),
    [s, S] = useState(''),
    [filter, F] = useState('all'),
    [ids, I] = useState<string[]>([]),
    [group, G] = useState(''),
    [report, R] = useState<string[]>([])
  if (!d.data) return <Loading error={d.error} />
  const rows = d.data.filter(
    (p) =>
      (filter === 'all' || filter === p.status) &&
      [p.full_name, p.email, p.roll_no]
        .join(' ')
        .toLowerCase()
        .includes(s.toLowerCase()),
  )
  function update(keys: string[], status: string) {
    task.run(async () => {
      await unwrap(
        db
          .from('profiles')
          .update({ status })
          .in('id', keys)
          .eq('role', 'student'),
      )
      I([])
      d.reload()
    }, 'Student status updated')
  }
  return (
    <>
      <Title kicker="Administration" title="Students" />
      <div className="card tools">
        <input
          aria-label="Search students"
          placeholder="Search name, email or roll number"
          value={s}
          onChange={(e) => S(e.target.value)}
        />
        <select
          aria-label="Status filter"
          value={filter}
          onChange={(e) => F(e.target.value)}
        >
          {['all', 'pending', 'approved', 'rejected', 'blocked'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button
          disabled={!ids.length || task.busy}
          onClick={() => update(ids, 'approved')}
        >
          Approve selected ({ids.length})
        </button>
      </div>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all matching students"
                  checked={
                    !!rows.length && rows.every((p) => ids.includes(p.id))
                  }
                  onChange={(e) =>
                    I(e.target.checked ? rows.map((x) => x.id) : [])
                  }
                />
              </th>
              <th>Candidate</th>
              <th>Roll number</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    aria-label={'Select ' + p.full_name}
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
                </td>
                <td>
                  <b>{p.full_name}</b>
                  <small>{p.email}</small>
                </td>
                <td>{p.roll_no}</td>
                <td>{p.status}</td>
                <td>
                  <select
                    aria-label={'Change status of ' + p.full_name}
                    disabled={task.busy}
                    value={p.status}
                    onChange={(e) => update([p.id], e.target.value)}
                  >
                    {['pending', 'approved', 'rejected', 'blocked'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>No matching students.</p>}
      </div>
      <div className="two">
        <section className="card">
          <h2>Create a group</h2>
          <label>
            Group name
            <input value={group} onChange={(e) => G(e.target.value)} />
          </label>
          <button
            disabled={!group.trim() || !ids.length || task.busy}
            onClick={() =>
              task.run(async () => {
                await rpc('save_group', { label: group, members: ids })
                G('')
                I([])
              }, 'Group created')
            }
          >
            Group selected students
          </button>
        </section>
        <section className="card">
          <h2>Invite students from CSV</h2>
          <p>
            Invitations go to the addresses in your file. Imported students
            begin pending approval.
          </p>
          <button
            onClick={() =>
              csv('students.csv', [['full_name', 'email', 'roll_no', 'phone']])
            }
          >
            Download template
          </button>
          <label>
            Choose CSV to send invitations
            <input
              type="file"
              accept=".csv"
              disabled={task.busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f)
                  task.run(async () => {
                    const rows = await readRows(f)
                    const { data, error } = await db.functions.invoke(
                      'import-students',
                      { body: { rows } },
                    )
                    if (error) throw error
                    R(
                      data.results.map(
                        (v: { row: number; status: string }) =>
                          'Row ' + v.row + ' · ' + v.status,
                      ),
                    )
                    d.reload()
                  })
              }}
            />
          </label>
          {report.map((v, i) => (
            <p key={i}>{v}</p>
          ))}
        </section>
      </div>
      <Feedback {...task} />
    </>
  )
}
