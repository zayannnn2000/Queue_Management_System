import { describe, expect, it } from "vitest";
import {
  type Action,
  type QueueState,
  applyAction,
  buildView,
  capacityWarnings,
  createState,
  DEFAULT_SETTINGS,
  expectedDuration,
  formatWait,
  QueueError,
  rolloverIfNewDay,
  simulate,
  toPublicView,
} from "../lib/queue";
import { MINUTE } from "../lib/time";

// 21 Oct 2026 in Asia/Dhaka (UTC+6). All names are fictional.
const at = (h: number, m: number) => Date.UTC(2026, 9, 21, h - 6, m);

function run(state: QueueState, action: Action, now: number): QueueState {
  return applyAction(state, action, now).state;
}

function fresh(counters = 1): QueueState {
  return createState(at(8, 0), { ...DEFAULT_SETTINGS, counters });
}

function waitOf(state: QueueState, token: string, now: number) {
  return simulate(state, now).find((p) => p.id === token)!;
}

function serving(state: QueueState, counter = 1) {
  return state.customers.find((c) => c.status === "serving" && c.counter === counter);
}

describe("call next", () => {
  it("serves pure walk-ins first in, first out", () => {
    let s = fresh();
    s = run(s, { type: "addWalkIn", name: "Tanvir Hasan", service: "follow_up" }, at(9, 0));
    s = run(s, { type: "addWalkIn", name: "Mitu Akter", service: "follow_up" }, at(9, 5));
    s = run(s, { type: "addWalkIn", name: "Rafi Chowdhury", service: "follow_up" }, at(9, 10));

    const order: string[] = [];
    for (const t of [at(9, 15), at(9, 25), at(9, 35)]) {
      s = run(s, { type: "callNext", counter: 1 }, t);
      order.push(serving(s)!.token);
      s = run(s, { type: "serve", counter: 1 }, t + 10 * MINUTE);
    }
    expect(order).toEqual(["W-001", "W-002", "W-003"]);
  });

  it("calls a due appointment before a walk-in who arrived earlier", () => {
    let s = fresh();
    s = run(s, { type: "book", name: "Nadia Islam", service: "consultation", scheduledAt: at(10, 0) }, at(8, 30));
    s = run(s, { type: "addWalkIn", name: "Karim Uddin", service: "consultation" }, at(10, 2));
    s = run(s, { type: "checkIn", id: "A-001" }, at(10, 5)); // within the 10-min grace

    const r = applyAction(s, { type: "callNext", counter: 1 }, at(10, 6));
    expect(r.called!.token).toBe("A-001");
    expect(r.called!.reason).toContain("appointment at 10:00");
  });

  it("makes an early appointment wait for its slot", () => {
    let s = fresh();
    s = run(s, { type: "book", name: "Shirin Begum", service: "blood_test", scheduledAt: at(10, 30) }, at(8, 30));
    s = run(s, { type: "checkIn", id: "A-001" }, at(10, 0));
    s = run(s, { type: "addWalkIn", name: "Jamal Sarker", service: "consultation" }, at(10, 5));

    const r = applyAction(s, { type: "callNext", counter: 1 }, at(10, 10));
    expect(r.called!.token).toBe("W-001");
    // A-001 is projected after the walk-in, not before.
    expect(waitOf(s, "A-001", at(10, 10)).position).toBe(2);
  });

  it("converts an appointment that arrives after the grace period into a walk-in", () => {
    let s = fresh();
    s = run(s, { type: "book", name: "Farhana Kabir", service: "consultation", scheduledAt: at(10, 0) }, at(8, 30));
    s = run(s, { type: "addWalkIn", name: "Sumon Das", service: "consultation" }, at(10, 5));
    const r = applyAction(s, { type: "checkIn", id: "A-001" }, at(10, 11));
    s = r.state;

    const appt = s.customers.find((c) => c.id === "A-001")!;
    expect(appt.lateConverted).toBe(true);
    expect(appt.token).toBe("A-001"); // keeps its token
    expect(r.message).toContain("walk-in");
    expect(applyAction(s, { type: "callNext", counter: 1 }, at(10, 12)).called!.token).toBe("W-001");
  });

  it("treats arrival exactly at the end of the grace period as on time", () => {
    let s = fresh();
    s = run(s, { type: "book", name: "Rina Paul", service: "consultation", scheduledAt: at(10, 0) }, at(8, 30));
    s = run(s, { type: "checkIn", id: "A-001" }, at(10, 10));
    expect(s.customers[0].lateConverted).toBe(false);
  });

  it("breaks a tie in favour of the appointment", () => {
    let s = fresh();
    s = run(s, { type: "book", name: "Laila Haque", service: "vaccination", scheduledAt: at(10, 0) }, at(8, 30));
    s = run(s, { type: "checkIn", id: "A-001" }, at(9, 50));
    s = run(s, { type: "addWalkIn", name: "Arif Mia", service: "vaccination" }, at(10, 0));

    const r = applyAction(s, { type: "callNext", counter: 1 }, at(10, 1));
    expect(r.called!.token).toBe("A-001");
    expect(r.called!.reason).toContain("appointment goes first");
  });

  it("breaks a tie between two appointments by lower token number", () => {
    let s = fresh(2);
    s = run(s, { type: "book", name: "Mahin Alam", service: "vaccination", scheduledAt: at(10, 0) }, at(8, 30));
    s = run(s, { type: "book", name: "Tania Sultana", service: "vaccination", scheduledAt: at(10, 0) }, at(8, 31));
    s = run(s, { type: "checkIn", id: "A-002" }, at(9, 50));
    s = run(s, { type: "checkIn", id: "A-001" }, at(9, 55));

    const r = applyAction(s, { type: "callNext", counter: 1 }, at(10, 0));
    expect(r.called!.token).toBe("A-001");
    expect(r.called!.reason).toContain("lower token number");
  });

  it("uses two counters in parallel and projects the next free one", () => {
    let s = fresh(2);
    s = run(s, { type: "addWalkIn", name: "Hasib Reza", service: "consultation" }, at(9, 0));
    s = run(s, { type: "addWalkIn", name: "Puja Sen", service: "consultation" }, at(9, 1));
    s = run(s, { type: "addWalkIn", name: "Omar Faruk", service: "consultation" }, at(9, 2));
    s = run(s, { type: "callNext", counter: 1 }, at(9, 3));
    s = run(s, { type: "callNext", counter: 2 }, at(9, 4));

    expect(serving(s, 1)!.token).toBe("W-001");
    expect(serving(s, 2)!.token).toBe("W-002");
    // Counter 1 frees at 9:03 + 15 = 9:18, i.e. 13 min after 9:05.
    const w3 = waitOf(s, "W-003", at(9, 5));
    expect(w3).toMatchObject({ position: 1, counter: 1, waitMs: 13 * MINUTE });
  });

  it("updates the wait estimate after a service finishes", () => {
    let s = fresh();
    for (const name of ["Sabbir Khan", "Nusrat Jahan", "Imran Hossain"]) {
      s = run(s, { type: "addWalkIn", name, service: "consultation" }, at(9, 0));
    }
    s = run(s, { type: "callNext", counter: 1 }, at(9, 0));

    // No data yet: 15-min default. W-002 waits 10 min, W-003 waits 25 min.
    expect(waitOf(s, "W-002", at(9, 5)).waitMs).toBe(10 * MINUTE);
    expect(waitOf(s, "W-003", at(9, 5)).waitMs).toBe(25 * MINUTE);

    // W-001 actually took 5 min; that sample now drives the estimate.
    s = run(s, { type: "serve", counter: 1, callNext: true }, at(9, 5));
    expect(serving(s)!.token).toBe("W-002");
    expect(expectedDuration(s.customers, s.settings, "consultation")).toEqual({ ms: 5 * MINUTE, samples: 1 });
    expect(waitOf(s, "W-003", at(9, 5)).waitMs).toBe(5 * MINUTE);
  });

  it("calls a future appointment when it is the only one waiting (idle-fill)", () => {
    let s = fresh();
    s = run(s, { type: "book", name: "Zara Ahmed", service: "follow_up", scheduledAt: at(11, 0) }, at(8, 30));
    s = run(s, { type: "checkIn", id: "A-001" }, at(10, 0));

    expect(waitOf(s, "A-001", at(10, 0)).waitMs).toBe(0); // simulation mirrors idle-fill
    const r = applyAction(s, { type: "callNext", counter: 1 }, at(10, 0));
    expect(r.called!.token).toBe("A-001");
    expect(r.called!.reason).toContain("called early");
  });

  it("leaves the counter idle when nobody is checked in", () => {
    let s = fresh();
    s = run(s, { type: "book", name: "Rubel Mondal", service: "follow_up", scheduledAt: at(9, 0) }, at(8, 30));
    const r = applyAction(s, { type: "callNext", counter: 1 }, at(9, 0));
    expect(r.called).toBeUndefined();
    expect(r.message).toContain("stays idle");
    expect(r.state).toBe(s);
  });

  it("refuses to call next while the counter is still serving", () => {
    let s = fresh();
    s = run(s, { type: "addWalkIn", name: "Shakil Ahmed", service: "follow_up" }, at(9, 0));
    s = run(s, { type: "addWalkIn", name: "Moni Roy", service: "follow_up" }, at(9, 1));
    s = run(s, { type: "callNext", counter: 1 }, at(9, 2));
    expect(() => applyAction(s, { type: "callNext", counter: 1 }, at(9, 3))).toThrow(QueueError);
  });
});

