// Server-only loaders for the pages: read the clock once per request, then build the view.

import "server-only";
import { type QueueView, buildView } from "./queue";
import { loadState } from "./store";

export async function currentView(): Promise<QueueView> {
  const now = Date.now();
  return buildView(await loadState(now), now);
}
