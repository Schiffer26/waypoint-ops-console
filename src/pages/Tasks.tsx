/**
 * SEC.02 — TASK REGISTRY
 * Pending objectives grouped by urgency band with filter / sort controls.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, Search, X } from "lucide-react";
import type { Priority, TaskEntry } from "@/types";
import { PRIORITY_META } from "@/types";
import { useOpsStore } from "@/store/useOpsStore";
import { useShell } from "@/lib/shell";
import { useNow } from "@/hooks/useNow";
import {
  addDaysISO,
  fmtShort,
  isTaskOverdue,
  toISODate,
} from "@/lib/time";
import { instantChild, riseChild, staggerParent } from "@/lib/motion";
import { Btn, EmptyState, Micro, PageHead } from "@/components/ui/primitives";
import { TaskRow } from "@/components/rows";
import { cn } from "@/utils/cn";

type SortMode = "due" | "priority" | "created";

interface Group {
  key: string;
  label: string;
  alert?: boolean;
  items: TaskEntry[];
}

export default function Tasks() {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const itemV = reduce ? instantChild : riseChild;
  const now = useNow(1000);

  const tasks = useOpsStore((s) => s.tasks);
  const categories = useOpsStore((s) => s.categories);

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [pri, setPri] = useState<"any" | Priority>("any");
  const [sort, setSort] = useState<SortMode>("due");

  const { groups, rawCount } = useMemo<{ groups: Group[]; rawCount: number }>(() => {
    const today = toISODate(now);
    const tomorrow = addDaysISO(today, 1);
    const needle = q.trim().toLowerCase();

    let list = tasks.filter((t) => !t.completed);
    const rawCount = list.length;
    if (needle)
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          t.description.toLowerCase().includes(needle),
      );
    if (cat !== "all") list = list.filter((t) => t.categoryId === cat);
    if (pri !== "any") list = list.filter((t) => t.priority === pri);

    list = [...list].sort((a, b) => {
      if (sort === "created") return b.createdAt - a.createdAt;
      if (sort === "priority")
        return (
          PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank ||
          `${a.date}${a.dueTime ?? ""}`.localeCompare(`${b.date}${b.dueTime ?? ""}`)
        );
      return `${a.date}T${a.dueTime ?? "99:99"}`.localeCompare(
        `${b.date}T${b.dueTime ?? "99:99"}`,
      );
    });

    const out: Group[] = [];
    const push = (key: string, label: string, items: TaskEntry[], alert = false) => {
      if (items.length) out.push({ key, label, items, alert });
    };

    push("overdue", "OVERDUE — REQUIRES ACTION", list.filter((t) => isTaskOverdue(t, now)), true);
    push(
      "today",
      "TODAY",
      list.filter((t) => t.date === today && !isTaskOverdue(t, now)),
    );
    push("tomorrow", "TOMORROW", list.filter((t) => t.date === tomorrow));

    const later = list.filter((t) => t.date > tomorrow);
    const byDate = new Map<string, TaskEntry[]>();
    for (const t of later) {
      const arr = byDate.get(t.date) ?? [];
      arr.push(t);
      byDate.set(t.date, arr);
    }
    for (const [date, items] of [...byDate.entries()].sort()) {
      push(date, `QUEUED — ${fmtShort(date)}`, items);
    }
    return { groups: out, rawCount };
  }, [tasks, q, cat, pri, sort, now]);

  const filteredCount = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const filtersActive = q.trim() !== "" || cat !== "all" || pri !== "any";

  return (
    <motion.div
      variants={reduce ? undefined : staggerParent}
      initial="hidden"
      animate="show"
    >
      <PageHead
        no="SEC.02"
        title="Task Registry"
        sub={`${rawCount} ACTIVE OBJECTIVE${rawCount === 1 ? "" : "S"} ON RECORD`}
        right={
          <Btn variant="acid" onClick={() => shell.openCreate("task", toISODate(now))}>
            <Plus size={12} /> LOG TASK
          </Btn>
        }
      />

      {/* control strip */}
      <motion.div
        variants={itemV}
        className="panel px-4 py-3 mb-6 flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="field pl-9!"
            placeholder="SEARCH OBJECTIVES…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-mute hover:text-ink"
              onClick={() => setQ("")}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <select className="field w-auto!" value={pri} onChange={(e) => setPri(e.target.value as "any" | Priority)}>
          <option value="any">PRIORITY: ANY</option>
          <option value="critical">CRITICAL</option>
          <option value="high">HIGH</option>
          <option value="medium">MEDIUM</option>
          <option value="low">LOW</option>
        </select>
        <select className="field w-auto!" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="due">SORT: BY DUE</option>
          <option value="priority">SORT: BY PRIORITY</option>
          <option value="created">SORT: BY NEWEST</option>
        </select>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCat("all")}
            className={cn(
              "tag border transition-colors",
              cat === "all" ? "bg-chrome text-acid border-chrome" : "tag-outline hover:border-ink",
            )}
          >
            ALL
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(cat === c.id ? "all" : c.id)}
              className={cn(
                "tag border transition-colors flex items-center gap-1.5",
                cat === c.id ? "border-acidink" : "tag-outline hover:border-ink",
              )}
              style={cat === c.id ? { background: c.color, color: "#191919" } : undefined}
            >
              <span className="size-[6px]" style={{ background: c.color, outline: "1px solid rgba(0,0,0,.25)" }} />
              {c.code}
            </button>
          ))}
        </div>
      </motion.div>

      {filtersActive && (
        <Micro className="block mb-4">
          FILTER ACTIVE — {filteredCount} OF {rawCount} RECORDS IN VIEW
        </Micro>
      )}

      {filteredCount === 0 ? (
        <motion.div variants={itemV}>
          <EmptyState
            title={filtersActive ? "NO RECORDS MATCH CURRENT FILTERS" : "REGISTRY CLEAR"}
            hint={
              filtersActive
                ? "Relax the filters or refine your search query."
                : "All objectives are cleared. The board is yours."
            }
            action={
              !filtersActive ? (
                <Btn variant="acid" onClick={() => shell.openCreate("task", toISODate(now))}>
                  <Plus size={12} /> LOG FIRST TASK
                </Btn>
              ) : undefined
            }
          />
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-x-6 gap-y-8 items-start">
          {groups.map((g) => (
            <motion.section key={g.key} variants={itemV}>
              <div className={cn("flex items-center gap-3 pb-2.5", g.alert && "text-ink")}>
                {g.alert && <span className="hazard-soft w-3 h-3 border border-acidink flex-none" />}
                <span className="micro-lg">{g.label}</span>
                <span className="h-px flex-1 bg-line" />
                <span className="micro text-mute tnum">x{g.items.length}</span>
              </div>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {g.items.map((t) => (
                    <TaskRow key={t.id} task={t} now={now} />
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          ))}
        </div>
      )}
    </motion.div>
  );
}
