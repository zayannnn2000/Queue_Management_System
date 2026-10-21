# AI usage log: build session (Claude Code, desktop app)

Main prompts and the changes they led to, in order. "Accepted / changed" records what was taken as
proposed and what was corrected. Model: Claude (Opus) in Claude Code. Dates: 21 Oct 2026.

## 1. Build prompt and source check
- **Prompt:** Build the app described in the project; read the guidelines, `project-brief.md` and the two
  workflow diagrams; start in plan mode; run /grill-me; stop at four checkpoints.
- **What happened:** Claude read all three sources and reported two discrepancies instead of guessing:
  there was no `docs/` folder, and the diagrams were PNGs, not the SVGs the brief named. It also found that
  Node, Git, the GitHub CLI and the Vercel CLI were not installed.
- **Accepted / changed:** Moved the files into `docs/` and updated the brief to say `.png`. Installed Node 24,
  Git and the GitHub CLI with winget after an explicit yes. The first install stalled on a Windows UAC prompt
  and went through once the prompt was accepted.

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
  - Asked what "staff can enter them late" meant.
- **Round 3:** editing allowed while booked or waiting; booking times must be now or later; the overlap
  check is against counter capacity; reducing counters never auto-cancels bookings.
- **Result:** final rules written to `CLAUDE.md` after my confirmation. Clinic theme confirmed.

## 3. Plan, then `lib/queue.ts` and Vitest (checkpoint 2)
- **Prompt:** approve the plan (file structure plus 9 stages).
- **Result:** all queue logic as pure functions with `now` passed in, plus a single reducer
  `applyAction(state, action, now)` that the server runs. 25 tests, covering the brief's 8 required cases
  plus booking, edit, overdue, average, reset and privacy cases.
- **Tested by:** `vitest run`, 25/25 passing on the first run; `tsc --noEmit` clean.

## 4. API, storage and seed data
- Upstash Redis with a compare-and-set Lua script on a version number, so concurrent "Call next" presses are
  safe. Process memory as the local fallback. The public view strips names down to an initial on the server.
- **Tested by:** an API smoke test (seed, "served & call next" with its reason, 400 errors for an empty name
  and a busy counter) and a seed test (27/27).

## 5. Screens (skills: vercel-react-best-practices, vercel-composition-patterns, design-taste-frontend)
- **Style:** the design skill dealt a "framed sheet" app style. Its own touches here:
  - a frame tinted from the clinic colour
  - tokens set in IBM Plex Mono
  - a "Next hour" call-order strip drawn from the same simulation as the waits
- **Problems found by looking at screenshots and fixed:**
  - token cells wrapped
  - the waiting table overflowed at 1440px
  - the page scrolled sideways at 768px (the grid needed `minmax(0,1fr)`)
  - the sidebar didn't fold for tablet widths
  - strip labels were clipped (labels are now measured to fit)
  - the dark display card was mostly empty (added "Please get ready")
  - tokens wrapped on the phone display
- **Framework catches:** Next 16 has Cache Components on, so live pages read data inside `<Suspense>` after
  `connection()`. ESLint's React purity rule flagged `Date.now()` in server components (moved to `lib/views.ts`)
  and `setState` in an effect (the clock now uses `useSyncExternalStore`).
- **Tested by:** the design inspector at 1440, 768 and 390px: 0 failures. Two warnings on the display were
  kept on purpose: tokens use a different font from the text around them, and card heights change with live data.

## 6. web-design-guidelines audit
- **Fixed:**
  - added a skip link
  - toggles used ARIA tab/radio roles without keyboard support, so they became honest `aria-pressed` buttons
  - errors now appear inline in the form and the edit dialog
  - tokens marked `translate="no"`
  - `color-scheme`, `touch-action` and `overscroll-contain` added
- **Not changed on purpose:** Title Case. The app keeps sentence case per the design skill's app rules.

## 7. Playwright E2E
- **Tests:** the full staff flow (add → book → check in → call next → served & call next with idle-fill →
  no-show → serve); double-booking refused with the slot greyed out; `/display` following every change.
- **First run:** one failure from a test locator (hidden screen-reader text matched too). Fixed the test, not the app.
- **Tested by:** 3/3 passing locally on Edge. Then a manual check in the built-in browser (checkpoint 3).

## 8. Deploy to Vercel (checkpoint 4)
- `vercel login` completed by me in the terminal. Claude created and linked the project, set the root
  directory to `queue-app` through the Vercel API, and did the first deploy.
