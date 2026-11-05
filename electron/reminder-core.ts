/**
 * WAYPOINT — reminder engine core (PURE).
 *
 * Zero Electron / Node imports so the whole scheduling brain can be unit
 * tested in plain Node with a controllable clock. The Electron scheduler
 * (electron/scheduler.ts) is a thin shell that feeds this module data and
 * carries out its decisions.
 *
 * All date math is LOCAL TIME. Dates are `yyyy-mm-dd`, times `HH:mm`, and
 * they are combined with `new Date(y, m-1, d, hh, mm)` — never through
 * Date.parse / UTC strings — so there are no timezone shift bugs.
 */

/* ------------------------------------------------------------ domain --- */

import {
  enumerateOccurrences,
  resolveAnchorDay,
  shiftByRule as shiftByRuleShared,
} from "./recurrence.js";

export type { RepeatRule } from "./recurrence.js";
export {
  addMonthsAnchored,
  anchorDayOf,
  daysInMonth,
  enumerateOccurrences,
  resolveAnchorDay,
} from "./recurrence.js";

import type { RepeatRule } from "./recurrence.js";
export type EntryKind = "task" | "event";

/** Offsets (minutes before the scheduled moment) the UI offers. */
export const REMINDER_OFFSETS = [0, 5, 15, 30, 60, 1440] as const;
export const SNOOZE_DURATIONS = [5, 10, 15, 30] as const;

export interface CoreReminder {
  enabled?: boolean;
  /** Legacy single-offset field (pre-Stage-03 records). */
  minutesBefore?: number;
  /** Stage-03: multiple offsets in minutes before the scheduled time. */
  offsets?: number[];
}

export interface CoreTask {
  id: string;
  kind: "task";
  title: string;
  date: string;
  dueTime?: string;
  reminder?: CoreReminder;
  repeat?: RepeatRule;
  /** Monthly recurrence anchor day; derived from `date` when absent. */
  repeatAnchorDay?: number;
  completed?: boolean;
}

export interface CoreEvent {
  id: string;
  kind: "event";
  title: string;
  date: string;
  startTime: string;
  endTime?: string;
  reminder?: CoreReminder;
  repeat?: RepeatRule;
  /** Monthly recurrence anchor day; derived from `date` when absent. */
  repeatAnchorDay?: number;
}

export interface CoreDb {
  tasks: CoreTask[];
  events: CoreEvent[];
  settings?: {
    notificationsEnabled?: boolean;
    notificationSound?: string;
    catchUpMissed?: boolean;
    consolidateMissed?: boolean;
    [k: string]: unknown;
  };
}

/* ------------------------------------------------------- normalisation -- */

/**
 * Canonical offset list for an entry, tolerant of every historical shape:
 *  - Stage-03 `{ offsets: [...] }`
 *  - Stage-01/02 `{ enabled, minutesBefore }`
 *  - missing / malformed reminder objects
 * Always returns a sorted, de-duplicated, validated array.
 */
export function normalizeOffsets(reminder: CoreReminder | undefined | null): number[] {
  if (!reminder || typeof reminder !== "object") return [];
  const raw = Array.isArray(reminder.offsets)
    ? reminder.offsets
    : reminder.enabled === true && typeof reminder.minutesBefore === "number"
      ? [reminder.minutesBefore]
      : [];
  const clean = raw
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)
    .map((n) => Math.round(n));
  return [...new Set(clean)].sort((a, b) => a - b);
}

/* ------------------------------------------------------- date helpers --- */

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** Combine a local ISO date and HH:mm into a local-time epoch ms. */
export function localMs(dateISO: string, time: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime();
}

/**
 * Monthly recurrence is ANCHOR-BASED — see electron/recurrence.ts. Both the
 * scheduler and the renderer calendar import that same module, so reminder
 * occurrences always match the dates shown in the UI.
 */
export function shiftByRule(iso: string, rule: RepeatRule, anchorDay?: number): string {
  return shiftByRuleShared(iso, rule, anchorDay);
}

