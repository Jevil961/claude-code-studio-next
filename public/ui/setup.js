import { getBridge, safeBridge } from "./bridge.js";
import { $, toast } from "./helpers.js";
import { showModal } from "./modal.js";
import { state, save } from "./state.js";

export let claudeSetupState = { installed: true, version: "", dismissed: false };
let claudeVersions = [];
let nodeVersions = [];
let installRunning = false;
let installDone = false;

let deps = {};
export function configure(d) { deps = d; }

export function getClaudeSetupState() { return claudeSetupState; }
export function setClaudeSetupState(v) { claudeSetupState = v; }

function manualPathPlaceholder() {
  return claudeSetupState.platform === "win32"
    ? "C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd"
    : "/Users/you/.local/bin/claude";
}

function ensureManualPathButton() {
  const actions = $("#setupBannerActions");
  if (!actions) return null;
  let btn = $("#setupManualPath");
  if (btn) return btn;
  btn = document.createElement("button");
  btn.className = "st-btn t-btn--link t-btn--sm";
  btn.id = "setupManualPath";
  btn.type = "button";
  btn.textContent = "手动设置路径";
  const dismiss = $("#setupBannerDismiss");
  actions.insertBefore(btn, dismiss || null);
  btn.addEventListener("click", handleManualClaudePath);
  return btn;
}

async function promptManualClaudePath() {
  const bridge = getBridge();
  const picked = await bridge?.chooseFile?.();
  if (picked) return picked;
  const result = await showModal("手动设置 Claude 路径", [
    {
      key: "path",
      label: "Claude 可执行文件路径",
      value: state.claudePath || claudeSetupState.claudePath || "",
      placeholder: manualPathPlaceholder(),
      required: true,
    },
  ]);
  return result?.path?.trim() || "";
}

export async function handleManualClaudePath() {
  if (installRunning) return;
  const path = await promptManualClaudePath();
  if (!path) return;
  const r = await safeBridge("detectClaude", null, path);
  const d = r?.data || {};
  if (d.installed) {
    state.claudePath = d.claudePath || path;
    save();
    claudeSetupState = { ...claudeSetupState, ...d };
    $("#setupBanner")?.classList.add("is-hidden");
    toast(`Claude Code ${d.version ? "v" + d.version : ""} 已就绪`, "success");
    deps.boot?.();
    return;
  }
  claudeSetupState = { ...claudeSetupState, ...d };
  showSetupBanner({ ...d, dismissed: false });
  toast("这个路径不能运行 Claude Code，请选择 claude、claude.cmd 或 claude.exe。", "error");
}

export async function fetchAndShowVersions() {
  const r = await safeBridge("fetchClaudeVersions", null);
  const sel = $("#setupVersionSelect");
  if (!sel) return;
  if (!r?.ok || !r.data?.versions?.length) {
    sel.innerHTML = `<option value="">latest（最新）</option>`;
    if ($("#setupBannerMsg")) $("#setupBannerMsg").textContent = "请安装 Claude Code 后使用。";
    return;
  }
  claudeVersions = r.data.versions;
  const latest = r.data.latest || claudeVersions[0];
  sel.innerHTML = claudeVersions.map(v =>
    `<option value="${v}"${v === latest ? " selected" : ""}>${v}${v === latest ? "（最新）" : ""}</option>`
  ).join("");
  const msg = $("#setupBannerMsg");
  if (msg) msg.textContent = `共 ${claudeVersions.length} 个版本可选，选择版本后一键安装。`;
}

