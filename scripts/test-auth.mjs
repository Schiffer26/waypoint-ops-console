import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { operatorExists, createOperator, authenticate, authenticateKey } from '../dist-electron/auth.js';

const dir = await mkdtemp(path.join(tmpdir(), 'waypoint-auth-'));
const file = path.join(dir, 'auth.json');
try {
  assert.equal(await operatorExists(file), false);
  await assert.rejects(createOperator(file, 'operator', 'too short'));
  await createOperator(file, 'operator', 'a strong passphrase with spaces');
  assert.equal(await operatorExists(file), true);
  const stored = await readFile(file, 'utf8');
  assert(!stored.includes('operator') || !stored.includes('"operator"'));
  assert(!stored.includes('a strong passphrase with spaces'));
  assert.equal(await authenticate(file, 'operator', 'a strong passphrase with spaces'), true);
  assert.equal(await authenticateKey(file, 'a strong passphrase with spaces'), true);
  assert.equal(await authenticateKey(file, 'a wrong passphrase'), false);
  assert.equal(await authenticate(file, 'operator', 'a wrong passphrase'), false);
  assert.equal(await authenticate(file, 'another', 'a strong passphrase with spaces'), false);
  await assert.rejects(createOperator(file, 'another', 'another valid passphrase'));
  assert.equal(await authenticate(file, 'operator', 'a strong passphrase with spaces'), true);
  await writeFile(file, 'corrupt');
  await assert.rejects(operatorExists(file));
  await assert.rejects(createOperator(file, 'another', 'another valid passphrase'));
  console.log('Operator authentication tests passed');
} finally { await rm(dir, { recursive: true, force: true }); }

// The throttle is deterministic here: no wall-clock sleeps are required.
{
  const { LoginThrottle } = await import('../dist-electron/auth.js');
  const { ConsoleSession } = await import('../dist-electron/session.js');
  const dir2 = await mkdtemp(path.join(tmpdir(), 'waypoint-throttle-'));
  try {
    let now = 1000;
    const waits = [];
    const wait = async (ms) => { waits.push(ms); now += ms; };
    let limiter = new LoginThrottle(path.join(dir2, 'attempts.json'), () => now, wait);
    await limiter.run(async () => false);
    await limiter.run(async () => false);
    // Reconstructing the main-process limiter preserves failed attempts.
    limiter = new LoginThrottle(path.join(dir2, 'attempts.json'), () => now, wait);
    for (let i = 0; i < 8; i++) await limiter.run(async () => false);
    assert.deepEqual(waits.slice(0, 6), [0, 0, 1000, 2000, 4000, 8000]);
    assert(waits.includes(30000));
    assert(waits.every(ms => ms <= 30000));
    assert.equal(await limiter.run(async () => true), true);
    await limiter.run(async () => false);
    assert.equal(waits.at(-1), 0, 'successful login resets failures');
    const win = { webContents: {}, mainFrame: {}, url: 'http://localhost:5173/' };
    const event = {sender: win.webContents, senderFrame: win.mainFrame};
    const session = new ConsoleSession();
    session.grant(event, win, win.url, session.snapshot());
    session.requireAuthenticated(event, win, win.url);
    const afterRestart = new ConsoleSession();
    assert.throws(() => afterRestart.requireAuthenticated(event, win, win.url), /authentication required/);
    console.log('Persistent progressive throttle and new-process session tests passed');
  } finally { await rm(dir2, {recursive:true, force:true}); }
}

// Stage 04A v1 scrypt records remain valid and are upgraded only on success.
{
  const { scryptSync, createHash, randomBytes } = await import('node:crypto');
  const dir3 = await mkdtemp(path.join(tmpdir(), 'waypoint-legacy-'));
  const file3 = path.join(dir3, 'auth.json');
  try {
    const salt = randomBytes(16);
    const record = {version:1, operatorHash:createHash('sha256').update('legacy').digest('hex'), salt:salt.toString('hex'), verifier:scryptSync('legacy passphrase', salt, 64).toString('hex')};
    await writeFile(file3, JSON.stringify(record));
    assert.equal(await authenticateKey(file3, 'legacy passphrase'), true);
    assert.equal(await authenticateKey(file3, 'wrong passphrase'), false);
    assert.equal(await authenticate(file3, 'legacy', 'wrong passphrase'), false);
    assert.equal(JSON.parse(await readFile(file3, 'utf8')).version, 1);
    assert.equal(await authenticate(file3, 'legacy', 'legacy passphrase'), true);
    assert.equal(JSON.parse(await readFile(file3, 'utf8')).version, 2);
    assert.equal(await authenticate(file3, 'legacy', 'legacy passphrase'), true);
    console.log('Legacy credential upgrade tests passed');
  } finally { await rm(dir3, {recursive:true, force:true}); }
}
