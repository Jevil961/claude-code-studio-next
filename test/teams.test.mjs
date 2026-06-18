import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "ccs-teams-"));
process.env.CCS_TEAMS_PATH = join(tempDir, "teams.json");

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("teams can be user-defined and persisted", async () => {
  const teams = await import("../src/teams.js");

  const team = teams.createTeam({
    name: "Launch Team",
    description: "Human reviewed multi-agent workflow",
    rules: "Keep handoffs concise.",
    runMode: "goal",
    goal: "Ship a real Teams workflow.",
    successCriteria: "Plan is accepted and final output is user-facing.",
    planningRules: "Assign ownership before implementation.",
  });
  const reviewer = teams.createTeamMember(team.id, {
    name: "Reviewer",
    icon: "RV",
    role: "Find risks before implementation.",
    rules: "Return findings first.",
    providerId: "provider-a",
    identityId: "identity-reviewer",
    agentRuntimeId: "codex",
    permissionMode: "plan",
  }).member;
  const builder = teams.createTeamMember(team.id, {
    name: "Builder",
    role: "Implement the accepted plan.",
  }).member;
  const reviewStep = teams.createTeamStep(team.id, {
    name: "Review",
    memberId: reviewer.id,
    instruction: "Review the task and list risks.",
  }).step;
  const buildStep = teams.createTeamStep(team.id, {
    name: "Build",
    memberId: builder.id,
    instruction: "Implement after review.",
    requiresApproval: false,
  }).step;
  teams.updateTeamWorkflow(team.id, {
    entryStepId: reviewStep.id,
    finalStepId: buildStep.id,
    workflowEdges: [{ from: reviewStep.id, to: buildStep.id }],
  });

  const stored = teams.listTeams()[0];
  assert.equal(stored.name, "Launch Team");
  assert.equal(stored.members.length, 2);
  assert.equal(stored.workflow.length, 2);
  assert.equal(stored.workflowEdges.length, 1);
  assert.equal(stored.entryStepId, reviewStep.id);
  assert.equal(stored.finalStepId, buildStep.id);
  assert.equal(stored.members[0].providerId, "provider-a");
  assert.equal(stored.members[0].identityId, "identity-reviewer");
  assert.equal(stored.members[0].agentRuntimeId, "codex");
  assert.equal(stored.workflow[1].requiresApproval, false);
  assert.equal(stored.runMode, "goal");
  assert.equal(stored.goal, "Ship a real Teams workflow.");
  assert.equal(stored.successCriteria, "Plan is accepted and final output is user-facing.");
  assert.equal(stored.planningRules, "Assign ownership before implementation.");

  const updatedTeam = teams.updateTeam(team.id, {
    runMode: "plan",
    goal: "Make Teams feel coordinated.",
    successCriteria: "Every step sees the shared plan.",
    planningRules: "Call out risks and handoff order.",
  });
  assert.equal(updatedTeam.runMode, "plan");
  assert.equal(updatedTeam.goal, "Make Teams feel coordinated.");
  assert.equal(updatedTeam.successCriteria, "Every step sees the shared plan.");

  const updatedMember = teams.updateTeamMember(team.id, reviewer.id, { agentRuntimeId: "opencode" }).member;
  assert.equal(updatedMember.agentRuntimeId, "opencode");

  const updatedStep = teams.updateTeamStep(team.id, buildStep.id, { requiresApproval: "false" }).step;
  assert.equal(updatedStep.requiresApproval, false);

  const prompt = teams.composeTeamStepPrompt({
    teamId: team.id,
    stepId: buildStep.id,
    task: "Ship Teams workflows",
    previousOutputs: {
      [reviewStep.id]: "Risk: context switching can be confusing.",
    },
    teamRunContext: {
      mode: "goal",
      goal: "Make Teams feel coordinated.",
      successCriteria: "Every step sees the shared plan.",
      plan: "Reviewer checks risks, Builder implements the accepted plan.",
    },
  });

  assert.equal(prompt.member.id, builder.id);
  assert.match(prompt.prompt, /You are working as the team member: Builder/);
  assert.match(prompt.prompt, /Keep handoffs concise/);
  assert.match(prompt.prompt, /Implement after review/);
  assert.match(prompt.prompt, /Ship Teams workflows/);
  assert.match(prompt.prompt, /Previous accepted outputs/);
  assert.match(prompt.prompt, /Risk: context switching can be confusing/);
  assert.match(prompt.prompt, /Team operating context/);
  assert.match(prompt.prompt, /Shared goal: Make Teams feel coordinated/);
  assert.match(prompt.prompt, /Success criteria: Every step sees the shared plan/);
  assert.match(prompt.prompt, /Team roster/);
  assert.match(prompt.prompt, /Accepted team plan/);
  assert.match(prompt.prompt, /This is the final mapped step/);
  assert.match(prompt.prompt, /Final delivery contract/);
  assert.equal(prompt.nextSteps.length, 0);

  const firstStepPrompt = teams.composeTeamStepPrompt({
    teamId: team.id,
    stepId: reviewStep.id,
    task: "Ship Teams workflows",
    previousOutputs: {
      [buildStep.id]: "This later step must not be included.",
    },
  });
  assert.doesNotMatch(firstStepPrompt.prompt, /later step/);
  assert.match(firstStepPrompt.prompt, /Available handoff routes: Build/);
  assert.match(firstStepPrompt.prompt, /Handoff contract/);
  assert.match(firstStepPrompt.prompt, /TEAM_HANDOFF_JSON/);
  assert.equal(firstStepPrompt.nextSteps[0].id, buildStep.id);
});

