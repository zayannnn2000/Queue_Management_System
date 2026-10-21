"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { safeNext } from "@/lib/auth";
import { HygieiaMark } from "./brand";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

/** Staff PIN screen: a real password field for keyboards, and a keypad for touch screens. */
export function PinLogin() {
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const press = (key: (typeof KEYS)[number]) => {
    setError(null);
    if (key === "clear") setPin("");
    else if (key === "back") setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 8 ? p + key : p));
    input.current?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        window.location.assign(safeNext(params.get("next")));
        return;
      }
      setError(data.error ?? "That PIN isn't right.");
      setPin("");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-[380px] rounded-2xl border border-border bg-surface px-7 pt-9 pb-7 text-center"
        aria-labelledby="login-title"
      >
        <div className="flex justify-center">
          <HygieiaMark size={72} />
        </div>
        <p className="mt-3 font-display text-[40px] leading-10 font-semibold tracking-[-0.01em]">Hygieia</p>
        <p className="mt-1.5 text-sm text-muted">Wellness Clinic</p>

        <h1 id="login-title" className="mt-7 text-base font-semibold">
          Front desk sign-in
        </h1>
        <p className="mt-1 text-sm text-muted">Enter the staff PIN to open the queue.</p>

        <label htmlFor="staff-pin" className="sr-only">
          Staff PIN
        </label>
        <input
          ref={input}
          id="staff-pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          pattern="\d{4,8}"
          maxLength={8}
          required
          autoFocus
          value={pin}
          onChange={(e) => {
            setError(null);
            setPin(e.target.value.replace(/\D/g, "").slice(0, 8));
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pin-error" : undefined}
          className="mt-5 h-14 w-full rounded-full border border-control bg-raised text-center font-token text-2xl tracking-[0.5em] text-ink"
        />

        <p id="pin-error" role="alert" className={error ? "mt-3 text-sm font-medium text-negative" : "sr-only"}>
          {error ?? ""}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2.5" aria-label="Keypad">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              aria-label={key === "back" ? "Delete last digit" : key === "clear" ? "Clear PIN" : undefined}
              className={`h-14 rounded-full text-lg font-semibold transition-[background-color,transform] active:translate-y-px ${
                key === "clear" || key === "back"
                  ? "text-sm text-muted hover:bg-active"
                  : "bg-raised text-ink hover:bg-active"
              }`}
            >
              {key === "back" ? "Delete" : key === "clear" ? "Clear" : key}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={busy || pin.length < 4}
          className="mt-6 h-12 w-full rounded-full bg-primary text-base font-semibold text-white transition-[background-color,transform] hover:bg-black active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
        <p className="mt-5 text-xs text-muted">The waiting-room display stays open to everyone.</p>
      </form>
    </main>
  );
}
