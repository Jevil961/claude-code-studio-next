# Claude Code Studio Next

Claude Code Studio Next is a cross-platform Tauri desktop studio for Claude Code. It is built for users who manage multiple providers, identities, Skills, MCP services, projects, and long-running task histories, while still caring about memory usage and process cleanup.

## What It Solves

Claude Code is powerful, but daily use can become noisy when provider settings, Skills, MCP services, project histories, diagnostics, and task processes are spread across different places. This app turns those operational pieces into one focused desktop workspace.

The product also addresses a practical performance problem: Claude Code and Node child processes should not remain open after a task has finished. The runner is designed to launch Claude Code only when needed and clean up related processes afterward.

## Key Features

- Provider and model preset management.
- Identity-based Skills organization and sync.
- MCP service management.
- Project and conversation navigation.
- Memory-conscious Claude Code runner behavior.
- Usage statistics with cache.
- Diagnostics export for runtime paths, versions, processes, counts, and recent errors.
- Automatic backups before destructive settings or Skills writes.
- Tauri desktop packaging with a hidden Node backend.

## Platform Support

The project targets Windows, macOS, and Linux. Windows x64 is validated locally. GitHub Actions builds Windows x64, Windows ARM64, macOS Intel, macOS Apple Silicon, Linux x64, and Linux ARM64 packages on matching runner architectures.

## Installation

End users should download packages from GitHub Releases. Windows users can choose the installer or the portable zip. macOS users should use the DMG package. Linux users can choose AppImage or Debian packages when available.

Node.js 18 or newer must be available in `PATH`. Claude Code should be installed, or the app will show setup guidance.

## Development

```powershell
npm install
npm run dev
```

Validation:

```powershell
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

## Release

Generated binaries belong in GitHub Releases, not in Git commits. The release workflow builds native packages when a `v*` tag is pushed. Local Windows maintainers can also run `npm run build`, `npm run build:exe`, and `npm run build:portable`.

## Current Status

Version `0.1.0` is ready for GitHub publication. Node.js remains a documented runtime prerequisite. Code signing and automatic updates are not enabled yet.