test("teams can compose and parse a real planning pass", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({
    name: "Goal Team",
    runMode: "goal",
    goal: "Improve Teams orchestration.",
    successCriteria: "Planner, builder, and reviewer agree on handoffs.",
    planningRules: "Surface blockers before execution.",
    members: [
      { id: "pm", name: "Planner", role: "Define goals and handoffs." },
      { id: "dev", name: "Builder", role: "Implement the accepted plan." },
    ],
    workflow: [
      { id: "plan", name: "Plan", memberId: "pm", nodeType: "intake" },
      { id: "build", name: "Build", memberId: "dev", nodeType: "work" },
    ],
    workflowEdges: [{ from: "plan", to: "build", condition: "default" }],
    entryStepId: "plan",
    finalStepId: "build",
  });

  const planning = teams.composeTeamPlanningPrompt({
    teamId: team.id,
    task: "Add plan and goal modes.",
    goal: "Make Teams feel like a coordinated group.",
    successCriteria: "Plan is explicit and flows into execution.",
  });

  assert.match(planning.prompt, /planning coordinator/);
  assert.match(planning.prompt, /Team roster/);
  assert.match(planning.prompt, /Workflow map/);
  assert.match(planning.prompt, /TEAM_PLAN_JSON/);
  assert.match(planning.prompt, /Make Teams feel like a coordinated group/);

  const parsed = teams.extractTeamPlan(`Summary first.

TEAM_PLAN_JSON
\`\`\`json
{"goal":"Coordinate the team","successCriteria":["Plan shared"],"steps":[{"owner":"Planner","work":"Scope"}],"risks":["Vague handoff"],"handoffOrder":["Planner","Builder"]}
\`\`\``);
  assert.equal(parsed.goal, "Coordinate the team");
  assert.deepEqual(parsed.successCriteria, ["Plan shared"]);
  assert.equal(parsed.steps[0].owner, "Planner");
  assert.deepEqual(parsed.handoffOrder, ["Planner", "Builder"]);
});

test("deleting a team member keeps workflow steps but clears assignment", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({ name: "Cleanup Team" });
  const member = teams.createTeamMember(team.id, { name: "Temporary" }).member;
  const step = teams.createTeamStep(team.id, { name: "Draft", memberId: member.id }).step;

  const result = teams.deleteTeamMember(team.id, member.id);

  assert.equal(result.team.workflow.find(item => item.id === step.id).memberId, "");
});

test("workflow steps default to automatic handoff unless approval is explicit", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({ name: "Approval defaults" });
  const step = teams.createTeamStep(team.id, { name: "Build" }).step;

  assert.equal(step.requiresApproval, false);

  const updated = teams.updateTeamStep(team.id, step.id, { requiresApproval: "true" }).step;
  assert.equal(updated.requiresApproval, true);
});

