"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomView, WaitingRow } from "@/lib/queue";
import { chooseNext } from "@/lib/queue";
import { clock, firstName, minutes, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { serviceColor } from "./service-colors";
import { DangerTextButton, PrimaryButton, SecondaryButton, Token } from "./ui";

/**
 * One pill per service room. The pill shows the service, who is being seen and the one action for
 * that room (Call next / Served & call next / Served), always visible. Clicking the pill opens the
 * details: patient, times, the reason they were called, and No-show.
 */
export function NowServing() {
  const { state } = useQueue();
  const [open, setOpen] = useState<string | null>(null);
  const { rooms } = state.view;
  return (
    <section aria-labelledby="rooms-heading" className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="rooms-heading" className="text-base font-semibold">
          Rooms
        </h2>
        <p className="text-xs text-muted">Tap a room for details</p>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {rooms.map((r) => (
          <li key={r.id}>
            <RoomPill room={r} open={open === r.id} onToggle={() => setOpen((o) => (o === r.id ? null : r.id))} onClose={() => setOpen(null)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoomPill({
  room,
  open,
  onToggle,
  onClose,
}: {
  room: RoomView;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const color = serviceColor(view.settings, room.serviceId);
  const rooms = view.settings.services.find((s) => s.id === room.serviceId)!.rooms;
  const name = `${serviceName(view.settings, room.serviceId)}${rooms > 1 ? ` · ${room.n}` : ""}`;
  const queue = view.waiting.filter((w) => w.service === room.serviceId);
  const next = room.current ? null : (chooseNext(queue, view.now, view.settings) as { customer: WaitingRow; tier: number } | null);
  const wrap = useRef<HTMLDivElement>(null);
  const panelId = `room-panel-${room.id.replace(":", "-")}`;

  // Close the details on Escape or a click outside the pill.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  const action = room.current ? (
    room.waitingCount > 0 ? (
      <PrimaryButton
        className="h-8 px-3 text-[13px]"
        disabled={meta.pending}
        onClick={() => actions.run({ type: "serve", room: room.id, callNext: true })}
      >
        Served &amp; call next
      </PrimaryButton>
    ) : (
      // Last patient in this queue: nobody to call next.
      <PrimaryButton className="h-8 px-3 text-[13px]" disabled={meta.pending} onClick={() => actions.run({ type: "serve", room: room.id })}>
        Served
      </PrimaryButton>
    )
  ) : (
    <PrimaryButton
      className="h-8 px-3 text-[13px]"
      disabled={meta.pending || !next}
      onClick={() => actions.run({ type: "callNext", room: room.id })}
    >
      Call next
    </PrimaryButton>
  );

  return (
    <div ref={wrap} role="group" aria-label={room.label} className="relative">
      <div
        className="flex items-center gap-2 rounded-full py-1 pr-1.5 pl-2"
        style={{ background: color.pale, boxShadow: open ? `inset 0 0 0 1.5px ${color.solid}` : undefined }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-1 py-0.5 text-left"
        >
          <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: color.solid }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold" style={{ color: color.ink }}>
              {name}
            </span>
            <span className="num block truncate text-xs text-muted">
              {room.current ? (
                <>
                  <Token className="text-ink">{room.current.token}</Token> · {firstName(room.current.name)}
                </>
              ) : next ? (
                <>
                  Free · next <Token className="text-ink">{next.customer.token}</Token>
                </>
              ) : (
                "Free"
              )}
              {` · ${room.waitingCount} waiting`}
            </span>
          </span>
        </button>
        {action}
      </div>

      {open ? (
        <div
          id={panelId}
          className="absolute top-full right-0 left-0 z-20 mt-1.5 rounded-lg border border-border bg-surface p-4 shadow-[0_12px_28px_rgba(23,20,31,0.14)]"
        >
          {room.current ? (
            <>
              <p className="text-xs text-muted">{room.label} · being seen</p>
              <Token className="mt-1 block font-display text-[34px] leading-9 font-semibold tracking-normal">{room.current.token}</Token>
              <p className="text-sm">{room.current.name}</p>
              <p className="num mt-1 text-xs text-muted">
                Called {clock(room.current.calledAt!, view.settings)} · {minutes(view.now - room.current.calledAt!)} so far · expected
                done {clock(room.expectedEndAt!, view.settings)}
              </p>
              {room.lastCall ? <p className="mt-2 text-xs leading-5 text-muted">{room.lastCall.reason}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {room.waitingCount > 0 ? (
                  <SecondaryButton className="h-8 px-3 text-[13px]" disabled={meta.pending} onClick={() => actions.run({ type: "serve", room: room.id })}>
                    Served
                  </SecondaryButton>
                ) : null}
                <DangerTextButton
                  className="h-8 px-2 text-[13px]"
                  disabled={meta.pending}
                  onClick={() => {
                    const c = room.current!;
                    if (window.confirm(`Mark ${c.token} (${c.name}) as a no-show?`)) actions.run({ type: "noShow", id: c.id });
                  }}
                >
                  No-show
                </DangerTextButton>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted">{room.label} · free</p>
              {next ? (
                <p className="mt-1 text-sm">
                  Next up: <Token>{next.customer.token}</Token> {next.customer.name}
                  <span className="block text-xs text-muted">
                    {next.customer.priority
                      ? `Priority: ${next.customer.priority.reason}`
                      : next.tier === 3
                        ? `Early: booked for ${clock(next.customer.targetAt, view.settings)}`
                        : "Due now"}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">Nobody is waiting for this service.</p>
              )}
              {room.lastCall ? <p className="mt-2 text-xs leading-5 text-muted">Last call: {room.lastCall.reason}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
