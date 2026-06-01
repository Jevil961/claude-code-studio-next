# Claude Code Studio Next

> A Windows-first Tauri desktop studio for Claude Code providers, identities, Skills, MCP services, project history, diagnostics, and memory-first runner control.

![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)
![Node](https://img.shields.io/badge/Node.js-18%2B-339933)
![Status](https://img.shields.io/badge/status-0.1.0%20local%20preview-orange)

## Overview

Claude Code Studio Next is a local desktop workbench for running and managing Claude Code with a lighter Tauri shell. It focuses on practical daily use: provider switching, identity-based Skills sync, MCP management, project and conversation navigation, diagnostics, usage visibility, and controlled Claude Code process lifecycles.

The app is designed for users who want the power of Claude Code without constantly seeing low-level process details or leaving unnecessary Claude/Node processes behind.

## Multilingual Summary

### English

Claude Code Studio Next is a Tauri desktop application for managing Claude Code providers, Skills, MCP services, project history, diagnostics, and memory-conscious runner behavior on Windows.

### 中文

Claude Code Studio Next 是一个面向 Windows 的 Tauri 桌面工作台，用于管理 Claude Code 的 Provider、身份、Skills、MCP 服务、项目历史、诊断信息和低内存运行策略。

### Français

Claude Code Studio Next est une application de bureau Tauri pour Windows permettant de gérer les fournisseurs Claude Code, les Skills, les services MCP, l'historique des projets, les diagnostics et l'exécution à faible consommation mémoire.

### Español

Claude Code Studio Next es una aplicación de escritorio basada en Tauri para Windows que permite gestionar proveedores de Claude Code, Skills, servicios MCP, historial de proyectos, diagnósticos y ejecución optimizada para memoria.

### Русский

Claude Code Studio Next - это настольное приложение на Tauri для Windows, предназначенное для управления провайдерами Claude Code, Skills, службами MCP, историей проектов, диагностикой и режимом запуска с экономией памяти.

### العربية

Claude Code Studio Next هو تطبيق سطح مكتب مبني على Tauri لنظام Windows لإدارة مزودي Claude Code والمهارات وخدمات MCP وسجل المشاريع والتشخيصات وتشغيل المهام مع تقليل استهلاك الذاكرة.

## Highlights

- Tauri desktop shell with a hidden Node backend.
- Provider management and model preset support.
- Identity-based Skills organization and sync.
- MCP service management.
- Claude Code project and conversation navigation.
- Memory-first runner mode: Claude tasks exit when complete by default.
- Process cleanup for Claude and backend child processes.
- Usage statistics with cache to avoid repeated JSONL scans.
- Diagnostics export with runtime, paths, processes, counts, and performance budgets.
- Automatic backups before destructive Claude settings or Skills writes.
- Release scripts for release exe, NSIS installer, portable package, and release checks.

## Runtime Requirements

- Windows 10/11.
- Node.js 18+ available in `PATH`.
- Claude Code installed globally or installable through npm.
- Rust is required only for development and release builds.

For details, see [Runtime Strategy](docs/RUNTIME.md).

## Quick Start

```powershell
npm install
npm run dev
```

## Verification

```powershell
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

## Build

Debug executable:

```powershell
npm run build:debug
```

Release executable:

```powershell
npm run build:exe
```

NSIS installer:

```powershell
npm run build
```

Portable package:

```powershell
npm run build:portable
```

Full local release gate:

```powershell
npm run release:check
```

## Release Outputs

- Debug exe: `src-tauri/target/debug/claude-code-studio-next.exe`
- Release exe: `src-tauri/target/release/claude-code-studio-next.exe`
- NSIS installer: `src-tauri/target/release/bundle/nsis/`
- Portable zip: `dist-tauri/Claude-Code-Studio-Next-portable.zip`

Generated binaries are not meant to be committed. Upload them to GitHub Releases instead.

## Repository Map

| Path | Purpose |
| --- | --- |
| `public/` | Frontend HTML, CSS, and browser-side JavaScript. |
| `src-tauri/` | Tauri Rust shell, native commands, config, icons, and capabilities. |
| `src/` | Hidden Node backend, data modules, diagnostics, setup, and runner logic. |
| `src/db/` | Providers, Skills, MCP, backup, session index, and SQL.js access. |
| `src/runner/` | Claude Code process arguments, streaming, lifecycle, and cleanup. |
| `scripts/` | Release check and portable packaging scripts. |
| `test/` | Node test suite. |
| `docs/` | Product, runtime, release, performance, and GitHub submission documentation. |
| `.github/` | Issue templates and pull request template. |

## Documentation

- [What to Upload to GitHub](docs/UPLOAD_TO_GITHUB.md)
- [Project Structure](docs/PROJECT_STRUCTURE.md)
- [Product Review](docs/PRODUCT_REVIEW.md)
- [Runtime Strategy](docs/RUNTIME.md)
- [Performance Budget](docs/PERFORMANCE_BUDGET.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [GitHub Submission Guide](docs/GITHUB_SUBMISSION.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Current Product Status

This project is ready to be submitted to GitHub as a `0.1.0` Windows local preview.

It is not yet positioned as a broad public consumer release because:

- Node.js is still a documented prerequisite.
- The app is not code-signed.
- Auto-update is not enabled.

## Framework Boundary

The repository is Tauri-first. Older desktop-shell entrypoints and packaging scripts were removed to keep the release path unambiguous.

## License

No open-source license has been declared yet. Until a license is added, all rights are reserved by the project owner.
