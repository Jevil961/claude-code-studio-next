import { spawn } from "node:child_process";

export function emitRenderer(channel, payload = {}) {
  if (typeof globalThis.__agentBridgeEmit === "function") {
    globalThis.__agentBridgeEmit(channel, payload);
  }
}

export async function openPathTarget(target) {
  if (!target) return "";
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return "";
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  return "";
}

export async function openExternalTarget(target) {
  if (!target) return "";
  return openPathTarget(target);
}
