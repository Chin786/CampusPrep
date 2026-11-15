import { useState } from 'react'
import { db, rpc, unwrap } from '../lib/db'
import { loadBank } from './Questions'
import {
  Feedback,
  Loading,
  Title,
  useData,
  useTask,
  fetchAll,
} from '../components/Common'
import type { Test } from '../types'
type Sec = { name: string; questions: string[] }
const initial = {
  title: '',
  description: '',
  duration_min: 60,
  instructions:
    'Read each question carefully. Select one answer. Review your responses before submitting.',
  is_demo: false,
}
export function Tests() {
  const d = useData(async () => ({
      ...(await loadBank()),
      tests: await fetchAll<Test>((f, t) =>
        db
          .from('tests')
          .select('*')
          .order('created_at', { ascending: false })
          .range(f, t),
      ),
    })),
    task = useTask(),
    [stage, Stage] = useState(-1),
    [form, F] = useState(initial),
    [id, Id] = useState(''),
    [sections, S] = useState<Sec[]>([]),
    [si, I] = useState(0),
    [subject, Sub] = useState(''),
    [diff, D] = useState(''),
    [num, N] = useState(3)
  if (!d.data) return <Loading error={d.error} />
  const data = d.data,
    current = sections[si],
    picked = sections.flatMap((s) => s.questions),
    available = data.qs.filter(
      (q) =>
        (!subject || q.subject_id === subject) &&
        (!diff || q.difficulty === diff),
    )
  function apply(i: number, changes: Partial<Sec>) {
    S((ss) => ss.map((s, j) => (j === i ? { ...s, ...changes } : s)))
  }
  function begin() {
    Id('')
    F(initial)
    S([{ name: 'Paper I', questions: [] }])
    I(0)
    Stage(0)
  }
  async function edit(t: Test, copy = false) {
    const secs = await unwrap(
      db
        .from('test_sections')
        .select('id,name')
        .eq('test_id', t.id)
        .order('position'),
    )
    const qs = await unwrap(
      db
        .from('test_questions')
        .select('section_id,question_id')
        .eq('test_id', t.id)
        .order('position'),
    )
    Id(copy ? '' : t.id)
    F(copy ? { ...t, title: t.title + ' (copy)', is_demo: false } : t)
    S(
      secs.map((s) => ({
        name: s.name,
        questions: qs
          .filter((q) => q.section_id === s.id)
          .map((q) => q.question_id),
      })),
    )
    I(0)
    Stage(0)
  }
  async function save(status: string) {
    await rpc('save_test', {
      details: { ...form, id: id || null, status },
      sections,
    })
    Stage(-1)
    d.reload()
  }
  return (
    <>
      <Title
        kicker="Assessment design"
        title={
          stage < 0 ? 'Test papers' : id ? 'Edit test paper' : 'Create a test'
        }
      >
        {stage < 0 && (
          <button className="primary" onClick={begin}>
            Create test
          </button>
        )}
      </Title>
      <Feedback {...task} />
      {stage < 0 ? (
        <div className="card">
          {data.tests.length === 0 && (
            <p>Create your first paper to schedule a test.</p>
          )}
          {data.tests.map((t) => (
            <div className="listrow" key={t.id}>
              <div>
                <b>{t.title}</b>
                <small>
                  {t.status} · {t.is_demo ? 'Demo' : 'Scheduled paper'} ·{' '}
                  {t.duration_min} min · {t.total_marks} marks
                </small>
              </div>
              <div className="actions">
                <button
                  disabled={task.busy}
                  onClick={() => task.run(() => edit(t, true))}
                >
                  Use as template
                </button>
                <button
                  disabled={task.busy}
                  onClick={() => task.run(() => edit(t))}
                >
                  Open editor
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="steps">
            {['Details', 'Sections', 'Questions', 'Preview'].map((s, i) => (
              <span className={i === stage ? 'active' : ''} key={s}>
                {i + 1}. {s}
              </span>
            ))}
          </div>
          {stage === 0 ? (
            <>
              <label>
                Title
                <input
                  value={form.title}
                  onChange={(e) => F({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                Description
                <textarea
                  value={form.description}
                  onChange={(e) => F({ ...form, description: e.target.value })}
                />
              </label>
              <label>
                Duration (minutes)
                <input
                  type="number"
                  value={form.duration_min}
                  onChange={(e) =>
                    F({ ...form, duration_min: +e.target.value })
                  }
                />
              </label>
              <label>
                Candidate instructions
                <textarea
                  rows={5}
                  value={form.instructions}
                  onChange={(e) => F({ ...form, instructions: e.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.is_demo}
                  onChange={(e) => F({ ...form, is_demo: e.target.checked })}
                />
                Demo paper with unlimited retakes
              </label>
            </>
          ) : stage === 1 ? (
            <>
              {sections.map((s, i) => (
                <div className="tools" key={i}>
                  <label>
                    Section {i + 1}
                    <input
                      value={s.name}
                      onChange={(e) => apply(i, { name: e.target.value })}
                    />
                  </label>
                  <button
                    disabled={sections.length === 1}
                    onClick={() => {
                      S(sections.filter((_, j) => j !== i))
                      I(0)
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                onClick={() => S([...sections, { name: '', questions: [] }])}
              >
                Add section
              </button>
            </>
          ) : stage === 2 && current ? (
            <>
              <div className="tools">
                <label>
                  Section
                  <select value={si} onChange={(e) => I(+e.target.value)}>
                    {sections.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name} ({s.questions.length})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Subject
                  <select value={subject} onChange={(e) => Sub(e.target.value)}>
                    <option value="">All subjects</option>
                    {data.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Difficulty
                  <select value={diff} onChange={(e) => D(e.target.value)}>
                    <option value="">All levels</option>
                    {['easy', 'medium', 'hard'].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="tools">
                <label>
                  Random count
                  <input
                    type="number"
                    min="1"
                    value={num}
                    onChange={(e) => N(+e.target.value)}
                  />
                </label>
                <button
                  onClick={() =>
                    task.run(async () => {
                      const a = available.filter((q) => !picked.includes(q.id))
                      if (!Number.isInteger(num) || num < 1 || num > a.length)
                        throw Error('Choose a count within the available pool.')
                      for (let k = a.length - 1; k > 0; k--) {
                        const j = Math.floor(Math.random() * (k + 1))
                        ;[a[k], a[j]] = [a[j], a[k]]
                      }
                      apply(si, {
                        questions: [
                          ...current.questions,
                          ...a.slice(0, num).map((x) => x.id),
                        ],
                      })
                    })
                  }
                >
                  Add random selection
                </button>
              </div>
              {available.map((q) => (
                <label className="check pick" key={q.id}>
                  <input
                    type="checkbox"
                    disabled={
                      !current.questions.includes(q.id) && picked.includes(q.id)
                    }
                    checked={current.questions.includes(q.id)}
                    onChange={(e) =>
                      apply(si, {
                        questions: e.target.checked
                          ? [...current.questions, q.id]
                          : current.questions.filter((v) => v !== q.id),
                      })
                    }
                  />
                  {q.question_text}
                </label>
              ))}
            </>
          ) : (
            <>
              <h2>{form.title}</h2>
              <p>
                {form.duration_min} minutes · {picked.length} questions ·{' '}
                {data.qs
                  .filter((q) => picked.includes(q.id))
                  .reduce((s, q) => s + q.marks, 0)}{' '}
                marks
              </p>
              <p className="pre">{form.instructions}</p>
              {sections.map((s, i) => (
                <div key={i}>
                  <h3>{s.name}</h3>
                  <ol>
                    {s.questions.map((id) => (
                      <li key={id}>
                        {data.qs.find((q) => q.id === id)?.question_text}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </>
          )}
          <div className="actions end">
            <button
              onClick={() => (stage === 0 ? Stage(-1) : Stage(stage - 1))}
            >
              {stage === 0 ? 'Cancel' : 'Back'}
            </button>
            {stage < 3 ? (
              <button
                className="primary"
                disabled={
                  stage === 0
                    ? !form.title.trim() ||
                      form.duration_min < 1 ||
                      form.duration_min > 600
                    : stage === 1
                      ? sections.some((s) => !s.name.trim())
                      : sections.some((s) => !s.questions.length)
                }
                onClick={() => Stage(stage + 1)}
              >
                Continue
              </button>
            ) : (
              <>
                <button
                  disabled={task.busy}
                  onClick={() => task.run(() => save('draft'), 'Draft saved')}
                >
                  Save draft
                </button>
                <button
                  disabled={task.busy}
                  className="primary"
                  onClick={() =>
                    task.run(() => save('published'), 'Test published')
                  }
                >
                  Publish test
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
