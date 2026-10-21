import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { QueueProvider } from "@/components/queue-provider";
import { StaffConsole } from "@/components/staff-console";
import { storageKind } from "@/lib/store";
import { currentView } from "@/lib/views";

export const metadata: Metadata = { title: "Front desk" };

export default function StaffPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <LiveConsole />
    </Suspense>
  );
}

async function LiveConsole() {
  await connection();
  const view = await currentView();
  return (
    <QueueProvider initial={view} storage={storageKind}>
      <StaffConsole />
    </QueueProvider>
  );
}

/** Loading: the final layout with flat grey blocks at their real size. */
function ConsoleSkeleton() {
  return (
    <div className="px-4 pt-5 pb-8 md:px-6 md:pt-6" aria-busy="true">
      <h1 className="font-display text-[24px] leading-7 font-semibold sm:text-[32px] sm:leading-9 tracking-[-0.01em]">Front desk</h1>
      <div className="mt-2 h-5 w-64 rounded bg-raised" />
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 min-[1280px]:grid-cols-[minmax(0,1fr)_352px]">
        <div className="flex flex-col gap-6">
          <div className="h-[178px] rounded-lg border border-border" />
          <div className="h-[150px] rounded-lg border border-border" />
          <div className="h-[320px] rounded-lg border border-border" />
        </div>
        <div className="h-[420px] rounded-lg border border-border" />
      </div>
    </div>
  );
}
