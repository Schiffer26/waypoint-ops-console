/**
 * Time and calendar utilities. All dates are handled as local-time
 * ISO strings (yyyy-mm-dd) to stay timezone-safe for a desktop app.
 */
import type { RepeatRule, TaskEntry } from "@/types";
/**
 * Recurrence maths is imported from the SHARED module that the Electron
 * reminder scheduler also uses, so the calendar, events page, dashboard and
 * background notifications can never disagree about occurrence dates.
 */
import {
  addDays,
  addMonthsAnchored,
  anchorDayOf,
  daysInMonth,
  enumerateOccurrences,
  resolveAnchorDay,
  shiftByRule as shiftByRuleShared,
} from "../../electron/recurrence";

export {
  addMonthsAnchored,
  anchorDayOf,
  daysInMonth,
  enumerateOccurrences,
  resolveAnchorDay,
};

export const MONTHS_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
export const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export const todayISO = (): string => toISODate(new Date());

export function addDaysISO(iso: string, n: number): string {
  return addDays(iso, n);
}

/** "HH:mm" -> minutes since 00:00 */
export function timeToMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function minToTime(min: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(min)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** Merge an ISO date with an optional HH:mm into a Date. */
export function mergeISO(dateISO: string, time?: string): Date {
  const d = fromISODate(dateISO);
  const mins = timeToMin(time);
  if (mins !== null) d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d;
}

export function fmtClock(d: Date, hour24: boolean): string {
  if (hour24) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const h = d.getHours() % 12 || 12;
  return `${pad2(h)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

export function fmtHM(time: string | undefined, hour24: boolean): string {
  if (!time) return "—";
  const mins = timeToMin(time);
  if (mins === null) return "—";
  if (hour24) return time;
  const h24v = Math.floor(mins / 60);
  const h = h24v % 12 || 12;
  return `${h}:${pad2(mins % 60)} ${h24v >= 12 ? "PM" : "AM"}`;
}

/** "TUE · 04 FEB 2026" */
export function fmtHuman(iso: string): string {
  const d = fromISODate(iso);
  return `${DAYS_SHORT[d.getDay()]} · ${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "04 FEB" */
export function fmtShort(iso: string): string {
  const d = fromISODate(iso);
  return `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function fmtStamp(ts: number, hour24: boolean): string {
  const d = new Date(ts);
  return `${toISODate(d)} ${fmtClock(d, hour24).slice(0, hour24 ? 5 : 8)}`;
}

export function greetingFor(hour: number): string {
  if (hour < 5) return "LATE SHIFT";
  if (hour < 12) return "GOOD MORNING";
  if (hour < 18) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

export function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

/** ISO-8601 week number. */
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Advance one recurrence cycle. Monthly rules are anchor-based — see
 * electron/recurrence.ts, the module shared with the background scheduler.
 */
export function shiftByRule(iso: string, rule: RepeatRule, anchorDay?: number): string {
  return shiftByRuleShared(iso, rule, anchorDay);
}

export interface CountdownParts {
  d: number;
  h: number;
  m: number;
  s: number;
  past: boolean;
}

export function splitCountdown(ms: number): CountdownParts {
  const past = ms < 0;
  const abs = Math.abs(ms);
  return {
    d: Math.floor(abs / 86400000),
    h: Math.floor((abs % 86400000) / 3600000),
    m: Math.floor((abs % 3600000) / 60000),
    s: Math.floor((abs % 60000) / 1000),
    past,
  };
}

export function isTaskOverdue(
  t: Pick<TaskEntry, "completed" | "date" | "dueTime">,
  now: Date,
): boolean {
  if (t.completed) return false;
  const today = toISODate(now);
  if (t.date < today) return true;
  if (t.date === today && t.dueTime) {
    const mins = timeToMin(t.dueTime);
    if (mins !== null) return now.getHours() * 60 + now.getMinutes() > mins;
  }
  return false;
}

/** Short technical relative label for a date, e.g. TODAY / T+2 / OVERDUE 3D */
export function relLabel(iso: string, now: Date): string {
  const today = toISODate(now);
  if (iso === today) return "TODAY";
  if (iso === addDaysISO(today, 1)) return "TOMORROW";
  if (iso < today) {
    const days = Math.round((fromISODate(today).getTime() - fromISODate(iso).getTime()) / 86400000);
    return `OVERDUE ${days}D`;
  }
  const days = Math.round((fromISODate(iso).getTime() - fromISODate(today).getTime()) / 86400000);
  return `T+${days}D`;
}

/** Compact countdown like "2D 04H" / "03H 12M" / "12M 40S" */
export function compactCountdown(ms: number): string {
  const p = splitCountdown(ms);
  if (p.past) return "NOW";
  if (p.d > 0) return `${p.d}D ${pad2(p.h)}H`;
  if (p.h > 0) return `${pad2(p.h)}H ${pad2(p.m)}M`;
  return `${pad2(p.m)}M ${pad2(p.s)}S`;
}
