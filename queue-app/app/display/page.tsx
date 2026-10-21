import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DisplayBoard } from "@/components/display-board";
import { toPublicView } from "@/lib/queue";
import { currentView } from "@/lib/views";

export const metadata: Metadata = { title: "Waiting-room display" };

export default function DisplayPage({ searchParams }: PageProps<"/display">) {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-6 md:px-10 md:py-8" aria-busy="true">
          <h1 className="text-2xl font-bold tracking-[-0.01em] md:text-[32px] md:leading-10">Hygieia Wellness Clinic</h1>
        </div>
      }
    >
      <LiveBoard searchParams={searchParams} />
    </Suspense>
  );
}

async function LiveBoard({ searchParams }: { searchParams: PageProps<"/display">["searchParams"] }) {
  await connection();
  const { token } = await searchParams;
  const highlight = typeof token === "string" && token.trim() ? token.trim().toUpperCase() : null;
  const view = toPublicView(await currentView());
  return <DisplayBoard key={highlight ?? ""} initial={view} highlight={highlight} />;
}
