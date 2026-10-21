"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PublicRow, PublicView } from "@/lib/queue";
import { DEFAULT_SETTINGS } from "@/lib/queue";
import { formatClock } from "@/lib/time";
import { HygieiaMark } from "./brand";
import { POLL_MS } from "./queue-provider";

const MAX_ROWS = 10;

/** Public waiting-room board: token and initial only. Polls the public view every 3 s. */
export function DisplayBoard({ initial, highlight }: { initial: PublicView; highlight: string | null }) {
  const [view, setView] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/state?view=public", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        setView(((await res.json()) as { view: PublicView }).view);
        setStale(false);
      } catch {
        setStale(true);
      }
    };
    const id = window.setInterval(poll, POLL_MS);
    // A phone coming back to the page refreshes at once instead of waiting for a throttled timer.
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  const mine = highlight ? view.waiting.find((w) => w.token === highlight) : undefined;
  const mineServing = highlight ? view.counters.find((c) => c.token === highlight) : undefined;
  const shown = view.waiting.slice(0, MAX_ROWS);
  const hidden = view.waiting.length - shown.length;
  const mineHidden = mine && !shown.includes(mine);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-6 md:px-10 md:py-8">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="flex items-center gap-4">
          <HygieiaMark size={60} />
          <span className="flex flex-col">
            <span className="font-display text-[40px] leading-10 font-semibold tracking-[-0.01em] md:text-[48px] md:leading-[48px]">
              Hygieia
            </span>{" "}
            <span className="text-base font-medium text-muted">Wellness Clinic</span>
          </span>
        </h1>
        <p className="num text-lg text-muted md:ml-auto">
          {formatClock(view.now, DEFAULT_SETTINGS.timezone)} · Updated every 3 seconds
          {stale ? <span className="ml-2 text-warn-ink">(reconnecting)</span> : null}
        </p>
      </header>

      {highlight ? (
        <YourStatus token={highlight} row={mine} servingAt={mineServing?.counter ?? null} />
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-labelledby="serving-heading" className="rounded-2xl bg-ink p-6 text-white md:p-9">
          <h2 id="serving-heading" className="font-display text-3xl font-semibold text-accent-soft md:text-4xl">
            Now serving
          </h2>
          <ul className="mt-6 flex flex-col gap-6" aria-live="polite">
            {view.counters.map((c) => (
              <li key={c.counter} className="flex items-baseline justify-between gap-4">
                <span className="text-xl whitespace-nowrap text-white/80 md:text-2xl">Counter {c.counter}</span>
                {c.token ? (
                  <span translate="no" className="font-display text-6xl font-semibold whitespace-nowrap sm:text-7xl xl:text-[112px] xl:leading-none">
                    {c.token}
                    <span className="ml-3 font-sans text-3xl text-accent-soft md:text-4xl">{c.initial}</span>
                  </span>
                ) : (
                  <span className="text-3xl text-white/70 md:text-4xl">Free</span>
                )}
              </li>
            ))}
          </ul>
          {view.waiting.length > 0 ? (
            <div className="mt-8 border-t border-white/15 pt-6">
              <h3 className="text-lg font-semibold text-accent-soft md:text-xl">Please get ready</h3>
              <p translate="no" className="mt-2 flex flex-wrap gap-x-8 gap-y-1 font-display text-4xl font-semibold md:text-5xl">
                {view.waiting.slice(0, 2).map((w) => (
                  <span key={w.token}>{w.token}</span>
                ))}
              </p>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="waiting-heading" className="rounded-2xl border border-border bg-surface p-6 md:p-8">
          <div className="flex items-baseline gap-4">
            <h2 id="waiting-heading" className="font-display text-3xl font-semibold md:text-4xl">
              Waiting
            </h2>
            <p className="num text-lg text-muted">{view.waiting.length} in line</p>
          </div>
          {view.waiting.length === 0 ? (
            <p className="mt-6 text-2xl text-muted">Nobody is waiting. Please check in at the front desk.</p>
          ) : (
            <table className="mt-4 w-full border-collapse">
              <thead>
                <tr className="text-left text-base text-muted md:text-lg">
                  <th className="h-10 w-12 pr-3 text-right font-normal sm:w-20 sm:pr-4">Place</th>
                  <th className="h-10 font-normal">Token</th>
                  <th className="h-10 text-right font-normal whitespace-nowrap">
                    <span className="max-sm:hidden">Estimated wait</span>
                    <span className="sm:hidden">Wait</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <Row key={row.token} row={row} mine={row.token === highlight} />
                ))}
              </tbody>
            </table>
          )}
          {hidden > 0 ? (
            <p className="num mt-3 text-lg text-muted">
              and {hidden} more{mineHidden ? `, including you at place ${mine.position}` : ""}
            </p>
          ) : null}
        </section>
      </div>

      <footer className="mt-auto flex pt-6 flex-wrap items-center gap-x-6 gap-y-3 text-base text-muted">
        <p>Times are estimates from recent visit lengths. Appointments are seen at their booked time.</p>
        <FindToken current={highlight} />
      </footer>
    </div>
  );
}

function Row({ row, mine }: { row: PublicRow; mine: boolean }) {
  return (
    <tr
      className={`border-t border-rule text-xl whitespace-nowrap sm:text-2xl md:text-3xl ${mine ? "bg-accent-pale" : ""}`}
      aria-current={mine ? "true" : undefined}
    >
      <td className="num h-16 pr-3 text-right text-muted sm:pr-4">{row.position}</td>
      <td className="h-16">
        <span translate="no" className={`font-token ${mine ? "text-accent" : ""}`}>{row.token}</span>
        <span className="ml-3 text-muted">{row.initial}</span>
        {mine ? <span className="ml-2 text-base font-medium text-accent sm:ml-3 sm:text-lg">You</span> : null}
      </td>
      <td className="num h-16 text-right font-medium">{row.waitLabel}</td>
    </tr>
  );
}

function YourStatus({ token, row, servingAt }: { token: string; row?: PublicRow; servingAt: number | null }) {
  let text: string;
  if (servingAt !== null) text = `It's your turn. Please go to counter ${servingAt}.`;
  else if (row) text = `You are number ${row.position} in line. ${row.waitLabel === "Due now" ? "You're due now." : `Estimated wait ${row.waitLabel.replace("~", "about ")}.`}`;
  else text = "This token isn't waiting right now. If you have an appointment, please check in at the front desk.";
  return (
    <section
      aria-live="polite"
      className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl bg-accent-pale px-6 py-4 text-accent"
    >
      <h2 translate="no" className="font-display text-4xl font-semibold">{token}</h2>
      <p className="text-xl text-ink md:text-2xl">{text}</p>
    </section>
  );
}

function FindToken({ current }: { current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  return (
    <form
      className="flex items-center gap-2 md:ml-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const token = value.trim().toUpperCase();
        router.replace(token ? `/display?token=${encodeURIComponent(token)}` : "/display");
      }}
    >
      <label htmlFor="find-token" className="text-base">
        Find my token
      </label>
      <input
        id="find-token"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="W-004…"
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-32 rounded-full border border-control bg-surface px-4 font-token text-base text-ink uppercase"
      />
      <button type="submit" className="h-10 rounded-full bg-primary px-5 text-base font-semibold text-white hover:bg-black">
        Show
      </button>
    </form>
  );
}
