"use client";

import { createContext, use, useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Action, CallRecord, QueueView } from "@/lib/queue";
import type { StorageKind } from "@/lib/store";

export const POLL_MS = 3000;

type StaffAction = Action | { type: "seed" };

export type ActionOutcome =
  | {
      ok: true;
      message: string | null;
      called: CallRecord | null;
      /** Token issued by addWalkIn / book. */
      issued: string | null;
    }
  | { ok: false; error: string };

export interface Notice {
  kind: "ok" | "error";
  text: string;
  at: number;
}

interface QueueContextValue {
  state: {
    view: QueueView;
    storage: StorageKind;
    notice: Notice | null;
    lastCall: CallRecord | null;
    stale: boolean;
  };
  actions: {
    /** Runs a staff action on the server. Never rejects: failures resolve with `ok: false`. */
    run: (action: StaffAction) => Promise<ActionOutcome>;
    dismiss: () => void;
  };
  meta: { pending: boolean };
}

const QueueContext = createContext<QueueContextValue | null>(null);

export function useQueue(): QueueContextValue {
  const ctx = use(QueueContext);
  if (!ctx) throw new Error("useQueue must be used inside <QueueProvider>.");
  return ctx;
}

/** Holds the staff view, polls it every 3 s, and applies actions through /api/action. */
export function QueueProvider({
  initial,
  storage,
  children,
}: {
  initial: QueueView;
  storage: StorageKind;
  children: React.ReactNode;
}) {
  const [view, setView] = useState(initial);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastCall, setLastCall] = useState<CallRecord | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.hidden || inFlight.current > 0) return;
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { view: QueueView };
        if (!cancelled && inFlight.current === 0) {
          setView(data.view);
          setStale(false);
        }
      } catch {
        if (!cancelled) setStale(true);
      }
    };
    const id = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  const run = useCallback((action: StaffAction) => {
    inFlight.current++;
    return new Promise<ActionOutcome>((resolve) => {
      startTransition(async () => {
        try {
          const res = await fetch("/api/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action),
          });
          const data = await res.json();
          if (!data.ok) {
            setNotice({ kind: "error", text: data.error, at: Date.now() });
            resolve({ ok: false, error: data.error });
            return;
          }
          setView(data.view);
          setStale(false);
          if (data.called) setLastCall(data.called);
          if (data.message) setNotice({ kind: "ok", text: data.message, at: Date.now() });
          resolve({ ok: true, message: data.message, called: data.called, issued: data.issued ?? null });
        } catch {
          const error = "Couldn't reach the server. Check the connection and try again.";
          setNotice({ kind: "error", text: error, at: Date.now() });
          resolve({ ok: false, error });
        } finally {
          inFlight.current--;
        }
      });
    });
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);

  return (
    <QueueContext
      value={{
        state: { view, storage, notice, lastCall, stale },
        actions: { run, dismiss },
        meta: { pending },
      }}
    >
      {children}
    </QueueContext>
  );
}