describe("booking", () => {
  const book = (s: QueueState, hh: number, mm: number, now = at(8, 30)) =>
    run(s, { type: "book", name: "Fahim Noor", service: "consultation", scheduledAt: at(hh, mm) }, now);

  it("rejects overlapping appointments with one counter and names the clash", () => {
    const s = book(fresh(), 10, 0);
    expect(() => book(s, 10, 10)).toThrow("10:10–10:25 clashes with A-001 (10:00)");
    expect(() => book(s, 10, 15)).not.toThrow(); // back-to-back is fine
  });

  it("allows overlaps up to the number of counters", () => {
    let s = book(fresh(2), 10, 0);
    s = book(s, 10, 5);
    expect(() => book(s, 10, 10)).toThrow(QueueError);
  });

  it("rejects past, off-slot and other-day times", () => {
    const s = fresh();
    expect(() => book(s, 8, 0, at(8, 30))).toThrow("walk-in");
    expect(() => run(s, { type: "book", name: "X", service: "consultation", scheduledAt: at(10, 3) }, at(8, 30))).toThrow(
      "5-minute",
    );
    expect(() => book(s, 30, 0)).toThrow("today");
  });

  it("re-checks capacity when an appointment is edited", () => {
    let s = book(fresh(), 10, 0);
    s = book(s, 11, 0);
    expect(() => run(s, { type: "edit", id: "A-002", scheduledAt: at(10, 5) }, at(9, 0))).toThrow("clashes");
    s = run(s, { type: "edit", id: "A-002", scheduledAt: at(10, 30), name: "Fahim N." }, at(9, 0));
    expect(s.customers[1]).toMatchObject({ scheduledAt: at(10, 30), name: "Fahim N.", token: "A-002" });
  });

  it("re-evaluates lateness when a checked-in appointment's time is edited", () => {
    let s = book(fresh(), 10, 0);
    s = run(s, { type: "checkIn", id: "A-001" }, at(10, 5));
    s = run(s, { type: "edit", id: "A-001", scheduledAt: at(9, 30) }, at(10, 6));
    expect(s.customers[0].lateConverted).toBe(true);
  });

  it("blocks edits once the customer has been called", () => {
    let s = run(fresh(), { type: "addWalkIn", name: "Dipa Rani", service: "follow_up" }, at(9, 0));
    s = run(s, { type: "callNext", counter: 1 }, at(9, 1));
    expect(() => run(s, { type: "edit", id: "W-001", name: "Dipa R." }, at(9, 2))).toThrow(QueueError);
  });

  it("warns but keeps bookings when counters are reduced", () => {
    let s = book(fresh(2), 10, 0);
    s = book(s, 10, 5);
    s = run(s, { type: "updateSettings", counters: 1 }, at(9, 0));
    expect(s.customers.filter((c) => c.status === "booked")).toHaveLength(2);
    expect(capacityWarnings(s)).toHaveLength(2);
  });

  it("flags overdue bookings and lets staff mark them no-show", () => {
    let s = book(fresh(), 10, 0);
    expect(buildView(s, at(10, 10)).booked[0].overdue).toBe(false);
    expect(buildView(s, at(10, 11)).booked[0].overdue).toBe(true);
    s = run(s, { type: "noShow", id: "A-001" }, at(10, 30));
    expect(s.customers[0].status).toBe("no_show");
  });
});