/** Occurrence dates of a (possibly repeating) entry inside [fromISO,toISO]. */
export function occurrenceDates(
  startISO: string,
  rule: RepeatRule,
  fromISO: string,
  toISO: string,
  anchorDay?: number,
): string[] {
  return enumerateOccurrences(startISO, rule, fromISO, toISO, anchorDay);
}

/* ---------------------------------------------------------- instances --- */

export interface ReminderInstance {
  /** Stable identity: kind, entry id, occurrence date, occurrence time, offset. */
  id: string;
  kind: EntryKind;
  entryId: string;
  title: string;
  occurrenceDate: string;
  /** The entry's own time on that occurrence (HH:mm). */
  scheduledTime: string;
  /** Epoch ms of the occurrence itself. */
  scheduledAt: number;
  /** Minutes before `scheduledAt`. */
  offset: number;
  /** Epoch ms at which this reminder should fire. */
  fireAt: number;
}

export function reminderId(
  kind: EntryKind,
  entryId: string,
  occurrenceDate: string,
  scheduledTime: string,
  offset: number,
): string {
  return `${kind}:${entryId}:${occurrenceDate}T${scheduledTime}:+${offset}`;
}

/**
 * Tasks with reminders but no due time cannot be scheduled — surfaced so the
 * UI/logs can explain instead of silently inventing a notification time.
 */
export interface UnschedulableEntry {
  kind: EntryKind;
  entryId: string;
  title: string;
  reason: "NO_DUE_TIME";
}

export interface BuildResult {
  instances: ReminderInstance[];
  unschedulable: UnschedulableEntry[];
}

/**
 * Materialise every reminder instance whose fireAt lands inside
 * [windowStart, windowEnd]. Completed tasks are skipped entirely.
 */
export function buildInstances(
  db: CoreDb,
  windowStart: number,
  windowEnd: number,
): BuildResult {
  const instances: ReminderInstance[] = [];
  const unschedulable: UnschedulableEntry[] = [];
  const seen = new Set<string>();

  const push = (inst: ReminderInstance) => {
    if (seen.has(inst.id)) return; // never emit duplicate occurrences
    seen.add(inst.id);
    if (inst.fireAt >= windowStart && inst.fireAt <= windowEnd) instances.push(inst);
  };

  // widen the date window so a 1-day-before offset still resolves
  const fromISO = toISODate(new Date(windowStart - 2 * 86400000));
  const toISO = toISODate(new Date(windowEnd + 2 * 86400000));

  for (const t of db.tasks ?? []) {
    const offsets = normalizeOffsets(t.reminder);
    if (offsets.length === 0) continue;
    if (t.completed) continue; // completed tasks never notify
    if (!t.dueTime) {
      unschedulable.push({
        kind: "task",
        entryId: t.id,
        title: t.title,
        reason: "NO_DUE_TIME",
      });
      continue;
    }
    // Repeating tasks materialise their next cycle on completion, so only the
    // stored occurrence is scheduled here.
    for (const date of occurrenceDates(t.date, "none", fromISO, toISO)) {
      const scheduledAt = localMs(date, t.dueTime);
      for (const offset of offsets) {
        push({
          id: reminderId("task", t.id, date, t.dueTime, offset),
          kind: "task",
          entryId: t.id,
          title: t.title,
          occurrenceDate: date,
          scheduledTime: t.dueTime,
          scheduledAt,
          offset,
          fireAt: scheduledAt - offset * 60000,
        });
      }
    }
  }

  for (const e of db.events ?? []) {
    const offsets = normalizeOffsets(e.reminder);
    if (offsets.length === 0) continue;
    if (!e.startTime) {
      unschedulable.push({
        kind: "event",
        entryId: e.id,
        title: e.title,
        reason: "NO_DUE_TIME",
      });
      continue;
    }
    for (const date of occurrenceDates(
      e.date,
      e.repeat ?? "none",
      fromISO,
      toISO,
      resolveAnchorDay(e.date, e.repeatAnchorDay),
    )) {
      const scheduledAt = localMs(date, e.startTime);
      for (const offset of offsets) {
        push({
          id: reminderId("event", e.id, date, e.startTime, offset),
          kind: "event",
          entryId: e.id,
          title: e.title,
          occurrenceDate: date,
          scheduledTime: e.startTime,
          scheduledAt,
          offset,
          fireAt: scheduledAt - offset * 60000,
        });
      }
    }
  }

  instances.sort((a, b) => a.fireAt - b.fireAt);
  return { instances, unschedulable };
}

