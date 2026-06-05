import { data, state } from "../state.js";
import { safeBridge } from "../bridge.js";
import { basename, toast } from "../helpers.js";
import { showConfirm, showModal } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadAgentTasks } from "../data-loader.js";
import { runStepAsync, isRunning as claudeIsRunning } from "../chat-engine.js";

let taskQueueRunning = false;

function taskStatusLabel(status) {
  return {
    draft: "草稿",
    ready: "已隔离",
    running: "运行中",
    done: "已完成",
    committed: "已提交",
    error: "异常",
  }[status] || status || "草稿";
}

function reviewStatusLabel(status) {
  return {
    pending: "待审",
    approved: "已通过",
    rejected: "已退回",
  }[status || "pending"] || status;
}

async function refresh(renderSettingsTab) {
  await loadAgentTasks();
  renderSettingsTab();
}

async function createTaskDlg(renderSettingsTab) {
  const result = await showModal("创建 Agent Task", [
    { key: "title", label: "标题", value: "New Agent Task", required: true },
    { key: "cwd", label: "项目路径", value: state.cwd || "", placeholder: "默认使用当前项目" },
    { key: "dependencies", label: "依赖任务（可选，填任务标题或 ID，每行一个）", value: "", type: "textarea" },
    { key: "prompt", label: "任务说明", value: "", type: "textarea", placeholder: "描述这个 agent 要独立完成什么、如何验收" },
  ]);
  if (!result?.title?.trim()) return;
  const r = await safeBridge("createAgentTask", null, {
    title: result.title,
    cwd: result.cwd || state.cwd || "",
    prompt: result.prompt || "",
    dependencies: parseDependencies(result.dependencies),
  });
  if (r.ok) { toast("Agent Task 已创建", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "创建失败", "error");
}

function parseBatchTasks(raw, cwd) {
  return String(raw || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [title, ...rest] = line.split(/\s+::\s+/);
      return { title: title.trim(), prompt: (rest.join(" :: ") || title).trim(), cwd };
    });
}

