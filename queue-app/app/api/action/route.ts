import { SIGNED_OUT, requestIsStaff } from "@/lib/auth";
import { type Action, QueueError, applyAction, buildView } from "@/lib/queue";
import { buildSeedState } from "@/lib/seed";
import { mutate, storageKind } from "@/lib/store";

type Body = Action | { type: "seed" };

// POST /api/action  { type, ...payload } → applies one staff action atomically.
export async function POST(request: Request) {
  if (!(await requestIsStaff(request, Date.now()))) return Response.json(SIGNED_OUT, { status: 401 });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const now = Date.now();
  try {
    const t0 = performance.now();
    const result = await mutate(now, (state) =>
      body.type === "seed"
        ? {
            state: buildSeedState(now, state.settings, state.version + 1),
            message: "Sample day loaded (fictional patients).",
          }
        : applyAction(state, body, now),
    );
    const t1 = performance.now();
    const issued =
      body.type === "addWalkIn" || body.type === "book" ? (result.state.customers.at(-1)?.token ?? null) : null;
    const view = buildView(result.state, now);
    const t2 = performance.now();
    return Response.json(
      {
        ok: true,
        message: result.message ?? null,
        called: "called" in result ? (result.called ?? null) : null,
        issued,
        view,
        storage: storageKind,
      },
      // Server-Timing: read + apply + write, then the view (browser dev tools show it under Timing).
      { headers: { "Server-Timing": `db;dur=${(t1 - t0).toFixed(1)}, view;dur=${(t2 - t1).toFixed(1)}` } },
    );
  } catch (err) {
    if (err instanceof QueueError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error(err);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