describe("wait estimate", () => {
  it("formats waits as Due now or ~X min rounded up to 5", () => {
    expect(formatWait(0)).toBe("Due now");
    expect(formatWait(2 * MINUTE)).toBe("Due now");
    expect(formatWait(2.5 * MINUTE)).toBe("~5 min");
    expect(formatWait(5 * MINUTE)).toBe("~5 min");
    expect(formatWait(5.1 * MINUTE)).toBe("~10 min");
    expect(formatWait(12 * MINUTE)).toBe("~15 min");
  });

  it("averages the last 5 served durations, clamped, ignoring no-shows", () => {
    let s = fresh();
    // Durations in minutes: 60 (clamped to 3 × 5 = 15), then 2, 4, 6, 8, 10; plus a no-show.
    const durations = [60, 2, 4, 6, 8, 10];
    let t = at(9, 0);
    for (const d of durations) {
      s = run(s, { type: "addWalkIn", name: "Sample Patient", service: "blood_test" }, t);
      s = run(s, { type: "callNext", counter: 1 }, t);
      s = run(s, { type: "serve", counter: 1 }, t + d * MINUTE);
      t += d * MINUTE;
    }
    s = run(s, { type: "addWalkIn", name: "No Show", service: "blood_test" }, t);
    s = run(s, { type: "callNext", counter: 1 }, t);
    s = run(s, { type: "noShow", id: serving(s)!.id }, t + 30 * MINUTE);

    // Last five served: 2, 4, 6, 8, 10 → mean 6 (the clamped 60 is the oldest, so dropped).
    expect(expectedDuration(s.customers, s.settings, "blood_test")).toEqual({ ms: 6 * MINUTE, samples: 5 });
  });

  it("assumes at least 1 more minute for an overrunning service", () => {
    let s = run(fresh(), { type: "addWalkIn", name: "Kamal Hossain", service: "vaccination" }, at(9, 0));
    s = run(s, { type: "addWalkIn", name: "Ruma Khatun", service: "vaccination" }, at(9, 0));
    s = run(s, { type: "callNext", counter: 1 }, at(9, 0));
    expect(waitOf(s, "W-002", at(9, 20)).waitMs).toBe(MINUTE);
  });
});

