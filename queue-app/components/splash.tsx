"use client";

import { useEffect, useState } from "react";
import { HygieiaMark } from "./brand";

/**
 * Opening veil on a full page load: the mark and wordmark rise out of a soft blur, a short lilac
 * line fills, then the veil lifts and removes itself. The animation is CSS (globals.css), so it
 * plays before hydration; it never intercepts clicks and is hidden from assistive tech.
 * Client-side navigation keeps the root layout, so it shows on reloads only.
 */
export function Splash() {
  const [done, setDone] = useState(false);
  // Fallback for a slow hydration that misses the animationend event.
  useEffect(() => {
    const id = window.setTimeout(() => setDone(true), 2600);
    return () => window.clearTimeout(id);
  }, []);
  if (done) return null;
  return (
    <div
      aria-hidden="true"
      className="splash"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setDone(true);
      }}
    >
      <div className="splash-mark">
        <HygieiaMark size={96} />
      </div>
      <p className="splash-name font-display">Hygieia</p>
      <p className="splash-sub">Wellness Clinic</p>
      <span className="splash-line">
        <span />
      </span>
    </div>
  );
}
