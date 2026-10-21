"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS } from "@/lib/queue";

const TICK_MS = 15_000;

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_SETTINGS.timezone,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(id);
}

// Snapshot rounded to the tick so it is stable between renders.
const getSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerSnapshot = () => null;

/** Clinic-local date and time. Empty on the server so server and client never disagree. */
export function LiveClock({ className }: { className?: string }) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <time className={`num text-sm ${className ?? ""}`}>{now === null ? " " : `${fmt.format(now)} · Dhaka`}</time>
  );
}