export async function fetchAndShowNodeVersions() {
  const sel = $("#setupNodeVersionSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="latest">正在获取版本...</option>`;
  const r = await safeBridge("fetchNodeVersions", null);
  if (!r?.ok || !r.data?.versions?.length) {
    sel.innerHTML = `<option value="latest">LTS（最新）</option>`;
    return;
  }
  nodeVersions = r.data.versions;
  const latestLts = r.data.latestLts || nodeVersions[0]?.version;
  const latest = r.data.latest || nodeVersions[0]?.version;
  sel.innerHTML = nodeVersions.map(v => {
    const label = v.lts ? `${v.version} (LTS)` : v.version;
    const selected = v.lts ? v.version === latestLts : v.version === latest;
    return `<option value="${v.version}"${selected ? " selected" : ""}>${label}</option>`;
  }).join("");
}

export function showSetupBanner(result) {
  const banner = $("#setupBanner");
  if (!banner || result.installed || result.dismissed) {
    banner?.classList.add("is-hidden");
    return;
  }
  ensureManualPathButton();
  claudeSetupState = { ...claudeSetupState, ...result };

  const title = $("#setupBannerTitle");
  const msg = $("#setupBannerMsg");
  const icon = $("#setupBannerIcon");
  const installBtn = $("#setupBannerInstall");
  const versionSelect = $("#setupVersionSelect");
  const nodeSelect = $("#setupNodeVersionSelect");

  if (!result.hasNpm) {
    const hasRuntime = Boolean(result.hasRuntimeNode || result.nodePath);
    const isWindows = result.platform === "win32";
    title.textContent = hasRuntime ? "需要系统 Node.js/npm" : "未检测到 Node.js/npm";
    msg.textContent = hasRuntime
      ? "应用内置 Node 可运行程序；安装 Claude Code 仍需要系统 npm。安装完成后点击重新检测。"
      : "安装 Claude Code 需要系统 Node.js 和 npm。安装完成后点击重新检测。";
    icon.textContent = "SETUP";
    installBtn.textContent = isWindows ? "安装 Node.js" : "打开 Node.js 下载";
    installBtn.className = "st-btn t-btn--primary t-btn--sm";
    versionSelect.style.display = "none";
    nodeSelect.style.display = isWindows ? "" : "none";
    banner.classList.remove("is-hidden");
    if (isWindows) fetchAndShowNodeVersions();
  } else {
    title.textContent = "未检测到 Claude Code";
    icon.textContent = "CC";
    installBtn.textContent = "一键安装";
    installBtn.className = "st-btn t-btn--primary t-btn--sm";
    versionSelect.style.display = "";
    nodeSelect.style.display = "none";
    banner.classList.remove("is-hidden");
    fetchAndShowVersions();
  }
  installDone = false;
}

export function handleClaudeDetectResult(result = {}) {
  if (!result || result.installed) return;
  showSetupBanner(result);
}

export function handleInstallProgress(payload = {}) {
  const banner = $("#setupBanner");
  if (!banner) return;

  const isNodePhase = payload.phase === "node";
  const icon = $("#setupBannerIcon");
  const title = $("#setupBannerTitle");
  const msg = $("#setupBannerMsg");
  const btn = $("#setupBannerInstall");

  if (payload.status === "installing") {
    icon.textContent = "...";
    msg.textContent = payload.progress || (isNodePhase ? "正在安装 Node.js..." : "正在安装...");
  } else if (payload.status === "done" && payload.ok) {
    installRunning = false;
    if (isNodePhase) {
      claudeSetupState.hasNpm = true;
      claudeSetupState.hasNode = true;
      icon.textContent = "CC";
      title.textContent = "未检测到 Claude Code";
      msg.textContent = "Node.js 已就绪，请选择版本安装 Claude Code。";
      btn.disabled = false;
      btn.textContent = "一键安装";
      btn.className = "st-btn t-btn--primary t-btn--sm";
      $("#setupNodeVersionSelect").style.display = "none";
      $("#setupVersionSelect").style.display = "";
      fetchAndShowVersions();
      toast("Node.js 安装成功", "success");
    } else {
      installDone = true;
      icon.textContent = "OK";
      title.textContent = "安装完成";
      msg.textContent = `Claude Code v${payload.version || ""} 已就绪，点击下方按钮完成检测。`;
      btn.disabled = false;
      btn.textContent = "完成检测";
      btn.className = "st-btn t-btn--success t-btn--sm";
      toast("Claude Code 安装成功", "success");
    }
  } else if (payload.status === "failed") {
    installRunning = false;
    installDone = false;
    icon.textContent = "ERR";
    title.textContent = isNodePhase ? "Node.js 安装失败" : "安装失败";
    msg.textContent = payload.error || payload.progress || "未知错误";
    btn.disabled = false;
    btn.textContent = isNodePhase ? "改用浏览器下载" : "重试安装";
    btn.className = "st-btn t-btn--primary t-btn--sm";
    if (isNodePhase) installDone = true;
    toast("安装失败: " + (payload.error || "未知错误"), "error");
  }
}

export function initSetup() {
  const bridge = getBridge();
  ensureManualPathButton();

  $("#setupBannerInstall")?.addEventListener("click", async () => {
    if (installRunning) return;

    if (installDone) {
      const r = await safeBridge("detectClaude", null);
      const d = r?.data || {};
      if (d.installed) {
        claudeSetupState = { ...claudeSetupState, ...d };
        $("#setupBanner").classList.add("is-hidden");
        toast(`Claude Code v${d.version || ""} 已就绪`, "success");
        deps.boot?.();
      } else {
        claudeSetupState = { ...claudeSetupState, ...d };
        showSetupBanner(d);
        if (d.hasNpm) {
          toast("Node.js/npm 已就绪，请继续安装 Claude Code。", "success");
        } else {
          toast("仍未检测到系统 npm，请确认 Node.js 已安装并重新打开应用。", "info");
        }
      }
      return;
    }

    const btn = $("#setupBannerInstall");

    if (!claudeSetupState.hasNpm) {
      if (claudeSetupState.platform !== "win32") {
        await safeBridge("openNodeDownload", null);
        toast("已打开 Node.js 下载页面。安装完成后点击重新检测。", "info");
        installRunning = false;
        installDone = true;
        btn.disabled = false;
        btn.textContent = "重新检测";
        btn.className = "st-btn t-btn--success t-btn--sm";
        $("#setupBannerIcon").textContent = "LINK";
        $("#setupBannerMsg").textContent = "请安装系统 Node.js/npm，然后点击重新检测。";
        return;
      }
      const nodeSel = $("#setupNodeVersionSelect");
      const nodeVersion = nodeSel?.value || "latest";
      installRunning = true;
      btn.disabled = true;
      btn.textContent = "安装中...";
      $("#setupBannerIcon").textContent = "...";
      $("#setupBannerMsg").textContent = `正在下载 Node.js ${nodeVersion === "latest" ? "LTS" : nodeVersion}...`;
      const r = await safeBridge("installNodeMsi", null, nodeVersion);
      if (!r?.ok) {
        await safeBridge("openNodeDownload", null);
        toast("已打开 Node.js 下载页面。安装完成后请刷新本应用。", "info");
        installRunning = false;
        btn.disabled = false;
        btn.textContent = "重新检测";
        btn.className = "st-btn t-btn--success t-btn--sm";
        installDone = true;
        $("#setupBannerIcon").textContent = "LINK";
        $("#setupBannerMsg").textContent = "安装 Node.js 后点击重新检测。";
      }
      return;
    }

    const sel = $("#setupVersionSelect");
    const version = sel?.value || "";
    installRunning = true;
    btn.disabled = true;
    btn.textContent = "安装中...";
    $("#setupBannerIcon").textContent = "...";
    $("#setupBannerMsg").textContent = `正在安装 Claude Code ${version || "latest"}...`;
    const r = await safeBridge("installClaude", null, version);
    if (!r.ok) {
      toast(r.error || "安装启动失败", "error");
      installRunning = false;
      btn.disabled = false;
      btn.textContent = "一键安装";
      $("#setupBannerIcon").textContent = "CC";
    }
  });

  $("#setupBannerDismiss")?.addEventListener("click", async () => {
    const r = await safeBridge("dismissSetup", null);
    if (r.ok) {
      claudeSetupState.dismissed = true;
      $("#setupBanner").classList.add("is-hidden");
      toast("已关闭安装提醒，可在通用设置中重新开启。", "info");
    }
  });

  if (bridge?.onClaudeDetectResult) bridge.onClaudeDetectResult(handleClaudeDetectResult);
  if (bridge?.onClaudeInstallProgress) bridge.onClaudeInstallProgress(handleInstallProgress);
}
