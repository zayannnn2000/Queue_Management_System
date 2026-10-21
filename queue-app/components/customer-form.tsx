"use client";

import { useState } from "react";
import { MAX_NAME_LENGTH, type Settings } from "@/lib/queue";
import { slotOptions } from "./format";
import { useQueue } from "./queue-provider";
import { TokenReady } from "./token-slip";
import { Field, Panel, PrimaryButton, Token, inputClass } from "./ui";

type Kind = "walk_in" | "appointment";

/** Add a patient: a segmented switch between the walk-in and appointment forms. */
export function CustomerForm() {
  const { view } = useQueue().state;
  const [kind, setKind] = useState<Kind>("walk_in");
  const [booked, setBooked] = useState<string | null>(null);

  return (
    <Panel
      title="Add patient"
      id="add-heading"
      aside={
        <div role="group" aria-label="Booking type" className="inline-flex rounded-full bg-active p-0.5">
          {(
            [
              ["walk_in", "Walk-in"],
              ["appointment", "Appointment"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              onClick={() => setKind(id)}
              className={`h-7 rounded-full px-3.5 text-[13px] transition-colors ${
                kind === id ? "bg-primary font-semibold text-white" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="px-5 pb-4">
        {kind === "walk_in" ? (
          <WalkInForm onIssued={() => setBooked(null)} />
        ) : (
          <AppointmentForm onIssued={setBooked} />
        )}

        <TokenReady />
        {/* Only while the booking is still waiting to arrive: once checked in or cancelled it goes. */}
        {booked && view.booked.some((b) => b.token === booked) ? <BookedNote token={booked} /> : null}
      </div>
    </Panel>
  );
}

function NameAndService({
  name,
  setName,
  service,
  setService,
  prefix,
}: {
  name: string;
  setName: (v: string) => void;
  service: string;
  setService: (v: string) => void;
  prefix: string;
}) {
  const { state } = useQueue();
  const { settings, expected } = state.view;
  return (
    <>
      <Field label="Patient name" htmlFor={`${prefix}-name`}>
        <input
          id={`${prefix}-name`}
          name="name"
          className={inputClass}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          required
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Service" htmlFor={`${prefix}-service`}>
        <select
          id={`${prefix}-service`}
          name="service"
          className={inputClass}
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          {settings.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {Math.round(expected[s.id]?.minutes ?? s.defaultMinutes)} min
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function WalkInForm({ onIssued }: { onIssued: () => void }) {
  const { state, actions, meta } = useQueue();
  const [name, setName] = useState("");
  const [picked, setService] = useState(state.view.settings.services[0].id);
  const service = existingService(state.view.settings, picked);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = name;
    const res = await actions.run({ type: "addWalkIn", name: submitted, service });
    setError(res.ok ? null : res.error);
    if (res.ok && res.issued) {
      onIssued();
      // Clear only if staff haven't started typing the next patient meanwhile.
      setName((current) => (current === submitted ? "" : current));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Add walk-in">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <NameAndService name={name} setName={setName} service={service} setService={setService} prefix="walkin" />
        <PrimaryButton type="submit" disabled={meta.pending} className="h-10">
          Add walk-in
        </PrimaryButton>
      </div>
      <FormError error={error} />
      <p className="text-xs text-muted">Joins their service queue now. Their target time is their arrival.</p>
    </form>
  );
}

function AppointmentForm({ onIssued }: { onIssued: (token: string) => void }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const [name, setName] = useState("");
  const [picked, setService] = useState(view.settings.services[0].id);
  const service = existingService(view.settings, picked);
  const slots = slotOptions(view, service);
  const firstFree = slots.find((s) => !s.clash)?.value ?? slots[0]?.value ?? 0;
  const [chosen, setChosen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The picked time is kept when the service changes: fullness depends on the service, so a time is
  // never locked out or silently swapped. Only a time that has passed falls back to the first free one.
  const scheduledAt = chosen !== null && slots.some((s) => s.value === chosen) ? chosen : firstFree;
  const selectedService = view.settings.services.find((s) => s.id === service)!;
  const rooms = selectedService.rooms;
  const clash = slots.find((s) => s.value === scheduledAt)?.clash ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = name;
    const res = await actions.run({ type: "book", name: submitted, service, scheduledAt });
    setError(res.ok ? null : res.error);
    if (res.ok && res.issued) {
      onIssued(res.issued);
      setName((current) => (current === submitted ? "" : current));
      setChosen(null);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Book appointment">
      <div className="grid items-end gap-3 sm:grid-cols-2">
      <NameAndService name={name} setName={setName} service={service} setService={setService} prefix="appt" />
      <Field label="Time today" htmlFor="appt-time">
        {slots.length === 0 ? (
          <p className="text-sm text-muted">No slots left today.</p>
        ) : (
          <select
            id="appt-time"
            name="time"
            className={inputClass}
            value={scheduledAt}
            onChange={(e) => setChosen(Number(e.target.value))}
          >
            {slots.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
                {s.clash ? ` (full for ${selectedService.name})` : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      <PrimaryButton type="submit" disabled={meta.pending || slots.length === 0 || clash !== null} className="h-10">
        Book appointment
      </PrimaryButton>
      </div>
      {clash ? (
        <p className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          {selectedService.name} is full at this time: {clash} Pick another time, or another service if that is what
          the patient needs.
        </p>
      ) : null}
      <FormError error={error} />
      <p className="text-xs text-muted">
        Times are checked against this service only ({rooms} room{rooms > 1 ? "s" : ""}); other services can share the
        same time. Not queued until they check in; more than {view.settings.graceMinutes} min late makes them a walk-in.
      </p>
    </form>
  );
}

/** The picked service, or the first one if it was removed in Settings meanwhile. */
function existingService(settings: Settings, id: string): string {
  return settings.services.some((s) => s.id === id) ? id : settings.services[0].id;
}

export function FormError({ error }: { error: string | null }) {
  return (
    <p role="alert" className={error ? "rounded-md bg-bad-bg px-3 py-2 text-sm text-bad-ink" : "sr-only"}>
      {error ?? ""}
    </p>
  );
}

/** After a phone booking: the token to quote. The slip is printed when they check in. */
function BookedNote({ token }: { token: string }) {
  return (
    <div className="mt-3 flex items-center gap-4 rounded-lg bg-raised px-4 py-2.5" aria-live="polite">
      <Token className="font-display text-[28px] leading-8 font-semibold tracking-normal">{token}</Token>
      <p className="text-xs text-muted">
        Appointment booked. Quote this token to the patient.
        <br />
        Print their slip when they arrive and check in.
      </p>
    </div>
  );
}
