// Pure queue logic. No I/O, no UI, no clocks: every function that depends on time takes `now`.
// The rules implemented here are specified in CLAUDE.md at the repository root.
//
// Model: one front desk issues tokens into one queue per service; each service has its own
// room(s), which call only from that service's queue.

import { MINUTE, dayKey, formatClock, isSlotAligned } from "./time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CustomerType = "walk_in" | "appointment";
export type Status = "booked" | "waiting" | "serving" | "served" | "no_show" | "cancelled";

export const PRIORITY_REASONS = ["Elderly", "Pregnant", "Disability", "Urgent", "Other"] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

export interface Service {
  id: string;
  name: string;
  /** Token prefix letter: C, F, B, V, P (unique per service). */
  letter: string;
  defaultMinutes: number;
  /** Rooms serving this service's queue (1–4). */
  rooms: number;
  /** Colour key from SERVICE_COLOR_KEYS; services saved before colours existed fall back by id. */
  color?: string;
}

export interface Settings {
  graceMinutes: number;
  /** A walk-in who has waited this long is not pushed back by due appointments. 0 = off. */
  protectionMinutes: number;
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
  /** Room id (`<serviceId>:<n>`) while being served and after. */
  room?: string;
  lateConverted: boolean;
  priority?: { reason: PriorityReason; at: number };
  /**
   * Set when a walk-in (or late arrival) joined with an appointment of the same service due within
   * WALK_IN_HOLD_MINUTES: their target is held to arrival + that time so the appointment goes first.
   */
  hold?: { until: number; for: string };
}

export interface CallRecord {
  room: string;
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
  /** Last number issued per token prefix, e.g. { CW: 4, BA: 1 }. */
  seq: Record<string, number>;
  /** Latest "who and why" per room id. */
  lastCalls: Record<string, CallRecord>;
}

export type Action =
  | { type: "addWalkIn"; name: string; service: string }
  | { type: "book"; name: string; service: string; scheduledAt: number }
  | { type: "checkIn"; id: string }
  | { type: "edit"; id: string; name?: string; service?: string; scheduledAt?: number }
  | { type: "callNext"; room: string }
  | { type: "callPatient"; room: string; id: string }
  | { type: "serve"; room: string; callNext?: boolean }
  | { type: "noShow"; id: string }
  | { type: "cancel"; id: string }
  | { type: "setPriority"; id: string; reason: PriorityReason | null }
  | {
      type: "updateSettings";
      graceMinutes?: number;
      protectionMinutes?: number;
      durations?: Record<string, number>;
      rooms?: Record<string, number>;
    }
  | { type: "addService"; name: string; letter: string; minutes: number; rooms: number }
  | { type: "removeService"; id: string }
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

export const MAX_ROOMS = 4;
export const MAX_SERVICES = 10;
export const MAX_SERVICE_NAME_LENGTH = 30;
export const MAX_NAME_LENGTH = 40;

/** One colour per service (the palette itself lives in the UI). A new service takes the first unused key. */
export const SERVICE_COLOR_KEYS = [
  "lilac",
  "teal",
  "rose",
  "amber",
  "blue",
  "green",
  "coral",
  "plum",
  "olive",
  "slate",
] as const;
const DEFAULT_COLOR_BY_ID: Record<string, string> = {
  consultation: "lilac",
  follow_up: "teal",
  blood_test: "rose",
  vaccination: "amber",
  prescription: "blue",
};

/** The service's colour key: its own, else the default for the five original services, else slate. */
export function serviceColorKey(service: Service | undefined): string {
  return service?.color ?? (service ? DEFAULT_COLOR_BY_ID[service.id] : undefined) ?? "slate";
}
export const DURATION_SAMPLES = 5;
/** A walk-in arriving with a same-service appointment due within this many minutes waits this long. */
export const WALK_IN_HOLD_MINUTES = 15;
export const DUE_NOW_MS = 2 * MINUTE;

