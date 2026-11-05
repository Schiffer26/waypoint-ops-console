#!/usr/bin/env node
/**
 * Desktop dev orchestration (cross-platform, zero extra deps):
 *  1. Compile the Electron main + preload bundle (dist-electron/).
 *  2. Start the Vite dev server for the renderer.
 *  3. Wait for the port, then launch Electron against the dev server.
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

/* 1 — build main process bundle */
const build = spawnSync(npmCmd, ["run", "build:electron"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

/* 2 — vite dev server (pinned port so Electron's wait target is exact) */
const vite = spawn(npmCmd, ["run", "dev", "--", "--port", "5173", "--strictPort"], {
  stdio: "inherit",
});

/* 3 — wait for the port, launch electron */
function waitFor(port, host, onReady, tries = 240) {
  if (tries <= 0) {
    console.error("[waypoint] timed out waiting for the dev server");
    vite.kill();
    process.exit(1);
  }
  const socket = new net.Socket();
  socket.once("connect", () => {
    socket.end();
    onReady();
  });
  socket.once("error", () => {
    socket.destroy();
    setTimeout(() => waitFor(port, host, onReady, tries - 1), 250);
  });
  socket.connect(port, host);
}

waitFor(5173, "127.0.0.1", () => {
  const electron = spawn(npxCmd, ["electron", "."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: "http://localhost:5173" },
  });
  electron.on("close", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
});

process.on("SIGINT", () => {
  vite.kill();
  process.exit(0);
});
