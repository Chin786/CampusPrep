# CampusPrep CBT

CampusPrep is a computer-based mock examination platform for college and UGC NET practice. Students use an email-verified account. A centre administrator approves their registration, builds papers, assigns schedules and reviews results. Faculty can submit original questions through a separate author workspace. The exam screen includes section tabs, a question palette, marked responses, a server-timed countdown and a submission summary.

## Connect the hosted project through Bolt

1. Extract this project. Import the project files into Bolt, or push them to a GitHub repository and import that repository into Bolt. Use the directory containing `package.json` as the project root.
2. In Bolt, open **All project settings → Account → Applications → Supabase → Connect**. Authorize the intended organization. In the project, open **Database → Advanced → Connect**, choose the target Supabase project, and click **Connect project**.
3. Set the frontend variables from `.env.example` in the Bolt project environment. Use the project's Supabase URL and publishable or legacy anon key. Rebuild the frontend after changing these variables.
4. In the project directory on a machine with the Supabase CLI, run the commands below. Replace the placeholders with your Supabase project reference and intended frontend origin. The ordered migrations set up the schema, RLS, RPCs, private image bucket, expiry job, scheduled paper versions and faculty review workflow. The expiry-job migration needs the Supabase **Cron** integration or the ability to enable `pg_cron`.
5. In Supabase **Authentication → URL Configuration**, set the Site URL to the deployed frontend origin. Add the deployed login and reset URLs to the redirect allowlist. The common schedule link may continue through `/login?next=...`; allow the login path with its query suffix on your own exact frontend host. Enable email/password sign-in and email confirmation. Configure SMTP for student verification, recovery and invitations. The invitation function uses the configured `APP_ORIGIN`.
6. Publish the frontend with `npm run build` and output directory `dist`. The host must rewrite client routes such as `/student` and `/exam/:id` to `index.html`. Static SPA hosts that read a `_redirects` file can use the included rule.

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set APP_ORIGIN=https://YOUR_FRONTEND_HOST
supabase functions deploy import-students
```

Use a browser-facing key for `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`. The service-role key is used only by the seed process and the server-side invitation function. The frontend build ships only the contents of `dist`.

[Bolt’s Supabase connection guide](https://support.bolt.new/integrations/supabase)

## Run locally

Use Node.js 22 or newer, npm, the Supabase CLI and Docker for the local Supabase stack. From the extracted project root:

```sh
npm ci
supabase start
supabase status
```

On a fresh stack, the CLI applies the migration files. If you need to rebuild a disposable local database after editing migrations, `supabase db reset --local` recreates the local database and deletes its existing records. Rerun the seed after a reset.

Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` to the printed API URL and `VITE_SUPABASE_ANON_KEY` to the local public key. For importing students locally, set `APP_ORIGIN=http://localhost:5173` in `supabase/functions/.env.local`, then run the following commands in separate terminals:

```sh
supabase functions serve import-students --env-file supabase/functions/.env.local
```

```sh
npm run dev
```

Open **http://localhost:5173**. Use the mail inbox address printed by `supabase status` to open local verification and recovery emails. Running Vite alone displays the entry pages. Accounts, scheduling, private images and exam attempts require the configured backend.

## Create the first administrator

Register at `/register` using your real administrative email, verify the address, and take the user UUID from Supabase Authentication. In the trusted Supabase SQL editor, replace the UUID below with that exact ID. The update requires the corresponding Auth email to have been confirmed.

```sql
update public.profiles p
set role = 'admin', status = 'approved'
from auth.users u
where p.id = u.id
  and u.id = '00000000-0000-0000-0000-000000000000'::uuid
  and u.email_confirmed_at is not null
returning p.id, p.email, p.role, p.status;
```

Sign in again or refresh the account status. New registrations always receive the student role and pending status. The database ignores role and status values supplied in signup metadata.

## Sample accounts and examinations

Populate a local or practice project after the migrations have finished. In your private `.env.local`, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the backend values for that project. Load them into the seed process with Node:

```sh
node --env-file=.env.local scripts/seed.mjs
```

For a deliberately selected hosted practice project, append `--allow-remote`. The seed generates random passwords and records newly created account credentials in the local, git-ignored `.seed-accounts.json`. It creates the following fixtures:

| Item | Contents |
| --- | --- |
| Administrator | officer@campusprep.example |
| Approved students | ananya@campusprep.example, kabir@campusprep.example, meera@campusprep.example |
| Interface demo | Nine original questions, 15 minutes, unlimited retakes |
| Scheduled practice paper | Twenty original questions across Paper I and Paper II, 40 minutes |
| Assigned schedule | Assigned to the three students; opens at seeding and closes 24 hours later |

The sample schedule allows entry throughout its 24-hour window so you can try it immediately. New schedules in the admin panel default to ten minutes of late entry. A repeated seed preserves the existing sample schedule dates and does not reset account passwords. After the sample schedule closes, use the scheduling screen to create another one.

## Run a mock examination

