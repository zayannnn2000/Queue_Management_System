import Link from "next/link";
import { HygieiaMark, Wordmark } from "./brand";
import { LiveClock } from "./live-clock";
import { NavLinks } from "./nav-links";

/**
 * Framed-sheet shell: the sidebar and the 56px top bar share one lavender frame (no rule between them);
 * the work sits on a white sheet inset 8px from the right and bottom edges.
 * At 1440: 248 sidebar + 1184 sheet + 8 inset = 1440. Below 1100 the sidebar folds into the top bar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-3 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="min-h-screen min-[1100px]:grid min-[1100px]:grid-cols-[248px_minmax(0,1fr)] min-[1100px]:grid-rows-[56px_minmax(0,1fr)]">
        <aside className="hidden min-[1100px]:row-span-2 min-[1100px]:flex min-[1100px]:flex-col min-[1100px]:px-4 min-[1100px]:pt-5 min-[1100px]:pb-5">
          <Link href="/staff" className="flex items-center gap-3 rounded-2xl px-1 py-1" aria-label="Hygieia Wellness Clinic, front desk">
            <HygieiaMark size={58} />
            <Wordmark />
          </Link>
          <NavLinks className="mt-9 flex flex-col gap-1" variant="sidebar" />
          <p className="mt-auto px-3 text-xs leading-4 text-muted">Demo clinic. All patients are fictional.</p>
        </aside>

        <header className="flex h-14 items-center gap-3 px-4 min-[1100px]:pr-5 min-[1100px]:pl-0">
          <Link href="/staff" className="flex items-center gap-2 min-[1100px]:hidden" aria-label="Hygieia Wellness Clinic, front desk">
            <HygieiaMark size={34} />
            <span className="font-display text-[24px] leading-none font-semibold">Hygieia</span>
          </Link>
          <NavLinks className="ml-2 flex gap-1 max-sm:hidden min-[1100px]:hidden" variant="bar" />
          <div className="ml-auto flex items-center text-muted">
            <LiveClock className="max-sm:hidden" />
          </div>
        </header>
        <NavLinks className="flex gap-1 overflow-x-auto px-3 pb-2 sm:hidden" variant="bar" />

        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 bg-surface outline-none min-[1100px]:mr-2 min-[1100px]:mb-2 min-[1100px]:rounded-2xl min-[1100px]:border min-[1100px]:border-border"
        >
          {children}
        </main>
      </div>
    </>
  );
}
