"use client";

import type { QueueView } from "@/lib/queue";
import { CallStrip } from "./call-strip";
import { CustomerForm } from "./customer-form";
import { minutes } from "./format";
import { NowServing } from "./now-serving";
import { QueueLists } from "./queue-lists";
import { useQueue } from "./queue-provider";
import { Panel } from "./ui";

/**
 * Front desk. Grid at 1440: sheet 1204 − 2 × 24 padding = 1156 = 780 main + 24 gap + 352 rail.
 * Below 1280 the rail stacks under the main column.
 */
export function StaffConsole() {
  return (
    <div className="px-4 pt-5 pb-8 md:px-6 md:pt-6">
      <TitleRow />
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 min-[1280px]:grid-cols-[minmax(0,1fr)_352px]">
        <div className="flex min-w-0 flex-col gap-6">
          <NowServing />
          <CallStrip />
          <QueueLists />
        </div>
        <div className="flex flex-col gap-6">
          <CustomerForm />
          <ServiceTimes />
        </div>
      </div>
    </div>
  );
}

/** The screen's one finding, in words: how many wait, how long the longest wait is, what needs attention. */
function finding(view: QueueView): string {
  const parts: string[] = [];
  const waiting = view.waiting.length;
  parts.push(waiting === 0 ? "Nobody waiting" : `${waiting} waiting`);
  if (waiting > 0) {
    const last = view.waiting[waiting - 1];
    parts.push(`last in line seen in ${last.waitLabel === "Due now" ? "a moment" : last.waitLabel.replace("~", "about ")}`);
  }
  const overdue = view.booked.filter((b) => b.overdue).length;
  if (overdue > 0) parts.push(`${overdue} booking${overdue > 1 ? "s" : ""} overdue`);
  const late = view.waiting.filter((w) => w.lateConverted).length;
  if (late > 0) parts.push(`${late} late arrival${late > 1 ? "s" : ""} re-queued as walk-in`);
  return parts.join(" · ");
}

function TitleRow() {
  const { state, actions } = useQueue();
  const { view, notice, stale } = state;
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      <div>
        <h1 className="text-[22px] leading-7 font-semibold">Front desk</h1>
        <p className="mt-1 text-[15px] text-muted">{finding(view)}</p>
      </div>
      <div className="flex items-center lg:ml-auto lg:min-h-8 lg:max-w-[52%]" role="status" aria-live="polite">
        {stale ? (
          <p className="rounded-md bg-warn-bg px-3 py-1.5 text-sm text-warn-ink">
            Lost connection. Showing the last update; retrying every 3 seconds.
          </p>
        ) : notice ? (
          <p
            className={`flex items-start gap-2 rounded-md px-3 py-1.5 text-sm ${
              notice.kind === "error" ? "bg-bad-bg text-bad-ink" : "bg-raised text-ink"
            }`}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={actions.dismiss}
              className="-mr-1 rounded px-1 text-muted hover:text-ink"
              aria-label="Dismiss message"
            >
              ×
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The evidence behind every wait: the average each estimate uses, and how many visits it is based on. */
function ServiceTimes() {
  const { state } = useQueue();
  const { settings, expected } = state.view;
  return (
    <Panel title="Service times used" id="times-heading" aside="Last 5 visits">
      <dl className="mx-5 mb-5 rounded-lg bg-raised px-3 py-1">
        {settings.services.map((s) => {
          const e = expected[s.id];
          return (
            <div key={s.id} className="flex h-8 items-center gap-3 text-sm">
              <dt className="min-w-0 flex-1 truncate">{s.name}</dt>
              <dd className="num text-muted">
                {e.samples === 0 ? `default` : `${e.samples} visit${e.samples > 1 ? "s" : ""}`}
              </dd>
              <dd className="num w-16 text-right font-medium">{minutes(e.minutes * 60_000)}</dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}
