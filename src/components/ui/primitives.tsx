import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Category, Priority } from "@/types";
import { PRIORITY_META } from "@/types";
import { pad2 } from "@/lib/time";
import { cn } from "@/utils/cn";

/* ------------------------------------------------ micro label */
export function Micro({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("micro text-mute", className)}>{children}</span>;
}

/* ------------------------------------------------ section head */
export function SectionHead({
  no,
  title,
  right,
  light,
}: {
  no: string;
  title: string;
  right?: ReactNode;
  light?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-4 pb-3">
      <div className="flex items-baseline gap-3 min-w-0 flex-none max-w-[75%]">
        <span className={cn("micro flex-none", light ? "text-acid" : "text-mute")}>{no}</span>
        <h2
          className={cn(
            "font-display text-[15px] font-semibold tracking-[0.1em] uppercase truncate",
            light ? "text-fog" : "text-ink",
          )}
        >
          {title}
        </h2>
      </div>
      <div className={cn("h-px flex-1 mx-1 hidden sm:block", light ? "bg-white/15" : "bg-line")} />
      {right}
    </div>
  );
}

/* ------------------------------------------------ page head */
export function PageHead({
  no,
  title,
  sub,
  right,
}: {
  no: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 mb-7">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="micro text-acid bg-chrome px-1.5 py-0.5">{no}</span>
          <span className="h-px w-10 bg-ink" />
          <Micro>WAYPOINT OPERATIONS</Micro>
        </div>
        <h1 className="font-display font-bold uppercase tracking-tight leading-none mt-3 text-[clamp(1.9rem,3.2vw,2.9rem)]">
          {title}
        </h1>
        {sub && <p className="micro-lg text-mute mt-2.5 normal-case tracking-[0.08em]">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/* ------------------------------------------------ status dot */
export function StatusDot({
  color = "var(--color-mint)",
  blink = true,
  className,
}: {
  color?: string;
  blink?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block size-[7px]", blink && "blink", className)}
      style={{ background: color }}
    />
  );
}

/* ------------------------------------------------ category tag */
export function textOn(color: string): string {
  return color === "#FFFA00" || color === "#00FFA2" ? "#191919" : "#F2F2EE";
}

export function CategoryTag({
  category,
  codeOnly,
  className,
}: {
  category?: Category;
  codeOnly?: boolean;
  className?: string;
}) {
  if (!category) return null;
  return (
    <span
      className={cn("tag", className)}
      style={{
        background: category.color,
        color: textOn(category.color),
        borderColor: "var(--color-line)",
      }}
    >
      {codeOnly ? category.code : `${category.code} — ${category.name.toUpperCase()}`}
    </span>
  );
}

/* ------------------------------------------------ priority tag */
export function PriorityTag({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  const styles: Record<Priority, string> = {
    critical: "bg-chrome text-acid border-chrome",
    high: "bg-acid text-acidink border-acidink",
    medium: "bg-transparent text-ink border-ink",
    low: "bg-transparent text-mute border-line",
  };
  return (
    <span className={cn("tag border", styles[priority])}>
      {priority === "critical" && <StatusDot color="var(--color-acid)" />}
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------ buttons */
type BtnVariant = "acid" | "dark" | "ghost";

export function Btn({
  variant = "dark",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      className={cn(
        "btn chamfer-sm",
        variant === "acid" && "btn-acid",
        variant === "dark" && "btn-dark",
        variant === "ghost" && "btn-ghost",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------ toggle switch */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? "toggle"}
      disabled={disabled}
      className={cn("wswitch", checked && "on")}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ------------------------------------------------ progress bar */
export function ProgressBar({ pct, dark }: { pct: number; dark?: boolean }) {
  return (
    <div
      className={cn(
        "relative h-[10px] border",
        dark ? "border-white/25 bg-white/5" : "border-ink bg-paper",
      )}
    >
      <motion.div
        className="absolute inset-y-0 left-0 bg-acid"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
      {[25, 50, 75].map((x) => (
        <span
          key={x}
          className={cn("absolute top-0 h-full w-px", dark ? "bg-white/20" : "bg-ink/25")}
          style={{ left: `${x}%` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------ empty state */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-line px-6 py-10 text-center">
      <div className="micro text-mute">{title}</div>
      {hint && <div className="micro mt-2 text-mute/70 normal-case tracking-normal">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------ animated count unit */
export function CountUnit({
  value,
  label,
  className,
  valueClassName,
}: {
  value: number;
  label: string;
  className?: string;
  valueClassName?: string;
}) {
  const reduce = useReducedMotion();
  const txt = pad2(value);
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={txt}
            initial={reduce ? { opacity: 0 } : { y: "0.55em", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: "-0.55em", opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={cn("block font-mono tnum leading-none", valueClassName)}
          >
            {txt}
          </motion.span>
        </AnimatePresence>
      </div>
      <span className="micro text-mute">{label}</span>
    </div>
  );
}
