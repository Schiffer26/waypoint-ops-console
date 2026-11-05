/**
 * Schedule expansion — turns repeating events into concrete occurrences
 * inside a date window. Pure functions; used by Calendar, Events and the
 * dashboard countdown.
 */
import type { EventEntry, EventOccurrence } from "@/types";
import {
  addDaysISO,
  enumerateOccurrences,
  fromISODate,
  resolveAnchorDay,
  toISODate,
} from "@/lib/time";

/**
 * Expand events into occurrences covering [fromISO, toISO] inclusive.
 *
 * Delegates to the SHARED recurrence enumerator that the Electron reminder
 * scheduler also uses, so the calendar, events page and dashboard always
 * show exactly the dates the background engine will notify on.
 */
export function expandEvents(
  events: EventEntry[],
  fromISO: string,
  toISO: string,
): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const e of events) {
    const dates = enumerateOccurrences(
      e.date,
      e.repeat ?? "none",
      fromISO,
      toISO,
      resolveAnchorDay(e.date, e.repeatAnchorDay),
    );
    for (const occurrenceDate of dates) out.push({ ...e, occurrenceDate });
  }
  return out.sort((a, b) =>
    `${a.occurrenceDate}T${a.startTime}`.localeCompare(`${b.occurrenceDate}T${b.startTime}`),
  );
}

function occurrenceStartMs(o: EventOccurrence): number {
  const d = fromISODate(o.occurrenceDate);
  const [h, m] = o.startTime.split(":").map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

function occurrenceEndMs(o: EventOccurrence): number {
  const d = fromISODate(o.occurrenceDate);
  const [h, m] = o.endTime.split(":").map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

/**
 * The event currently live or next to occur. An event that started today
 * but hasn't ended yet is reported as live (countdown target = its end).
 */
export function nextEventAfter(events: EventEntry[], now: Date): EventOccurrence | null {
  const from = toISODate(now);
  const horizon = addDaysISO(from, 180);
  const occ = expandEvents(events, from, horizon).filter(
    (o) => occurrenceEndMs(o) >= now.getTime(),
  );
  return occ[0] ?? null;
}

export function occurrenceIsLive(o: EventOccurrence, now: Date): boolean {
  const nowMs = now.getTime();
  return occurrenceStartMs(o) <= nowMs && occurrenceEndMs(o) >= nowMs;
}

export function occurrenceStart(o: EventOccurrence): number {
  return occurrenceStartMs(o);
}
export function occurrenceEnd(o: EventOccurrence): number {
  return occurrenceEndMs(o);
}
