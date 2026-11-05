/**
 * Shared row renderers for tasks and events — used by Dashboard, Tasks,
 * Events and Calendar pages so behaviour stays consistent everywhere.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Pencil, Repeat, Trash2 } from "lucide-react";
import type { EventOccurrence, TaskEntry } from "@/types";
import { useOpsStore } from "@/store/useOpsStore";
import { useShell } from "@/lib/shell";
import {
  addDaysISO,
  compactCountdown,
  fmtHM,
  fromISODate,
  isTaskOverdue,
  relLabel,
} from "@/lib/time";
import { occurrenceEnd, occurrenceIsLive, occurrenceStart } from "@/lib/schedule";
import { CategoryTag, PriorityTag } from "@/components/ui/primitives";
import { EASE } from "@/lib/motion";
import { cn } from "@/utils/cn";

const rowExit = { opacity: 0, x: -32, transition: { duration: 0.22, ease: "easeIn" as const } };
const rowInitial = { opacity: 0, y: 12 };
const rowAnimate = { opacity: 1, x: 0, y: 0, transition: { duration: 0.3, ease: EASE } };

/* ================================================================ TASK ROW */
export function TaskRow({
  task,
  now,
  dense,
}: {
  task: TaskEntry;
  now: Date;
  dense?: boolean;
}) {
  const shell = useShell();
  const categories = useOpsStore((s) => s.categories);
  const hour24 = useOpsStore((s) => s.settings.hour24);
  const toggleTask = useOpsStore((s) => s.toggleTask);
  const deleteTask = useOpsStore((s) => s.deleteTask);
  const reschedule = useOpsStore((s) => s.reschedule);
  const [striking, setStriking] = useState(false);

  const cat = categories.find((c) => c.id === task.categoryId);
  const overdue = isTaskOverdue(task, now);
  const done = striking || task.completed;

  const toggle = () => {
    if (task.completed) {
      toggleTask(task.id);
      return;
    }
    // Play the completion strike first, then commit to the store so the
    // exit animation reads as a deliberate "clearing" action.
    setStriking(true);
    window.setTimeout(() => toggleTask(task.id), 520);
  };

  return (
    <motion.div
      layout="position"
      initial={rowInitial}
      animate={rowAnimate}
      exit={rowExit}
      className={cn(
        "group relative flex items-start gap-3 border px-3.5 transition-colors duration-200",
        dense ? "py-2.5" : "py-3.5",
        overdue && !done
          ? "border-ink bg-acid/10"
          : "border-line bg-surface hover:border-ink",
        done && "opacity-55",
      )}
    >
      {overdue && !done && <span className="absolute inset-y-0 left-0 w-1 hazard-soft" />}
      <button
        onClick={toggle}
        aria-label={task.completed ? "Restore task" : "Complete task"}
        className={cn(
          "mt-0.5 size-[18px] flex-none border transition-all duration-200 grid place-items-center",
          done ? "bg-mint border-acidink" : "border-ink bg-surface hover:bg-acid",
        )}
      >
        <AnimatePresence>
          {done && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
            >
              <Check size={12} strokeWidth={3.5} className="text-acidink" />
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <div className="min-w-0 flex-1">
        <div className="relative inline-block max-w-full">
          <span
            className={cn(
              "font-display font-semibold text-[13.5px] leading-snug block truncate",
              done ? "text-mute" : "text-ink",
            )}
          >
            {task.title}
          </span>
          <motion.span
            className="absolute left-0 top-[55%] h-[1.5px] w-full bg-ink origin-left"
            initial={false}
            animate={{ scaleX: done ? 1 : 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          />
        </div>
        {!dense && task.description && (
          <p className="text-[12px] text-mute leading-relaxed mt-0.5 line-clamp-1">
            {task.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <CategoryTag category={cat} codeOnly />
          <PriorityTag priority={task.priority} />
          {task.repeat !== "none" && (
            <span className="tag tag-outline">
              <Repeat size={9} /> {task.repeat.toUpperCase()}
            </span>
          )}
          <span className={cn("tag tag-outline tnum", overdue && !done && "border-acidink! text-acidink! bg-acid")}>
            {relLabel(task.date, now)}
            {task.dueTime && <> · {fmtHM(task.dueTime, hour24)}</>}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          className="icon-btn"
          title="Edit record"
          onClick={() => shell.openEdit(task)}
        >
          <Pencil size={12} />
        </button>
        {!task.completed && (
          <button
            className="icon-btn"
            title="Push +1 day"
            onClick={() => reschedule("task", task.id, addDaysISO(task.date, 1))}
          >
            <ArrowRight size={12} />
          </button>
        )}
        <button
          className="icon-btn danger"
          title="Purge record"
          onClick={() =>
            shell.confirm({
              title: "PURGE TASK",
              body: `“${task.title}” will be permanently removed.`,
              confirmLabel: "PURGE",
              danger: true,
              onConfirm: () => deleteTask(task.id),
            })
          }
        >
          <Trash2 size={12} />
        </button>
      </div>
    </motion.div>
  );
}

/* =============================================================== EVENT ROW */
export function EventRow({
  occ,
  now,
  showDate = true,
}: {
  occ: EventOccurrence;
  now: Date;
  showDate?: boolean;
}) {
  const shell = useShell();
  const categories = useOpsStore((s) => s.categories);
  const hour24 = useOpsStore((s) => s.settings.hour24);
  const deleteEvent = useOpsStore((s) => s.deleteEvent);
  const cat = categories.find((c) => c.id === occ.categoryId);

  const live = occurrenceIsLive(occ, now);
  const startMs = occurrenceStart(occ);
  const endMs = occurrenceEnd(occ);
  const d = fromISODate(occ.occurrenceDate);

  return (
    <motion.div
      layout="position"
      initial={rowInitial}
      animate={rowAnimate}
      exit={rowExit}
      className={cn(
        "group flex items-center gap-3.5 border px-3.5 py-3 transition-colors duration-200",
        live ? "border-ink bg-surface" : "border-line bg-surface hover:border-ink",
      )}
    >
      {showDate && (
        <div
          className={cn(
            "flex flex-col items-center justify-center w-[46px] flex-none border py-1.5",
            live ? "bg-chrome text-acid border-chrome" : "border-line",
          )}
        >
          <span className="font-display font-bold text-lg leading-none tnum">
            {String(d.getDate()).padStart(2, "0")}
          </span>
          <span className={cn("micro mt-0.5", live ? "text-acid/80" : "text-mute")}>
            {["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getMonth()]}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-display font-semibold text-[13.5px] truncate">{occ.title}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <CategoryTag category={cat} codeOnly />
          <span className="tag tag-outline tnum">
            {fmtHM(occ.startTime, hour24)} — {fmtHM(occ.endTime, hour24)}
          </span>
          {occ.repeat !== "none" && (
            <span className="tag tag-outline">
              <Repeat size={9} /> {occ.repeat.toUpperCase()}
            </span>
          )}
        </div>
      </div>
      <span
        className={cn(
          "tag border tnum flex-none",
          live ? "bg-mint border-acidink text-acidink" : "tag-outline",
        )}
      >
        {endMs < now.getTime()
          ? "LOGGED"
          : live
            ? `LIVE · ${compactCountdown(endMs - now.getTime())} LEFT`
            : `IN ${compactCountdown(startMs - now.getTime())}`}
      </span>
      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button className="icon-btn" title="Edit record" onClick={() => shell.openEdit(occ)}>
          <Pencil size={12} />
        </button>
        <button
          className="icon-btn danger"
          title="Purge record"
          onClick={() =>
            shell.confirm({
              title: "PURGE EVENT",
              body: `“${occ.title}” will be permanently removed${occ.repeat !== "none" ? " (all repeats)" : ""}.`,
              confirmLabel: "PURGE",
              danger: true,
              onConfirm: () => deleteEvent(occ.id),
            })
          }
        >
          <Trash2 size={12} />
        </button>
      </div>
    </motion.div>
  );
}