test("teams support conditional review loops and final approval prompts", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({ name: "PM Dev QA" });
  const pm = teams.createTeamMember(team.id, { name: "PM" }).member;
  const dev = teams.createTeamMember(team.id, { name: "Developer" }).member;
  const qa = teams.createTeamMember(team.id, { name: "QA" }).member;
  const intake = teams.createTeamStep(team.id, { name: "Clarify", nodeType: "intake", memberId: pm.id }).step;
  const build = teams.createTeamStep(team.id, { name: "Build", nodeType: "work", memberId: dev.id }).step;
  const review = teams.createTeamStep(team.id, {
    name: "Review",
    nodeType: "review",
    memberId: qa.id,
    decisionInstruction: "Use DECISION: revise or DECISION: pass.",
  }).step;
  const approval = teams.createTeamStep(team.id, {
    name: "Approval",
    nodeType: "approval",
    memberId: pm.id,
    decisionInstruction: "Use DECISION: yes or DECISION: no.",
  }).step;
  const output = teams.createTeamStep(team.id, { name: "Output", nodeType: "final", memberId: pm.id }).step;

  teams.updateTeamWorkflow(team.id, {
    entryStepId: intake.id,
    finalStepId: output.id,
    workflowEdges: [
      { from: intake.id, to: build.id, condition: "default" },
      { from: build.id, to: review.id, condition: "default" },
      { from: review.id, to: build.id, condition: "revise" },
      { from: review.id, to: approval.id, condition: "pass" },
      { from: approval.id, to: output.id, condition: "yes" },
      { from: approval.id, to: review.id, condition: "no" },
    ],
  });

  const reviewPrompt = teams.composeTeamStepPrompt({
    teamId: team.id,
    stepId: review.id,
    task: "Fix app startup",
    previousOutputs: { [build.id]: "Implemented fix." },
  });
  assert.match(reviewPrompt.prompt, /Available handoff routes: Build \(revise\), Approval \(pass\)/);
  assert.match(reviewPrompt.prompt, /DECISION: pass/);

  const approvalPrompt = teams.composeTeamStepPrompt({
    teamId: team.id,
    stepId: approval.id,
    task: "Fix app startup",
    previousOutputs: { [review.id]: "QA passed." },
  });
  assert.match(approvalPrompt.prompt, /DECISION: yes/);
  assert.match(approvalPrompt.prompt, /Output \(yes\)/);
  assert.match(approvalPrompt.prompt, /Review \(no\)/);

  const outputPrompt = teams.composeTeamStepPrompt({
    teamId: team.id,
    stepId: output.id,
    task: "Fix app startup",
    previousOutputs: { [approval.id]: "Approved. DECISION: yes" },
  });
  assert.match(outputPrompt.prompt, /final output node/);
  assert.doesNotMatch(outputPrompt.prompt, /include DECISION: approve/);
});

