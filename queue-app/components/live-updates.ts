"use client";

// Real-time nudges from Supabase: every queue write bumps the clinic row's version, and Supabase
// Realtime pushes that change to every open screen, which then refetches through its own API (the
// staff view behind the PIN, or the public view). The clinic row holds no patient data, and it is
// the only table the browser's key may read. Without Supabase settings, screens just poll.

import { useEffect, useEffectEvent, useState } from "react";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** While pushes arrive, polling only refreshes the time-based waits. */
export const LIVE_POLL_MS = 15_000;

/** Calls `onChange` whenever the queue changes; returns true while the live connection is up. */
export function useQueueChanges(onChange: () => void): boolean {
  const [live, setLive] = useState(false);
  const changed = useEffectEvent(onChange);

  useEffect(() => {
    if (!URL || !KEY) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    // Loaded after the page is interactive, so the realtime client never delays the first paint.
    import("@supabase/supabase-js").then(({ createClient }) => {
      if (cancelled) return;
      const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const channel = client
        .channel("clinic-version")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "clinic" }, () => changed())
        .subscribe((status) => {
          setLive(status === "SUBSCRIBED");
          // Reconnected after a gap: catch up on anything missed.
          if (status === "SUBSCRIBED") changed();
        });
      stop = () => void client.removeChannel(channel);
    });
    return () => {
      cancelled = true;
      stop?.();
      setLive(false);
    };
  }, []);

  return live;
}
