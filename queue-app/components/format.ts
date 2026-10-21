import type { Customer, QueueState, QueueView, Settings } from "@/lib/queue";
import { checkCapacity } from "@/lib/queue";
import { MINUTE, SLOT_MINUTES, dayKey, formatClock, nextSlot } from "@/lib/time";

export function serviceName(settings: Settings, id: string): string {
  return settings.services.find((s) => s.id === id)?.name ?? id;
}

export function clock(ms: number, settings: Settings): string {
  return formatClock(ms, settings.timezone);
}

/** "12 min", "1 h 05 min" — durations in whole minutes. */
export function minutes(ms: number): string {
  const m = Math.max(0, Math.round(ms / MINUTE));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export interface SlotOption {
  value: number;
  label: string;
  clash: string | null;
}

/**
 * Bookable 5-minute slots for today, marking the ones that would exceed counter capacity.
 * `fromPast` lists earlier slots too (editing a patient who has already checked in).
 */
export function slotOptions(
  view: QueueView,
  serviceId: string,
  opts: { excludeId?: string; fromPast?: boolean } = {},
): SlotOption[] {
  const { settings } = view;
  const probe: QueueState = {
    version: view.version,
    day: view.day,
    settings,
    customers: [...view.booked, ...view.waiting] as Customer[],
    seq: { W: 0, A: 0 },
    lastCalls: {},
  };
  const step = SLOT_MINUTES * MINUTE;
  let t = nextSlot(view.now);
  if (opts.fromPast) while (dayKey(t - step, settings.timezone) === view.day) t -= step;
  const out: SlotOption[] = [];
  for (; dayKey(t, settings.timezone) === view.day; t += step) {
    out.push({
      value: t,
      label: formatClock(t, settings.timezone),
      clash: checkCapacity(probe, serviceId, t, opts.excludeId),
    });
  }
  return out;
}
