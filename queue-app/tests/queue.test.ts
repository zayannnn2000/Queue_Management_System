import { describe, expect, it } from "vitest";
import {
  type Action,
  type QueueState,
  type Settings,
  DEFAULT_SETTINGS,
  QueueError,
  applyAction,
  buildView,
  capacityWarnings,
  createState,
  expectedDuration,
  formatWait,
  rolloverIfNewDay,
  roomId,
  simulate,
  toPublicView,
  upgradeState,
} from "../lib/queue";
import { MINUTE } from "../lib/time";

// 22 Oct 2026 in Asia/Dhaka (UTC+6). All names are fictional.
const at = (h: number, m: number) => Date.UTC(2026, 9, 22, h - 6, m);
const CONSULT = roomId("consultation", 1);
const BLOOD = roomId("blood_test", 1);

function run(state: QueueState, action: Action, now: number): QueueState {
  return applyAction(state, action, now).state;
}

function fresh(patch: Partial<Settings> = {}, rooms: Record<string, number> = {}): QueueState {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...patch,
    services: DEFAULT_SETTINGS.services.map((s) => ({ ...s, rooms: rooms[s.id] ?? s.rooms })),
  };
  return createState(at(8, 0), settings);
}

const walkIn = (s: QueueState, name: string, service: string, now: number) =>
  run(s, { type: "addWalkIn", name, service }, now);
const book = (s: QueueState, name: string, service: string, slot: number, now = at(8, 30)) =>
  run(s, { type: "book", name, service, scheduledAt: slot }, now);
const waitOf = (s: QueueState, token: string, now: number) => simulate(s, now).find((p) => p.id === token)!;
const serving = (s: QueueState, room = CONSULT) => s.customers.find((c) => c.status === "serving" && c.room === room);

describe("tokens and queues", () => {
  it("issues a token per service and type: letter + W/A + number", () => {
    let s = walkIn(fresh(), "Tanvir Hasan", "consultation", at(9, 0));
    s = walkIn(s, "Mitu Akter", "blood_test", at(9, 1));
    s = book(s, "Nadia Islam", "consultation", at(11, 0));
    s = walkIn(s, "Rafi Chowdhury", "consultation", at(9, 2));
    expect(s.customers.map((c) => c.token)).toEqual(["CW-001", "BW-001", "CA-001", "CW-002"]);
  });

  it("keeps each service in its own queue with its own room", () => {
    let s = walkIn(fresh(), "Karim Uddin", "consultation", at(9, 0));
    s = walkIn(s, "Sumon Das", "consultation", at(9, 1));
    s = walkIn(s, "Lima Roy", "blood_test", at(9, 2));
    s = run(s, { type: "callNext", room: CONSULT }, at(9, 3));
    s = run(s, { type: "callNext", room: BLOOD }, at(9, 3));
    expect(serving(s, CONSULT)!.token).toBe("CW-001");
    expect(serving(s, BLOOD)!.token).toBe("BW-001");
    // The blood test patient never waited behind consultations; CW-002 is first in its own queue.
    expect(waitOf(s, "CW-002", at(9, 5))).toMatchObject({ position: 1, room: CONSULT, waitMs: 13 * MINUTE });
  });

  it("leaves a room free when its own queue is empty, even if others are waiting", () => {
    const s = walkIn(fresh(), "Arif Mia", "consultation", at(9, 0));
    const r = applyAction(s, { type: "callNext", room: BLOOD }, at(9, 1));
    expect(r.called).toBeUndefined();
    expect(r.message).toContain("stays free");
  });
});

