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

  const stored = teams.listTeams()[0];
  assert.equal(stored.name, "Launch Team");
  assert.equal(stored.members.length, 2);
  assert.equal(stored.workflow.length, 2);
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

  const firstStepPrompt = teams.composeTeamStepPrompt({
    teamId: team.id,
    stepId: reviewStep.id,
    task: "Ship Teams workflows",
    previousOutputs: {
      [buildStep.id]: "This later step must not be included.",
    },
  });
  assert.doesNotMatch(firstStepPrompt.prompt, /later step/);
});

test("deleting a team member keeps workflow steps but clears assignment", async () => {
  const teams = await import("../src/teams.js");
  const team = teams.createTeam({ name: "Cleanup Team" });
  const member = teams.createTeamMember(team.id, { name: "Temporary" }).member;
  const step = teams.createTeamStep(team.id, { name: "Draft", memberId: member.id }).step;

  const result = teams.deleteTeamMember(team.id, member.id);

  assert.equal(result.team.workflow.find(item => item.id === step.id).memberId, "");
});
