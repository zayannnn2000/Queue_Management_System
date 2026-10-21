import { SIGNED_OUT, requestIsStaff } from "@/lib/auth";
import { buildView, toPublicView } from "@/lib/queue";
import { loadState, storageKind } from "@/lib/store";

// GET /api/state             → full staff view (staff PIN session required when a PIN is set)
// GET /api/state?view=public → token + initial only, for the public display (always open)
export async function GET(request: Request) {
  const now = Date.now();
  const isPublic = new URL(request.url).searchParams.get("view") === "public";
  if (!isPublic && !(await requestIsStaff(request, now))) return Response.json(SIGNED_OUT, { status: 401 });
  const state = await loadState(now);
  const view = buildView(state, now);
  return Response.json(
    { view: isPublic ? toPublicView(view) : view, storage: storageKind },
    { headers: { "Cache-Control": "no-store" } },
  );
}