describe("call next within a service", () => {
  it("serves walk-ins first in, first out", () => {
    let s = fresh();
    for (const [name, m] of [["A One", 0], ["B Two", 5], ["C Three", 10]] as const) s = walkIn(s, name, "follow_up", at(9, m));
    const room = roomId("follow_up", 1);
    const order: string[] = [];
    for (const t of [at(9, 15), at(9, 25), at(9, 35)]) {
      s = run(s, { type: "callNext", room }, t);
      order.push(serving(s, room)!.token);
      s = run(s, { type: "serve", room }, t + 10 * MINUTE);
    }
    expect(order).toEqual(["FW-001", "FW-002", "FW-003"]);
  });

  it("calls a due appointment ahead of a walk-in who arrived earlier", () => {
    let s = book(fresh(), "Nadia Islam", "consultation", at(10, 0));
    s = walkIn(s, "Karim Uddin", "consultation", at(9, 50));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(9, 55));
    const r = applyAction(s, { type: "callNext", room: CONSULT }, at(10, 0));
    expect(r.called!.token).toBe("CA-001");
    expect(r.called!.reason).toContain("appointments go ahead of walk-ins");
  });

  it("makes an early appointment wait for its slot", () => {
    let s = book(fresh(), "Shirin Begum", "consultation", at(10, 30));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(10, 0));
    s = walkIn(s, "Jamal Sarker", "consultation", at(10, 5));
    expect(applyAction(s, { type: "callNext", room: CONSULT }, at(10, 10)).called!.token).toBe("CW-001");
  });

  it("keeps the place of a walk-in who has waited at least the protection time", () => {
    let s = walkIn(fresh(), "Rokeya Khatun", "consultation", at(9, 20));
    s = book(s, "Hasan Ali", "consultation", at(10, 0));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(9, 58));
    const r = applyAction(s, { type: "callNext", room: CONSULT }, at(10, 0)); // walk-in waited 40 min
    expect(r.called!.token).toBe("CW-001");
    expect(r.called!.reason).toContain("waited over 30 min");

    const off = { ...s, settings: { ...s.settings, protectionMinutes: 0 } };
    expect(applyAction(off, { type: "callNext", room: CONSULT }, at(10, 0)).called!.token).toBe("CA-001");
  });

  it("converts an appointment that arrives after the grace period into a walk-in, keeping its token", () => {
    let s = book(fresh(), "Farhana Kabir", "consultation", at(10, 0));
    s = walkIn(s, "Sumon Das", "consultation", at(10, 5));
    const r = applyAction(s, { type: "checkIn", id: "CA-001" }, at(10, 11));
    s = r.state;
    expect(s.customers.find((c) => c.id === "CA-001")).toMatchObject({ lateConverted: true, token: "CA-001" });
    expect(r.message).toContain("walk-in");
    expect(applyAction(s, { type: "callNext", room: CONSULT }, at(10, 12)).called!.token).toBe("CW-001");
  });

  it("treats arrival exactly at the end of the grace period as on time", () => {
    let s = book(fresh(), "Rina Paul", "consultation", at(10, 0));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(10, 10));
    expect(s.customers[0].lateConverted).toBe(false);
  });

  it("breaks a tie between two appointments by lower token number", () => {
    let s = book(fresh({}, { vaccination: 2 }), "Mahin Alam", "vaccination", at(10, 0));
    s = book(s, "Tania Sultana", "vaccination", at(10, 0), at(8, 31));
    s = run(s, { type: "checkIn", id: "VA-002" }, at(9, 50));
    s = run(s, { type: "checkIn", id: "VA-001" }, at(9, 55));
    const r = applyAction(s, { type: "callNext", room: roomId("vaccination", 1) }, at(10, 0));
    expect(r.called!.token).toBe("VA-001");
    expect(r.called!.reason).toContain("lower token number");
  });

  it("calls a future appointment when it is the only one waiting (idle-fill)", () => {
    let s = book(fresh(), "Zara Ahmed", "follow_up", at(11, 0));
    s = run(s, { type: "checkIn", id: "FA-001" }, at(10, 0));
    expect(waitOf(s, "FA-001", at(10, 0)).waitMs).toBe(0);
    const r = applyAction(s, { type: "callNext", room: roomId("follow_up", 1) }, at(10, 0));
    expect(r.called!.reason).toContain("called early");
  });

  it("refuses to call next while the room is still serving", () => {
    let s = walkIn(fresh(), "Shakil Ahmed", "consultation", at(9, 0));
    s = walkIn(s, "Moni Roy", "consultation", at(9, 1));
    s = run(s, { type: "callNext", room: CONSULT }, at(9, 2));
    expect(() => applyAction(s, { type: "callNext", room: CONSULT }, at(9, 3))).toThrow(QueueError);
  });

  it("uses two rooms of one service in parallel", () => {
    let s = fresh({}, { consultation: 2 });
    for (const [name, m] of [["Hasib Reza", 0], ["Puja Sen", 1], ["Omar Faruk", 2]] as const) s = walkIn(s, name, "consultation", at(9, m));
    s = run(s, { type: "callNext", room: CONSULT }, at(9, 3));
    s = run(s, { type: "callNext", room: roomId("consultation", 2) }, at(9, 4));
    expect(waitOf(s, "CW-003", at(9, 5))).toMatchObject({ position: 1, room: CONSULT, waitMs: 13 * MINUTE });
  });
});