1. **Prepare the roster.** Open **Students**, review details and approve individual students or a selection. Use the CSV template to send account invitations. Each imported row returns its own result. Select students to create an assignment group.
2. **Review faculty questions.** From **Faculty submissions → Manage faculty author access**, grant an approved faculty account author access. The faculty member signs in at `/content_author`, saves drafts and submits them. A different administrator can request changes or approve a question into the bank. The author can see their own submissions and feedback.
3. **Build the paper.** Open **Question bank** and create at least one subject. Add questions individually or import the CSV template or an XLSX workbook using the same headers. Each row has four options, a correct option from A to D, an explanation, marks, a deduction and difficulty. Optional question images are stored in a private bucket.
4. **Publish and assign.** In **Test papers**, enter details and instructions, create sections and choose the questions. Random selection lets the author sample a pool by subject and difficulty. Preview the paper and publish it. Use **Use as template** to make a new draft from an existing paper. Editing the copy leaves the source paper intact. In **Schedules**, choose dates, entry grace period, warning limit, browser requirements and recipients. Use the common link or the editable Gmail draft to share a schedule. Only assigned and approved students can start it.
5. **Take the test.** The student reads the instructions, completes the system check, then starts. Tab and the arrow keys operate native controls. Selecting an option autosaves. Mark for Review retains any selected answer. The summary shows section totals before submission.
6. **Review.** Students see their score on submission. For new schedules the answer key and section analysis open when the schedule closes, unless the administrator selects immediate review during scheduling. Demos release immediately. Final rank appears after the schedule closes and every started attempt has been graded. Administrators can open leaderboards, section scores, question analysis, individual reviews and timestamped warnings. Export a report as CSV or PDF. Use the browser Print option with system fonts for scripts the PDF's built-in font does not cover.

## Timing, grading and monitoring

- The schedule opens at `start_at`. Entry closes at the earlier of `start_at + late_entry_min` and `end_at`. A candidate who already started may resume after the entry window. The attempt ends at the earlier of its individual duration and the scheduled closing time.
- Each scheduled student has one attempt per schedule. A demo can be repeated after the previous attempt finishes. A new schedule freezes the question set, instructions, duration, marks and answer key when it is created. Every student assigned to it gets that version, shuffled within each section when they start. Live changes to the bank affect future schedules. Demo attempts snapshot their paper when they start.
- The candidate paper RPC returns question text, options, marks and response state. The grading key remains in a private schema. The result RPC checks submission status. A correct answer earns its marks, a wrong answer incurs its deduction and an unanswered question earns zero. Answered and marked responses count. Demo scores are separate from scheduled leaderboards.
- The server derives remaining time from the deadline and rejects late answers. Stale attempts are finalized upon access; a cron job sweeps unattended attempts every minute. During a network interruption, pending edits and events are retained on the same browser and retried. An offline answer can count only if the server receives it before the deadline. Revision checks preserve a more recent response from another session. A compact heartbeat returns time, status, warnings and the revision sum. The client reloads the paper on reconnect or when another session changes an answer.
- Violations carry stable event IDs to prevent double counting on network retries. Focus and visibility signals from one departure are grouped. Reaching the schedule's warning limit closes and scores the attempt in the same transaction. The proctoring report flags threshold-reaching attempts. These records describe observed browser events; the invigilator interprets them.
- The centre can require fullscreen and the SEB user-agent check. Some operating-system shortcuts and mirrored displays are invisible to browser APIs. Multi-display detection is best effort and depends on browser support and permission. The SEB user-agent check alone cannot verify a secure workstation configuration. Configure actual lockdown through Safe Exam Browser or Windows kiosk mode. The centre administrator configures a duplicate TFT using **Win + P → Duplicate**.

## Upgrading an existing installation

Apply the migrations before deploying the updated frontend. Existing accounts keep their roles until an administrator grants author access. Existing schedules keep their earlier immediate-review setting. For a schedule already started before the upgrade, later starters receive the first starter’s saved question set. Existing scores remain intact. Student cohort ranks are suppressed for those schedules because their earlier papers may have differed. A new schedule always freezes its paper before the first candidate enters.

The current release serves one institution per deployment. The reviewed expansion plan in `ARCHITECTURE_REVIEW.md` describes multi-college permissions, coding assessments, optional section clocks, and the 500-candidate staging rehearsal.

## Repository layout

| Directory | Purpose |
| --- | --- |
| src/pages | Authentication, student and admin dashboards, question bank, test wizard, schedules, exam room and reports |
| src/components | Navigation, authenticated routes, accessible dialogs, palette and feedback |
| src/hooks | Offline answer queue, timer synchronization and browser-event monitoring |
| src/lib | Supabase client, CSV and Excel support, PDF export and sign-in return paths |
| src/store and src/types | Zustand session state and shared TypeScript models |
| supabase/migrations | Ordered SQL for tables, policies, scoring, private storage, reports and expiry |
| supabase/functions/import-students | Administrator-authorized invitations |
| scripts | Repeatable development seed |
| tests | Executable PostgreSQL and seed regression checks |

## Verification

```sh
npm test
npm run build
```

The tests use a PostgreSQL-compatible PGlite instance with Auth role fixtures. They cover profile approval, role isolation, group assignment, papers without answer keys, late entry, immutable active papers, retry-safe autosave, negative marks, demo retakes, expiry, private image policies, duplicate warnings, threshold submission, report totals and repeatable seeds. The seed test exercises the actual seed script through a local API fixture. An active Supabase project is needed to exercise real email delivery, Storage signed URLs, the deployed Edge Function and the installed cron scheduler.

On a connected project, check the cron installation with:

```sql
select jobname, schedule, active from cron.job
where jobname = 'campusprep-expire-attempts';
```

To check the complete hosted flow, sign in as an approved student, open an assigned schedule, answer and mark a question, refresh, trigger a permitted practice warning, submit, and compare the candidate score with the administrator report.
