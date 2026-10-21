import { buildView, toPublicView } from "@/lib/queue";
import { loadState, storageKind } from "@/lib/store";

// GET /api/state          → full staff view
// GET /api/state?view=public → token + initial only, for the public display
export async function GET(request: Request) {
  const now = Date.now();
  const state = await loadState(now);
  const view = buildView(state, now);
  const isPublic = new URL(request.url).searchParams.get("view") === "public";
  return Response.json(
    { view: isPublic ? toPublicView(view) : view, storage: storageKind },
    { headers: { "Cache-Control": "no-store" } },
  );
}
