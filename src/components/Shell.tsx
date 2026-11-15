import { NavLink, Outlet, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { BookOpenCheck, Moon, Sun, LogOut } from 'lucide-react'
import { useSession } from '../store/session'
import { db } from '../lib/db'
export function Theme() {
  const [dark, D] = useState(() => localStorage.getItem('cbt-theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('cbt-theme', dark ? 'dark' : 'light')
  }, [dark])
  return (
    <button
      aria-label={dark ? 'Use light theme' : 'Use dark theme'}
      title={dark ? 'Use light theme' : 'Use dark theme'}
      onClick={() => D(!dark)}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}
export function Shell() {
  const p = useSession((s) => s.profile)!,
    admin = p.role === 'admin' || p.role === 'super_admin'
  const nav = admin
    ? [
        ['', 'Overview'],
        ['users', 'User & Roles'],
        ['students', 'Students'],
        ['questions', 'Question bank'],
        ['review', 'Faculty submissions'],
        ['tests', 'Test papers'],
        ['schedules', 'Schedules'],
        ['results', 'Results'],
        ['proctoring', 'Proctoring'],
        ['settings', 'Settings'],
      ]
    : p.role === 'content_author'
      ? [['', 'My question drafts']]
      : [
          ['', 'Overview'],
          ['tests', 'Scheduled tests'],
          ['demo', 'Demo tests'],
          ['results', 'My results'],
        ]
  const root = admin ? '/admin' : '/' + p.role
  return (
    <>
      <header className="appbar">
        <Link className="brand" to={root}>
          <BookOpenCheck />
          CampusPrep <span>CBT</span>
        </Link>
        <div className="actions">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{p.full_name}</span>
            <span
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                textTransform: 'uppercase',
                fontWeight: 700,
                letterSpacing: '0.5px',
                backgroundColor:
                  p.role === 'super_admin'
                    ? '#7c3aed'
                    : p.role === 'admin'
                      ? '#2563eb'
                      : p.role === 'content_author'
                        ? '#059669'
                        : '#64748b',
                color: '#fff',
              }}
            >
              {p.role === 'super_admin'
                ? 'Super Admin'
                : p.role === 'admin'
                  ? 'Admin'
                  : p.role === 'content_author'
                    ? 'Faculty'
                    : 'Student'}
            </span>
          </div>
          <Theme />
          <button aria-label="Sign out" onClick={() => db.auth.signOut()}>
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <div className="layout">
        <aside className="side">
          <div className="eyebrow">
            {p.role === 'super_admin'
              ? 'Super Administration'
              : admin
                ? 'Administration'
                : p.role === 'content_author'
                  ? 'Faculty authoring'
                  : 'Candidate portal'}
          </div>
          <nav>
            {nav.map(([path, title]) => (
              <NavLink key={path} end to={root + (path ? '/' + path : '')}>
                {title}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </>
  )
}