test("workflow failure recovery and retry planning preserves accepted handoffs", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({ name: "Recoverable PM Dev QA" });
  const pm = teams.createTeamMember(team.id, { name: "PM" }).member;
  const dev = teams.createTeamMember(team.id, { name: "Developer" }).member;
  const qa = teams.createTeamMember(team.id, { name: "QA" }).member;
  const intake = teams.createTeamStep(team.id, { name: "PM Brief", nodeType: "intake", memberId: pm.id }).step;
  const build = teams.createTeamStep(team.id, { name: "Dev Build", nodeType: "work", memberId: dev.id }).step;
  const review = teams.createTeamStep(team.id, { name: "QA Review", nodeType: "review", memberId: qa.id }).step;
  const approval = teams.createTeamStep(team.id, { name: "PM Approval", nodeType: "approval", memberId: pm.id }).step;
  const output = teams.createTeamStep(team.id, { name: "Output", nodeType: "final", memberId: pm.id }).step;
  const graph = teams.updateTeamWorkflow(team.id, {
    entryStepId: intake.id,
    finalStepId: output.id,
    workflowEdges: [
      { from: intake.id, to: build.id, condition: "default" },
      { from: build.id, to: review.id, condition: "default" },
      { from: review.id, to: build.id, condition: "revise" },
      { from: review.id, to: approval.id, condition: "pass" },
      { from: approval.id, to: output.id, condition: "yes" },
      { from: approval.id, to: review.id, condition: "no" },
    ],
  });

  assert.equal(teams.extractTeamDecision("QA found a regression.\nDECISION: revise"), "revise");
  const reviseRoute = teams.selectTeamRoute(graph, review.id, "Needs another pass.\nDECISION: revise");
  assert.equal(reviseRoute.needsChoice, false);
  assert.equal(reviseRoute.step.id, build.id);
  const passRoute = teams.selectTeamRoute(graph, review.id, "Looks good.\nDECISION: approve");
  assert.equal(passRoute.step.id, approval.id);
  const unclearRoute = teams.selectTeamRoute(graph, review.id, "I have concerns but no route.");
  assert.equal(unclearRoute.needsChoice, true);
  assert.deepEqual(unclearRoute.choices.map(choice => choice.condition), ["revise", "pass"]);

  const initialRun = {
    id: "run-1",
    teamId: graph.id,
    task: "Fix Teams startup",
    outputs: { [intake.id]: "PM scope accepted." },
    stepHistory: [{ stepId: intake.id, status: "done", output: "PM scope accepted." }],
    running: true,
    completed: false,
  };
  const failedRun = teams.recordTeamStepFailure(initialRun, graph, build.id, new Error("tool execution failed"), {
    prompt: "Build the fix.",
    output: "npm test failed before completion.",
    durationMs: 1234,
    auditEvents: [
      { type: "tool", title: "run_command", detail: "npm test", tool: "run_command", ok: false, durationMs: 45, paths: ["src/teams.js"] },
    ],
    changedFiles: ["src/teams.js", "src/teams.js"],
    errorCategory: "runtime_failed",
    stderr: "test command exited with code 1",
  });

  assert.equal(failedRun.running, false);
  assert.equal(failedRun.completed, false);
  assert.equal(failedRun.error, "tool execution failed");
  assert.equal(failedRun.currentStepId, build.id);
  assert.equal(failedRun.failedStepId, build.id);
  assert.equal(failedRun.outputs[intake.id], "PM scope accepted.");
  assert.equal(failedRun.stepHistory.at(-1).status, "error");
  assert.equal(failedRun.stepHistory.at(-1).stepName, "Dev Build");
  assert.match(failedRun.stepHistory.at(-1).outputPreview, /npm test failed/);
  assert.equal(failedRun.stepHistory.at(-1).auditEvents[0].tool, "run_command");
  assert.deepEqual(failedRun.stepHistory.at(-1).changedFiles, ["src/teams.js"]);
  assert.equal(failedRun.stepHistory.at(-1).errorCategory, "runtime_failed");
  assert.match(failedRun.stepHistory.at(-1).stderrPreview, /exited with code 1/);

  const retry = teams.planTeamRetry(failedRun, graph);
  assert.equal(retry.canRetry, true);
  assert.equal(retry.stepId, build.id);
  assert.equal(retry.step.name, "Dev Build");
  assert.equal(retry.task, "Fix Teams startup");
  assert.equal(retry.previousOutputs[intake.id], "PM scope accepted.");
  assert.equal(retry.run.error, "");
  assert.equal(retry.run.failedStepId, "");
  assert.equal(retry.run.stepHistory.some(item => item.stepId === build.id && item.status === "error"), false);
});

test("creating teams preserves an initial workflow graph", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({
    name: "Imported graph",
    members: [{ id: "pm", name: "PM" }],
    workflow: [
      { id: "start", name: "Start", nodeType: "start" },
      { id: "pm-step", name: "PM", memberId: "pm", nodeType: "intake" },
      { id: "out", name: "Output", memberId: "pm", nodeType: "final" },
    ],
    workflowEdges: [
      { from: "start", to: "pm-step", condition: "default" },
      { from: "pm-step", to: "out", condition: "yes", label: "approved" },
    ],
    entryStepId: "start",
    finalStepId: "out",
  });

  assert.equal(team.workflowEdges.length, 2);
  assert.equal(team.entryStepId, "start");
  assert.equal(team.finalStepId, "out");
  assert.equal(team.workflowEdges[1].label, "approved");
});

test("appended workflow steps keep the implicit final at the latest non-final node", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({ name: "Append flow" });
  const first = teams.createTeamStep(team.id, { name: "PM", nodeType: "intake" }).step;
  const second = teams.createTeamStep(team.id, { name: "Developer", nodeType: "work" }).step;
  const output = teams.createTeamStep(team.id, { name: "Output", nodeType: "final" }).step;
  const afterOutput = teams.createTeamStep(team.id, { name: "Archive", nodeType: "work" }).team;

  assert.equal(teams.listTeams().find(item => item.id === team.id).entryStepId, first.id);
  assert.equal(afterOutput.finalStepId, output.id);
  assert.notEqual(second.id, first.id);
});