describe("walk-in held for an appointment due within 15 minutes", () => {
  const bookedAndIn = (slot: number, checkInAt: number) =>
    run(book(fresh(), "Sadia Karim", "consultation", slot, at(9, 0)), { type: "checkIn", id: "CA-001" }, checkInAt);

  it("holds the walk-in's target to arrival + 15 so the appointment is called first", () => {
    let s = walkIn(bookedAndIn(at(10, 5), at(9, 58)), "Rubel Hossain", "consultation", at(10, 0));
    expect(s.customers.find((c) => c.token === "CW-001")!.hold).toEqual({ until: at(10, 15), for: "CA-001" });
    const r = applyAction(s, { type: "callNext", room: CONSULT }, at(10, 0));
    expect(r.called!.token).toBe("CA-001"); // called early: the walk-in isn't due until 10:15
    s = run(r.state, { type: "serve", room: CONSULT }, at(10, 12));
    const next = applyAction(s, { type: "callNext", room: CONSULT }, at(10, 12));
    expect(next.called!.token).toBe("CW-001");
    expect(next.called!.reason).toContain("arrived 10:00 (target 10:15, held for CA-001)");
  });

  it("lets the appointment go first when a room frees up just before its time", () => {
    let s = walkIn(fresh(), "Early Bird", "consultation", at(9, 40));
    s = run(s, { type: "callNext", room: CONSULT }, at(9, 48));
    s = run(book(s, "Sadia Karim", "consultation", at(10, 5), at(9, 50)), { type: "checkIn", id: "CA-001" }, at(9, 59));
    s = walkIn(s, "Rubel Hossain", "consultation", at(10, 1));
    s = run(s, { type: "serve", room: CONSULT }, at(10, 3));
    expect(applyAction(s, { type: "callNext", room: CONSULT }, at(10, 3)).called!.token).toBe("CA-001");
  });

  it("puts the walk-in behind the appointment in the wait estimate too", () => {
    const s = walkIn(bookedAndIn(at(10, 10), at(10, 0)), "Rubel Hossain", "consultation", at(10, 0));
    const order = simulate(s, at(10, 0)).map((p) => p.id);
    expect(order).toEqual(["CA-001", "CW-001"]);
  });

  it("does not hold when the appointment is more than 15 min away, already due, or in another service", () => {
    expect(walkIn(bookedAndIn(at(10, 20), at(10, 0)), "A", "consultation", at(10, 0)).customers.at(-1)!.hold).toBeUndefined();
    expect(walkIn(bookedAndIn(at(10, 0), at(9, 58)), "B", "consultation", at(10, 0)).customers.at(-1)!.hold).toBeUndefined();
    expect(walkIn(bookedAndIn(at(10, 5), at(9, 58)), "C", "blood_test", at(10, 0)).customers.at(-1)!.hold).toBeUndefined();
    // Exactly 15 min ahead still counts.
    expect(walkIn(bookedAndIn(at(10, 15), at(9, 58)), "D", "consultation", at(10, 0)).customers.at(-1)!.hold?.for).toBe("CA-001");
  });

  it("counts a booked appointment not yet arrived, but never leaves the room idle for it", () => {
    let s = book(fresh(), "Sadia Karim", "consultation", at(10, 5), at(9, 0));
    s = walkIn(s, "Rubel Hossain", "consultation", at(10, 0));
    expect(s.customers.at(-1)!.hold?.for).toBe("CA-001");
    // The appointment patient isn't here, so the walk-in is the only one waiting: called now.
    expect(applyAction(s, { type: "callNext", room: CONSULT }, at(10, 0)).called!.token).toBe("CW-001");
  });

  it("applies to a late arrival re-queued as a walk-in", () => {
    let s = book(fresh(), "Late Person", "consultation", at(9, 30), at(9, 0));
    s = book(s, "Sadia Karim", "consultation", at(10, 5), at(9, 0));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(9, 55)); // 25 min late
    expect(s.customers.find((c) => c.token === "CA-001")).toMatchObject({ lateConverted: true, hold: { until: at(10, 10), for: "CA-002" } });
  });
});

