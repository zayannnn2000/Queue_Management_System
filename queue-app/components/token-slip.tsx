"use client";

import qrcode from "qrcode-generator";
import { createPortal } from "react-dom";
import { HygieiaMark } from "./brand";
import { clock, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { PrimaryButton, TextButton, Token } from "./ui";

/**
 * The paper slip handed to the patient: token, booking, service, place and estimated wait, and a QR
 * code that opens their place on the waiting-room display.
 * Rendered into <body> only while printing; the print stylesheet in
 * globals.css hides everything else and sizes the page for an 80 mm receipt printer.
 */
export function PrintSlip() {
  const { state } = useQueue();
  const { view, printing } = state;
  if (!printing) return null;
  const row = view.waiting.find((w) => w.token === printing);
  const customer = row ?? [...view.booked, ...view.done, ...view.rooms.flatMap((r) => (r.current ? [r.current] : []))].find(
    (c) => c.token === printing,
  );
  if (!customer) return null;
  const { settings } = view;
  const rooms = settings.services.find((s) => s.id === customer.service)?.rooms ?? 1;
  const room = rooms === 1 ? "Room 1" : "Next free room";
  const booking =
    customer.type === "walk_in"
      ? "Walk-in"
      : customer.lateConverted
        ? "Appointment, joined as walk-in"
        : `Appointment ${clock(customer.scheduledAt!, settings)}`;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, weekday: "short", day: "numeric", month: "short" }).format(view.now);
  const displayUrl = `${window.location.origin}/display?token=${encodeURIComponent(customer.token)}`;

  // The page is 80 mm wide with 4 mm margins, so the slip fills the 72 mm between them, centred.
  return createPortal(
    <div id="print-slip" className="hidden font-sans text-black" style={{ width: "100%", maxWidth: "72mm", margin: "0 auto" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <HygieiaMark size={48} />
        </div>
        <p className="font-display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, marginTop: 6 }}>
          Hygieia
        </p>
        <p style={{ fontSize: 12, marginTop: 4 }}>Wellness Clinic</p>
        <p style={{ fontSize: 13, marginTop: 16 }}>Your token</p>
        <p className="font-display" style={{ fontSize: 84, fontWeight: 700, lineHeight: 1, marginTop: 4 }}>
          {customer.token}
        </p>
      </div>
      <dl style={{ fontSize: 13, marginTop: 16, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px" }}>
        <dt>Booking</dt>
        <dd style={{ textAlign: "right", fontWeight: 600 }}>{booking}</dd>
        <dt>Service</dt>
        <dd style={{ textAlign: "right", fontWeight: 600 }}>{serviceName(settings, customer.service)}</dd>
        <dt>Room</dt>
        <dd style={{ textAlign: "right", fontWeight: 600 }}>{room}</dd>
        {row ? (
          <>
            <dt>Place in queue</dt>
            <dd style={{ textAlign: "right", fontWeight: 600 }}>{row.position}</dd>
            <dt>Estimated wait</dt>
            <dd style={{ textAlign: "right", fontWeight: 600 }}>{row.waitLabel}</dd>
          </>
        ) : null}
        <dt>Issued</dt>
        <dd style={{ textAlign: "right" }}>
          {date}, {clock(view.now, settings)}
        </dd>
      </dl>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <QrCode text={displayUrl} size={112} />
        <p style={{ fontSize: 11.5, textAlign: "center", lineHeight: 1.35 }}>
          Scan to follow your place in line on your phone.
        </p>
      </div>
      <p style={{ fontSize: 12, marginTop: 8, textAlign: "center" }}>Please keep this slip until you are called.</p>
    </div>,
    document.body,
  );
}

/** A QR code drawn as one SVG path (black modules on white, 2-module quiet zone), so it prints crisply. */
function QrCode({ text, size }: { text: string; size: number }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code: ${text}`}
    >
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** The card shown after a walk-in is added or an appointment checks in: the number to give, and Print. */
export function TokenReady() {
  const { state, actions } = useQueue();
  const { ready, view } = state;
  if (!ready) return null;
  const row = view.waiting.find((w) => w.token === ready);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-accent-pale px-4 py-2.5" aria-live="polite">
      <Token className="font-display text-[32px] leading-9 font-semibold tracking-normal">{ready}</Token>
      <p className="num min-w-0 flex-1 text-xs text-muted">
        <span className="font-medium text-accent">{row ? "In the queue. Give the patient this token." : "Token"}</span>
        {row ? (
          <>
            <br />
            Place {row.position} · {row.waitLabel}
          </>
        ) : null}
      </p>
      <div className="flex items-center gap-1">
        <PrimaryButton onClick={() => actions.print(ready)}>Print token</PrimaryButton>
        <TextButton onClick={actions.clearReady}>Done</TextButton>
      </div>
    </div>
  );
}
