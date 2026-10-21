"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/staff", label: "Front desk", short: "Desk" },
  { href: "/staff/settings", label: "Settings", short: "Settings" },
  { href: "/display", label: "Waiting-room display", short: "Display" },
] as const;

export function NavLinks({ className, variant }: { className?: string; variant: "sidebar" | "bar" }) {
  const compact = variant === "bar";
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={className}>
      {LINKS.map((link) => {
        const active = pathname === link.href;
        const external = link.href === "/display";
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            target={external ? "_blank" : undefined}
            className={`flex h-9 items-center gap-2 rounded-full px-3 text-sm transition-colors hover:bg-active ${
              active ? "bg-surface font-semibold text-ink" : "text-muted"
            }`}
          >
            {compact ? link.short : link.label}
            {external ? (
              <span aria-hidden="true" className="text-xs">
                ↗
              </span>
            ) : null}
            {external ? <span className="sr-only">(opens in a new tab)</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