export const DEFAULT_SETTINGS: Settings = {
  graceMinutes: 10,
  protectionMinutes: 30,
  timezone: "Asia/Dhaka",
  services: [
    { id: "consultation", name: "General consultation", letter: "C", defaultMinutes: 15, rooms: 1, color: "lilac" },
    { id: "follow_up", name: "Follow-up", letter: "F", defaultMinutes: 10, rooms: 1, color: "teal" },
    { id: "blood_test", name: "Blood test", letter: "B", defaultMinutes: 5, rooms: 1, color: "rose" },
    { id: "vaccination", name: "Vaccination", letter: "V", defaultMinutes: 5, rooms: 1, color: "amber" },
    { id: "prescription", name: "Prescription renewal", letter: "P", defaultMinutes: 5, rooms: 1, color: "blue" },
  ],
};

export function createState(now: number, settings: Settings = DEFAULT_SETTINGS): QueueState {
  return {
    version: 0,
    day: dayKey(now, settings.timezone),
    settings,
    customers: [],
    seq: {},
    lastCalls: {},
  };
}

/** Tokens reset daily: a new clinic-local date starts a fresh queue with the same settings. */
export function rolloverIfNewDay(state: QueueState, now: number): QueueState {
  if (dayKey(now, state.settings.timezone) === state.day) return state;
  return { ...createState(now, state.settings), version: state.version + 1 };
}

/** True when stored state is in the current shape (per-service queues). Older saved days start fresh. */
export function isCurrentShape(state: QueueState): boolean {
  const s = state.settings as Partial<Settings> | undefined;
  return (
    typeof s?.protectionMinutes === "number" &&
    Array.isArray(s.services) &&
    s.services.every((x) => typeof x.letter === "string" && typeof x.rooms === "number")
  );
}

export function upgradeState(state: QueueState, now: number): QueueState {
  return isCurrentShape(state) ? state : { ...createState(now), version: (state.version ?? 0) + 1 };
}

// ---------------------------------------------------------------------------
// Services, rooms and tokens
// ---------------------------------------------------------------------------

export function getService(settings: Settings, id: string): Service {
  const service = settings.services.find((s) => s.id === id);
  if (!service) throw new QueueError(`Unknown service "${id}".`);
  return service;
}

/**
 * Validates a new service and gives it an id (from its name), its token letter and a colour.
 * Name: 1–30 chars, unique. Letter: one A–Z, not used by another service. Rooms 1–4, length 1–240.
 */
export function newService(
  settings: Settings,
  input: { name: string; letter: string; minutes: number; rooms: number },
): Service {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new QueueError("Enter the service name.");
  if (name.length > MAX_SERVICE_NAME_LENGTH) {
    throw new QueueError(`Service names can be at most ${MAX_SERVICE_NAME_LENGTH} characters.`);
  }
  if (settings.services.length >= MAX_SERVICES) {
    throw new QueueError(`The clinic can have at most ${MAX_SERVICES} services. Remove one first.`);
  }
  const taken = settings.services.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (taken) throw new QueueError(`There is already a service called ${taken.name}.`);

  const letter = String(input.letter ?? "").trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) throw new QueueError("The token letter must be one letter, A to Z.");
  const sameLetter = settings.services.find((s) => s.letter === letter);
  if (sameLetter) {
    throw new QueueError(`${sameLetter.name} already uses the letter ${letter}. Pick a different letter.`);
  }

  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 240) {
    throw new QueueError("Service durations must be between 1 and 240 minutes.");
  }
  if (!Number.isInteger(input.rooms) || input.rooms < 1 || input.rooms > MAX_ROOMS) {
    throw new QueueError(`Rooms must be between 1 and ${MAX_ROOMS}.`);
  }

  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "service";
  let id = base;
  for (let n = 2; settings.services.some((s) => s.id === id); n++) id = `${base}_${n}`;
  const used = new Set(settings.services.map(serviceColorKey));
  const color = SERVICE_COLOR_KEYS.find((k) => !used.has(k)) ?? SERVICE_COLOR_KEYS[settings.services.length % SERVICE_COLOR_KEYS.length];
  return { id, name, letter, defaultMinutes: input.minutes, rooms: input.rooms, color };
}

