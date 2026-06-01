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
| Windows ARM64 | Workflow target | Built on native `windows-11-arm` runner. |
| macOS Intel | Workflow target | Built on native macOS x64 runner. |
| macOS Apple Silicon | Workflow target | Built on native macOS ARM64 runner. |
| Linux x64 | Workflow target | Built on Ubuntu with WebKit/GTK dependencies. |
| Linux ARM64 | Workflow target | Built on native `ubuntu-22.04-arm` runner. |

Cross-platform packages are built in GitHub Actions because native desktop installers are most reliable when produced on the matching operating system.

## Node Runtime Strategy

Packaged desktop builds include a private Node runtime for the hidden backend. This prevents the app from closing immediately on machines where Node.js is not installed globally.

System Node.js/npm may still be needed for npm-based Claude Code installation and updates.

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

If the bundled backend runtime cannot start, the Tauri window still opens and backend calls return a visible `BACKEND_UNAVAILABLE` error instead of closing the app.

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
