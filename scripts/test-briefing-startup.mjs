// Real main-process lifecycle/IPC handlers, using mocked Electron windows.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handlers, windows, app } from 'electron';

const scenario = process.argv[2];
if (!['manual', 'startup', 'disabled'].includes(scenario)) throw new Error('Missing scenario');
if (scenario === 'startup') process.argv.push('--waypoint-startup');
const dir = await mkdtemp(path.join(tmpdir(), 'waypoint-startup-'));
process.env.WAYPOINT_TEST_DIR = dir;
process.env.WAYPOINT_TEST = '1';
process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173/';
const key = 'waypoint.db.v1';
const data = {version:4, state:{tasks:[], events:[], categories:[], settings:{briefingAtLogin:scenario !== 'disabled',operatorName:'TEST',theme:'dark',hour24:true}}};
const invoke = (name, win, ...args) => Promise.resolve().then(() => handlers.get(`waypoint:${name}`)({sender:win.webContents,senderFrame:win.webContents.mainFrame}, ...args));
try {
  await writeFile(path.join(dir, 'waypoint-store.json'), JSON.stringify({[key]:JSON.stringify(data)}));
  await import('../dist-electron/main.js');
  await new Promise(r => setImmediate(r));
  let briefing = windows.find(w => w.options.title.includes('Daily Briefing'));
  let main = windows.find(w => w.options.title.includes('Personal Operations'));
  if (scenario === 'disabled') {
    assert(main && !briefing, 'disabled preference must suppress automatic briefing');
  } else {
    assert(briefing, `${scenario} launch should create the briefing`);
    assert.equal(briefing.visible, false, 'briefing stays hidden until ready-to-show');
    globalThis.__waypointDebug.createBriefingWindow();
    assert.equal(briefing.showCount, 0, 'duplicate request must not show before ready');
    assert.equal(windows.filter(w => w.options.title.includes('Daily Briefing')).length, 1);
    briefing.emit('ready-to-show');
    assert.equal(briefing.visible, true);
    assert((await invoke('briefing:snapshot', briefing)).includes('TEST'));
    await invoke('open-main', briefing);
    main = windows.find(w => w.options.title.includes('Personal Operations'));
    assert(main, 'briefing opens the main window');
    await assert.rejects(invoke('storage:read', main, key), /authentication required/);
    await assert.rejects(invoke('storage:read', briefing, key), /Authorization denied/);
  }
  assert(main);
  await invoke('auth:create', main, 'operator', 'strong access key');
  await invoke('briefing:open', main); // Settings uses this same IPC
  if (scenario === 'disabled') {
    briefing = windows.find(w => w.options.title.includes('Daily Briefing'));
    assert(briefing, 'manual Settings preview works with preference disabled');
    briefing.emit('ready-to-show');
  }
  assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1);
  assert(briefing.visible);
  if (scenario !== 'disabled') {
    app.emit('second-instance', {}, ['waypoint']);
    await new Promise(r => setImmediate(r));
    assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1);
  }
  briefing.destroy();
  await invoke('briefing:open', main);
  const replacement = windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing'));
  assert.equal(replacement.length, 1, 'briefing can reopen after close');
  replacement[0].emit('ready-to-show');
  assert(replacement[0].visible);
  app.emit('before-quit');
  console.log(`Briefing ${scenario} startup/Settings/security lifecycle passed (mock Electron)`);
} finally { await rm(dir, {recursive:true, force:true}); }
