import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, applyAction, buildView, capacityWarnings } from "../lib/queue";
import { buildSeedState } from "../lib/seed";

const now = Date.UTC(2026, 9, 21, 4, 12); // 10:12 in Dhaka

describe("seed data", () => {
  const s = buildSeedState(now, DEFAULT_SETTINGS, 1);

  it("covers every state the demo needs", () => {
    const count = (status: string) => s.customers.filter((c) => c.status === status).length;
    expect(s.customers).toHaveLength(10);
    expect([count("served"), count("serving"), count("waiting"), count("booked")]).toEqual([3, 1, 4, 2]);
    const view = buildView(s, now);
    expect(view.booked.map((b) => b.overdue)).toEqual([true, false]);
    expect(view.waiting.map((w) => w.position)).toEqual([1, 2, 3, 4]);
  });

  it("respects booking capacity and continues issuing tokens", () => {
    expect(capacityWarnings(s)).toEqual([]);
    const next = applyAction(s, { type: "addWalkIn", name: "Test Patient", service: "follow_up" }, now);
    expect(next.state.customers.at(-1)!.token).toBe("W-008");
  });
});
