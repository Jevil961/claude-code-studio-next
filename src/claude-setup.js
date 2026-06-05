import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import https from "node:https";
import http from "node:http";
import { emitRenderer, openExternalTarget } from "./event-bus.js";

const CONFIG_DIR = join(homedir(), ".claude-code-studio");
const CONFIG_FILE = join(CONFIG_DIR, "claude-setup.json");
const PKG = "@anthropic-ai/claude-code";
const isWindows = process.platform === "win32";

// Track active installs so we can cancel them
const activeInstalls = new Map();

function readConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return { dismissed: false };
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { dismissed: false };
  }
}

function writeConfig(config) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch {}
}

function which(name) {
  for (const candidate of executableCandidates(name)) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  const names = isWindows ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const n of names) {
    try {
      const out = execFileSync(isWindows ? "where" : "which", [n], {
        windowsHide: true, timeout: 3000, encoding: "utf8", env: toolEnv(),
      });
      const hit = String(out || "").split(/\r?\n/).map(l => l.trim()).find(Boolean);
      if (hit) return hit;
    } catch {}
  }
  return "";
}

function executableCandidates(name) {
  if (!isWindows) {
    const localBins = [
      join(homedir(), ".local", "bin"),
      join(homedir(), ".npm-global", "bin"),
      join(homedir(), ".yarn", "bin"),
      join(homedir(), ".config", "yarn", "global", "node_modules", ".bin"),
      join(homedir(), ".bun", "bin"),
      ...versionedNodeBins(),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ];
    const ext = name === "node" || name === "npm" || name === "claude" ? name : "";
    return ext ? localBins.map(root => join(root, ext)) : [];
  }
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localBin = join(homedir(), ".local", "bin");
  const roamingNpm = join(appData, "npm");
  const nodeRoots = [
    join(programFiles, "nodejs"),
    join(programFilesX86, "nodejs"),
    join(localAppData, "Programs", "nodejs"),
    ...driveNodeRoots(),
  ];
  const candidates = [];
  if (name === "node") {
    for (const root of nodeRoots) candidates.push(join(root, "node.exe"));
  } else if (name === "npm") {
    candidates.push(join(roamingNpm, "npm.cmd"), join(roamingNpm, "npm.exe"));
    for (const root of nodeRoots) candidates.push(join(root, "npm.cmd"), join(root, "npm.exe"));
  } else if (name === "claude") {
    candidates.push(
      join(localBin, "claude.exe"),
      join(localBin, "claude.cmd"),
      join(roamingNpm, "claude.cmd"),
      join(roamingNpm, "claude.exe"),
    );
  }
  return candidates;
}

function versionedNodeBins() {
  const bins = [];
  const nvmRoot = process.env.NVM_DIR || join(homedir(), ".nvm");
  const nvmVersions = join(nvmRoot, "versions", "node");
  try {
    if (existsSync(nvmVersions)) {
      for (const version of readdirSync(nvmVersions)) {
        bins.push(join(nvmVersions, version, "bin"));
      }
    }
  } catch {}
  bins.push(
    join(homedir(), ".asdf", "shims"),
    join(homedir(), ".volta", "bin"),
    join(homedir(), "Library", "pnpm"),
  );
  return bins.filter(p => existsSync(p));
}

function driveNodeRoots() {
  if (!isWindows) return [];
  const roots = [];
  for (let code = 67; code <= 90; code++) {
    roots.push(`${String.fromCharCode(code)}:\\Nodejs`);
    roots.push(`${String.fromCharCode(code)}:\\nodejs`);
    roots.push(`${String.fromCharCode(code)}:\\Node`);
    roots.push(`${String.fromCharCode(code)}:\\node`);
  }
  return roots;
}

function toolPathDirs() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  if (!isWindows) {
    return [
      join(homedir(), ".local", "bin"),
      join(homedir(), ".npm-global", "bin"),
      join(homedir(), ".yarn", "bin"),
      join(homedir(), ".config", "yarn", "global", "node_modules", ".bin"),
      join(homedir(), ".bun", "bin"),
      ...versionedNodeBins(),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].filter(p => existsSync(p));
  }
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    join(appData, "npm"),
    join(localAppData, "Programs", "nodejs"),
    join(programFiles, "nodejs"),
    join(programFilesX86, "nodejs"),
    ...driveNodeRoots(),
    join(homedir(), ".local", "bin"),
  ].filter(p => existsSync(p));
}

function toolEnv() {
  const sep = isWindows ? ";" : ":";
  const extra = toolPathDirs();
  const path = [...extra, process.env.Path || process.env.PATH || ""].filter(Boolean).join(sep);
  return isWindows ? { ...process.env, Path: path, PATH: path } : { ...process.env, PATH: path };
}

