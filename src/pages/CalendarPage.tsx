/**
 * SEC.03 — CALENDAR MATRIX
 * Monthly grid with task/event indicators, week strip view and a day
 * timeline. Tasks render as hollow markers, events as filled markers,
 * tinted by category. Selecting a date opens the detail rail.
 */
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CalendarPlus, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Category, EventOccurrence, TaskEntry } from "@/types";
import { useOpsStore } from "@/store/useOpsStore";
import { useShell } from "@/lib/shell";
import { useNow } from "@/hooks/useNow";
import {
  addDaysISO,
  DAYS_SHORT,
  fromISODate,
  MONTHS_SHORT,
  pad2,
  timeToMin,
  toISODate,
  todayISO,
  fmtHM,
} from "@/lib/time";
import { expandEvents } from "@/lib/schedule";
import { instantChild, riseChild, staggerParent } from "@/lib/motion";
import { Btn, Micro, PageHead, SectionHead } from "@/components/ui/primitives";
import { EventRow, TaskRow } from "@/components/rows";
import { cn } from "@/utils/cn";

type ViewMode = "month" | "week" | "day";
type CellItem = { kind: "task"; task: TaskEntry } | { kind: "event"; occ: EventOccurrence };

const dayKey = (it: CellItem) => (it.kind === "task" ? `t:${it.task.id}` : `e:${it.occ.id}:${it.occ.occurrenceDate}`);
const dayTime = (it: CellItem) =>
  it.kind === "task" ? (it.task.dueTime ?? "99:97") : it.occ.startTime;

