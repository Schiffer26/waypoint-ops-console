/**
 * WAYPOINT operations store.
 *
 * Single zustand store persisted through the storage resolution layer
 * (Electron file bridge when packaged, localStorage in the browser).
 * All mutations keep `updatedAt` stamps monotonic so future sync stages
 * can reconcile records cheaply.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AppSettings,
  Category,
  EventEntry,
  OpsData,
  TaskEntry,
} from "@/types";
import { normalizeReminder } from "@/types";
import { buildSeed } from "@/data/seed";
import { resolveStorageBackend, uid } from "@/lib/storage";
import { anchorDayOf, resolveAnchorDay, shiftByRule } from "@/lib/time";

export const STORE_KEY = "waypoint.db.v1";

export interface OpsActions {
  addTask: (t: Omit<TaskEntry, "id" | "kind" | "createdAt" | "updatedAt">) => TaskEntry;
  updateTask: (id: string, patch: Partial<TaskEntry>) => void;
  /** Complete / restore. Completing a repeating task spawns its next cycle. */
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  purgeCompleted: () => void;

  addEvent: (e: Omit<EventEntry, "id" | "kind" | "createdAt" | "updatedAt">) => EventEntry;
  updateEvent: (id: string, patch: Partial<EventEntry>) => void;
  deleteEvent: (id: string) => void;

  reschedule: (kind: "task" | "event", id: string, dateISO: string) => void;

  addCategory: (c: Omit<Category, "id">) => Category;
  updateCategory: (id: string, patch: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  updateSettings: (patch: Partial<AppSettings>) => void;
  replaceAll: (data: OpsData) => void;
  factoryReset: (withSeed: boolean) => void;
}

export type OpsStore = OpsData & OpsActions;

const seed = buildSeed();

