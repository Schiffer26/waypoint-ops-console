/**
 * WAYPOINT — Personal Operations Console
 * Core domain model. All data persists locally (no network dependency).
 */

export type EntryKind = "task" | "event";
export type Priority = "low" | "medium" | "high" | "critical";
export type RepeatRule = "none" | "daily" | "weekly" | "monthly";

export type PageKey =
  | "dashboard"
  | "tasks"
  | "calendar"
  | "events"
  | "completed"
  | "settings";

/** Offsets (minutes before the scheduled moment) offered by the UI. */
export const REMINDER_OFFSETS = [0, 5, 15, 30, 60, 1440] as const;
export const SNOOZE_DURATIONS = [5, 10, 15, 30] as const;

export function offsetLabel(offset: number): string {
  if (offset === 0) return "AT TIME";
  if (offset === 1440) return "1 DAY";
  if (offset >= 60) return `${Math.round(offset / 60)} HOUR`;
  return `${offset} MIN`;
}

export interface ReminderConfig {
  /** True when at least one offset is configured. */
  enabled: boolean;
  /**
   * Legacy single-offset field. Retained so previously exported JSON files
   * keep importing cleanly and old builds can still read new exports.
   * @deprecated use `offsets`
   */
  minutesBefore: number;
  /** Stage-03: multiple reminder offsets, minutes before the scheduled time. */
  offsets: number[];
}

/** Normalise any historical reminder shape into the current structure. */
export function normalizeReminder(raw: unknown): ReminderConfig {
  const r = (raw ?? {}) as Partial<ReminderConfig>;
  const list = Array.isArray(r.offsets)
    ? r.offsets
    : r.enabled === true && typeof r.minutesBefore === "number"
      ? [r.minutesBefore]
      : [];
  const offsets = [
    ...new Set(
      list
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)
        .map((n) => Math.round(n)),
    ),
  ].sort((a, b) => a - b);
  return {
    enabled: offsets.length > 0,
    minutesBefore: offsets[0] ?? 15,
    offsets,
  };
}

export type NotificationSound = "subtle" | "system" | "silent";

export interface TaskEntry {
  id: string;
  kind: "task";
  title: string;
  description: string;
  /** ISO local date, yyyy-mm-dd */
  date: string;
  /** Optional due time, HH:mm */
  dueTime?: string;
  categoryId: string;
  priority: Priority;
  reminder: ReminderConfig;
  repeat: RepeatRule;
  /**
   * Monthly recurrence anchor (day-of-month, 1–31).
   *
   * Optional for backward compatibility: records created before Stage 03.1
   * simply derive the anchor from `date`. Storing it lets a series that has
   * been clamped by a short month (Jan 31 → Feb 28) return to its original
   * day on the next cycle (→ Mar 31).
   */
  repeatAnchorDay?: number;
  completed: boolean;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface EventEntry {
  id: string;
  kind: "event";
  title: string;
  description: string;
  /** ISO local date, yyyy-mm-dd */
  date: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  categoryId: string;
  priority: Priority;
  reminder: ReminderConfig;
  repeat: RepeatRule;
  /**
   * Monthly recurrence anchor (day-of-month, 1–31).
   *
   * Optional for backward compatibility: records created before Stage 03.1
   * simply derive the anchor from `date`. Storing it lets a series that has
   * been clamped by a short month (Jan 31 → Feb 28) return to its original
   * day on the next cycle (→ Mar 31).
   */
  repeatAnchorDay?: number;
  createdAt: number;
  updatedAt: number;
}

export type Entry = TaskEntry | EventEntry;

export interface Category {
  id: string;
  /** Short technical code, e.g. OPS */
  code: string;
  name: string;
  color: string;
}

export type ThemeMode = "system" | "light" | "dark";

export interface AppSettings {
  operatorName: string;
  hour24: boolean;
  /** 1 = Monday, 0 = Sunday */
  weekStartsOn: 0 | 1;
  /** Appearance: follows Windows by default ("system"). */
  theme: ThemeMode;
  /** Show the compact Daily Briefing window when WAYPOINT starts via Windows login. */
  briefingAtLogin: boolean;
  /** Master switch for the background reminder engine. */
  notificationsEnabled: boolean;
  /** Notification sound profile. */
  notificationSound: NotificationSound;
  /** Replay reminders missed while WAYPOINT/Windows was off (24h look-back). */
  catchUpMissed: boolean;
  /** Collapse several missed reminders into one summary notification. */
  consolidateMissed: boolean;
}

export interface OpsData {
  tasks: TaskEntry[];
  events: EventEntry[];
  categories: Category[];
  settings: AppSettings;
}

export const PRIORITY_META: Record<
  Priority,
  { label: string; rank: number }
> = {
  critical: { label: "CRITICAL", rank: 0 },
  high: { label: "HIGH", rank: 1 },
  medium: { label: "MED", rank: 2 },
  low: { label: "LOW", rank: 3 },
};

export const REPEAT_META: Record<RepeatRule, string> = {
  none: "ONE-OFF",
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
};

/** A concrete occurrence of an (optionally repeating) event on a given date. */
export interface EventOccurrence extends EventEntry {
  occurrenceDate: string;
}
