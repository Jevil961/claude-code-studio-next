import { data, save, state } from "./state.js";
import { $ } from "./helpers.js";

const steps = [
  {
    key: "welcome",
    title: "欢迎使用 Claude Code Studio",
    label: "欢迎",
    body: `
      <p>这个应用把 Provider、项目目录、Skills 身份和 Teams 工作流组织在同一个工作台里。</p>
      <div class="wizard-panel"><b>建议顺序</b><span>先添加 Provider，再选择项目，随后创建身份并同步 Skills。Teams 是进阶能力，可以在基础配置完成后使用。</span></div>
    `,
  },
  {
    key: "provider",
    title: "第 1 步：添加 Provider",
    label: "Provider",
    body: `
      <p>Provider 是模型服务配置，例如 Anthropic、OpenAI、DeepSeek、Moonshot 或其他 OpenAI-compatible API。</p>
      <ul><li>填写 Base URL、API Key、默认模型。</li><li>添加后点击“测试”，确认连接可用。</li></ul>
    `,
    action: "providers",
    actionLabel: "打开 Provider 设置",
  },
  {
    key: "project",
    title: "第 2 步：选择项目目录",
    label: "项目",
    body: `
      <p>项目目录决定 Claude Code 在哪里执行任务、读取文件和写入修改。</p>
      <ul><li>点击左侧项目栏的加号添加目录。</li><li>选择项目后，再从底部输入框提交任务。</li></ul>
    `,
    action: "project",
    actionLabel: "添加项目目录",
  },
  {
    key: "identity",
    title: "第 3 步：创建身份与 Skills",
    label: "身份",
    body: `
      <p>身份是一组 Skills 能力集。你可以让应用按 Skills 自动生成身份，也可以手动定义规则。</p>
      <ul><li>先扫描或导入 Skills。</li><li>再用“身份与协作”生成或自定义身份。</li></ul>
    `,
    action: "identities",
    actionLabel: "打开身份设置",
  },
  {
    key: "finish",
    title: "完成：开始你的第一轮任务",
    label: "完成",
    body: `
      <p>基础配置完成后，回到首页输入任务即可开始。需要多人协作时，打开 Teams 工作流工作台。</p>
      <div class="wizard-panel"><b>推荐首个任务</b><span>“阅读这个项目，告诉我核心模块和最适合先优化的 3 个地方。”</span></div>
    `,
    action: "teams",
    actionLabel: "打开 Teams 工作台",
  },
];

let deps = {};
let current = 0;
let helpMode = false;

export function configure(d) {
  deps = d || {};
}

function configuredEnough() {
  return Boolean(data.providers.length && state.cwd);
}

function shouldShowFirstRun() {
  return !state.firstRunDone && !configuredEnough();
}

function stepMarkup() {
  return steps.map((step, index) => `<div class="wizard-step${index === current ? " is-active" : ""}">${index + 1}. ${step.label}</div>`).join("");
}

function openAction(action) {
  if (action === "project") {
    document.querySelector("#addFolderBtn")?.click();
    return;
  }
  if (action === "teams") {
    deps.openTeamsBuilder?.();
    return;
  }
  if (action) deps.openSettings?.(action);
}

function renderWizard() {
  const overlay = $("#wizardOverlay");
  if (!overlay) return;
  const step = steps[current];
  $("#wizardKicker").textContent = helpMode ? "使用帮助" : "首次设置";
  $("#wizardTitle").textContent = step.title;
  $("#wizardSteps").innerHTML = stepMarkup();
  $("#wizardBody").innerHTML = `
    ${step.body}
    ${step.action ? `<button class="st-btn t-btn--primary t-btn--sm" id="wizardAction" type="button">${step.actionLabel}</button>` : ""}
  `;
  $("#wizardPrev").disabled = current === 0;
  $("#wizardNext").textContent = current === steps.length - 1 ? "完成" : "下一步";
  $("#wizardSkip").textContent = helpMode ? "关闭" : "稍后再说";
  $("#wizardAction")?.addEventListener("click", () => openAction(step.action));
}

export function openFirstRunWizard() {
  helpMode = false;
  current = 0;
  const overlay = $("#wizardOverlay");
  overlay?.classList.add("is-open");
  overlay?.setAttribute('role', 'dialog');
  overlay?.setAttribute('aria-modal', 'true');
  overlay?.setAttribute('aria-label', '首次设置向导');
  renderWizard();
}

export function openHelp() {
  helpMode = true;
  current = 0;
  const overlay = $("#wizardOverlay");
  overlay?.classList.add("is-open");
  overlay?.setAttribute('role', 'dialog');
  overlay?.setAttribute('aria-modal', 'true');
  overlay?.setAttribute('aria-label', '使用帮助');
  renderWizard();
}

function closeWizard(markDone = false) {
  $("#wizardOverlay")?.classList.remove("is-open");
  if (markDone || !helpMode) {
    state.firstRunDone = true;
    save();
  }
}

export function initOnboarding() {
  $("#wizardClose")?.addEventListener("click", () => closeWizard(false));
  $("#wizardSkip")?.addEventListener("click", () => closeWizard(false));
  $("#wizardPrev")?.addEventListener("click", () => {
    current = Math.max(0, current - 1);
    renderWizard();
  });
  $("#wizardNext")?.addEventListener("click", () => {
    if (current >= steps.length - 1) {
      closeWizard(true);
      return;
    }
    current += 1;
    renderWizard();
  });
  setTimeout(() => {
    if (shouldShowFirstRun()) openFirstRunWizard();
  }, 350);
}
