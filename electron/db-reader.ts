/**
 * WAYPOINT — read-only access to the renderer-owned operations database.
 *
 * The main process NEVER writes this file; the renderer (zustand persist via
 * the storage IPC bridge) is the single authoritative writer. The scheduler
 * only reads it to compute reminder schedules.
 *
 * Structure (two nested JSON layers — same as electron/prefs.ts):
 *   { "waypoint.db.v1": "{\"version\":3,\"state\":{ tasks, events, settings }}" }
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DB_KEY, STORE_FILE_NAME } from "./prefs.js";
import type { CoreDb } from "./reminder-core.js";

export interface ReadDbResult {
  db: CoreDb;
  /** False when the store file is absent or unreadable. */
  ok: boolean;
}

const EMPTY: CoreDb = { tasks: [], events: [], settings: {} };

export function parseDb(fileContent: string | null | undefined): ReadDbResult {
  if (!fileContent) return { db: EMPTY, ok: false };
  try {
    const kv = JSON.parse(fileContent) as Record<string, unknown>;
    if (!kv || typeof kv !== "object" || Array.isArray(kv)) return { db: EMPTY, ok: false };
    const raw = kv[DB_KEY];
    if (typeof raw !== "string" || !raw) return { db: EMPTY, ok: false };
    const payload = JSON.parse(raw) as { state?: Partial<CoreDb> };
    const state = payload?.state;
    if (!state || typeof state !== "object") return { db: EMPTY, ok: false };
    return {
      ok: true,
      db: {
        tasks: Array.isArray(state.tasks) ? state.tasks : [],
        events: Array.isArray(state.events) ? state.events : [],
        settings: (state.settings as CoreDb["settings"]) ?? {},
      },
    };
  } catch {
    return { db: EMPTY, ok: false };
  }
}

export function readDb(userDataDir: string): ReadDbResult {
  const file = path.join(userDataDir, STORE_FILE_NAME);
  try {
    if (!existsSync(file)) return { db: EMPTY, ok: false };
    return parseDb(readFileSync(file, "utf-8"));
  } catch {
    return { db: EMPTY, ok: false };
  }
}
