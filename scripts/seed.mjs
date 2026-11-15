import { createClient } from '@supabase/supabase-js'
import { randomBytes, createHash } from 'node:crypto'
import fs from 'node:fs'
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key)
  throw Error(
    'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your server environment.',
  )
if (
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname) &&
  !process.argv.includes('--allow-remote')
)
  throw Error(
    'Run with --allow-remote to install the sample accounts in the selected hosted project.',
  )
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
async function value(q) {
  const r = await q
  if (r.error) throw Error(r.error.message)
  return r.data
}
function stable(name) {
  const h = createHash('sha256')
    .update('campusprep-cbt-practice-' + name)
    .digest('hex')
  return (
    h.slice(0, 8) +
    '-' +
    h.slice(8, 12) +
    '-4' +
    h.slice(13, 16) +
    '-8' +
    h.slice(17, 20) +
    '-' +
    h.slice(20, 32)
  )
}
let local = {}
if (fs.existsSync('.seed-accounts.json'))
  local = JSON.parse(fs.readFileSync('.seed-accounts.json', 'utf8'))
const ids = []
for (const [i, slug] of ['officer', 'ananya', 'kabir', 'meera'].entries()) {
  const email = slug + '@campusprep.example',
    roll = 'CBT-DEMO-' + (i + 1),
    full_name = ['Demo Officer', 'Ananya Rao', 'Kabir Shah', 'Meera Verma'][i],
    password = local[email] || randomBytes(22).toString('base64url')
  let row = await value(
    db.from('profiles').select('id,roll_no').eq('email', email).maybeSingle(),
  )
  if (!row) {
    local[email] = password
    fs.writeFileSync('.seed-accounts.json', JSON.stringify(local, null, 2), {
      mode: 0o600,
    })
    const u = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, roll_no: roll, phone: '900000000' + i },
    })
    if (u.error) throw u.error
    row = { id: u.data.user.id, roll_no: roll }
  }
  if (row.roll_no !== roll)
    throw Error('Seed email is already owned by a different profile.')
  await value(
    db
      .from('profiles')
      .update({ status: 'approved', role: i === 0 ? 'admin' : 'student' })
      .eq('id', row.id),
  )
  ids.push(row.id)
}
const paper1 = [
  [
    'Teaching',
    'Which assessment gives learners feedback while a course is in progress?',
    ['Formative', 'Summative', 'Certification', 'Placement only'],
    0,
    'Formative assessment guides learning during instruction.',
  ],
  [
    'Teaching',
    'Which learning objective is most directly observable?',
    [
      'Understand recursion',
      'Know recursion',
      'Trace a recursive call sequence',
      'Appreciate recursion',
    ],
    2,
    'Tracing calls produces an observable performance.',
  ],
  [
    'Research',
    'Which sampling method selects participants from each defined subgroup?',
    ['Convenience', 'Stratified', 'Snowball', 'Purposive only'],
    1,
    'Stratified sampling divides the population into strata before sampling.',
  ],
  [
    'Research',
    'A study finds a correlation between attendance and score. Which conclusion is supported?',
    [
      'Attendance causes scores',
      'Scores cause attendance',
      'Both variables are associated',
      'Every student benefits equally',
    ],
    2,
    'Correlation alone establishes an association.',
  ],
  [
    'Reasoning',
    'If all A are B and all B are C, which conclusion follows?',
    ['All C are A', 'Some C are not B', 'No A are C', 'All A are C'],
    3,
    'Set inclusion is transitive.',
  ],
  [
    'Numerical aptitude',
    'A class average rises from 40 to 50. What is the percentage increase?',
    ['10%', '20%', '25%', '40%'],
    2,
    'The increase is 10 on a base of 40.',
  ],
  [
    'Communication',
    'Which action best checks whether a learner understood an explanation?',
    [
      'Repeat it louder',
      'Ask for a paraphrase',
      'Increase the slide count',
      'Shorten the class',
    ],
    1,
    'A paraphrase reveals how the learner interpreted the explanation.',
  ],
  [
    'Data interpretation',
    'The values are 4, 6, 8, 8 and 19. What is the median?',
    ['6', '8', '9', '19'],
    1,
    'The third observation in this ordered set is 8.',
  ],
  [
    'Research',
    'Which variable is deliberately changed in an experiment?',
    ['Dependent', 'Confounding', 'Independent', 'Residual'],
    2,
    'The researcher manipulates the independent variable.',
  ],
]
const cs = [
  [
    'Algorithms',
    'Binary search on a sorted array has which worst-case time bound?',
    ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'],
    1,
    'Each comparison halves the remaining search interval.',
  ],
  [
    'Data structures',
    'Which traversal uses a queue?',
    [
      'Depth first',
      'Inorder recursive',
      'Breadth first',
      'Postorder recursive',
    ],
    2,
    'A queue expands nodes in order of discovery.',
  ],
  [
    'Databases',
    'Which property makes a transaction all-or-nothing?',
    ['Isolation', 'Durability', 'Atomicity', 'Concurrency'],
    2,
    'Atomicity treats the transaction as one unit.',
  ],
  [
    'Operating systems',
    'Which policy may cause starvation of long jobs?',
    [
      'Round robin',
      'Shortest job first',
      'FIFO only',
      'Time sharing with equal quanta',
    ],
    1,
    'Short arrivals can repeatedly delay a long job.',
  ],
  [
    'Networks',
    'How many usable host addresses are in a conventional IPv4 /28 subnet?',
    ['12', '14', '16', '28'],
    1,
    'Sixteen addresses minus network and broadcast leaves fourteen.',
  ],
  [
    'OOP',
    'Which feature selects an overridden virtual method at runtime?',
    ['Overloading', 'Static linking', 'Dynamic dispatch', 'Preprocessing'],
    2,
    'Dynamic dispatch selects an implementation using the runtime object type.',
  ],
  [
    'Logic',
    'What is the complement of A AND B?',
    ['NOT A AND NOT B', 'NOT A OR NOT B', 'A OR B', 'A XOR B'],
    1,
    'De Morgan’s law complements both operands and exchanges AND with OR.',
  ],
  [
    'Algorithms',
    'Which algorithm finds a shortest path in an unweighted graph?',
    ['DFS always', 'Binary search', 'BFS', 'Heap sort'],
    2,
    'Breadth-first search visits successive distance layers.',
  ],
  [
    'Databases',
    'Which SQL clause filters groups after aggregation?',
    ['WHERE', 'LIMIT', 'HAVING', 'ORDER BY'],
    2,
    'HAVING applies a condition to each group.',
  ],
  [
    'Theory',
    'A deterministic finite automaton recognises which class of languages?',
    [
      'Context-sensitive only',
      'All recursively enumerable',
      'All context-free',
      'Regular',
    ],
    3,
    'Finite automata recognise exactly the regular languages.',
  ],
  [
    'Operating systems',
    'Which memory scheme divides virtual space into fixed-size blocks?',
    ['Segmentation only', 'Paging', 'Spooling', 'Linking'],
    1,
    'Paging divides address space into pages.',
  ],
  [
    'Numerical aptitude',
    'A fair six-sided die is rolled once. What is the probability of a prime number?',
    ['1/6', '1/3', '1/2', '2/3'],
    2,
    'The prime faces are 2, 3 and 5.',
  ],
  [
    'Research',
    'Which control helps reduce selection bias in treatment allocation?',
    [
      'Random assignment',
      'Larger font',
      'Post-hoc grouping',
      'Voluntary treatment choice',
    ],
    0,
    'Random allocation reduces systematic differences between treatment groups.',
  ],
  [
    'Teaching',
    'Which exercise directly assesses application of a sorting algorithm?',
    [
      'List its author',
      'Repeat a definition',
      'Trace sorting a new input',
      'Name a textbook',
    ],
    2,
    'Tracing a new input requires applying the procedure.',
  ],
  [
    'Reasoning',
    'What is the next term in 2, 5, 10, 17, …?',
    ['21', '24', '26', '32'],
    2,
    'The successive differences are 3, 5, 7 and 9.',
  ],
  [
    'Data structures',
    'Which operation returns the most recently pushed stack element?',
    ['Dequeue', 'Pop', 'Join', 'Rotate'],
    1,
    'A stack removes the last item inserted.',
  ],
  [
    'Networks',
    'Which protocol resolves a domain name to an IP address?',
    ['DNS', 'FTP', 'SMTP', 'NTP'],
    0,
    'DNS supplies address records for hostnames.',
  ],
  [
    'Algorithms',
    'Merge sort has which worst-case comparison time?',
    ['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'],
    1,
    'Each merge level takes O(n) across O(log n) levels.',
  ],
  [
    'Logic',
    'How many distinct bit strings have length four?',
    ['4', '8', '16', '24'],
    2,
    'Four independent binary choices give 2⁴=16 possibilities.',
  ],
  [
    'Communication',
    'Which example is feedback in a communication cycle?',
    [
      'A microphone',
      'The classroom wall',
      'A learner’s clarifying question',
      'A printed syllabus',
    ],
    2,
    'The receiver responds to the sender with a question.',
  ],
]
const subjects = ['General aptitude', 'Computer science'].map((name) => ({
  id: stable(name),
  name,
}))
await value(db.from('subjects').upsert(subjects))
const rows = []
function choices(set, tag) {
  return set.map(
    ([topic, question_text, options, correct_index, explanation], i) => {
      const general =
        tag === 'demo' ||
        [
          'Teaching',
          'Research',
          'Reasoning',
          'Communication',
          'Numerical aptitude',
        ].includes(topic)
      const id = stable(tag + i)
      rows.push({
        id,
        question_text,
        options,
        correct_index,
        explanation,
        section_name: general ? 'Paper I' : 'Paper II',
        subject_id: subjects[general ? 0 : 1].id,
        difficulty: i % 4 === 0 ? 'medium' : 'easy',
        marks: 2,
        negative_marks: 0,
        created_by: ids[0],
      })
      return id
    },
  )
}
const a = choices(paper1, 'demo'),
  b = choices(cs, 'full')