export default function CalendarPage() {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const itemV = reduce ? instantChild : riseChild;
  const now = useNow(30_000);

  const tasks = useOpsStore((s) => s.tasks);
  const events = useOpsStore((s) => s.events);
  const categories = useOpsStore((s) => s.categories);
  const weekStartsOn = useOpsStore((s) => s.settings.weekStartsOn);
  const hour24 = useOpsStore((s) => s.settings.hour24);

  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<string>(todayISO());
  const [selected, setSelected] = useState<string>(todayISO());

  const catOf = (id: string) => categories.find((c) => c.id === id);

  /* ---------------------------------- window + occurrence index */
  const { buckets, rangeStart, rangeEnd } = useMemo(() => {
    let start = cursor;
    let end = cursor;
    if (view === "month") {
      const c = fromISODate(cursor);
      const first = new Date(c.getFullYear(), c.getMonth(), 1);
      const off = (first.getDay() - weekStartsOn + 7) % 7;
      start = addDaysISO(toISODate(first), -off);
      end = addDaysISO(start, 41);
    } else if (view === "week") {
      const c = fromISODate(cursor);
      const off = (c.getDay() - weekStartsOn + 7) % 7;
      start = addDaysISO(cursor, -off);
      end = addDaysISO(start, 6);
    }
    const map = new Map<string, CellItem[]>();
    for (const t of tasks) {
      if (t.date >= start && t.date <= end) {
        const arr = map.get(t.date) ?? [];
        arr.push({ kind: "task", task: t });
        map.set(t.date, arr);
      }
    }
    for (const occ of expandEvents(events, start, end)) {
      const arr = map.get(occ.occurrenceDate) ?? [];
      arr.push({ kind: "event", occ });
      map.set(occ.occurrenceDate, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => dayTime(a).localeCompare(dayTime(b)));
    return { buckets: map, rangeStart: start, rangeEnd: end };
  }, [cursor, view, tasks, events, weekStartsOn]);

  const itemsFor = (iso: string) => buckets.get(iso) ?? [];

  /* ---------------------------------- navigation */
  const shift = (dir: -1 | 1) => {
    const c = fromISODate(cursor);
    if (view === "month") {
      setCursor(toISODate(new Date(c.getFullYear(), c.getMonth() + dir, 1)));
    } else if (view === "week") {
      setCursor(addDaysISO(cursor, 7 * dir));
    } else {
      setCursor(addDaysISO(cursor, dir));
      setSelected(addDaysISO(cursor, dir));
    }
  };
  const goToday = () => {
    setCursor(todayISO());
    setSelected(todayISO());
  };

  const headLabel = useMemo(() => {
    const c = fromISODate(cursor);
    if (view === "month") return `${MONTHS_SHORT[c.getMonth()]} ${c.getFullYear()}`;
    if (view === "week")
      return `${MONTHS_SHORT[fromISODate(rangeStart).getMonth()]} ${pad2(fromISODate(rangeStart).getDate())} — ${MONTHS_SHORT[fromISODate(rangeEnd).getMonth()]} ${pad2(fromISODate(rangeEnd).getDate())}`;
    return `${pad2(c.getDate())} ${MONTHS_SHORT[c.getMonth()]} ${c.getFullYear()}`;
  }, [cursor, view, rangeStart, rangeEnd]);

  const weekDays = useMemo(() => {
    const order: string[] = [];
    for (let i = 0; i < 7; i++) order.push(DAYS_SHORT[(weekStartsOn + i) % 7]);
    return order;
  }, [weekStartsOn]);

  const selItems = itemsFor(selected);

  return (
    <motion.div variants={reduce ? undefined : staggerParent} initial="hidden" animate="show">
      <PageHead
        no="SEC.03"
        title="Calendar Matrix"
        sub="SCHEDULE TOPOLOGY — TASKS HOLLOW · EVENTS SOLID"
        right={
          <>
            <div className="flex border border-line bg-surface">
              {(["month", "week", "day"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setView(v);
                    if (v === "day") setCursor(selected);
                  }}
                  className={cn(
                    "px-3.5 py-2 micro transition-colors",
                    view === v ? "bg-chrome text-acid" : "text-mute hover:text-ink",
                  )}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
            <Btn variant="acid" onClick={() => shell.openCreate("task", selected)}>
              <Plus size={12} /> @{selected.slice(5)}
            </Btn>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-4 lg:gap-5 items-start">
        {/* =============================== main calendar surface */}
        <motion.section variants={itemV} className="col-span-12 xl:col-span-8 panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div className="flex items-center gap-1">
              <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous">
                <ChevronLeft size={14} />
              </button>
              <button
                className="micro px-2.5 py-1.5 border border-line hover:border-ink transition-colors"
                onClick={goToday}
              >
                TODAY
              </button>
              <button className="icon-btn" onClick={() => shift(1)} aria-label="Next">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="font-display font-bold uppercase tracking-[0.1em] text-xl tnum">
              {headLabel}
            </div>
            <Micro className="hidden sm:block">
              {view.toUpperCase()} VIEW
            </Micro>
          </div>

          {view === "month" && (
            <MonthGrid
              cursor={cursor}
              weekStartsOn={weekStartsOn}
              weekDays={weekDays}
              itemsFor={itemsFor}
              selected={selected}
              today={todayISO()}
              catOf={catOf}
              onSelect={(iso) => setSelected(iso)}
            />
          )}

          {view === "week" && (
            <div className="grid grid-cols-7 min-h-[420px]">
              {Array.from({ length: 7 }, (_, i) => addDaysISO(rangeStart, i)).map((iso) => {
                const d = fromISODate(iso);
                const isToday = iso === todayISO();
                return (
                  <button
                    key={iso}
                    onClick={() => setSelected(iso)}
                    className={cn(
                      "border-r border-b border-line last:border-r-0 p-2 text-left align-top transition-colors min-h-[420px]",
                      selected === iso && !isToday && "bg-acid/15",
                      isToday && "bg-acid/25",
                      "hover:bg-acid/10",
                    )}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="micro text-mute">{DAYS_SHORT[d.getDay()]}</span>
                      <span
                        className={cn(
                          "font-mono text-sm tnum",
                          isToday && "bg-chrome text-acid px-1.5",
                        )}
                      >
                        {pad2(d.getDate())}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {itemsFor(iso).map((it) => (
                        <div
                          key={dayKey(it)}
                          onClick={(e) => {
                            e.stopPropagation();
                            shell.openEdit(it.kind === "task" ? it.task : it.occ);
                          }}
                          className={cn(
                            "text-[10px] leading-tight font-medium border-l-2 pl-1.5 py-0.5 truncate cursor-pointer hover:bg-surface",
                            it.kind === "task" && it.task.completed && "opacity-45 line-through",
                          )}
                          style={{ borderColor: catOf(it.kind === "task" ? it.task.categoryId : it.occ.categoryId)?.color }}
                          title={it.kind === "task" ? it.task.title : it.occ.title}
                        >
                          <span className="font-mono mr-1 text-mute">
                            {it.kind === "task"
                              ? it.task.dueTime
                                ? fmtHM(it.task.dueTime, hour24)
                                : "——:——"
                              : fmtHM(it.occ.startTime, hour24)}
                          </span>
                          {it.kind === "task" ? it.task.title : it.occ.title}
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {view === "day" && <DayTimeline iso={cursor} items={itemsFor(cursor)} hour24={hour24} catOf={catOf} />}
        </motion.section>

        {/* =============================== selected-date rail */}
        <motion.aside variants={itemV} className="col-span-12 xl:col-span-4 panel panel-hover">
          <div className="px-5 py-5">
            <SectionHead
              no="DETAIL"
              title={fromISODate(selected).getDate() + " " + MONTHS_SHORT[fromISODate(selected).getMonth()]}
              right={
                <button
                  onClick={() => {
                    setCursor(selected);
                    setView("day");
                  }}
                  className="micro text-mute hover:text-ink transition-colors flex items-center gap-1.5"
                >
                  DAY VIEW <ArrowRight size={10} />
                </button>
              }
            />
            {selItems.length === 0 ? (
              <div className="border border-dashed border-line px-4 py-8 text-center micro text-mute">
                NO RECORDS ON THIS DATE
              </div>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {selItems.map((it) =>
                  it.kind === "task" ? (
                    <TaskRow key={dayKey(it)} task={it.task} now={now} dense />
                  ) : (
                    <EventRow key={dayKey(it)} occ={it.occ} now={now} showDate={false} />
                  ),
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <Btn variant="ghost" onClick={() => shell.openCreate("task", selected)}>
                <Plus size={11} /> TASK
              </Btn>
              <Btn variant="ghost" onClick={() => shell.openCreate("event", selected)}>
                <CalendarPlus size={11} /> EVENT
              </Btn>
            </div>
          </div>
        </motion.aside>
      </div>
    </motion.div>
  );
}

/* ================= month grid ================= */
function MonthGrid({
  cursor,
  weekStartsOn,
  weekDays,
  itemsFor,
  selected,
  today,
  catOf,
  onSelect,
}: {
  cursor: string;
  weekStartsOn: 0 | 1;
  weekDays: string[];
  itemsFor: (iso: string) => CellItem[];
  selected: string;
  today: string;
  catOf: (id: string) => Category | undefined;
  onSelect: (iso: string) => void;
}) {
  const c = fromISODate(cursor);
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const off = (first.getDay() - weekStartsOn + 7) % 7;
  const gridStart = addDaysISO(toISODate(first), -off);
  const cells = Array.from({ length: 42 }, (_, i) => addDaysISO(gridStart, i));

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line">
        {weekDays.map((d) => (
          <div key={d} className="micro text-mute text-center py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((iso, i) => {
          const d = fromISODate(iso);
          const inMonth = d.getMonth() === c.getMonth();
          const isToday = iso === today;
          const isSel = iso === selected;
          const items = itemsFor(iso);
          const shown = items.slice(0, 3);
          return (
            <button
              key={iso + i}
              onClick={() => onSelect(iso)}
              className={cn(
                "relative h-[104px] lg:h-[118px] border-r border-b border-line p-1.5 text-left align-top transition-colors overflow-hidden",
                inMonth ? "bg-surface" : "bg-paper text-mute/50",
                isSel && "shadow-[inset_0_0_0_2px_var(--color-ink)]",
                "hover:bg-acid/15",
                isToday && "bg-acid/30 hover:bg-acid/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "font-mono text-xs tnum px-1",
                    isToday && "bg-chrome text-acid",
                    !inMonth && "opacity-50",
                  )}
                >
                  {pad2(d.getDate())}
                </span>
                {items.length > 3 && (
                  <span className="micro text-mute tnum">+{items.length - 3}</span>
                )}
              </div>
              <div className="mt-1 space-y-[3px]">
                {shown.map((it) => {
                  const color =
                    catOf(it.kind === "task" ? it.task.categoryId : it.occ.categoryId)?.color ??
                    "#777777";
                  const title = it.kind === "task" ? it.task.title : it.occ.title;
                  const isTask = it.kind === "task";
                  return (
                    <div
                      key={dayKey(it)}
                      className={cn(
                        "flex items-center gap-1.5 min-w-0",
                        isTask && it.task.completed && "opacity-40",
                      )}
                    >
                      <span
                        className="size-[7px] flex-none"
                        style={
                          isTask
                            ? { border: `2px solid ${color}`, background: "transparent" }
                            : { background: color, border: "1px solid rgba(0,0,0,0.35)" }
                        }
                      />
                      <span className="text-[10px] leading-none font-medium truncate">
                        {title}
                      </span>
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ================= day timeline ================= */
function DayTimeline({
  iso,
  items,
  hour24,
  catOf,
}: {
  iso: string;
  items: CellItem[];
  hour24: boolean;
  catOf: (id: string) => { color: string } | undefined;
}) {
  const shell = useShell();
  const H0 = 6;
  const H1 = 22;
  const PX = 46;
  const hours = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);

  const events = items.filter((i): i is Extract<CellItem, { kind: "event" }> => i.kind === "event");
  const dayTasks = items.filter((i): i is Extract<CellItem, { kind: "task" }> => i.kind === "task");

  return (
    <div className="p-5">
      {dayTasks.length > 0 && (
        <div className="mb-4">
          <Micro className="block mb-2">OBJECTIVES DUE — {pad2(dayTasks.length)}x</Micro>
          <div className="flex flex-wrap gap-2">
            {dayTasks.map((it) => (
              <button
                key={dayKey(it)}
                onClick={() => shell.openEdit(it.task)}
                className={cn(
                  "tag border border-ink bg-surface hover:bg-acid hover:text-acidink transition-colors",
                  it.task.completed && "opacity-45 line-through",
                )}
              >
                <span
                  className="size-[6px] border"
                  style={{ borderColor: catOf(it.task.categoryId)?.color }}
                />
                {it.task.dueTime ? fmtHM(it.task.dueTime, hour24) : "ANYTIME"} ·{" "}
                {it.task.title.toUpperCase().slice(0, 26)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative border border-line" style={{ height: (H1 - H0) * PX + PX }}>
        {hours.map((h) => (
          <div
            key={h}
            className="absolute inset-x-0 border-t border-line/70"
            style={{ top: (h - H0) * PX }}
          >
            <span className="absolute -top-2 left-2 bg-surface px-1 font-mono text-[10px] text-mute tnum">
              {fmtHM(`${pad2(h)}:00`, hour24)}
            </span>
          </div>
        ))}
        {events.map((it) => {
          const s = timeToMin(it.occ.startTime) ?? 0;
          const e = timeToMin(it.occ.endTime) ?? 0;
          const top = Math.max(0, ((s - H0 * 60) / 60) * PX);
          const height = Math.max(20, ((e - s) / 60) * PX);
          const color = catOf(it.occ.categoryId)?.color ?? "#777";
          return (
            <button
              key={dayKey(it)}
              onClick={() => shell.openEdit(it.occ)}
              className="absolute left-16 right-3 lg:right-6 border border-acidink px-3 py-1.5 text-left overflow-hidden hover:shadow-[3px_3px_0_var(--color-chrome)] transition-shadow"
              style={{ top, height, background: color }}
              title={it.occ.title}
            >
              <div
                className="font-display font-semibold text-[12px] truncate"
                style={{ color: color === "#FFFA00" || color === "#00FFA2" ? "#191919" : "#F2F2EE" }}
              >
                {it.occ.title}
              </div>
              <div
                className="micro tnum"
                style={{ color: color === "#FFFA00" || color === "#00FFA2" ? "#191919" : "#F2F2EE", opacity: 0.75 }}
              >
                {fmtHM(it.occ.startTime, hour24)} — {fmtHM(it.occ.endTime, hour24)}
              </div>
            </button>
          );
        })}
        {events.length === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <Micro>NO EVENTS SCHEDULED — TIMELINE CLEAR</Micro>
          </div>
        )}
      </div>
      <Micro className="block mt-3">{iso} // TIMELINE RANGE 06:00—22:00 LOCAL</Micro>
    </div>
  );
}
