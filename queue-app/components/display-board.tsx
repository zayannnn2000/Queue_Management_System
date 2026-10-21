"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PublicRow, PublicService, PublicView } from "@/lib/queue";
import { DEFAULT_SETTINGS } from "@/lib/queue";
import { formatClock } from "@/lib/time";
import { HygieiaMark } from "./brand";
import { POLL_MS } from "./queue-provider";

const ROWS_PER_PANEL = 5;

/** Public waiting-room board: one panel per service queue, token and initial only. Polls every 3 s. */
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

  return (
    <div className="mx-auto flex min-h-screen max-w-[1920px] flex-col px-4 py-6 md:px-10 md:py-8">
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

      {highlight ? <YourStatus token={highlight} view={view} /> : null}

      {/* Rows of three panels on wide screens, the last row widened so the board has no gaps. */}
      <div className="mt-6 grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-6">
        {view.services.map((s, i, all) => {
          const rest = all.length % 3;
          const span = i < all.length - rest ? "lg:col-span-2" : rest === 1 ? "lg:col-span-6" : "lg:col-span-3";
          const tablet = all.length % 2 === 1 && i === all.length - 1 ? "sm:col-span-2" : "";
          return (
            <div key={s.id} className={`${span} ${tablet}`}>
              <ServicePanel service={s} highlight={highlight} />
            </div>
          );
        })}
      </div>

      <footer className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 pt-6 text-base text-muted">
        <p>Each service has its own queue. Times are estimates; appointments are seen at their booked time.</p>
        <FindToken current={highlight} />
      </footer>
    </div>
  );
}

function ServicePanel({ service, highlight }: { service: PublicService; highlight: string | null }) {
  const shown = service.waiting.slice(0, ROWS_PER_PANEL);
  const hidden = service.waiting.length - shown.length;
  const mine = highlight ? service.waiting.find((w) => w.token === highlight) : undefined;
  return (
    <section aria-labelledby={`svc-${service.id}`} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      <header className="flex items-baseline justify-between gap-3 px-5 pt-5">
        <h2 id={`svc-${service.id}`} className="font-display text-2xl leading-7 font-semibold">
          {service.name}
        </h2>
        <span className="num text-sm whitespace-nowrap text-muted">{service.waiting.length} waiting</span>
      </header>

      <div className="mx-3 mt-3 rounded-xl bg-ink px-4 py-4 text-white" aria-live="polite">
        <p className="text-sm font-semibold text-accent-soft">Now serving</p>
        <ul className="mt-1 flex flex-col gap-1">
          {service.rooms.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3">
              {r.token ? (
                <span translate="no" className="font-display text-5xl leading-[52px] font-semibold whitespace-nowrap">
                  {r.token}
                  <span className="ml-2 font-sans text-xl text-accent-soft">{r.initial}</span>
                </span>
              ) : (
                <span className="text-2xl leading-[52px] text-white/70">Free</span>
              )}
              <span className="text-sm whitespace-nowrap text-white/80">{r.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-5 pt-3 pb-5">
        {service.waiting.length === 0 ? (
          <p className="py-2 text-base text-muted">Nobody waiting.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-sm text-muted">
                <th className="h-8 w-8 pr-2 text-right font-normal">#</th>
                <th className="h-8 font-normal">Token</th>
                <th className="h-8 text-right font-normal">Wait</th>
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
          <p className="num mt-2 text-sm text-muted">
            and {hidden} more{mine && !shown.includes(mine) ? `, including you at place ${mine.position}` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Row({ row, mine }: { row: PublicRow; mine: boolean }) {
  return (
    <tr
      className={`border-t border-rule text-xl whitespace-nowrap ${mine ? "bg-accent-pale" : ""}`}
      aria-current={mine ? "true" : undefined}
    >
      <td className="num h-11 pr-2 text-right text-muted">{row.position}</td>
      <td className="h-11">
        <span translate="no" className={`font-token ${mine ? "text-accent" : ""}`}>
          {row.token}
        </span>
        <span className="ml-2 text-muted">{row.initial}</span>
        {mine ? <span className="ml-2 text-sm font-medium text-accent">You</span> : null}
      </td>
      <td className="num h-11 text-right font-medium">{row.waitLabel}</td>
    </tr>
  );
}

function YourStatus({ token, view }: { token: string; view: PublicView }) {
  let text = "This token isn't waiting right now. If you have an appointment, please check in at the front desk.";
  for (const s of view.services) {
    const room = s.rooms.find((r) => r.token === token);
    if (room) {
      text = `It's your turn. Please go to ${s.name} · ${room.label}.`;
      break;
    }
    const row = s.waiting.find((w) => w.token === token);
    if (row) {
      text = `You are number ${row.position} in the ${s.name} queue. ${
        row.waitLabel === "Due now" ? "You're due now." : `Estimated wait ${row.waitLabel.replace("~", "about ")}.`
      }`;
      break;
    }
  }
  return (
    <section
      aria-live="polite"
      className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl bg-accent-pale px-6 py-4 text-accent"
    >
      <h2 translate="no" className="font-display text-4xl font-semibold">
        {token}
      </h2>
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
        placeholder="CW-004…"
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