describe("staff priority and call now", () => {
  const three = () => {
    let s = walkIn(fresh(), "Ayesha Rahman", "consultation", at(9, 0));
    s = walkIn(s, "Bilal Hossain", "consultation", at(9, 5));
    return walkIn(s, "Chandra Das", "consultation", at(9, 10));
  };

  it("sends a priority patient to the front of their queue, with the reason", () => {
    const s = run(three(), { type: "setPriority", id: "CW-003", reason: "Elderly" }, at(9, 12));
    const r = applyAction(s, { type: "callNext", room: CONSULT }, at(9, 15));
    expect(r.called!.token).toBe("CW-003");
    expect(r.called!.reason).toContain("priority (Elderly)");
    expect(waitOf(s, "CW-003", at(9, 15)).position).toBe(1);
  });

  it("puts a priority patient ahead of a due appointment too", () => {
    let s = book(three(), "Dina Akter", "consultation", at(9, 15));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(9, 14));
    s = run(s, { type: "setPriority", id: "CW-002", reason: "Pregnant" }, at(9, 14));
    expect(applyAction(s, { type: "callNext", room: CONSULT }, at(9, 15)).called!.token).toBe("CW-002");
  });

  it("orders several priority patients by when they were flagged, and the flag can be removed", () => {
    let s = run(three(), { type: "setPriority", id: "CW-003", reason: "Urgent" }, at(9, 11));
    s = run(s, { type: "setPriority", id: "CW-002", reason: "Disability" }, at(9, 12));
    expect(applyAction(s, { type: "callNext", room: CONSULT }, at(9, 15)).called!.token).toBe("CW-003");
    s = run(s, { type: "setPriority", id: "CW-003", reason: null }, at(9, 13));
    expect(applyAction(s, { type: "callNext", room: CONSULT }, at(9, 15)).called!.token).toBe("CW-002");
    expect(() => run(s, { type: "setPriority", id: "CW-001", reason: "Sleepy" as never }, at(9, 14))).toThrow(QueueError);
  });

  it("lets staff call a specific patient now, only into a free room of their service", () => {
    let s = walkIn(three(), "Eva Biswas", "blood_test", at(9, 11));
    const r = applyAction(s, { type: "callPatient", room: CONSULT, id: "CW-003" }, at(9, 15));
    expect(r.called).toMatchObject({ token: "CW-003", reason: "CW-003 called by staff (Call now)." });
    expect(() => applyAction(s, { type: "callPatient", room: CONSULT, id: "BW-001" }, at(9, 15))).toThrow("Blood test queue");
    s = r.state;
    expect(() => applyAction(s, { type: "callPatient", room: CONSULT, id: "CW-001" }, at(9, 16))).toThrow("still serving");
  });
});

