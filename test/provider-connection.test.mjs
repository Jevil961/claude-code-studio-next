import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setDbForTest } from "../src/db/connection.js";
import { create, testConnection } from "../src/db/providers.js";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js/dist/sql-asm.js");

async function withProviderDb(fn) {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-test-"));
  try {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        app_type TEXT NOT NULL DEFAULT 'claude',
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL DEFAULT '{}',
        category TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current INTEGER NOT NULL DEFAULT 0,
        provider_type TEXT NOT NULL DEFAULT ''
      )
    `);
    setDbForTest(db, join(dir, "cc-switch.db"), join(dir, "settings.json"));
    await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function createProvider(overrides = {}) {
  return create({
    name: "Test Provider",
    baseUrl: "https://api.example.test/v1",
    authToken: "key",
    model: "model-a",
    apiFormat: "openai",
    ...overrides,
  }).id;
}

test("provider test classifies missing configuration before network calls", async () => {
  await withProviderDb(async () => {
    const id = await createProvider({ authToken: "", model: "" });
    const result = await testConnection(id);

    assert.equal(result.ok, false);
    assert.equal(result.category, "missing_auth_token");
    assert.match(result.advice, /API Key/);
  });
});

test("provider test classifies auth and base-url HTTP failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withProviderDb(async () => {
      const id = await createProvider();

      globalThis.fetch = async () => ({ status: 401 });
      let result = await testConnection(id);
      assert.equal(result.ok, false);
      assert.equal(result.category, "auth_failed");

      globalThis.fetch = async () => ({ status: 404 });
      result = await testConnection(id);
      assert.equal(result.ok, false);
      assert.equal(result.category, "bad_base_url");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider test verifies remote models before the live model probe", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    await withProviderDb(async () => {
      const id = await createProvider();
      globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/models")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ data: [{ id: "model-a", owned_by: "test" }] }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "" } }] }),
        };
      };

      const result = await testConnection(id);

      assert.equal(result.ok, true);
      assert.equal(result.checks.modelsEndpoint, true);
      assert.equal(result.checks.modelListed, true);
      assert.equal(result.checks.liveRequest, true);
      assert.equal(result.modelCount, 1);
      assert.match(calls[0].url, /\/v1\/models$/);
      assert.match(calls[1].url, /\/v1\/chat\/completions$/);
      assert.equal(JSON.parse(calls[1].init.body).model, "model-a");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider test classifies network and timeout failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withProviderDb(async () => {
      const id = await createProvider();

      globalThis.fetch = async () => { throw new Error("fetch failed: getaddrinfo ENOTFOUND api.example.test"); };
      let result = await testConnection(id);
      assert.equal(result.ok, false);
      assert.equal(result.category, "network");

      globalThis.fetch = async () => {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        throw err;
      };
      result = await testConnection(id);
      assert.equal(result.ok, false);
      assert.equal(result.category, "timeout");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