function findNodeSync() { return which("node"); }
function findNpmSync() { return which("npm"); }

function findClaudeSync() {
  const candidates = executableCandidates("claude");
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  for (const n of ["claude.cmd", "claude.exe", "claude"]) {
    try {
      const out = execFileSync(isWindows ? "where" : "which", [n], {
        windowsHide: true, timeout: 3000, encoding: "utf8", env: toolEnv(),
      });
      const hit = String(out || "").split(/\r?\n/).map(l => l.trim()).find(Boolean);
      if (hit) return hit;
    } catch {}
  }
  return "";
}

function getClaudeVersion(claudePath) {
  try {
    const out = execFileSync(claudePath || "claude", ["--version"], {
      windowsHide: true, timeout: 5000, encoding: "utf8", env: toolEnv(),
    });
    const m = String(out).match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : "";
  } catch { return ""; }
}

function getNodeVersion(nodePath) {
  try {
    const out = execFileSync(nodePath || "node", ["--version"], {
      windowsHide: true, timeout: 3000, encoding: "utf8", env: toolEnv(),
    });
    return String(out || "").trim();
  } catch {
    return "";
  }
}

export function getConfig() { return readConfig(); }

export function dismissSetup() {
  const config = readConfig();
  config.dismissed = true;
  writeConfig(config);
  return { ok: true, ...config };
}

export function resetSetup() {
  const config = readConfig();
  config.dismissed = false;
  writeConfig(config);
  return { ok: true, ...config };
}

export function detectClaude(preferredPath = "") {
  const config = readConfig();
  const claudePath = preferredPath && existsSync(preferredPath) ? preferredPath : findClaudeSync();
  const systemNodePath = findNodeSync();
  const npmPath = findNpmSync();
  const installed = !!claudePath;
  const version = installed ? getClaudeVersion(claudePath) : "";
  const runtimeNodePath = process.execPath || "";
  const hasRuntimeNode = !!runtimeNodePath;
  const hasSystemNode = !!systemNodePath;
  const hasNode = hasSystemNode || hasRuntimeNode;
  const hasNpm = !!npmPath;
  return {
    installed, claudePath: claudePath || "", version,
    hasNode,
    hasRuntimeNode,
    runtimeNodePath,
    runtimeNodeVersion: process.version || "",
    hasSystemNode,
    systemNodePath: systemNodePath || "",
    systemNodeVersion: systemNodePath ? getNodeVersion(systemNodePath) : "",
    nodePath: systemNodePath || runtimeNodePath || "",
    nodeVersion: systemNodePath ? getNodeVersion(systemNodePath) : (process.version || ""),
    hasNpm, npmPath: npmPath || "",
    platform: process.platform,
    pathSearchDirs: toolPathDirs(),
    dismissed: config.dismissed,
    checkedAt: new Date().toISOString(),
  };
}

// ── Open Node.js download ──

const NODE_DOWNLOAD = "https://nodejs.org/zh-cn/download/";

export function openNodeDownload() {
  openExternalTarget(NODE_DOWNLOAD);
  return { ok: true, url: NODE_DOWNLOAD };
}

// ── Install Node.js via winget (Windows) ──