describe("documentation worked example", () => {
  // docs/documentation.html §4: 1 counter, now 10:00, current patient expected to finish at 10:06.
  // The current patient takes W-001 here, so the document's W-001 / W-002 are W-002 / W-003 below.
  function scenario(w2Arrival: number) {
    let s = fresh();
    s = run(s, { type: "book", name: "Lamia Haque", service: "follow_up", scheduledAt: at(10, 5) }, at(8, 30));
    s = run(s, { type: "addWalkIn", name: "Current Patient", service: "consultation" }, at(9, 40));
    s = run(s, { type: "callNext", counter: 1 }, at(9, 51)); // 15-min default → expected end 10:06
    s = run(s, { type: "addWalkIn", name: "Sohel Rana", service: "consultation" }, at(9, 50));
    s = run(s, { type: "checkIn", id: "A-001" }, at(9, 55));
    s = run(s, { type: "addWalkIn", name: "Tania Akter", service: "vaccination" }, w2Arrival);
    return buildView(s, at(10, 0)).waiting.map((w) => [w.token, w.waitMs / MINUTE, w.waitLabel]);
  }

  it("matches the table", () => {
    expect(scenario(at(9, 58))).toEqual([
      ["W-002", 6, "~10 min"],
      ["W-003", 21, "~25 min"],
      ["A-001", 26, "~30 min"],
    ]);
  });

  it("calls the appointment first when the walk-in's target is later", () => {
    expect(scenario(at(10, 8)).map(([token]) => token)).toEqual(["W-002", "A-001", "W-003"]);
  });
});

describe("day and display", () => {
  it("resets tokens on a new clinic-local day", () => {
    let s = run(fresh(), { type: "addWalkIn", name: "Arman Ali", service: "follow_up" }, at(9, 0));
    expect(rolloverIfNewDay(s, at(23, 59))).toBe(s);
    s = rolloverIfNewDay(s, at(24, 0)); // midnight in Dhaka
    expect(s.customers).toHaveLength(0);
    s = run(s, { type: "addWalkIn", name: "Arman Ali", service: "follow_up" }, at(24, 30));
    expect(s.customers[0].token).toBe("W-001");
  });

  it("shows only token and initial publicly, and hides booked appointments", () => {
    let s = run(fresh(), { type: "addWalkIn", name: "sadia rahman", service: "follow_up" }, at(9, 0));
    s = run(s, { type: "book", name: "Hidden Booking", service: "follow_up", scheduledAt: at(11, 0) }, at(9, 0));
    const pub = toPublicView(buildView(s, at(9, 1)));
    expect(pub.waiting).toEqual([
      { token: "W-001", initial: "S.", position: 1, waitLabel: "Due now", lateConverted: false },
    ]);
    expect(JSON.stringify(pub)).not.toContain("rahman");
    expect(JSON.stringify(pub)).not.toContain("A-001");
  });
});
