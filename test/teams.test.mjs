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
  });
  const reviewer = teams.createTeamMember(team.id, {
    name: "Reviewer",
    icon: "RV",
    role: "Find risks before implementation.",
    rules: "Return findings first.",
    providerId: "provider-a",
    identityId: "identity-reviewer",
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
  assert.equal(stored.workflow[1].requiresApproval, false);

  const updatedStep = teams.updateTeamStep(team.id, buildStep.id, { requiresApproval: "false" }).step;
  assert.equal(updatedStep.requiresApproval, false);

  const prompt = teams.composeTeamStepPrompt({
    teamId: team.id,
    stepId: buildStep.id,
    task: "Ship Teams workflows",
    previousOutputs: {
      [reviewStep.id]: "Risk: context switching can be confusing.",
    },
  });

  assert.equal(prompt.member.id, builder.id);
  assert.match(prompt.prompt, /You are working as the team member: Builder/);
  assert.match(prompt.prompt, /Keep handoffs concise/);
  assert.match(prompt.prompt, /Implement after review/);
  assert.match(prompt.prompt, /Ship Teams workflows/);
  assert.match(prompt.prompt, /Previous accepted outputs/);
  assert.match(prompt.prompt, /Risk: context switching can be confusing/);
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
