import { withTimeout } from "./api.js";
import { data, state } from "./state.js";

export function getBridge() { return window.agentBridge; }

export function safeBridge(method, fb, ...args) {
  const bridge = getBridge();
  if (!bridge || typeof bridge[method] !== "function") return Promise.resolve({ ok: false, error: "Bridge missing", data: fb });
  return withTimeout(
    Promise.resolve().then(() => bridge[method](...args)).catch(error => ({ ok: false, error: String(error?.message || error || "Bridge call failed"), data: fb })),
    12000,
    { ok: false, error: `${method} timeout`, data: fb },
  );
}

export function curProvider() { return data.providers.find(p => p.current) || data.providers[0] || null; }
export function selProject() { return data.projects.find(p => p.id === state.selectedProject) || data.projects[0] || null; }

export function runtimeAction(name) {
  return (...args) => {
    const runtime = window.runtime || window.go?.runtime || {};
    if (typeof runtime[name] === "function") return runtime[name](...args);
    const bridge = getBridge();
    const tauriWindowMap = {
      WindowMinimise: "minimizeWindow",
      WindowToggleMaximise: "toggleMaximizeWindow",
      Quit: "closeWindow",
    };
    const bridgeMethod = tauriWindowMap[name];
    if (bridgeMethod && typeof bridge?.[bridgeMethod] === "function") return bridge[bridgeMethod](...args);
  };
}
