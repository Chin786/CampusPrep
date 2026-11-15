import { useState } from 'react'
import { z } from 'zod'
import { db, unwrap } from '../lib/db'
import { readRows, csv } from '../lib/files'
import {
  Feedback,
  Loading,
  Title,
  fetchAll,
  useData,
  useTask,
} from '../components/Common'
export const questionSchema = z.object({
  subject_id: z.string().uuid(),
  section_name: z.string().trim().min(1),
  question_text: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).length(4),
  correct_index: z.coerce.number().int().min(0).max(3),
  explanation: z.string().trim().min(1),
  marks: z.coerce.number().positive(),
  negative_marks: z.coerce.number().nonnegative(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  image_url: z.string().nullable(),
})
export type Q = z.infer<typeof questionSchema> & { id: string }
const blank = {
  subject_id: '',
  section_name: 'Paper I',
  question_text: '',
  options: ['', '', '', ''],
  correct_index: 0,
  explanation: '',
  marks: 2,
  negative_marks: 0,
  difficulty: 'medium' as Q['difficulty'],
  image_url: null as string | null,
}
export async function loadBank() {
  const [subjects, qs] = await Promise.all([
    fetchAll<{ id: string; name: string }>((f, t) =>
      db.from('subjects').select('id,name').order('name').range(f, t),
    ),
    fetchAll<Q>((f, t) =>
      db.from('questions').select('*').order('id').range(f, t),
    ),
  ])
  return { subjects, qs }
}
const headings = [
  'subject',
  'section_name',
  'question_text',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'correct_option',
  'explanation',
  'marks',
  'negative_marks',
  'difficulty',
]
export function Questions() {
  const d = useData(loadBank),
    task = useTask(),
    [q, Qset] = useState({ ...blank }),
    [edit, E] = useState(''),
    [show, Show] = useState(false),
    [subject, S] = useState(''),
    [section, Sec] = useState(''),
    [newSubject, N] = useState(''),
    [img, Image] = useState<File | null>(null)
  if (!d.data) return <Loading error={d.error} />
  const data = d.data
  const patch = (k: string, v: unknown) => Qset((old) => ({ ...old, [k]: v }))
  async function save() {
    const v = questionSchema.parse(q)
    if (img) {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(img.type) ||
        img.size > 5242880
      )
        throw Error('Use PNG, WebP or JPEG up to 5 MB.')
      const path = crypto.randomUUID() + '.' + img.type.split('/')[1]
      await unwrap(db.storage.from('question-images').upload(path, img))
      v.image_url = path
    }
    await unwrap(
      edit
        ? db.from('questions').update(v).eq('id', edit)
        : db.from('questions').insert(v),
    )
    Show(false)
    d.reload()
  }
  return (
    <>
      <Title kicker="Content management" title="Question bank">
        <button
          className="primary"
          onClick={() => {
            E('')
            Qset({
              ...blank,
              subject_id: subject || data.subjects[0]?.id || '',
            })
            Image(null)
            Show(true)
          }}
        >
          Add question
        </button>
      </Title>
      <div className="card tools">
        <select
          aria-label="Filter by subject"
          value={subject}
          onChange={(e) => S(e.target.value)}
        >
          <option value="">All subjects</option>
          {data.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Filter by section"
          placeholder="Filter by section"
          value={section}
          onChange={(e) => Sec(e.target.value)}
        />
        <input
          placeholder="New subject name"
          aria-label="New subject name"
          value={newSubject}
          onChange={(e) => N(e.target.value)}
        />
        <button
          disabled={!newSubject.trim() || task.busy}
          onClick={() =>
            task.run(async () => {
              await unwrap(
                db.from('subjects').insert({ name: newSubject.trim() }),
              )
              N('')
              d.reload()
            }, 'Subject created')
          }
        >
          Add subject
        </button>
      </div>
      {show && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            task.run(save, 'Question saved')
          }}
        >
          <h2>{edit ? 'Edit question' : 'New question'}</h2>
          <div className="two">
            <label>
              Subject
              <select
                required
                value={q.subject_id}
                onChange={(e) => patch('subject_id', e.target.value)}
              >
                <option value="">Choose subject</option>
                {data.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Section
              <input
                required
                value={q.section_name}
                onChange={(e) => patch('section_name', e.target.value)}
              />
            </label>
          </div>
          <label>
            Question
            <textarea
              required
              value={q.question_text}
              onChange={(e) => patch('question_text', e.target.value)}
            />
          </label>
          <div className="two">
            {q.options.map((v, i) => (
              <label key={i}>
                Option {String.fromCharCode(65 + i)}
                <input
                  required
                  value={v}
                  onChange={(e) =>
                    patch(
                      'options',
                      q.options.map((o, j) => (i === j ? e.target.value : o)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <div className="tools">
            <label>
              Answer
              <select
                value={q.correct_index}
                onChange={(e) => patch('correct_index', +e.target.value)}
              >
                {['A', 'B', 'C', 'D'].map((v, i) => (
                  <option value={i} key={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Difficulty
              <select
                value={q.difficulty}
                onChange={(e) => patch('difficulty', e.target.value)}
              >
                {['easy', 'medium', 'hard'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {(['marks', 'negative_marks'] as const).map((k) => (
              <label key={k}>
                {k === 'marks' ? 'Marks' : 'Deduction'}
                <input
                  type="number"
                  min={k === 'marks' ? 0.01 : 0}
                  step=".01"
                  value={q[k]}
                  onChange={(e) => patch(k, +e.target.value)}
                />
              </label>
            ))}
          </div>
          <label>
            Explanation
            <textarea
              required
              value={q.explanation}
              onChange={(e) => patch('explanation', e.target.value)}
            />
          </label>
          <label>
            Optional question image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => Image(e.target.files?.[0] || null)}
            />
          </label>
          <button disabled={task.busy} className="primary">
            Save question
          </button>{' '}
          <button type="button" onClick={() => Show(false)}>
            Cancel
          </button>
        </form>
      )}
      <div className="card">
        <h2>Import questions</h2>
        <p>Use an existing subject name. The correct option is A, B, C or D.</p>
        <div className="tools">
          <button onClick={() => csv('questions-template.csv', [headings])}>
            Download template
          </button>
          <label>
            Import CSV or Excel
            <input
              type="file"
              accept=".csv,.xlsx"
              disabled={task.busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f)
                  task.run(async () => {
                    const rows = await readRows(f)
                    if (!rows.length || rows.length > 500)
                      throw Error('Import 1–500 questions at once.')
                    const records = rows.map((r, i) => {
                      const result = questionSchema.safeParse({
                        ...r,
                        subject_id: data.subjects.find(
                          (s) =>
                            s.name.toLowerCase() ===
                            r.subject?.trim().toLowerCase(),
                        )?.id,
                        options: [
                          r.option_a,
                          r.option_b,
                          r.option_c,
                          r.option_d,
                        ],
                        correct_index: ['A', 'B', 'C', 'D'].indexOf(
                          r.correct_option?.trim().toUpperCase(),
                        ),
                        marks: r.marks || 2,
                        negative_marks: r.negative_marks || 0,
                        image_url: null,
                      })
                      if (!result.success)
                        throw Error(
                          'Row ' +
                            (i + 2) +
                            ': ' +
                            result.error.issues[0].path.join('.') +
                            ' — ' +
                            result.error.issues[0].message,
                        )
                      return result.data
                    })
                    await unwrap(db.from('questions').insert(records))
                    d.reload()
                  }, 'Questions imported')
              }}
            />
          </label>
        </div>
      </div>
      <Feedback {...task} />
      <div className="card">
        <h2>Questions</h2>
        {data.qs
          .filter(
            (q) =>
              (!subject || q.subject_id === subject) &&
              q.section_name.toLowerCase().includes(section.toLowerCase()),
          )
          .map((q) => (
            <div className="listrow" key={q.id}>
              <div>
                <strong>{q.question_text}</strong>
                <small>
                  {q.section_name} · {q.difficulty} · {q.marks} marks
                </small>
              </div>
              <div className="actions">
                <button
                  onClick={() => {
                    E(q.id)
                    Qset(q)
                    Show(true)
                    Image(null)
                    window.scrollTo(0, 0)
                  }}
                >
                  Edit
                </button>
                <button
                  disabled={task.busy}
                  onClick={() => {
                    if (
                      confirm(
                        'Delete this question? Questions used in a test must first be removed from that test.',
                      )
                    )
                      task.run(async () => {
                        await unwrap(
                          db.from('questions').delete().eq('id', q.id),
                        )
                        d.reload()
                      }, 'Deleted')
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    </>
  )
}
