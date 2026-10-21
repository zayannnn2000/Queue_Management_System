// Pure queue logic. No I/O, no UI, no clocks: every function that depends on time takes `now`.
// The rules implemented here are specified in CLAUDE.md at the repository root.

import { MINUTE, dayKey, formatClock, isSlotAligned } from "./time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CustomerType = "walk_in" | "appointment";
export type Status = "booked" | "waiting" | "serving" | "served" | "no_show" | "cancelled";

export interface Service {
  id: string;
  name: string;
  defaultMinutes: number;
}

export interface Settings {
  counters: number;
  graceMinutes: number;
  timezone: string;
  services: Service[];
}

export interface Customer {
  id: string;
  token: string;
  name: string;
  type: CustomerType;
  service: string;
  createdAt: number;
  scheduledAt?: number;
  arrivedAt?: number;
  checkedIn: boolean;
  status: Status;
  calledAt?: number;
  servedAt?: number;
  counter?: number;
  lateConverted: boolean;
}

export interface CallRecord {
  counter: number;
  customerId: string;
  token: string;
  reason: string;
  at: number;
}

export interface QueueState {
  version: number;
  day: string;
  settings: Settings;
  customers: Customer[];
  seq: { W: number; A: number };
  /** Latest "who and why" per counter, keyed by counter number. */
  lastCalls: Record<string, CallRecord>;
}

export type Action =
  | { type: "addWalkIn"; name: string; service: string }
  | { type: "book"; name: string; service: string; scheduledAt: number }
  | { type: "checkIn"; id: string }
  | { type: "edit"; id: string; name?: string; service?: string; scheduledAt?: number }
  | { type: "callNext"; counter: number }
  | { type: "serve"; counter: number; callNext?: boolean }
  | { type: "noShow"; id: string }
  | { type: "cancel"; id: string }
  | {
      type: "updateSettings";
      counters?: number;
      graceMinutes?: number;
      durations?: Record<string, number>;
    }
  | { type: "resetDay" };

export interface ActionResult {
  state: QueueState;
  message?: string;
  called?: CallRecord;
}

/** A rule violation the user can fix (shown in the UI, returned as HTTP 400). */
export class QueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueError";
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const MAX_COUNTERS = 4;
export const MAX_NAME_LENGTH = 40;
export const DURATION_SAMPLES = 5;
export const DUE_NOW_MS = 2 * MINUTE;

export const DEFAULT_SETTINGS: Settings = {
  counters: 1,
  graceMinutes: 10,
  timezone: "Asia/Dhaka",
  services: [
    { id: "consultation", name: "General consultation", defaultMinutes: 15 },
    { id: "follow_up", name: "Follow-up", defaultMinutes: 10 },
    { id: "blood_test", name: "Blood test", defaultMinutes: 5 },
    { id: "vaccination", name: "Vaccination", defaultMinutes: 5 },
    { id: "prescription", name: "Prescription renewal", defaultMinutes: 5 },
  ],
};

export function createState(now: number, settings: Settings = DEFAULT_SETTINGS): QueueState {
  return {
    version: 0,
    day: dayKey(now, settings.timezone),
    settings,
    customers: [],
    seq: { W: 0, A: 0 },
    lastCalls: {},
  };
}

/** Tokens reset daily: a new clinic-local date starts a fresh queue with the same settings. */
export function rolloverIfNewDay(state: QueueState, now: number): QueueState {
  if (dayKey(now, state.settings.timezone) === state.day) return state;
  return { ...createState(now, state.settings), version: state.version + 1 };
}

// ---------------------------------------------------------------------------
// Tokens, target times and ordering
// ---------------------------------------------------------------------------

