# Runtime Strategy

## Current Architecture

Claude Code Studio Next is a Tauri shell with a hidden Node backend:

- Tauri owns the window, native commands, packaging, and process cleanup.
- `src/backend-host.mjs` owns database access, Skills/MCP/provider operations, project indexing, diagnostics, and Claude runner orchestration.
- Claude Code is launched as a child process only while a task is running by default.

This keeps the UI lightweight while avoiding a risky full backend rewrite in the same release.

## Platform Strategy

The product targets Windows, macOS, and Linux through Tauri 2.x.

| Platform | Local status | Release path |
| --- | --- | --- |
| Windows x64 | Validated locally | Local build plus GitHub Actions release artifact. |
| Windows ARM64 | Source and workflow target | Build on Windows runner/toolchain support. |
| macOS Intel | Workflow target | Built on native macOS x64 runner. |
| macOS Apple Silicon | Workflow target | Built on native macOS ARM64 runner. |
| Linux x64 | Workflow target | Built on Ubuntu with WebKit/GTK dependencies. |
| Linux ARM64 | Source-ready target | Build on ARM64 Linux runner or local ARM64 host. |

Cross-platform packages are built in GitHub Actions because native desktop installers are most reliable when produced on the matching operating system.

## Node Requirement

Node.js 18+ must be available in `PATH`.

Recommended development install path on this Windows machine:

```text
E:\Nodejs\node.exe
```

The diagnostics report records:

- `nodePath`
- `nodeVersion`
- backend pid
- related `node`, `claude`, and WebView processes

## Missing Node Behavior

If Node is missing, the Tauri backend cannot start. For this release, Node is a hard prerequisite and should be installed before launching the app. The long-term options are:

1. Bundle a private Node runtime beside the app.
2. Port backend modules to Rust.
3. Keep Node as a documented prerequisite.

The current recommendation is option 3 for `0.1.0`, then option 1 before a wider public consumer release.

## Backups

Before destructive writes, the app creates backups under:

```text
~\.claude-code-studio\backups
```

Backed up data:

- `~\.claude\settings.json`
- `~\.claude\skills`

Only the latest 30 backup folders are kept.

## Rollback

To roll back a bad Skills/settings sync:

1. Close the app.
2. Open `~\.claude-code-studio\backups`.
3. Pick the latest folder before the bad change.
4. Restore `settings.json` to `~\.claude\settings.json` or `skills` to `~\.claude\skills`.
5. Reopen the app and run Diagnostics.
