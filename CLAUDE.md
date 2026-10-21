# CLAUDE.md — Token-Based Queue Management System

Final rules agreed in the /grill-me session (2026-10-21). These are the source of truth for
`queue-app/lib/queue.ts`. Priority if anything conflicts:
`docs/Queue_Management_Initial_Guidelines.md` > this file > `project-brief.md`.
If a build instruction conflicts with these, stop and ask.

## Project

- Repo: https://github.com/zayannnn2000/Queue_Management_System (root holds `docs/`,
  `project-brief.md`, `CLAUDE.md`, `queue-app/`). Vercel root directory = `queue-app`.
- Next.js (App Router) + TypeScript + Tailwind in `queue-app/`.
- All queue logic lives in `queue-app/lib/queue.ts` as **pure functions** (no I/O, no UI,
  `now` always passed in). Run Vitest after every change to it.
- Commit after each stage. Fictional sample data only.

## Configuration (defaults, all editable in settings)

| Setting | Default |
|---|---|
| Theme | Clinic |
| Timezone ("today") | Asia/Dhaka |
| Counters | 1 (range 1–4) |
| Grace period | 10 min |
| General consultation | 15 min |
| Follow-up | 10 min |
| Blood test | 5 min |
| Vaccination | 5 min |
| Prescription renewal | 5 min |

## Tokens and days

- Walk-ins: `W-001`, `W-002`, … Appointments: `A-001`, `A-002`, … Separate sequences.
- Tokens reset daily. The first request on a new Asia/Dhaka date starts a fresh queue;
  a manual **Reset day** button also exists.
- A token never changes once issued (including on edit or late conversion).

## Customer data

- Fields collected: **name** (required, 1–40 chars, fictional) and **service**. Nothing else.
- Model: `Customer { id, token, name, type: 'walk_in'|'appointment', service, scheduledAt?,
  arrivedAt?, checkedIn, status: 'booked'|'waiting'|'serving'|'served'|'no_show'|'cancelled',
  calledAt?, servedAt?, counter?, lateConverted }`

## Walk-ins

- Added by staff → status `waiting`, `arrivedAt = now`, **target = arrival time**.

## Appointments

- **Booking**: today only, scheduled time **now or later**, 5-minute steps. Someone already
  present is added as a walk-in instead. Status `booked` (not in the queue).
- **No double-booking**: an appointment's window = `scheduledAt` → `scheduledAt +` service
  default duration. Reject a booking (or edit) if the number of active appointments
  (`booked` or `waiting` appointment-type, not late-converted) overlapping that window would
  exceed the number of counters. With 1 counter, no overlap at all. The error names the clash,
  e.g. "10:30–10:45 clashes with A-002 (10:35)".
- **Counters reduced later**: existing bookings are kept, never auto-cancelled; settings show a
  warning listing over-capacity overlaps. Only new bookings/edits are checked against the new
  limit.
- **Check-in** (staff action) → status `waiting`, `arrivedAt = now`:
  - `arrivedAt ≤ scheduledAt + grace` (on time or early) → **target = scheduledAt**.
  - `arrivedAt > scheduledAt + grace` → **late-converted**: `lateConverted = true`, keeps its
    A-token, shows a "Late → walk-in" badge, **target = arrivedAt**, ranks as a walk-in in ties.
- **Overdue**: a `booked` appointment past `scheduledAt + grace` shows an **Overdue** flag.
  Staff may Check in (→ late conversion), mark No-show, or Cancel. Nothing is automatic and it
  never blocks the queue.
- **Early appointments** keep target = scheduledAt; they are served early only via idle-fill.

## Editing

- Name, service, and (appointments) scheduled time are editable while `booked` or `waiting`.
  Locked once called.
- Editing a scheduled time re-runs the double-booking check.
- Editing a checked-in appointment's scheduled time re-evaluates lateness against its recorded
  `arrivedAt` (may convert to, or back from, late walk-in).

## Call next (per counter, executed server-side)

1. Candidates = customers with status `waiting` (checked in). Booked/not-arrived excluded.
   None → counter stays idle.
2. Anyone **due** (`target ≤ now`)? → call the **earliest target**.
3. Nobody due → call the **earliest upcoming target** (idle-fill, avoids an idle counter).
4. **Ties** (equal target): appointment (non-late-converted) first, then lower token number
   within the same type.
5. Called customer → status `serving`, `calledAt = now`, `counter = n`.
6. Return **who** and **why** (e.g. "A-003 called: appointment due at 10:30, earliest due
   target"); UI shows it.
7. "Call next" is disabled while that counter is serving. Close-out actions: **Served**,
   **No-show**, and a **Served & call next** shortcut.
8. No "Return to queue". A no-show who turns up later is re-added as a new walk-in.
9. `waiting` or `booked` customers may be **Cancelled**.
10. Writes use a version check so two staff can't call the same customer.
11. After every change, recompute all waits; the display refreshes.

## Wait-time estimate

- **Expected duration per service** = mean of the last 5 `served` durations
  (`servedAt − calledAt`) for that service, each sample clamped to
  `[1 min, 3 × default]`. Fewer than 5 samples → mean of what exists; none → default.
  No-shows and cancellations never count.
- **Counter free time** = `now` if idle, else `now + max(expected − elapsed, 1 min)`.
- **Forward simulation**: repeatedly take the earliest-free counter at time `t`, apply the
  **exact call-next rule at `t`** (earliest due target with `target ≤ t`, else earliest
  upcoming), start = `t`, that counter becomes free at `t + expected(service)`.
  `wait = start − now`; **position** = order in this projection (1 = next called).
- **Display**: `wait ≤ 2 min` → "Due now"; otherwise "~X min" with X rounded **up** to the
  next multiple of 5.

## Screens

- `/staff`: add-customer form (walk-in / appointment), Booked list (Check in, No-show,
  Cancel, Edit, Overdue flag), waiting queue table (token, name, type, service, target,
  position, wait, late badge, Edit, Cancel), counter cards (now serving, Call next, Served,
  No-show, Served & call next, last "who & why"), settings (counters, grace, service
  durations, capacity warning), Seed and Reset day buttons. **No login** — documented
  limitation.
- `/display`: read-only TV board. Token + first-name initial only (e.g. "W-004 · S."),
  now-serving per counter, waiting list with position and wait. Booked-but-not-arrived
  appointments hidden. Polls every 3 s. `/display?token=W-004` highlights that row.

## Storage

- Upstash Redis (Vercel Marketplace) behind Next.js API routes, 3 s polling.
- Local dev without Redis: in-memory / file store so the API still works.

## Seed data ("Seed" replaces today's data, times relative to now)

About 10 fictional customers: 3 served (to fill averages), 1 serving, 3 waiting walk-ins,
1 early checked-in appointment, 1 booked appointment due later, 1 overdue booked appointment.
