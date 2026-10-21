# CLAUDE.md — Token-Based Queue Management System (Hygieia Wellness Clinic)

Rules agreed in the /grill-me session (2026-10-21), revised on 2026-10-22 to per-service queues,
staff priority and "appointments first at their time". These are the source of truth for
`queue-app/lib/queue.ts`. Priority if anything conflicts:
`docs/Queue_Management_Initial_Guidelines.md` > this file > `project-brief.md`.
If a build instruction conflicts with these, stop and ask.

## Project

- Repo: https://github.com/zayannnn2000/Queue_Management_System (root holds `docs/`,
  `project-brief.md`, `CLAUDE.md`, `queue-app/`). Vercel root directory = `queue-app`.
- Next.js (App Router) + TypeScript + Tailwind in `queue-app/`.
- All queue logic lives in `queue-app/lib/queue.ts` as **pure functions** (no I/O, no UI,
  `now` always passed in). Run Vitest after every change to it.
- Fictional sample data only. Staff pages behind a shared staff PIN (`STAFF_PIN`).

## Queues and rooms

- **One front desk** issues tokens. Every patient joins the **queue of their service**.
- **Five service queues**, each served by its own room(s), which call only from that queue:

| Service | Letter | Default length | Rooms (default) |
|---|---|---|---|
| Consultation | C | 15 min | 1 (`Consultation · Room 1`) |
| Follow-up | F | 10 min | 1 |
| Blood test | B | 5 min | 1 |
| Vaccination | V | 5 min | 1 |
| Prescription renewal | P | 5 min | 1 |

- Rooms per service are editable in Settings (1–4). Other settings: timezone Asia/Dhaka,
  grace period 10 min, **walk-in protection 30 min** (0 = off), default lengths.
- **Services can be added and removed in Settings** (revised 2026-10-22). A new service needs a
  unique name (1–30 chars), a **unique token letter A–Z**, a default length (1–240 min) and rooms
  (1–4); it gets its own queue, rooms, colour and display panel at once. At most 10 services.
  A service can be removed only when none of its patients is booked, waiting or being served
  today, and never the last one; its finished patients stay in today's history. Reset day and
  the daily rollover keep the service list.

## Tokens and days

- Token = **service letter + W (walk-in) or A (appointment) + 3 digits**: `CW-004`, `BA-002`.
  Each prefix has its own sequence. All restart daily (first request on a new Dhaka date) and on
  **Reset day**.
- A token never changes once issued. Changing a patient's **service** is not an edit: cancel
  and add them again (the new service is a different queue with its own token).

## Patients

- Fields: **name** (required, 1–40 chars, fictional) and **service**. Nothing else.
- Walk-in: added → `waiting`, `arrivedAt = now`, target = arrival — **unless** an appointment of
  the same service (another patient, booked or checked in) is scheduled after arrival and within
  15 min (inclusive): then target = **arrival + 15 min** (`hold = { until, for }`), so that
  appointment is called first. Decided once at arrival; a booking made later doesn't move it.
  Applies to late arrivals re-queued as walk-ins too. If the appointment patient isn't here, the
  walk-in is still called when nobody else waits (idle-fill), so a room is never left idle.
- Appointment: booked for today, now or later, 5-minute slots → `booked` (not queued).
  **No double-booking within a service**: overlapping active appointments of that service may
  not exceed its rooms. Reducing rooms never cancels bookings; Settings lists over-capacity
  overlaps.
- Check-in → `waiting`, `arrivedAt = now`. Within scheduled + grace → target = scheduled time.
  Later → late-converted: keeps its A-token, joins as a walk-in, target = arrival.
- Overdue booked appointments are flagged; staff check in, mark no-show or cancel.
- Edits (name, appointment time) while booked or waiting; locked once called.

## Priority (staff)

- Staff may flag a **waiting** patient as **Priority** with a reason: Elderly, Pregnant,
  Disability, Urgent, Other. `priority = { reason, at }`. Staff may remove the flag.
- **Call now**: when a room is free, staff may call any waiting patient of that room's service
  directly. The reason shown is "called by staff".

## Call next (per room, executed server-side, within the room's service queue)

At time `t`, among that service's `waiting` patients (none → room stays free):
1. **Priority** patients first, earliest `priority.at` first (always treated as due).
2. **Due appointments** (not late-converted, scheduled ≤ t) and **protected walk-ins**
   (walk-ins or late-converted with `t − arrivedAt ≥ protection`), ordered by target time.
3. **Other due walk-ins**, by arrival.
4. Nobody due → the **earliest upcoming** target (idle-fill).
5. Ties: appointment first, then lower token number.
- With protection 0, step 2 contains due appointments only.
- Close-out: Served, No-show, Served & call next (only while someone else waits in that queue).
- The reason for every call is shown (who and why).

## Wait-time estimate (per service queue)

- Expected length per service = mean of last 5 served visits, each clamped to
  [1 min, 3 × default]; none → default. No-shows never count.
- Each room of the service is free at now (idle) or now + max(expected − elapsed, 1 min).
- Forward simulation per service: take the room that frees first at `t`, apply the call-next
  rule at `t`, start = `t`, room free again at `t + expected`. Wait = start − now; position =
  order within the service queue.
- Shown as "Due now" (≤ 2 min) or "~X min" rounded up to 5.

## Screens

- `/staff`: room cards (one per service room: now serving, Call next, Served, No-show, Served &
  call next, why), Add patient, Next-hour strip (one lane per room), lists filterable by service
  with Priority / Call now / Print / Edit / Cancel, service times. Settings: rooms per service,
  grace, walk-in protection, lengths, sample day, reset day.
- `/display`: one panel per service: now serving (token, initial, room), the next tokens with
  wait. `?token=` / Find my token highlights a patient and names their room.
- Token slip: token, service, room, booking, place, wait, issued time, QR to the display.

## Seed data

Fictional, relative to now, spread over the five services: some served (fills averages), some
being served, waiting walk-ins, an early checked-in appointment, a booked one, an overdue one.
