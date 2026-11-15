# CampusPrep CBT

CampusPrep is a computer-based mock examination platform for college and UGC NET practice. Students use an email-verified account. A centre administrator approves their registration, builds papers, assigns schedules and reviews results. Faculty can submit original questions through a separate author workspace. The exam screen includes section tabs, a question palette, marked responses, a server-timed countdown and a submission summary.

---

## Deploy to Vercel with Hosted Supabase

### 1. Set Up Supabase
1. Create a project at [supabase.com](https://supabase.com/).
2. In the **SQL Editor**, run the database migrations:
   - Run `supabase/combined_migrations.sql` to initialize all tables, RLS policies, triggers, and RPCs.
   - Run `supabase/migrations/20261115000100_super_admin_and_roles.sql` to enable the `super_admin` role and role management.
3. In **Authentication → URL Configuration**:
   - **Site URL**: `https://your-project.vercel.app`
   - **Redirect URLs**:
     ```text
     https://your-project.vercel.app/**
     http://localhost:5173/**
     http://127.0.0.1:5173/**
     ```

### 2. Configure Email (SMTP & Nodemailer)
#### Option A: Supabase Custom SMTP (for auth verification & password resets)
1. In your Google Account, enable 2-Step Verification and generate a 16-character **App password** under **Security → App passwords**.
2. In Supabase Dashboard → **Project Settings → Authentication → SMTP Settings**, enable **Custom SMTP**:
   - **Sender email**: `your-email@gmail.com`
   - **Sender name**: `CampusPrep`
   - **Host**: `smtp.gmail.com`
   - **Port**: `465` (SSL) or `587` (TLS)
   - **Username**: `your-email@gmail.com` *(must be your full email)*
   - **Password**: *your 16-character Google App Password*
3. *(Optional for testing)*: Under **Authentication → Providers → Email**, you can toggle **Confirm email** to **OFF** if you want students to register and sign in immediately without waiting for verification emails.

#### Option B: Nodemailer API on Vercel (for custom notifications)
The app includes a serverless API at `/api/send-email` powered by `nodemailer`. To enable it on Vercel, add the SMTP variables described below.

### 3. Deploy on Vercel
1. Import your Git repository into [Vercel](https://vercel.com/).
2. In **Project Settings → Environment Variables**, add the following:

| Variable | Description / Example |
| :--- | :--- |
| `VITE_SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase publishable / anon public key |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | *(Same as anon key)* |
| `SMTP_HOST` | `smtp.gmail.com` *(for Nodemailer)* |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `your-email@gmail.com` |
| `SMTP_PASS` | *Your 16-character Google App Password* |
| `SMTP_FROM` | `"CampusPrep CBT" <your-email@gmail.com>` |

3. Click **Deploy** (or if already deployed, trigger a **Redeploy** with *Use existing Build Cache* **unchecked**).

---

## High-Concurrency Guidelines (1,000+ Concurrent Students)

If you plan to run live examinations with hundreds or thousands of students simultaneously:

1. **Vercel (Frontend):** Vercel's Edge CDN will serve static client assets smoothly for thousands of users without issue.
2. **Supabase (Backend):**
   - **Upgrade to Supabase Pro ($25/mo):** The Free Tier allows only ~60 direct connections and 1GB RAM, which will choke under 1,000 concurrent students.
   - **Supavisor Connection Pooling:** Supabase Pro includes Supavisor, which pools and multiplexes thousands of active connections into PostgreSQL in transaction mode.
   - **Compute Scaling:** Scale compute to **Small (2GB RAM, 2 vCPU)** or **Medium** in Supabase Settings for the duration of the exam.
3. **Turn OFF "Confirm email" or Pre-create Students:**
   - Free Gmail SMTP has a hard limit of **500 outgoing emails/day**.
   - To avoid hitting this limit on exam day, pre-import students using the **Admin CSV Import** or disable email confirmation in Supabase.
4. **Auth Rate Limits:** In Supabase Dashboard → **Authentication → Rate Limits**, ensure the sign-in limit is set high enough so 1,000 students signing in within an entry window are not throttled.

---

## Run Locally

Use Node.js 22 or newer, npm, and optionally the Supabase CLI and Docker for the local Supabase stack.

```sh
npm install
npm run dev
```

### Environment Configuration (`.env.local`)
Create `.env.local` in the project root:

```env
# Frontend Supabase configuration (Used automatically by Vite)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key

# Nodemailer configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM="CampusPrep CBT" <your-email@gmail.com>

# Server / Local script variables (for scripts/seed.mjs)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Open **http://localhost:5173**. Running Vite loads `.env.local` automatically.

---

## Create the First Administrator

Register at `/register` using your administrative email, verify the address, and retrieve your user UUID from Supabase Authentication. In the Supabase SQL editor, run:

```sql
update public.profiles p
set role = 'admin', status = 'approved'
from auth.users u
where p.id = u.id
  and u.id = '00000000-0000-0000-0000-000000000000'::uuid
returning p.id, p.email, p.role, p.status;
```

To assign a **Super Administrator** who can manage other administrators and roles:

```sql
update public.profiles p
set role = 'super_admin', status = 'approved'
where p.id = '00000000-0000-0000-0000-000000000000'::uuid;
```

Sign in again to refresh account status.

---

## Sample Accounts and Examinations

Populate a local or practice project with demo data:

```sh
node --env-file=.env.local scripts/seed.mjs --allow-remote
```

The seed script creates the following fixtures and saves credentials to `.seed-accounts.json`:

| Role / Item | Details |
| :--- | :--- |
| **Administrator** | `officer@campusprep.example` |
| **Approved Students** | `ananya@campusprep.example`, `kabir@campusprep.example`, `meera@campusprep.example` |
| **Interface Demo** | 9 original questions, 15 minutes, unlimited retakes |
| **Scheduled Practice Paper** | 20 original questions across Paper I and Paper II, 40 minutes |
| **Assigned Schedule** | Assigned to the demo students; opens at seeding and remains open for 24 hours |

---

## Running a Mock Examination

1. **Prepare the Roster:** Open **Students**, review details and approve students. Use the CSV template to send account invitations or import students in bulk.
2. **Review Faculty Questions:** From **Faculty submissions → Manage faculty author access**, grant an approved faculty account author access (`/content_author`). Authors submit drafts; administrators review and approve them into the bank.
3. **Build the Paper:** In **Question bank**, create subjects and add questions (or import via CSV/XLSX). Set options, correct answer, explanation, positive and negative marks, and difficulty.
4. **Publish and Assign:** In **Test papers**, create sections and add questions. Preview and publish the paper. Under **Schedules**, set start/end dates, late-entry window, warning limits, and recipient students/groups.
5. **Take the Test:** Students review instructions, complete system checks, and start. Native controls support keyboard navigation. Answers autosave immediately.
6. **Review & Analytics:** Students receive scores upon submission. Administrators access leaderboards, section scores, question analytics, individual attempt reviews, and violation audit logs. Export reports to CSV or PDF.

---

## Timing, Grading and Proctoring

- **Entry & Timing:** The schedule opens at `start_at`. Entry closes at `start_at + late_entry_min`. The server derives remaining time from the deadline and rejects late submissions. Stale attempts are swept automatically.
- **Grading & Snapshots:** Each candidate gets one attempt per schedule. Active schedules freeze question order, marks, and answer keys. The grading key remains in the `private` schema. Correct answers earn marks; wrong answers incur configured deductions; unanswered questions score zero.
- **Proctoring & Integrity:** Browser events (tab switching, fullscreen exit, devtools, copy-paste, window blur) log violation records with unique event IDs. Reaching the schedule's warning limit automatically auto-submits the attempt.
- **Network Resilience:** During network drops, answers and violation events queue in browser storage and retry automatically. A synchronized heartbeat validates attempt state and server time.

---

## Repository Layout

| Directory / File | Purpose |
| :--- | :--- |
| `api/send-email.ts` | Vercel Serverless Function for Nodemailer email delivery |
| `src/pages` | Auth, student & admin dashboards, question bank, test builder, schedules, exam room, reports |
| `src/components` | Layout shell, guard, accessible modals, question palette, common toasts |
| `src/hooks` | Offline answer queue, attempt heartbeat, proctoring & violation listeners |
| `src/lib` | Supabase client (`db.ts`), email client (`email.ts`), PDF & CSV helpers |
| `src/store` & `src/types` | Zustand authentication session store and TypeScript interfaces |
| `supabase/combined_migrations.sql` | Consolidated database schema, RLS policies, RPCs, and cron triggers |
| `supabase/migrations` | Individual modular SQL migrations (roles, authoring, proctoring, review) |
| `scripts` | Database seed and fixture population script (`seed.mjs`) |
| `vercel.json` | Vercel SPA routing rewrites with `/api/*` serverless pass-through |

---

## Verification & Build

```sh
# Run unit and regression tests
npm test

# Verify production build and TypeScript checks
npm run build
```
