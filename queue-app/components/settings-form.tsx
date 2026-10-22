"use client";

import { useState } from "react";
import { MAX_ROOMS, MAX_SERVICES, MAX_SERVICE_NAME_LENGTH, suggestLetter } from "@/lib/queue";
import { FormError } from "./customer-form";
import { useQueue } from "./queue-provider";
import { serviceColor } from "./service-colors";
import { DangerTextButton, Field, PrimaryButton, SecondaryButton, inputClass } from "./ui";

export function SettingsView() {
  const { state } = useQueue();
  const { notice } = state;
  return (
    <div className="px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <h1 className="font-display text-[24px] leading-7 font-semibold sm:text-[32px] sm:leading-9 tracking-[-0.01em]">Settings</h1>
      <p className="mt-1 text-[15px] text-muted">Queue rules, services and rooms, and today&apos;s data.</p>
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
        <Departments />
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
  const [grace, setGrace] = useState(settings.graceMinutes);
  const [protection, setProtection] = useState(settings.protectionMinutes);
  const [durations, setDurations] = useState<Record<string, number>>(() =>
    Object.fromEntries(settings.services.map((s) => [s.id, s.defaultMinutes])),
  );
  const [rooms, setRooms] = useState<Record<string, number>>(() =>
    Object.fromEntries(settings.services.map((s) => [s.id, s.rooms])),
  );

  // Services can be added or removed below, so send (and show) only the ones that exist now.
  const current = (values: Record<string, number>, key: "defaultMinutes" | "rooms") =>
    Object.fromEntries(settings.services.map((s) => [s.id, values[s.id] ?? s[key]]));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    actions.run({
      type: "updateSettings",
      graceMinutes: grace,
      protectionMinutes: protection,
      durations: current(durations, "defaultMinutes"),
      rooms: current(rooms, "rooms"),
    });
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
          <p className="mt-2">
            Each service has its own queue and room(s). Reducing rooms never cancels bookings; any overlap is listed here.
          </p>
        </>
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Walk-in protection (minutes)"
            htmlFor="set-protection"
            hint="A walk-in who has waited this long isn't pushed back by appointments. 0 turns it off."
          >
            <input
              id="set-protection"
              type="number"
              inputMode="numeric"
              min={0}
              max={240}
              className={`${inputClass} num`}
              value={protection}
              onChange={(e) => setProtection(Number(e.target.value))}
            />
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
          <legend className="mb-2 text-sm font-medium">Services: default visit length and rooms</legend>
          <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="flex-1">Service (token letter)</span>
            <span className="w-24 text-right">Minutes</span>
            <span className="w-20 text-right">Rooms</span>
          </div>
          {settings.services.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm">
                {s.name} <span className="font-token text-muted">({s.letter})</span>
              </span>
              <input
                id={`dur-${s.id}`}
                aria-label={`${s.name} visit length in minutes`}
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                className={`${inputClass} num w-24 text-right`}
                value={durations[s.id] ?? s.defaultMinutes}
                onChange={(e) => setDurations((d) => ({ ...d, [s.id]: Number(e.target.value) }))}
              />
              <input
                id={`rooms-${s.id}`}
                aria-label={`${s.name} rooms`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_ROOMS}
                className={`${inputClass} num w-20 text-right`}
                value={rooms[s.id] ?? s.rooms}
                onChange={(e) => setRooms((r) => ({ ...r, [s.id]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </fieldset>
        {warnings.length > 0 ? (
          <div className="rounded-md border border-[#fde68a] bg-warn-bg px-3 py-2 text-sm text-warn-ink">
            <p className="font-medium">More overlapping bookings than rooms:</p>
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

/** Add a service (department) with its own queue, token letter and rooms, or remove one that is idle. */
function Departments() {
  const { state, actions, meta } = useQueue();
  const { settings } = state.view;
  const [name, setName] = useState("");
  const [letter, setLetter] = useState<string | null>(null); // null = follow the suggestion
  const [minutes, setMinutes] = useState(10);
  const [roomCount, setRoomCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const shownLetter = letter ?? suggestLetter(settings, name);
  const full = settings.services.length >= MAX_SERVICES;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await actions.run({ type: "addService", name, letter: shownLetter, minutes, rooms: roomCount });
    setError(res.ok ? null : res.error);
    if (res.ok) {
      setName("");
      setLetter(null);
      setMinutes(10);
      setRoomCount(1);
    }
  };

  return (
    <SettingsRow
      title="Services and departments"
      description={
        <>
          <p>
            Each service has its own queue, rooms and token letter: Dental with letter D issues DW-001 for walk-ins and
            DA-001 for appointments. It appears on the front desk, the timeline and the waiting-room display at once.
          </p>
          <p className="mt-2">
            A service can be removed once nobody is booked, waiting or being seen for it today. Its finished patients
            stay in today&apos;s history.
          </p>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul aria-label="Services" className="flex flex-col divide-y divide-border rounded-lg bg-surface">
          {settings.services.map((s) => {
            const busy = state.view.waiting.some((w) => w.service === s.id) ||
              state.view.booked.some((b) => b.service === s.id) ||
              state.view.rooms.some((r) => r.serviceId === s.id && r.current);
            return (
              <li key={s.id} className="flex min-h-11 items-center gap-3 px-3">
                <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: serviceColor(settings, s.id).solid }} />
                <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                <span className="num text-xs text-muted">
                  <span className="font-token">{s.letter}W / {s.letter}A</span> · {s.defaultMinutes} min · {s.rooms} room
                  {s.rooms > 1 ? "s" : ""}
                </span>
                <DangerTextButton
                  className="h-7 px-2 text-xs"
                  disabled={meta.pending || settings.services.length === 1}
                  title={busy ? "Has patients today: serve, cancel or mark them no-show first" : undefined}
                  onClick={() => {
                    if (window.confirm(`Remove ${s.name}? Its queue, rooms and token letter go from every screen.`)) {
                      actions.run({ type: "removeService", id: s.id });
                    }
                  }}
                >
                  Remove<span className="sr-only"> {s.name}</span>
                </DangerTextButton>
              </li>
            );
          })}
        </ul>

        <form onSubmit={add} aria-label="Add a service" className="flex flex-col gap-3">
          <p className="text-sm font-medium">Add a service</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_88px_96px_80px]">
            <Field label="Name" htmlFor="svc-name">
              <input
                id="svc-name"
                className={inputClass}
                value={name}
                maxLength={MAX_SERVICE_NAME_LENGTH}
                placeholder="e.g. Dental"
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Letter" htmlFor="svc-letter">
              <input
                id="svc-letter"
                className={`${inputClass} font-token uppercase`}
                value={shownLetter}
                maxLength={1}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setLetter(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Minutes" htmlFor="svc-minutes">
              <input
                id="svc-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                className={`${inputClass} num text-right`}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </Field>
            <Field label="Rooms" htmlFor="svc-rooms">
              <input
                id="svc-rooms"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_ROOMS}
                className={`${inputClass} num text-right`}
                value={roomCount}
                onChange={(e) => setRoomCount(Number(e.target.value))}
              />
            </Field>
          </div>
          <FormError error={error} />
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton type="submit" disabled={meta.pending || full || name.trim() === ""}>
              Add service
            </PrimaryButton>
            <p className="text-xs text-muted">
              {full
                ? `The clinic has the maximum of ${MAX_SERVICES} services. Remove one to add another.`
                : shownLetter
                  ? `Tokens will be ${shownLetter}W-001 and ${shownLetter}A-001. Each letter can belong to one service.`
                  : "Every letter is taken."}
            </p>
          </div>
        </form>
      </div>
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
            {storage === "postgres"
              ? "Postgres (Supabase), shared by every screen; every day's visits are kept as history."
              : "this server's memory (demo mode). Restarting clears it."}
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