export function makeToken(prefix: "W" | "A", n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export function tokenNumber(token: string): number {
  return Number.parseInt(token.slice(2), 10);
}

export function getService(settings: Settings, id: string): Service {
  const service = settings.services.find((s) => s.id === id);
  if (!service) throw new QueueError(`Unknown service "${id}".`);
  return service;
}

/** Walk-ins and late-converted appointments: arrival time. On-time/early appointments: scheduled time. */
export function targetTime(c: Customer): number {
  if (c.type === "appointment" && !c.lateConverted && c.scheduledAt !== undefined) {
    return c.scheduledAt;
  }
  return c.arrivedAt ?? c.createdAt;
}

/** True when the customer ranks as an appointment in ties (late conversions rank as walk-ins). */
export function ranksAsAppointment(c: Customer): boolean {
  return c.type === "appointment" && !c.lateConverted;
}

/** Earliest target first; ties: appointment before walk-in, then lower token number. */
export function compareByTarget(a: Customer, b: Customer): number {
  return (
    targetTime(a) - targetTime(b) ||
    Number(!ranksAsAppointment(a)) - Number(!ranksAsAppointment(b)) ||
    tokenNumber(a.token) - tokenNumber(b.token)
  );
}

export function isLateArrival(scheduledAt: number, arrivedAt: number, graceMinutes: number): boolean {
  return arrivedAt > scheduledAt + graceMinutes * MINUTE;
}

export function isOverdue(c: Customer, now: number, settings: Settings): boolean {
  return (
    c.status === "booked" &&
    c.scheduledAt !== undefined &&
    now > c.scheduledAt + settings.graceMinutes * MINUTE
  );
}

// ---------------------------------------------------------------------------
// Call-next decision
// ---------------------------------------------------------------------------

/**
 * Call-next rule at time `at`: earliest due target (target ≤ at); if nobody is due,
 * the earliest upcoming target so the counter isn't left idle. Returns null when nobody waits.
 */
export function chooseNext(waiting: Customer[], at: number): { customer: Customer; due: boolean } | null {
  let best: Customer | null = null;
  let bestDue = false;
  for (const c of waiting) {
    const due = targetTime(c) <= at;
    // Any due customer beats any upcoming one; otherwise compare by target order.
    if (!best || (due && !bestDue) || (due === bestDue && compareByTarget(c, best) < 0)) {
      best = c;
      bestDue = due;
    }
  }
  return best ? { customer: best, due: bestDue } : null;
}

function describeTarget(c: Customer, tz: string): string {
  const clock = formatClock(targetTime(c), tz);
  if (ranksAsAppointment(c)) return `appointment at ${clock}`;
  if (c.lateConverted) return `late appointment, re-queued as a walk-in at ${clock}`;
  return `walk-in, arrived ${clock}`;
}

/** Same as chooseNext, plus a plain-language reason for the staff screen. */
export function pickNext(
  waiting: Customer[],
  at: number,
  tz: string,
): { customer: Customer; due: boolean; reason: string } | null {
  const pick = chooseNext(waiting, at);
  if (!pick) return null;
  const { customer, due } = pick;

  let reason = due
    ? `${customer.token} called: ${describeTarget(customer, tz)}, the earliest due target`
    : `${customer.token} called early: nobody is due yet, ${describeTarget(customer, tz)} is the earliest upcoming target`;

  const tied = waiting.find(
    (c) => c !== customer && targetTime(c) === targetTime(customer) && (targetTime(c) <= at) === due,
  );
  if (tied) {
    reason +=
      ranksAsAppointment(customer) !== ranksAsAppointment(tied)
        ? `; tied with ${tied.token}, appointment goes first`
        : `; tied with ${tied.token}, lower token number goes first`;
  }
  return { customer, due, reason: `${reason}.` };
}

// ---------------------------------------------------------------------------
// Service durations and wait-time estimate
// ---------------------------------------------------------------------------

/**
 * Expected duration (ms) for a service: mean of the last 5 served durations (called → served),
 * each clamped to [1 min, 3 × default]. No samples → the configured default.
 */
export function expectedDuration(
  customers: Customer[],
  settings: Settings,
  serviceId: string,
): { ms: number; samples: number } {
  const def = getService(settings, serviceId).defaultMinutes * MINUTE;
  const samples = customers
    .filter(
      (c) =>
        c.service === serviceId &&
        c.status === "served" &&
        c.calledAt !== undefined &&
        c.servedAt !== undefined,
    )
    .sort((a, b) => b.servedAt! - a.servedAt!)
    .slice(0, DURATION_SAMPLES)
    .map((c) => Math.min(Math.max(c.servedAt! - c.calledAt!, MINUTE), 3 * def));
  if (samples.length === 0) return { ms: def, samples: 0 };
  return { ms: samples.reduce((sum, d) => sum + d, 0) / samples.length, samples: samples.length };
}

export interface Projection {
  id: string;
  position: number;
  counter: number;
  startAt: number;
  waitMs: number;
}

/**
 * Forward simulation: each counter is free at now + remaining time of its current customer
 * (at least 1 min). Whenever a counter frees up, apply the exact call-next rule at that moment.
 */
export function simulate(state: QueueState, now: number): Projection[] {
  const { settings, customers } = state;
  const expected = (serviceId: string) => expectedDuration(customers, settings, serviceId).ms;

  const counters = Array.from({ length: settings.counters }, (_, i) => {
    const n = i + 1;
    const current = customers.find((c) => c.status === "serving" && c.counter === n);
    if (!current || current.calledAt === undefined) return { n, freeAt: now };
    const remaining = expected(current.service) - (now - current.calledAt);
    return { n, freeAt: now + Math.max(remaining, MINUTE) };
  });

  let remaining = customers.filter((c) => c.status === "waiting");
  const projection: Projection[] = [];
  while (remaining.length > 0) {
    counters.sort((a, b) => a.freeAt - b.freeAt || a.n - b.n);
    const slot = counters[0];
    const { customer } = chooseNext(remaining, slot.freeAt)!;
    projection.push({
      id: customer.id,
      position: projection.length + 1,
      counter: slot.n,
      startAt: slot.freeAt,
      waitMs: slot.freeAt - now,
    });
    slot.freeAt += expected(customer.service);
    remaining = remaining.filter((c) => c !== customer);
  }
  return projection;
}

/** "Due now" at ≤ 2 min, otherwise "~X min" rounded up to the next 5. */
export function formatWait(waitMs: number): string {
  if (waitMs <= DUE_NOW_MS) return "Due now";
  return `~${Math.ceil(waitMs / MINUTE / 5) * 5} min`;
}

// ---------------------------------------------------------------------------
// Booking capacity (no double-booking)
// ---------------------------------------------------------------------------

function isActiveAppointment(c: Customer): boolean {
  return (
    c.type === "appointment" &&
    !c.lateConverted &&
    c.scheduledAt !== undefined &&
    (c.status === "booked" || c.status === "waiting")
  );
}

function windowOf(settings: Settings, serviceId: string, start: number) {
  return { start, end: start + getService(settings, serviceId).defaultMinutes * MINUTE };
}

/** Active appointments whose window overlaps the proposed one. */
export function findClashes(
  state: QueueState,
  serviceId: string,
  scheduledAt: number,
  excludeId?: string,
): Customer[] {
  const w = windowOf(state.settings, serviceId, scheduledAt);
  return state.customers.filter((c) => {
    if (c.id === excludeId || !isActiveAppointment(c)) return false;
    const o = windowOf(state.settings, c.service, c.scheduledAt!);
    return o.start < w.end && w.start < o.end;
  });
}

/** Returns an error message when the booking would exceed counter capacity, else null. */
export function checkCapacity(
  state: QueueState,
  serviceId: string,
  scheduledAt: number,
  excludeId?: string,
): string | null {
  const clashes = findClashes(state, serviceId, scheduledAt, excludeId);
  if (clashes.length + 1 <= state.settings.counters) return null;
  const tz = state.settings.timezone;
  const w = windowOf(state.settings, serviceId, scheduledAt);
  const list = clashes
    .sort(compareByTarget)
    .map((c) => `${c.token} (${formatClock(c.scheduledAt!, tz)})`)
    .join(", ");
  return `${formatClock(w.start, tz)}–${formatClock(w.end, tz)} clashes with ${list}.`;
}

/** Existing bookings that exceed capacity (e.g. after counters were reduced). Never auto-cancelled. */
export function capacityWarnings(state: QueueState): string[] {
  const tz = state.settings.timezone;
  const warnings: string[] = [];
  const active = state.customers.filter(isActiveAppointment).sort(compareByTarget);
  for (const c of active) {
    const clashes = findClashes(state, c.service, c.scheduledAt!, c.id);
    if (clashes.length + 1 > state.settings.counters) {
      const others = clashes.map((o) => o.token).join(", ");
      warnings.push(`${c.token} at ${formatClock(c.scheduledAt!, tz)} overlaps ${others}.`);
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Actions (the single reducer the API runs)
// ---------------------------------------------------------------------------

function validName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) throw new QueueError("Name is required.");
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new QueueError(`Name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

function validSchedule(state: QueueState, scheduledAt: number, now: number): void {
  if (!Number.isFinite(scheduledAt)) throw new QueueError("Choose a scheduled time.");
  if (dayKey(scheduledAt, state.settings.timezone) !== state.day) {
    throw new QueueError("Appointments can only be booked for today.");
  }
  if (!isSlotAligned(scheduledAt)) throw new QueueError("Appointments use 5-minute slots.");
  if (scheduledAt < now) {
    throw new QueueError("That time has passed. Add someone who is already here as a walk-in.");
  }
}

function findCustomer(state: QueueState, id: string): Customer {
  const c = state.customers.find((x) => x.id === id);
  if (!c) throw new QueueError("Customer not found.");
  return c;
}

function servingAt(state: QueueState, counter: number): Customer | undefined {
  return state.customers.find((c) => c.status === "serving" && c.counter === counter);
}

function validCounter(state: QueueState, counter: number): void {
  if (!Number.isInteger(counter) || counter < 1 || counter > state.settings.counters) {
    throw new QueueError(`Counter ${counter} does not exist.`);
  }
}

function withCustomer(state: QueueState, updated: Customer): QueueState {
  return { ...state, customers: state.customers.map((c) => (c.id === updated.id ? updated : c)) };
}

function bump(state: QueueState): QueueState {
  return { ...state, version: state.version + 1 };
}

export function callNext(state: QueueState, counter: number, now: number): ActionResult {
  validCounter(state, counter);
  const busy = servingAt(state, counter);
  if (busy) throw new QueueError(`Counter ${counter} is still serving ${busy.token}. Close it out first.`);

  const waiting = state.customers.filter((c) => c.status === "waiting");
  const pick = pickNext(waiting, now, state.settings.timezone);
  if (!pick) return { state, message: `Nobody is checked in. Counter ${counter} stays idle.` };

  const called: CallRecord = {
    counter,
    customerId: pick.customer.id,
    token: pick.customer.token,
    reason: pick.reason,
    at: now,
  };
  const next = withCustomer(state, { ...pick.customer, status: "serving", calledAt: now, counter });
  return {
    state: bump({ ...next, lastCalls: { ...next.lastCalls, [String(counter)]: called } }),
    message: pick.reason,
    called,
  };
}

export function applyAction(state: QueueState, action: Action, now: number): ActionResult {
  const { settings } = state;
  const tz = settings.timezone;

  switch (action.type) {
    case "addWalkIn": {
      const name = validName(action.name);
      getService(settings, action.service);
      const n = state.seq.W + 1;
      const token = makeToken("W", n);
      const customer: Customer = {
        id: token,
        token,
        name,
        type: "walk_in",
        service: action.service,
        createdAt: now,
        arrivedAt: now,
        checkedIn: true,
        status: "waiting",
        lateConverted: false,
      };
      return {
        state: bump({ ...state, seq: { ...state.seq, W: n }, customers: [...state.customers, customer] }),
        message: `${token} added for ${name}.`,
      };
    }

    case "book": {
      const name = validName(action.name);
      getService(settings, action.service);
      validSchedule(state, action.scheduledAt, now);
      const clash = checkCapacity(state, action.service, action.scheduledAt);
      if (clash) throw new QueueError(clash);
      const n = state.seq.A + 1;
      const token = makeToken("A", n);
      const customer: Customer = {
        id: token,
        token,
        name,
        type: "appointment",
        service: action.service,
        createdAt: now,
        scheduledAt: action.scheduledAt,
        checkedIn: false,
        status: "booked",
        lateConverted: false,
      };
      return {
        state: bump({ ...state, seq: { ...state.seq, A: n }, customers: [...state.customers, customer] }),
        message: `${token} booked for ${name} at ${formatClock(action.scheduledAt, tz)}.`,
      };
    }

    case "checkIn": {
      const c = findCustomer(state, action.id);
      if (c.type !== "appointment" || c.status !== "booked") {
        throw new QueueError(`${c.token} is not a booked appointment.`);
      }
      const late = isLateArrival(c.scheduledAt!, now, settings.graceMinutes);
      const updated: Customer = { ...c, arrivedAt: now, checkedIn: true, status: "waiting", lateConverted: late };
      return {
        state: bump(withCustomer(state, updated)),
        message: late
          ? `${c.token} arrived after the ${settings.graceMinutes}-minute grace period and joins as a walk-in.`
          : `${c.token} checked in for ${formatClock(c.scheduledAt!, tz)}.`,
      };
    }

    case "edit": {
      const c = findCustomer(state, action.id);
      if (c.status !== "booked" && c.status !== "waiting") {
        throw new QueueError(`${c.token} can no longer be edited.`);
      }
      const updated: Customer = { ...c };
      if (action.name !== undefined) updated.name = validName(action.name);
      if (action.service !== undefined) {
        getService(settings, action.service);
        updated.service = action.service;
      }
      if (action.scheduledAt !== undefined && action.scheduledAt !== c.scheduledAt) {
        if (c.type !== "appointment") throw new QueueError("Walk-ins have no scheduled time.");
        if (c.status === "booked") {
          validSchedule(state, action.scheduledAt, now);
        } else {
          if (dayKey(action.scheduledAt, tz) !== state.day || !isSlotAligned(action.scheduledAt)) {
            throw new QueueError("Choose a 5-minute slot today.");
          }
          updated.lateConverted = isLateArrival(action.scheduledAt, c.arrivedAt!, settings.graceMinutes);
        }
        updated.scheduledAt = action.scheduledAt;
      }
      const windowChanged = updated.scheduledAt !== c.scheduledAt || updated.service !== c.service;
      if (isActiveAppointment(updated) && (windowChanged || c.lateConverted !== updated.lateConverted)) {
        const clash = checkCapacity(state, updated.service, updated.scheduledAt!, c.id);
        if (clash) throw new QueueError(clash);
      }
      return { state: bump(withCustomer(state, updated)), message: `${c.token} updated.` };
    }

    case "callNext":
      return callNext(state, action.counter, now);

    case "serve": {
      validCounter(state, action.counter);
      const current = servingAt(state, action.counter);
      if (!current) throw new QueueError(`Counter ${action.counter} is not serving anyone.`);
      const served = bump(withCustomer(state, { ...current, status: "served", servedAt: now }));
      if (!action.callNext) return { state: served, message: `${current.token} served.` };
      return callNext(served, action.counter, now);
    }

    case "noShow": {
      const c = findCustomer(state, action.id);
      if (c.status !== "serving" && c.status !== "booked") {
        throw new QueueError(`${c.token} cannot be marked as a no-show.`);
      }
      return { state: bump(withCustomer(state, { ...c, status: "no_show" })), message: `${c.token} marked no-show.` };
    }

    case "cancel": {
      const c = findCustomer(state, action.id);
      if (c.status !== "waiting" && c.status !== "booked") {
        throw new QueueError(`${c.token} cannot be cancelled.`);
      }
      return { state: bump(withCustomer(state, { ...c, status: "cancelled" })), message: `${c.token} cancelled.` };
    }

    case "updateSettings": {
      const next: Settings = { ...settings, services: settings.services.map((s) => ({ ...s })) };
      if (action.counters !== undefined) {
        if (!Number.isInteger(action.counters) || action.counters < 1 || action.counters > MAX_COUNTERS) {
          throw new QueueError(`Counters must be between 1 and ${MAX_COUNTERS}.`);
        }
        const busy = state.customers.find((c) => c.status === "serving" && c.counter! > action.counters!);
        if (busy) throw new QueueError(`Counter ${busy.counter} is serving ${busy.token}. Close it out first.`);
        next.counters = action.counters;
      }
      if (action.graceMinutes !== undefined) {
        if (!Number.isInteger(action.graceMinutes) || action.graceMinutes < 0 || action.graceMinutes > 60) {
          throw new QueueError("Grace period must be between 0 and 60 minutes.");
        }
        next.graceMinutes = action.graceMinutes;
      }
      for (const [id, minutes] of Object.entries(action.durations ?? {})) {
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
          throw new QueueError("Service durations must be between 1 and 240 minutes.");
        }
        const service = next.services.find((s) => s.id === id);
        if (!service) throw new QueueError(`Unknown service "${id}".`);
        service.defaultMinutes = minutes;
      }
      return { state: bump({ ...state, settings: next }), message: "Settings saved." };
    }

    case "resetDay":
      return {
        state: { ...createState(now, settings), version: state.version + 1 },
        message: "Queue reset for the day.",
      };
  }
}

// ---------------------------------------------------------------------------
// Derived views for the screens
// ---------------------------------------------------------------------------

export interface WaitingRow extends Customer {
  position: number;
  targetAt: number;
  waitMs: number;
  waitLabel: string;
  /** Projected counter and start time from the simulation, plus the expected service length. */
  projectedCounter: number;
  startAt: number;
  expectedMs: number;
}

export interface BookedRow extends Customer {
  overdue: boolean;
}

export interface CounterView {
  counter: number;
  current: Customer | null;
  /** When the current customer is expected to finish (at least 1 min from now). */
  expectedEndAt: number | null;
  lastCall: CallRecord | null;
}

export interface QueueView {
  now: number;
  day: string;
  version: number;
  settings: Settings;
  counters: CounterView[];
  waiting: WaitingRow[];
  booked: BookedRow[];
  done: Customer[];
  expected: Record<string, { minutes: number; samples: number }>;
  warnings: string[];
}

export function buildView(state: QueueState, now: number): QueueView {
  const projection = new Map(simulate(state, now).map((p) => [p.id, p]));
  const expectedMs = (serviceId: string) => expectedDuration(state.customers, state.settings, serviceId).ms;
  const waiting = state.customers
    .filter((c) => c.status === "waiting")
    .map((c) => {
      const p = projection.get(c.id)!;
      return {
        ...c,
        position: p.position,
        targetAt: targetTime(c),
        waitMs: p.waitMs,
        waitLabel: formatWait(p.waitMs),
        projectedCounter: p.counter,
        startAt: p.startAt,
        expectedMs: expectedMs(c.service),
      };
    })
    .sort((a, b) => a.position - b.position);

  const expected: QueueView["expected"] = {};
  for (const s of state.settings.services) {
    const e = expectedDuration(state.customers, state.settings, s.id);
    expected[s.id] = { minutes: Math.round((e.ms / MINUTE) * 10) / 10, samples: e.samples };
  }

  return {
    now,
    day: state.day,
    version: state.version,
    settings: state.settings,
    counters: Array.from({ length: state.settings.counters }, (_, i) => {
      const current = servingAt(state, i + 1) ?? null;
      return {
        counter: i + 1,
        current,
        expectedEndAt: current
          ? now + Math.max(expectedMs(current.service) - (now - current.calledAt!), MINUTE)
          : null,
        lastCall: state.lastCalls[String(i + 1)] ?? null,
      };
    }),
    waiting,
    booked: state.customers
      .filter((c) => c.status === "booked")
      .map((c) => ({ ...c, overdue: isOverdue(c, now, state.settings) }))
      .sort((a, b) => a.scheduledAt! - b.scheduledAt!),
    done: state.customers
      .filter((c) => c.status === "served" || c.status === "no_show" || c.status === "cancelled")
      .sort((a, b) => (b.servedAt ?? b.calledAt ?? b.createdAt) - (a.servedAt ?? a.calledAt ?? a.createdAt)),
    expected,
    warnings: capacityWarnings(state),
  };
}

/** First-name initial only, for the public display ("Sadia Rahman" → "S."). */
export function publicName(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return first ? `${first}.` : "";
}

export interface PublicRow {
  token: string;
  initial: string;
  position: number;
  waitLabel: string;
  lateConverted: boolean;
}

export interface PublicView {
  now: number;
  counters: { counter: number; token: string | null; initial: string | null }[];
  waiting: PublicRow[];
}

/** Strips everything but token, initial, position and wait. Booked appointments are never included. */
export function toPublicView(view: QueueView): PublicView {
  return {
    now: view.now,
    counters: view.counters.map((c) => ({
      counter: c.counter,
      token: c.current?.token ?? null,
      initial: c.current ? publicName(c.current.name) : null,
    })),
    waiting: view.waiting.map((w) => ({
      token: w.token,
      initial: publicName(w.name),
      position: w.position,
      waitLabel: w.waitLabel,
      lateConverted: w.lateConverted,
    })),
  };
}
