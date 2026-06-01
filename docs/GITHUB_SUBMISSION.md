# GitHub Submission Guide

## Repository Summary

Claude Code Studio Next is a Windows-first Tauri desktop app for managing Claude Code providers, identities, Skills, MCP services, project history, diagnostics, and memory-first runner control.

## Suggested Repository Metadata

- Description: `Tauri desktop studio for Claude Code providers, Skills, MCP, project history, diagnostics, and memory-first runner control.`
- Topics:
  - `tauri`
  - `claude-code`
  - `desktop-app`
  - `mcp`
  - `skills`
  - `windows`
  - `nodejs`
  - `rust`
- Homepage: leave empty until a release page exists.

## Suggested Labels

| Label | Purpose |
| --- | --- |
| `type:bug` | Something broken or unreliable. |
| `type:feature` | New user-facing capability. |
| `type:perf` | Startup, memory, indexing, process, or rendering optimization. |
| `type:docs` | Documentation-only change. |
| `area:tauri` | Rust shell, packaging, native commands. |
| `area:backend` | Node backend host and data modules. |
| `area:ui` | Frontend app and styling. |
| `area:runner` | Claude process lifecycle. |
| `area:release` | Installer, portable package, release scripts. |
| `priority:p0` | Blocks release or can lose user data. |
| `priority:p1` | Important before wider distribution. |
| `priority:p2` | Useful but not blocking. |

## First GitHub Release Notes

```markdown
## Claude Code Studio Next v0.1.0

Windows local preview.

### Highlights
- Tauri desktop shell with hidden Node backend.
- Provider, identity, Skills, MCP, project history, usage, and diagnostics views.
- Memory-first Claude runner mode closes Claude processes after each task.
- Skills sync skips unchanged directories.
- Usage and project indexing optimizations.
- Claude settings and Skills backups.
- Diagnostics export for runtime/process troubleshooting.

### Requirements
- Windows 10/11.
- Node.js 18+ available in PATH.
- Claude Code installed or installable via npm.

### Artifacts
- NSIS installer: `Claude Code Studio Next_0.1.0_x64-setup.exe`
- Portable zip: `Claude-Code-Studio-Next-portable.zip`

### Known Limitations
- Node.js is a prerequisite and is not yet bundled.
- App is not code-signed.
- Auto-update is not enabled.
```

## Before Push

Follow [What To Upload To GitHub](UPLOAD_TO_GITHUB.md).

Run:

```powershell
npm run release:check
```

Check:

```powershell
git status --short
```

Do not commit generated artifacts:

- `dist-tauri/`
- `src-tauri/target/`
- `node_modules/`
- `*.zip`
- `*.exe`
- `*.log`
- `*.db`