async function createBatchDlg(renderSettingsTab) {
  const result = await showModal("批量创建 Agent Tasks", [
    { key: "cwd", label: "项目路径", value: state.cwd || "", placeholder: "默认使用当前项目" },
    { key: "tasks", label: "任务列表", value: "UI polish :: 审计并优化关键页面的空状态、错误态和响应式\nTask runner :: 补齐任务执行、证据和提交链路\nRegression tests :: 为新增能力补测试", type: "textarea" },
  ]);
  const tasks = parseBatchTasks(result?.tasks, result?.cwd || state.cwd || "");
  if (!tasks.length) return;
  const r = await safeBridge("createAgentTaskBatch", null, { cwd: result.cwd || state.cwd || "", tasks });
  if (r.ok) { toast(`已创建 ${r.data?.length || tasks.length} 个任务`, "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "批量创建失败", "error");
}

async function editTaskDlg(task, renderSettingsTab) {
  const result = await showModal("编辑 Agent Task", [
    { key: "title", label: "标题", value: task.title || "", required: true },
    { key: "cwd", label: "项目路径", value: task.cwd || state.cwd || "" },
    { key: "dependencies", label: "依赖任务（标题或 ID，每行一个）", value: dependencyText(task), type: "textarea" },
    { key: "prompt", label: "任务说明", value: task.prompt || "", type: "textarea" },
    { key: "notes", label: "备注", value: task.notes || "", type: "textarea" },
  ]);
  if (!result?.title?.trim()) return;
  const r = await safeBridge("updateAgentTask", null, task.id, { ...result, dependencies: parseDependencies(result.dependencies, task.id) });
  if (r.ok) { toast("Agent Task 已更新", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "更新失败", "error");
}

async function prepareTask(task, renderSettingsTab) {
  const r = await safeBridge("prepareAgentTask", null, task.id);
  if (r.ok) {
    toast("已准备独立 worktree / branch", "success");
    await refresh(renderSettingsTab);
  } else {
    toast(r.error || "准备 worktree 失败", "error");
  }
}

async function ensurePreparedTask(task) {
  if (task.worktreePath) return task;
  const r = await safeBridge("prepareAgentTask", null, task.id);
  if (!r.ok) throw new Error(r.error || "准备 worktree 失败");
  return r.data;
}

function buildExecutionPrompt(task) {
  const cwd = task.worktreePath || task.cwd;
  const deps = dependencySummaries(task);
  return [
    `你正在执行 Claude Code Studio 的独立 Agent Task：「${task.title || "Untitled Task"}」。`,
    "",
    "执行要求：",
    `- 只在这个隔离工作区内修改代码：${cwd}`,
    `- 基准分支：${task.baseBranch || "当前 HEAD"}`,
    `- 任务分支：${task.branch || "自动创建"}`,
    "- 先理解现有实现，再做最小但完整的产品级修改。",
    "- 补齐必要的 UI 状态、错误处理、空状态、校验和测试。",
    "- 运行可用的检查或测试；如果无法运行，请说明原因。",
    "- 结束时用简短中文给出：修改文件、验证结果、剩余风险。",
    deps ? `- 已完成的上游任务：\n${deps}` : "",
    "",
    "任务说明：",
    task.prompt || task.notes || "请审计当前项目并完成一个可验证的改进。",
  ].filter(Boolean).join("\n");
}

function taskById(id) {
  return data.agentTasks.find(task => task.id === id);
}

function parseDependencies(raw, selfId = "") {
  const lookup = new Map();
  for (const task of data.agentTasks || []) {
    lookup.set(String(task.id || "").toLowerCase(), task.id);
    lookup.set(String(task.title || "").toLowerCase(), task.id);
  }
  return [...new Set(String(raw || "")
    .split(/[\n,]+/g)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => lookup.get(item.toLowerCase()) || item)
    .filter(id => id && id !== selfId))];
}

function dependencyText(task) {
  return (task.dependencies || []).map(id => taskById(id)?.title || id).join("\n");
}

function dependencySummaries(task) {
  return (task.dependencies || [])
    .map(id => taskById(id))
    .filter(Boolean)
    .map(dep => `  - ${dep.title}: ${dep.status}${dep.commitHash ? ` (${dep.commitHash})` : ""}`)
    .join("\n");
}

function blockers(task) {
  if (Array.isArray(task.blockedBy) && task.blockedBy.length) return task.blockedBy;
  return (task.dependencies || [])
    .map(id => taskById(id))
    .filter(dep => dep && !["done", "committed"].includes(dep.status))
    .map(dep => ({ id: dep.id, title: dep.title, status: dep.status }));
}

async function runTask(task, renderSettingsTab, options = {}) {
  if (claudeIsRunning()) {
    toast("已有 Agent 正在运行，请等它结束后再启动这个任务。", "info");
    return false;
  }
  const blocked = blockers(task);
  if (blocked.length) {
    toast(`任务被依赖阻塞：${blocked.map(item => item.title).join("、")}`, "info");
    return false;
  }
  let active = task;
  try {
    active = await ensurePreparedTask(task);
    const runId = crypto.randomUUID();
    await safeBridge("updateAgentTask", null, active.id, {
      status: "running",
      runId,
      error: "",
      output: "",
      lastRunAt: Date.now(),
      completedAt: 0,
    });
    await refresh(renderSettingsTab);

    const result = await runStepAsync(buildExecutionPrompt(active), {
      cwd: active.worktreePath || active.cwd,
      permissionMode: state.permissionMode || "auto",
    });
    await safeBridge("updateAgentTask", null, active.id, {
      status: result.ok ? "done" : "error",
      output: result.output || result.stderr || "",
      error: result.ok ? "" : (result.error || result.stderr || "任务运行失败"),
      completedAt: Date.now(),
    });
    await safeBridge("collectAgentTaskEvidence", null, active.id);
    if (!options.queue) toast(result.ok ? "Agent Task 已完成，证据已刷新" : "Agent Task 运行失败，已保留输出", result.ok ? "success" : "error");
    return !!result.ok;
  } catch (error) {
    await safeBridge("updateAgentTask", null, active.id || task.id, {
      status: "error",
      error: error?.message || String(error || "任务运行失败"),
      completedAt: Date.now(),
    });
    toast(error?.message || "任务运行失败", "error");
    return false;
  } finally {
    await refresh(renderSettingsTab);
  }
}

async function runReadyQueue(renderSettingsTab) {
  if (taskQueueRunning || claudeIsRunning()) {
    toast("当前已有任务在运行。", "info");
    return;
  }
  taskQueueRunning = true;
  let okCount = 0;
  let failCount = 0;
  const processed = new Set();
  try {
    while (true) {
      await loadAgentTasks();
      const next = [...(data.agentTasks || [])]
        .filter(task => task.queueReady && !processed.has(task.id))
        .sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0) || a.createdAt - b.createdAt)[0];
      if (!next) break;
      processed.add(next.id);
      const ok = await runTask(next, renderSettingsTab, { queue: true });
      if (ok) okCount += 1;
      else failCount += 1;
    }
    toast(`队列运行结束：成功 ${okCount}，失败 ${failCount}`, failCount ? "error" : "success");
  } finally {
    taskQueueRunning = false;
    await refresh(renderSettingsTab);
  }
}

