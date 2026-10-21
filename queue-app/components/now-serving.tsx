"use client";

import type { RoomView, WaitingRow } from "@/lib/queue";
import { chooseNext } from "@/lib/queue";
import { clock, firstName, minutes, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { DangerTextButton, PrimaryButton, SecondaryButton, Token } from "./ui";

/** One card per service room: who is being served there, and the controls for that room's queue. */
export function NowServing() {
  const { state } = useQueue();
  const { rooms } = state.view;
  return (
    <section aria-labelledby="rooms-heading">
      <h2 id="rooms-heading" className="sr-only">
        Rooms
      </h2>
      {/* A 6-column grid on wide screens: rows of three cards, and the last row widened to fill. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {rooms.map((r, i) => {
          const span = spanFor(i, rooms.length);
          return (
            <div key={r.id} className={`flex ${span}`}>
              {r.current ? <ServingRoom room={r} /> : <FreeRoom room={r} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Column spans so every row is full: 3 per row on wide screens, 2 per row on tablets. */
function spanFor(i: number, count: number): string {
  const lastRowWide = count % 3;
  const inLastRow = i >= count - lastRowWide;
  const wide = !inLastRow ? "lg:col-span-2" : lastRowWide === 1 ? "lg:col-span-6" : "lg:col-span-3";
  const tablet = count % 2 === 1 && i === count - 1 ? "sm:col-span-2" : "";
  return `${wide} ${tablet}`;
}

function RoomHeader({ room, status }: { room: RoomView; status: string }) {
  const { state } = useQueue();
  const name = serviceName(state.view.settings, room.serviceId);
  const rooms = state.view.settings.services.find((s) => s.id === room.serviceId)!.rooms;
  return (
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm leading-5">
        <span className="font-semibold text-ink">{name}</span>
        <span className="block text-xs text-muted">
          {rooms > 1 ? `Room ${room.n} · ` : ""}
          {status}
        </span>
      </p>
      <span className="num rounded-full bg-raised px-2 py-0.5 text-xs whitespace-nowrap text-muted">
        {room.waitingCount} waiting
      </span>
    </div>
  );
}

function CallReason({ room }: { room: RoomView }) {
  if (!room.lastCall) return null;
  return (
    <p className="mt-3 text-xs leading-5 text-muted" aria-live="polite">
      <span className="sr-only">Why: </span>
      {room.lastCall.reason}
    </p>
  );
}

function ServingRoom({ room }: { room: RoomView }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const current = room.current!;
  const hasNext = room.waitingCount > 0;

  return (
    <article className="flex w-full flex-col rounded-lg border border-border bg-surface p-4" aria-label={room.label}>
      <RoomHeader room={room} status="Serving" />
      <Token className="mt-2 font-display text-[40px] leading-[42px] font-semibold tracking-normal">{current.token}</Token>
      <p className="truncate text-sm">{current.name}</p>
      <p className="num mt-0.5 text-xs text-muted">
        Called {clock(current.calledAt!, view.settings)} · {minutes(view.now - current.calledAt!)} so far · done ~
        {clock(room.expectedEndAt!, view.settings)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {hasNext ? (
          <>
            <PrimaryButton
              className="h-8 px-3 text-[13px]"
              disabled={meta.pending}
              onClick={() => actions.run({ type: "serve", room: room.id, callNext: true })}
            >
              Served &amp; call next
            </PrimaryButton>
            <SecondaryButton
              className="h-8 px-3 text-[13px]"
              disabled={meta.pending}
              onClick={() => actions.run({ type: "serve", room: room.id })}
            >
              Served
            </SecondaryButton>
          </>
        ) : (
          // Last patient in this queue: nobody to call next, so "Served" becomes the main action.
          <PrimaryButton
            className="h-8 px-3 text-[13px]"
            disabled={meta.pending}
            onClick={() => actions.run({ type: "serve", room: room.id })}
          >
            Served
          </PrimaryButton>
        )}
        <DangerTextButton
          className="h-8 px-2 text-[13px]"
          disabled={meta.pending}
          onClick={() => {
            if (window.confirm(`Mark ${current.token} (${current.name}) as a no-show?`)) {
              actions.run({ type: "noShow", id: current.id });
            }
          }}
        >
          No-show
        </DangerTextButton>
      </div>
      <CallReason room={room} />
    </article>
  );
}

function FreeRoom({ room }: { room: RoomView }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const queue = view.waiting.filter((w) => w.service === room.serviceId);
  const next = chooseNext(queue, view.now, view.settings) as { customer: WaitingRow; tier: number } | null;

  return (
    <article className="flex w-full flex-col rounded-lg border border-border bg-surface p-4" aria-label={room.label}>
      <RoomHeader room={room} status="Free" />
      {next ? (
        <p className="mt-3 text-sm">
          Next up: <Token>{next.customer.token}</Token> {firstName(next.customer.name)}
          <span className="block text-xs text-muted">
            {next.customer.priority
              ? `Priority: ${next.customer.priority.reason}`
              : next.tier === 3
                ? `early, slot ${clock(next.customer.targetAt, view.settings)}`
                : "due now"}
          </span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">Nobody waiting for this service.</p>
      )}
      <div className="mt-3">
        <PrimaryButton
          className="h-8 px-3 text-[13px]"
          disabled={meta.pending || !next}
          onClick={() => actions.run({ type: "callNext", room: room.id })}
        >
          Call next
        </PrimaryButton>
      </div>
      <CallReason room={room} />
    </article>
  );
}
