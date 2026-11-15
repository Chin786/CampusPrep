import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { Auth } from './pages/Auth'
import { Guard } from './components/Guard'
import { Shell, Theme } from './components/Shell'
import { Toast, Loading } from './components/Common'
import { Overview, Settings } from './pages/AdminOverview'
import { UserManagement } from './pages/UserManagement'
import { Students } from './pages/Students'
import { QuestionReview } from './pages/QuestionReview'
import { Questions } from './pages/Questions'
import { Tests } from './pages/Tests'
import { Scheduling } from './pages/Scheduling'
import { Reports, ProctorReport } from './pages/Reports'
import { Student, Instructions, Result } from './pages/Student'
import { Exam } from './pages/Exam'
import { useSession } from './store/session'
import { db, configured } from './lib/db'
import './style.css'
function Home() {
  const s = useSession()
  if (s.loading || s.error) return <Loading error={s.error} />
  if (!s.profile) return <Navigate replace to="/login" />
  const target =
    s.profile.role === 'super_admin' || s.profile.role === 'admin'
      ? '/admin'
      : '/' + s.profile.role
  return <Navigate replace to={target} />
}
function App() {
  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      localStorage.getItem('cbt-theme') === 'dark',
    )
    const refresh = () => {
      void useSession.getState().refresh()
    }
    refresh()
    const { data } = db.auth.onAuthStateChange(() => {
      setTimeout(refresh, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        {(['login', 'register', 'forgot', 'reset'] as const).map((mode) => (
          <Route
            key={mode}
            path={'/' + mode}
            element={
              <>
                <div className="auth-top">
                  <strong>CampusPrep CBT</strong>
                  <Theme />
                </div>
                {!configured && (
                  <p className="config-note">
                    Setup required. Connect Supabase in Bolt and set the
                    frontend environment variables to enable sign-in.
                  </p>
                )}
                <Auth key={mode} mode={mode} />
              </>
            }
          />
        ))}
        <Route element={<Guard allowedRoles={['admin', 'super_admin']} />}>
          <Route path="/admin" element={<Shell />}>
            <Route index element={<Overview />} />
            <Route path="users" element={<UserManagement />} />
            <Route path="students" element={<Students />} />
            <Route path="questions" element={<Questions />} />
            <Route path="review" element={<QuestionReview reviewing />} />
            <Route path="tests" element={<Tests />} />
            <Route path="schedules" element={<Scheduling />} />
            <Route path="results" element={<Reports />} />
            <Route path="proctoring" element={<ProctorReport />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="/admin/result/:id" element={<Result />} />
        </Route>
        <Route element={<Guard role="content_author" />}>
          <Route path="/content_author" element={<Shell />}>
            <Route index element={<QuestionReview />} />
          </Route>
        </Route>
        <Route element={<Guard role="student" />}>
          <Route path="/student" element={<Shell />}>
            <Route index element={<Student />} />
            {['demo', 'tests', 'results'].map((m) => (
              <Route key={m} path={m} element={<Student mode={m} />} />
            ))}
          </Route>
          <Route path="/instructions/:id" element={<Instructions />} />
          <Route path="/exam/:id" element={<Exam />} />
          <Route path="/result/:id" element={<Result />} />
        </Route>
        <Route
          path="*"
          element={
            <main className="center">
              <h1>Page unavailable</h1>
              <Link to="/">Return to dashboard</Link>
            </main>
          }
        />
      </Routes>
      <Toast />
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