describe("booking", () => {
  it("refuses overlapping appointments within a service and names the clash", () => {
    const s = book(fresh(), "Fahim Noor", "consultation", at(10, 0));
    expect(() => book(s, "Fahim Noor", "consultation", at(10, 10))).toThrow("10:10–10:25 clashes with CA-001 (10:00)");
    expect(() => book(s, "Fahim Noor", "consultation", at(10, 15))).not.toThrow();
    expect(() => book(s, "Fahim Noor", "blood_test", at(10, 0))).not.toThrow(); // another service, another room
  });

  it("allows overlaps up to that service's rooms", () => {
    let s = book(fresh({}, { consultation: 2 }), "Fahim Noor", "consultation", at(10, 0));
    s = book(s, "Fahim Noor", "consultation", at(10, 5));
    expect(() => book(s, "Fahim Noor", "consultation", at(10, 10))).toThrow(QueueError);
  });

  it("rejects past, off-slot and other-day times", () => {
    const s = fresh();
    expect(() => book(s, "X", "consultation", at(8, 0))).toThrow("walk-in");
    expect(() => book(s, "X", "consultation", at(10, 3))).toThrow("5-minute");
    expect(() => book(s, "X", "consultation", at(30, 0))).toThrow("today");
  });

  it("re-checks capacity on edit and refuses a change of service", () => {
    let s = book(fresh(), "Fahim Noor", "consultation", at(10, 0));
    s = book(s, "Lamia Haque", "consultation", at(11, 0));
    expect(() => run(s, { type: "edit", id: "CA-002", scheduledAt: at(10, 5) }, at(9, 0))).toThrow("clashes");
    expect(() => run(s, { type: "edit", id: "CA-002", service: "blood_test" }, at(9, 0))).toThrow("cancel and add");
    s = run(s, { type: "edit", id: "CA-002", scheduledAt: at(10, 30), name: "Lamia H." }, at(9, 0));
    expect(s.customers[1]).toMatchObject({ scheduledAt: at(10, 30), name: "Lamia H.", token: "CA-002" });
  });

  it("re-evaluates lateness when a checked-in appointment's time is edited", () => {
    let s = book(fresh(), "Fahim Noor", "consultation", at(10, 0));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(10, 5));
    s = run(s, { type: "edit", id: "CA-001", scheduledAt: at(9, 30) }, at(10, 6));
    expect(s.customers[0].lateConverted).toBe(true);
  });

  it("blocks edits once the patient has been called", () => {
    let s = walkIn(fresh(), "Dipa Rani", "follow_up", at(9, 0));
    s = run(s, { type: "callNext", room: roomId("follow_up", 1) }, at(9, 1));
    expect(() => run(s, { type: "edit", id: "FW-001", name: "Dipa R." }, at(9, 2))).toThrow(QueueError);
  });

  it("warns but keeps bookings when a service's rooms are reduced", () => {
    let s = book(fresh({}, { consultation: 2 }), "A B", "consultation", at(10, 0));
    s = book(s, "C D", "consultation", at(10, 5));
    s = run(s, { type: "updateSettings", rooms: { consultation: 1 } }, at(9, 0));
    expect(s.customers.filter((c) => c.status === "booked")).toHaveLength(2);
    expect(capacityWarnings(s)).toHaveLength(2);
  });

  it("flags overdue bookings and lets staff mark them no-show", () => {
    let s = book(fresh(), "Fahim Noor", "consultation", at(10, 0));
    expect(buildView(s, at(10, 10)).booked[0].overdue).toBe(false);
    expect(buildView(s, at(10, 11)).booked[0].overdue).toBe(true);
    s = run(s, { type: "noShow", id: "CA-001" }, at(10, 30));
    expect(s.customers[0].status).toBe("no_show");
  });
});

