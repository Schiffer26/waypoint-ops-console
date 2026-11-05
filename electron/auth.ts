/** Local verifier: scrypt v2; v1 records are upgraded on successful login. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";

function derive(key: string, salt: Buffer, strong: boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(key, salt, 64, strong ? OPTIONS : {}, (error, result) => error ? reject(error) : resolve(result)));
}
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
type RecordData = { version: 1 | 2; operatorHash: string; salt: string; verifier: string };
async function load(file: string): Promise<RecordData | null> {
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const record = JSON.parse(raw) as RecordData;
  if (!record || (record.version !== 1 && record.version !== 2) || !/^[a-f0-9]{64}$/.test(record.operatorHash) ||
      !/^[a-f0-9]{32}$/.test(record.salt) || !/^[a-f0-9]{128}$/.test(record.verifier)) throw new Error("Invalid local operator record");
  return record;
}
const operatorDigest = (operator: string) => createHash("sha256").update(operator, "utf8").digest();
const valid = (operator: unknown, key: unknown): operator is string =>
  typeof operator === "string" && operator.trim().length > 0 && operator.length <= 128 &&
  typeof key === "string" && key.length >= 12 && key.length <= 128;
async function newRecord(operator: string, key: string): Promise<RecordData> {
  const salt = randomBytes(16);
  const verifier = await derive(key, salt, true);
  return { version: 2, operatorHash: operatorDigest(operator).toString("hex"), salt: salt.toString("hex"), verifier: verifier.toString("hex") };
}
async function atomicReplace(file: string, data: string): Promise<void> {
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try { await writeFile(tmp, data, { flag: "wx", mode: 0o600 }); await rename(tmp, file); }
  finally { await unlink(tmp).catch(() => {}); }
}
export async function operatorExists(file: string): Promise<boolean> { return (await load(file)) !== null; }
export async function createOperator(file: string, operator: unknown, key: unknown): Promise<void> {
  if (!valid(operator, key)) throw new Error("Invalid operator credentials");
  const record = await newRecord(operator, key as string);
  await writeFile(file, JSON.stringify(record), { flag: "wx", mode: 0o600 });
}
export async function authenticate(file: string, operator: unknown, key: unknown): Promise<boolean> {
  if (!valid(operator, key)) return false;
  const record = await load(file);
  if (!record) return false;
  const salt = Buffer.from(record.salt, "hex");
  const candidate = await derive(key as string, salt, record.version === 2);
  const keyMatches = timingSafeEqual(candidate, Buffer.from(record.verifier, "hex"));
  const operatorMatches = timingSafeEqual(operatorDigest(operator), Buffer.from(record.operatorHash, "hex"));
  if (!keyMatches || !operatorMatches) return false;
  if (record.version === 1) await atomicReplace(file, JSON.stringify(await newRecord(operator, key as string)));
  return true;
}

/** Password-only check for an already-authenticated operator; never grants a session. */
export async function authenticateKey(file: string, key: unknown): Promise<boolean> {
  if (typeof key !== "string" || key.length < 12 || key.length > 128) return false;
  const record = await load(file);
  if (!record) return false;
  const candidate = await derive(key, Buffer.from(record.salt, "hex"), record.version === 2);
  return timingSafeEqual(candidate, Buffer.from(record.verifier, "hex"));
}

/** Persisted throttle. Serialize attempts so concurrent IPC cannot evade delays. */
export class LoginThrottle {
  private queue: Promise<void> = Promise.resolve();
  constructor(private file: string, private now = () => Date.now(), private wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {}
  run(verify: () => Promise<boolean>): Promise<boolean> {
    const result = this.queue.then(async () => {
      let state = { failures: 0, next: 0 };
      try {
        const parsed = JSON.parse(await readFile(this.file, "utf8"));
        if (!Number.isSafeInteger(parsed.failures) || parsed.failures < 0 || !Number.isFinite(parsed.next) || parsed.next < 0) throw new Error("Invalid attempt state");
        state = { failures: Math.min(parsed.failures, 100), next: parsed.next };
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      // Bound waits if the clock changed or the file was tampered with.
      await this.wait(Math.max(0, Math.min(30000, state.next - this.now())));
      const ok = await verify();
      const failures = ok ? 0 : Math.min(100, state.failures + 1);
      const delay = failures < 2 ? 0 : Math.min(30000, 1000 * 2 ** Math.min(5, failures - 2));
      await atomicReplace(this.file, JSON.stringify({ failures, next: this.now() + delay }));
      return ok;
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