export function installNodeViaWinget() {
  if (!isWindows) return { ok: false, error: "仅 Windows 支持 winget 安装" };
  try {
    const child = spawn("winget", ["install", "OpenJS.NodeJS.LTS", "--silent", "--accept-package-agreements"], {
      windowsHide: true, env: { ...process.env },
    });
    const installId = `node-${Date.now()}`;
    const install = { id: installId, child, version: "Node.js LTS", status: "running", progress: "正在通过 winget 安装 Node.js..." };
    activeInstalls.set(installId, install);

    const send = (payload) => {
      emitRenderer("claude:installProgress", { installId, ...payload });
    };

    let errBuf = "";
    child.stderr.on("data", c => { errBuf += String(c); send({ status: "installing", progress: String(c).slice(0, 120), phase: "node" }); });
    child.on("close", code => {
      install.status = code === 0 ? "done" : "failed";
      activeInstalls.delete(installId);
      const nodePath = findNodeSync();
      send({
        status: code === 0 ? "done" : "failed",
        progress: code === 0 ? "Node.js 安装完成" : errBuf.slice(-200),
        ok: code === 0 && !!nodePath,
        phase: "node",
        nodeInstalled: !!nodePath,
        error: code !== 0 ? errBuf.slice(-300) : "",
      });
    });
    child.on("error", e => {
      install.status = "failed";
      activeInstalls.delete(installId);
      send({ status: "failed", progress: e.message, ok: false, phase: "node", error: e.message });
    });
    return installId;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Fetch Node.js versions from official API ──

export async function fetchNodeVersions() {
  return new Promise((resolve) => {
    https.get("https://nodejs.org/dist/index.json", (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try {
          const all = JSON.parse(data);
          if (!Array.isArray(all)) return resolve({ ok: false, error: "Invalid response" });
          const versions = all.slice(0, 30).map(v => ({
            version: v.version,
            lts: v.lts || false,
            date: v.date,
          }));
          const latest = versions[0]?.version || "";
          const latestLts = versions.find(v => v.lts)?.version || latest;
          resolve({ ok: true, versions, latest, latestLts });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    }).on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

// ── Install Node.js via official MSI ──

export function installNode(version) {
  if (!isWindows) return { ok: false, error: "仅 Windows 支持 MSI 安装" };

  const installId = `node-${Date.now()}`;
  const send = (payload) => {
    emitRenderer("claude:installProgress", { installId, ...payload });
  };

  // Resolve "latest" to actual version number
  const resolveAndInstall = async () => {
    let ver = (version || "latest").replace(/^v/, "");
    if (ver === "latest" || !ver) {
      send({ status: "installing", progress: "正在获取最新 LTS 版本...", phase: "node" });
      try {
        const info = await fetchNodeVersions();
        if (info.ok && info.latestLts) {
          ver = info.latestLts.replace(/^v/, "");
        } else {
          send({ status: "failed", progress: "获取版本失败", ok: false, phase: "node", error: info.error || "无法获取版本列表" });
          return;
        }
      } catch (e) {
        send({ status: "failed", progress: e.message, ok: false, phase: "node", error: e.message });
        return;
      }
    }

    if (!/^\d+\.\d+\.\d+$/.test(ver)) {
      send({ status: "failed", progress: "版本号格式无效", ok: false, phase: "node", error: `Invalid version: ${ver}` });
      return;
    }

    const arch = process.arch === "ia32" ? "x86" : "x64";
    const url = `https://nodejs.org/dist/v${ver}/node-v${ver}-${arch}.msi`;
    const msiPath = join(tmpdir(), `node-v${ver}-${arch}.msi`);
    const install = { id: installId, child: null, version: `v${ver}`, status: "running", progress: "正在下载..." };
    activeInstalls.set(installId, install);

    send({ status: "installing", progress: `正在下载 Node.js v${ver}...`, phase: "node", downloaded: 0, total: 0 });

    const doDownload = (downloadUrl, redirects = 0) => {
      if (redirects > 5) {
        activeInstalls.delete(installId);
        send({ status: "failed", progress: "重定向次数过多", ok: false, phase: "node", error: "Too many redirects" });
        return;
      }
      const isHttps = downloadUrl.startsWith("https");
      const mod = isHttps ? https : http;
      mod.get(downloadUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location;
          try {
            const redirectHost = new URL(redirectUrl).host;
            const originalHost = new URL(downloadUrl).host;
            if (redirectHost !== originalHost || !redirectUrl.startsWith("https")) {
              activeInstalls.delete(installId);
              send({ status: "failed", progress: "重定向目标不安全", ok: false, phase: "node", error: "Redirect to different host rejected" });
              return;
            }
          } catch {
            activeInstalls.delete(installId);
            send({ status: "failed", progress: "重定向 URL 格式无效", ok: false, phase: "node", error: "Invalid redirect URL" });
            return;
          }
          doDownload(redirectUrl, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          activeInstalls.delete(installId);
          send({ status: "failed", progress: `下载失败: HTTP ${res.statusCode}`, ok: false, phase: "node", error: `HTTP ${res.statusCode}` });
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        const file = createWriteStream(msiPath);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round(downloaded / total * 100);
            const mb = (downloaded / 1048576).toFixed(1);
            const totalMb = (total / 1048576).toFixed(1);
            send({ status: "installing", progress: `下载中 ${mb}/${totalMb} MB (${pct}%)`, phase: "node", downloaded, total });
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          send({ status: "installing", progress: "下载完成，正在安装...", phase: "node", downloaded: total, total });
          // Run MSI installer silently
          const child = spawn("msiexec", ["/i", msiPath, "/quiet", "/norestart"], {
            windowsHide: true, env: { ...process.env },
          });
          install.child = child;
          let errBuf = "";
          child.stderr.on("data", c => { errBuf += String(c); });
          child.on("close", (code) => {
            install.status = code === 0 ? "done" : "failed";
            activeInstalls.delete(installId);
            try { unlinkSync(msiPath); } catch {}
            const nodePath = findNodeSync();
            send({
              status: code === 0 ? "done" : "failed",
              progress: code === 0 ? "Node.js 安装完成" : errBuf.slice(-200) || `退出码 ${code}`,
              ok: code === 0 && !!nodePath,
              phase: "node",
              nodeInstalled: !!nodePath,
              error: code !== 0 ? errBuf.slice(-300) : "",
            });
          });
          child.on("error", (e) => {
            install.status = "failed";
            activeInstalls.delete(installId);
            try { unlinkSync(msiPath); } catch {}
            send({ status: "failed", progress: e.message, ok: false, phase: "node", error: e.message });
          });
        });
        file.on("error", (e) => {
          activeInstalls.delete(installId);
          send({ status: "failed", progress: e.message, ok: false, phase: "node", error: e.message });
        });
      }).on("error", (e) => {
        activeInstalls.delete(installId);
        send({ status: "failed", progress: e.message, ok: false, phase: "node", error: e.message });
      });
    };

    doDownload(url);
  };

  resolveAndInstall().catch(e => {
    send({ status: "failed", progress: e.message, ok: false, phase: "node", error: e.message });
    activeInstalls.delete(installId);
  });
  return installId;
}

// ── Fetch versions from npm ──

export async function fetchVersions() {
  return new Promise(resolve => {
    const npm = findNpmSync();
    if (!npm) return resolve({ ok: false, error: "npm not found" });
    const child = spawn(npm, ["view", PKG, "versions", "--json"], {
      windowsHide: true, timeout: 15000, env: toolEnv(),
    });
    let out = "", err = "";
    child.stdout.on("data", c => { out += String(c); });
    child.stderr.on("data", c => { err += String(c); });
    child.on("close", code => {
      if (code !== 0) return resolve({ ok: false, error: err.slice(0, 300) || "npm view failed" });
      try {
        const versions = JSON.parse(out);
        if (!Array.isArray(versions)) return resolve({ ok: false, error: "Unexpected npm output" });
        // Return latest 20 versions (npm returns oldest first)
        const list = versions.slice(-20).reverse();
        resolve({ ok: true, versions: list, latest: list[0] });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
    child.on("error", e => resolve({ ok: false, error: e.message }));
  });
}

// ── Install Claude Code ──

export function installClaude(version) {
  const npm = findNpmSync();
  if (!npm) return { ok: false, error: "npm not found" };
  const pkgSpec = version ? `${PKG}@${version}` : PKG;
  const args = ["install", "-g", pkgSpec];

  const child = spawn(npm, args, {
    windowsHide: true, env: toolEnv(),
  });

  const installId = `${Date.now()}`;
  const install = { id: installId, child, version: version || "latest", status: "running", progress: "正在安装..." };
  activeInstalls.set(installId, install);

  const send = (payload) => {
    emitRenderer("claude:installProgress", { installId, ...payload });
  };

  let outBuf = "", errBuf = "";
  child.stdout.on("data", c => {
    outBuf += String(c);
    const lines = String(c).split(/\r?\n/).filter(Boolean);
    const last = lines[lines.length - 1] || "";
    install.progress = last.slice(0, 120);
    send({ status: "installing", progress: install.progress, version });
  });
  child.stderr.on("data", c => {
    errBuf += String(c);
    send({ status: "installing", progress: String(c).slice(0, 120), version });
  });

  child.on("close", code => {
    install.status = code === 0 ? "done" : "failed";
    install.progress = code === 0 ? "安装完成" : (errBuf.slice(-200) || `退出码 ${code}`);
    activeInstalls.delete(installId);

    // Re-detect Claude after install
    const claudePath = findClaudeSync();
    const installed = !!claudePath;
    const detectedVersion = installed ? getClaudeVersion(claudePath) : "";

    send({
      status: code === 0 ? "done" : "failed",
      progress: install.progress,
      ok: code === 0 && installed,
      claudePath,
      version: detectedVersion || version,
      error: code !== 0 ? errBuf.slice(-300) : "",
    });
  });

  child.on("error", e => {
    install.status = "failed";
    install.progress = e.message;
    activeInstalls.delete(installId);
    send({ status: "failed", progress: e.message, ok: false, error: e.message });
  });

  return installId;
}

export function cancelInstall(installId) {
  const install = activeInstalls.get(installId);
  if (!install) return { ok: false, error: "No such install" };
  try { install.child.kill("SIGTERM"); } catch {}
  activeInstalls.delete(installId);
  return { ok: true };
}
