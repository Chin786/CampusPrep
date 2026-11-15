import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../store/session'
import { db } from '../lib/db'
import type { Profile } from '../types'
import { Loading } from './Common'
export function Guard({
  role,
  allowedRoles,
}: {
  role?: Profile['role']
  allowedRoles?: Profile['role'][]
}) {
  const s = useSession(),
    location = useLocation()
  if (s.loading || s.error) return <Loading error={s.error} />
  if (!s.profile)
    return (
      <Navigate
        replace
        to={
          '/login?next=' +
          encodeURIComponent(location.pathname + location.search)
        }
      />
    )
  if (s.profile.status !== 'approved')
    return (
      <main className="center">
        <div className="card">
          <h1>Account {s.profile.status}</h1>
          <p>
            {s.profile.status === 'pending'
              ? 'Your registration is awaiting administrator approval.'
              : 'Contact the exam administrator about your account status.'}
          </p>
          <div className="actions">
            <button onClick={s.refresh}>Refresh status</button>
            <button onClick={() => db.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </main>
    )
  const allowed = allowedRoles ? [...allowedRoles] : role ? [role] : []
  if (allowed.includes('admin') && !allowed.includes('super_admin')) {
    allowed.push('super_admin')
  }
  if (!allowed.includes(s.profile.role)) {
    const target =
      s.profile.role === 'super_admin' || s.profile.role === 'admin'
        ? '/admin'
        : '/' + s.profile.role
    return <Navigate replace to={target} />
  }
  return <Outlet />
}
