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
    const result = await mutate(now, (state) =>
      body.type === "seed"
        ? {
            state: buildSeedState(now, state.settings, state.version + 1),
            message: "Sample day loaded (fictional patients).",
          }
        : applyAction(state, body, now),
    );
    const issued =
      body.type === "addWalkIn" || body.type === "book" ? (result.state.customers.at(-1)?.token ?? null) : null;
    return Response.json({
      ok: true,
      message: result.message ?? null,
      called: "called" in result ? (result.called ?? null) : null,
      issued,
      view: buildView(result.state, now),
      storage: storageKind,
    });
  } catch (err) {
    if (err instanceof QueueError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error(err);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
