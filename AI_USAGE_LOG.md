# AI usage log: build session (Claude Code, desktop app)

Main prompts and the changes they led to, in order. "Accepted / changed" records what was taken as
proposed and what was corrected. Model: Claude (Opus) in Claude Code. Dates: 21–22 Oct 2026.

## 1. Build prompt and source check
- **Prompt:** Build the app described in the project; read the guidelines, `project-brief.md` and the two
  workflow diagrams; start in plan mode; run /grill-me; stop at four checkpoints.
- **What happened:** Claude read all three sources and reported two discrepancies instead of guessing:
  there was no `docs/` folder, and the diagrams were PNGs, not the SVGs the brief named. It also found that
  Node, Git, the GitHub CLI and the Vercel CLI were not installed.
- **Accepted / changed:** Moved the files into `docs/` and updated the brief to say `.png`. Installed Node 24,
  Git and the GitHub CLI with winget after an explicit yes.

## 2. /grill-me: locking the queue rules (checkpoint 1)
- **Round 1 (18 questions):** grace period, late and early appointments, no-shows, counters, the service list,
  the rolling average, overrun handling, display rounding, privacy, daily reset, concurrency, storage.
  Accepted all recommendations ("continue").
- **Inconsistency Claude flagged:** the brief's formula `start = max(free counter, target)` contradicts the
  idle-fill rule, which calls an early appointment at once if nobody is due. **Decision:** the wait
  simulation replays the exact call-next rule.
- **Round 2 (my changes):**
  - Timezone: Dhaka.
  - Repo: use my existing GitHub repo instead of creating one.
  - **Double-booking is not allowed**, which overrode the suggested "allow with a warning".
  - **Rejected** "Return to queue" and the rule against editing.
- **Round 3:** editing allowed while booked or waiting; booking times must be now or later; the overlap
  check is against capacity; reducing capacity never auto-cancels bookings.
- **Result:** final rules written to `CLAUDE.md` after my confirmation. Clinic theme confirmed.

## 3. Plan, then `lib/queue.ts` and Vitest (checkpoint 2)
- **Prompt:** approve the plan (file structure plus 9 stages).
- **Result:** all queue logic as pure functions with `now` passed in, plus a single reducer
  `applyAction(state, action, now)` that the server runs. 25 tests, covering the brief's 8 required cases
  plus booking, edit, overdue, average, reset and privacy cases.
- **Tested by:** `vitest run`, 25/25 passing; `tsc --noEmit` clean.

## 4. API, storage and seed data
- A version-checked (compare-and-set) store so concurrent "Call next" presses are safe, first on Upstash Redis,
  with process memory as the local fallback (moved to Postgres in section 17). The public view strips names
  down to an initial on the server.
- **Tested by:** an API smoke test (seed, "served & call next" with its reason, 400 errors for an empty name
  and a busy room) and a seed test.

## 5. Screens (skills: vercel-react-best-practices, vercel-composition-patterns, design-taste-frontend)
- **Style:** the design skill dealt a "framed sheet" app style, with a frame tinted from the clinic colour,
  tokens in a monospace face, and a "Next hour" call-order strip drawn from the same simulation as the waits.
- **Framework details:** Next 16 has Cache Components on, so live pages read data inside `<Suspense>` after
  `connection()`; `Date.now()` lives in `lib/views.ts` (React purity rule) and the clock uses
  `useSyncExternalStore`.
- **Tested by:** the design inspector and screenshots at 1440, 768 and 390px: 0 failures. Two warnings on the
  display were kept on purpose: tokens use a different font from the text around them, and card heights change
  with live data.

## 6. web-design-guidelines audit
- **Changes:** a skip link; toggles as `aria-pressed` buttons with full keyboard support; errors shown inline
  in the form and the edit dialog; tokens marked `translate="no"`; `color-scheme`, `touch-action` and
  `overscroll-contain` added.
- **Not changed on purpose:** Title Case. The app keeps sentence case per the design skill's app rules.

## 7. Playwright E2E
- **Tests:** the full staff flow (add → book → check in → call next → served & call next with idle-fill →
  no-show → serve); double-booking refused; `/display` following every change.
- **Tested by:** passing locally on Edge, then a manual check in the built-in browser (checkpoint 3).

## 8. Deploy to Vercel (checkpoint 4)
- `vercel login` completed by me in the terminal. Claude created and linked the project, set the root
  directory to `queue-app`, enabled deploys on push and did the first deploy.
- **My steps:** added the storage integration and connected the GitHub repo in the Vercel dashboard.
- **Caught by running E2E against the live URL:** with real network latency, the add-patient form could clear
  the next patient's name after a slow request; it now clears only if the field still holds the submitted
  name. The display also refreshes as soon as a page becomes visible again.
