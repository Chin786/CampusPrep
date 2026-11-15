import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { errorText } from '../lib/db'
export const useToast = create<{ text: string; send: (s: string) => void }>(
  (set) => ({ text: '', send: (text) => set({ text }) }),
)
export function Toast() {
  const { text, send } = useToast()
  useEffect(() => {
    if (text) {
      const t = setTimeout(() => send(''), 5000)
      return () => clearTimeout(t)
    }
  }, [text, send])
  return text ? (
    <div className="toast" role="status">
      {text}
    </div>
  ) : null
}
export function useTask() {
  const [busy, set] = useState(false),
    [error, err] = useState('')
  const lock = useRef(false)
  async function run(fn: () => Promise<unknown>, success = '') {
    if (lock.current) return
    lock.current = true
    set(true)
    err('')
    try {
      await fn()
      if (success) useToast.getState().send(success)
    } catch (e) {
      err(errorText(e))
    } finally {
      lock.current = false
      set(false)
    }
  }
  return { run, busy, error }
}
export function useData<T>(load: () => Promise<T>, key = '') {
  const [data, set] = useState<T | null>(null),
    [error, err] = useState(''),
    [v, inc] = useState(0)
  useEffect(() => {
    let alive = true
    set(null)
    err('')
    load()
      .then((d) => {
        if (alive) set(d)
      })
      .catch((e) => {
        if (alive) err(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [key, v])
  return { data, error, reload: () => inc((i) => i + 1) }
}
export function Feedback({ error, busy }: { error?: string; busy?: boolean }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : busy ? (
    <p role="status" className="muted">
      Working…
    </p>
  ) : null
}
export function Loading({ error }: { error?: string }) {
  return (
    <div role="status" className="card">
      {error || 'Loading…'}
    </div>
  )
}
export function Title({
  kicker,
  title,
  children,
}: {
  kicker: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="title-row">
      <div>
        <div className="eyebrow">{kicker}</div>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  )
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string
  children: ReactNode
  close?: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        close?.()
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  )
}
export async function fetchAll<T>(
  builder: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = []
  for (let n = 0; ; n += 500) {
    const r = await builder(n, n + 499)
    if (r.error) throw Error(r.error.message)
    rows.push(...(r.data || []))
    if ((r.data?.length || 0) < 500) return rows
  }
}
