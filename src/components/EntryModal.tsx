/**
 * Entry editor — create/edit tasks and events. Fully controlled form with
 * validation; writes through the operations store. Reminders are dispatched
 * by the in-app watcher (and the OS when running under the desktop build).
 */
import { useMemo, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import type { EntryKind, Priority, RepeatRule, TaskEntry } from "@/types";
import { REMINDER_OFFSETS, REPEAT_META, normalizeReminder } from "@/types";
import { useOpsStore } from "@/store/useOpsStore";
import { useShell, type ModalRequest } from "@/lib/shell";
import { anchorDayOf, minToTime, resolveAnchorDay, todayISO, timeToMin } from "@/lib/time";
import { textOn } from "@/components/ui/primitives";
import { Btn, Micro } from "@/components/ui/primitives";
import { SlideOver } from "@/components/ui/Modal";
import { cn } from "@/utils/cn";

const REMINDER_LABEL: Record<number, string> = {
  0: "AT TIME",
  5: "5 MIN",
  15: "15 MIN",
  30: "30 MIN",
  60: "1 HOUR",
  1440: "1 DAY",
};

const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
const REPEATS: RepeatRule[] = ["none", "daily", "weekly", "monthly"];

export default function EntryModal({
  req,
  onClose,
}: {
  req: ModalRequest;
  onClose: () => void;
}) {
  const shell = useShell();
  const categories = useOpsStore((s) => s.categories);
  const addTask = useOpsStore((s) => s.addTask);
  const updateTask = useOpsStore((s) => s.updateTask);
  const deleteTask = useOpsStore((s) => s.deleteTask);
  const addEvent = useOpsStore((s) => s.addEvent);
  const updateEvent = useOpsStore((s) => s.updateEvent);
  const deleteEvent = useOpsStore((s) => s.deleteEvent);

  const editing = req.mode === "edit" ? req.entry : null;
  const createReq = req.mode === "create" ? req : null;

  const defaults = useMemo(() => {
    if (editing || !createReq) return null;
    const now = new Date();
    const start = minToTime((now.getHours() + 1) * 60);
    return {
      kind: createReq.kind,
      date: createReq.presetDate ?? todayISO(),
      startTime: start,
      endTime: minToTime((now.getHours() + 2) * 60),
    };
  }, [editing, createReq]);

  const [kind, setKind] = useState<EntryKind>(editing?.kind ?? defaults?.kind ?? "task");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [date, setDate] = useState(editing?.date ?? defaults?.date ?? todayISO());
  const [dueTime, setDueTime] = useState(editing?.kind === "task" ? editing.dueTime ?? "" : "");
  const [startTime, setStartTime] = useState(
    editing?.kind === "event" ? editing.startTime : defaults?.startTime ?? "13:00",
  );
  const [endTime, setEndTime] = useState(
    editing?.kind === "event" ? editing.endTime : defaults?.endTime ?? "14:00",
  );
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? categories[0]?.id ?? "");
  const [priority, setPriority] = useState<Priority>(editing?.priority ?? "medium");
  const [offsets, setOffsets] = useState<number[]>(() => {
    if (editing) return normalizeReminder(editing.reminder).offsets;
    // Events always have a start time, so a default reminder is safe.
    // Tasks may be captured without a due time — don't force the operator to
    // clear a reminder they never asked for.
    return (createReq?.kind ?? "task") === "event" ? [15] : [];
  });
  const [repeat, setRepeat] = useState<RepeatRule>(editing?.repeat ?? "none");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!title.trim()) return setError("TITLE REQUIRED — RECORD REJECTED");
    if (!date) return setError("DATE REQUIRED — RECORD REJECTED");
    // A time-based reminder needs a concrete moment — never invent one.
    if (kind === "task" && offsets.length > 0 && !dueTime) {
      return setError("DUE TIME REQUIRED FOR REMINDERS — SET A TIME OR CLEAR REMINDERS");
    }
    const reminderCfg = normalizeReminder({ offsets });
    /**
     * Monthly recurrence anchor. Editing an entry without moving its date
     * preserves the existing anchor, so a series currently sitting on a
     * clamped date (e.g. Feb 28, anchored to the 31st) is not silently
     * re-anchored to the shorter month.
     */
    const repeatAnchorDay =
      repeat === "monthly"
        ? editing && editing.date === date
          ? resolveAnchorDay(editing.date, editing.repeatAnchorDay)
          : anchorDayOf(date)
        : undefined;
    if (kind === "task") {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        date,
        dueTime: dueTime || undefined,
        categoryId,
        priority,
        reminder: reminderCfg,
        repeat,
        repeatAnchorDay,
        completed: editing?.kind === "task" ? (editing as TaskEntry).completed : false,
        completedAt: editing?.kind === "task" ? (editing as TaskEntry).completedAt : undefined,
      };
      if (editing?.kind === "task") updateTask(editing.id, payload);
      else addTask(payload);
    } else {
      const s = timeToMin(startTime);
      const e = timeToMin(endTime);
      if (s === null || e === null) return setError("START / END TIME REQUIRED");
      if (e <= s) return setError("END MUST FOLLOW START — TIMELINE VIOLATION");
      const payload = {
        title: title.trim(),
        description: description.trim(),
        date,
        startTime,
        endTime,
        categoryId,
        priority,
        reminder: reminderCfg,
        repeat,
        repeatAnchorDay,
      };
      if (editing?.kind === "event") updateEvent(editing.id, payload);
      else addEvent(payload);
    }
    onClose();
  };

  const handleDelete = () => {
    if (!editing) return;
    shell.confirm({
      title: `PURGE ${editing.kind === "task" ? "TASK" : "EVENT"}`,
      body: `“${editing.title}” will be permanently removed from the operations registry.`,
      confirmLabel: "PURGE",
      danger: true,
      onConfirm: () => {
        if (editing.kind === "task") deleteTask(editing.id);
        else deleteEvent(editing.id);
        onClose();
      },
    });
  };

  const label = (text: string) => <Micro className="block mb-1.5">{text}</Micro>;

  return (
    <SlideOver
      subtitle={`REGISTRY // ${editing ? "EDIT" : "NEW"} ${kind === "task" ? "TASK" : "EVENT"}`}
      title={editing ? "Modify Record" : kind === "task" ? "New Task" : "New Event"}
      onClose={onClose}
      footer={
        <>
          <div>
            {editing && (
              <Btn variant="ghost" onClick={handleDelete}>
                <Trash2 size={12} /> PURGE
              </Btn>
            )}
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={onClose}>
              ABORT
            </Btn>
            <Btn variant="acid" onClick={save}>
              {editing ? "COMMIT CHANGES" : "LOG RECORD"}
            </Btn>
          </div>
        </>
      }
    >
      <div className="space-y-5">
        {req.mode === "create" && (
          <div>
            {label("RECORD TYPE")}
            <div className="grid grid-cols-2 gap-0 border border-line">
              {(["task", "event"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setOffsets((prev) => (prev.length === 0 && k === "event" ? [15] : prev));
                  }}
                  className={cn(
                    "px-4 py-2.5 micro-lg transition-colors",
                    kind === k ? "bg-chrome text-acid" : "bg-surface text-mute hover:text-ink",
                  )}
                >
                  {k === "task" ? "TASK // OBJECTIVE" : "EVENT // SCHEDULE"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          {label("TITLE *")}
          <input
            className="field font-semibold"
            placeholder={kind === "task" ? "Objective designation" : "Transmission title"}
            value={title}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              setError(null);
            }}
          />
        </div>

        <div>
          {label("DESCRIPTION / BRIEF")}
          <textarea
            className="field"
            placeholder="Optional operational notes…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className={cn("grid gap-4", kind === "event" ? "grid-cols-3" : "grid-cols-2")}>
          <div>
            {label("DATE *")}
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {kind === "task" ? (
            <div>
              {label("DUE TIME (OPT)")}
              <input type="time" className="field" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                {label("START *")}
                <input type="time" className="field" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                {label("END *")}
                <input type="time" className="field" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div>
          {label("CATEGORY")}
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={cn(
                  "tag border transition-all",
                  categoryId === c.id
                    ? "border-acidink shadow-[2px_2px_0_var(--color-chrome)]"
                    : "border-line opacity-60 hover:opacity-100",
                )}
                style={{
                  background: categoryId === c.id ? c.color : "transparent",
                  color: categoryId === c.id ? textOn(c.color) : "#777777",
                }}
              >
                {c.code} — {c.name.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div>
          {label("PRIORITY LEVEL")}
          <div className="grid grid-cols-4 gap-0 border border-line">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  "px-2 py-2.5 micro transition-colors border-r border-line last:border-r-0",
                  priority === p
                    ? p === "critical"
                      ? "bg-chrome text-acid"
                      : p === "high"
                        ? "bg-acid text-acidink"
                        : "bg-chrome text-fog"
                    : "bg-surface text-mute hover:text-ink",
                )}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div>
          {label("REMINDERS — SELECT ANY NUMBER")}
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_OFFSETS.map((o) => {
              const on = offsets.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() =>
                    setOffsets((prev) =>
                      prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o].sort((a, b) => a - b),
                    )
                  }
                  className={cn(
                    "tag border transition-all",
                    on
                      ? "bg-acid text-acidink border-acidink shadow-[2px_2px_0_var(--color-chrome)]"
                      : "tag-outline hover:border-ink",
                  )}
                >
                  {on && <Check size={9} strokeWidth={3.5} />}
                  {REMINDER_LABEL[o]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 mt-2">
            <Micro className="normal-case tracking-wide text-mute/80">
              {offsets.length === 0
                ? "No reminders — this entry will not notify."
                : `${offsets.length} notification${offsets.length > 1 ? "s" : ""} scheduled per occurrence.`}
            </Micro>
            {offsets.length > 0 && (
              <button
                type="button"
                className="micro text-mute hover:text-ink transition-colors"
                onClick={() => setOffsets([])}
              >
                CLEAR
              </button>
            )}
          </div>
          {kind === "task" && offsets.length > 0 && !dueTime && (
            <div className="mt-2 border border-acidink bg-acid px-3 py-2 micro text-acidink">
              DUE TIME REQUIRED — A TASK WITHOUT A TIME CANNOT BE SCHEDULED.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            {label("REPEAT CYCLE")}
            <select
              className="field"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as RepeatRule)}
            >
              {REPEATS.map((r) => (
                <option key={r} value={r}>
                  {REPEAT_META[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            {label("DELIVERY")}
            <div className="field flex items-center gap-2 !cursor-default">
              <span className="size-[7px] bg-mint" />
              <span className="micro text-mute">BACKGROUND ENGINE</span>
            </div>
          </div>
        </div>

        <p className="micro text-mute/80 normal-case tracking-wide leading-relaxed border-t border-dashed border-line pt-4">
          Reminders raise an in-console alert while WAYPOINT is running, and a Windows
          system notification in the desktop build.
        </p>

        {error && (
          <div className="border border-acidink bg-acid px-4 py-3 micro-lg text-acidink flex items-center gap-3">
            <span className="hazard-soft w-3 h-3 flex-none border border-acidink" />
            {error}
          </div>
        )}
      </div>
    </SlideOver>
  );
}
