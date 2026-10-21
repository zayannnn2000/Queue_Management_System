"use client";

import { useCallback, useState } from "react";
import { MINUTE } from "@/lib/time";
import { clock, firstName } from "./format";
import { useQueue } from "./queue-provider";
import { serviceColor } from "./service-colors";

const WINDOW_MS = 60 * MINUTE;
const QUARTER = 15 * MINUTE;

/**
 * The next hour, as short as it can be, beside the page title: one thin lane per room, colour-coded
 * by service. No legend: hovering a lane names its room. Solid = being seen now, pale = projected.
 */
export function CallStrip({ className = "" }: { className?: string }) {
  const { state } = useQueue();
  const { view } = state;
  const [bandWidth, setBandWidth] = useState(0);
  const bandRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBandWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** The label that fits a bar of this many minutes: the token, its digits, or nothing. */
  const fit = (token: string, ms: number) => {
    const px = (ms / WINDOW_MS) * bandWidth;
    return px >= 48 ? token : px >= 26 ? token.slice(token.indexOf("-") + 1) : "";
  };
  const { now, settings } = view;
  const pct = (ms: number) => `${(Math.min(Math.max(ms - now, 0), WINDOW_MS) / WINDOW_MS) * 100}%`;
  const width = (start: number, end: number) =>
    `${((Math.min(end, now + WINDOW_MS) - Math.max(start, now)) / WINDOW_MS) * 100}%`;

  const ticks: number[] = [];
  for (let t = Math.ceil(now / QUARTER) * QUARTER; t <= now + WINDOW_MS; t += QUARTER) ticks.push(t);
  const later = view.waiting.filter((w) => w.startAt >= now + WINDOW_MS).length;

  return (
    <section
      aria-labelledby="timeline-heading"
      className={`flex min-w-0 gap-3 rounded-lg border border-border bg-surface px-3 py-2 ${className}`}
    >
      {/* The title sits in a narrow left column so the card needs no header row. */}
      <div className="flex w-14 flex-none flex-col justify-between">
        <h2 id="timeline-heading" className="text-[13px] leading-4 font-semibold">
          Next hour
        </h2>
        {later > 0 ? (
          <p className="num text-[10px] leading-3 text-muted" title={`${later} more after ${clock(now + WINDOW_MS, settings)}`}>
            +{later} later
          </p>
        ) : null}
      </div>
      <div className="min-w-0 flex-1" title="Projected from average service times">
      <div className="relative h-3 text-[10px] leading-3 text-muted" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2" style={{ left: pct(t) }}>
            {clock(t, settings)}
          </span>
        ))}
      </div>
      <div ref={bandRef} className="relative mt-1 flex flex-col gap-0.5">
        {ticks.map((t) => (
          <span key={t} aria-hidden="true" className="absolute -top-0.5 -bottom-0.5 w-px bg-border" style={{ left: pct(t) }} />
        ))}
        {view.rooms.map((r) => {
          const color = serviceColor(settings, r.serviceId);
          const lane = view.waiting.filter((w) => w.projectedRoom === r.id && w.startAt < now + WINDOW_MS);
          return (
            <div
              key={r.id}
              className="group relative h-3 rounded-full bg-raised/60 transition-colors hover:bg-active/70"
              role="list"
              aria-label={`${r.label}: next hour`}
            >
              {r.current ? (
                <Bar
                  left="0%"
                  width={width(now, r.expectedEndAt!)}
                  style={{ background: color.solid, color: "#fff" }}
                  label={fit(r.current.token, r.expectedEndAt! - now)}
                  title={`${r.label}: ${r.current.token} ${firstName(r.current.name)}, being seen until about ${clock(r.expectedEndAt!, settings)}`}
                />
              ) : null}
              {lane.map((w) => (
                <Bar
                  key={w.id}
                  left={pct(w.startAt)}
                  width={width(w.startAt, w.startAt + w.expectedMs)}
                  style={{ background: color.pale, color: color.ink, boxShadow: `inset 2px 0 0 ${color.solid}` }}
                  label={fit(w.token, Math.min(w.expectedMs, now + WINDOW_MS - w.startAt))}
                  title={`${r.label}: ${w.token} ${firstName(w.name)}, projected ${clock(w.startAt, settings)}`}
                />
              ))}
              {/* The legend, on hover: the room's name at the lane's right end. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-0.5 flex h-3 -translate-y-1/2 items-center gap-1 rounded-full bg-surface px-1.5 text-[9px] leading-none font-semibold whitespace-nowrap opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                style={{ color: color.ink }}
              >
                <span className="size-1.5 rounded-full" style={{ background: color.solid }} />
                {r.label}
              </span>
            </div>
          );
        })}
      </div>
      </div>
    </section>
  );
}

function Bar({
  left,
  width,
  style,
  label,
  title,
}: {
  left: string;
  width: string;
  style: React.CSSProperties;
  label: string;
  title: string;
}) {
  return (
    <span
      role="listitem"
      title={title}
      className="absolute top-0 flex h-full items-center overflow-hidden rounded-full px-1.5 font-token text-[9px] leading-none whitespace-nowrap"
      // A 2px gap keeps neighbouring bars apart.
      style={{ ...style, left, width: `max(0px, calc(${width} - 2px))` }}
    >
      <span className="sr-only">{title}</span>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
