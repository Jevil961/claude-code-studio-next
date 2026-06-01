# Claude Code Studio Next

> A cross-platform Tauri desktop studio for Claude Code providers, Skills, MCP services, project history, diagnostics, and memory-conscious task execution.

![Claude Code Studio Next product preview](docs/assets/hero.svg)

[![CI](https://github.com/Jevil961/claude-code-studio-next/actions/workflows/ci.yml/badge.svg)](https://github.com/Jevil961/claude-code-studio-next/actions/workflows/ci.yml)
[![Release](https://github.com/Jevil961/claude-code-studio-next/actions/workflows/release.yml/badge.svg)](https://github.com/Jevil961/claude-code-studio-next/actions/workflows/release.yml)
![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555)
![Architectures](https://img.shields.io/badge/arch-x64%20%7C%20ARM64-7B61FF)

## Overview

Claude Code Studio Next is a local desktop workbench for people who use Claude Code heavily and want a cleaner operating surface than terminal-only workflows. It centralizes provider configuration, model presets, identity-based Skills, MCP services, project history, diagnostics, usage visibility, backups, and Claude Code runner control in one Tauri application.

The project is designed around two product goals:

- Keep the interface comfortable and focused while hiding low-level process noise.
- Keep system load predictable by cleaning up Claude Code and backend child processes after tasks complete.

## Platform Support

| Operating system | CPU architecture | Distribution status |
| --- | --- | --- |
| Windows 10/11 | x64, ARM64 | Local Windows x64 build is validated. GitHub Actions is configured for Windows release packaging. |
| macOS | Apple Silicon ARM64, Intel x64 | GitHub Actions release workflow builds macOS artifacts on native macOS runners. |
| Linux | x64, ARM64-ready source | Linux packaging is configured for AppImage and Debian packages; ARM64 can be built from source or runner infrastructure. |

The current local artifact in this repository is the Windows build. Cross-platform artifacts are intentionally produced by GitHub Actions so macOS and Linux packages are built on native systems instead of on the maintainer's Windows machine.

## Installation

![Installation flow](docs/assets/install-flow.svg)

Download the latest release from [GitHub Releases](https://github.com/Jevil961/claude-code-studio-next/releases).

| Platform | Recommended package | Notes |
| --- | --- | --- |
| Windows | `Claude Code Studio Next_*_x64-setup.exe` | Standard installer. The app opens without a visible command window. |
| Windows portable | `Claude-Code-Studio-Next-portable.zip` | Unzip and run `Claude Code Studio Next.exe`. Useful when you do not want an installer. |
| macOS | `.dmg` | Open the disk image, drag the app into Applications, then launch it. |
| Linux | `.AppImage` or `.deb` | Use AppImage for portable use or Debian package for system installation. |

Runtime prerequisite:

- Node.js 18 or newer must be available in `PATH`.
- Claude Code should be installed, or the app will show setup guidance.
- Rust is required only for development and release builds, not for normal end users.

## Features

- Provider and model preset management.
- Identity-based Skills organization and sync.
- MCP service management.
- Claude Code project and conversation navigation.
- Memory-first runner behavior: Claude Code exits when a task finishes by default.
- Cleanup for Claude Code, backend child processes, and stale runtime state.
- Usage statistics with cache to avoid repeated JSONL scans.
- Diagnostics export with runtime paths, versions, process counts, recent errors, and performance budget signals.
- Automatic backups before destructive Claude settings or Skills writes.
- Tauri-first desktop packaging with a hidden Node backend.

## Architecture

![Runtime architecture](docs/assets/architecture.svg)

Tauri owns the desktop window, native commands, packaging, and application lifecycle. A hidden Node backend owns database access, provider/Skills/MCP operations, session indexing, diagnostics, and Claude Code task orchestration. Claude Code itself is launched only while work is active, then the app attempts to close related processes cleanly.

This keeps the current product stable while leaving a clear future path toward either a bundled Node runtime or a deeper Rust backend.

## Developer Setup

```powershell
npm install
npm run dev
```

Useful checks:

```powershell
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

Windows release commands:

```powershell
npm run build:exe
npm run build
npm run build:portable
```

Full local release gate:

```powershell
npm run release:check
```

## Release Outputs

Generated binaries should not be committed to Git. Upload them to GitHub Releases.

| Artifact | Path |
| --- | --- |
| Windows release exe | `src-tauri/target/release/claude-code-studio-next.exe` |
| Windows NSIS installer | `src-tauri/target/release/bundle/nsis/` |
| Windows portable zip | `dist-tauri/Claude-Code-Studio-Next-portable.zip` |
| GitHub Actions artifacts | Uploaded automatically by `.github/workflows/release.yml` on `v*` tags |

## Documentation

- [English full article](docs/i18n/README.en.md)
- [中文完整介绍](docs/i18n/README.zh-CN.md)
- [Article complet en français](docs/i18n/README.fr.md)
- [Artículo completo en español](docs/i18n/README.es.md)
- [Полное описание на русском](docs/i18n/README.ru.md)
- [المقال الكامل بالعربية](docs/i18n/README.ar.md)
- [What to Upload to GitHub](docs/UPLOAD_TO_GITHUB.md)
- [Project Structure](docs/PROJECT_STRUCTURE.md)
- [Product Review](docs/PRODUCT_REVIEW.md)
- [Runtime Strategy](docs/RUNTIME.md)
- [Performance Budget](docs/PERFORMANCE_BUDGET.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [GitHub Submission Guide](docs/GITHUB_SUBMISSION.md)

## Repository Status

This repository is ready for GitHub publication as `0.1.0`.

Important current decisions:

- Node.js remains a documented prerequisite.
- Release binaries live in GitHub Releases, not in the repository tree.
- Code signing and automatic updates are not enabled yet.
- The desktop framework boundary is Tauri-first; older desktop-shell paths have been removed.

## License

No open-source license has been declared yet. Until a license is added, all rights are reserved by the project owner.
