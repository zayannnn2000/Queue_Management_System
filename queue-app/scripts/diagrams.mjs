// Draws the two workflow diagrams (docs/workflow-overview.svg, docs/call-next-logic.svg) and PNG copies.
// Usage: node scripts/diagrams.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");

const KIND = {
  walk: { fill: "#f4f2f7", stroke: "#d8d2e1", title: "#17141f", sub: "#615a6e" },
  appt: { fill: "#efe8fa", stroke: "#c4b0e6", title: "#3f2c63", sub: "#6a5591" },
  shared: { fill: "#ffffff", stroke: "#ddd5ea", title: "#17141f", sub: "#615a6e" },
  decision: { fill: "#efe8fa", stroke: "#a98bd8", title: "#3f2c63", sub: "#6a5591" },
  action: { fill: "#17141f", stroke: "#17141f", title: "#ffffff", sub: "#cdb9ef" },
  note: { fill: "#ffffff", stroke: "#b9a3dd", title: "#3f2c63", sub: "#6a5591", dash: "4 3" },
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function box(x, y, w, h, title, sub = [], kind = "shared") {
  const k = KIND[kind];
  const lines = Array.isArray(sub) ? sub : [sub];
  const block = 15 + lines.length * 12.5;
  let ty = y + (h - block) / 2 + 12;
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1"${
    k.dash ? ` stroke-dasharray="${k.dash}"` : ""
  }/>`;
  out += `<text x="${x + w / 2}" y="${ty}" text-anchor="middle" font-size="12" font-weight="700" fill="${k.title}">${esc(title)}</text>`;
  for (const line of lines) {
    ty += 13;
    out += `<text x="${x + w / 2}" y="${ty}" text-anchor="middle" font-size="10" fill="${k.sub}">${esc(line)}</text>`;
  }
  return out;
}

function arrow(points, { dashed = false } = {}) {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return `<path d="${d}" fill="none" stroke="#8f8a99" stroke-width="1.4"${dashed ? ' stroke-dasharray="4 3"' : ""} marker-end="url(#head)"/>`;
}

function label(x, y, text, anchor = "start") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="10" font-weight="600" fill="#615a6e">${esc(text)}</text>`;
}

function svg(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}" font-family="Manrope, 'Segoe UI', Arial, sans-serif">
<title>${esc(title)}</title>
<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="#8f8a99"/></marker></defs>
<rect width="${width}" height="${height}" fill="#ffffff"/>
${body}
</svg>
`;
}

// ---- Workflow overview ----
const overview = svg(
  470,
  458,
  "Hygieia queue workflow: each patient joins the queue of their service, ordered by target time",
  [
    box(10, 10, 165, 48, "Walk-in arrives", "Staff add name and service", "walk"),
    box(190, 10, 165, 48, "Appointment booked", "e.g. CA-001, not queued yet", "appt"),
    box(374, 10, 86, 48, "No arrival?", ["Overdue:", "staff decide"], "note"),
    box(10, 84, 165, 56, "Token printed (CW-004)", ["Target = arrival, or +15 min", "if a booking is due soon"], "walk"),
    box(190, 84, 165, 56, "Checks in on arrival", ["Slip printed;", "over 10 min late → walk-in"], "appt"),
    box(10, 168, 320, 52, "Queue of their service", ["Consultation, Blood test, …: each with its", "own room(s); staff may flag Priority"], "shared"),
    box(346, 168, 114, 52, "Public display", ["A panel per service:", "token, initial, wait"], "shared"),
    box(10, 248, 320, 48, "A room calls next", "From its own service queue · behind the staff PIN", "action"),
    box(10, 324, 320, 48, "Being seen in the room", "Call time recorded, reason shown", "shared"),
    box(10, 400, 320, 48, "Served · No-show · Cancelled", "Visit length feeds the wait estimate", "shared"),
    arrow([[92, 58], [92, 84]]),
    arrow([[272, 58], [272, 84]]),
    arrow([[355, 34], [373, 34]], { dashed: true }),
    arrow([[92, 140], [92, 168]]),
    arrow([[272, 140], [272, 168]]),
    arrow([[330, 194], [345, 194]]),
    arrow([[170, 220], [170, 248]]),
    arrow([[170, 296], [170, 324]]),
    arrow([[170, 372], [170, 400]]),
    arrow([[330, 424], [403, 424], [403, 221]], { dashed: true }),
    label(411, 330, "updates"),
    label(411, 343, "waits"),
  ].join("\n"),
);

// ---- Call-next decision ----
const line = (points) =>
  `<path d="${points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")}" fill="none" stroke="#8f8a99" stroke-width="1.4"/>`;

