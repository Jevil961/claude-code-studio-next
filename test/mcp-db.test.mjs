import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setDbForTest } from "../src/db/connection.js";
import { add, list } from "../src/db/mcp.js";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js/dist/sql-asm.js");

test("mcp add stores server_config and persists the database", async () => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-test-"));
  const dbPath = join(dir, "cc-switch.db");
  const settingsPath = join(dir, "settings.json");

  try {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT,
        server_config TEXT,
        description TEXT,
        tags TEXT,
        enabled_claude INTEGER
      )
    `);
    setDbForTest(db, dbPath, settingsPath);

    add("local server", JSON.stringify({ command: "node", args: ["server.js"] }));

    assert.equal(existsSync(dbPath), true);
    assert.equal(existsSync(settingsPath), true);
    assert.deepEqual(list()[0].config, { command: "node", args: ["server.js"] });

    const reopened = new SQL.Database(readFileSync(dbPath));
    const rows = reopened.exec("SELECT name, server_config FROM mcp_servers");
    assert.equal(rows[0].values[0][0], "local server");
    assert.equal(JSON.parse(rows[0].values[0][1]).command, "node");

    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(settings.mcpServers["local server"].command, "node");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
