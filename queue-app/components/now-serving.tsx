"use client";

import type { CounterView, WaitingRow } from "@/lib/queue";
import { chooseNext } from "@/lib/queue";
import { clock, firstName, minutes, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { DangerTextButton, PrimaryButton, SecondaryButton, Token } from "./ui";

/** One card per counter: who is being served, and the controls to close out or call next. */
export function NowServing() {
  const { state } = useQueue();
  const { counters } = state.view;
  const cols = counters.length === 1 ? "" : counters.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4";
  return (
    <section aria-labelledby="counters-heading">
      <h2 id="counters-heading" className="sr-only">
        Counters
      </h2>
      <div className={`grid gap-4 ${cols}`}>
        {counters.map((c) =>
          c.current ? <ServingCounter key={c.counter} counter={c} /> : <IdleCounter key={c.counter} counter={c} />,
        )}
      </div>
    </section>
  );
}

function CounterHeader({ counter, status }: { counter: number; status: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <span className="font-semibold text-ink">Counter {counter}</span>
      <span aria-hidden="true">·</span>
      <span>{status}</span>
    </p>
  );
}

function CallReason({ counter }: { counter: CounterView }) {
  if (!counter.lastCall) return null;
  return (
    <p className="mt-3 text-xs leading-5 text-muted" aria-live="polite">
      <span className="sr-only">Why: </span>
      {counter.lastCall.reason}
    </p>
  );
}

function ServingCounter({ counter }: { counter: CounterView }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const current = counter.current!;
  const elapsed = view.now - current.calledAt!;
  const hasNext = view.waiting.length > 0;

  return (
    <article className="rounded-lg border border-border bg-surface p-5" aria-label={`Counter ${counter.counter}`}>
      <CounterHeader counter={counter.counter} status="Serving" />
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <Token className="text-[28px] leading-8">{current.token}</Token>
        <p className="pb-0.5 text-base">
          {current.name}
          <span className="text-muted"> · {serviceName(view.settings, current.service)}</span>
        </p>
      </div>
      <p className="num mt-1 text-sm text-muted">
        Called {clock(current.calledAt!, view.settings)} · {minutes(elapsed)} so far · expected done{" "}
        {clock(counter.expectedEndAt!, view.settings)}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PrimaryButton
          disabled={meta.pending || !hasNext}
          onClick={() => actions.run({ type: "serve", counter: counter.counter, callNext: true })}
          title={hasNext ? undefined : "Nobody is waiting"}
        >
          Served &amp; call next
        </PrimaryButton>
        <SecondaryButton
          disabled={meta.pending}
          onClick={() => actions.run({ type: "serve", counter: counter.counter })}
        >
          Served
        </SecondaryButton>
        <DangerTextButton
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
      <CallReason counter={counter} />
    </article>
  );
}

function IdleCounter({ counter }: { counter: CounterView }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const next = chooseNext(view.waiting, view.now) as { customer: WaitingRow; due: boolean } | null;

  return (
    <article className="rounded-lg border border-border bg-surface p-5" aria-label={`Counter ${counter.counter}`}>
      <CounterHeader counter={counter.counter} status="Free" />
      {next ? (
        <p className="mt-3 text-base">
          Next up: <Token>{next.customer.token}</Token> {firstName(next.customer.name)}
          <span className="text-muted">
            {" "}
            · {serviceName(view.settings, next.customer.service)} ·{" "}
            {next.due ? "due now" : `early, slot ${clock(next.customer.targetAt, view.settings)}`}
          </span>
        </p>
      ) : (
        <p className="mt-3 text-base text-muted">Nobody is checked in. The counter stays free.</p>
      )}
      <div className="mt-4">
        <PrimaryButton
          disabled={meta.pending || !next}
          onClick={() => actions.run({ type: "callNext", counter: counter.counter })}
        >
          Call next
        </PrimaryButton>
      </div>
      <CallReason counter={counter} />
    </article>
  );
}
