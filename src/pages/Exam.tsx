import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAttempt } from '../hooks/useAttempt'
import { useSession } from '../store/session'
import { PaletteLegend, names } from '../components/Palette'
import { Dialog, Feedback, Loading } from '../components/Common'
import { Theme } from '../components/Shell'
import { clock } from './Student'
import { db } from '../lib/db'
import { useProctor } from '../hooks/useProctor'
export function Exam() {
  const { id } = useParams()
  return <ExamRun key={id} id={id!} />
}
function ExamRun({ id }: { id: string }) {
  const nav = useNavigate(),
    p = useSession((s) => s.profile)!,
    model = useAttempt(id, () => nav('/result/' + id, { replace: true })),
    { paper, save } = model,
    [index, I] = useState(
      () => Number(sessionStorage.getItem('cbt-pos-' + id)) || 0,
    ),
    [confirm, C] = useState(false),
    [sending, S] = useState(false),
    [img, Image] = useState(''),
    heading = useRef<HTMLHeadingElement>(null)
  const q = paper?.items[index] || paper?.items[0],
    locked = useProctor(!!paper, paper?.fullscreen || false, model.log)
  useEffect(() => {
    if (q && q.status === 'not_visited')
      save(q.question_id, null, 'not_answered')
  }, [q?.question_id, q?.status])
  useEffect(() => {
    let active = true
    Image('')
    if (q?.image_url)
      db.storage
        .from('question-images')
        .createSignedUrl(q.image_url, 600)
        .then((r) => {
          if (active) Image(r.data?.signedUrl || '')
        })
    return () => {
      active = false
    }
  }, [q?.question_id])
  function go(i: number) {
    if (!paper || i < 0 || i >= paper.items.length) return
    I(i)
    sessionStorage.setItem('cbt-pos-' + id, String(i))
    requestAnimationFrame(() => heading.current?.focus())
  }
  if (!paper || !q)
    return (
      <main className="standalone">
        <Loading error={model.error} />
        {model.error && <button onClick={model.retry}>Retry connection</button>}
      </main>
    )
  const sections = Array.from(
      new Map(paper.items.map((x) => [x.section_pos, x.section])).entries(),
    ),
    group = paper.items.filter((x) => x.section_pos === q.section_pos),
    inGroup = group.indexOf(q) + 1
  function next() {
    if (index < paper!.items.length - 1) go(index + 1)
    else C(true)
  }
  return (
    <main className="exam">
      <header className="exam-header">
        <div>
          <small>Computer based examination</small>
          <h1>{paper.title}</h1>
        </div>
        <div className="actions">
          <div>
            <b>{p.full_name}</b>
            <small>{p.roll_no}</small>
          </div>
          <div className={'timer ' + (model.left < 300 ? 'urgent' : '')}>
            <small>Time remaining</small>
            {clock(model.left)}
          </div>
          <Theme />
        </div>
      </header>
      <div className="exam-body">
        <section className="exam-main">
          <nav className="section-tabs" aria-label="Exam sections">
            {sections.map(([pos, name]) => (
              <button
                key={pos}
                aria-pressed={pos === q.section_pos}
                onClick={() =>
                  go(paper.items.findIndex((x) => x.section_pos === pos))
                }
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="exam-meta">
            <b>
              Question {inGroup} of {group.length}
            </b>
            <span>
              Marks +{q.marks} · Negative {q.negative_marks}
            </span>
          </div>
          <article className="question" style={{ userSelect: 'none' }}>
            <h2 ref={heading} tabIndex={-1}>
              {q.prompt}
            </h2>
            {q.image_url &&
              (img ? (
                <img
                  className="question-image"
                  src={img}
                  alt="Figure supplied with this question"
                />
              ) : (
                <p>Loading question image…</p>
              ))}
            <fieldset disabled={locked || model.left === 0}>
              <legend>Choose one answer</legend>
              {q.options.map((o, i) => (
                <label
                  className={
                    'option ' + (q.selected_index === i ? 'selected' : '')
                  }
                  key={i}
                >
                  <input
                    type="radio"
                    name={'ans-' + q.question_id}
                    checked={q.selected_index === i}
                    onChange={() =>
                      save(
                        q.question_id,
                        i,
                        q.status === 'marked' || q.status === 'answered_marked'
                          ? 'answered_marked'
                          : 'answered',
                      )
                    }
                  />
                  <span>{String.fromCharCode(65 + i)}.</span> {o}
                </label>
              ))}
            </fieldset>
          </article>
          <div className="exam-controls">
            <button
              className="primary"
              disabled={!model.left || locked}
              onClick={() => {
                save(
                  q.question_id,
                  q.selected_index,
                  q.selected_index == null ? 'not_answered' : 'answered',
                )
                next()
              }}
            >
              Save &amp; Next
            </button>
            <button
              disabled={!model.left || locked}
              onClick={() => {
                save(
                  q.question_id,
                  q.selected_index,
                  q.selected_index == null ? 'marked' : 'answered_marked',
                )
                next()
              }}
            >
              Mark for Review &amp; Next
            </button>
            <button
              disabled={!model.left || locked}
              onClick={() => save(q.question_id, null, 'not_answered')}
            >
              Clear Response
            </button>
            <button disabled={index === 0} onClick={() => go(index - 1)}>
              Back
            </button>
            <button
              disabled={index === paper.items.length - 1}
              onClick={() => go(index + 1)}
            >
              Next
            </button>
          </div>
          <div className="save-status" role="status">
            {model.pending
              ? model.pending + ' changes waiting to sync'
              : model.error
                ? 'Connection needs attention'
                : 'Responses saved'}{' '}
            {model.message}{' '}
            {model.error && (
              <>
                <span>{model.error}</span>{' '}
                <button onClick={model.retry}>Retry</button>
              </>
            )}
          </div>
        </section>
        <aside className="exam-side">
          <h2>Question palette</h2>
          <PaletteLegend items={group} />
          <h3>{q.section}</h3>
          <div className="palette">
            {group.map((row, i) => (
              <button
                key={row.question_id}
                aria-label={'Question ' + (i + 1) + ', ' + names[row.status]}
                aria-current={
                  row.question_id === q.question_id ? 'step' : undefined
                }
                className={'token ' + row.status}
                onClick={() => go(paper.items.indexOf(row))}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <button className="submit" onClick={() => C(true)}>
            Submit examination
          </button>
          <small>
            Warnings {paper.warning_count} of {paper.warning_limit}
          </small>
        </aside>
      </div>
      {confirm && !locked && !model.warning && (
        <Dialog title="Submit examination?" close={() => C(false)}>
          <p>
            Review the section totals. Answered and marked responses are
            included in scoring.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Answered</th>
                  <th>Unanswered</th>
                  <th>Marked</th>
                </tr>
              </thead>
              <tbody>
                {sections.map(([pos, name]) => {
                  const rows = paper.items.filter((x) => x.section_pos === pos),
                    n = rows.filter((x) => x.selected_index != null).length
                  return (
                    <tr key={pos}>
                      <td>{name}</td>
                      <td>{n}</td>
                      <td>{rows.length - n}</td>
                      <td>
                        {rows.filter((x) => x.status.includes('marked')).length}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Feedback error={model.error} />
          <div className="actions">
            <button onClick={() => C(false)}>Return to paper</button>
            <button
              className="primary"
              disabled={sending || model.pending > 0}
              onClick={async () => {
                S(true)
                await model.finish()
                S(false)
              }}
            >
              Confirm submission
            </button>
          </div>
        </Dialog>
      )}
      {locked && (
        <Dialog title="Return to fullscreen to continue">
          <p>The exam clock continues while fullscreen is inactive.</p>
          <button
            onClick={() =>
              document.documentElement
                .requestFullscreen()
                .catch(() =>
                  alert(
                    'Use a fullscreen-capable browser and allow the request.',
                  ),
                )
            }
          >
            Return to fullscreen
          </button>
        </Dialog>
      )}
      {model.warning > 0 && !locked && (
        <Dialog
          title={'Warning ' + model.warning + ' of ' + paper.warning_limit}
        >
          <p>
            A browser event was recorded. Reaching the configured limit submits
            this attempt.
          </p>
          <button className="primary" onClick={model.dismiss}>
            Continue examination
          </button>
        </Dialog>
      )}
    </main>
  )
}
