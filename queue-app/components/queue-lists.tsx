"use client";

import { useState } from "react";
import type { BookedRow, Customer, PriorityReason, QueueView, WaitingRow } from "@/lib/queue";
import { PRIORITY_REASONS } from "@/lib/queue";
import { EditDialog } from "./edit-dialog";
import { clock, minutes, serviceName } from "./format";
import { useQueue } from "./queue-provider";
import { serviceColor } from "./service-colors";
import { DangerTextButton, Pill, SecondaryButton, TextButton, Token } from "./ui";

const th = "h-9 px-2.5 text-left text-xs font-normal whitespace-nowrap text-muted first:pl-5 last:pr-4";
const td = "h-12 px-2.5 whitespace-nowrap first:pl-5 last:pr-4";

/** Booked appointments not here yet, for every service: the card under Add patient. */
export function CheckInList() {
  const { view } = useQueue().state;
  const [editing, setEditing] = useState<Customer | null>(null);
  return (
    <>
      <ListPanel title="Check in" count={view.booked.length} hint="Booked, not here yet">
        <BookedTable rows={view.booked} onEdit={setEditing} />
      </ListPanel>
      {editing ? <EditDialog customer={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** Waiting, full width, then Finished today, folded away. One service filter for both. */
export function QueueLists() {
  const { state } = useQueue();
  const { view } = state;
  const [service, setService] = useState<string>("all");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const inService = <T extends Customer>(rows: T[]) => (service === "all" ? rows : rows.filter((r) => r.service === service));
  const all = view.waiting;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="group" aria-label="Filter by service" className="flex gap-1.5 overflow-x-auto">
        {[{ id: "all", name: "All services" }, ...view.settings.services].map((s) => {
          const selected = service === s.id;
          const count = s.id === "all" ? all.length : all.filter((r) => r.service === s.id).length;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setService(s.id)}
              className={`flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-xs whitespace-nowrap transition-colors ${
                selected ? "bg-primary font-semibold text-white" : "bg-surface text-muted ring-1 ring-border hover:bg-active hover:text-ink"
              }`}
            >
              {s.id !== "all" ? (
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: serviceColor(view.settings, s.id).solid }} />
              ) : null}
              {s.name} <span className="num opacity-80">{count}</span>
            </button>
          );
        })}
      </div>

      <ListPanel title="Waiting" count={inService(view.waiting).length}>
        <WaitingTable rows={inService(view.waiting)} onEdit={setEditing} />
      </ListPanel>

      <ListPanel
        title="Finished today"
        count={inService(view.done).length}
        aside={
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)} className="text-xs font-semibold text-accent hover:underline">
            {showDone ? "Hide" : "Show"}
          </button>
        }
      >
        {showDone ? <DoneTable rows={inService(view.done)} /> : null}
      </ListPanel>

      {editing ? <EditDialog customer={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ListPanel({
  title,
  count,
  hint,
  aside,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-border bg-surface">
      <header className="flex items-baseline gap-2 px-5 pt-4 pb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="num text-sm text-muted">{count}</span>
        {hint ? <span className="truncate text-xs text-muted">· {hint}</span> : null}
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </header>
      <div className="relative overflow-x-auto">{children}</div>
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

/** Name on line 1, the detail (if given) and service in grey on line 2: one identity cell. */
function PatientCell({ name, service, detail }: { name: string; service: string; detail?: React.ReactNode }) {
  return (
    <td className={`${td} h-14 max-w-40`}>
      <span className="block truncate font-medium">{name}</span>
      <span className="block truncate text-xs text-muted">
        {detail ? <>{detail} · </> : null}
        {service}
      </span>
    </td>
  );
}

/** Walk-in, the appointment time, or a late arrival re-queued as a walk-in, as a few grey words. */
function typeLabel(row: Customer, settings: QueueView["settings"]): React.ReactNode {
  if (row.type === "walk_in") return "Walk-in";
  if (row.lateConverted) return <span className="text-warn-ink">Late, now walk-in</span>;
  return `Appt ${clock(row.scheduledAt!, settings)}`;
}

const actionsCell = `${td} text-right`;
/** Row actions on two fixed lines: the main buttons, then small Print / Edit / Cancel links. */
const actionsWrap = "flex items-center justify-end gap-1.5 pt-2";
const actionLinks = "-mr-1.5 flex items-center justify-end pt-0.5 pb-1.5 [&>button]:h-6 [&>button]:px-1.5 [&>button]:text-xs";

/** Staff priority: a compact menu on each waiting row (set a reason, or remove it). */
function PriorityMenu({ row }: { row: WaitingRow }) {
  const { actions, meta } = useQueue();
  return (
    <select
      aria-label={`Priority for ${row.token}`}
      disabled={meta.pending}
      value=""
      onChange={(e) => {
        const value = e.target.value;
        if (!value) return;
        actions.run({ type: "setPriority", id: row.id, reason: value === "none" ? null : (value as PriorityReason) });
      }}
      className="h-8 rounded-full border border-control bg-surface pl-3 text-[13px] font-semibold text-ink"
    >
      <option value="">{row.priority ? "Priority ✓" : "Priority"}</option>
      {row.priority ? <option value="none">Remove priority</option> : null}
      {PRIORITY_REASONS.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

function WaitingTable({ rows, onEdit }: { rows: WaitingRow[]; onEdit: (c: Customer) => void }) {
  const { state, actions, meta } = useQueue();
  const { view } = state;
  const { settings } = view;
  const freeRoom = (serviceId: string) => view.rooms.find((r) => r.serviceId === serviceId && !r.current);
  return (
    <table className="w-full min-w-[560px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className={th}>Token</th>
          <th className={th}>Patient</th>
          <th className={`${th} text-right`}>Est. wait</th>
          <th className={th}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={4}>
            Nobody is waiting. Add a walk-in, check in an appointment, or load the sample day from Settings.
          </EmptyRow>
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="border-b border-rule last:border-0">
              <td className={td}>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: serviceColor(settings, row.service).solid }} />
                  <Token>{row.token}</Token>
                </span>
              </td>
              <PatientCell name={row.name} service={serviceName(settings, row.service)} detail={typeLabel(row, settings)} />
              <td className={`${td} num text-right`}>
                <span className="block font-medium">{row.waitLabel}</span>
                <span className="block text-xs text-muted">
                  <span title="Place in this service's queue">#{row.position}</span> ·{" "}
                  {row.priority ? (
                    <span className="font-semibold text-bad-ink">Priority · {row.priority.reason}</span>
                  ) : (
                    <span
                      title={
                        row.hold
                          ? `Walked in ${clock(row.arrivedAt!, settings)}; target held 15 min so ${row.hold.for}'s appointment goes first`
                          : "Target time"
                      }
                    >
                      target {clock(row.targetAt, settings)}
                      {row.hold ? ` · after ${row.hold.for}` : ""}
                    </span>
                  )}
                </span>
              </td>
              <td className={actionsCell}>
                {/* Full width: both action groups on one line (they stack in the narrower Check in card). */}
                <div className="flex items-center justify-end gap-1 [&>div]:py-0">
                <div className={actionsWrap}>
                {freeRoom(row.service) ? (
                  <SecondaryButton
                    className="h-8"
                    disabled={meta.pending}
                    onClick={() => actions.run({ type: "callPatient", room: freeRoom(row.service)!.id, id: row.id })}
                  >
                    Call now<span className="sr-only"> {row.token}</span>
                  </SecondaryButton>
                ) : null}
                <PriorityMenu row={row} />
                </div>
                <div className={actionLinks}>
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
                </div>
                </div>
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
    <table className="w-full min-w-[380px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className={th}>Token · patient</th>
          <th className={`${th} text-right`}>Time</th>
          <th className={th}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={3}>Nobody to check in. Booked appointments appear here until they arrive.</EmptyRow>
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="border-b border-rule last:border-0">
              <td className={`${td} h-14 max-w-44`}>
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: serviceColor(settings, row.service).solid }} />
                  <Token>{row.token}</Token>
                </span>
                <span className="block truncate text-xs text-muted">
                  <span className="font-medium text-ink">{row.name}</span> · {serviceName(settings, row.service)}
                </span>
              </td>
              <td className={`${td} num text-right`}>
                <span className="block">{clock(row.scheduledAt!, settings)}</span>
                {row.overdue ? (
                  <span className="block text-xs font-semibold text-bad-ink" title={`Past the ${settings.graceMinutes}-min grace period`}>
                    Overdue
                  </span>
                ) : (
                  <span className="block text-xs text-muted">Expected</span>
                )}
              </td>
              <td className={actionsCell}>
                <div className={actionsWrap}>
                <SecondaryButton
                  className="h-8"
                  disabled={meta.pending}
                  onClick={() => actions.run({ type: "checkIn", id: row.id })}
                >
                  Check in<span className="sr-only"> {row.token}</span>
                </SecondaryButton>
                </div>
                <div className={actionLinks}>
                <TextButton onClick={() => onEdit(row)}>
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
                </div>
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
    <table className="w-full min-w-[520px] border-collapse text-sm">
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
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: serviceColor(settings, row.service).solid }} />
                  <Token>{row.token}</Token>
                </span>
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
