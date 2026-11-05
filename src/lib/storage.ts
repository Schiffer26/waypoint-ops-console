/**
 * Storage resolution layer.
 *
 * The renderer talks to a key/value backend. In the packaged Windows app the
 * backend is a file inside the OS user-data directory, exposed through the
 * preloaded `window.waypoint.storage` bridge (async IPC). In a plain browser
 * it transparently falls back to `localStorage` so the interface never
 * depends on an online server.
 */
import type { WaypointBridge } from "@/types/desktop";

export interface KVBackend {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export type BackendName = "ELECTRON-FILE" | "WEB-LOCAL";

export function bridge(): WaypointBridge | undefined {
  return typeof window !== "undefined" ? window.waypoint : undefined;
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.waypoint;
}

let cached: { name: BackendName; backend: KVBackend } | null = null;

/**
 * Resolve the persistence backend. The Electron file bridge is preferred and
 * always wins when present (the bridge exists from the very first renderer
 * tick, since the preload runs before any script). In a plain browser we fall
 * back to localStorage.
 *
 * The cache is only memoized once the authoritative backend (Electron) is
 * resolved, or once the web fallback is confirmed — and the web fallback is
 * re-checkable so a later desktop upgrade cannot leave state stranded.
 */
export function resolveStorageBackend(): { name: BackendName; backend: KVBackend } {
  const b = bridge();
  if (b?.storage) {
    if (!cached || cached.name !== "ELECTRON-FILE") {
      cached = {
        name: "ELECTRON-FILE",
        backend: {
          getItem: (k) => b.storage.read(k),
          setItem: (k, v) => b.storage.write(k, v),
          removeItem: (k) => b.storage.remove(k),
        },
      };
    }
    return cached;
  }
  if (!cached) {
    cached = { name: "WEB-LOCAL", backend: window.localStorage };
  }
  return cached;
}

/** Collision-safe id generator with fallback for non-secure contexts. */
export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
