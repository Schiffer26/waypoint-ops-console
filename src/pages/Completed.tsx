/**
 * SEC.05 — COMPLETED LOG
 * Audit trail of cleared objectives with restore and purge controls.
 */
import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Eraser, RotateCcw, Trash2 } from "lucide-react";
import { useOpsStore } from "@/store/useOpsStore";
import { useShell } from "@/lib/shell";
import { useNow } from "@/hooks/useNow";
import { fmtHM, fmtShort, fmtStamp, toISODate } from "@/lib/time";
import { instantChild, riseChild, staggerParent } from "@/lib/motion";
import {
  CategoryTag,
  EmptyState,
  Micro,
  PageHead,
  PriorityTag,
  Btn,
} from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

export default function Completed() {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const itemV = reduce ? instantChild : riseChild;
  const now = useNow(30_000);

  const tasks = useOpsStore((s) => s.tasks);
  const categories = useOpsStore((s) => s.categories);
  const hour24 = useOpsStore((s) => s.settings.hour24);
  const toggleTask = useOpsStore((s) => s.toggleTask);
  const deleteTask = useOpsStore((s) => s.deleteTask);
  const purgeCompleted = useOpsStore((s) => s.purgeCompleted);

  const done = useMemo(
    () =>
      tasks
        .filter((t) => t.completed)
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    [tasks],
  );

  const today = toISODate(now);
  const clearedToday = done.filter(
    (t) => t.completedAt && toISODate(new Date(t.completedAt)) === today,
  ).length;
  const weekAgo = now.getTime() - 7 * 86400000;
  const clearedWeek = done.filter((t) => (t.completedAt ?? 0) >= weekAgo).length;
  const clearedAllTime = done.length;

  return (
    <motion.div variants={reduce ? undefined : staggerParent} initial="hidden" animate="show">
      <PageHead
        no="SEC.05"
        title="Completed Log"
        sub="CLEARED OBJECTIVE LEDGER — REVERSE CHRONOLOGICAL"
        right={
          <Btn
            variant="ghost"
            disabled={done.length === 0}
            onClick={() =>
              shell.confirm({
                title: "PURGE COMPLETED LOG",
                body: `${done.length} cleared record${done.length === 1 ? "" : "s"} will be permanently deleted. This cannot be undone.`,
                confirmLabel: "PURGE ALL",
                danger: true,
                onConfirm: purgeCompleted,
              })
            }
          >
            <Eraser size={12} /> PURGE LOG
          </Btn>
        }
      />

      {/* stats strip */}
      <motion.div variants={itemV} className="grid grid-cols-3 gap-4 mb-7">
        {[
          { label: "CLEARED TODAY", value: clearedToday },
          { label: "CLEARED — 7D", value: clearedWeek },
          { label: "ALL TIME", value: clearedAllTime },
        ].map((s) => (
          <div key={s.label} className="panel px-5 py-4 panel-hover">
            <Micro>{s.label}</Micro>
            <div className="font-display font-bold text-4xl tnum mt-1.5">{s.value}</div>
          </div>
        ))}
      </motion.div>

      {done.length === 0 ? (
        <motion.div variants={itemV}>
          <EmptyState
            title="LEDGER EMPTY"
            hint="Cleared objectives will be filed here with timestamps."
          />
        </motion.div>
      ) : (
        <motion.div variants={itemV} className="panel">
          {done.map((t, i) => {
            const cat = categories.find((c) => c.id === t.categoryId);
            return (
              <motion.div
                key={t.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.25 }}
                className={cn(
                  "group flex items-center gap-4 px-5 py-3.5 hover:bg-paper transition-colors",
                  i > 0 && "border-t border-line",
                )}
              >
                <span className="size-[18px] bg-mint border border-acidink grid place-items-center flex-none">
                  <Check size={12} strokeWidth={3.5} className="text-ink" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-mute line-through truncate">
                    {t.title}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <CategoryTag category={cat} codeOnly />
                    <PriorityTag priority={t.priority} />
                  </div>
                </div>
                <div className="hidden md:block text-right flex-none">
                  <Micro className="block">CLEARED {fmtStamp(t.completedAt ?? t.updatedAt, hour24)}</Micro>
                  <Micro className="block text-mute/60 mt-1">
                    DUE {fmtShort(t.date)}
                    {t.dueTime ? ` · ${fmtHM(t.dueTime, hour24)}` : ""}
                  </Micro>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-none">
                  <button
                    className="icon-btn"
                    title="Restore to active registry"
                    onClick={() => toggleTask(t.id)}
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Purge permanently"
                    onClick={() =>
                      shell.confirm({
                        title: "PURGE RECORD",
                        body: `“${t.title}” will be permanently deleted from the ledger.`,
                        confirmLabel: "PURGE",
                        danger: true,
                        onConfirm: () => deleteTask(t.id),
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </motion.div>
  );
}
