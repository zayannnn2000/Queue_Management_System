// Fictional seed data, built relative to `now` so the demo always looks like a live morning.
// All names are invented. Pure: no I/O.

import { type Customer, type QueueState, type Settings, createState, makeToken } from "./queue";
import { MINUTE, SLOT_MINUTES } from "./time";

const SLOT = SLOT_MINUTES * MINUTE;
const slotAfter = (ms: number) => Math.ceil(ms / SLOT) * SLOT;
const slotBefore = (ms: number) => Math.floor(ms / SLOT) * SLOT;

export function buildSeedState(now: number, settings: Settings, version: number): QueueState {
  const m = (minutes: number) => now + minutes * MINUTE;
  let w = 0;
  let a = 0;

  const walkIn = (name: string, service: string, arrived: number, extra: Partial<Customer> = {}): Customer => {
    const token = makeToken("W", ++w);
    return {
      id: token,
      token,
      name,
      type: "walk_in",
      service,
      createdAt: arrived,
      arrivedAt: arrived,
      checkedIn: true,
      status: "waiting",
      lateConverted: false,
      ...extra,
    };
  };

  const appointment = (name: string, service: string, scheduledAt: number, extra: Partial<Customer> = {}): Customer => {
    const token = makeToken("A", ++a);
    return {
      id: token,
      token,
      name,
      type: "appointment",
      service,
      createdAt: m(-120),
      scheduledAt,
      checkedIn: false,
      status: "booked",
      lateConverted: false,
      ...extra,
    };
  };

  const customers: Customer[] = [
    // Served earlier: these fill the rolling averages.
    walkIn("Tahmina Akter", "consultation", m(-75), { status: "served", calledAt: m(-70), servedAt: m(-57), counter: 1 }),
    walkIn("Rashed Karim", "follow_up", m(-60), { status: "served", calledAt: m(-56), servedAt: m(-47), counter: 1 }),
    walkIn("Nabila Hossain", "blood_test", m(-50), { status: "served", calledAt: m(-46), servedAt: m(-40), counter: 1 }),
    // Being served now.
    walkIn("Imtiaz Rahman", "consultation", m(-35), { status: "serving", calledAt: m(-8), counter: 1 }),
    // Waiting walk-ins.
    walkIn("Sharmin Sultana", "follow_up", m(-25)),
    walkIn("Bappy Chowdhury", "vaccination", m(-15)),
    walkIn("Mehjabin Noor", "prescription", m(-5)),
    // Appointments: overdue (not arrived), early checked-in, and booked for later.
    appointment("Fazlul Haque", "vaccination", slotBefore(m(-30))),
    appointment("Ayesha Siddika", "follow_up", slotAfter(m(20)), {
      status: "waiting",
      checkedIn: true,
      arrivedAt: m(-3),
    }),
    appointment("Kamrul Islam", "consultation", slotAfter(m(45))),
  ];

  return {
    ...createState(now, settings),
    version,
    customers,
    seq: { W: w, A: a },
    lastCalls: {
      "1": {
        counter: 1,
        customerId: "W-004",
        token: "W-004",
        reason: "W-004 called: walk-in, the earliest due target.",
        at: m(-8),
      },
    },
  };
}
