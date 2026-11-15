import { useState, useRef, useEffect, useCallback } from 'react'
import { rpc, errorText } from '../lib/db'
import type { Paper, State } from '../types'
type Edit = {
  op_id: string
  question_id: string
  choice: number | null
  state: State
  expected_rev: number
  order: number
}
type Violation = {
  event_id: string
  type: string
  meta: Record<string, unknown>
  order: number
}
type Pending = { answers: Edit[]; events: Violation[] }
export function useAttempt(id: string, onClosed: () => void) {
  const key = 'cbt-pending-' + id,
    [paper, P] = useState<Paper | null>(null),
    [error, E] = useState(''),
    [message, M] = useState(''),
    [pending, Count] = useState(0),
    [left, Left] = useState(0),
    [warning, W] = useState(0),
    [tick, T] = useState(0)
  const current = useRef<Paper | null>(null),
    queue = useRef<Pending>({ answers: [], events: [] }),
    until = useRef(0),
    sequence = useRef(0),
    busy = useRef(false),
    alive = useRef(true),
    closed = useRef(onClosed),
    ready = useRef(false)
  closed.current = onClosed
  function persist() {
    const size = queue.current.answers.length + queue.current.events.length
    Count(size)
    try {
      if (size) localStorage.setItem(key, JSON.stringify(queue.current))
      else localStorage.removeItem(key)
    } catch {
      M(
        'Device storage is unavailable. Keep this tab open until changes are saved.',
      )
    }
  }
  function paint(base: Paper) {
    let items = base.items.map((x) => ({ ...x }))
    for (const e of queue.current.answers) {
      const row = items.find((q) => q.question_id === e.question_id)
      if (row) {
        row.selected_index = e.choice
        row.status = e.state
      }
    }
    P({ ...base, items })
  }
  function end() {
    ready.current = false
    queue.current = { answers: [], events: [] }
    persist()
    closed.current()
  }
  async function sync(refresh = false, heartbeat = false) {
    if (busy.current || !alive.current) return false
    busy.current = true
    try {
      while (
        alive.current &&
        (queue.current.events.length || queue.current.answers.length)
      ) {
        const v = queue.current.events[0],
          first = queue.current.answers[0]
        if (v && (!first || v.order < first.order)) {
          const result = await rpc('log_violation', {
            attempt_id: id,
            event_id: v.event_id,
            kind: v.type,
            details: v.meta,
          })
          if (!alive.current) return false
          if (result.closed) {
            if (result.warning_count)
              sessionStorage.setItem(
                'cbt-final-warning-' + id,
                String(result.warning_count),
              )
            end()
            return false
          }
          queue.current.events.shift()
          W(result.warning_count)
          if (current.current)
            current.current.warning_count = result.warning_count
          persist()
          continue
        }
        const op = queue.current.answers[0]
        const r = await rpc('save_response', {
          attempt_id: id,
          op_id: op.op_id,
          question_id: op.question_id,
          choice: op.choice,
          state: op.state,
          expected_rev: op.expected_rev,
        })
        if (!alive.current) return false
        if (r.closed) {
          end()
          return false
        }
        if (r.conflict) {
          queue.current.answers = queue.current.answers.filter(
            (e) => e.question_id !== op.question_id,
          )
          refresh = true
          M(
            'A newer answer from another session was kept. Review that question.',
          )
        } else {
          queue.current.answers.shift()
          const row = current.current?.items.find(
            (q) => q.question_id === op.question_id,
          )
          if (row) {
            row.rev = r.rev
            row.selected_index = op.choice
            row.status = op.state
          }
        }
        persist()
      }
      if (heartbeat && !refresh && current.current) {
        const start = performance.now()
        const state = await rpc('attempt_heartbeat', { attempt_id: id })
        if (!alive.current) return false
        if (state.status !== 'in_progress') {
          end()
          return false
        }
        until.current = start + state.remaining_seconds * 1000
        Left(Math.max(0, Math.ceil((until.current - performance.now()) / 1000)))
        current.current.warning_count = state.warning_count
        refresh =
          state.revision_sum !==
          current.current.items.reduce((sum, item) => sum + item.rev, 0)
      }
      if (refresh || !current.current) {
        const start = performance.now(),
          p = (await rpc('get_test_paper', { attempt_id: id })) as Paper
        if (!alive.current) return false
        if (p.status !== 'in_progress') {
          end()
          return false
        }
        current.current = p
        until.current = start + p.remaining_seconds * 1000
        Left(Math.max(0, Math.ceil((until.current - performance.now()) / 1000)))
        ready.current = true
      }
      if (current.current) paint(current.current)
      E('')
      return true
    } catch (e) {
      if (alive.current) E(errorText(e))
      return false
    } finally {
      busy.current = false
    }
  }
  const latest = useRef(sync)
  latest.current = sync
  useEffect(() => {
    alive.current = true
    try {
      queue.current = JSON.parse(
        localStorage.getItem(key) || '{"events":[],"answers":[]}',
      )
    } catch {
      queue.current = { events: [], answers: [] }
    }
    sequence.current = [
      ...queue.current.answers,
      ...queue.current.events,
    ].reduce((n, e) => Math.max(n, e.order || 0), 0)
    persist()
    void latest.current(true)
    const reconnect = () => void latest.current(true)
    window.addEventListener('online', reconnect)
    const timer = setInterval(() => {
        if (ready.current)
          Left(
            Math.max(0, Math.ceil((until.current - performance.now()) / 1000)),
          )
      }, 300),
      poll = setInterval(() => void latest.current(false, true), 10000)
    return () => {
      alive.current = false
      clearInterval(timer)
      clearInterval(poll)
      window.removeEventListener('online', reconnect)
    }
  }, [id])
  useEffect(() => {
    if (!ready.current || left !== 0) return
    let active = true
    const submitExpired = async () => {
      if (busy.current || !alive.current) return
      busy.current = true
      try {
        const p = await rpc('attempt_heartbeat', { attempt_id: id })
        if (!active || !alive.current) return
        if (p.status !== 'in_progress') end()
        else {
          until.current = performance.now() + p.remaining_seconds * 1000
          Left(p.remaining_seconds)
        }
      } catch (e) {
        if (active && alive.current) E(errorText(e))
      } finally {
        busy.current = false
      }
    }
    void submitExpired()
    const retry = setInterval(() => void submitExpired(), 1500)
    return () => {
      active = false
      clearInterval(retry)
    }
  }, [left, tick, id])
  function save(q: string, choice: number | null, state: State) {
    if (
      !ready.current ||
      performance.now() >= until.current ||
      !current.current
    )
      return
    const row = current.current.items.find((x) => x.question_id === q)!
    const expected =
      row.rev + queue.current.answers.filter((x) => x.question_id === q).length
    queue.current.answers.push({
      question_id: q,
      choice,
      state,
      expected_rev: expected,
      order: ++sequence.current,
      op_id: crypto.randomUUID(),
    })
    persist()
    paint(current.current)
    void sync()
  }
  const log = useCallback(
    (type: string, meta: Record<string, unknown> = {}) => {
      if (!ready.current || performance.now() >= until.current) return
      queue.current.events.push({
        type,
        meta,
        order: ++sequence.current,
        event_id: crypto.randomUUID(),
      })
      persist()
      void latest.current()
    },
    [id],
  )
  async function finish() {
    if (!(await sync())) return false
    try {
      await rpc('submit_attempt', { attempt_id: id })
      end()
      return true
    } catch (e) {
      E(errorText(e))
      return false
    }
  }
  return {
    paper,
    error,
    message,
    pending,
    left,
    warning,
    dismiss: () => W(0),
    save,
    log,
    finish,
    retry: () => {
      T((v) => v + 1)
      void sync(true)
    },
  }
}
