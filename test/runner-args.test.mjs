import test from "node:test";
import assert from "node:assert/strict";
import { buildArgs, promptForMode } from "../src/runner/claudeArgs.js";

test("persistent auto runner keeps auto permissions", () => {
  const args = buildArgs({ prompt: "hi", permissionMode: "auto", persistent: true });
  assert.equal(args.includes("--input-format"), true);
  assert.equal(args.includes("auto"), true);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
});

test("bypass mode is explicit", () => {
  const args = buildArgs({ prompt: "hi", permissionMode: "bypass", persistent: false });
  assert.deepEqual(args.slice(0, 2), ["-p", "hi"]);
  assert.equal(args.includes("bypassPermissions"), true);
  assert.equal(args.includes("--dangerously-skip-permissions"), true);
});

test("plan mode prompt asks for a plan only", () => {
  const text = promptForMode("change files", "plan");
  assert.match(text, /只制定执行计划/);
  assert.match(text, /change files/);
});
