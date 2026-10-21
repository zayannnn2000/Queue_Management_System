# Token-based clinic queue

A queue for walk-ins and appointments at a small clinic (the demo "Hygieia Wellness Clinic"). Staff add
patients, call the next one and see estimated waits; patients follow their place on a public display.

- **Live app:** https://queue-management-system-jet-six.vercel.app
  - Staff console: [`/staff`](https://queue-management-system-jet-six.vercel.app/staff) (demo staff PIN `12345`) ·
    settings: [`/staff/settings`](https://queue-management-system-jet-six.vercel.app/staff/settings)
  - Waiting-room display: [`/display`](https://queue-management-system-jet-six.vercel.app/display),
    with `?token=W-004` to highlight one patient
- **Host:** Vercel (Next.js), shared state in Upstash Redis from the Vercel Marketplace.
- **Sample data:** Settings → *Load sample day* loads 10 fictional patients. All names are invented.

## How to run

Requires Node.js 22+ (built on 24 LTS).

```bash
cd queue-app
npm install
npm run dev          # http://localhost:3000 (redirects to /staff)
npm test             # Vitest: queue logic (lib/queue.ts) and seed data
npm run test:e2e     # Playwright: staff flow + display sync (uses installed Edge; PW_CHANNEL=chrome to switch)
npm run build        # production build
```

Without Redis credentials the app keeps the queue in the server's memory, which is fine for local use.
To share state across instances, set `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the
`UPSTASH_REDIS_REST_*` pair); on Vercel the Upstash integration sets them.

E2E against the live site: `E2E_BASE_URL=https://queue-management-system-jet-six.vercel.app npm run test:e2e`
(it resets the day's data).

## Layout

```
docs/                     requirements, workflow diagrams, documentation draft
CLAUDE.md                 the final queue rules (source of truth for lib/queue.ts)
queue-app/
  lib/queue.ts            all queue logic: pure functions, `now` always passed in
  lib/time.ts             Asia/Dhaka day key, 5-minute slots
  lib/seed.ts             fictional sample day
  lib/store.ts            Upstash Redis or memory, compare-and-set on version
  app/api/state           GET staff view, or ?view=public (token + initial only)
  app/api/action          POST one staff action, applied atomically
  app/staff, app/display  the two screens
  tests/, e2e/            Vitest and Playwright
```

## Staff PIN

The front desk (`/staff`, its settings and the staff API) is behind one shared staff PIN; the waiting-room
display stays public.

> **Demo PIN: `12345`.** This is a simulation with fictional patients, so the PIN for the live demo is
> published here on purpose so reviewers can sign in. A real clinic would keep its PIN out of the repository.

- Set it on Vercel, then redeploy: `vercel env add STAFF_PIN production` (4–8 digits), then `vercel --prod`.
  To change it, `vercel env rm STAFF_PIN production`, add it again, and redeploy; everyone is signed out.
- A correct PIN gives that browser a signed, httpOnly cookie for 12 hours (one shift). **Lock** signs it out.
- 5 wrong PINs from one address lock sign-in for 5 minutes (counted in Redis on Vercel).
- Without `STAFF_PIN` (local development) the front desk is open.
- Optional `AUTH_SECRET`: any long random string, mixed into the cookie signature.
- Testing with a PIN: run a server with `STAFF_PIN=<test pin>`, then
  `E2E_BASE_URL=<that url> E2E_STAFF_PIN=<test pin> npm run test:e2e`.

## Printing token slips

When a walk-in is added or an appointment checks in, the front desk shows the token with a **Print token**
button; every row in the Waiting list also has **Print** for a reprint. The slip carries the token, booking,
service, place in line, estimated wait, the time issued and the display link for that token. It shows no
patient name. It's laid out for an 80 mm receipt printer and prints on any printer through the browser's print dialog.

## Ordering rule

Every checked-in patient has a **target time**:

| Patient | Target time |
|---|---|
| Walk-in | arrival time |
| Appointment, checked in on time or early (up to scheduled time + 10 min grace) | scheduled time |
| Appointment, checked in after the grace period | arrival time: re-queued as a walk-in, keeps its A-token, flagged "Late, now walk-in" |

**Call next** (per counter, run on the server):

1. Nobody checked in → the counter stays free. Booked appointments that haven't arrived never block the queue.
2. Anyone **due** (target ≤ now) → call the earliest target.
3. Nobody due → call the earliest **upcoming** target, so the counter is not left idle. This is the only
   way an early appointment is seen before its slot.
4. Ties → appointment before walk-in, then the lower token number.

The screen shows who was called and why, e.g. *"A-003 called: appointment at 10:30, the earliest due target."*

## Wait-time formula

- **Expected duration per service** = mean of the last 5 real visits (called → served) for that
  service, each clamped to 1 min … 3 × the default. No visits yet → the configured default
  (consultation 15, follow-up 10, blood test 5, vaccination 5, prescription renewal 5 min).
  No-shows and cancellations never count.
- **Each counter is free at** `now` if idle, otherwise `now + max(expected − elapsed, 1 min)`.
- **Forward simulation:** repeatedly take the counter that frees up first, at time `t`, and apply the
  *same* call-next rule at `t` (earliest due target, else earliest upcoming). That patient starts at `t`;
  the counter is next free at `t + expected(service)`.
  `wait = start − now`, and **position** is the order in this projection.
- **Shown as** "Due now" when ≤ 2 min, otherwise "~X min" rounded **up** to the next 5.
- Recomputed on every change and every 3-second poll. The staff "Next hour" strip draws the same projection.

## Assumptions

- One clinic, timezone Asia/Dhaka. Tokens (`W-001…`, `A-001…`) restart each clinic-local day; *Reset day* does it by hand.
- 1 counter by default, configurable 1–4. Any counter can serve any patient.
- Grace period 10 min, configurable 0–60.
- Appointments are booked for today only, in 5-minute slots, at or after the current time. Someone already present is a walk-in.
- **No double-booking:** an appointment occupies scheduled time → + the service's default duration. A booking is refused when the
  overlapping active appointments would exceed the number of counters. Reducing counters later never cancels bookings; Settings lists the overlaps.
- No automatic no-shows. An appointment past its grace period is flagged *Overdue*; staff check it in (it becomes a walk-in), mark no-show or cancel.
- A called patient who doesn't come is marked no-show. If they return, they are added again as a new walk-in. There is no "return to queue".
- Name, service and (for appointments) time can be edited while booked or waiting, never after being called. Editing a checked-in
  appointment's time re-checks lateness against its recorded arrival.
- Only a name and a service are collected. The public display shows the token and first initial only.
- No customer login, payments, SMS or notifications.

## Trade-offs

- **Appointments are honoured at their time; walk-ins may wait about one extra service.** When an appointment comes due it goes ahead
  of walk-ins who arrived later than its slot, but nobody is overtaken by someone with a later target.
- **Early appointments don't jump the queue.** They are seen early only when nobody else is due.
- **Late appointments lose their slot,** which protects the walk-ins who arrived on time.
- **Idle-fill can delay an appointment slightly:** calling an early patient into a free counter may mean the counter is busy when a
  later slot comes due. Keeping the counter working was judged worth it; the estimate already accounts for it.
- **The overlap check is conservative:** it counts every booking that overlaps the window, so with 2+ counters it can refuse a slot
  where the real peak would just fit. Simple to explain beats squeezing the last slot.
- **Estimates, not promises.** They improve as real visit times accumulate; a long visit raises the next estimates within a few patients.
- **Polling, not push.** Screens refresh every 3 s: simple and robust on serverless, at the cost of up to 3 s of lag.

## Limitations

- Staff sign-in is one shared PIN, not individual accounts: there is no record of *who* pressed a button,
  and a PIN told to someone who leaves must be changed for everyone.
- One shared queue per deployment (no multi-branch support).
- Without Redis (local dev) the queue lives in one server process's memory and is lost on restart.
- Times are server times; there is no offline mode.
- Push deploys from GitHub: see the Vercel project's Git settings if a push doesn't build. The CLI (`vercel deploy --prod`) is the fallback.

## Tests

- **Vitest** (`queue-app/tests`, 29 tests, including the documentation's worked example): pure FIFO walk-ins; an appointment due before an earlier walk-in; an early appointment
  waiting for its slot; late conversion (and arrival exactly at grace end); ties (appointment vs walk-in, and by token); 2 counters;
  the estimate updating after a service finishes; idle-fill with only a future appointment; idle counter; booking clashes, past/off-slot
  times, edit re-checks, overdue, no-show, counter reduction warnings; the clamped last-5 average; overrun floor; daily reset; public view privacy; seed data.
- **Playwright** (`queue-app/e2e`, 3 tests): the full staff flow (add → book → check in → call next → served & call next → no-show → serve);
  double-booking refused and the slot greyed out; `/display` following each change. Runs locally and against the live URL.
