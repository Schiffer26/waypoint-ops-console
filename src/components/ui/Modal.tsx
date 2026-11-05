import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { EASE } from "@/lib/motion";
import { Btn } from "@/components/ui/primitives";
import type { ConfirmOpts } from "@/lib/shell";
import { cn } from "@/utils/cn";

/** Backdrop shared by modal surfaces. */
export function Backdrop({ onClick }: { onClick: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-40 bg-chrome/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
    />
  );
}

/** Right-anchored slide-over frame used by the entry editor. */
export function SlideOver({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <>
      <Backdrop onClick={onClose} />
      <motion.aside
        role="dialog"
        aria-modal="true"
        className="fixed right-0 top-0 z-50 h-full w-full max-w-[520px] bg-surface border-l border-ink flex flex-col shadow-[-16px_0_48px_rgba(25,25,25,0.25)]"
        initial={reduce ? { opacity: 0 } : { x: 80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { x: 80, opacity: 0 }}
        transition={{ duration: 0.34, ease: EASE }}
      >
        <div className="h-1 hazard" />
        <header className="bg-chrome text-fog px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="micro text-acid">{subtitle}</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-[0.06em] mt-1 truncate">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="icon-btn border-white/25 text-fog/70 hover:bg-acid hover:text-ink hover:border-acid"
          >
            <X size={14} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        <footer className="border-t border-line px-6 py-4 flex items-center justify-between gap-3 bg-surface2">
          {footer}
        </footer>
      </motion.aside>
    </>
  );
}

/** Centered confirm dialog driven through the shell context. */
export function ConfirmDialog({
  opts,
  onClose,
}: {
  opts: ConfirmOpts;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <>
      <Backdrop onClick={onClose} />
      <motion.div
        role="alertdialog"
        aria-modal="true"
        className="fixed inset-0 z-50 grid place-items-center p-6 pointer-events-none"
      >
        <motion.div
          className="pointer-events-auto w-full max-w-[400px] bg-surface border border-ink brackets"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.26, ease: EASE }}
        >
          <div className={cn("h-1", opts.danger ? "hazard" : "bg-acid")} />
          <div className="px-6 py-5">
            <div className="micro text-mute">CONFIRM ACTION</div>
            <h3 className="font-display text-lg font-bold uppercase tracking-[0.05em] mt-1">
              {opts.title}
            </h3>
            <p className="text-[13px] text-mute mt-2 leading-relaxed">{opts.body}</p>
            <div className="flex justify-end gap-2 mt-6">
              <Btn variant="ghost" onClick={onClose}>
                ABORT
              </Btn>
              <Btn
                variant={opts.danger ? "dark" : "acid"}
                onClick={() => {
                  opts.onConfirm();
                  onClose();
                }}
              >
                {opts.confirmLabel ?? "CONFIRM"}
              </Btn>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
