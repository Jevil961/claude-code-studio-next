# Project Structure

This repository is organized around a Tauri desktop shell with a hidden Node backend.

## Top Level

| Path | Purpose |
| --- | --- |
| `public/` | HTML, CSS, and browser-side app logic. This is the Tauri frontend dist. |
| `src-tauri/` | Rust Tauri shell, native commands, app config, icons, and capabilities. |
| `src/` | Hidden Node backend, data modules, runner, diagnostics, and setup helpers. |
| `src/db/` | Provider, Skills, MCP, session index, backup, and SQL.js database access. |
| `src/runner/` | Claude Code process argument construction, spawning, streaming, cleanup, and runner state. |
| `scripts/` | Release and packaging automation. |
| `test/` | Node test suite. |
| `docs/` | Product, runtime, performance, release, and architecture documentation. |

## Runtime Flow

1. Tauri starts `src-tauri/src/main.rs`.
2. The Rust shell launches hidden `node src/backend-host.mjs`.
3. The frontend calls Tauri command `backend_call`.
4. The Rust shell forwards JSON requests to the backend over stdin/stdout.
5. Backend modules read local configuration, sync Skills/MCP, index projects, and launch Claude Code.
6. Backend emits streaming events back to Tauri, then to the frontend.

## Key Files

| File | Purpose |
| --- | --- |
| `public/app.js` | Main UI controller and user-facing behavior. |
| `public/tauri-bridge.js` | Browser-to-Tauri bridge. |
| `src/backend-host.mjs` | Backend RPC host for Tauri. |
| `src/runner/ClaudeRunner.js` | Claude process lifecycle and stream parsing. |
| `src/db/skills.js` | Skills list, sync, hash skip, import, and cleanup. |
| `src/db/backup.js` | Backup utilities for destructive writes. |
| `src/db/sessionIndex.js` | Project and session index cache. |
| `src/db.js` | Aggregate module for usage, plugins, diagnostics, and project/session helpers. |
| `src-tauri/src/main.rs` | Tauri shell, backend process spawn, native commands. |
| `src-tauri/tauri.conf.json` | Tauri build and bundle configuration. |

## Generated Or Local-Only Paths

These should not be committed:

- `node_modules/`
- `src-tauri/target/`
- `dist/`
- `dist-next/`
- `dist-ai-classify/`
- `dist-tauri/`
- `edge-profile/`
- `.claude/`
- `*.log`
- `*.db`
- `*.zip`
