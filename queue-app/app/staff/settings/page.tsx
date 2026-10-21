import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { QueueProvider } from "@/components/queue-provider";
import { SettingsView } from "@/components/settings-form";
import { storageKind } from "@/lib/store";
import { currentView } from "@/lib/views";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-5 md:px-6 md:pt-6" aria-busy="true">
          <h1 className="text-[22px] leading-7 font-semibold">Settings</h1>
        </div>
      }
    >
      <LiveSettings />
    </Suspense>
  );
}

async function LiveSettings() {
  await connection();
  const view = await currentView();
  return (
    <QueueProvider initial={view} storage={storageKind}>
      <SettingsView />
    </QueueProvider>
  );
}