- **Tested by:** E2E passing against the live URL, plus a two-tab check that the display follows the staff screen.

## 9. Documentation
- README (how to run, ordering rule, wait-time formula, assumptions, limitations, trade-offs) and a 2-page
  design document.
- The documentation's worked example is a unit test, so its numbers come from the real code.

## 10. Restyle and rename
- **Prompt:** make the interface cleaner, calmer and "chic", rename it to Hygieia Wellness Clinic, use
  lavender/lilac, and keep the black and white buttons.
- **Changes:**
  - new design tokens: lavender ground, lilac data hue (`#7656a6`), lilac on the black display panel
  - Manrope for text and a monospace face for tokens
  - pill buttons and tags, 20px cards
  - a new mark based on the Bowl of Hygieia
  - a stronger "Late, now walk-in" label
- No layout or queue logic changed.
- **Note:** the design skill bans violet/indigo palettes by default; lilac was used because I asked for it explicitly.
- **Tested by:** the design inspector at 1440, 768 and 390px (0 failures); Vitest; Playwright.

## 11. Printed tokens, opening animation, chic pass
- **Prompt:** a bigger logo; let the front desk print the token at walk-in and at check-in; make it more
  chic than a colour change; a logo reveal on refresh (a reference splash screen was shared as inspiration).
- **Changes:**
  - a printable 80 mm slip (no patient name), with a Print button after a walk-in is added or an
    appointment checks in, and Print on every waiting row
  - a CSS-only opening veil (mark and wordmark rise from a blur, a lilac line fills, the veil lifts at
    about 2.4 s and removes itself)
  - Cormorant Garamond for the wordmark, titles and the big called token
  - a bigger Bowl of Hygieia mark in the sidebar and on the display
- **Allowed exceptions:** the inspector flags the opening veil (`covered-text`) and lilac (`palette-purple`).
  Both were explicit requests, so they're passed with `--allow`; there are no other failures.
- **Tested by:** Vitest; Playwright (a test stubs the print dialog and checks the slip for a walk-in, a
  checked-in appointment and a reprint, with no name on it); screenshots of the veil, the screens and the slip PDF.

## 12. Staff PIN, and refinements from my testing
- **Refinements:** "Served & call next" is hidden for the last patient; the booking note clears on check-in,
  and the token card clears after printing.
- **Prompt:** "an easy PIN to log in to the system, the PIN will be common".
- **Changes:**
  - a shared `STAFF_PIN` environment variable, never in the code
  - a sign-in page with a keypad
  - a signed 12-hour httpOnly cookie; Lock signs out
  - a 5-try lock-out
  - checks in both the Next 16 proxy and each staff API route; the display and its public data stay open
- **My step:** I chose the real PIN and set it on Vercel myself; Claude didn't choose or enter it.
- **Tested by:** Vitest, including signing, expiry, tampering, a changed PIN, and safe redirects after sign-in;
  Playwright against a production build with a test PIN (redirect, 401s, wrong PIN, keypad sign-in, Lock,
  lock-out, plus the full flow while signed in).

## 13. Final documentation
- **Prompts:** rewrite the 1–2 page documentation and update the workflow diagrams; then make it a Word file,
  add the Claude Code skills used and why, and add a test example to both the document and the README.
- **Changes:**
  - both diagrams drawn by a script (`scripts/diagrams.mjs`, SVG + PNG)
  - `docs/documentation.docx` generated by `scripts/docs-docx.mjs`: sections 1–5 on 2 pages, Appendix A (skills
    and why), Appendix B (an 11-step test walkthrough)
  - the README gained the same walkthrough
- **Tested by:** Microsoft Word opened and rendered the file (4 pages, appendices from page 3), and I read every page.

## 14. Slip and dropdown polish
- **Prompts:** move the dropdown arrow in from the edge; make the slip page 79–80 mm with a bigger, centred
  token; replace the follow-online sentence with a QR code.
- **Changes:**
  - a custom chevron inset 16 px on every dropdown
  - the slip on a fixed 80 × 160 mm page (Chromium ignores `size: 80mm auto`), centred, with an 84 px token
  - a QR code drawn as SVG (`qrcode-generator`) that opens the patient's place on the display
- **Tested by:** the PDF page is 80 × 160 mm and 1 page; the QR was decoded by machine (jsQR) to the right
  `/display?token=…` link.

## 15. Per-service queues and staff priority
- **Prompt:** the front desk should sort patients into categories with their own doctors; elderly patients and the
  like should be called first; and an early appointment shouldn't lose out to a walk-in.
- **Decisions (asked, then I chose):** one queue per service, each with its own room; tokens = service letter + W/A
  (CW-004, BA-002); a staff Priority flag with a reason plus **Call now**; appointments go ahead of walk-ins from their
  booked time; walk-ins who have waited 30 min keep their place (adjustable); one display panel per service.
