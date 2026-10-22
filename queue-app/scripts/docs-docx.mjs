// Writes docs/documentation.docx: the design documentation (sections 1–5) plus two appendices
// (skills used, how to test). Diagrams come from scripts/diagrams.mjs. Usage: node scripts/docs-docx.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");

const LILAC = "7656A6";
const INK = "17141F";
const MUTED = "615A6E";
const RULE = "E8E2F2";
const PALE = "F4F1FA";
const BODY = "Calibri";
const SERIF = "Georgia";

// A4 with 18 mm margins: 11906 − 2 × 1020 = 9866 DXA of text width.
const PAGE = { size: { width: 11906, height: 16838 }, margin: { top: 1020, bottom: 1020, left: 1020, right: 1020 } };
const WIDTH = 9866;

/** "**bold** and `code`" → runs. */
function runs(text, base = {}) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("**")) return new TextRun({ ...base, text: part.slice(2, -2), bold: true });
      if (part.startsWith("`")) return new TextRun({ ...base, text: part.slice(1, -1), bold: true, color: LILAC });
      return new TextRun({ ...base, text: part });
    });
}

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 80 }, ...opts, children: runs(text, opts.run) });
const bullet = (text) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: runs(text) });
const step = (text, ref = "steps") => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 40 }, children: runs(text) });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });

const thin = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

/** Table with a header row; widths in DXA summing to WIDTH. */
function table(widths, header, rows) {
  const cell = (text, width, head) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: { top: 50, bottom: 50, left: 90, right: 90 },
      shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: PALE } : undefined,
      borders: { top: thin, bottom: thin, left: none, right: none },
      children: [new Paragraph({ children: runs(text, head ? { bold: true, color: MUTED } : {}) })],
    });
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, widths[i], false)) })),
    ],
  });
}

/** A shaded box of paragraphs (the formula). */
function box(paragraphs) {
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: [WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: WIDTH, type: WidthType.DXA },
            margins: { top: 100, bottom: 60, left: 160, right: 160 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: PALE },
            borders: { top: none, bottom: none, left: none, right: none },
            children: paragraphs.map((t) => p(t)),
          }),
        ],
      }),
    ],
  });
}

function figures() {
  const half = WIDTH / 2;
  const fig = (file, w, h, caption) =>
    new TableCell({
      width: { size: half, type: WidthType.DXA },
      borders: { top: none, bottom: none, left: none, right: none },
      margins: { left: 60, right: 60 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: "png", data: readFileSync(path.join(docs, file)), transformation: { width: w, height: h } })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 80 },
          children: [new TextRun({ text: caption, size: 16, color: MUTED })],
        }),
      ],
    });
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: [half, half],
    rows: [
      new TableRow({
        children: [
          fig("workflow-overview.png", 250, 243, "Figure 1. Patient workflow"),
          fig("call-next-logic.png", 190, 254, "Figure 2. Call-next decision (one room)"),
        ],
      }),
    ],
  });
}

const LIVE = "https://queue-management-system-jet-six.vercel.app";
const REPO = "https://github.com/zayannnn2000/Queue_Management_System";

