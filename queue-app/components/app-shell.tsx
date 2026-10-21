import Link from "next/link";
import { LiveClock } from "./live-clock";
import { NavLinks } from "./nav-links";

/**
 * Framed-sheet shell: the sidebar and the 48px top bar share one tinted frame (no rule between them);
 * the work sits on a white sheet inset 8px from the right and bottom edges.
 * At 1440: 228 sidebar + 1204 sheet + 8 inset = 1440. Below 1100 the sidebar folds into the top bar.
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
    <div className="min-h-screen min-[1100px]:grid min-[1100px]:grid-cols-[228px_minmax(0,1fr)] min-[1100px]:grid-rows-[48px_minmax(0,1fr)]">
      <aside className="hidden min-[1100px]:row-span-2 min-[1100px]:flex min-[1100px]:flex-col min-[1100px]:px-3 min-[1100px]:pt-3 min-[1100px]:pb-4">
        <ProductMark />
        <NavLinks className="mt-6 flex flex-col gap-0.5" variant="sidebar" />
        <p className="mt-auto px-2 text-xs leading-4 text-muted">Demo clinic. All patients are fictional.</p>
      </aside>

      <header className="flex h-12 items-center gap-3 px-4 min-[1100px]:pr-4 min-[1100px]:pl-0">
        <div className="min-[1100px]:hidden">
          <ProductMark />
        </div>
        <NavLinks className="flex gap-1 max-sm:hidden min-[1100px]:hidden" variant="bar" />
        <div className="ml-auto flex items-center text-muted">
          <LiveClock className="max-sm:hidden" />
        </div>
      </header>
      <NavLinks className="flex gap-1 overflow-x-auto px-3 pb-2 sm:hidden" variant="bar" />

      <main id="main" tabIndex={-1} className="min-w-0 bg-surface outline-none min-[1100px]:mr-2 min-[1100px]:mb-2 min-[1100px]:rounded-2xl min-[1100px]:border min-[1100px]:border-border">
        {children}
      </main>
    </div>
    </>
  );
}

function ProductMark() {
  return (
    <Link href="/staff" className="flex items-center gap-2.5 rounded-full px-2 py-1">
      <HygieiaMark />
      <span className="leading-tight">
        <span className="block text-base font-bold tracking-[-0.01em] whitespace-nowrap">Hygieia</span>
        <span className="block text-xs whitespace-nowrap text-muted max-[1099px]:sr-only">Wellness Clinic</span>
      </span>
    </Link>
  );
}

/** The product's mark: the Bowl of Hygieia, a cup with a fresh sprout, white on a lilac disc. */
export function HygieiaMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="flex-none">
      <circle cx="14" cy="14" r="14" fill="var(--accent)" />
      <path d="M14 11.2c0-3 1.8-4.9 4.7-5.1 0 2.9-1.8 4.9-4.7 5.1z" fill="#fff" />
      <path d="M8 12.6h12a6 6 0 0 1-12 0z" fill="#fff" />
      <path d="M14 18.6v2.8M11.2 21.6h5.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
