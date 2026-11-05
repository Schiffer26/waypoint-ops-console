/**
 * DAILY BRIEFING — compact startup window (?window=briefing).
 *
 * A miniature operations readout rendered in its own small Electron window
 * when Windows launches WAYPOINT at login. Read-only: the console remains
 * the editing surface. Dismiss closes only this window; the application
 * continues in the system tray.
 */
import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Power, X } from "lucide-react";
import { useOpsStore, sortByDateTime } from "@/store/useOpsStore";
import { useNow } from "@/hooks/useNow";
import { useThemeSync } from "@/lib/theme";
import { bridge, isDesktop, resolveStorageBackend } from "@/lib/storage";
import {
  compactCountdown,
  fmtClock,
  fmtHM,
  isTaskOverdue,
  pad2,
  splitCountdown,
  toISODate,
} from "@/lib/time";
import {
  expandEvents,
  nextEventAfter,
  occurrenceIsLive,
  occurrenceStart,
} from "@/lib/schedule";
import { instantChild, riseChild, staggerParent } from "@/lib/motion";
import { CountUnit, Micro, StatusDot, CategoryTag } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

export default function Briefing() {
  useThemeSync();
  const reduce = useReducedMotion() ?? false;
  const itemV = reduce ? instantChild : riseChild;
  const now = useNow(1000);

  const tasks = useOpsStore((s) => s.tasks);
  const events = useOpsStore((s) => s.events);
  const categories = useOpsStore((s) => s.categories);
  const settings = useOpsStore((s) => s.settings);

  const today = toISODate(now);
  const todayTasks = useMemo(
    () => sortByDateTime(tasks.filter((t) => t.date === today)),
    [tasks, today],
  );
  const doneToday = todayTasks.filter((t) => t.completed).length;
  const overdue = tasks.filter((t) => isTaskOverdue(t, now));
  const todayEvents = useMemo(() => expandEvents(events, today, today), [events, today]);
  const next = nextEventAfter(events, now);
  const live = next ? occurrenceIsLive(next, now) : false;

  const allClear = overdue.length === 0;

  const openMain = () => {
    const b = bridge();
    if (b) void b.openMain();
    else window.location.href = window.location.pathname; // web preview fallback
  };
  const dismiss = () => {
    const b = bridge();
    if (b) void b.briefingDismiss();
    else window.close(); // web preview fallback (no-op for same-tab)
  };

  return (
    <motion.div
      variants={reduce ? undefined : staggerParent}
      initial="hidden"
      animate="show"
      className="h-full flex flex-col bg-paper text-ink select-none"
    >
      <div className="h-1.5 hazard flex-none" />

      {/* header — drag region for the frameless window */}
      <motion.header
        variants={itemV}
        className="drag-region bg-chrome text-fog px-5 py-3.5 flex items-center gap-3 flex-none"
      >
        <div className="size-7 bg-acid chamfer grid place-items-center flex-none">
          <span className="font-display font-black text-acidink text-sm">W</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold tracking-[0.26em] text-[12px] leading-none">
            WAYPOINT
          </div>
          <div className="micro text-fog/45 mt-1">
            DAILY BRIEFING — v0.3.0
          </div>
        </div>
        <Micro className="text-fog/45 tnum no-drag">{today}</Micro>
        <button
          onClick={dismiss}
          aria-label="Dismiss briefing"
          className="no-drag icon-btn border-white/25 text-fog/70 hover:bg-acid hover:text-acidink hover:border-acid size-[24px]"
        >
          <X size={12} />
        </button>
      </motion.header>

      {/* greeting + clock */}
      <motion.section variants={itemV} className="px-5 pt-5 pb-4 border-b border-line">
        <Micro>DAILY BRIEFING // SHIFT OPENING</Micro>
        <h1 className="font-display font-bold uppercase tracking-tight leading-none mt-2 text-[1.65rem]">
          {greetingLine(now)}{" "}
          <span className="bg-acid text-acidink px-1.5">{settings.operatorName.toUpperCase()}</span>
        </h1>
        <div className="flex items-end justify-between mt-3">
          <div className="font-mono tnum text-3xl leading-none">
            {fmtClock(now, settings.hour24)}
          </div>
          <div className="micro text-mute flex items-center gap-2">
            <StatusDot color={allClear ? "var(--color-mint)" : "var(--color-acid)"} />
            {allClear ? "ALL SYSTEMS NOMINAL" : "ATTENTION REQUIRED"}
          </div>
        </div>
      </motion.section>

      {/* stat strip */}
      <motion.section variants={itemV} className="grid grid-cols-3 flex-none">
        {[
          { label: "TODAY", value: todayTasks.length },
          { label: "CLEARED", value: doneToday },
          { label: "OVERDUE", value: overdue.length, alert: overdue.length > 0 },
        ].map((s) => (
          <div
            key={s.label}
            className={cn(
              "px-4 py-3 border-r border-line last:border-r-0",
              s.alert && "bg-acid/15",
            )}
          >
            <Micro>{s.label}</Micro>
            <div className="font-display font-bold text-3xl tnum leading-none mt-1.5">
              {pad2(s.value)}
            </div>
          </div>
        ))}
      </motion.section>

      {/* today's transmissions */}
      <motion.section variants={itemV} className="px-5 py-4 border-t border-line flex-none">
        <div className="flex items-center gap-3 mb-2.5">
          <Micro className="text-acid bg-chrome px-1.5 py-0.5">SCHEDULE</Micro>
          <span className="h-px flex-1 bg-line" />
          <Micro>TODAY x{todayEvents.length}</Micro>
        </div>
        {todayEvents.length === 0 ? (
          <Micro className="block py-1">NO TRANSMISSIONS SCHEDULED TODAY</Micro>
        ) : (
          <div className="space-y-1.5">
            {todayEvents.slice(0, 3).map((o) => (
              <div key={`${o.id}:${o.occurrenceDate}`} className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] tnum text-mute w-[72px] flex-none">
                  {o.startTime}
                </span>
                <span className="text-[12.5px] font-semibold truncate flex-1">{o.title}</span>
                <CategoryTag
                  category={categories.find((c) => c.id === o.categoryId)}
                  codeOnly
                />
              </div>
            ))}
            {todayEvents.length > 3 && (
              <Micro className="block pt-0.5">+{todayEvents.length - 3} FURTHER ENTRIES</Micro>
            )}
          </div>
        )}
      </motion.section>

      {/* next event countdown */}
      <motion.section variants={itemV} className="px-5 py-4 flex-none">
        <div className="panel-ink brackets-acid relative overflow-hidden px-4 py-3.5">
          <div className="absolute inset-0 grid-bg-dark pointer-events-none" />
          {next ? (
            <div className="relative flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Micro className="text-acid">{live ? "IN PROGRESS" : "NEXT TRANSMISSION"}</Micro>
                <div className="font-display font-semibold text-fog text-[15px] truncate mt-1">
                  {next.title}
                </div>
                <div className="micro text-fog/50 mt-1 tnum">
                  {next.occurrenceDate} · {fmtHM(next.startTime, settings.hour24)}—
                  {fmtHM(next.endTime, settings.hour24)}
                </div>
              </div>
              {(() => {
                const diff = occurrenceStart(next) - now.getTime();
                if (live)
                  return (
                    <span className="tag bg-mint text-acidink border border-acidink tnum !py-1.5 flex-none">
                      <StatusDot color="var(--color-acidink)" /> LIVE
                    </span>
                  );
                if (diff < 86400000) {
                  const cd = splitCountdown(diff);
                  return (
                    <div className="flex items-end gap-2 flex-none">
                      <CountUnit value={cd.h} label="HRS" valueClassName="text-2xl text-acid font-medium" />
                      <span className="font-mono text-acid/50 text-xl pb-5">:</span>
                      <CountUnit value={cd.m} label="MIN" valueClassName="text-2xl text-acid font-medium" />
                      <span className="font-mono text-acid/50 text-xl pb-5">:</span>
                      <CountUnit value={cd.s} label="SEC" valueClassName="text-2xl text-acid font-medium" />
                    </div>
                  );
                }
                return (
                  <span className="tag bg-chrome text-acid border border-white/20 tnum !py-1.5 flex-none">
                    T-{compactCountdown(diff)}
                  </span>
                );
              })()}
            </div>
          ) : (
            <div className="relative">
              <Micro className="text-fog/50">NO SCHEDULED TRANSMISSIONS IN RANGE</Micro>
            </div>
          )}
        </div>
      </motion.section>

      {/* footer actions */}
      <motion.footer
        variants={itemV}
        className="mt-auto border-t border-line bg-surface2 px-5 py-4 flex-none"
      >
        <div className="flex gap-2">
          <button onClick={openMain} className="btn btn-acid chamfer-sm flex-1 justify-center">
            OPEN MAIN CONSOLE
          </button>
          <button onClick={dismiss} className="btn btn-ghost chamfer-sm">
            <Power size={11} /> DISMISS
          </button>
        </div>
        <div className="micro text-mute mt-3 flex items-center justify-between">
          <span>{isDesktop() ? "DESKTOP LINK LIVE" : "WEB PREVIEW"} · {resolveStorageBackend().name}</span>
          <span className="flex items-center gap-1.5">
            <StatusDot /> TRAY-DORMANT AFTER DISMISS
          </span>
        </div>
      </motion.footer>
    </motion.div>
  );
}

function greetingLine(now: Date): string {
  const h = now.getHours();
  if (h < 5) return "LATE SHIFT,";
  if (h < 12) return "GOOD MORNING,";
  if (h < 18) return "GOOD AFTERNOON,";
  return "GOOD EVENING,";
}
