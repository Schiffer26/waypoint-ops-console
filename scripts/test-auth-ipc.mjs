// Integration of the real compiled IPC handlers against mocked Electron windows.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handlers, windows, app, ipcMain } from 'electron';
const dir = await mkdtemp(path.join(tmpdir(), 'waypoint-ipc-'));
process.env.WAYPOINT_TEST_DIR = dir;
process.env.WAYPOINT_TEST = '1';
process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173/';
const dbkey = 'waypoint.db.v1';
const payload = { version: 4, state: { tasks: [{id:'task1', title:'PRIVATE TASK', description:'PRIVATE NOTES', date:'2099-01-01', completed:false}], events: [{id:'event1', title:'PRIVATE FUTURE', description:'EVENT NOTES', date:'2099-01-01', startTime:'12:00',endTime:'13:00',repeat:'none'}], categories: [], settings: {theme:'dark', operatorName:'TEST',hour24:true, notificationsEnabled:false} } };
const original = JSON.stringify({ [dbkey]: JSON.stringify(payload) });
try {
  await writeFile(path.join(dir, 'waypoint-store.json'), original);
  // Exercise the Windows-only initialization branch on non-Windows test hosts.
  if (process.argv.includes('--simulate-windows')) Object.defineProperty(process, 'platform', { value: 'win32' });
  await import('../dist-electron/main.js');
  await new Promise(r => setImmediate(r));
  if (process.platform === 'win32') assert.equal(app.appUserModelId, 'com.waypoint.console', 'Windows app identity should be registered');
  const main = windows[0];
  const event = (w, frame = w.webContents.mainFrame) => ({sender:w.webContents, senderFrame:frame});
  const invoke = (name, sender, ...args) => Promise.resolve().then(() => handlers.get(`waypoint:${name}`)(sender, ...args));
  const denied = (p) => assert.rejects(p, /Authorization denied/);
  const me = event(main);
  assert.equal(await invoke('auth:status', me), false);
  await denied(invoke('auth:verify-settings', me, 'a strong access key'));
  assert.equal(await invoke('auth:appearance', me), 'dark');
  // Tasks, events and settings share this one KV payload, including mutation.
  for (const op of ['read', 'write', 'remove']) await denied(invoke(`storage:${op}`, me, dbkey, '{}'));
  for (const name of ['reminders:history','reminders:clear-history','reminders:snooze','reminders:status','reminders:rescan','reminders:test','reminders:test-sound','reminders:cancel-entry','autoLaunch:get','autoLaunch:set','notify','briefing:open','capabilities']) await denied(invoke(name, me));
  ipcMain.emit('waypoint:renderer-ready', me);
  globalThis.__waypointDebug.trayAddTask('task');
  assert.equal(main.webContents.sent.length, 0, 'tray directive must remain queued');
  globalThis.__waypointDebug.createBriefingWindow();
  const briefing = windows[1], be = event(briefing);
  const snapshot = await invoke('briefing:snapshot', be);
  assert(!snapshot.includes('PRIVATE TASK') && !snapshot.includes('PRIVATE FUTURE') && !snapshot.includes('PRIVATE NOTES'));
  for (const op of ['read','write','remove']) await denied(invoke(`storage:${op}`, be, dbkey, '{}'));
  await denied(invoke('reminders:history', be));
  await denied(invoke('auth:status', be));
  await denied(invoke('auth:verify-settings', be, 'a strong access key'));
  await invoke('open-main', be);
  assert.equal(await readFile(path.join(dir, 'waypoint-store.json'), 'utf8'), original);
  await invoke('auth:create', me, 'operator', 'a strong access key');
  assert.equal(await invoke('storage:read', me, dbkey), JSON.stringify(payload));
  await denied(invoke('auth:verify-settings', be, 'a strong access key'));
  await denied(invoke('auth:verify-settings', event(main, {}), 'a strong access key'));
  assert.equal(await invoke('auth:verify-settings', me, 'incorrect access key'), false);
  const attempts = JSON.parse(await readFile(path.join(dir, 'waypoint-auth-attempts.json'), 'utf8'));
  assert.equal(attempts.failures, 1, 'settings attempts share the persistent login throttle');
  assert.equal(await invoke('auth:verify-settings', me, 'a strong access key'), true);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'waypoint-auth-attempts.json'), 'utf8')).failures, 0);
  assert.equal(await invoke('storage:read', me, dbkey), JSON.stringify(payload), 'settings check does not disrupt main session');
  ipcMain.emit('waypoint:renderer-ready', me);
  assert.equal(main.webContents.sent[0][0], 'waypoint:open-create');
  await denied(invoke('storage:read', event(main, {}), dbkey));
  await denied(invoke('storage:read', be, dbkey));
  // Hide-to-tray does not invalidate the current session.
  main.close(); assert.equal(await invoke('storage:read', me, dbkey), JSON.stringify(payload));
  // A settings check must not grant or refresh a session after navigation.
  const pendingSettings = invoke('auth:verify-settings', me, 'a strong access key');
  await new Promise(r => setTimeout(r, 30));
  main.webContents.navigate('http://localhost:5173/');
  await denied(pendingSettings);
  await denied(invoke('auth:verify-settings', me, 'a strong access key'));
  await denied(invoke('storage:read', me, dbkey));
  assert.equal(await invoke('auth:verify', me, 'operator', 'incorrect access key'), false);
  await denied(invoke('storage:read', me, dbkey));
  assert.equal(await invoke('auth:verify', me, 'operator', 'a strong access key'), true);
  assert.equal(await invoke('storage:read', me, dbkey), JSON.stringify(payload));
  main.webContents.navigate('https://untrusted.example/');
  await denied(invoke('auth:verify', me, 'operator', 'a strong access key'));
  await denied(invoke('storage:read', me, dbkey));
  main.webContents.navigate('http://localhost:5173/');
  // An async successful verification cannot resurrect a session after reload.
  const pending = invoke('auth:verify', me, 'operator', 'a strong access key');
  await new Promise(r => setTimeout(r, 30));
  main.webContents.navigate('http://localhost:5173/');
  await denied(pending);
  await denied(invoke('storage:read', me, dbkey));
  // Destroy/recreate is equivalent to a new process's empty session.
  main.destroy(); globalThis.__waypointDebug.showMainWindow();
  const replacement = windows[2], re = event(replacement);
  await denied(invoke('storage:read', re, dbkey));
  assert.equal(await invoke('auth:verify', re, 'operator', 'a strong access key'), true);
  assert.equal(await invoke('storage:read', re, dbkey), JSON.stringify(payload));
  app.emit('before-quit');
  assert.equal(await readFile(path.join(dir, 'waypoint-store.json'), 'utf8'), original);
  console.log('Mock Electron IPC integration: authorization, session lifecycle, briefing, navigation, and data preservation passed');
} finally { await rm(dir, {recursive:true, force:true}); }
