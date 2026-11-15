import { useState } from 'react'
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { db, errorText, configured } from '../lib/db'
import { candidateReturnPath } from '../lib/returnPath'
import { useSession } from '../store/session'
import { sendEmail } from '../lib/email'
const labels = {
  full_name: 'Full name',
  email: 'Email address',
  roll_no: 'Roll number',
  phone: 'Phone number',
  password: 'Password',
}
type Fields = Record<keyof typeof labels, string>
const email = z.string().email(),
  password = z.string().min(8, 'Use at least 8 characters.')
export function Auth({
  mode,
}: {
  mode: 'login' | 'register' | 'forgot' | 'reset'
}) {
  const nav = useNavigate(),
    loc = useLocation(),
    [params] = useSearchParams(),
    next = candidateReturnPath(params.get('next')),
    suffix = next === '/' ? '' : '?next=' + encodeURIComponent(next),
    locationNotice =
      (loc.state as { notice?: string } | null)?.notice || '',
    [notice, setNotice] = useState(locationNotice),
    [error, setError] = useState('')
  const fields: (keyof Fields)[] =
    mode === 'register'
      ? ['full_name', 'roll_no', 'phone', 'email', 'password']
      : mode === 'forgot'
        ? ['email']
        : mode === 'reset'
          ? ['password']
          : ['email', 'password']
  const schema = z.object({
    ...(fields.includes('email') ? { email } : {}),
    ...(fields.includes('password') ? { password } : {}),
    ...(mode === 'register'
      ? {
          full_name: z.string().trim().min(2).max(120),
          roll_no: z
            .string()
            .regex(
              /^[a-z0-9][a-z0-9./_-]{2,49}$/i,
              'Enter a valid roll number.',
            ),
          phone: z
            .string()
            .regex(/^[+0-9 ()-]{7,20}$/, 'Enter a valid phone number.'),
        }
      : {}),
  })
  const form = useForm<Fields>({ resolver: zodResolver(schema) }),
    title = {
      login: 'Sign in',
      register: 'Create an account',
      forgot: 'Reset your password',
      reset: 'Choose a new password',
    }[mode]
  const send = form.handleSubmit(async (f) => {
    setNotice('')
    setError('')
    try {
      if (!configured)
        throw Error('Connect your Supabase project to enable accounts.')
      if (mode === 'register') {
        const r = await db.auth.signUp({
          email: f.email,
          password: f.password,
          options: {
            data: {
              full_name: f.full_name,
              roll_no: f.roll_no,
              phone: f.phone,
            },
            emailRedirectTo: window.location.origin + '/login' + suffix,
          },
        })
        if (r.error) throw r.error

        // Send confirmation/welcome notification via Nodemailer
        void sendEmail({
          to: f.email,
          subject: 'Registration Confirmation - CampusPrep CBT',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #1e293b; margin-top: 0;">Account Created Successfully</h2>
              <p>Hello <strong>${f.full_name}</strong>,</p>
              <p>Your registration for <strong>CampusPrep CBT</strong> has been received with Roll Number <strong>${f.roll_no}</strong>.</p>
              <p>Your placement officer will review and approve your account. Once approved, you can sign in to view and start scheduled mock exams.</p>
              <div style="margin: 24px 0;">
                <a href="${window.location.origin}/login" style="background: #2563eb; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Go to Sign In
                </a>
              </div>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="color: #64748b; font-size: 12px; margin: 0;">CampusPrep Computer-Based Examination System</p>
            </div>
          `,
        })

        nav('/login' + suffix, {
          state: {
            notice:
              'Account created successfully! Check your email to verify your account, then sign in below.',
          },
        })
        return
      }
      if (mode === 'forgot') {
        const r = await db.auth.resetPasswordForEmail(f.email, {
          redirectTo: location.origin + '/reset',
        })
        if (r.error) throw r.error
        setNotice(
          'If this address has an account, check your inbox for a reset link.',
        )
      }
      if (mode === 'reset') {
        const r = await db.auth.updateUser({ password: f.password })
        if (r.error) throw r.error
        setNotice('Password updated.')
        nav('/')
      }
      if (mode === 'login') {
        const r = await db.auth.signInWithPassword(f)
        if (r.error) throw r.error
        await useSession.getState().refresh()
        const prof = useSession.getState().profile
        if (next && next !== '/') {
          nav(next)
        } else if (prof?.role === 'super_admin' || prof?.role === 'admin') {
          nav('/admin')
        } else if (prof?.role === 'content_author') {
          nav('/content_author')
        } else {
          nav('/student')
        }
      }
    } catch (e) {
      setError(errorText(e))
    }
  })
  return (
    <main className="auth-wrap">
      <section className="auth-brand">
        <div className="eyebrow">CampusPrep CBT</div>
        <h1>Examination centre</h1>
        <p>
          Access your assigned papers, practise the exam interface and review
          your results.
        </p>
        <div className="auth-pattern" aria-hidden="true">
          A　 B　 C　 D
        </div>
      </section>
      <section className="card auth-card">
        <h2>{title}</h2>
        <form onSubmit={send}>
          {fields.map((n) => (
            <label key={n}>
              {labels[n]}
              <input
                {...form.register(n)}
                type={
                  n === 'email'
                    ? 'email'
                    : n === 'password'
                      ? 'password'
                      : n === 'phone'
                        ? 'tel'
                        : 'text'
                }
                autoComplete={
                  n === 'password'
                    ? mode === 'login'
                      ? 'current-password'
                      : 'new-password'
                    : n === 'full_name'
                      ? 'name'
                      : n === 'email'
                        ? 'email'
                        : 'off'
                }
              />
              {form.formState.errors[n] && (
                <small className="error">
                  {form.formState.errors[n]?.message}
                </small>
              )}
            </label>
          ))}
          <button className="primary" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Please wait…' : title}
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <div className="links">
          {mode !== 'login' && (
            <Link to={'/login' + suffix}>Already have an account? Sign in</Link>
          )}
          {mode === 'login' && (
            <>
              <Link to={'/register' + suffix}>
                Don't have an account? Create an account / Sign up
              </Link>
              <Link to="/forgot">Forgot password?</Link>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
