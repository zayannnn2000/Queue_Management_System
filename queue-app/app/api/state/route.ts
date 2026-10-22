import { SIGNED_OUT, requestIsStaff } from "@/lib/auth";
import { buildView, toPublicView } from "@/lib/queue";
import { loadState, storageKind } from "@/lib/store";

// GET /api/state             → full staff view (staff PIN session required when a PIN is set)
// GET /api/state?view=public → token + initial only, for the public display (always open)
export async function GET(request: Request) {
  const now = Date.now();
  const isPublic = new URL(request.url).searchParams.get("view") === "public";
  if (!isPublic && !(await requestIsStaff(request, now))) return Response.json(SIGNED_OUT, { status: 401 });
  const t0 = performance.now();
  const state = await loadState(now);
  const t1 = performance.now();
  const view = buildView(state, now);
  const t2 = performance.now();
  return Response.json(
    { view: isPublic ? toPublicView(view) : view, storage: storageKind },
    // Server-Timing: where the time goes (browser dev tools show it under Timing).
    { headers: { "Cache-Control": "no-store", "Server-Timing": `db;dur=${(t1 - t0).toFixed(1)}, view;dur=${(t2 - t1).toFixed(1)}` } },
  );
}
