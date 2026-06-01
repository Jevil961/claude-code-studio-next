# Release Checklist

## P0 Release Gate

- [ ] `npm install` succeeds on a clean checkout.
- [ ] `npm run check` passes.
- [ ] `npm test` passes.
- [ ] `cargo check --manifest-path src-tauri\Cargo.toml` passes.
- [ ] `npm run build` creates an NSIS installer under `src-tauri\target\release\bundle\nsis`.
- [ ] `npm run build:portable` creates `dist-tauri\Claude-Code-Studio-Next-portable.zip`.
- [ ] Opening the exe does not show a cmd window.
- [ ] Closing the app removes the backend `node.exe`.
- [ ] Node.js 18+ is installed and visible in Diagnostics.
- [ ] Claude Code detection succeeds or the install guidance is shown.
- [ ] README points to Tauri scripts only.
- [ ] GitHub Actions `ci.yml` passes on Windows, macOS, and Linux.
- [ ] GitHub Actions `release.yml` publishes artifacts on a `v*` tag.

## Cross-Platform Packaging

- [ ] Windows x64 installer is uploaded to GitHub Releases.
- [ ] Windows portable zip is uploaded to GitHub Releases.
- [ ] macOS Intel DMG is produced by GitHub Actions.
- [ ] macOS Apple Silicon DMG is produced by GitHub Actions.
- [ ] Linux AppImage or Debian package is produced by GitHub Actions.
- [ ] ARM64 support notes are visible in README and runtime documentation.

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

## Known Release Decisions

- Node.js is a documented prerequisite for this release.
- Code signing is not enabled yet.
- Auto-update is not enabled yet.
- Release binaries are uploaded to GitHub Releases, not committed to Git.
