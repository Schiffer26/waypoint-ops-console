import { EventEmitter } from 'node:events';
export const handlers = new Map();
export const windows = [];
export const ipcMain = new EventEmitter();
ipcMain.handle = (name, fn) => handlers.set(name, fn);
export const app = new EventEmitter();
Object.assign(app, {
  requestSingleInstanceLock: () => true, whenReady: async () => {},
  getPath: () => process.env.WAYPOINT_TEST_DIR,
  setAsDefaultProtocolClient: () => {}, quit: () => {},
  getLoginItemSettings: () => ({openAtLogin: false}), setLoginItemSettings: () => {},
});
class Contents extends EventEmitter {
  mainFrame = {}; url = ''; sent = [];
  setWindowOpenHandler() {}
  getURL() { return this.url; }
  send(...args) { this.sent.push(args); }
  navigate(url) { this.emit('did-start-navigation', {}, url, false, true); this.url = url; }
}
export class BrowserWindow extends EventEmitter {
  webContents = new Contents(); destroyed = false; visible = false; showCount = 0; focusCount = 0;
  constructor(options) { super(); this.options = options; windows.push(this); }
  loadURL(url) { this.webContents.navigate(new URL(url).href); return Promise.resolve(); }
  loadFile() { throw new Error('test uses dev URL'); }
  isDestroyed() { return this.destroyed; } isMinimized() { return false; }
  show() { this.visible = true; this.showCount++; } focus() { this.focusCount++; } hide() { this.visible = false; } restore() {}
  close() { const e = { preventDefault() { e.prevented = true; } }; this.emit('close', e); if (!e.prevented) this.destroy(); }
  destroy() { this.destroyed = true; this.emit('closed'); }
  static getAllWindows() { return windows.filter(w => !w.destroyed); }
}
export class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
export const nativeImage = { createFromPath: () => ({}) };
export const Menu = { buildFromTemplate: (template) => template };
export class Notification { static isSupported() { return false; } show() {} }