const callNext = svg(
  470,
  628,
  "Call next decision for one room: priority, due appointments and protected walk-ins, other due walk-ins, else the earliest upcoming",
  [
    box(10, 10, 290, 40, "A room presses Call next", [], "action"),
    box(10, 76, 290, 48, "Nobody waiting for this service?", "Bookings not yet arrived are left out", "decision"),
    box(322, 76, 128, 48, "Room stays free", "Nothing to call", "shared"),
    box(10, 152, 290, 48, "A priority patient waiting?", "Flagged by staff, with a reason", "decision"),
    box(322, 152, 128, 48, "Earliest flagged", "Elderly, Urgent, …", "shared"),
    box(10, 228, 290, 56, "Due appointment or protected walk-in?", ["Booked time reached, or a walk-in", "who has waited 30+ min"], "decision"),
    box(322, 232, 128, 48, "Earliest target", "of these", "shared"),
    box(10, 312, 290, 48, "Another walk-in due?", "Target ≤ now (arrival, or +15 min hold)", "decision"),
    box(322, 312, 128, 48, "Earliest target", "of these", "shared"),
    box(10, 388, 290, 48, "Earliest upcoming target", "Nobody due: the room isn't left idle", "shared"),
    box(10, 464, 290, 48, "Being seen in the room", "Who was picked and why is shown", "shared"),
    box(10, 540, 290, 48, "Recompute waits per service", "Saved in Postgres; screens update live", "shared"),
    arrow([[155, 50], [155, 76]]),
    arrow([[300, 100], [321, 100]]),
    label(311, 93, "Yes", "middle"),
    arrow([[155, 124], [155, 152]]),
    label(162, 142, "No"),
    arrow([[300, 176], [321, 176]]),
    label(311, 169, "Yes", "middle"),
    arrow([[155, 200], [155, 228]]),
    label(162, 218, "No"),
    arrow([[300, 256], [321, 256]]),
    label(311, 249, "Yes", "middle"),
    arrow([[155, 284], [155, 312]]),
    label(162, 302, "No"),
    arrow([[300, 336], [321, 336]]),
    label(311, 329, "Yes", "middle"),
    arrow([[155, 360], [155, 388]]),
    label(162, 378, "No"),
    arrow([[155, 436], [155, 464]]),
    line([[450, 176], [460, 176]]),
    line([[450, 256], [460, 256]]),
    line([[450, 336], [460, 336]]),
    arrow([[460, 176], [460, 488], [301, 488]]),
    arrow([[155, 512], [155, 540]]),
    `<text x="10" y="606" font-size="10" fill="#615a6e">Ties: appointment first, then lower token. Staff can also Call now any waiting patient.</text>`,
    `<text x="10" y="620" font-size="10" fill="#615a6e">For the last patient, only Served and No-show are offered.</text>`,
  ].join("\n"),
);

writeFileSync(path.join(docs, "workflow-overview.svg"), overview);
writeFileSync(path.join(docs, "call-next-logic.svg"), callNext);

// PNG copies at 3×, for places that can't show SVG.
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
for (const name of ["workflow-overview", "call-next-logic"]) {
  const file = path.join(docs, `${name}.svg`);
  const page = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 470, height: 640 } });
  await page.goto(pathToFileURL(file).href);
  await page.locator("svg").screenshot({ path: path.join(docs, `${name}.png`) });
  await page.close();
}
await browser.close();
console.log("Wrote docs/workflow-overview.{svg,png} and docs/call-next-logic.{svg,png}");