/* ------------------------------------------------------------- ledger --- */

export type ReminderState = "delivered" | "snoozed" | "missed" | "cancelled";

export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  entryId: string;
  title: string;
  occurrenceDate: string;
  scheduledTime: string;
  scheduledAt: number;
  offset: number;
  fireAt: number;
  state: ReminderState;
  deliveredAt?: number;
  missedAt?: number;
  cancelledAt?: number;
  snoozeUntil?: number;
  snoozeCount?: number;
}

export interface Ledger {
  version: number;
  entries: Record<string, LedgerEntry>;
}

export const LEDGER_VERSION = 1;

export function emptyLedger(): Ledger {
  return { version: LEDGER_VERSION, entries: {} };
}

/**
 * Coerce any parsed JSON into a valid ledger. Corrupt / partially written /
 * foreign data degrades to an empty ledger instead of throwing — the user's
 * task & event database is never involved here.
 */
export function sanitizeLedger(raw: unknown): Ledger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyLedger();
  const obj = raw as Partial<Ledger>;
  const src = obj.entries;
  if (!src || typeof src !== "object" || Array.isArray(src)) return emptyLedger();
  const entries: Record<string, LedgerEntry> = {};
  for (const [key, val] of Object.entries(src as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const e = val as Partial<LedgerEntry>;
    if (typeof e.id !== "string" || typeof e.state !== "string") continue;
    if (!["delivered", "snoozed", "missed", "cancelled"].includes(e.state)) continue;
    entries[key] = {
      id: e.id,
      kind: e.kind === "event" ? "event" : "task",
      entryId: typeof e.entryId === "string" ? e.entryId : "",
      title: typeof e.title === "string" ? e.title : "",
      occurrenceDate: typeof e.occurrenceDate === "string" ? e.occurrenceDate : "",
      scheduledTime: typeof e.scheduledTime === "string" ? e.scheduledTime : "",
      scheduledAt: Number(e.scheduledAt) || 0,
      offset: Number(e.offset) || 0,
      fireAt: Number(e.fireAt) || 0,
      state: e.state as ReminderState,
      deliveredAt: typeof e.deliveredAt === "number" ? e.deliveredAt : undefined,
      missedAt: typeof e.missedAt === "number" ? e.missedAt : undefined,
      cancelledAt: typeof e.cancelledAt === "number" ? e.cancelledAt : undefined,
      snoozeUntil: typeof e.snoozeUntil === "number" ? e.snoozeUntil : undefined,
      snoozeCount: typeof e.snoozeCount === "number" ? e.snoozeCount : undefined,
    };
  }
  return { version: LEDGER_VERSION, entries };
}

/** Keep the ledger bounded so long sessions never grow unboundedly. */
export function pruneLedger(ledger: Ledger, now: number, keepMs = 30 * 86400000, cap = 500): Ledger {
  const all = Object.values(ledger.entries)
    .filter((e) => {
      if (e.state === "snoozed") return true; // pending work — always keep
      const ts = e.deliveredAt ?? e.missedAt ?? e.cancelledAt ?? e.fireAt;
      return now - ts <= keepMs;
    })
    .sort((a, b) => {
      const ta = a.deliveredAt ?? a.missedAt ?? a.cancelledAt ?? a.fireAt;
      const tb = b.deliveredAt ?? b.missedAt ?? b.cancelledAt ?? b.fireAt;
      return tb - ta;
    })
    .slice(0, cap);
  const entries: Record<string, LedgerEntry> = {};
  for (const e of all) entries[e.id] = e;
  return { version: LEDGER_VERSION, entries };
}

