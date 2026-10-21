// Small presentational primitives. Explicit variants instead of boolean props.

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

const base =
  "inline-flex h-9 flex-none items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-[background-color,color,transform] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";

export function PrimaryButton({ className = "", ...props }: ButtonProps) {
  return <button {...props} className={`${base} bg-primary text-white hover:bg-black ${className}`} />;
}

export function SecondaryButton({ className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`${base} border border-control bg-surface text-ink hover:bg-raised ${className}`}
    />
  );
}

export function TextButton({ className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`${base} h-8 px-3 text-ink hover:bg-active ${className}`}
    />
  );
}

export function DangerTextButton({ className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`${base} h-8 px-3 text-negative hover:bg-bad-bg ${className}`}
    />
  );
}

const pillBase = "inline-flex h-6 flex-none items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";

export const Pill = {
  Neutral: ({ children }: { children: React.ReactNode }) => (
    <span className={`${pillBase} bg-neutral-bg text-neutral-ink`}>{children}</span>
  ),
  Accent: ({ children }: { children: React.ReactNode }) => (
    <span className={`${pillBase} bg-accent-pale text-accent`}>{children}</span>
  ),
  Warning: ({ children }: { children: React.ReactNode }) => (
    <span className={`${pillBase} bg-warn-bg text-warn-ink`}>{children}</span>
  ),
  Negative: ({ children }: { children: React.ReactNode }) => (
    <span className={`${pillBase} bg-bad-bg text-bad-ink`}>{children}</span>
  ),
  Positive: ({ children }: { children: React.ReactNode }) => (
    <span className={`${pillBase} bg-ok-bg text-ok-ink`}>{children}</span>
  ),
};

/** A token as patients see it on their slip: IBM Plex Mono, the product's one ID face. */
export function Token({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span translate="no" className={`font-mono font-medium ${className}`}>
      {children}
    </span>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
  id,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className={`rounded-lg border border-border bg-surface ${className}`}>
      <header className="flex min-h-12 items-center gap-3 px-5 pt-3 pb-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {aside ? <div className="ml-auto flex items-center gap-2 text-xs text-muted">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-control bg-surface px-3 text-sm text-ink placeholder:text-muted";
