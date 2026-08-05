import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

const VARIANTS: Record<string, string> = {
  primary:
    "bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[0_1px_2px_rgb(0_0_0/0.08)]",
  secondary:
    "bg-transparent text-accent border border-accent/35 hover:bg-accent/8 active:bg-accent/14",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-ink/5",
  danger: "bg-transparent text-warn border border-warn/35 hover:bg-warn/8",
};

const SIZES: Record<string, string> = {
  sm: "text-[13px] px-3.5 py-1.5",
  md: "text-[15px] px-5 py-2.5",
  lg: "text-[17px] px-7 py-3.5",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium
        transition-[filter,background-color,color,transform,opacity] duration-200
        disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    />
  );
}

export function Panel({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-[20px] border border-hairline bg-raised ${
        padded ? "p-6 sm:p-7" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "positive" | "warn";
}) {
  const tones = {
    neutral: "bg-ink/6 text-muted",
    accent: "bg-accent/12 text-accent",
    positive: "bg-positive/12 text-positive",
    warn: "bg-warn/12 text-warn",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]
        font-medium tracking-tight ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-3.5 animate-spin rounded-full border-2
        border-current border-t-transparent opacity-60 ${className}`}
    />
  );
}

/** A thin horizontal bar for similarity scores. */
export function Score({ value }: { value: number }) {
  const percent = Math.max(4, Math.min(100, Math.round(value * 100)));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-ink/10">
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-faint">
        {value.toFixed(3)}
      </span>
    </span>
  );
}

export function Notice({
  tone = "warn",
  title,
  children,
}: {
  tone?: "warn" | "accent";
  title: string;
  children?: ReactNode;
}) {
  const border = tone === "warn" ? "border-warn/30" : "border-accent/30";
  const text = tone === "warn" ? "text-warn" : "text-accent";
  return (
    <div className={`rounded-2xl border ${border} bg-surface px-5 py-4`}>
      <p className={`text-[14px] font-semibold ${text}`}>{title}</p>
      {children ? (
        <div className="mt-1 text-[14px] leading-relaxed text-muted">{children}</div>
      ) : null}
    </div>
  );
}
