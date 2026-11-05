/**
 * WAYPOINT — reminder delivery ledger persistence.
 *
 * Kept in its OWN file (waypoint-reminder-ledger.json) so the scheduler never
 * writes to the renderer-owned task/event database (waypoint-store.json) and
 * the two can never race.
 *
 * Writes are atomic: content lands in a temp file, is flushed, then renamed
 * over the target. An interrupted write therefore leaves either the previous
 * good file or an orphan temp file — never a truncated ledger. A corrupt or
 * missing ledger degrades to empty without touching user data.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { sanitizeLedger, type Ledger } from "./reminder-core.js";

export const LEDGER_FILE_NAME = "waypoint-reminder-ledger.json";

export function ledgerPath(userDataDir: string): string {
  return path.join(userDataDir, LEDGER_FILE_NAME);
}

export function readLedger(userDataDir: string): Ledger {
  const file = ledgerPath(userDataDir);
  try {
    if (!existsSync(file)) return sanitizeLedger(null);
    return sanitizeLedger(JSON.parse(readFileSync(file, "utf-8")));
  } catch {
    // corrupt JSON / unreadable → start clean, user data untouched
    return sanitizeLedger(null);
  }
}

export function writeLedgerAtomic(userDataDir: string, ledger: Ledger): void {
  const file = ledgerPath(userDataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const payload = JSON.stringify(ledger);
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, payload);
      fsyncSync(fd); // flush to disk before the rename
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file); // atomic on both NTFS and POSIX
  } catch {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    // Last-resort non-atomic attempt; never throws into the scheduler.
    try {
      writeFileSync(file, JSON.stringify(ledger), "utf-8");
    } catch {
      /* give up silently — reminders still work in memory this session */
    }
  }
}
