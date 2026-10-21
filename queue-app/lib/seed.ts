// Fictional seed data across the five service queues, built relative to `now` so the demo always
// looks like a live morning. All names are invented. Pure: no I/O.

import {
  type CallRecord,
  type Customer,
  type CustomerType,
  type QueueState,
  type Settings,
  createState,
  getService,
  makeToken,
  roomId,
  tokenPrefix,
} from "./queue";
import { MINUTE, SLOT_MINUTES } from "./time";

const SLOT = SLOT_MINUTES * MINUTE;
const slotAfter = (ms: number) => Math.ceil(ms / SLOT) * SLOT;
const slotBefore = (ms: number) => Math.floor(ms / SLOT) * SLOT;

export function buildSeedState(now: number, settings: Settings, version: number): QueueState {
  const m = (minutes: number) => now + minutes * MINUTE;
  const seq: Record<string, number> = {};
  const customers: Customer[] = [];
  const lastCalls: Record<string, CallRecord> = {};

  const add = (type: CustomerType, serviceId: string, name: string, extra: Partial<Customer>): Customer => {
    const prefix = tokenPrefix(getService(settings, serviceId), type);
    seq[prefix] = (seq[prefix] ?? 0) + 1;
    const token = makeToken(prefix, seq[prefix]);
    const c: Customer = {
      id: token,
      token,
      name,
      type,
      service: serviceId,
      createdAt: extra.arrivedAt ?? m(-120),
      checkedIn: type === "walk_in",
      status: "waiting",
      lateConverted: false,
      ...extra,
    };
    customers.push(c);
    return c;
  };
  const walkIn = (serviceId: string, name: string, arrived: number, extra: Partial<Customer> = {}) =>
    add("walk_in", serviceId, name, { arrivedAt: arrived, ...extra });
  const appointment = (serviceId: string, name: string, slot: number, extra: Partial<Customer> = {}) =>
    add("appointment", serviceId, name, { scheduledAt: slot, status: "booked", ...extra });
  const nowServing = (c: Customer, reason: string) => {
    lastCalls[c.room!] = { room: c.room!, customerId: c.id, token: c.token, reason, at: c.calledAt! };
  };

  const consult = roomId("consultation", 1);
  const follow = roomId("follow_up", 1);
  const blood = roomId("blood_test", 1);

  // Consultation: two served (averages), one being seen, two walk-ins waiting, one early appointment.
  walkIn("consultation", "Tahmina Akter", m(-80), { status: "served", calledAt: m(-75), servedAt: m(-62), room: consult });
  walkIn("consultation", "Rashed Karim", m(-65), { status: "served", calledAt: m(-60), servedAt: m(-46), room: consult });
  nowServing(
    walkIn("consultation", "Imtiaz Rahman", m(-40), { status: "serving", calledAt: m(-8), room: consult }),
    "CW-003 called: walk-in, arrived earlier, the earliest due.",
  );
  walkIn("consultation", "Sharmin Sultana", m(-22));
  walkIn("consultation", "Mehjabin Noor", m(-6));
  appointment("consultation", "Ayesha Siddika", slotAfter(m(20)), { status: "waiting", checkedIn: true, arrivedAt: m(-3) });
  appointment("consultation", "Kamrul Islam", slotAfter(m(50)));

  // Follow-up: one served, one being seen, one priority walk-in waiting.
  walkIn("follow_up", "Nabila Hossain", m(-50), { status: "served", calledAt: m(-45), servedAt: m(-36), room: follow });
  nowServing(
    walkIn("follow_up", "Bappy Chowdhury", m(-15), { status: "serving", calledAt: m(-4), room: follow }),
    "FW-002 called: walk-in, the earliest due.",
  );
  walkIn("follow_up", "Rahima Begum", m(-10), { priority: { reason: "Elderly", at: m(-9) } });

  // Blood test: one served, two waiting; vaccination: an overdue booking; prescription: one waiting.
  walkIn("blood_test", "Omar Faruk", m(-30), { status: "served", calledAt: m(-28), servedAt: m(-22), room: blood });
  walkIn("blood_test", "Puja Sen", m(-12));
  walkIn("blood_test", "Arif Mia", m(-2));
  appointment("vaccination", "Fazlul Haque", slotBefore(m(-30)));
  walkIn("prescription", "Lina Roy", m(-5));

  return { ...createState(now, settings), version, customers, seq, lastCalls };
}
