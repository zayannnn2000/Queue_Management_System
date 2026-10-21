"use client";

import { useState } from "react";

/** Signs this device out of the front desk (the PIN is needed again). */
export function LockButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/logout", { method: "POST" }).catch(() => null);
        // Full load on purpose: drops every cached staff page so nothing stays on screen after locking.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login");
      }}
      className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm text-muted transition-colors hover:bg-active hover:text-ink disabled:opacity-60 ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="7" width="10" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      Lock
    </button>
  );
}
