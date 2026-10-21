"use client";

import { useEffect, useRef, useState } from "react";
import type { Customer } from "@/lib/queue";
import { MAX_NAME_LENGTH } from "@/lib/queue";
import { clock, slotOptions } from "./format";
import { useQueue } from "./queue-provider";
import { Field, PrimaryButton, SecondaryButton, Token, inputClass } from "./ui";

/** Edit name, service and (appointments) scheduled time while booked or waiting. */
export function EditDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(customer.name);
  const [service, setService] = useState(customer.service);
  const [scheduledAt, setScheduledAt] = useState(customer.scheduledAt ?? 0);
  const isAppointment = customer.type === "appointment";

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const slots = isAppointment
    ? slotOptions(view, service, { excludeId: customer.id, fromPast: customer.status === "waiting" })
    : [];
  if (isAppointment && !slots.some((s) => s.value === scheduledAt)) {
    // Keep the current time selectable even if it has passed.
    slots.unshift({ value: scheduledAt, label: clock(scheduledAt, view.settings), clash: null });
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await actions.run({
      type: "edit",
      id: customer.id,
      name,
      service,
      ...(isAppointment ? { scheduledAt } : {}),
    });
    if (ok) ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="edit-title"
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-lg border border-border bg-surface p-0 text-ink shadow-[0_12px_32px_rgba(0,0,0,0.16)] backdrop:bg-black/30"
    >
      <form onSubmit={save} className="flex flex-col gap-4 p-5">
        <h2 id="edit-title" className="text-base font-semibold">
          Edit <Token>{customer.token}</Token>
        </h2>
        <Field label="Name" htmlFor="edit-name">
          <input
            id="edit-name"
            className={inputClass}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            required
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Service" htmlFor="edit-service">
          <select id="edit-service" className={inputClass} value={service} onChange={(e) => setService(e.target.value)}>
            {view.settings.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {isAppointment ? (
          <Field
            label="Appointment time"
            htmlFor="edit-time"
            hint={customer.status === "waiting" ? "Already checked in: changing the time re-checks lateness against their arrival." : undefined}
          >
            <select
              id="edit-time"
              className={inputClass}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(Number(e.target.value))}
            >
              {slots.map((s) => (
                <option key={s.value} value={s.value} disabled={s.clash !== null}>
                  {s.label}
                  {s.clash ? " (full)" : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <SecondaryButton type="button" onClick={() => ref.current?.close()}>
            Close
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={meta.pending}>
            Save changes
          </PrimaryButton>
        </div>
      </form>
    </dialog>
  );
}