/* --------------------------------------------------------- the planner -- */

export interface PlanOptions {
  now: number;
  /** How late a reminder may be and still count as "on time". */
  graceMs?: number;
  /** Catch-up look-back for missed reminders. */
  catchUpMs?: number;
  /** Master notification switch. */
  notificationsEnabled?: boolean;
  /** Whether missed reminders should be reported at all. */
  catchUpEnabled?: boolean;
}

export interface Plan {
  /** Fire now, as a normal on-time reminder. */
  due: ReminderInstance[];
  /** Fire now, flagged as missed (downtime catch-up). */
  missed: ReminderInstance[];
  /** Snoozed ledger entries whose snooze has elapsed. */
  snoozeDue: LedgerEntry[];
  /** Ledger ids to cancel (entry deleted / completed / rescheduled). */
  cancel: string[];
  /** Instances older than the catch-up window: close silently. */
  expire: ReminderInstance[];
  /** Next future fireAt, for adaptive wake-ups. */
  nextWakeAt: number | null;
}

const DEFAULT_GRACE = 90_000; // 90s
const DEFAULT_CATCHUP = 24 * 3600_000; // 24h

/**
 * The single decision function of the engine. Pure: same inputs → same plan.
 * Everything the scheduler does is derived from this.
 */
export function planReminders(
  instances: ReminderInstance[],
  ledger: Ledger,
  opts: PlanOptions,
): Plan {
  const now = opts.now;
  const grace = opts.graceMs ?? DEFAULT_GRACE;
  const catchUp = opts.catchUpMs ?? DEFAULT_CATCHUP;
  const notificationsEnabled = opts.notificationsEnabled !== false;
  const catchUpEnabled = opts.catchUpEnabled !== false;

  const plan: Plan = {
    due: [],
    missed: [],
    snoozeDue: [],
    cancel: [],
    expire: [],
    nextWakeAt: null,
  };

  const live = new Set(instances.map((i) => i.id));

  for (const inst of instances) {
    const rec = ledger.entries[inst.id];
    // Already resolved → never deliver twice.
    if (rec && (rec.state === "delivered" || rec.state === "missed" || rec.state === "cancelled")) {
      continue;
    }
    // Snoozed instances are handled through the ledger pass below.
    if (rec && rec.state === "snoozed") continue;

    if (inst.fireAt > now) {
      if (plan.nextWakeAt === null || inst.fireAt < plan.nextWakeAt) plan.nextWakeAt = inst.fireAt;
      continue;
    }
    const lateBy = now - inst.fireAt;
    if (lateBy <= grace) {
      if (notificationsEnabled) plan.due.push(inst);
    } else if (lateBy <= catchUp) {
      if (notificationsEnabled && catchUpEnabled) plan.missed.push(inst);
      else plan.expire.push(inst);
    } else {
      plan.expire.push(inst);
    }
  }

  // Ledger pass: elapsed snoozes, and cancellation of vanished instances.
  for (const rec of Object.values(ledger.entries)) {
    if (rec.state === "snoozed") {
      if (!live.has(rec.id)) {
        // entry deleted / completed / rescheduled while snoozed
        plan.cancel.push(rec.id);
        continue;
      }
      const until = rec.snoozeUntil ?? 0;
      if (until <= now) {
        if (notificationsEnabled) plan.snoozeDue.push(rec);
      } else if (plan.nextWakeAt === null || until < plan.nextWakeAt) {
        plan.nextWakeAt = until;
      }
    }
  }

  plan.due.sort((a, b) => a.fireAt - b.fireAt);
  plan.missed.sort((a, b) => a.fireAt - b.fireAt);
  return plan;
}

/* ------------------------------------------------- ledger transitions --- */

