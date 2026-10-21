# Project Brief: Token-Based Queue Management System

> **For Claude Code:** Read this file in full before planning. It summarises the decisions
> made while preparing the build. Treat it, together with
> `docs/Queue_Management_Initial_Guidelines.md`, `docs/workflow-overview.png` and
> `docs/call-next-logic.png`, as the source of truth. If the guidelines file conflicts with
> this brief, the guidelines file wins. If my build prompt conflicts with any of them, stop
> and ask me. Once /grill-me finalises the rules, copy the final rules into `CLAUDE.md`.

---

## 1. Scenario and requirements (from `Queue_Management_Initial_Guidelines.md`)

- **Scenario:** A clinic or salon wants a simple token-based queue management platform for
  walk-in customers and scheduled appointments. Staff need a clear view of the queue.
  Customers need to understand their position and estimated waiting time.
- **Staff must be able to:**
  - Add customers to the queue as walk-ins or scheduled appointments.
  - View the current queue, including customer names, token numbers and booking types.
  - Identify and call the next customer.
  - View the estimated waiting time for customers in the queue.
- **Customers:** a public queue or status view showing their own position and estimated
  waiting time. No customer login.
- **Deliberate tension:** customers must be served fairly and in order, while appointments
  are also served according to their scheduled times. No service-duration data or
  prioritisation rules are provided, and the two goals can conflict. Assumptions,
  decisions and trade-offs must be clearly documented.
- **Development guidelines:**
  - Build a functional, interactive application, not a static mockup.
  - Use realistic but fictional sample data. Never use real customer names or personal data.
  - Make the interface intuitive and suitable for clinic or salon staff.
  - Deploy to Vercel for a public URL. If Vercel is genuinely unavailable, any free public
    host is acceptable, and the host used and the reason must be noted.
  - A working, clearly reasoned simple application beats a beautiful but unfinished one.

## 2. Environment and project setup

- Building in **Claude Code (desktop app)**, signed in with my claude.ai account, so my
  claude.ai skills sync automatically (confirmed via `/skills`).
- The project root is my "vibe coding system workflow" folder. Its name may contain spaces
  or capitals, so the Next.js app goes in a subfolder named **`queue-app`**, which is
  lowercase with no spaces.
- Folder layout:
  ```
  <project root>/
  ├── docs/
  │   ├── Queue_Management_Initial_Guidelines.md
  │   ├── workflow-overview.png
  │   └── call-next-logic.png
  ├── project-brief.md   (this file)
  ├── CLAUDE.md          (created after /grill-me)
  └── queue-app/         (Next.js app)
  ```
- Start in **plan mode**. Commit to git after each stage. Run Vitest after every change to
  `lib/queue.ts`.

## 3. Skills and where each is used

| Skill | Use in this project |
|---|---|
| `grill-me` | Before any code: lock down queue rules (grace period, early/late appointments, ties, no-shows, multiple counters) |
| `vercel-react-best-practices` | All Next.js/React code: data fetching, 3s polling, avoiding unnecessary re-renders |
| `vercel-composition-patterns` | Reusable components: QueueTable, TokenCard, CustomerForm, NowServing |
| `design-taste-frontend` | Visual design of `/staff` (working screen) and `/display` (TV status board) |
| `web-design-guidelines` | Accessibility and UX audit of both screens, then fix the issues found |
| `playwright-cli` | End-to-end tests: add → check-in → call next → serve → no-show, with display sync |
| `built-in-browser` | Manual click-through on localhost and on the live URL |
| `deploy-to-vercel` | Deploy and return the public URL |
| `pdf` | Draft the 1–2 page documentation |

## 4. Workflow (see `docs/workflow-overview.png`)

1. **Walk-in arrives.** Staff add name and service. The customer gets a **W-token** and
   their target time is their arrival time.
2. **Appointment booked.** An **A-token** is issued, but the customer is *not* queued yet.
   They join the queue only when **checked in on arrival**. If they arrive later than the
   grace period, they are converted to a walk-in.
3. Both paths merge into **one waiting queue, sorted by target time**.
4. The **public display** updates from the queue: token, position, and estimated wait.
5. **Staff press "Call next".** The system picks the earliest due target (see section 5).
6. **Serving at counter.** The call time is recorded.
7. **Close-out** as served, no-show, or cancelled. Actual service duration feeds the wait
   estimate.

## 5. Call-next decision logic (see `docs/call-next-logic.png`)

1. Is anyone checked in? If **no**, the counter stays idle. Appointments that haven't
   arrived are excluded.
2. Is anyone **due now** (target time ≤ current time)?
   - **Yes:** call the earliest target.
   - **No:** call the earliest *upcoming* target, so the counter isn't left idle.