- **My steps:** added Upstash Redis and connected the GitHub repo in the Vercel dashboard.
- **Bug found by running E2E against the live URL:** with real latency, the add-patient form cleared the name
  field after a slow request and wiped the next patient's name. **Fix:** clear only if the field still holds
  the submitted name. The test helper now also waits for each confirmation.
- **Also fixed:** the display refreshes as soon as the page becomes visible again (background tabs slow timers down).
- **Deploy settings:** push deploys were disabled in the project settings, so Claude turned them on and
  reconnected the repo. A build triggered straight from GitHub succeeded.
- **Tested by:** 3/3 E2E passing against the live URL; Settings shows "Stored in Upstash Redis"; a two-tab
  manual check that the display follows the staff screen.

## 9. Documentation
- README (how to run, ordering rule, wait-time formula, assumptions, limitations, trade-offs) and a 2-page
  documentation PDF.
- The documentation's worked example was added as a unit test, so its numbers come from the real code (29/29).

## 10. Restyle and rename
- **Prompt:** make the interface cleaner, calmer and "chic", rename it to Hygieia Wellness Clinic, use
  lavender/lilac, and keep the black and white buttons.
- **Changes:**
  - new design tokens: lavender ground, lilac data hue (`#7656a6`), lilac on the black display panel
  - Manrope for text and DM Mono for tokens
  - pill buttons and tags, 20px cards
  - a new mark based on the Bowl of Hygieia
  - a stronger "Late, now walk-in" label (I'd found the old one hard to spot)
- No layout or queue logic changed.
- **Note:** the design skill bans violet/indigo palettes by default; lilac was used because I asked for it explicitly.
- **Tested by:** the design inspector at 1440, 768 and 390px (0 failures); 29/29 Vitest; 3/3 Playwright.

## 11. Printed tokens, opening animation, chic pass
- **Prompt:** a bigger logo; let the front desk print the token at walk-in and at check-in; make it more
  chic than a colour change; a logo reveal on refresh (a reference splash screen was shared as inspiration).
- **Changes:**
  - a printable 80 mm slip (no patient name), with a Print button after a walk-in is added or an
    appointment checks in, and Print on every waiting row
  - a CSS-only opening veil (mark and wordmark rise from a blur, a lilac line fills, the veil lifts at
    about 2.4 s and removes itself)
  - Cormorant Garamond for the wordmark, titles and the big called token
  - a new Bowl of Hygieia mark, bigger in the sidebar and on the display
- **Caught along the way:**
  - the new E2E booking failed after 23:00 because "now + 1 h" was tomorrow; the test now uses the form's first free slot
  - the token class overrode the serif on big tokens
- **Allowed exceptions:** the inspector flags the opening veil (`covered-text`) and lilac (`palette-purple`).
  Both were explicit requests, so they're passed with `--allow`; there are no other failures.
- **Tested by:** 29/29 Vitest; 4/4 Playwright (a new test stubs the print dialog and checks the slip for a
  walk-in, a checked-in appointment and a reprint, with no name on it); screenshots of the veil, the screens and the slip PDF.

## 12. Fixes from my testing, then a staff PIN
- **Fixes from testing:**
  - "Served & call next" now disappears for the last patient.
  - The booking note clears on check-in, and the token card clears after printing.
  - A stale-tab question turned out to be an old page that needed a refresh.
- **Prompt:** "an easy PIN to log in to the system, the PIN will be common".
- **Changes:**
  - a shared `STAFF_PIN` environment variable, never in the code
  - a sign-in page with a keypad
  - a signed 12-hour httpOnly cookie; Lock signs out
  - a 5-try lock-out, counted in Redis
  - checks in both the Next 16 proxy and each staff API route; the display and its public data stay open
- **My step:** I chose the real PIN and set it on Vercel myself; Claude didn't choose or enter it.
- **Tested by:**
  - 34/34 Vitest, including signing, expiry, tampering, a changed PIN, and safe redirects after sign-in
  - Playwright: 4 passed / 2 skipped without a PIN; all 6 passed against a production build with a test PIN
    (redirect, 401s, wrong PIN, keypad sign-in, Lock, lock-out, plus the full flow while signed in)

## Things Claude did not do (by design)
- It did not enter credentials. GitHub and Vercel sign-ins and the Upstash terms were completed by me.
- It did not invent customers, reviews or statistics. All names are fictional.
