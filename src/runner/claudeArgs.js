export function buildArgs({ prompt, mode, permissionMode, sessionId, extraArgs, persistent }) {
  const args = ["-p"];
  if (!persistent) args.push(prompt);
  if (persistent) args.push("--input-format", "stream-json");
  args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  if (sessionId) args.push("--resume", sessionId);
  else if (mode === "continue") args.push("--continue");
  if (permissionMode === "bypass") args.push("--permission-mode", "bypassPermissions", "--dangerously-skip-permissions");
  else if (permissionMode === "plan") args.push("--permission-mode", "plan");
  else args.push("--permission-mode", "auto");
  if (Array.isArray(extraArgs)) args.push(...extraArgs.filter(Boolean));
  return args;
}

export function promptForMode(prompt, pm) {
  if (pm === "plan") return `请只制定执行计划，不修改文件，不运行破坏性命令，计划末尾等待确认。\n\n${prompt}`;
  if (pm === "auto") return `请按 Auto 权限执行：低风险读取可继续，写入/删除/联网需确认。\n\n${prompt}`;
  return prompt;
}

export function streamInput(prompt, pm) {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: promptForMode(prompt, pm) }] } }) + "\n";
}