const content = [
  new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: "Hygieia Wellness Clinic: Token Queue", font: SERIF, size: 40, bold: true, color: INK })],
  }),
  new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: LILAC, space: 6 } },
    children: [
      new TextRun({ text: "Design documentation: decisions, assumptions, queue handling and waiting-time calculation", color: MUTED }),
    ],
  }),
  p(`**Live app:** ${LIVE} (front desk \`/staff\`, demo PIN \`12345\`; waiting-room display \`/display\`)`),
  p(`**Source:** ${REPO}`),
  p(
    "**Before you start:** sign in with PIN `12345`, then open **Settings**. **Load sample day** fills the five service queues with fictional patients to try everything at once; **Reset day** clears today's queue and restarts every token sequence (CW-001, CA-001, BW-001 …). The queue also clears itself at midnight (Dhaka time).",
  ),
  p("**Stack:** Next.js 16 and TypeScript on Vercel; Postgres and Realtime on Supabase. A simulation: all patients are fictional."),

  h1("1. Key design decisions"),
  bullet("**One front desk, one queue per service.** Consultation, follow-up, blood test, vaccination and prescription renewal each have their own queue and room(s), so a 5-minute blood test never waits behind 15-minute consultations. Services can be added or removed in Settings."),
  bullet('**One ordering key per queue: the target time.** Every waiting patient has one comparable time, so "fair and in order" and "appointments at their scheduled time" become a single rule instead of competing lists.'),
  bullet("**Appointments come first at their time,** a walk-in arriving just before a booking is held 15 minutes, staff can flag **Priority** (Elderly, Pregnant, Disability, Urgent, Other) or **Call now**, and a walk-in who has waited 30 minutes keeps their place."),
  bullet("**Appointments join the queue only at check-in.** A booking that hasn't arrived can never hold up patients who are present."),
  bullet("**All queue logic is one pure, tested module** (`lib/queue.ts`): no I/O, and the clock is always passed in. Every staff action goes through a single reducer that the server runs, so the unit tests cover exactly the code the live app uses."),
  bullet('**The server decides who is next** and saves it in one Postgres transaction that checks a version number, so two staff pressing "Call next" at the same moment can never call the same patient. Postgres also enforces one token per day and one patient per room.'),  bullet("**The wait estimate replays the call-next rule** instead of using a separate formula, so the estimate and the real order can't disagree."),
  bullet('**Every call is explained** on screen, e.g. "CA-003 called: appointment at 10:30 is due, and appointments go ahead of walk-ins at their time".'),
  bullet("**Privacy by design.** The public display and the printed token slip show only the token (and the first initial on the display); full names never leave the staff view. Only a name and a service are collected. In the database, row-level security covers every table and the browser's key can read only the clinic's version row."),
  bullet("**Staff access with one shared PIN:** a signed 12-hour session cookie, a lock-out after 5 wrong tries, and checks in both the proxy and every staff API route. The waiting-room display stays public."),

  h1("2. Assumptions"),
  bullet("One clinic, timezone Asia/Dhaka. Tokens are the service letter + W (walk-in) or A (appointment): `CW-004`, `BA-002`; each restarts daily."),
  bullet("Five services, each with 1 room by default (1–4 configurable; up to 10 services). Grace period 10 min; walk-in protection 30 min (0 = off)."),
  bullet("Default visit lengths: consultation 15, follow-up 10, blood test 5, vaccination 5, prescription renewal 5 min."),
  bullet("Bookings are for today, in 5-minute slots, at or after the current time. No double-booking **within a service**: its overlapping appointments may not exceed its rooms. Other services may share the time."),
  bullet("No automatic no-shows: staff decide on overdue bookings. A no-show who returns joins again as a new walk-in. No payments or SMS."),

  h1("3. Queue-handling logic"),
  table(
    [4200, 5666],
    ["Patient", "Target time"],
    [
      ["Walk-in", "Arrival time, or **arrival + 15 min** if an appointment of the same service (booked or checked in) is due within the next 15 min, so that appointment goes first"],
      ["Appointment, checked in by scheduled time + grace (on time or early)", "Scheduled time"],
      ["Appointment, checked in after the grace period", 'As a walk-in (above): keeps its A-token, flagged "Late, now walk-in"'],
    ],
  ),
  p("", { spacing: { after: 40 } }),
  p("**Call next** (per room, within its service queue):"),
  step("Nobody waiting for the service → the room stays free.", "callnext"),
  step("**Priority** patients first, earliest flagged first.", "callnext"),
  step("**Due appointments** and **protected walk-ins** (waited 30+ min), by target time.", "callnext"),
  step("Other **due** walk-ins (target ≤ now), by target.", "callnext"),
  step("Nobody due → the earliest **upcoming** target, so the room isn't idle. Ties → appointment first, then the lower token.", "callnext"),
  p("A booking past its grace period without arriving is flagged **Overdue** for staff to check in, mark a no-show or cancel. Edits are allowed until a patient is called. For the last patient only Served and No-show are offered."),
  p("**Tokens.**", { spacing: { before: 60, after: 20 } }),
  bullet("**Issued:** `CW-…` when a consultation walk-in is added; `CA-…` when a consultation is booked (it joins the queue only at check-in). Tokens never change; a change of service means cancelling and adding again."),
  bullet("**Printed:** after Add walk-in or Check in, **Print token** prints an 80 mm slip with the token, service, room, booking, place, estimated wait, time issued and a QR code to the patient's place on the display, but no name."),
  bullet("**Followed:** the display has a panel per service with Now serving (token, initial, room) and the waiting tokens. `?token=CW-004` or **Find my token** highlights one (\"You are number 2 in the General consultation queue\")."),
  figures(),

  h1("4. Waiting-time calculation"),
  box([
    "**1. How long a visit takes.** For each service, the average of its last 5 real visits. Until there are real visits, the default length is used. No-shows don't count, and one very long or very short visit is capped so it can't distort the average.",
    "**2. Play each service queue forward.** The system works out when the service's room will next be free: now if nobody is with the doctor, otherwise when the current patient should finish (at least 1 minute away). At that moment it \"calls\" the next patient using the same rule as the Call next button, notes their start time, adds their visit length, and repeats down that queue.",
    "**3. The wait.** Wait = predicted start time − now. With one room (the default) this is simply: **time left for the current patient + the visit lengths of everyone ahead in that queue.** With more rooms, each patient goes to whichever room frees up first.",
    '**4. How it\'s shown.** "Due now" for 2 minutes or less; otherwise "~X min", rounded up to the next 5. Updated the moment anything changes, and on a timer so waits count down.',
  ]),
  p("", { spacing: { after: 40 } }),
  p("**Worked example** (also a unit test): the Consultation queue, 1 room, 15-min visits, now 10:00; the patient being seen is expected to finish at 10:06. CA-001 is booked for 10:05 and checked in at 09:55; CW-002 walked in at 09:50 and CW-003 at 09:58."),
  table(
    [2900, 1900, 1600, 1100, 1100, 1266],
    ["Patient", "Target", "Projected start", "Wait", "Shown", "Why"],
    [
      ["**CA-001** appointment", "10:05 (booked)", "10:06", "6 min", "~10 min", "due first"],
      ["**CW-002** walk-in, 09:50", "10:05 (held 15 min)", "10:21", "21 min", "~25 min", "protected by 10:21"],
      ["**CW-003** walk-in, 09:58", "10:13 (held 15 min)", "10:36", "36 min", "~40 min", "last target"],
    ],
  ),
  p("Both walk-ins arrived with CA-001 due within 15 minutes, so their targets are held and CA-001 is called first at 10:06. By 10:21 CW-002 has waited 31 minutes, so it is protected and goes before CW-003.", { spacing: { before: 80, after: 80 } }),

  h1("5. Trade-offs and limitations"),
  bullet("Appointments are honoured at their time, so a walk-in arriving just before one may wait about one extra visit; walk-in protection stops repeated pushing back. Late appointments lose their slot. Priority is a staff judgement, shown on the staff screen only."),
  bullet("Idle-fill keeps rooms busy but can leave one occupied as a slot comes due; the estimate includes this. Waits are estimates that improve as real visit lengths accumulate. Realtime sends only a \"changed\" nudge, never patient data."),
  bullet("**Limitations:** one shared PIN rather than individual staff accounts (no record of who pressed a button); one clinic per deployment; a service can't be renamed once added; history is stored but not yet reported on."),

  // The break belongs to the heading, so a full page 2 never leaves an empty page behind it.
  new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun("Appendix A. Skills used to build the system")] }),
  p("These Claude Code skills were fed into the build. Each one was used at a specific stage, for a specific reason:"),
  table(
    [2000, 4100, 3766],
    ["Skill", "What it was used for", "Why"],
    [
      ["grill-me", "Interviewed me in rounds before any code to lock the queue rules: grace period, early and late appointments, ties, no-shows, counters, double-booking, editing.", "The brief leaves prioritisation open on purpose. Agreeing the rules first avoided rework and produced CLAUDE.md, the source of truth for the tests."],
      ["vercel-react-best-practices", "Data loading and refresh: live data streamed inside Suspense, one server read per request, the Realtime client loaded only after the page is interactive, polling that pauses in hidden tabs.", "Keeps the front desk fast and correct while it updates all day."],
      ["vercel-composition-patterns", "Component design: one QueueProvider (state, actions, meta) and explicit variants (ServingCounter / IdleCounter, WalkInForm / AppointmentForm) instead of boolean props.", 'Small pieces that are easy to change: hiding "Served & call next" for the last patient was a one-place change.'],
      ["design-taste-frontend", "Art direction for both screens: the framed-sheet layout, the Hygieia restyle (lavender and lilac, Cormorant and Manrope, pill controls), the Next-hour strip and the opening reveal. Its inspector checked every screen at 1440, 768 and 390 px.", "A calm, distinctive interface instead of a generic dashboard, backed by measured checks."],
      ["web-design-guidelines", "Accessibility and UX audit of the staff and display screens.", "Found a missing skip link, ARIA roles without keyboard support, errors shown far from forms, and tokens a browser could auto-translate; all fixed."],
      ["playwright-cli", "End-to-end tests: the full staff flow, printing, double-booking refusal, display sync, PIN sign-in and lock-out.", "Proves the system works in a real browser, locally and on the live site; it caught a real race condition in production."],
      ["built-in-browser", "Manual click-through on localhost and on the live URL.", "Confirms what a person actually sees, e.g. the display following the staff screen."],
      ["deploy-to-vercel", "Linking the project, setting the root directory, production deploys and the GitHub connection.", "The brief requires a public URL; Vercel with Supabase Postgres (first Upstash Redis) gives shared state across every screen."],
      ["pdf", "The first version of this documentation.", "The format planned for the brief documentation at the time."],
      ["docx", "This Word version of the documentation.", "An editable document for the submission."],
    ],
  ),

  h1("Appendix B. How to test the platform"),
  p(`Open the front desk at ${LIVE}/staff and sign in with the demo PIN \`12345\`. Open ${LIVE}/display in a second window, side by side. In Settings, click **Reset day** to start from an empty queue (or **Load sample day** for a busy morning). All names below are fictional.`),
  table(
    [500, 4500, 4866],
    ["#", "Do this", "You should see"],
    [
      ["1", 'Add a walk-in: name "Rina", General consultation, **Add walk-in**.', "Token CW-001, place 1, Due now. The display's General consultation panel shows CW-001 R. within about a second (its header says Live)."],
      ["2", "Click **Print token**, then scan the slip's QR code with a phone.", "An 80 mm slip with CW-001, the service, Room 1, place, wait and a QR code, and no name. The QR opens the display with CW-001 highlighted."],
      ["3", 'Add a walk-in "Karim", **Blood test**.', "BW-001, place 1 in the Blood test queue: a separate queue with its own room."],
      ["4", 'Book "Sadia", General consultation, 30+ min ahead; then "Omar", Blood test, the **same time**.', "CA-001 and BA-001 are both booked. A second consultation at that time is refused (full for General consultation)."],
      ["5", "In **Check in**, click **Check in** for CA-001.", 'CA-001 joins Waiting with an "Appt" label, behind CW-001 (its time is later).'],
      ["6", "On the General consultation pill click **Call next**.", "CW-001 is called; click the pill for the reason. The display shows it under Now serving."],
      ["7", "Click **Served & call next**.", 'CA-001 is "called early: nobody is due yet". Only Served remains while nobody else waits.'],
      ["8", 'Add "Lina" and "Rafi" (consultation), set **Priority → Elderly** on Rafi, serve CA-001 and **Call next**.', 'Rafi is called first: "priority (Elderly)".'],
      ["9", "Book a consultation 10 min ahead and check it in, then add a consultation walk-in.", 'The walk-in shows "target … · after CA-00x": held 15 min so the appointment goes first.'],
      ["10", 'Settings → Services and departments: add "Dental" (letter D).', "Dental appears in Add patient, Rooms, the timeline and the display; a walk-in gets DW-001."],
      ["11", "Click **Lock** in the sidebar.", "The PIN screen appears; the display window keeps working."],
    ],
  ),
  p("", { spacing: { after: 40 } }),
  p("**Automated tests** (from the `queue-app` folder): `npm test` runs 59 tests of the queue rules, sign-in, seed data and the Postgres store (on PGlite, a real Postgres in-process); `npm run test:e2e` runs 7 browser tests (staff flow, separate queues and priority, printing, booking per service, adding a service, display sync), plus PIN sign-in when E2E_STAFF_PIN is set."),
];

const doc = new Document({
  creator: "Hygieia Wellness Clinic queue project",
  title: "Hygieia Wellness Clinic: Token Queue, design documentation",
  styles: {
    default: { document: { run: { font: BODY, size: 18, color: INK }, paragraph: { spacing: { line: 240 } } } },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: SERIF, size: 26, bold: true, color: LILAC },
        paragraph: { spacing: { before: 220, after: 80 }, outlineLevel: 0, keepNext: true },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: BODY, size: 20, bold: true },
        paragraph: { spacing: { before: 120, after: 40 }, outlineLevel: 1, keepNext: true },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } }, run: { color: LILAC } } }],
      },
      {
        reference: "callnext",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 280 } } } }],
      },
      {
        reference: "steps",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 280 } } } }],
      },
    ],
  },
  sections: [{ properties: { page: PAGE }, children: content }],
});

writeFileSync(path.join(docs, "documentation.docx"), await Packer.toBuffer(doc));
console.log("Wrote docs/documentation.docx");
