import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { assertInsidePath, isInsidePath, safeReadTextFile, validatePluginInstallName } from "../src/path-security.js";

test("path guard accepts only paths inside the allowed root", () => {
  const root = mkdtempSync(join(tmpdir(), "ccs-root-"));
  const inside = join(root, "plugins", "demo");
  const outside = join(tmpdir(), "outside-demo");

  assert.equal(isInsidePath(root, inside), true);
  assert.equal(isInsidePath(root, outside), false);
  assert.equal(assertInsidePath(root, inside), inside);
  assert.throws(() => assertInsidePath(root, outside), /outside the allowed directory/);
});

test("plugin marketplace names reject paths and shell metacharacters", () => {
  assert.equal(validatePluginInstallName("tool@marketplace"), "tool@marketplace");
  assert.equal(validatePluginInstallName("@scope/plugin-name"), "@scope/plugin-name");
  assert.throws(() => validatePluginInstallName("../plugin"), /marketplace package name/);
  assert.throws(() => validatePluginInstallName("plugin;rm"), /unsupported characters/);
  assert.throws(() => validatePluginInstallName("C:/tmp/plugin"), /unsupported characters|marketplace package name/);
});

test("safe text preview rejects directories, large files, and binary content", () => {
  const root = mkdtempSync(join(tmpdir(), "ccs-read-"));
  const okFile = join(root, "note.txt");
  const bigFile = join(root, "big.txt");
  const binFile = join(root, "bin.txt");
  writeFileSync(okFile, "hello", "utf8");
  writeFileSync(bigFile, "x".repeat(32), "utf8");
  writeFileSync(binFile, "a\u0000b", "utf8");

  assert.equal(safeReadTextFile(okFile, { maxBytes: 16 }), "hello");
  assert.throws(() => safeReadTextFile(root), /not a file/);
  assert.throws(() => safeReadTextFile(bigFile, { maxBytes: 16 }), /too large/);
  assert.throws(() => safeReadTextFile(binFile, { maxBytes: 16 }), /Binary/);
});

test("tauri config keeps a non-null content security policy", () => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

  assert.equal(typeof config.app.security.csp, "string");
  assert.notEqual(config.app.security.csp.trim(), "");
  assert.match(config.app.security.csp, /default-src 'self'/);
});