- **Changes:** `lib/queue.ts` rewritten around services and rooms (tiered call-next, per-service simulation and booking
  check); seed spread over five services; display panels per service.
- **Tested by:** rewritten Vitest suite and E2E; CLAUDE.md updated first as the source of truth.

## 16. Front desk layout and booking across services
- **Layout (several rounds, each shown locally before going further):** Add patient as the focal card; a compact,
  colour-coded Next-hour timeline beside the title (room names on hover); rooms as pills with their action always
  visible; "Booked, not arrived" renamed **Check in**, placed under Add patient; Waiting full width. Checked with
  full-resolution screenshots and measured table widths at 1440 px and on a phone.
- **Booking across services:** I reported that the same time couldn't be booked for two categories. Cause: the time
  list was judged against the service selected at that moment. **Fix:** every time stays selectable and is kept when
  the service changes; a time that's full for the chosen service is explained and blocks booking. A new E2E books
  three services at the same time in both orders.
- **Services in Settings:** `addService` / `removeService` (unique token letter, its own colour, at most 10, removal
  only when nobody is booked, waiting or being seen).
- **Walk-in hold:** asked first whether an appointment always beats a walk-in; Claude ran three scenarios against the
  rules and showed a walk-in arriving just before an appointment's time could take the room first. **Decision (I
  chose):** a walk-in's target becomes arrival + 15 min when a same-service appointment is due within 15 min, booked or
  checked in; the call reason names the appointment it waits for.
- **Tested by:** 52 Vitest (6 for services, 6 for the hold), 7 E2E (including adding and removing Dental end to end).

## 17. Postgres on Supabase with Realtime
- **Prompt:** which database best suits the system, given real-time screens and this kind of data; then: go with the
  recommended Postgres + Supabase.
- **Recommendation (and why):** linked records and transactions (two rooms must never call the same patient),
  constraints the database enforces, history for reports, push instead of polling, and patient data kept off the
  browser. Convex was the runner-up; Redis was judged fine for a demo only.
- **Changes:**
  - SQL migrations: `clinic`, `services` (archived, not deleted), `visits` (one row per patient per day),
    `calls` (history), `login_attempts`; one token per day, one active service per letter, one patient per room
    (a deferred constraint, so Served & call next can swap patients in one write)
  - row-level security on every table, including the migration log; the browser key may read only the clinic's
    version row
  - `lib/pg-store.ts`: state ↔ rows; `lib/store.ts` picks Postgres or memory and seeds an empty database with the
    sample day; Redis removed
  - Supabase's transaction pooler can split a parameterised statement across server connections, so those only run
    inside a transaction
  - Supabase Realtime on the clinic row: screens refetch through their own API on each change (no patient data over
    the public channel), with a 15 s safety poll (3 s without Realtime); the display shows "Live"
  - every deploy applies migrations first and fails if a table lacks row-level security
  - a local Postgres without Docker for development and tests (PGlite)
- **My steps:** I added Supabase to the Vercel project. Claude can't create accounts or read secret values.
- **Tested by:** Vitest store tests against PGlite (a real Postgres in-process) with the production migrations;
  E2E against a production build on Postgres; 57 simultaneous requests (all finished, 12 parallel walk-ins saved, no
  duplicate tokens); a walk-in reached the open display 0.8 s after it was saved; REST calls with the public key
  confirmed it reads only the clinic row and can't change anything, on the live database too.

## 18. Faster reads
- **Prompt:** look into the ~0.6 s page reads and speed them up, locally first.
- **Measured first:** curl's timing split showed the network wasn't the cause and the server spent about 0.5 s per read.
- **Changes:**
  - a read is one SQL statement returning the whole state as JSON (from 6 round trips)
  - a write touches only what changed since the state it was computed from (adding a walk-in: 5 statements, from about 14)
  - both API routes send a `Server-Timing` header (`db`, `view`)
  - functions run in Singapore (`sin1`), the database's region, found from its IP in AWS's published ranges
- **Result, measured live:** database time per read ~4 ms (from ~66 ms before the region move); a new connection
  ~0.14 s (from ~0.7 s); a typical read from Dhaka ~0.15 s end to end (from ~0.59 s); 60 simultaneous live reads,
  all finished.
- **Tested by:** a store test counts the statements sent and checks the diff-only write leaves the database exactly
  as a full rewrite would; 59 Vitest; 7 E2E.

## Things Claude did not do (by design)
- It did not enter credentials or the staff PIN. GitHub, Vercel and Supabase sign-ins and setup were completed by me.
- It did not invent customers, reviews or statistics. All names are fictional.