3. **Ties:** the appointment goes first, then the lower token number.
4. After every call, **recompute all waits** and refresh the display.
5. The "Call next" button shows **who** was picked and **why**.

### Target-time rules

| Customer | Target time |
|---|---|
| Walk-in | Arrival time |
| Appointment, checked in on time or early | Scheduled time |
| Appointment, arrived after scheduled time + grace | Arrival time (converted to walk-in, flagged in the UI) |

## 6. Estimated waiting time

- **Service duration** = rolling average of the last 5 actual durations (called → served)
  for that service. Before any data exists, it falls back to a configurable default per
  service.
- **Forward simulation:** each counter becomes free at *now + remaining time of its current
  customer*. For each waiting customer, in projected call order:
  `start = max(earliest free counter, target time)` and `wait = start − now`.
- **Display:** "~X min" rounded to 5 minutes, or "Due now" when ≤ 2 min. Recalculate on
  every change.

## 7. Assumptions (to be confirmed or changed in /grill-me)

- Default grace period is **10 minutes**.
- Default is **1 counter** (configurable).
- Each service type has a default duration (configurable) until real data exists.
- Early appointments wait for their slot unless the counter would otherwise be idle.
- Tokens reset daily.
- The public display shows only the token and first-name initial, for privacy.
- No customer login. No real payment, SMS, or notification integration.

## 8. Trade-offs to document

- When an appointment comes due, a walk-in may wait up to **about one extra service
  duration**. In exchange, appointments are honoured at their scheduled time, and nobody
  overtakes a customer with an earlier target.
- Early appointments **do not jump the queue**. They are served early only if nobody else
  is due.
- Late appointments lose their slot, which protects walk-ins who arrived on time.
- Wait times are **estimates**. Accuracy improves as real durations accumulate.
- If shared storage (Upstash Redis) isn't available, the localStorage fallback syncs only
  within one browser. This is noted as a limitation.

## 9. Technical decisions

- Next.js (App Router), TypeScript, Tailwind.
- Shared state via **Upstash Redis** (Vercel Marketplace) behind Next.js API routes, with
  3s polling. Fallback: localStorage + BroadcastChannel.
- All queue logic lives in a **pure module `lib/queue.ts`**, with no UI or I/O, so it can
  be unit tested.
- Pages: `/staff` (console) and `/display` (public), with `/display?token=W-004`
  highlighting one customer.
- Data model: `Customer { id, token, name, type, service, scheduledAt?, arrivedAt?,
  checkedIn, status (waiting|serving|served|no_show|cancelled), calledAt?, servedAt?,
  counter?, lateConverted }`
- "Seed" button with about 10 fictional customers, plus a "Reset day" button.

## 10. Required tests

**Vitest (`lib/queue.ts`):**
- Pure FIFO walk-ins.
- An appointment due before an earlier-arriving walk-in.
- An early appointment waiting for its slot.
- A late appointment converted to a walk-in.
- A tie between an appointment and a walk-in.
- 2 counters.
- The wait estimate updating after a service finishes.
- An idle counter with only a future appointment waiting.

**Playwright:**
- The full staff flow.
- `/display` reflecting each change.

## 11. Order of work

1. `/grill-me` session, then write the final rules to `CLAUDE.md` (**pause and show me**).
2. `lib/queue.ts` + Vitest tests (**pause and show me the results**).
3. API routes + storage.
4. `/staff` page.
5. `/display` page.
6. Seed data.
7. `web-design-guidelines` audit and fixes.
8. Playwright E2E tests + built-in-browser check.
9. `deploy-to-vercel`.
10. Browser check on the live URL.
11. README + documentation (`pdf`).

## 12. Deliverables (from the guidelines)

- **Live application:** the deployed public URL, plus the host used. If it isn't Vercel,
  note why.
- **Source code:** a link to a public repository (GitHub or GitLab).
- **Brief documentation (1–2 pages):** key design decisions, assumptions, queue-handling
  logic, and waiting-time calculations.
- **README:** how to run, ordering rule, wait-time formula, assumptions, limitations,
  trade-offs.
- **AI Usage Log section:** the prompts used to build and debug the application, what was
  accepted or changed, and how the resulting behaviour was tested.

## 13. AI Usage Log notes (for me, not for the build)

- Log every prompt and the meaningful follow-ups, including this brief, the build prompt,
  the /grill-me answers, and debugging prompts. Record how each behaviour was tested.
- Entry already drafted for the workflow step: I analysed the workflow, visualised it,
  matched it against the requirements, curated it, and asked Claude to follow it as the
  build reference.
- Error caught: an AI session was told a `master_skills.md` file existed. It checked, found
  the file missing, and reported this rather than pretending to use it. The file has since
  been deleted, and the installed skills are referenced instead.