describe("wait estimate", () => {
  it("formats waits as Due now or ~X min rounded up to 5", () => {
    expect([0, 2, 2.5, 5, 5.1, 12].map((m) => formatWait(m * MINUTE))).toEqual([
      "Due now",
      "Due now",
      "~5 min",
      "~5 min",
      "~10 min",
      "~15 min",
    ]);
  });

  it("updates the estimate after a service finishes", () => {
    let s = fresh();
    for (const name of ["Sabbir Khan", "Nusrat Jahan", "Imran Hossain"]) s = walkIn(s, name, "consultation", at(9, 0));
    s = run(s, { type: "callNext", room: CONSULT }, at(9, 0));
    expect(waitOf(s, "CW-002", at(9, 5)).waitMs).toBe(10 * MINUTE);
    expect(waitOf(s, "CW-003", at(9, 5)).waitMs).toBe(25 * MINUTE);
    s = run(s, { type: "serve", room: CONSULT, callNext: true }, at(9, 5)); // CW-001 took 5 min
    expect(expectedDuration(s.customers, s.settings, "consultation")).toEqual({ ms: 5 * MINUTE, samples: 1 });
    expect(waitOf(s, "CW-003", at(9, 5)).waitMs).toBe(5 * MINUTE);
  });

  it("averages the last 5 served visits, clamped, ignoring no-shows", () => {
    let s = fresh();
    const room = BLOOD;
    let t = at(9, 0);
    for (const d of [60, 2, 4, 6, 8, 10]) {
      s = walkIn(s, "Sample Patient", "blood_test", t);
      s = run(s, { type: "callNext", room }, t);
      s = run(s, { type: "serve", room }, t + d * MINUTE);
      t += d * MINUTE;
    }
    s = walkIn(s, "No Show", "blood_test", t);
    s = run(s, { type: "callNext", room }, t);
    s = run(s, { type: "noShow", id: serving(s, room)!.id }, t + 30 * MINUTE);
    expect(expectedDuration(s.customers, s.settings, "blood_test")).toEqual({ ms: 6 * MINUTE, samples: 5 });
  });

  it("assumes at least 1 more minute for an overrunning visit", () => {
    let s = walkIn(fresh(), "Kamal Hossain", "vaccination", at(9, 0));
    s = walkIn(s, "Ruma Khatun", "vaccination", at(9, 0));
    s = run(s, { type: "callNext", room: roomId("vaccination", 1) }, at(9, 0));
    expect(waitOf(s, "VW-002", at(9, 20)).waitMs).toBe(MINUTE);
  });
});

describe("documentation worked example", () => {
  // docs/documentation.docx §4: Consultation, 1 room, now 10:00, the current patient (CW-001,
  // called 09:51, 15-min default) finishes at 10:06. CW-002 arrived 09:50, CW-003 09:58, and
  // CA-001 (booked 10:05) checked in at 09:55.
  it("matches the table: the appointment at its time, then the protected walk-in", () => {
    let s = book(fresh(), "Lamia Haque", "consultation", at(10, 5));
    s = walkIn(s, "Current Patient", "consultation", at(9, 40));
    s = run(s, { type: "callNext", room: CONSULT }, at(9, 51));
    s = walkIn(s, "Sohel Rana", "consultation", at(9, 50));
    s = run(s, { type: "checkIn", id: "CA-001" }, at(9, 55));
    s = walkIn(s, "Tania Akter", "consultation", at(9, 58));
    expect(buildView(s, at(10, 0)).waiting.map((w) => [w.token, w.waitMs / MINUTE, w.waitLabel])).toEqual([
      ["CA-001", 6, "~10 min"],
      ["CW-002", 21, "~25 min"],
      ["CW-003", 36, "~40 min"],
    ]);
  });
});

