// Hygieia Wellness Clinic identity: the Bowl of Hygieia drawn as a lilac cup with a rising serpent
// and a sprout, and the wordmark set in Cormorant Garamond.

export function HygieiaMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={`flex-none ${className}`}
    >
      {/* sprout */}
      <path d="M20 13.5c0-4.4 2.6-7.4 7-7.8 0 4.3-2.6 7.4-7 7.8z" fill="var(--accent-soft)" />
      <path d="M20 13.5c0-3.3-1.9-5.5-5.2-5.8 0 3.2 1.9 5.5 5.2 5.8z" fill="var(--accent-soft)" opacity="0.7" />
      {/* bowl */}
      <path d="M9.5 17h21a10.5 10.5 0 0 1-21 0z" fill="var(--accent)" />
      {/* serpent rising from the rim */}
      <path
        d="M25.5 17c2.2-1.8 2.4-4 .6-5.2"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* stem and foot */}
      <path d="M20 27.5v4.5M14.5 33.5h11" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = "md" }: { size?: "md" | "lg" | "xl" }) {
  const name = { md: "text-[30px] leading-8", lg: "text-[34px] leading-9", xl: "text-[54px] leading-[56px]" }[size];
  const sub = { md: "text-[11px]", lg: "text-xs", xl: "text-sm" }[size];
  return (
    <span className="flex flex-col">
      <span className={`font-display font-semibold tracking-[-0.01em] text-ink ${name}`}>Hygieia</span>{" "}
      <span className={`mt-0.5 font-medium text-muted ${sub}`}>Wellness Clinic</span>
    </span>
  );
}