export function markDelivered(
  ledger: Ledger,
  inst: ReminderInstance,
  now: number,
  state: "delivered" | "missed" = "delivered",
): Ledger {
  const prev = ledger.entries[inst.id];
  ledger.entries[inst.id] = {
    id: inst.id,
    kind: inst.kind,
    entryId: inst.entryId,
    title: inst.title,
    occurrenceDate: inst.occurrenceDate,
    scheduledTime: inst.scheduledTime,
    scheduledAt: inst.scheduledAt,
    offset: inst.offset,
    fireAt: inst.fireAt,
    state,
    deliveredAt: state === "delivered" ? now : prev?.deliveredAt,
    missedAt: state === "missed" ? now : prev?.missedAt,
    snoozeCount: prev?.snoozeCount,
  };
  return ledger;
}

export function markExpired(ledger: Ledger, inst: ReminderInstance, now: number): Ledger {
  if (ledger.entries[inst.id]) return ledger;
  ledger.entries[inst.id] = {
    id: inst.id,
    kind: inst.kind,
    entryId: inst.entryId,
    title: inst.title,
    occurrenceDate: inst.occurrenceDate,
    scheduledTime: inst.scheduledTime,
    scheduledAt: inst.scheduledAt,
    offset: inst.offset,
    fireAt: inst.fireAt,
    state: "cancelled",
    cancelledAt: now,
  };
  return ledger;
}

export function markCancelled(ledger: Ledger, id: string, now: number): Ledger {
  const rec = ledger.entries[id];
  if (!rec) return ledger;
  ledger.entries[id] = { ...rec, state: "cancelled", cancelledAt: now };
  return ledger;
}

/** Snooze a reminder: persists a new delivery time and survives restarts. */
export function applySnooze(
  ledger: Ledger,
  id: string,
  minutes: number,
  now: number,
  fallback?: ReminderInstance,
): Ledger {
  const base = ledger.entries[id];
  const src: LedgerEntry | undefined =
    base ??
    (fallback
      ? {
          id: fallback.id,
          kind: fallback.kind,
          entryId: fallback.entryId,
          title: fallback.title,
          occurrenceDate: fallback.occurrenceDate,
          scheduledTime: fallback.scheduledTime,
          scheduledAt: fallback.scheduledAt,
          offset: fallback.offset,
          fireAt: fallback.fireAt,
          state: "delivered",
        }
      : undefined);
  if (!src) return ledger;
  ledger.entries[id] = {
    ...src,
    state: "snoozed",
    snoozeUntil: now + minutes * 60000,
    snoozeCount: (src.snoozeCount ?? 0) + 1,
  };
  return ledger;
}

/** Cancel every pending reminder belonging to an entry (completed/deleted). */
export function cancelForEntry(ledger: Ledger, entryId: string, now: number): Ledger {
  for (const rec of Object.values(ledger.entries)) {
    if (rec.entryId === entryId && (rec.state === "snoozed")) {
      ledger.entries[rec.id] = { ...rec, state: "cancelled", cancelledAt: now };
    }
  }
  return ledger;
}

/* ------------------------------------------------------------ copy ------ */

export function offsetLabel(offset: number): string {
  if (offset === 0) return "AT SCHEDULED TIME";
  if (offset === 1440) return "1 DAY BEFORE";
  if (offset >= 60) return `${Math.round(offset / 60)} HOUR${offset >= 120 ? "S" : ""} BEFORE`;
  return `${offset} MIN BEFORE`;
}

export function notificationBody(inst: ReminderInstance, missed: boolean): string {
  const when = `${inst.occurrenceDate} · ${inst.scheduledTime}`;
  const lead =
    inst.offset === 0
      ? inst.kind === "task"
        ? "Due now"
        : "Starting now"
      : `${inst.kind === "task" ? "Due" : "Starts"} in ${offsetLabel(inst.offset)
          .replace(" BEFORE", "")
          .toLowerCase()}`;
  return missed ? `MISSED · ${lead} — ${when}` : `${lead} — ${when}`;
}
