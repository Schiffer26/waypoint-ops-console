/**
 * WAYPOINT — persisted-preference reader (main process).
 *
 * The renderer's Zustand store is persisted through the file-backed KV
 * bridge as TWO nested JSON layers inside userData/waypoint-store.json:
 *
 *   { "waypoint.db.v1": "{\"version\":2,\"state\":{ ...ops data... }}" }
 *   └─ outer KV envelope        └─ serialized zustand persist payload
 *
 * This module decodes that structure safely. Kept dependency-free and pure
 * so it can be unit-tested from plain Node against the compiled output.
 */

export const STORE_FILE_NAME = "waypoint-store.json";
export const DB_KEY = "waypoint.db.v1";

export interface ParsedDbPayload {
  version?: number;
  state?: {
    settings?: {
      briefingAtLogin?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

/**
 * Extract the Daily-Briefing preference from the raw storage-file content.
 *  - explicit `false` is respected;
 *  - `true` only when the preference has never been saved;
 *  - malformed / missing layers default to `true` (fail-open for the
 *    briefing is the designed default of the app settings).
 */
export function parseBriefingPreference(fileContent: string | null | undefined): boolean {
  if (!fileContent) return true;
  try {
    // 1 — outer key-value envelope
    const kv = JSON.parse(fileContent) as Record<string, unknown>;
    if (!kv || typeof kv !== "object") return true;
    const raw = kv[DB_KEY];
    if (typeof raw !== "string" || raw.length === 0) return true;
    // 2 — serialized zustand persist payload
    const payload = JSON.parse(raw) as ParsedDbPayload;
    const pref = payload?.state?.settings?.briefingAtLogin;
    // 3 — only an explicitly saved false disables the popup
    return pref !== false;
  } catch {
    return true;
  }
}
