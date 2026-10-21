"use client";

import { createPortal } from "react-dom";
import { HygieiaMark } from "./brand";
import { clock, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { PrimaryButton, TextButton, Token } from "./ui";

/**
 * The paper slip handed to the patient: token, booking, service, place and estimated wait, and
 * where to follow their turn. Rendered into <body> only while printing; the print stylesheet in
 * globals.css hides everything else and sizes the page for an 80 mm receipt printer.
 */
export function PrintSlip() {
  const { state } = useQueue();
  const { view, printing } = state;
  if (!printing) return null;
  const row = view.waiting.find((w) => w.token === printing);
  const customer = row ?? [...view.booked, ...view.done, ...view.counters.flatMap((c) => (c.current ? [c.current] : []))].find(
    (c) => c.token === printing,
  );
  if (!customer) return null;
  const { settings } = view;
  const booking =
    customer.type === "walk_in"
      ? "Walk-in"
      : customer.lateConverted
        ? "Appointment, joined as walk-in"
        : `Appointment ${clock(customer.scheduledAt!, settings)}`;
  const displayUrl = `${window.location.origin}/display?token=${encodeURIComponent(customer.token)}`;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, weekday: "short", day: "numeric", month: "short" }).format(view.now);

  return createPortal(
    <div id="print-slip" className="hidden font-sans text-black" style={{ width: "72mm" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <HygieiaMark size={44} />
        </div>
        <p className="font-display" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1, marginTop: 6 }}>
          Hygieia
        </p>
        <p style={{ fontSize: 11 }}>Wellness Clinic</p>
        <p style={{ fontSize: 11, marginTop: 14 }}>Your token</p>
        <p className="font-display" style={{ fontSize: 64, fontWeight: 700, lineHeight: 1, marginTop: 2 }}>
          {customer.token}
        </p>
      </div>
      <dl style={{ fontSize: 12, marginTop: 14, display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px" }}>
        <dt>Booking</dt>
        <dd style={{ textAlign: "right", fontWeight: 600 }}>{booking}</dd>
        <dt>Service</dt>
        <dd style={{ textAlign: "right", fontWeight: 600 }}>{serviceName(settings, customer.service)}</dd>
        {row ? (
          <>
            <dt>Place in line</dt>
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
      <p style={{ fontSize: 11, marginTop: 14, lineHeight: 1.4 }}>
        Please watch the waiting-room screen for your number. You can also follow your place at:
      </p>
      <p style={{ fontSize: 10, marginTop: 4, wordBreak: "break-all" }}>{displayUrl}</p>
      <p style={{ fontSize: 11, marginTop: 12, textAlign: "center" }}>Please keep this slip until you are called.</p>
    </div>,
    document.body,
  );
}

/** The card shown after a walk-in is added or an appointment checks in: the number to give, and Print. */
export function TokenReady() {
  const { state, actions } = useQueue();
  const { ready, view } = state;
  if (!ready) return null;
  const row = view.waiting.find((w) => w.token === ready);
  return (
    <div className="mt-5 rounded-lg bg-accent-pale p-4" aria-live="polite">
      <p className="text-xs font-medium text-accent">{row ? "In the queue. Give the patient this token." : "Token"}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <Token className="font-display text-[44px] leading-[44px] font-semibold tracking-normal">{ready}</Token>
        {row ? (
          <p className="num pb-1 text-right text-sm text-muted">
            Place {row.position}
            <br />
            {row.waitLabel}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={() => actions.print(ready)}>Print token</PrimaryButton>
        <TextButton onClick={actions.clearReady}>Done</TextButton>
      </div>
    </div>
  );
}
