# Release Checklist

## P0 Release Gate

- [ ] `npm install` succeeds on a clean checkout.
- [ ] `npm run release:check` passes.
- [ ] `npm run build` creates an NSIS installer under `src-tauri\target\release\bundle\nsis`.
- [ ] `npm run build:portable` creates `dist-tauri\Claude-Code-Studio-Next-portable.zip`.
- [ ] Opening the exe does not show a cmd window.
- [ ] Closing the app removes the backend `node.exe`.
- [ ] Node.js 18+ is installed and visible in Diagnostics.
- [ ] Claude Code detection succeeds or the install guidance is shown.
- [ ] README points to Tauri scripts only.

## P1 QA Scenarios

- [ ] United States proxy/node path: provider model fetch works.
- [ ] China network path: provider model fetch fails gracefully or uses local presets quickly.
- [ ] No Claude Code installed: app opens and shows setup guidance.
- [ ] Claude Code installed: Diagnostics reports path and version.
- [ ] Two conversations with different identities: no lingering Claude processes after completion.
- [ ] Five consecutive strict-mode tasks: Claude process count returns to zero after each task.
- [ ] Large Skills library: sync skips unchanged Skills and does not freeze the UI.
- [ ] Large project history: app first paints from cache and indexes in the background.
- [ ] Usage tab: first read may scan, second read returns from cache.
- [ ] Copy Diagnostics report includes runtime, paths, counts, processes, and recent errors.
- [ ] Bad Skills sync can be rolled back from `~\.claude-code-studio\backups`.
- [ ] Provider/model API slow or unreachable: UI remains interactive and shows a clear error.

## Known Release Decision

For this release, Node.js is a documented prerequisite. A private bundled Node runtime is deferred until public distribution.