await value(db.from('questions').upsert(rows))
for (const [tag, questions, is_demo] of [
  ['demo', a, true],
  ['full', b, false],
]) {
  const test_id = stable('test' + tag)
  await value(
    db
      .from('tests')
      .upsert({
        id: test_id,
        title: is_demo
          ? 'UGC NET interface practice'
          : 'UGC NET computer science practice set',
        description: 'Original practice questions for the campus exam centre.',
        duration_min: is_demo ? 15 : 40,
        total_marks: questions.length * 2,
        instructions:
          'Answer one option per question. Correct answers earn 2 marks. There is no negative marking in this practice paper.',
        is_demo,
        status: 'published',
        created_by: ids[0],
      }),
  )
  const subset = rows.filter((r) => questions.includes(r.id))
  let pos = 0
  for (const name of ['Paper I', 'Paper II']) {
    const qs = subset.filter((r) => r.section_name === name)
    if (!qs.length) continue
    const section_id = stable(tag + name)
    await value(
      db
        .from('test_sections')
        .upsert({ id: section_id, test_id, name, position: pos++ }),
    )
    await value(
      db
        .from('test_questions')
        .upsert(
          qs.map((r, i) => ({
            id: stable(tag + r.id),
            test_id,
            section_id,
            question_id: r.id,
            position: i,
          })),
        ),
    )
  }
}
const sid = stable('sample-schedule'),
  existing = await value(
    db.from('schedules').select('id').eq('id', sid).maybeSingle(),
  )
if (!existing) {
  const start = Date.now()
  await value(
    db
      .from('schedules')
      .insert({
        id: sid,
        test_id: stable('testfull'),
        start_at: new Date(start).toISOString(),
        end_at: new Date(start + 86400000).toISOString(),
        late_entry_min: 1440,
        max_warnings: 3,
        require_fullscreen: true,
      }),
  )
}
await value(
  db.from('schedule_assignments').upsert(
    ids.slice(1).map((student_id) => ({ schedule_id: sid, student_id })),
    { onConflict: 'schedule_id,student_id', ignoreDuplicates: true },
  ),
)
console.log(
  'Seeded 1 admin, 3 approved students, 9 demo questions, 20 scheduled questions and 1 schedule. Newly generated passwords are in .seed-accounts.json.',
)