async function refreshEvidence(task, renderSettingsTab) {
  const r = await safeBridge("collectAgentTaskEvidence", null, task.id);
  if (r.ok) {
    toast("任务证据已刷新", "success");
    await refresh(renderSettingsTab);
  } else {
    toast(r.error || "刷新证据失败", "error");
  }
}

async function copyTaskAudit(task) {
  const audit = await safeBridge("exportAgentTaskAudit", "", task.id, "md");
  if (!audit.ok) { toast(audit.error || "导出审计失败", "error"); return; }
  const r = await safeBridge("copyText", null, audit.data || "");
  toast(r.ok ? "任务审计 Markdown 已复制" : "复制失败", r.ok ? "success" : "error");
}

async function copyTaskPatch(task) {
  const patch = task.diffPatch || task.diffSummary || "";
  if (!patch.trim()) {
    toast("当前没有可复制的 diff", "info");
    return;
  }
  const r = await safeBridge("copyText", null, patch);
  toast(r.ok ? "Patch 已复制" : "复制失败", r.ok ? "success" : "error");
}

async function reviewTask(task, decision, renderSettingsTab) {
  const result = await showModal(decision === "approved" ? "通过审查" : "退回任务", [
    {
      key: "reviewNotes",
      label: "审查备注",
      value: decision === "approved" ? (task.reviewNotes || "Diff 已审查，可以进入提交流程。") : (task.reviewNotes || ""),
      type: "textarea",
      placeholder: decision === "approved" ? "记录通过依据、关注点或测试结论" : "说明需要修正的问题，便于重新运行任务",
    },
  ]);
  if (result === null) return;
  const r = await safeBridge("updateAgentTask", null, task.id, {
    reviewStatus: decision,
    reviewNotes: result.reviewNotes || "",
    reviewedAt: Date.now(),
  });
  if (r.ok) {
    toast(decision === "approved" ? "任务 Diff 已标记通过" : "任务已退回", decision === "approved" ? "success" : "info");
    await refresh(renderSettingsTab);
  } else {
    toast(r.error || "审查状态更新失败", "error");
  }
}