export const useOpsStore = create<OpsStore>()(
  persist(
    (set, get) => ({
      ...seed,

      addTask: (t) => {
        const now = Date.now();
        const entry: TaskEntry = { ...t, id: uid(), kind: "task", createdAt: now, updatedAt: now };
        set((s) => ({ tasks: [...s.tasks, entry] }));
        return entry;
      },
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, ...patch, id, kind: "task" as const, updatedAt: Date.now() } : t,
          ),
        })),
      toggleTask: (id) =>
        set((s) => {
          const idx = s.tasks.findIndex((t) => t.id === id);
          if (idx < 0) return {};
          const t = s.tasks[idx];
          const now = Date.now();
          const nextCompleted = !t.completed;
          const updated: TaskEntry = {
            ...t,
            completed: nextCompleted,
            completedAt: nextCompleted ? now : undefined,
            updatedAt: now,
          };
          const tasks = s.tasks.slice();
          tasks[idx] = updated;
          // Repeat engine: completing a cycle materialises the next one.
          if (nextCompleted && t.repeat !== "none") {
            // The monthly anchor travels with the series, so a task clamped
            // by a short month (Jan 31 → Feb 28) returns to its original day
            // on the following cycle (→ Mar 31) instead of drifting.
            const anchorDay = resolveAnchorDay(t.date, t.repeatAnchorDay);
            tasks.push({
              ...t,
              id: uid(),
              date: shiftByRule(t.date, t.repeat, anchorDay),
              repeatAnchorDay: t.repeat === "monthly" ? anchorDay : t.repeatAnchorDay,
              completed: false,
              completedAt: undefined,
              createdAt: now,
              updatedAt: now,
            });
          }
          return { tasks };
        }),
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      purgeCompleted: () => set((s) => ({ tasks: s.tasks.filter((t) => !t.completed) })),

      addEvent: (e) => {
        const now = Date.now();
        const entry: EventEntry = { ...e, id: uid(), kind: "event", createdAt: now, updatedAt: now };
        set((s) => ({ events: [...s.events, entry] }));
        return entry;
      },
      updateEvent: (id, patch) =>
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id ? { ...e, ...patch, id, kind: "event" as const, updatedAt: Date.now() } : e,
          ),
        })),
      deleteEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),

      reschedule: (kind, id, dateISO) => {
        if (kind === "task") get().updateTask(id, { date: dateISO });
        else get().updateEvent(id, { date: dateISO });
      },

      addCategory: (c) => {
        const cat: Category = { ...c, id: uid() };
        set((s) => ({ categories: [...s.categories, cat] }));
        return cat;
      },
      updateCategory: (id, patch) =>
        set((s) => ({
          categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch, id } : c)),
        })),
      deleteCategory: (id) =>
        set((s) => {
          const remaining = s.categories.filter((c) => c.id !== id);
          if (remaining.length === 0) return {};
          const fallback = remaining[0].id;
          return {
            categories: remaining,
            tasks: s.tasks.map((t) => (t.categoryId === id ? { ...t, categoryId: fallback } : t)),
            events: s.events.map((e) => (e.categoryId === id ? { ...e, categoryId: fallback } : e)),
          };
        }),

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      replaceAll: (data) =>
        set({
          // Imported archives may predate Stage-03 — normalise their reminders
          // so old exported JSON keeps working.
          tasks: (data.tasks ?? []).map((t) => ({
            ...t,
            reminder: normalizeReminder(t.reminder),
            repeatAnchorDay:
              t.repeat === "monthly" ? resolveAnchorDay(t.date, t.repeatAnchorDay) : t.repeatAnchorDay,
          })),
          events: (data.events ?? []).map((e) => ({
            ...e,
            reminder: normalizeReminder(e.reminder),
            repeatAnchorDay:
              e.repeat === "monthly" ? resolveAnchorDay(e.date, e.repeatAnchorDay) : e.repeatAnchorDay,
          })),
          categories: data.categories?.length ? data.categories : buildSeed().categories,
          settings: { ...get().settings, ...data.settings },
        }),
      factoryReset: (withSeed) => {
        const fresh = buildSeed();
        set({
          tasks: withSeed ? fresh.tasks : [],
          events: withSeed ? fresh.events : [],
          categories: fresh.categories,
          settings: fresh.settings,
        });
      },
    }),
    {
      name: STORE_KEY,
      version: 4,
      storage: createJSONStorage(() => resolveStorageBackend().backend),
      /**
       * Merge strategy: hydration replaces the in-memory seed entirely when a
       * persisted record exists, so the operator's real data — never the
       * demonstration seed — is what renders. When the store was never saved
       * (first launch) the seed stays in place.
       */
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object") return current;
        const p = persisted as OpsData;
        return { ...current, ...p };
      },
      /**
       * Backward-compatible migrations — every existing record (tasks,
       * events, categories, completed ledger, preferences) is carried over
       * intact; only new fields are added.
       *
       *   v1 → v2  appearance + Daily Briefing settings
       *   v2 → v3  multi-offset reminders + reminder engine settings
       *   v3 → v4  monthly recurrence anchor (optional field, non-destructive)
       */
      migrate: (persisted, version) => {
        const data = persisted as Partial<OpsData> | undefined;
        if (!data) return data as unknown as OpsData;
        const migrated: Partial<OpsData> = {
          ...data,
          settings: {
            theme: "system",
            briefingAtLogin: true,
            notificationsEnabled: true,
            notificationSound: "subtle",
            catchUpMissed: true,
            consolidateMissed: true,
            ...(data.settings ?? {}),
          } as OpsData["settings"],
        };
        if (version < 3) {
          // Fold the legacy single `minutesBefore` reminder into `offsets`
          // so no existing reminder configuration is lost.
          migrated.tasks = (data.tasks ?? []).map((t) => ({
            ...t,
            reminder: normalizeReminder(t.reminder),
          }));
          migrated.events = (data.events ?? []).map((e) => ({
            ...e,
            reminder: normalizeReminder(e.reminder),
          }));
        }
        if (version < 4) {
          // Stamp the monthly recurrence anchor from each entry's stored
          // date. Purely additive: no existing field is altered, and
          // non-monthly entries are left untouched.
          const stamp = <T extends { date: string; repeat?: string; repeatAnchorDay?: number }>(
            x: T,
          ): T =>
            x.repeat === "monthly" && typeof x.repeatAnchorDay !== "number"
              ? { ...x, repeatAnchorDay: anchorDayOf(x.date) }
              : x;
          migrated.tasks = (migrated.tasks ?? data.tasks ?? []).map(stamp);
          migrated.events = (migrated.events ?? data.events ?? []).map(stamp);
        }
        return migrated as OpsData;
      },
      partialize: (s) => ({
        tasks: s.tasks,
        events: s.events,
        categories: s.categories,
        settings: s.settings,
      }),
    },
  ),
);

/**
 * True once the persisted store has been hydrated into memory.
 *
 * With the synchronous web fallback this is already true on the first
 * render; with the async Electron file bridge the UI must wait before
 * showing records — otherwise seed data would flash over real data, and
 * early writes could clobber the on-disk database.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState<boolean>(() => useOpsStore.persist.hasHydrated());
  useEffect(() => {
    const unsub = useOpsStore.persist.onFinishHydration(() => setHydrated(true));
    if (useOpsStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return hydrated;
}

/* ---------------- derived helpers (pure, unit-testable) ---------------- */

export function sortByDateTime<T extends { date: string; dueTime?: string; startTime?: string }>(
  list: T[],
): T[] {
  const key = (x: T) => `${x.date}T${x.dueTime ?? x.startTime ?? "99:99"}`;
  return [...list].sort((a, b) => key(a).localeCompare(key(b)));
}
