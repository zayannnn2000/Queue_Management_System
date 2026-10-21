"use client";

import { useState } from "react";
import { MAX_NAME_LENGTH } from "@/lib/queue";
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
    <Panel title="Add patient" id="add-heading">
      <div className="px-5 pb-5">
        <div role="group" aria-label="Booking type" className="inline-flex rounded-full bg-active p-1">
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
              className={`h-8 rounded-full px-4 text-sm transition-colors ${
                kind === id ? "bg-primary font-semibold text-white" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
    <div className="grid gap-4 sm:grid-cols-2">
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
    </div>
  );
}

function WalkInForm({ onIssued }: { onIssued: () => void }) {
  const { state, actions, meta } = useQueue();
  const [name, setName] = useState("");
  const [service, setService] = useState(state.view.settings.services[0].id);
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
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4" aria-label="Add walk-in">
      <NameAndService name={name} setName={setName} service={service} setService={setService} prefix="walkin" />
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PrimaryButton type="submit" disabled={meta.pending} className="h-10">
          Add walk-in
        </PrimaryButton>
        <p className="text-xs text-muted">Joins the queue now. Their target time is their arrival.</p>
      </div>
    </form>
  );
}

function AppointmentForm({ onIssued }: { onIssued: (token: string) => void }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const [name, setName] = useState("");
  const [service, setService] = useState(view.settings.services[0].id);
  const slots = slotOptions(view, service);
  const firstFree = slots.find((s) => !s.clash)?.value ?? 0;
  const [chosen, setChosen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scheduledAt = chosen !== null && slots.some((s) => s.value === chosen && !s.clash) ? chosen : firstFree;

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
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4" aria-label="Book appointment">
      <NameAndService name={name} setName={setName} service={service} setService={setService} prefix="appt" />
      <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Time today"
        htmlFor="appt-time"
        hint={(() => {
          const rooms = view.settings.services.find((s) => s.id === service)!.rooms;
          return `Full slots are greyed out: this service has ${rooms} room${rooms > 1 ? "s" : ""}, no overlaps beyond that.`;
        })()}
      >
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
              <option key={s.value} value={s.value} disabled={s.clash !== null}>
                {s.label}
                {s.clash ? " (full)" : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      <p className="self-center text-xs text-muted sm:pt-3">
        Not queued until they check in. Arriving more than {view.settings.graceMinutes} min late makes them a walk-in.
      </p>
      </div>
      <FormError error={error} />
      <PrimaryButton type="submit" disabled={meta.pending || !firstFree} className="h-10 self-start">
        Book appointment
      </PrimaryButton>
    </form>
  );
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
    <div className="mt-5 rounded-lg bg-raised p-4" aria-live="polite">
      <p className="text-xs text-muted">Appointment booked. Quote this token to the patient.</p>
      <Token className="mt-1 block font-display text-[34px] leading-9 font-semibold tracking-normal">{token}</Token>
      <p className="mt-2 text-xs text-muted">Print their slip when they arrive and check in.</p>
    </div>
  );
}