function diffLineType(line) {
  if (/^(diff --git|index |@@|\+\+\+ |--- )/.test(line)) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

function renderDiffLines(patch = "", maxLines = 600) {
  const lines = String(patch || "").split(/\r?\n/);
  const visible = lines.slice(0, maxLines);
  const body = visible.map((line, index) => {
    const type = diffLineType(line);
    return `
      <div class="diff-line diff-line-${type}">
        <span class="diff-ln">${index + 1}</span>
        <code>${escapeHtml(line || " ")}</code>
      </div>
    `;
  }).join("");
  const truncated = lines.length > maxLines ? `<div class="diff-truncated">已截断 ${lines.length - maxLines} 行。复制 Patch 可查看完整内容。</div>` : "";
  return body + truncated;
}

function taskDiffStats(task) {
  const patches = Array.isArray(task.filePatches) ? task.filePatches : [];
  let additions = 0;
  let deletions = 0;
  for (const file of patches) {
    for (const line of String(file.patch || "").split(/\r?\n/)) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
  }
  return { files: patches.length || (task.changedFiles?.length || 0), additions, deletions };
}

function reviewableTasks() {
  return (data.agentTasks || []).filter(task => task.diffPatch || (Array.isArray(task.filePatches) && task.filePatches.length));
}

function combinedReviewTask(tasks) {
  const filePatches = [];
  const chunks = [];
  for (const task of tasks) {
    const title = task.title || "Untitled Task";
    const patches = Array.isArray(task.filePatches) && task.filePatches.length
      ? task.filePatches
      : [{ path: `${title}.patch`, status: "M", patch: task.diffPatch || "" }];
    chunks.push(`\n# Agent Task: ${title}\n# Branch: ${task.branch || "--"}\n`);
    if (task.diffPatch) chunks.push(task.diffPatch);
    for (const patch of patches) {
      filePatches.push({
        ...patch,
        path: `${title} / ${patch.path || "patch"}`,
        patch: [
          `# Agent Task: ${title}`,
          `# Branch: ${task.branch || "--"}`,
          patch.patch || "",
        ].join("\n"),
      });
    }
  }
  return {
    title: `批量审查 ${tasks.length} 个 Agent Tasks`,
    branch: "multiple",
    filePatches,
    diffPatch: chunks.join("\n"),
    changedFiles: filePatches.map(file => file.path),
  };
}

function showBatchReview() {
  const tasks = reviewableTasks();
  if (!tasks.length) {
    toast("还没有可批量审查的任务 Diff。先运行任务或刷新证据。", "info");
    return;
  }
  showDiffReview(combinedReviewTask(tasks));
}

function ensureDiffReviewOverlay() {
  let overlay = document.querySelector("#taskDiffReviewOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "taskDiffReviewOverlay";
  overlay.className = "task-review-overlay";
  overlay.innerHTML = `
    <div class="task-review-dialog" role="dialog" aria-modal="true" aria-labelledby="taskReviewTitle">
      <div class="task-review-head">
        <div>
          <div class="task-review-title" id="taskReviewTitle"></div>
          <div class="task-review-meta" id="taskReviewMeta"></div>
        </div>
        <div class="task-review-actions">
          <button class="st-btn t-btn--link" id="taskReviewCopyAll" type="button">复制全部 Patch</button>
          <button class="st-btn t-btn--link" id="taskReviewClose" type="button">关闭</button>
        </div>
      </div>
      <div class="task-review-layout">
        <div class="task-review-files" id="taskReviewFiles"></div>
        <div class="task-review-diff" id="taskReviewDiff"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", event => { if (event.target === overlay) closeDiffReview(); });
  overlay.querySelector("#taskReviewClose").addEventListener("click", closeDiffReview);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && overlay.classList.contains("is-open")) closeDiffReview();
  });
  return overlay;
}

function closeDiffReview() {
  document.querySelector("#taskDiffReviewOverlay")?.classList.remove("is-open");
}

async function showDiffReview(task) {
  const patches = Array.isArray(task.filePatches) ? task.filePatches : [];
  if (!patches.length && !task.diffPatch) {
    toast("当前任务没有可审查的 diff。", "info");
    return;
  }
  const overlay = ensureDiffReviewOverlay();
  const stats = taskDiffStats(task);
  overlay.querySelector("#taskReviewTitle").textContent = task.title || "Agent Task Diff";
  overlay.querySelector("#taskReviewMeta").textContent = `${stats.files} 个文件 · +${stats.additions} / -${stats.deletions} · ${task.branch || "未准备分支"}`;
  overlay.querySelector("#taskReviewCopyAll").onclick = () => copyTaskPatch(task);

  const reviewPatches = patches.length ? patches : [{ path: "patch", status: "M", patch: task.diffPatch }];
  const filesEl = overlay.querySelector("#taskReviewFiles");
  const diffEl = overlay.querySelector("#taskReviewDiff");

  function selectFile(index) {
    const file = reviewPatches[index] || reviewPatches[0];
    filesEl.querySelectorAll(".task-review-file").forEach((el, i) => el.classList.toggle("is-active", i === index));
    diffEl.innerHTML = `
      <div class="task-review-file-head">
        <div>
          <b>${escapeHtml(file.path || "patch")}</b>
          <span>${escapeHtml(file.status || "M")}</span>
        </div>
        <button class="st-btn t-btn--link t-btn--sm" id="copyCurrentDiffBtn" type="button">复制此文件</button>
      </div>
      <div class="diff-viewer">${renderDiffLines(file.patch || "")}</div>
    `;
    diffEl.querySelector("#copyCurrentDiffBtn").addEventListener("click", async () => {
      const r = await safeBridge("copyText", null, file.patch || "");
      toast(r.ok ? "文件 Diff 已复制" : "复制失败", r.ok ? "success" : "error");
    });
  }

  filesEl.innerHTML = reviewPatches.map((file, index) => `
    <button class="task-review-file${index === 0 ? " is-active" : ""}" type="button" data-index="${index}">
      <span>${escapeHtml(file.status || "M")}</span>
      <b>${escapeHtml(file.path || "patch")}</b>
    </button>
  `).join("");
  filesEl.querySelectorAll(".task-review-file").forEach(btn => {
    btn.addEventListener("click", () => selectFile(Number(btn.dataset.index || 0)));
  });
  selectFile(0);
  overlay.classList.add("is-open");
}

async function commitTask(task, renderSettingsTab) {
  const files = Array.isArray(task.changedFiles) ? task.changedFiles : [];
  if (!files.length) {
    toast("没有待提交变更。先运行任务或刷新证据。", "info");
    return;
  }
  if (task.reviewStatus !== "approved") {
    const proceed = await showConfirm("尚未通过审查", `任务「${task.title}」当前审查状态是：${reviewStatusLabel(task.reviewStatus)}。\n\n仍然继续提交吗？建议先点击“通过审查”记录结论。`);
    if (!proceed) return;
  }
  const message = `Agent task: ${task.title || "Untitled Task"}`;
  const ok = await showConfirm("提交 Agent Task", `将提交隔离分支 ${task.branch || ""} 上的 ${files.length} 个变更。\n\n提交信息：${message}`);
  if (!ok) return;
  const r = await safeBridge("commitAgentTask", null, task.id, message);
  if (r.ok) {
    toast(`已提交 ${r.data?.commitHash || ""}`, "success");
    await refresh(renderSettingsTab);
  } else {
    toast(r.error || "提交失败", "error");
  }
}

async function discardTask(task, renderSettingsTab) {
  const files = Array.isArray(task.changedFiles) ? task.changedFiles : [];
  if (!files.length) {
    toast("没有可丢弃的变更。", "info");
    return;
  }
  const ok = await showConfirm("丢弃隔离区改动", `将丢弃任务「${task.title}」worktree 内的 ${files.length} 个未提交变更。这个操作不会影响主工作区。`);
  if (!ok) return;
  const r = await safeBridge("discardAgentTaskChanges", null, task.id);
  if (r.ok) { toast(`已丢弃 ${r.data?.discarded || files.length} 个变更`, "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "丢弃失败", "error");
}

async function deleteTask(task, renderSettingsTab) {
  if (!await showConfirm("删除 Agent Task", `确定删除「${task.title}」？这不会删除已创建的 worktree。`)) return;
  const r = await safeBridge("deleteAgentTask", null, task.id);
  if (r.ok) { toast("Agent Task 已删除", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "删除失败", "error");
}

function taskMeta(task) {
  const parts = [
    taskStatusLabel(task.status),
    task.branch ? `分支 ${task.branch}` : "",
    task.commitHash ? `commit ${task.commitHash}` : "",
    task.diffPatch || task.filePatches?.length ? `审查 ${reviewStatusLabel(task.reviewStatus)}` : "",
    task.worktreePath ? `worktree ${basename(task.worktreePath)}` : "",
    Array.isArray(task.changedFiles) && task.changedFiles.length ? `${task.changedFiles.length} 个变更` : "",
    Array.isArray(task.dependencies) && task.dependencies.length ? `${task.dependencies.length} 个依赖` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function taskIcon(task) {
  if (task.status === "running") return "RUN";
  if (task.status === "committed") return "CM";
  if (task.reviewStatus === "rejected") return "RJ";
  if (task.reviewStatus === "approved" && (task.diffPatch || task.filePatches?.length)) return "RV";
  if (task.status === "done") return "OK";
  if (task.status === "error") return "ERR";
  if (task.worktreePath) return "WT";
  return "TK";
}

export function renderTasksSettings({ settingsBody, renderSettingsTab }) {
  const counts = queueCounts(data.agentTasks || []);
  const toolbar = document.createElement("div");
  toolbar.className = "scard";
  toolbar.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">Agent Task Center</span>
      <div class="scard-actions">
        <button class="st-btn t-btn--link" id="refreshTasksBtn" type="button">刷新</button>
        <button class="st-btn t-btn--link" id="batchTaskBtn" type="button">批量创建</button>
        <button class="st-btn t-btn--link" id="batchReviewBtn" type="button" ${counts.reviewable ? "" : "disabled"}>批量审查</button>
        <button class="st-btn t-btn--primary t-btn--sm" id="runQueueBtn" type="button" ${counts.ready ? "" : "disabled"}>运行就绪队列</button>
        <button class="st-btn t-btn--primary t-btn--sm" id="createTaskBtn" type="button">新建任务</button>
      </div>
    </div>
    <div class="slist-sub" style="white-space:normal;">把复杂需求拆成独立任务，为每个任务准备 Git branch/worktree，并记录运行输出、diff 摘要和变更文件。</div>
    <div class="task-queue-metrics">
      <span>就绪 ${counts.ready}</span><span>待审 ${counts.pendingReview}</span><span>已通过 ${counts.approvedReview}</span><span>退回 ${counts.rejectedReview}</span><span>可审查 ${counts.reviewable}</span><span>阻塞 ${counts.blocked}</span><span>完成 ${counts.done}</span><span>已提交 ${counts.committed}</span><span>异常 ${counts.error}</span>
    </div>
  `;
  settingsBody.append(toolbar);
  toolbar.querySelector("#refreshTasksBtn").addEventListener("click", () => refresh(renderSettingsTab));
  toolbar.querySelector("#batchTaskBtn").addEventListener("click", () => createBatchDlg(renderSettingsTab));
  toolbar.querySelector("#batchReviewBtn").addEventListener("click", showBatchReview);
  toolbar.querySelector("#runQueueBtn").addEventListener("click", () => runReadyQueue(renderSettingsTab));
  toolbar.querySelector("#createTaskBtn").addEventListener("click", () => createTaskDlg(renderSettingsTab));

  if (!data.agentTasks.length) {
    const empty = document.createElement("div");
    empty.className = "scard";
    empty.innerHTML = `
      <div class="slist-name">还没有 Agent Task</div>
      <div class="slist-sub" style="white-space:normal;">从一个明确、可验收的工程任务开始，或一次性拆出 UI、功能、测试、发布检查等任务链。</div>
      <div class="scard-actions" style="margin-top:10px;">
        <button class="st-btn t-btn--primary t-btn--sm" id="emptyCreateTaskBtn" type="button">新建任务</button>
        <button class="st-btn t-btn--link" id="emptyBatchTaskBtn" type="button">批量创建</button>
      </div>
    `;
    settingsBody.append(empty);
    empty.querySelector("#emptyCreateTaskBtn").addEventListener("click", () => createTaskDlg(renderSettingsTab));
    empty.querySelector("#emptyBatchTaskBtn").addEventListener("click", () => createBatchDlg(renderSettingsTab));
    return;
  }

  for (const task of data.agentTasks) {
    const card = document.createElement("div");
    const files = Array.isArray(task.changedFiles) ? task.changedFiles : [];
    const statuses = Array.isArray(task.fileStatuses) ? task.fileStatuses : [];
    const filePatches = Array.isArray(task.filePatches) ? task.filePatches : [];
    const blocked = blockers(task);
    card.className = `slist-item agent-task-card${task.worktreePath ? " is-active" : ""}${task.status === "running" ? " is-running" : ""}`;
    card.innerHTML = `
      <div class="slist-icon">${taskIcon(task)}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(task.title || "Untitled Task")}</div>
        <div class="slist-sub">${escapeHtml(taskMeta(task))}</div>
        <div class="slist-sub" style="white-space:normal;">${escapeHtml(task.prompt || task.cwd || "")}</div>
        ${(task.dependencies || []).length ? `<div class="task-deps">${(task.dependencies || []).map(id => {
          const dep = taskById(id);
          return `<span>${escapeHtml(dep?.title || id)} · ${escapeHtml(dep?.status || "missing")}</span>`;
        }).join("")}</div>` : ""}
        ${blocked.length || task.missingDependencies?.length ? `<div class="task-blocked">等待：${escapeHtml([
          ...blocked.map(item => `${item.title}(${taskStatusLabel(item.status)})`),
          ...(task.missingDependencies || []).map(id => `缺失依赖 ${id}`),
        ].join("、"))}</div>` : ""}
        ${task.diffPatch || filePatches.length ? `<div class="task-review-state is-${escapeHtml(task.reviewStatus || "pending")}">
          <b>${escapeHtml(reviewStatusLabel(task.reviewStatus))}</b>
          ${task.reviewedAt ? `<span>${new Date(task.reviewedAt).toLocaleString()}</span>` : ""}
          ${task.reviewNotes ? `<em>${escapeHtml(task.reviewNotes)}</em>` : ""}
        </div>` : ""}
        ${task.error ? `<div class="task-error">${escapeHtml(task.error)}</div>` : ""}
        ${task.output ? `<details class="task-detail"><summary>最近输出</summary><pre>${escapeHtml(task.output.slice(0, 4000))}</pre></details>` : ""}
        ${task.diffPatch ? `<details class="task-detail task-diff-detail"><summary>Diff 预览</summary><pre>${escapeHtml(task.diffPatch.slice(0, 8000))}</pre></details>` : ""}
        ${filePatches.length ? `<details class="task-detail task-file-diffs"><summary>文件级 Diff (${filePatches.length})</summary>${filePatches.slice(0, 12).map(file => `
          <details class="task-file-diff"><summary>${escapeHtml(file.status || "M")} ${escapeHtml(file.path || "patch")}</summary><pre>${escapeHtml((file.patch || "").slice(0, 5000))}</pre></details>
        `).join("")}</details>` : ""}
        ${(task.diffSummary || files.length) ? `
          <div class="task-evidence">
            ${task.diffSummary ? `<pre>${escapeHtml(task.diffSummary)}</pre>` : ""}
            ${files.length ? `<div class="task-file-list">${files.slice(0, 8).map(file => {
              const row = statuses.find(item => item.path === file);
              return `<span>${row?.status ? `<b>${escapeHtml(row.status)}</b> ` : ""}${escapeHtml(file)}</span>`;
            }).join("")}${files.length > 8 ? `<span>+${files.length - 8}</span>` : ""}</div>` : ""}
          </div>
        ` : ""}
      </div>
      <div class="slist-actions">
        ${task.worktreePath ? `<button class="st-btn t-btn--link" data-act="open">打开</button>` : ""}
        <button class="st-btn t-btn--primary t-btn--sm" data-act="run" ${task.status === "running" ? "disabled" : ""}>运行</button>
        <button class="st-btn t-btn--link" data-act="prepare">准备</button>
        ${task.worktreePath ? `<button class="st-btn t-btn--link" data-act="evidence">证据</button>` : ""}
        ${task.diffPatch || filePatches.length ? `<button class="st-btn t-btn--link" data-act="review">审查 Diff</button>` : ""}
        ${task.diffPatch || filePatches.length ? `<button class="st-btn t-btn--link" data-act="approve">通过审查</button><button class="st-btn t-btn--link" data-act="reject">退回</button>` : ""}
        ${task.diffPatch ? `<button class="st-btn t-btn--link" data-act="patch">复制 Patch</button>` : ""}
        ${files.length ? `<button class="st-btn t-btn--link" data-act="commit">提交</button>` : ""}
        ${files.length ? `<button class="st-btn t-btn--danger t-btn--sm" data-act="discard">丢弃</button>` : ""}
        <button class="st-btn t-btn--link" data-act="audit">复制审计</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    card.querySelector('[data-act="open"]')?.addEventListener("click", () => safeBridge("openPath", null, task.worktreePath));
    card.querySelector('[data-act="run"]').addEventListener("click", () => runTask(task, renderSettingsTab));
    card.querySelector('[data-act="prepare"]').addEventListener("click", () => prepareTask(task, renderSettingsTab));
    card.querySelector('[data-act="evidence"]')?.addEventListener("click", () => refreshEvidence(task, renderSettingsTab));
    card.querySelector('[data-act="review"]')?.addEventListener("click", () => showDiffReview(task));
    card.querySelector('[data-act="approve"]')?.addEventListener("click", () => reviewTask(task, "approved", renderSettingsTab));
    card.querySelector('[data-act="reject"]')?.addEventListener("click", () => reviewTask(task, "rejected", renderSettingsTab));
    card.querySelector('[data-act="patch"]')?.addEventListener("click", () => copyTaskPatch(task));
    card.querySelector('[data-act="commit"]')?.addEventListener("click", () => commitTask(task, renderSettingsTab));
    card.querySelector('[data-act="discard"]')?.addEventListener("click", () => discardTask(task, renderSettingsTab));
    card.querySelector('[data-act="audit"]').addEventListener("click", () => copyTaskAudit(task));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => editTaskDlg(task, renderSettingsTab));
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteTask(task, renderSettingsTab));
    settingsBody.append(card);
  }
}

function queueCounts(tasks) {
  return {
    ready: tasks.filter(task => task.queueReady).length,
    reviewable: tasks.filter(task => task.diffPatch || (Array.isArray(task.filePatches) && task.filePatches.length)).length,
    pendingReview: tasks.filter(task => (task.diffPatch || task.filePatches?.length) && (!task.reviewStatus || task.reviewStatus === "pending")).length,
    approvedReview: tasks.filter(task => (task.diffPatch || task.filePatches?.length) && task.reviewStatus === "approved").length,
    rejectedReview: tasks.filter(task => (task.diffPatch || task.filePatches?.length) && task.reviewStatus === "rejected").length,
    blocked: tasks.filter(task => blockers(task).length || task.missingDependencies?.length).length,
    done: tasks.filter(task => task.status === "done").length,
    committed: tasks.filter(task => task.status === "committed").length,
    error: tasks.filter(task => task.status === "error").length,
  };
}
