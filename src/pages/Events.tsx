/**
 * SEC.04 — UPCOMING EVENTS
 * Chronological transmission schedule with a featured next-event countdown,
 * repeats expanded across a 90-day horizon, plus a past-archive drawer.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarPlus, ChevronDown } from "lucide-react";
import { useOpsStore } from "@/store/useOpsStore";
import { useShell } from "@/lib/shell";
import { useNow } from "@/hooks/useNow";
import {
  addDaysISO,
  fmtHM,
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
  CategoryTag,
  CountUnit,
  EmptyState,
  Micro,
  PageHead,
  SectionHead,
  StatusDot,
} from "@/components/ui/primitives";
import { EventRow } from "@/components/rows";
import type { EventOccurrence } from "@/types";
import { cn } from "@/utils/cn";

export default function Events() {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const itemV = reduce ? instantChild : riseChild;
  const now = useNow(1000);

  const events = useOpsStore((s) => s.events);
  const categories = useOpsStore((s) => s.categories);
  const hour24 = useOpsStore((s) => s.settings.hour24);
  const [showArchive, setShowArchive] = useState(false);

  const today = toISODate(now);
  const next = nextEventAfter(events, now);

  const groups = useMemo(() => {
    const occ = expandEvents(events, today, addDaysISO(today, 90)).filter(
      (o) => occurrenceEnd(o) >= now.getTime(),
    );
    const g: { key: string; label: string; items: EventOccurrence[] }[] = [];
    const push = (key: string, label: string, items: EventOccurrence[]) => {
      if (items.length) g.push({ key, label, items });
    };
    push("today", "TODAY", occ.filter((o) => o.occurrenceDate === today));
    push(
      "tomorrow",
      "TOMORROW",
      occ.filter((o) => o.occurrenceDate === addDaysISO(today, 1)),
    );
    push(
      "week",
      "THIS WEEK",
      occ.filter(
        (o) => o.occurrenceDate > addDaysISO(today, 1) && o.occurrenceDate <= addDaysISO(today, 7),
      ),
    );
    push("later", "LATER — T+8D ONWARD", occ.filter((o) => o.occurrenceDate > addDaysISO(today, 7)));
    return g;
  }, [events, now, today]);

  const archive = useMemo(
    () =>
      events
        .filter((e) => e.date < today)
        .sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`))
        .slice(0, 10),
    [events, today],
  );

  const nextLive = next ? occurrenceIsLive(next, now) : false;
  const cd = splitCountdown(
    (next ? (nextLive ? occurrenceEnd(next) : occurrenceStart(next)) : 0) - now.getTime(),
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <motion.div variants={reduce ? undefined : staggerParent} initial="hidden" animate="show">
      <PageHead
        no="SEC.04"
        title="Upcoming Events"
        sub={`${total} TRANSMISSION${total === 1 ? "" : "S"} WITHIN T+90D HORIZON`}
        right={
          <Btn variant="acid" onClick={() => shell.openCreate("event", today)}>
            <CalendarPlus size={12} /> SCHEDULE EVENT
          </Btn>
        }
      />

      {/* featured countdown */}
      {next && (
        <motion.section
          variants={itemV}
          className="panel-ink brackets-acid relative overflow-hidden mb-6"
        >
          <div className="absolute inset-0 grid-bg-dark pointer-events-none" />
          <div className="relative px-6 lg:px-8 py-6 flex flex-wrap items-center gap-x-10 gap-y-6">
            <div className="min-w-0 flex-1">
              <Micro className="text-acid">NEXT ON SCHEDULE</Micro>
              <div className="font-display font-bold text-fog text-2xl uppercase tracking-tight mt-2 truncate">
                {next.title}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <CategoryTag category={categories.find((c) => c.id === next.categoryId)} />
                <span className="tag tag-outline border-white/25! text-fog/70! tnum">
                  {next.occurrenceDate} · {fmtHM(next.startTime, hour24)}—
                  {fmtHM(next.endTime, hour24)}
                </span>
                {nextLive && (
                  <span className="tag bg-mint text-acidink border border-acidink">
                    <StatusDot color="var(--color-ink)" /> IN PROGRESS
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-end gap-3 flex-none">
              <CountUnit value={cd.d} label="DAYS" valueClassName="text-5xl text-acid font-medium" />
              <span className="font-mono text-acid/50 text-4xl pb-7">:</span>
              <CountUnit value={cd.h} label="HRS" valueClassName="text-5xl text-acid font-medium" />
              <span className="font-mono text-acid/50 text-4xl pb-7">:</span>
              <CountUnit value={cd.m} label="MIN" valueClassName="text-5xl text-acid font-medium" />
              <span className="font-mono text-acid/50 text-4xl pb-7">:</span>
              <CountUnit value={cd.s} label="SEC" valueClassName="text-5xl text-acid font-medium" />
            </div>
            <Btn
              variant="acid"
              className="flex-none"
              onClick={() => shell.openEdit(next)}
            >
              OPEN RECORD
            </Btn>
          </div>
        </motion.section>
      )}

      {total === 0 && !next ? (
        <motion.div variants={itemV}>
          <EmptyState
            title="NO TRANSMISSIONS IN THE T+90D HORIZON"
            hint="Schedule an event to populate the uplink schedule."
            action={
              <Btn variant="acid" onClick={() => shell.openCreate("event", today)}>
                <CalendarPlus size={12} /> SCHEDULE FIRST EVENT
              </Btn>
            }
          />
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-x-6 gap-y-8 items-start">
          {groups.map((g) => (
            <motion.section key={g.key} variants={itemV}>
              <SectionHead
                no={g.key.toUpperCase()}
                title={g.label}
                right={<Micro className="tnum">x{g.items.length}</Micro>}
              />
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {g.items.map((o) => (
                    <EventRow key={`${o.id}:${o.occurrenceDate}`} occ={o} now={now} />
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          ))}
        </div>
      )}

      {/* archive drawer */}
      {archive.length > 0 && (
        <motion.section variants={itemV} className="mt-10">
          <button
            onClick={() => setShowArchive((v) => !v)}
            className="flex items-center gap-3 w-full text-left group"
          >
            <ChevronDown
              size={14}
              className={cn("text-mute transition-transform duration-300", showArchive && "rotate-180")}
            />
            <span className="micro-lg text-mute group-hover:text-ink transition-colors">
              PAST TRANSMISSIONS — ARCHIVE
            </span>
            <span className="h-px flex-1 bg-line" />
            <Micro className="tnum">x{archive.length}</Micro>
          </button>
          <AnimatePresence initial={false}>
            {showArchive && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="space-y-2 pt-4 opacity-75">
                  {archive.map((e) => (
                    <EventRow
                      key={e.id}
                      occ={{ ...e, occurrenceDate: e.date }}
                      now={now}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      )}
    </motion.div>
  );
}
