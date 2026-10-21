"use client";

import { useState } from "react";
import type { BookedRow, Customer, WaitingRow } from "@/lib/queue";
import { EditDialog } from "./edit-dialog";
import { clock, minutes, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { DangerTextButton, Pill, SecondaryButton, TextButton, Token } from "./ui";

type Filter = "waiting" | "booked" | "done";

const th = "h-9 px-3 text-left text-xs font-normal whitespace-nowrap text-muted first:pl-5 last:pr-5";
const td = "h-12 px-3 whitespace-nowrap first:pl-5 last:pr-5";

/** The three lists, switched by count cards that act as the filter. */
export function QueueLists() {
  const { state } = useQueue();
  const { view } = state;
  const [filter, setFilter] = useState<Filter>("waiting");
  const [editing, setEditing] = useState<Customer | null>(null);

  const cards: { id: Filter; label: string; count: number }[] = [
    { id: "waiting", label: "Waiting", count: view.waiting.length },
    { id: "booked", label: "Booked, not arrived", count: view.booked.length },
    { id: "done", label: "Finished today", count: view.done.length },
  ];

  return (
    <section aria-labelledby="lists-heading" className="rounded-lg border border-border bg-surface">
      <h2 id="lists-heading" className="sr-only">
        Patients
      </h2>
      <div role="group" aria-label="Show list" className="grid grid-cols-3 gap-2 p-3">
        {cards.map((card) => {
          const selected = filter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={selected}
              aria-controls="patient-list"
              onClick={() => setFilter(card.id)}
              className={`flex min-h-[61px] flex-col justify-center rounded-md p-3 text-left transition-colors ${
                selected
                  ? "bg-accent-pale outline-[1.5px] -outline-offset-[1.5px] outline-accent outline-solid"
                  : "bg-raised hover:bg-active"
              }`}
            >
              <span className="text-[13px] leading-4 text-muted">{card.label}</span>
              <span className="num mt-1 text-base font-semibold">{card.count}</span>
            </button>
          );
        })}
      </div>

      <div id="patient-list" aria-label={cards.find((c) => c.id === filter)!.label} role="region" className="overflow-x-auto">
        {filter === "waiting" ? (
          <WaitingTable rows={view.waiting} onEdit={setEditing} />
        ) : filter === "booked" ? (
          <BookedTable rows={view.booked} onEdit={setEditing} />
        ) : (
          <DoneTable rows={view.done} />
        )}
      </div>

      {editing ? <EditDialog customer={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-5 pt-2 pb-5">
        <p className="rounded-lg border border-dashed border-control px-4 py-2.5 text-sm text-muted">{children}</p>
      </td>
    </tr>
  );
}

/** Name on line 1, service in grey on line 2: one identity cell instead of two columns. */
function PatientCell({ name, service }: { name: string; service: string }) {
  return (
    <td className={`${td} h-14 max-w-56`}>
      <span className="block truncate font-medium">{name}</span>
      <span className="block truncate text-xs text-muted">{service}</span>
    </td>
  );
}

function TypeCell({ row }: { row: Customer & { targetAt?: number } }) {
  const { state } = useQueue();
  const { settings } = state.view;
  if (row.type === "walk_in") return <Pill.Neutral>Walk-in</Pill.Neutral>;
  if (row.lateConverted) return <Pill.Warning>Late, now walk-in</Pill.Warning>;
  return <Pill.Accent>Appt {clock(row.scheduledAt!, settings)}</Pill.Accent>;
}

function WaitingTable({ rows, onEdit }: { rows: WaitingRow[]; onEdit: (c: Customer) => void }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const { settings } = view;
  return (
    <table className="w-full min-w-[640px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className={`${th} w-12 text-right`}>Pos.</th>
          <th className={th}>Token</th>
          <th className={th}>Patient</th>
          <th className={th}>Booking</th>
          <th className={`${th} text-right`}>Target</th>
          <th className={`${th} text-right`}>Est. wait</th>
          <th className={th}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={7}>
            Nobody is waiting. Add a walk-in, check in an appointment, or load the sample day from Settings.
          </EmptyRow>
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="border-b border-rule last:border-0">
              <td className={`${td} num text-right text-muted`}>{row.position}</td>
              <td className={td}>
                <Token>{row.token}</Token>
              </td>
              <PatientCell name={row.name} service={serviceName(settings, row.service)} />
              <td className={td}>
                <TypeCell row={row} />
              </td>
              <td className={`${td} num text-right text-muted`}>{clock(row.targetAt, settings)}</td>
              <td className={`${td} num text-right font-medium`}>{row.waitLabel}</td>
              <td className={`${td} text-right whitespace-nowrap`}>
                <TextButton onClick={() => actions.print(row.token)}>
                  Print<span className="sr-only"> token {row.token}</span>
                </TextButton>
                <TextButton onClick={() => onEdit(row)}>
                  Edit<span className="sr-only"> {row.token}</span>
                </TextButton>
                <DangerTextButton
                  disabled={meta.pending}
                  onClick={() => {
                    if (window.confirm(`Cancel ${row.token} (${row.name})? They leave the queue.`)) {
                      actions.run({ type: "cancel", id: row.id });
                    }
                  }}
                >
                  Cancel<span className="sr-only"> {row.token}</span>
                </DangerTextButton>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function BookedTable({ rows, onEdit }: { rows: BookedRow[]; onEdit: (c: Customer) => void }) {
  const { state, actions, meta } = useQueue();
  const { settings } = state.view;
  return (
    <table className="w-full min-w-[640px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className={th}>Token</th>
          <th className={th}>Patient</th>
          <th className={`${th} text-right`}>Time</th>
          <th className={th}>Status</th>
          <th className={th}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={5}>No appointments are waiting to arrive.</EmptyRow>
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="border-b border-rule last:border-0">
              <td className={td}>
                <Token>{row.token}</Token>
              </td>
              <PatientCell name={row.name} service={serviceName(settings, row.service)} />
              <td className={`${td} num text-right`}>{clock(row.scheduledAt!, settings)}</td>
              <td className={td}>
                {row.overdue ? (
                  <Pill.Negative>Overdue, past {settings.graceMinutes}-min grace</Pill.Negative>
                ) : (
                  <span className="text-muted">Expected</span>
                )}
              </td>
              <td className={`${td} text-right whitespace-nowrap`}>
                <SecondaryButton
                  className="h-7"
                  disabled={meta.pending}
                  onClick={() => actions.run({ type: "checkIn", id: row.id })}
                >
                  Check in<span className="sr-only"> {row.token}</span>
                </SecondaryButton>
                <TextButton className="ml-1" onClick={() => onEdit(row)}>
                  Edit<span className="sr-only"> {row.token}</span>
                </TextButton>
                {row.overdue ? (
                  <DangerTextButton
                    disabled={meta.pending}
                    onClick={() => {
                      if (window.confirm(`Mark ${row.token} (${row.name}) as a no-show?`)) {
                        actions.run({ type: "noShow", id: row.id });
                      }
                    }}
                  >
                    No-show<span className="sr-only"> {row.token}</span>
                  </DangerTextButton>
                ) : null}
                <DangerTextButton
                  disabled={meta.pending}
                  onClick={() => {
                    if (window.confirm(`Cancel the booking ${row.token} (${row.name})?`)) {
                      actions.run({ type: "cancel", id: row.id });
                    }
                  }}
                >
                  Cancel<span className="sr-only"> {row.token}</span>
                </DangerTextButton>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

const OUTCOME = {
  served: <Pill.Positive>Served</Pill.Positive>,
  no_show: <Pill.Negative>No-show</Pill.Negative>,
  cancelled: <Pill.Neutral>Cancelled</Pill.Neutral>,
} as const;

function DoneTable({ rows }: { rows: Customer[] }) {
  const { state } = useQueue();
  const { settings } = state.view;
  return (
    <table className="w-full min-w-[640px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className={th}>Token</th>
          <th className={th}>Patient</th>
          <th className={th}>Outcome</th>
          <th className={`${th} text-right`}>Called</th>
          <th className={`${th} text-right`}>Duration</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={5}>Nobody has been seen yet today.</EmptyRow>
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="border-b border-rule last:border-0">
              <td className={td}>
                <Token>{row.token}</Token>
              </td>
              <PatientCell name={row.name} service={serviceName(settings, row.service)} />
              <td className={td}>{OUTCOME[row.status as keyof typeof OUTCOME]}</td>
              <td className={`${td} num text-right text-muted`}>
                {row.calledAt ? clock(row.calledAt, settings) : "–"}
              </td>
              <td className={`${td} num text-right`}>
                {row.status === "served" ? minutes(row.servedAt! - row.calledAt!) : <span className="text-muted">–</span>}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
