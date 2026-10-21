"use client";

import { useCallback, useState } from "react";
import { MINUTE } from "@/lib/time";
import { clock, firstName, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { Panel } from "./ui";

const WINDOW_MS = 60 * MINUTE;
const QUARTER = 15 * MINUTE;

/**
 * The next hour as the simulation projects it: one lane per counter, the patient being served in grey,
 * then each waiting patient in projected call order in the clinic teal. Same numbers as the wait column.
 */
export function CallStrip() {
  const { state } = useQueue();
  const { view } = state;
  const [laneWidth, setLaneWidth] = useState(0);
  const laneRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setLaneWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** The label that fits a bar of this many minutes: the token, its digits, or nothing. */
  const fit = (token: string, ms: number) => {
    const px = (ms / WINDOW_MS) * laneWidth;
    return px >= 60 ? token : px >= 40 ? token.slice(token.indexOf("-") + 1) : "";
  };
  const { now, settings } = view;
  const pct = (ms: number) => `${(Math.min(Math.max(ms - now, 0), WINDOW_MS) / WINDOW_MS) * 100}%`;
  const width = (start: number, end: number) =>
    `${((Math.min(end, now + WINDOW_MS) - Math.max(start, now)) / WINDOW_MS) * 100}%`;

  const ticks: number[] = [];
  for (let t = Math.ceil(now / QUARTER) * QUARTER; t <= now + WINDOW_MS; t += QUARTER) ticks.push(t);
  const later = view.waiting.filter((w) => w.startAt >= now + WINDOW_MS).length;

  return (
    <Panel
      title="Next hour"
      id="next-hour-heading"
      aside={
        <span className="num">
          {later > 0 ? `${later} more after ${clock(now + WINDOW_MS, settings)}` : "Projected from average service times"}
        </span>
      }
    >
      <div className="px-5 pb-4">
        <div className="relative ml-28 h-5 text-xs text-muted sm:ml-36" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2" style={{ left: pct(t) }}>
              {clock(t, settings)}
            </span>
          ))}
        </div>
        <ol className="mt-1 flex flex-col gap-2" aria-label="Projected call order per room">
          {view.rooms.map((c, i) => {
            const lane = view.waiting.filter((w) => w.projectedRoom === c.id && w.startAt < now + WINDOW_MS);
            const rooms = settings.services.find((s) => s.id === c.serviceId)!.rooms;
            return (
              <li key={c.id} className="flex items-center">
                <span className="w-28 flex-none truncate pr-2 text-xs text-muted sm:w-36" title={c.label}>
                  {serviceName(settings, c.serviceId)}
                  {rooms > 1 ? ` · ${c.n}` : ""}
                </span>
                <div ref={i === 0 ? laneRef : undefined} className="relative h-8 flex-1 rounded-full bg-raised">
                  {ticks.map((t) => (
                    <span
                      key={t}
                      aria-hidden="true"
                      className="absolute top-0 h-full w-px bg-border"
                      style={{ left: pct(t) }}
                    />
                  ))}
                  {c.current ? (
                    <Bar
                      left="0%"
                      width={width(now, c.expectedEndAt!)}
                      tone="serving"
                      label={fit(c.current.token, c.expectedEndAt! - now)}
                      title={`${c.current.token} ${firstName(c.current.name)}, serving until about ${clock(c.expectedEndAt!, settings)}`}
                    />
                  ) : null}
                  {lane.map((w) => (
                    <Bar
                      key={w.id}
                      left={pct(w.startAt)}
                      width={width(w.startAt, w.startAt + w.expectedMs)}
                      tone="waiting"
                      label={fit(w.token, Math.min(w.expectedMs, now + WINDOW_MS - w.startAt))}
                      title={`${w.token} ${firstName(w.name)}, projected ${clock(w.startAt, settings)}`}
                    />
                  ))}
                  {!c.current && lane.length === 0 ? (
                    <span className="absolute inset-0 flex items-center px-3 text-xs text-muted">Free</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}

function Bar({
  left,
  width,
  tone,
  label,
  title,
}: {
  left: string;
  width: string;
  tone: "serving" | "waiting";
  label: string;
  title: string;
}) {
  const toneClass = tone === "serving" ? "bg-primary text-white" : "bg-accent-pale text-accent";
  return (
    <span
      title={title}
      className={`absolute top-1 flex h-6 items-center overflow-hidden rounded-full px-2 font-token text-xs whitespace-nowrap ${toneClass}`}
      // A 3px gap keeps neighbouring pills apart.
      style={{ left, width: `max(0px, calc(${width} - 3px))` }}
    >
      <span className="sr-only">{title}</span>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
