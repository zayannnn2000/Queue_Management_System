"use client";

import type { QueueView } from "@/lib/queue";
import { CallStrip } from "./call-strip";
import { CustomerForm } from "./customer-form";
import { NowServing } from "./now-serving";
import { CheckInList, QueueLists } from "./queue-lists";
import { useQueue } from "./queue-provider";
import { PrintSlip } from "./token-slip";

/**
 * Front desk. The title with the half-width Next-hour timeline beside it; Add patient (Check in under it) beside the
 * room pills, half each; Waiting, full width; Finished today. Below 1024 everything stacks.
 */
export function StaffConsole() {
  return (
    <div className="px-4 pt-6 pb-10 md:px-8 md:pt-8">
      <PrintSlip />
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <TitleRow />
        <CallStrip className="lg:w-1/2 lg:flex-none" />
      </div>
      <div className="mt-6 flex min-w-0 flex-col gap-6">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
          {/* On phones the wrapper dissolves so the rooms come before the check-in list. */}
          <div className="flex min-w-0 flex-col gap-4 max-lg:contents">
            <CustomerForm />
            <div className="min-w-0 max-lg:order-last">
              <CheckInList />
            </div>
          </div>
          <NowServing />
        </div>
        <QueueLists />
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
    const longest = view.waiting.reduce((a, b) => (b.waitMs > a.waitMs ? b : a));
    parts.push(`longest wait ${longest.waitLabel === "Due now" ? "under 5 min" : longest.waitLabel.replace("~", "about ")}`);
  }
  const priority = view.waiting.filter((w) => w.priority).length;
  if (priority > 0) parts.push(`${priority} priority`);
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
    <div className="min-w-0 lg:flex-1">
      <h1 className="font-display text-[24px] leading-7 font-semibold sm:text-[32px] sm:leading-9 tracking-[-0.01em]">Front desk</h1>
      <p className="mt-2 text-[15px] text-muted">{finding(view)}</p>
      <div className="mt-2 flex items-center empty:hidden" role="status" aria-live="polite">
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
