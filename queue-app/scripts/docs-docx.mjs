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
  PageBreak,
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
          fig("workflow-overview.png", 296, 288, "Figure 1. Patient workflow"),
          fig("call-next-logic.png", 296, 296, "Figure 2. Call-next decision"),
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
  p("**Stack:** Next.js 16 and TypeScript on Vercel; shared state in Upstash Redis. A simulation: all patients are fictional."),

  h1("1. Key design decisions"),
  bullet('**One ordering key: the target time.** Every waiting patient has one comparable time, so "fair and in order" and "appointments at their scheduled time" become a single rule instead of two competing queues.'),
  bullet("**Appointments join the queue only at check-in.** A booking that hasn't arrived can never hold up patients who are present."),
  bullet("**All queue logic is one pure, tested module** (`lib/queue.ts`): no I/O, and the clock is always passed in. Every staff action goes through a single reducer that the server runs, so the unit tests cover exactly the code the live app uses."),
  bullet('**The server decides who is next** and writes with a compare-and-set on a version number, so two staff pressing "Call next" at the same moment can never call the same patient.'),
  bullet("**The wait estimate replays the call-next rule** instead of using a separate formula, so the estimate and the real order can't disagree."),
  bullet('**Every call is explained** on screen, e.g. "A-003 called: appointment at 10:30, the earliest due target".'),
  bullet("**Privacy by design.** The public display and the printed token slip show only the token (and the first initial on the display); full names never leave the staff view. Only a name and a service are collected."),
  bullet("**Staff access with one shared PIN:** a signed 12-hour session cookie, a lock-out after 5 wrong tries, and checks in both the proxy and every staff API route. The waiting-room display stays public."),
  bullet("**Polling every 3 seconds** instead of WebSockets: simple and robust on serverless hosting, at the cost of up to 3 seconds of delay."),

  h1("2. Assumptions"),
  bullet("One clinic, timezone Asia/Dhaka. Tokens `W-001` / `A-001` restart each day."),
  bullet("1 counter by default (configurable 1–4); any counter serves any patient. Grace period 10 min (configurable)."),
  bullet("Default visit lengths: consultation 15, follow-up 10, blood test 5, vaccination 5, prescription renewal 5 min."),
  bullet("Bookings are for today, in 5-minute slots, at or after the current time. No double-booking: overlapping appointments may not exceed the number of counters."),
  bullet("No automatic no-shows: staff decide on overdue bookings. A no-show who returns joins again as a new walk-in. No payments or SMS."),

  h1("3. Queue-handling logic"),
  table(
    [4200, 5666],
    ["Patient", "Target time"],
    [
      ["Walk-in", "Arrival time"],
      ["Appointment, checked in by scheduled time + grace (on time or early)", "Scheduled time"],
      ["Appointment, checked in after the grace period", 'Arrival time: joins as a walk-in, keeps its A-token, flagged "Late, now walk-in"'],
    ],
  ),
  p("", { spacing: { after: 40 } }),
  p("**Call next** (per counter):"),
  step("Nobody checked in → the counter stays free.", "callnext"),
  step("Someone is **due** (target ≤ now) → call the earliest target.", "callnext"),
  step("Nobody due → call the earliest **upcoming** target so the counter isn't idle. This is the only way an early appointment is seen early.", "callnext"),
  step("Ties → appointment first, then the lower token number.", "callnext"),
  p("A booking past its grace period without arriving is flagged **Overdue** for staff to check in, mark a no-show or cancel. Edits are allowed until a patient is called. For the last patient only Served and No-show are offered."),
  figures(),

  h1("4. Waiting-time calculation"),
  box([
    "**1. How long a visit takes.** For each service, the average of its last 5 real visits. Until there are real visits, the default length is used. No-shows don't count, and one very long or very short visit is capped so it can't distort the average.",
    "**2. Play the queue forward.** The system works out when the counter will next be free: now if nobody is with the doctor, otherwise when the current patient should finish (at least 1 minute away). At that moment it \"calls\" the next patient using the same rule as the Call next button, notes their start time, adds their visit length, and repeats down the list.",
    "**3. The wait.** Wait = predicted start time − now. With one counter (as in the live demo) this is simply: **time left for the current patient + the visit lengths of everyone ahead.** With more counters, each patient goes to whichever counter frees up first.",
    '**4. How it\'s shown.** "Due now" for 2 minutes or less; otherwise "~X min", rounded up to the next 5. Updated after every action and every 3 seconds.',
  ]),
  p("", { spacing: { after: 40 } }),
  p("**Worked example** (also a unit test): 1 counter, now 10:00, the patient being served is expected to finish at 10:06, and no visit data yet."),
  table(
    [2700, 1000, 2066, 1500, 1200, 1400],
    ["Patient", "Target", "Service", "Projected start", "Wait", "Shown"],
    [
      ["**W-001** walk-in", "09:50", "Consultation (15)", "10:06", "6 min", "~10 min"],
      ["**W-002** walk-in", "09:58", "Vaccination (5)", "10:21", "21 min", "~25 min"],
      ["**A-001** appointment, early", "10:05", "Follow-up (10)", "10:26", "26 min", "~30 min"],
    ],
  ),
  p("A-001 doesn't overtake the two walk-ins, because they have earlier targets. Had W-002 arrived at 10:08 instead, A-001 (target 10:05) would be called first, at 10:21.", { spacing: { before: 80, after: 80 } }),

  h1("5. Trade-offs and limitations"),
  bullet("When an appointment comes due, a walk-in who arrived after its slot may wait about one extra visit. In return, appointments are honoured and nobody is overtaken by a later target. Early appointments don't jump the queue; late ones lose their slot."),
  bullet("Idle-fill keeps counters busy, but can leave a counter occupied just as a later slot comes due. The estimate already includes this."),
  bullet("The overlap check counts every booking in the window, so with 2+ counters it can refuse a slot that would just fit. It's simple to explain to patients."),
  bullet("Waits are estimates, not promises: they converge as real visit lengths accumulate, and averaging softens one unusually long visit."),
  bullet("**Limitations:** one shared PIN rather than individual staff accounts (no record of who pressed a button); one queue per deployment; without Redis (local development) the queue lives in one server process's memory."),

  new Paragraph({ children: [new PageBreak()] }),
  h1("Appendix A. Skills used to build the system"),
  p("These Claude Code skills were fed into the build. Each one was used at a specific stage, for a specific reason:"),
  table(
    [2000, 4100, 3766],
    ["Skill", "What it was used for", "Why"],
    [
      ["grill-me", "Interviewed me in rounds before any code to lock the queue rules: grace period, early and late appointments, ties, no-shows, counters, double-booking, editing.", "The brief leaves prioritisation open on purpose. Agreeing the rules first avoided rework and produced CLAUDE.md, the source of truth for the tests."],
      ["vercel-react-best-practices", "Data loading and refresh: live data streamed inside Suspense, one server read per request, 3-second polling that pauses in hidden tabs, no state set inside effects.", "Keeps the front desk fast and correct while it refreshes every 3 seconds all day."],
      ["vercel-composition-patterns", "Component design: one QueueProvider (state, actions, meta) and explicit variants (ServingCounter / IdleCounter, WalkInForm / AppointmentForm) instead of boolean props.", 'Small pieces that are easy to change: hiding "Served & call next" for the last patient was a one-place change.'],
      ["design-taste-frontend", "Art direction for both screens: the framed-sheet layout, the Hygieia restyle (lavender and lilac, Cormorant and Manrope, pill controls), the Next-hour strip and the opening reveal. Its inspector checked every screen at 1440, 768 and 390 px.", "A calm, distinctive interface instead of a generic dashboard, backed by measured checks."],
      ["web-design-guidelines", "Accessibility and UX audit of the staff and display screens.", "Found a missing skip link, ARIA roles without keyboard support, errors shown far from forms, and tokens a browser could auto-translate; all fixed."],
      ["playwright-cli", "End-to-end tests: the full staff flow, printing, double-booking refusal, display sync, PIN sign-in and lock-out.", "Proves the system works in a real browser, locally and on the live site; it caught a real race condition in production."],
      ["built-in-browser", "Manual click-through on localhost and on the live URL.", "Confirms what a person actually sees, e.g. the display following the staff screen."],
      ["deploy-to-vercel", "Linking the project, setting the root directory, production deploys and the GitHub connection.", "The brief requires a public URL; Vercel with Upstash Redis gives shared state across every screen."],
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
      ["1", 'Add a walk-in: name "Rina", service General consultation, **Add walk-in**.', "Token W-001 with place 1 and Due now. The display shows W-001 R. within 3 seconds."],
      ["2", "Click **Print token**.", "The print dialog shows a slip with W-001, Walk-in, the service, place and wait, and no name."],
      ["3", 'Add a walk-in "Karim", service Vaccination.', "W-002 at place 2, about 15 min (one consultation ahead)."],
      ["4", 'Choose **Appointment**, name "Sadia", Follow-up, first free time, **Book appointment**.', "A-001 appears under Booked, not arrived, not in the queue or on the display."],
      ["5", "Open Booked, not arrived and click **Check in** for A-001, then **Print token**.", 'A-001 joins Waiting with an "Appt" label, behind the two walk-ins (its booked time is later).'],
      ["6", "On Counter 1 click **Call next**.", 'W-001 is called; the reason says "the earliest due target". The display shows W-001 under Now serving.'],
      ["7", "Click **Served & call next** twice.", 'W-002 is called, then A-001 "called early: nobody is due yet".'],
      ["8", "Look at the counter while A-001 is being served.", 'Only Served and No-show remain, because nobody else is waiting.'],
      ["9", "Click **No-show** and confirm.", "The counter shows Free. Finished today lists 2 Served and 1 No-show."],
      ["10", "Try to book two appointments at the same time with 1 counter.", "The second is refused and the slot shows as (full)."],
      ["11", "Click **Lock** in the sidebar.", "The PIN screen appears; the display window keeps working."],
    ],
  ),
  p("", { spacing: { after: 40 } }),
  p("**Automated tests** (from the `queue-app` folder): `npm test` runs 34 unit tests of the queue rules, sign-in and seed data; `npm run test:e2e` runs the browser tests (staff flow, printing, double-booking, display sync, and PIN sign-in when E2E_STAFF_PIN is set)."),
];

const doc = new Document({
  creator: "Hygieia Wellness Clinic queue project",
  title: "Hygieia Wellness Clinic: Token Queue, design documentation",
  styles: {
    default: { document: { run: { font: BODY, size: 18, color: INK }, paragraph: { spacing: { line: 252 } } } },
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