describe("adding and removing services", () => {
  const add = (s: QueueState, name: string, letter: string, minutes = 20, rooms = 1) =>
    run(s, { type: "addService", name, letter, minutes, rooms }, at(9, 0));

  it("adds a service with its own queue, token letter, room and colour", () => {
    let s = add(fresh(), "Physiotherapy", "t", 30, 2);
    const physio = s.settings.services.at(-1)!;
    expect(physio).toMatchObject({ id: "physiotherapy", name: "Physiotherapy", letter: "T", defaultMinutes: 30, rooms: 2 });
    expect(physio.color).toBe("green"); // the first colour the five defaults don't use
    s = walkIn(s, "Sabbir Ahmed", "physiotherapy", at(9, 1));
    s = book(s, "Tania Rahman", "physiotherapy", at(11, 0));
    expect(s.customers.map((c) => c.token)).toEqual(["TW-001", "TA-001"]);
    s = run(s, { type: "callNext", room: roomId("physiotherapy", 2) }, at(9, 2));
    expect(serving(s, roomId("physiotherapy", 2))?.token).toBe("TW-001");
    const view = buildView(s, at(9, 3));
    expect(view.rooms.filter((r) => r.serviceId === "physiotherapy")).toHaveLength(2);
    expect(toPublicView(view).services.at(-1)!.name).toBe("Physiotherapy");
  });

  it("refuses a duplicate name or letter, a bad letter, and bad lengths or rooms", () => {
    const s = fresh();
    expect(() => add(s, "blood test", "Z")).toThrow(/already a service called Blood test/);
    expect(() => add(s, "Dental", "B")).toThrow(/Blood test already uses the letter B/);
    expect(() => add(s, "Dental", "7")).toThrow(/one letter, A to Z/);
    expect(() => add(s, "  ", "D")).toThrow(/Enter the service name/);
    expect(() => add(s, "Dental", "D", 0)).toThrow(/between 1 and 240/);
    expect(() => add(s, "Dental", "D", 20, 5)).toThrow(/Rooms must be between 1 and 4/);
  });

  it("caps the number of services", () => {
    let s = fresh();
    for (const [i, l] of ["D", "E", "G", "H", "I"].entries()) s = add(s, `Clinic ${i}`, l);
    expect(s.settings.services).toHaveLength(10);
    expect(() => add(s, "One more", "J")).toThrow(/at most 10 services/);
  });

  it("removes a service only when nobody is booked, waiting or being seen for it", () => {
    let s = walkIn(fresh(), "Joya Paul", "vaccination", at(9, 0));
    expect(() => run(s, { type: "removeService", id: "vaccination" }, at(9, 1))).toThrow(/still has patients today \(VW-001\)/);
    s = run(s, { type: "cancel", id: "VW-001" }, at(9, 2));
    s = run(s, { type: "removeService", id: "vaccination" }, at(9, 3));
    expect(s.settings.services.map((x) => x.id)).not.toContain("vaccination");
    expect(buildView(s, at(9, 4)).done.map((c) => c.token)).toEqual(["VW-001"]); // history kept
    expect(() => walkIn(s, "Rumi Das", "vaccination", at(9, 5))).toThrow(/Unknown service/);
  });

  it("never removes the last service", () => {
    let s = fresh();
    for (const id of ["follow_up", "blood_test", "vaccination", "prescription"]) s = run(s, { type: "removeService", id }, at(9, 0));
    expect(() => run(s, { type: "removeService", id: "consultation" }, at(9, 1))).toThrow(/at least one service/);
  });
});

describe("day and display", () => {
  it("resets tokens on a new clinic-local day", () => {
    let s = walkIn(fresh(), "Arman Ali", "follow_up", at(9, 0));
    expect(rolloverIfNewDay(s, at(23, 59))).toBe(s);
    s = rolloverIfNewDay(s, at(24, 0));
    expect(s.customers).toHaveLength(0);
    s = walkIn(s, "Arman Ali", "follow_up", at(24, 30));
    expect(s.customers[0].token).toBe("FW-001");
  });

  it("starts fresh when stored data is from the old single-queue version", () => {
    const old = { version: 7, day: "2026-10-22", settings: { counters: 1, graceMinutes: 10, timezone: "Asia/Dhaka", services: [] }, customers: [], seq: { W: 3, A: 1 }, lastCalls: {} } as unknown as QueueState;
    const s = upgradeState(old, at(9, 0));
    expect(s.version).toBe(8);
    expect(s.settings.protectionMinutes).toBe(30);
  });

  it("groups the public view by service, with token and initial only", () => {
    let s = walkIn(fresh(), "sadia rahman", "follow_up", at(9, 0));
    s = run(s, { type: "setPriority", id: "FW-001", reason: "Elderly" }, at(9, 0));
    s = book(s, "Hidden Booking", "follow_up", at(11, 0), at(9, 0));
    const pub = toPublicView(buildView(s, at(9, 1)));
    expect(pub.services.map((x) => x.letter)).toEqual(["C", "F", "B", "V", "P"]);
    expect(pub.services[1].waiting).toEqual([
      { token: "FW-001", initial: "S.", position: 1, waitLabel: "Due now", lateConverted: false },
    ]);
    const text = JSON.stringify(pub);
    expect(text).not.toContain("rahman");
    expect(text).not.toContain("FA-001");
    expect(text).not.toContain("Elderly");
  });
});
