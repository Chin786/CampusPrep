import { useState } from 'react'
import { db, rpc, unwrap } from '../lib/db'
import {
  Feedback,
  Loading,
  Title,
  fetchAll,
  useData,
  useTask,
} from '../components/Common'
import { questionSchema, type Q } from './Questions'
import type { Profile } from '../types'

type Content = Omit<Q, 'id'>
type Draft = {
  id: string
  author_id: string
  payload: Content
  state: 'draft' | 'submitted' | 'changes_requested' | 'published'
  feedback: string
  revision: number
}
const empty: Content = {
  subject_id: '',
  section_name: '',
  question_text: '',
  options: ['', '', '', ''],
  correct_index: 0,
  explanation: '',
  marks: 2,
  negative_marks: 0,
  difficulty: 'medium',
  image_url: null,
}
const states = {
  draft: 'Draft',
  submitted: 'Awaiting review',
  changes_requested: 'Changes requested',
  published: 'Published',
}
type Staff = Pick<Profile, 'id' | 'role' | 'full_name' | 'roll_no'>

export function QuestionReview({ reviewing = false }: { reviewing?: boolean }) {
  const data = useData(async () => {
    const [subjects, drafts, staff] = await Promise.all([
      unwrap<{ id: string; name: string }[]>(
        db.from('subjects').select('id,name').order('name'),
      ),
      fetchAll<Draft>((f, t) =>
        db
          .from('question_drafts')
          .select('*')
          .order('updated_at', { ascending: false })
          .order('id')
          .range(f, t),
      ),
      reviewing
        ? fetchAll<Staff>((f, t) =>
            db
              .from('profiles')
              .select('id,role,full_name,roll_no')
              .eq('status', 'approved')
              .in('role', ['student', 'content_author'])
              .order('roll_no')
              .range(f, t),
          )
        : Promise.resolve([]),
    ])
    return { subjects, drafts, staff }
  }, String(reviewing))
  const task = useTask(),
    [form, setForm] = useState<Content>(empty),
    [editing, setEditing] = useState<Draft | null>(null),
    [open, setOpen] = useState(false),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [account, setAccount] = useState('')
  if (!data.data) return <Loading error={data.error} />
  const { subjects, drafts, staff } = data.data
  const selected = staff.find((p) => p.id === account)
  function edit(draft?: Draft) {
    setForm(draft?.payload ?? { ...empty, subject_id: subjects[0]?.id || '' })
    setEditing(draft || null)
    setOpen(true)
  }
  function change<K extends keyof Content>(field: K, value: Content[K]) {
    setForm((old) => ({ ...old, [field]: value }))
  }
  function save(submit: boolean) {
    return task.run(
      async () => {
        const value = submit
          ? questionSchema.parse(form)
          : { ...form, subject_id: form.subject_id || null }
        await rpc('save_question_draft', {
          draft_id: editing?.id || null,
          contents: value,
          send_for_review: submit,
          expected_revision: editing?.revision ?? null,
        })
        setOpen(false)
        data.reload()
      },
      submit ? 'Question sent for review' : 'Draft saved',
    )
  }
  function decide(draft: Draft, approve: boolean) {
    return task.run(
      async () => {
        await rpc('review_question_draft', {
          draft_id: draft.id,
          approve,
          note: notes[draft.id] || '',
          expected_revision: draft.revision,
        })
        data.reload()
      },
      approve ? 'Question published to the bank' : 'Changes requested',
    )
  }
  const visible = reviewing ? drafts.filter((d) => d.state !== 'draft') : drafts
  return (
    <>
      <Title
        kicker={reviewing ? 'Assessment design' : 'Faculty authoring'}
        title={reviewing ? 'Faculty submissions' : 'My question drafts'}
      >
        {!reviewing && !open && (
          <button className="primary" onClick={() => edit()}>
            Draft a question
          </button>
        )}
      </Title>
      <Feedback {...task} />
      {reviewing && (
        <details className="card">
          <summary>Manage faculty author access</summary>
          <p>
            Choose an approved faculty account to grant or remove author access.
            Faculty submit questions for administrator review.
          </p>
          <label>
            Account
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">Choose an account</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} · {p.roll_no} ·{' '}
                  {p.role === 'content_author' ? 'Author' : 'Student'}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <button
              disabled={task.busy}
              onClick={() =>
                task.run(async () => {
                  await rpc('set_content_author', {
                    account_id: selected.id,
                    enabled: selected.role !== 'content_author',
                  })
                  setAccount('')
                  data.reload()
                }, 'Access updated')
              }
            >
              {selected.role === 'content_author'
                ? 'Restore student access'
                : 'Grant author access'}
            </button>
          )}
        </details>
      )}
      {!reviewing && open && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            void save(true)
          }}
        >
          <h2>{editing ? 'Edit question' : 'New question'}</h2>
          {editing?.feedback && <p>Reviewer feedback · {editing.feedback}</p>}
          <div className="two">
            <label>
              Subject
              <select
                value={form.subject_id || ''}
                onChange={(e) => change('subject_id', e.target.value)}
              >
                <option value="">Select subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Section
              <input
                value={form.section_name}
                onChange={(e) => change('section_name', e.target.value)}
              />
            </label>
          </div>
          <label>
            Question
            <textarea
              value={form.question_text}
              onChange={(e) => change('question_text', e.target.value)}
              required
            />
          </label>
          <div className="two">
            {form.options.map((val, i) => (
              <label key={i}>
                Option {String.fromCharCode(65 + i)}
                <input
                  value={val}
                  onChange={(e) =>
                    change(
                      'options',
                      form.options.map((o, j) =>
                        j === i ? e.target.value : o,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <div className="two">
            <label>
              Correct option
              <select
                value={form.correct_index}
                onChange={(e) => change('correct_index', +e.target.value)}
              >
                {['A', 'B', 'C', 'D'].map((x, i) => (
                  <option value={i} key={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Difficulty
              <select
                value={form.difficulty}
                onChange={(e) =>
                  change('difficulty', e.target.value as Content['difficulty'])
                }
              >
                {['easy', 'medium', 'hard'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Explanation
            <textarea
              value={form.explanation}
              onChange={(e) => change('explanation', e.target.value)}
            />
          </label>
          <div className="two">
            <label>
              Marks
              <input
                type="number"
                step="any"
                value={form.marks}
                onChange={(e) => change('marks', +e.target.value)}
              />
            </label>
            <label>
              Deduction for a wrong answer
              <input
                type="number"
                step="any"
                value={form.negative_marks}
                onChange={(e) => change('negative_marks', +e.target.value)}
              />
            </label>
          </div>
          {!subjects.length && (
            <p>
              Ask an administrator to create a subject before sending the
              question for review.
            </p>
          )}
          <div className="tools">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={task.busy || !form.question_text.trim()}
              onClick={() => save(false)}
            >
              Save draft
            </button>
            <button
              className="primary"
              disabled={task.busy || !subjects.length}
            >
              Send for review
            </button>
          </div>
        </form>
      )}
      <section className="card">
        <h2>{reviewing ? 'Review queue and history' : 'Submissions'}</h2>
        {!visible.length && (
          <p>
            {reviewing
              ? 'No faculty submissions yet.'
              : 'Your drafts and reviewer feedback will appear here.'}
          </p>
        )}
        {visible.map((d) => (
          <details className="review" key={d.id}>
            <summary>
              {d.payload.question_text} · {states[d.state]}
            </summary>
            {reviewing && (
              <p>
                Author ·{' '}
                {staff.find((p) => p.id === d.author_id)?.full_name ||
                  'Former faculty account'}
              </p>
            )}
            <p>
              {subjects.find((s) => s.id === d.payload.subject_id)?.name} ·{' '}
              {d.payload.section_name} · {d.payload.difficulty} ·{' '}
              {d.payload.marks} marks · {d.payload.negative_marks} deduction
            </p>
            <ol
              type="A"
              style={{
                listStyleType: 'upper-alpha',
                paddingInlineStart: '2rem',
              }}
            >
              {d.payload.options.map((o, i) => (
                <li key={i}>
                  {o}
                  {i === d.payload.correct_index ? ' (correct)' : ''}
                </li>
              ))}
            </ol>
            <p>{d.payload.explanation}</p>
            {d.feedback && <p>Reviewer feedback · {d.feedback}</p>}
            {!reviewing && ['draft', 'changes_requested'].includes(d.state) && (
              <button onClick={() => edit(d)}>Edit draft</button>
            )}
            {reviewing && d.state === 'submitted' && (
              <>
                <label>
                  Feedback
                  <textarea
                    value={notes[d.id] || ''}
                    onChange={(e) =>
                      setNotes({ ...notes, [d.id]: e.target.value })
                    }
                  />
                </label>
                <div className="tools">
                  <button
                    disabled={task.busy || !notes[d.id]?.trim()}
                    onClick={() => decide(d, false)}
                  >
                    Request changes
                  </button>
                  <button
                    className="primary"
                    disabled={task.busy}
                    onClick={() => decide(d, true)}
                  >
                    Approve and publish
                  </button>
                </div>
              </>
            )}
          </details>
        ))}
      </section>
    </>
  )
}
