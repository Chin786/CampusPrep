# CampusPrep CBT implementation decision

Proceed with a supervised, single-college MCQ pilot after a hosted rehearsal. The proposed placement platform is a credible expansion path. The next decision is whether two colleges need to share one deployment. That changes who may read student identities, author questions, assign a schedule and export results. The current admin role has institution-wide access across its deployment.

## What changed in the source

| Need | Implemented behavior | Evidence to check |
| --- | --- | --- |
| Faculty contribution | Approved faculty can save private drafts, submit, receive feedback and resubmit. A different administrator approves before the question enters the bank. | Faculty submissions page, author portal and question-review database test |
| Comparable drive papers | A schedule freezes its questions, answer key, scoring, duration and instructions. Every assigned candidate sees the same revision, independently shuffled within sections. | Drive integrity test edits the bank and paper between scheduling and starting |
| Reusable papers | An admin can open an existing test with **Use as template**, edit it and save a new draft or published paper. | Test papers wizard and distinct test IDs |
| Fair release of solutions | Scores appear on submission. For new scheduled tests, detailed answers open at the schedule closing time by default. The coordinator can choose immediate review. Demos release explanations immediately. | Early-finisher, demo and administrator review assertions |
| Student standing | The student sees their own rank and the number of graded candidates. Score ties share a dense rank. Final standings wait for closure and grading of all starters. | Three candidates with ranks 1, 1 and 2, plus an absent candidate and an unrelated schedule |
| Exam traffic | Answer selections still save immediately. Routine timer checks send a small heartbeat. A changed answer revision causes a full refresh. | Heartbeat response contains time, state, warnings and a revision sum |

Existing functionality includes registration approval, assigned links, per-attempt snapshots, server deadlines, offline retries with revision checks, single-transaction grading and an unattended expiry sweep. A disconnected client can enter answers locally. Only writes received by the server before the deadline can count.

## Multi-college release

| Role | Permitted scope | Required evidence before enabling shared hosting |
| --- | --- | --- |
| Student | Own attempts, eligible global practice and assigned college drives | An assignment URL opened under a different student or institution returns no paper or answers |
| Content author | Own global drafts and own feedback. An independent reviewer publishes | An author never sees another author’s drafts, hidden judge cases or student records |
| T&P coordinator | College-private content, cohorts, invitations, schedules, proctoring and exports for that institution | A coordinator from College A cannot list, edit, join or export records from College B |
| Platform administrator | College onboarding, independently reviewed global releases and audited cross-college support | Each cross-college override identifies the operator, affected college, resource and reason |

Plan a colleges table, server-managed memberships and explicit content visibility. Use a composite institution and roll-number uniqueness rule, since two colleges can issue the same roll number. A global question must have explicit global visibility and a publication state. A missing tenant must never silently confer global access. After a college transfer or staff revocation, reevaluate access on the next request. Preserve the examination’s original institution on historical attempts and reports. A verified email domain may suggest a college during signup. A trusted administrator or invitation confirms privileged membership.

Enforce membership on RPCs, row policies, invitation functions, image storage, group joins and exports. Keep application roles separate from the Supabase JWT role used by PostgREST. Only trusted backend data can confer a role. Plan the migration by mapping existing staff and data to a named college, backfilling dependent rows, validating cross-table consistency, and then enabling scoped staff routes. Run a two-college fixture with deliberately overlapping roll numbers. Until this migration ships, independent institutes can use separate deployments.

## Company practice and section controls

Store a versioned blueprint with its label, source, review date, subjects, question counts, difficulty distribution, scoring and section-navigation rules. Identify centre-created mock patterns as practice material. Confirm employer-published patterns and dates before using official branding or implying equivalence. Generate a schedule from a fixed blueprint revision.

Support free navigation for UGC NET practice and an optional sequential mode for drives that need sectional timing. The server owns section start and end, applies any overall deadline, and atomically rejects writes to closed sections. Define whether unused time carries forward and whether an early advance is final. Show these rules before Start. Test refresh at the section boundary and an offline edit delivered after its section closes. Paper cloning is available now. Per-section clocks, company pattern selection and automatic sectional cutoffs are future work.

## Coding rounds

A technical MCQ tests recognition. A programming task needs a source editor, language and runtime selection, sample runs and final grading against private tests. Make this a separate service milestone. Use a managed, isolated judge or a dedicated execution service on separate infrastructure. Student code must never execute inside the frontend host, the database, or an Edge Function with access to platform secrets.

Record a durable submission ID, source version, problem version, runtime version, test-suite version and grading status. Separate practice runs from final submissions, cap CPU, memory, processes, disk, time and output, and restrict network access. Return sample output and a bounded verdict. Keep private test inputs, expected output and sensitive grader diagnostics on the service. Key any result cache by submission scope and every input that changes a verdict. A retry or duplicate callback must not award credit twice.

Use a committed job record or transactional outbox when accepting a final submission. A worker records a terminal verdict atomically. Timeouts, worker restarts, rejudging and a queue outage need recoverable states and a visible status for students. Publish a mixed MCQ and coding standing after all final verdicts are available.

## Capacity and operating criteria

At 500 active candidates, a heartbeat every ten seconds averages 50 calls per second before autosaves. A synchronized login or reconnect can create a much larger burst. That arithmetic is a workload estimate. No 500-candidate performance result has been measured.

Rehearse on a staging project sized like the exam-day environment. Use 500 synthetic assigned accounts with a representative paper, stagger starts, then repeat a synchronized arrival. Include answer changes, a network interruption and simultaneous submission near the deadline. Record p50/p95/p99 save latency, error rate, login and start latency, database connections, CPU, lock waits, heartbeat payload sizes and expiry-job lag. Reconcile every acknowledged answer and final score against the durable records. Proposed pilot targets are p95 save acknowledgement under one second on the campus network, zero lost acknowledged answers and one final grade per attempt. Record observed results before setting the advertised cohort limit.

Postgres already serializes an attempt’s grading and saves using row locks. Keep acknowledged responses and final grades durable there. If measurements identify a bottleneck, first identify the expensive query or payload. Redis is an option for replaceable, versioned caches or queue coordination. Define persistence, eviction, failover and reconciliation before introducing it to an exam write path. A cache entry expiring must never erase an accepted answer. Use one authoritative deadline across save, submit and sweep. A late sweep changes how quickly a result becomes visible, not which answers can earn marks.

Before the pilot, exercise the actual email, storage, cron, Edge Function and browser flows. Assign responsibility for restoring a backup, resolving disputed grades, and reviewing proctoring flags. Agree who may export student data, how long identifiable proctoring records are retained, and how a student requests a review. For an accessibility accommodation, verify keyboard and assistive-technology behavior, available time and the invigilator’s monitoring policy on the actual examination workstation.

## Reference documentation

- PostgreSQL row locking and transaction conflicts. [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- Supabase row policies, JWT freshness and user-editable metadata. [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Redis durability choices and recovery behavior. [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
