import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, applyAction, buildView, capacityWarnings, toPublicView } from "../lib/queue";
import { buildSeedState } from "../lib/seed";

const now = Date.UTC(2026, 9, 22, 4, 12); // 10:12 in Dhaka

describe("seed data", () => {
  const s = buildSeedState(now, DEFAULT_SETTINGS, 1);

  it("covers every state the demo needs, across the five queues", () => {
    const count = (status: string) => s.customers.filter((c) => c.status === status).length;
    expect([count("served"), count("serving"), count("waiting"), count("booked")]).toEqual([4, 2, 7, 2]);
    const view = buildView(s, now);
    expect(view.booked.map((b) => b.overdue)).toEqual([true, false]);
    expect(new Set(view.waiting.map((w) => w.service))).toEqual(new Set(["consultation", "follow_up", "blood_test", "prescription"]));
    // The priority patient is first in Follow-up.
    expect(view.waiting.find((w) => w.priority)).toMatchObject({ service: "follow_up", position: 1 });
    expect(toPublicView(view).services).toHaveLength(5);
  });

  it("respects booking capacity and continues each token sequence", () => {
    expect(capacityWarnings(s)).toEqual([]);
    const next = applyAction(s, { type: "addWalkIn", name: "Test Patient", service: "consultation" }, now);
    expect(next.state.customers.at(-1)!.token).toBe("CW-006");
  });

  it("skips removed services and leaves added ones empty", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      services: [
        ...DEFAULT_SETTINGS.services.filter((x) => x.id !== "blood_test"),
        { id: "dental", name: "Dental", letter: "D", defaultMinutes: 20, rooms: 1, color: "green" },
      ],
    };
    const seeded = buildSeedState(now, settings, 1);
    expect(seeded.customers.some((c) => c.service === "blood_test")).toBe(false);
    expect(Object.keys(seeded.seq).some((k) => k.startsWith("B") || k === "?")).toBe(false);
    expect(buildView(seeded, now).rooms.find((r) => r.serviceId === "dental")?.current).toBeNull();
  });
});
