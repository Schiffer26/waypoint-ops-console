/**
 * SEC.01 — DASHBOARD
 * Operations briefing: greeting, live clock, next-event countdown,
 * daily throughput, overdue alerts, today's objectives, upcoming events.
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CalendarPlus, CircleCheckBig, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useOpsStore, sortByDateTime } from "@/store/useOpsStore";
import { useShell } from "@/lib/shell";
import { useNow } from "@/hooks/useNow";
import {
  addDaysISO,
  dayOfYear,
  fmtClock,
  fmtHM,
  isoWeek,
  isTaskOverdue,
  pad2,
  splitCountdown,
  toISODate,
} from "@/lib/time";
import {
  expandEvents,
  nextEventAfter,
  occurrenceEnd,
  occurrenceIsLive,
  occurrenceStart,
} from "@/lib/schedule";
import { instantChild, riseChild, staggerParent } from "@/lib/motion";
import {
  Btn,
  CountUnit,
  EmptyState,
  Micro,
  ProgressBar,
  SectionHead,
  StatusDot,
} from "@/components/ui/primitives";
import { PriorityTag } from "@/components/ui/primitives";
import { EventRow, TaskRow } from "@/components/rows";
import { cn } from "@/utils/cn";

function Panel({
  children,
  className,
  variants,
}: {
  children: ReactNode;
  className?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variants?: any;
}) {
  return (
    <motion.section variants={variants} className={cn("panel", className)}>
      {children}
    </motion.section>
  );
}

export default function Dashboard() {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const itemV = reduce ? instantChild : riseChild;
  const now = useNow(1000);

  const tasks = useOpsStore((s) => s.tasks);
  const events = useOpsStore((s) => s.events);
  const settings = useOpsStore((s) => s.settings);
  const reschedule = useOpsStore((s) => s.reschedule);

  const today = toISODate(now);
  const todayTasks = sortByDateTime(tasks.filter((t) => t.date === today));
  const doneToday = todayTasks.filter((t) => t.completed).length;
  const activeTotal = tasks.filter((t) => !t.completed).length;
  const overdue = sortByDateTime(tasks.filter((t) => isTaskOverdue(t, now)));
  const next = nextEventAfter(events, now);
  const upcoming = expandEvents(events, today, addDaysISO(today, 10))
    .filter((o) => occurrenceEnd(o) >= now.getTime())
    .slice(0, 5);
  const pct = todayTasks.length ? Math.round((doneToday / todayTasks.length) * 100) : 0;

  const nextLive = next ? occurrenceIsLive(next, now) : false;
  const targetMs = next ? (nextLive ? occurrenceEnd(next) : occurrenceStart(next)) : 0;
  const cd = splitCountdown(targetMs - now.getTime());

  return (
    <motion.div
      variants={reduce ? undefined : staggerParent}
      initial="hidden"
      animate="show"
      className="grid grid-cols-12 gap-4 lg:gap-5"
    >
      {/* ============ HERO ============ */}
      <Panel variants={itemV} className="col-span-12 brackets relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 dotgrid-soft opacity-60 pointer-events-none" />
        <div className="relative px-6 lg:px-9 py-8 lg:py-10 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <Micro>
              SYS.DATE {today} — OPERATIONS BRIEFING
            </Micro>
            <h1 className="font-display font-bold uppercase leading-[0.95] tracking-tight mt-4 text-[clamp(2rem,4.2vw,3.6rem)]">
              {greetingLine(now)}
              <br />
              <span className="bg-acid text-acidink px-2 -ml-2 box-decoration-clone">
                {settings.operatorName.toUpperCase()}.
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5">
              <Micro>
                DAY {pad2(dayOfYear(now))}/365 · WK {pad2(isoWeek(now))}
              </Micro>
              <Micro>{activeTotal} ACTIVE OBJECTIVES</Micro>
              <Micro>{events.length} SCHEDULED TRANSMISSIONS</Micro>
            </div>
            <div className="flex flex-wrap gap-2 mt-6">
              <Btn variant="acid" onClick={() => shell.openCreate("task", today)}>
                <Plus size={12} /> LOG TASK
              </Btn>
              <Btn variant="dark" onClick={() => shell.openCreate("event", today)}>
                <CalendarPlus size={12} /> LOG EVENT
              </Btn>
            </div>
          </div>
          <div className="hidden md:block text-right flex-none">
            <Micro className="mb-1 block">LOCAL TIME</Micro>
            <div className="font-mono tnum font-medium text-[clamp(2.2rem,3.6vw,3.4rem)] leading-none">
              {fmtClock(now, settings.hour24)}
            </div>
            <div className="micro text-mute mt-2 flex items-center justify-end gap-2">
              <StatusDot /> SYNC ACTIVE — {settings.hour24 ? "24H" : "12H"} FORMAT
            </div>
          </div>
        </div>
      </Panel>

      {/* ============ NEXT EVENT / COUNTDOWN ============ */}
      <Panel variants={itemV} className="col-span-12 md:col-span-6 xl:col-span-5 panel-ink brackets-acid relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-dark pointer-events-none" />
        <div className="relative px-6 py-5 lg:px-7 lg:py-6 h-full flex flex-col">
          <SectionHead
            no="SEC.01"
            title="Next Transmission"
            light
            right={
              nextLive ? (
                <span className="tag bg-mint text-acidink border-acidink border">
                  <StatusDot color="var(--color-ink)" /> LIVE NOW
                </span>
              ) : (
                <Micro className="text-fog/40">T-MINUS</Micro>
              )
            }
          />
          {next ? (
            <>
              <div className="mt-2 min-w-0">
                <div className="font-display font-semibold text-fog text-lg truncate">
                  {next.title}
                </div>
                <div className="micro text-fog/50 mt-1.5 tnum">
                  {next.occurrenceDate} · {fmtHM(next.startTime, settings.hour24)}—
                  {fmtHM(next.endTime, settings.hour24)}
                </div>
              </div>
              <div className="mt-auto pt-6 flex items-end justify-between gap-2">
                <CountUnit value={cd.d} label="DAYS" valueClassName="text-4xl lg:text-5xl text-acid font-medium" />
                <span className="font-mono text-acid/50 text-3xl pb-6">:</span>
                <CountUnit value={cd.h} label="HRS" valueClassName="text-4xl lg:text-5xl text-acid font-medium" />
                <span className="font-mono text-acid/50 text-3xl pb-6">:</span>
                <CountUnit value={cd.m} label="MIN" valueClassName="text-4xl lg:text-5xl text-acid font-medium" />
                <span className="font-mono text-acid/50 text-3xl pb-6">:</span>
                <CountUnit value={cd.s} label="SEC" valueClassName="text-4xl lg:text-5xl text-acid font-medium" />
              </div>
              <button
                onClick={() => shell.openEdit(next)}
                className="micro text-fog/40 hover:text-acid transition-colors text-left mt-4 flex items-center gap-1.5"
              >
                OPEN RECORD <ArrowRight size={10} />
              </button>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-start justify-center gap-4 py-6">
              <Micro className="text-fog/50">NO SCHEDULED TRANSMISSIONS IN RANGE</Micro>
              <Btn variant="acid" onClick={() => shell.openCreate("event", today)}>
                <CalendarPlus size={12} /> SCHEDULE EVENT
              </Btn>
            </div>
          )}
        </div>
      </Panel>

      {/* ============ DAILY THROUGHPUT ============ */}
      <Panel variants={itemV} className="col-span-12 md:col-span-6 xl:col-span-4 panel-hover">
        <div className="px-6 py-5 lg:px-7 lg:py-6 h-full flex flex-col">
          <SectionHead
            no="SEC.02"
            title="Daily Throughput"
            right={<Micro className="tnum flex-none">{doneToday}/{todayTasks.length}</Micro>}
          />
          <div className="flex items-end gap-3 mt-2">
            <span className="font-display font-bold tnum leading-none text-[4.2rem] tracking-tight">
              {pct}
            </span>
            <span className="font-mono text-mute text-lg pb-1.5">%</span>
          </div>
          <div className="mt-4">
            <ProgressBar pct={pct} />
          </div>
          {todayTasks.length > 0 ? (
            <div className="flex gap-1 mt-4">
              {todayTasks.map((t) => (
                <span
                  key={t.id}
                  title={t.title}
                  className={cn(
                    "h-2 flex-1 border border-acidink transition-colors duration-500",
                    t.completed ? "bg-acid" : "bg-surface",
                  )}
                />
              ))}
            </div>
          ) : (
            <Micro className="mt-4">NO OBJECTIVES LOGGED FOR TODAY</Micro>
          )}
          <Micro className="mt-auto block pt-5 text-mute/80 normal-case tracking-wide">
            {pct === 100 && todayTasks.length > 0
              ? "ALL OBJECTIVES CLEARED — EXCELLENT WORK."
              : "Completion is measured against objectives due today."}
          </Micro>
        </div>
      </Panel>

      {/* ============ ATTENTION / OVERDUE ============ */}
      <Panel
        variants={itemV}
        className={cn(
          "col-span-12 md:col-span-6 xl:col-span-3 panel-hover",
          overdue.length > 0 && "border-ink",
        )}
      >
        {overdue.length > 0 ? (
          <div className="h-full flex flex-col">
            <div className="hazard h-2" />
            <div className="px-6 py-5 lg:px-6 flex-1 flex flex-col">
              <SectionHead
                no="SEC.03"
                title="Overdue"
                right={
                  <span className="tag bg-chrome text-acid border-chrome border tnum">
                    x{overdue.length}
                  </span>
                }
              />
              <div className="space-y-2 mt-1">
                {overdue.slice(0, 3).map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5">
                    <PriorityTag priority={t.priority} />
                    <span className="text-[12.5px] font-medium truncate flex-1">{t.title}</span>
                    <button
                      className="icon-btn size-[22px]"
                      title="Push to tomorrow"
                      onClick={() => reschedule("task", t.id, addDaysISO(today, 1))}
                    >
                      <ArrowRight size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => shell.navigate("tasks")}
                className="micro text-mute hover:text-ink transition-colors text-left mt-auto pt-4 flex items-center gap-1.5"
              >
                REVIEW REGISTRY <ArrowRight size={10} />
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full px-6 py-5 flex flex-col">
            <div className="h-2 bg-mint border-b border-acidink -mx-6 -mt-5 mb-5" />
            <SectionHead no="SEC.03" title="Overdue" />
            <div className="flex-1 flex flex-col justify-center gap-3">
              <CircleCheckBig size={22} className="text-ink" strokeWidth={1.75} />
              <div className="font-display font-semibold uppercase tracking-wide text-sm">
                All clear
              </div>
              <Micro className="normal-case tracking-wide text-mute/80">
                No overdue objectives on record.
              </Micro>
            </div>
          </div>
        )}
      </Panel>

      {/* ============ TODAY'S OPERATIONS ============ */}
      <Panel variants={itemV} className="col-span-12 xl:col-span-7 panel-hover">
        <div className="px-6 py-5 lg:px-7 lg:py-6">
          <SectionHead
            no="SEC.04"
            title="Today's Operations"
            right={
              <button
                onClick={() => shell.navigate("tasks")}
                className="micro text-mute hover:text-ink transition-colors flex items-center gap-1.5"
              >
                OPEN REGISTRY <ArrowRight size={10} />
              </button>
            }
          />
          {todayTasks.length === 0 ? (
            <EmptyState
              title="NO OBJECTIVES LOGGED FOR TODAY"
              hint="The board is clean. Log a task to begin tracking."
              action={
                <Btn variant="acid" onClick={() => shell.openCreate("task", today)}>
                  <Plus size={12} /> LOG TASK
                </Btn>
              }
            />
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {todayTasks.map((t) => (
                  <TaskRow key={t.id} task={t} now={now} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </Panel>

      {/* ============ UPCOMING EVENTS ============ */}
      <Panel variants={itemV} className="col-span-12 xl:col-span-5 panel-hover">
        <div className="px-6 py-5 lg:px-7 lg:py-6">
          <SectionHead
            no="SEC.05"
            title="Upcoming Events"
            right={
              <button
                onClick={() => shell.navigate("events")}
                className="micro text-mute hover:text-ink transition-colors flex items-center gap-1.5"
              >
                FULL SCHEDULE <ArrowRight size={10} />
              </button>
            }
          />
          {upcoming.length === 0 ? (
            <EmptyState
              title="NO TRANSMISSIONS WITHIN T+10D"
              action={
                <Btn variant="acid" onClick={() => shell.openCreate("event")}>
                  <CalendarPlus size={12} /> SCHEDULE EVENT
                </Btn>
              }
            />
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {upcoming.map((o) => (
                  <EventRow key={`${o.id}:${o.occurrenceDate}`} occ={o} now={now} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </Panel>
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
