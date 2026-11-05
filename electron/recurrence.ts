/**
 * WAYPOINT — recurrence date arithmetic (SHARED · PURE · ZERO IMPORTS).
 *
 * SINGLE SOURCE OF TRUTH for every repeating-entry date calculation. It is
 * imported by BOTH:
 *   • electron/reminder-core.ts  → background reminder scheduler (main process)
 *   • src/lib/time.ts            → renderer: calendar, events page, dashboard
 *
 * Having exactly one implementation is deliberate: the UI and the scheduler
 * must never disagree about which dates a repeating entry occurs on.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * MONTHLY RECURRENCE CONTRACT (Stage 03.1)
 *
 * Monthly occurrences are ANCHOR-BASED and computed as an absolute offset
 * from the series start — never by stepping a cursor forward one month at a
 * time. Date.prototype.setMonth() is never used for month arithmetic because
 * it overflows ("2026-01-31" + 1 month → 2026-03-03), which both skips
 * February and permanently corrupts every later occurrence.
 *
 *   • The original day-of-month is the anchor.
 *   • If a target month is too short, the occurrence clamps to that month's
 *     final valid day (Jan 31 → Feb 28).
 *   • The anchor is restored as soon as a month is long enough again
 *     (Feb 28 → Mar 31), because each occurrence is derived from the start
 *     index rather than from the previous (clamped) occurrence.
 *   • Leap years follow naturally from the real length of February.
 *   • Index-based derivation means there is zero cumulative drift.
 *
 *   2026-01-31 → 01-31, 02-28, 03-31, 04-30, 05-31
 *   2024-01-31 → 01-31, 02-29, 03-31, 04-30   (leap)
 *   2026-05-30 → 05-30, 06-30, 07-30, 08-30
 * ──────────────────────────────────────────────────────────────────────────
 *
 * All values are LOCAL calendar dates in `yyyy-mm-dd` form. Day arithmetic
 * runs through UTC helpers purely to count calendar days deterministically,
 * so daylight-saving transitions can never shift a date.
 */

export type RepeatRule = "none" | "daily" | "weekly" | "monthly";

/** Guard against pathological loops; ~400 years of monthly occurrences. */
const MAX_OCCURRENCES = 5000;

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = String(iso).split("-").map(Number);
  return { y: y || 1970, m: m || 1, d: d || 1 };
}

export function formatISO(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Number of days in a 1-based month. Leap years handled by the engine. */
export function daysInMonth(year: number, month1: number): number {
  // Day 0 of the following month is the last day of this month.
  return new Date(year, month1, 0).getDate();
}

/** The day-of-month an entry's series is anchored to. */
export function anchorDayOf(iso: string): number {
  return parseISO(iso).d;
}

/**
 * Resolve the anchor for a series: an explicitly stored anchor wins,
 * otherwise fall back to the start date's own day-of-month.
 *
 * Records created before Stage 03.1 have no stored anchor — deriving it here
 * keeps them working without any destructive migration.
 */
export function resolveAnchorDay(startISO: string, anchorDay?: number): number {
  if (typeof anchorDay === "number" && Number.isFinite(anchorDay)) {
    return Math.min(31, Math.max(1, Math.round(anchorDay)));
  }
  return anchorDayOf(startISO);
}

/** Calendar-day addition. DST-proof (pure UTC arithmetic). */
export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return formatISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole calendar days from `a` to `b` (negative when b precedes a). */
export function daysBetween(a: string, b: string): number {
  const A = parseISO(a);
  const B = parseISO(b);
  return Math.round(
    (Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000,
  );
}

/**
 * `startISO` advanced by `n` whole months, clamped to the anchor day.
 *
 * This is the core of the monthly fix: the result is derived from the START
 * of the series plus an index, so a short month can never poison the dates
 * that follow it.
 */
export function addMonthsAnchored(startISO: string, n: number, anchorDay?: number): string {
  const { y, m } = parseISO(startISO);
  const anchor = resolveAnchorDay(startISO, anchorDay);
  const totalMonths = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1; // 1-based
  return formatISO(ny, nm, Math.min(anchor, daysInMonth(ny, nm)));
}

/** Whole months between two dates, ignoring the day component. */
export function monthsBetween(a: string, b: string): number {
  const A = parseISO(a);
  const B = parseISO(b);
  return (B.y - A.y) * 12 + (B.m - A.m);
}

/**
 * Advance one cycle from `iso`.
 *
 * For monthly rules the anchor is re-applied, so a series sitting on a
 * clamped date (e.g. Feb 28, anchored to 31) correctly returns to the anchor
 * on the next cycle (Mar 31). Used for "generate the next cycle when a
 * repeating task is completed".
 */
export function shiftByRule(iso: string, rule: RepeatRule, anchorDay?: number): string {
  if (rule === "daily") return addDays(iso, 1);
  if (rule === "weekly") return addDays(iso, 7);
  if (rule === "monthly") return addMonthsAnchored(iso, 1, anchorDay);
  return iso;
}

/**
 * Every occurrence of a repeating entry whose date falls inside
 * [fromISO, toISO] (inclusive). Occurrences before the series start are
 * never produced.
 *
 * This single function backs the calendar grid, the events page, the
 * dashboard and the background reminder scheduler.
 */
export function enumerateOccurrences(
  startISO: string,
  rule: RepeatRule,
  fromISO: string,
  toISO: string,
  anchorDay?: number,
): string[] {
  const out: string[] = [];
  if (!startISO || toISO < fromISO) return out;

  if (rule === "none" || !rule) {
    if (startISO >= fromISO && startISO <= toISO) out.push(startISO);
    return out;
  }

  if (rule === "monthly") {
    const anchor = resolveAnchorDay(startISO, anchorDay);
    // Jump straight to the first index that can land in the window, then
    // step back one so a clamped date just inside the window is not missed.
    let i = Math.max(0, monthsBetween(startISO, fromISO) - 1);
    let guard = 0;
    while (guard++ < MAX_OCCURRENCES) {
      const date = addMonthsAnchored(startISO, i, anchor);
      if (date > toISO) break;
      if (date >= fromISO && date >= startISO) out.push(date);
      i++;
    }
    return out;
  }

  // daily / weekly — uniform day steps, so simple addition cannot drift.
  const step = rule === "weekly" ? 7 : 1;
  let cursor = startISO;
  if (cursor < fromISO) {
    const gap = daysBetween(cursor, fromISO);
    const jumps = Math.floor(gap / step);
    if (jumps > 0) cursor = addDays(cursor, jumps * step);
    let g = 0;
    while (cursor < fromISO && g++ < MAX_OCCURRENCES) cursor = addDays(cursor, step);
  }
  let guard = 0;
  while (cursor <= toISO && guard++ < MAX_OCCURRENCES) {
    if (cursor >= startISO) out.push(cursor);
    cursor = addDays(cursor, step);
  }
  return out;
}