/** A letter not used by any service, for the form's default (the name's first free letter, else A–Z). */
export function suggestLetter(settings: Settings, name: string): string {
  const used = new Set(settings.services.map((s) => s.letter));
  const candidates = [...name.toUpperCase().replace(/[^A-Z]/g, ""), ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  return candidates.find((l) => !used.has(l)) ?? "";
}

export interface Room {
  id: string;
  serviceId: string;
  n: number;
}

export const roomId = (serviceId: string, n: number) => `${serviceId}:${n}`;

export function parseRoom(settings: Settings, id: string): Room {
  const [serviceId, num] = String(id).split(":");
  const n = Number(num);
  const service = settings.services.find((s) => s.id === serviceId);
  if (!service || !Number.isInteger(n) || n < 1 || n > service.rooms) {
    throw new QueueError(`Room "${id}" does not exist.`);
  }
  return { id, serviceId, n };
}

export function allRooms(settings: Settings): Room[] {
  return settings.services.flatMap((s) => Array.from({ length: s.rooms }, (_, i) => ({ id: roomId(s.id, i + 1), serviceId: s.id, n: i + 1 })));
}

export function roomLabel(settings: Settings, id: string): string {
  const { serviceId, n } = parseRoom(settings, id);
  return `${getService(settings, serviceId).name} · Room ${n}`;
}

export function tokenPrefix(service: Service, type: CustomerType): string {
  return `${service.letter}${type === "walk_in" ? "W" : "A"}`;
}

export function makeToken(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export function tokenNumber(token: string): number {
  return Number.parseInt(token.slice(token.indexOf("-") + 1), 10);
}

// ---------------------------------------------------------------------------
// Target times and the call order
// ---------------------------------------------------------------------------

/** Walk-ins and late-converted appointments: arrival time. On-time/early appointments: scheduled time. */
export function targetTime(c: Customer): number {
  if (c.type === "appointment" && !c.lateConverted && c.scheduledAt !== undefined) {
    return c.scheduledAt;
  }
  return c.hold?.until ?? c.arrivedAt ?? c.createdAt;
}

/**
 * The target hold for someone joining as a walk-in at `arrival`: when an appointment of the same
 * service (booked or checked in, someone else) is due after arrival and within 15 minutes, their
 * target becomes arrival + 15 so that appointment is called first. Otherwise none (target = arrival).
 */
export function walkInHold(
  state: QueueState,
  serviceId: string,
  arrival: number,
  excludeId?: string,
): Customer["hold"] {
  const until = arrival + WALK_IN_HOLD_MINUTES * MINUTE;
  const soon = state.customers
    .filter(
      (c) =>
        c.id !== excludeId &&
        c.service === serviceId &&
        isActiveAppointment(c) &&
        c.scheduledAt! > arrival &&
        c.scheduledAt! <= until,
    )
    .sort(compareByTarget)[0];
  return soon ? { until, for: soon.token } : undefined;
}

/** True when the customer ranks as an appointment (late conversions rank as walk-ins). */
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

/** A walk-in (or late arrival) who has waited at least the protection time keeps its place. */
export function isProtected(c: Customer, at: number, settings: Settings): boolean {
  return (
    !ranksAsAppointment(c) &&
    settings.protectionMinutes > 0 &&
    at - (c.arrivedAt ?? c.createdAt) >= settings.protectionMinutes * MINUTE
  );
}

/**
 * Where a waiting patient stands at time `at`:
 * 0 priority · 1 due appointment or protected walk-in · 2 other due walk-in · 3 not due yet.
 */
export function tierAt(c: Customer, at: number, settings: Settings): 0 | 1 | 2 | 3 {
  if (c.priority) return 0;
  if (targetTime(c) > at) return 3;
  if (ranksAsAppointment(c) || isProtected(c, at, settings)) return 1;
  return 2;
}

function compareAt(a: Customer, b: Customer, at: number, settings: Settings): number {
  const ta = tierAt(a, at, settings);
  const tb = tierAt(b, at, settings);
  if (ta !== tb) return ta - tb;
  if (ta === 0) return a.priority!.at - b.priority!.at || compareByTarget(a, b);
  return compareByTarget(a, b);
}

/** Call-next rule at time `at` for one service queue. Null when nobody waits. */
export function chooseNext(
  waiting: Customer[],
  at: number,
  settings: Settings,
): { customer: Customer; tier: 0 | 1 | 2 | 3 } | null {
  let best: Customer | null = null;
  for (const c of waiting) if (!best || compareAt(c, best, at, settings) < 0) best = c;
  return best ? { customer: best, tier: tierAt(best, at, settings) } : null;
}

function describe(c: Customer, tz: string): string {
  if (ranksAsAppointment(c)) return `appointment at ${formatClock(targetTime(c), tz)}`;
  const arrived = formatClock(c.arrivedAt ?? c.createdAt, tz);
  const held = c.hold ? ` (target ${formatClock(c.hold.until, tz)}, held for ${c.hold.for})` : "";
  if (c.lateConverted) return `late appointment, re-queued as a walk-in at ${arrived}${held}`;
  return `walk-in, arrived ${arrived}${held}`;
}

/** Same as chooseNext, plus a plain-language reason for the staff screen. */
export function pickNext(
  waiting: Customer[],
  at: number,
  settings: Settings,
): { customer: Customer; tier: number; reason: string } | null {
  const pick = chooseNext(waiting, at, settings);
  if (!pick) return null;
  const { customer: c, tier } = pick;
  const tz = settings.timezone;
  let reason: string;
  if (tier === 0) {
    reason = `${c.token} called first: priority (${c.priority!.reason}), flagged at ${formatClock(c.priority!.at, tz)}`;
  } else if (tier === 1 && ranksAsAppointment(c)) {
    reason = `${c.token} called: ${describe(c, tz)} is due, and appointments go ahead of walk-ins at their time`;
  } else if (tier === 1) {
    reason = `${c.token} called: ${describe(c, tz)}, waited over ${settings.protectionMinutes} min so keeps its place`;
  } else if (tier === 2) {
    reason = `${c.token} called: ${describe(c, tz)}, the earliest due`;
  } else {
    reason = `${c.token} called early: nobody is due yet, ${describe(c, tz)} is the earliest upcoming`;
  }
  const tied = waiting.find(
    (o) => o !== c && tierAt(o, at, settings) === tier && tier !== 0 && targetTime(o) === targetTime(c),
  );
  if (tied) {
    reason +=
      ranksAsAppointment(c) !== ranksAsAppointment(tied)
        ? `; tied with ${tied.token}, appointment goes first`
        : `; tied with ${tied.token}, lower token number goes first`;
  }
  return { customer: c, tier, reason: `${reason}.` };
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
  /** Place within the patient's service queue (1 = next). */
  position: number;
  room: string;
  startAt: number;
  waitMs: number;
}

/**
 * Forward simulation, one service queue at a time: each room is free at now + remaining time of
 * its current patient (at least 1 min). Whenever a room frees up, apply the call-next rule then.
 */
export function simulate(state: QueueState, now: number): Projection[] {
  const { settings, customers } = state;
  const projection: Projection[] = [];
  for (const service of settings.services) {
    const expected = expectedDuration(customers, settings, service.id).ms;
    const rooms = Array.from({ length: service.rooms }, (_, i) => {
      const id = roomId(service.id, i + 1);
      const current = customers.find((c) => c.status === "serving" && c.room === id);
      if (!current || current.calledAt === undefined) return { id, n: i + 1, freeAt: now };
      return { id, n: i + 1, freeAt: now + Math.max(expected - (now - current.calledAt), MINUTE) };
    });
    let remaining = customers.filter((c) => c.status === "waiting" && c.service === service.id);
    let position = 0;
    while (remaining.length > 0) {
      rooms.sort((a, b) => a.freeAt - b.freeAt || a.n - b.n);
      const slot = rooms[0];
      const { customer } = chooseNext(remaining, slot.freeAt, settings)!;
      projection.push({ id: customer.id, position: ++position, room: slot.id, startAt: slot.freeAt, waitMs: slot.freeAt - now });
      slot.freeAt += expected;
      remaining = remaining.filter((c) => c !== customer);
    }
  }
  return projection;
}

/** "Due now" at ≤ 2 min, otherwise "~X min" rounded up to the next 5. */
export function formatWait(waitMs: number): string {
  if (waitMs <= DUE_NOW_MS) return "Due now";
  return `~${Math.ceil(waitMs / MINUTE / 5) * 5} min`;
}

// ---------------------------------------------------------------------------
// Booking capacity (no double-booking within a service)
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

/** Active appointments of the same service whose window overlaps the proposed one. */
export function findClashes(
  state: QueueState,
  serviceId: string,
  scheduledAt: number,
  excludeId?: string,
): Customer[] {
  const w = windowOf(state.settings, serviceId, scheduledAt);
  return state.customers.filter((c) => {
    if (c.id === excludeId || c.service !== serviceId || !isActiveAppointment(c)) return false;
    const o = windowOf(state.settings, c.service, c.scheduledAt!);
    return o.start < w.end && w.start < o.end;
  });
}

/** Returns an error message when the booking would exceed that service's rooms, else null. */
export function checkCapacity(
  state: QueueState,
  serviceId: string,
  scheduledAt: number,
  excludeId?: string,
): string | null {
  const clashes = findClashes(state, serviceId, scheduledAt, excludeId);
  if (clashes.length + 1 <= getService(state.settings, serviceId).rooms) return null;
  const tz = state.settings.timezone;
  const w = windowOf(state.settings, serviceId, scheduledAt);
  const list = clashes
    .sort(compareByTarget)
    .map((c) => `${c.token} (${formatClock(c.scheduledAt!, tz)})`)
    .join(", ");
  return `${formatClock(w.start, tz)}–${formatClock(w.end, tz)} clashes with ${list}.`;
}

/** Existing bookings that exceed their service's rooms (e.g. after rooms were reduced). */
export function capacityWarnings(state: QueueState): string[] {
  const tz = state.settings.timezone;
  const warnings: string[] = [];
  const active = state.customers.filter(isActiveAppointment).sort(compareByTarget);
  for (const c of active) {
    const clashes = findClashes(state, c.service, c.scheduledAt!, c.id);
    if (clashes.length + 1 > getService(state.settings, c.service).rooms) {
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
  if (!c) throw new QueueError("Patient not found.");
  return c;
}

function servingAt(state: QueueState, room: string): Customer | undefined {
  return state.customers.find((c) => c.status === "serving" && c.room === room);
}

function withCustomer(state: QueueState, updated: Customer): QueueState {
  return { ...state, customers: state.customers.map((c) => (c.id === updated.id ? updated : c)) };
}

function bump(state: QueueState): QueueState {
  return { ...state, version: state.version + 1 };
}

/** " Target 10:15 so CA-001 goes first." after an add, when the walk-in was held. */
function holdNote(hold: Customer["hold"], tz: string): string {
  return hold ? ` Target ${formatClock(hold.until, tz)} so ${hold.for}'s appointment goes first.` : "";
}

function issue(state: QueueState, service: Service, type: CustomerType): { token: string; seq: QueueState["seq"] } {
  const prefix = tokenPrefix(service, type);
  const n = (state.seq[prefix] ?? 0) + 1;
  return { token: makeToken(prefix, n), seq: { ...state.seq, [prefix]: n } };
}

function startServing(state: QueueState, room: string, customer: Customer, reason: string, now: number): ActionResult {
  const called: CallRecord = { room, customerId: customer.id, token: customer.token, reason, at: now };
  const next = withCustomer(state, { ...customer, status: "serving", calledAt: now, room, priority: undefined });
  return {
    state: bump({ ...next, lastCalls: { ...next.lastCalls, [room]: called } }),
    message: reason,
    called,
  };
}

function freeRoom(state: QueueState, roomRef: string): Room {
  const room = parseRoom(state.settings, roomRef);
  const busy = servingAt(state, room.id);
  if (busy) {
    throw new QueueError(`${roomLabel(state.settings, room.id)} is still serving ${busy.token}. Close it out first.`);
  }
  return room;
}

export function callNext(state: QueueState, roomRef: string, now: number): ActionResult {
  const room = freeRoom(state, roomRef);
  const waiting = state.customers.filter((c) => c.status === "waiting" && c.service === room.serviceId);
  const pick = pickNext(waiting, now, state.settings);
  if (!pick) {
    return { state, message: `Nobody is waiting for ${getService(state.settings, room.serviceId).name}. ${roomLabel(state.settings, room.id)} stays free.` };
  }
  return startServing(state, room.id, pick.customer, pick.reason, now);
}

export function applyAction(state: QueueState, action: Action, now: number): ActionResult {
  const { settings } = state;
  const tz = settings.timezone;

  switch (action.type) {
    case "addWalkIn": {
      const name = validName(action.name);
      const service = getService(settings, action.service);
      const { token, seq } = issue(state, service, "walk_in");
      const hold = walkInHold(state, service.id, now);
      const customer: Customer = {
        id: token,
        token,
        name,
        type: "walk_in",
        service: service.id,
        createdAt: now,
        arrivedAt: now,
        checkedIn: true,
        status: "waiting",
        lateConverted: false,
        ...(hold ? { hold } : {}),
      };
      return {
        state: bump({ ...state, seq, customers: [...state.customers, customer] }),
        message: `${token} added for ${name} (${service.name}).${holdNote(hold, tz)}`,
      };
    }

    case "book": {
      const name = validName(action.name);
      const service = getService(settings, action.service);
      validSchedule(state, action.scheduledAt, now);
      const clash = checkCapacity(state, service.id, action.scheduledAt);
      if (clash) throw new QueueError(clash);
      const { token, seq } = issue(state, service, "appointment");
      const customer: Customer = {
        id: token,
        token,
        name,
        type: "appointment",
        service: service.id,
        createdAt: now,
        scheduledAt: action.scheduledAt,
        checkedIn: false,
        status: "booked",
        lateConverted: false,
      };
      return {
        state: bump({ ...state, seq, customers: [...state.customers, customer] }),
        message: `${token} booked for ${name} at ${formatClock(action.scheduledAt, tz)} (${service.name}).`,
      };
    }

    case "checkIn": {
      const c = findCustomer(state, action.id);
      if (c.type !== "appointment" || c.status !== "booked") {
        throw new QueueError(`${c.token} is not a booked appointment.`);
      }
      const late = isLateArrival(c.scheduledAt!, now, settings.graceMinutes);
      const hold = late ? walkInHold(state, c.service, now, c.id) : undefined;
      const updated: Customer = { ...c, arrivedAt: now, checkedIn: true, status: "waiting", lateConverted: late };
      if (hold) updated.hold = hold;
      return {
        state: bump(withCustomer(state, updated)),
        message: late
          ? `${c.token} arrived after the ${settings.graceMinutes}-minute grace period and joins as a walk-in.${holdNote(hold, tz)}`
          : `${c.token} checked in for ${formatClock(c.scheduledAt!, tz)}.`,
      };
    }

    case "edit": {
      const c = findCustomer(state, action.id);
      if (c.status !== "booked" && c.status !== "waiting") {
        throw new QueueError(`${c.token} can no longer be edited.`);
      }
      if (action.service !== undefined && action.service !== c.service) {
        throw new QueueError("Each service has its own queue and token. To change service, cancel and add them again.");
      }
      const updated: Customer = { ...c };
      if (action.name !== undefined) updated.name = validName(action.name);
      if (action.scheduledAt !== undefined && action.scheduledAt !== c.scheduledAt) {
        if (c.type !== "appointment") throw new QueueError("Walk-ins have no scheduled time.");
        if (c.status === "booked") {
          validSchedule(state, action.scheduledAt, now);
        } else {
          if (dayKey(action.scheduledAt, tz) !== state.day || !isSlotAligned(action.scheduledAt)) {
            throw new QueueError("Choose a 5-minute slot today.");
          }
          updated.lateConverted = isLateArrival(action.scheduledAt, c.arrivedAt!, settings.graceMinutes);
          // Re-judged as of their arrival, like a walk-in who came in then.
          const hold = updated.lateConverted ? walkInHold(state, c.service, c.arrivedAt!, c.id) : undefined;
          if (hold) updated.hold = hold;
          else delete updated.hold;
        }
        updated.scheduledAt = action.scheduledAt;
      }
      const windowChanged = updated.scheduledAt !== c.scheduledAt;
      if (isActiveAppointment(updated) && (windowChanged || c.lateConverted !== updated.lateConverted)) {
        const clash = checkCapacity(state, updated.service, updated.scheduledAt!, c.id);
        if (clash) throw new QueueError(clash);
      }
      return { state: bump(withCustomer(state, updated)), message: `${c.token} updated.` };
    }

    case "callNext":
      return callNext(state, action.room, now);

    case "callPatient": {
      const room = freeRoom(state, action.room);
      const c = findCustomer(state, action.id);
      if (c.status !== "waiting") throw new QueueError(`${c.token} is not waiting.`);
      if (c.service !== room.serviceId) {
        throw new QueueError(`${c.token} is in the ${getService(settings, c.service).name} queue, not ${getService(settings, room.serviceId).name}.`);
      }
      return startServing(state, room.id, c, `${c.token} called by staff (Call now).`, now);
    }

    case "serve": {
      const room = parseRoom(settings, action.room);
      const current = servingAt(state, room.id);
      if (!current) throw new QueueError(`${roomLabel(settings, room.id)} is not serving anyone.`);
      const served = bump(withCustomer(state, { ...current, status: "served", servedAt: now }));
      if (!action.callNext) return { state: served, message: `${current.token} served.` };
      return callNext(served, room.id, now);
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
      return { state: bump(withCustomer(state, { ...c, status: "cancelled", priority: undefined })), message: `${c.token} cancelled.` };
    }

    case "setPriority": {
      const c = findCustomer(state, action.id);
      if (c.status !== "waiting") throw new QueueError("Only patients who are waiting can be given priority.");
      if (action.reason === null) {
        return { state: bump(withCustomer(state, { ...c, priority: undefined })), message: `${c.token} is no longer priority.` };
      }
      if (!PRIORITY_REASONS.includes(action.reason)) throw new QueueError("Choose a priority reason.");
      const priority = { reason: action.reason, at: c.priority?.at ?? now };
      return {
        state: bump(withCustomer(state, { ...c, priority })),
        message: `${c.token} marked priority (${action.reason}); they're next in ${getService(settings, c.service).name}.`,
      };
    }

    case "updateSettings": {
      const next: Settings = { ...settings, services: settings.services.map((s) => ({ ...s })) };
      if (action.graceMinutes !== undefined) {
        if (!Number.isInteger(action.graceMinutes) || action.graceMinutes < 0 || action.graceMinutes > 60) {
          throw new QueueError("Grace period must be between 0 and 60 minutes.");
        }
        next.graceMinutes = action.graceMinutes;
      }
      if (action.protectionMinutes !== undefined) {
        if (!Number.isInteger(action.protectionMinutes) || action.protectionMinutes < 0 || action.protectionMinutes > 240) {
          throw new QueueError("Walk-in protection must be between 0 and 240 minutes.");
        }
        next.protectionMinutes = action.protectionMinutes;
      }
      for (const [id, minutes] of Object.entries(action.durations ?? {})) {
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
          throw new QueueError("Service durations must be between 1 and 240 minutes.");
        }
        const service = next.services.find((s) => s.id === id);
        if (!service) throw new QueueError(`Unknown service "${id}".`);
        service.defaultMinutes = minutes;
      }
      for (const [id, rooms] of Object.entries(action.rooms ?? {})) {
        const service = next.services.find((s) => s.id === id);
        if (!service) throw new QueueError(`Unknown service "${id}".`);
        if (!Number.isInteger(rooms) || rooms < 1 || rooms > MAX_ROOMS) {
          throw new QueueError(`Rooms must be between 1 and ${MAX_ROOMS}.`);
        }
        const busy = state.customers.find(
          (c) => c.status === "serving" && c.service === id && Number(c.room?.split(":")[1]) > rooms,
        );
        if (busy) throw new QueueError(`${roomLabel(settings, busy.room!)} is serving ${busy.token}. Close it out first.`);
        service.rooms = rooms;
      }
      return { state: bump({ ...state, settings: next }), message: "Settings saved." };
    }

    case "addService": {
      const service = newService(settings, action);
      return {
        state: bump({ ...state, settings: { ...settings, services: [...settings.services, service] } }),
        message: `${service.name} added: tokens ${service.letter}W-001 (walk-in) and ${service.letter}A-001 (appointment), ${service.rooms} room${service.rooms > 1 ? "s" : ""}.`,
      };
    }

    case "removeService": {
      const service = getService(settings, action.id);
      if (settings.services.length === 1) throw new QueueError("The clinic needs at least one service.");
      const active = state.customers.filter(
        (c) => c.service === service.id && (c.status === "booked" || c.status === "waiting" || c.status === "serving"),
      );
      if (active.length > 0) {
        const list = active.map((c) => c.token).join(", ");
        throw new QueueError(
          `${service.name} still has patients today (${list}). Serve, cancel or mark them no-show first.`,
        );
      }
      const lastCalls = Object.fromEntries(
        Object.entries(state.lastCalls).filter(([room]) => !room.startsWith(`${service.id}:`)),
      );
      return {
        state: bump({
          ...state,
          lastCalls,
          settings: { ...settings, services: settings.services.filter((s) => s.id !== service.id) },
        }),
        message: `${service.name} removed. Its finished patients stay in today's history.`,
      };
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
  /** Place within the service queue. */
  position: number;
  targetAt: number;
  waitMs: number;
  waitLabel: string;
  projectedRoom: string;
  startAt: number;
  expectedMs: number;
}

export interface BookedRow extends Customer {
  overdue: boolean;
}

export interface RoomView {
  id: string;
  serviceId: string;
  n: number;
  label: string;
  current: Customer | null;
  /** When the current patient is expected to finish (at least 1 min from now). */
  expectedEndAt: number | null;
  lastCall: CallRecord | null;
  /** Patients waiting in this room's service queue. */
  waitingCount: number;
}

export interface QueueView {
  now: number;
  day: string;
  version: number;
  settings: Settings;
  rooms: RoomView[];
  waiting: WaitingRow[];
  booked: BookedRow[];
  done: Customer[];
  expected: Record<string, { minutes: number; samples: number }>;
  warnings: string[];
}

export function buildView(state: QueueState, now: number): QueueView {
  const { settings } = state;
  const projection = new Map(simulate(state, now).map((p) => [p.id, p]));
  const expectedMs = (serviceId: string) => expectedDuration(state.customers, settings, serviceId).ms;
  const order = new Map(settings.services.map((s, i) => [s.id, i]));

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
        projectedRoom: p.room,
        startAt: p.startAt,
        expectedMs: expectedMs(c.service),
      };
    })
    .sort((a, b) => order.get(a.service)! - order.get(b.service)! || a.position - b.position);

  const expected: QueueView["expected"] = {};
  for (const s of settings.services) {
    const e = expectedDuration(state.customers, settings, s.id);
    expected[s.id] = { minutes: Math.round((e.ms / MINUTE) * 10) / 10, samples: e.samples };
  }

  return {
    now,
    day: state.day,
    version: state.version,
    settings,
    rooms: allRooms(settings).map((r) => {
      const current = servingAt(state, r.id) ?? null;
      return {
        ...r,
        label: roomLabel(settings, r.id),
        current,
        expectedEndAt: current ? now + Math.max(expectedMs(current.service) - (now - current.calledAt!), MINUTE) : null,
        lastCall: state.lastCalls[r.id] ?? null,
        waitingCount: waiting.filter((w) => w.service === r.serviceId).length,
      };
    }),
    waiting,
    booked: state.customers
      .filter((c) => c.status === "booked")
      .map((c) => ({ ...c, overdue: isOverdue(c, now, settings) }))
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

export interface PublicService {
  id: string;
  name: string;
  letter: string;
  rooms: { id: string; label: string; n: number; token: string | null; initial: string | null }[];
  waiting: PublicRow[];
}

export interface PublicView {
  now: number;
  services: PublicService[];
}

/**
 * Strips everything but token, initial, place and wait, per service queue. Booked appointments
 * and priority reasons are never included.
 */
export function toPublicView(view: QueueView): PublicView {
  return {
    now: view.now,
    services: view.settings.services.map((s) => ({
      id: s.id,
      name: s.name,
      letter: s.letter,
      rooms: view.rooms
        .filter((r) => r.serviceId === s.id)
        .map((r) => ({
          id: r.id,
          label: `Room ${r.n}`,
          n: r.n,
          token: r.current?.token ?? null,
          initial: r.current ? publicName(r.current.name) : null,
        })),
      waiting: view.waiting
        .filter((w) => w.service === s.id)
        .map((w) => ({
          token: w.token,
          initial: publicName(w.name),
          position: w.position,
          waitLabel: w.waitLabel,
          lateConverted: w.lateConverted,
        })),
    })),
  };
}
