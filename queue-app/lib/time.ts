// Pure time helpers. All timestamps are epoch milliseconds; the clinic timezone is passed in.

export const MINUTE = 60_000;
export const SLOT_MINUTES = 5;

/** Calendar date (YYYY-MM-DD) of `ms` in the given IANA timezone. */
export function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

/** 24-hour clock time (HH:MM) of `ms` in the given timezone. */
export function formatClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

/** True when `ms` falls exactly on a 5-minute boundary. */
export function isSlotAligned(ms: number): boolean {
  return ms % (SLOT_MINUTES * MINUTE) === 0;
}

/** The first 5-minute slot at or after `ms`. */
export function nextSlot(ms: number): number {
  const step = SLOT_MINUTES * MINUTE;
  return Math.ceil(ms / step) * step;
}
