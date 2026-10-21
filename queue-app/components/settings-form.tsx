"use client";

import { useState } from "react";
import { MAX_COUNTERS } from "@/lib/queue";
import { useQueue } from "./queue-provider";
import { DangerTextButton, Field, PrimaryButton, SecondaryButton, inputClass } from "./ui";

export function SettingsView() {
  const { state } = useQueue();
  const { notice } = state;
  return (
    <div className="px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <h1 className="font-display text-[24px] leading-7 font-semibold sm:text-[32px] sm:leading-9 tracking-[-0.01em]">Settings</h1>
      <p className="mt-1 text-[15px] text-muted">Counters, grace period and service times for today&apos;s queue.</p>
      <div role="status" aria-live="polite" className="mt-3 min-h-8">
        {notice ? (
          <p
            className={`inline-block rounded-md px-3 py-1.5 text-sm ${
              notice.kind === "error" ? "bg-bad-bg text-bad-ink" : "bg-raised text-ink"
            }`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-col">
        <QueueSettings />
        <SampleData />
      </div>
    </div>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b border-border py-8 first:pt-2 last:border-0 lg:grid-cols-[minmax(0,360px)_minmax(0,640px)] lg:gap-12">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <div className="mt-1 text-sm text-muted">{description}</div>
      </div>
      <div className="rounded-2xl bg-raised p-4">{children}</div>
    </section>
  );
}

function QueueSettings() {
  const { state, actions, meta } = useQueue();
  const { settings, warnings } = state.view;
  const [counters, setCounters] = useState(settings.counters);
  const [grace, setGrace] = useState(settings.graceMinutes);
  const [durations, setDurations] = useState<Record<string, number>>(() =>
    Object.fromEntries(settings.services.map((s) => [s.id, s.defaultMinutes])),
  );

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    actions.run({ type: "updateSettings", counters, graceMinutes: grace, durations });
  };

  return (
    <SettingsRow
      title="Queue rules"
      description={
        <>
          <p>
            Service times are the starting estimate. Once patients are served, the wait uses the average of the last 5
            real visits instead.
          </p>
          <p className="mt-2">Reducing counters never cancels bookings; any overlap is listed here.</p>
        </>
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Counters open" htmlFor="set-counters">
            <select
              id="set-counters"
              className={inputClass}
              value={counters}
              onChange={(e) => setCounters(Number(e.target.value))}
            >
              {Array.from({ length: MAX_COUNTERS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Grace period (minutes)" htmlFor="set-grace" hint="Later than this, an appointment joins as a walk-in.">
            <input
              id="set-grace"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              className={`${inputClass} num`}
              value={grace}
              onChange={(e) => setGrace(Number(e.target.value))}
            />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Default service time (minutes)</legend>
          {settings.services.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <label htmlFor={`dur-${s.id}`} className="flex-1 text-sm">
                {s.name}
              </label>
              <input
                id={`dur-${s.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                className={`${inputClass} num w-24 text-right`}
                value={durations[s.id]}
                onChange={(e) => setDurations((d) => ({ ...d, [s.id]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </fieldset>
        {warnings.length > 0 ? (
          <div className="rounded-md border border-[#fde68a] bg-warn-bg px-3 py-2 text-sm text-warn-ink">
            <p className="font-medium">More overlapping bookings than counters:</p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <PrimaryButton type="submit" disabled={meta.pending} className="self-end">
          Save settings
        </PrimaryButton>
      </form>
    </SettingsRow>
  );
}

function SampleData() {
  const { state, actions, meta } = useQueue();
  const { storage } = state;
  return (
    <SettingsRow
      title="Today's data"
      description={
        <>
          <p>
            Stored in{" "}
            {storage === "redis" ? "Upstash Redis, shared by every screen." : "this server's memory (demo mode). Restarting clears it."}
          </p>
          <p className="mt-2">Tokens restart at W-001 and A-001 each day in Dhaka time.</p>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SecondaryButton
            disabled={meta.pending}
            onClick={() => {
              if (window.confirm("Replace today's queue with the fictional sample day?")) actions.run({ type: "seed" });
            }}
          >
            Load sample day
          </SecondaryButton>
          <p className="text-sm text-muted">10 fictional patients, times relative to now.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DangerTextButton
            className="h-8 border border-negative/40"
            disabled={meta.pending}
            onClick={() => {
              if (window.confirm("Reset the day? Every patient, booking and token for today is cleared.")) {
                actions.run({ type: "resetDay" });
              }
            }}
          >
            Reset day
          </DangerTextButton>
          <p className="text-sm text-muted">Clears today&apos;s queue and restarts tokens. Settings are kept.</p>
        </div>
      </div>
    </SettingsRow>
  );
}
