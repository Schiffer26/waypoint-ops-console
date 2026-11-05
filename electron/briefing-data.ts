/** Read-only, minimized data for the unauthenticated briefing window. */
import { addDays, enumerateOccurrences, formatISO, type RepeatRule } from "./recurrence.js";
import { DB_KEY } from "./prefs.js";
type Row = Record<string, any>; // persisted legacy records have optional fields
export function briefingSnapshot(kv: Record<string, string>, now = new Date()): string | null {
  const raw = kv[DB_KEY];
  if (!raw) return null;
  const state = (JSON.parse(raw) as { state?: Row }).state;
  if (!state || typeof state !== "object") throw new Error("Invalid briefing data");
  const today = formatISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const settings = state.settings ?? {};
  const tasks: Row[] = (Array.isArray(state.tasks) ? state.tasks : [])
    .filter((t: Row) => t.date === today || (t.date < today && !t.completed))
    .map((t: Row, i: number) => ({ id: `brief-task-${i}`, date: t.date, dueTime: t.dueTime, completed: !!t.completed }));
  const occurrences: Row[] = [];
  for (const e of Array.isArray(state.events) ? state.events : []) {
    for (const date of enumerateOccurrences(e.date, (e.repeat ?? "none") as RepeatRule, today, addDays(today, 180), e.repeatAnchorDay)) {
      occurrences.push({ date, startTime: e.startTime, endTime: e.endTime, categoryId: e.categoryId, title: e.title });
    }
  }
  occurrences.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  const todayEvents = occurrences.filter((e) => e.date === today);
  const next = occurrences.find((e) => {
    const [h, m] = String(e.endTime).split(":").map(Number);
    const end = new Date(`${e.date}T00:00:00`); end.setHours(h || 0, m || 0, 0, 0);
    return end.getTime() >= now.getTime();
  });
  const shown = [...todayEvents];
  if (next && next.date !== today) shown.push(next);
  const events = shown.map((e, i) => ({
    id: `brief-event-${i}`, date: e.date, startTime: e.startTime, endTime: e.endTime, repeat: "none",
    title: i < 3 || e === next ? e.title : "", categoryId: i < 3 ? e.categoryId : "",
  }));
  const ids = new Set(events.slice(0, 3).map((e) => e.categoryId));
  const categories = (Array.isArray(state.categories) ? state.categories : []).filter((c: Row) => ids.has(c.id))
    .map((c: Row) => ({ id: c.id, code: c.code, color: c.color }));
  return JSON.stringify({ version: 4, state: { tasks, events, categories, settings: { operatorName: settings.operatorName ?? "OPERATOR", hour24: settings.hour24 ?? true, theme: settings.theme ?? "system" } } });
}
export function appearance(kv: Record<string, string>): "light" | "dark" | "system" {
  try {
    const value = JSON.parse(kv[DB_KEY] ?? "{}").state?.settings?.theme;
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}
