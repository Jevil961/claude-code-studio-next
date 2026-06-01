# GitHub Submission Guide

## Release Positioning

Claude Code Studio Next `0.1.0` is a Tauri-first desktop studio for users who want a cleaner control surface around Claude Code across Windows, macOS, and Linux.

Present it as:

- A cross-platform Tauri desktop studio.
- A Claude Code provider, Skills, MCP, project, diagnostics, and runner manager.
- A memory-conscious local tool, not a cloud service.
- A repository with clean source code and release binaries published through GitHub Releases.

## Suggested GitHub Description

```text
Cross-platform Tauri desktop studio for Claude Code providers, Skills, MCP services, project history, diagnostics, and memory-conscious runner control.
```

## Suggested Topics

```text
tauri
claude-code
desktop-app
windows
macos
linux
arm64
mcp
skills
developer-tools
local-first
```

## Suggested Release Notes

```markdown
# Claude Code Studio Next 0.1.0

Initial Tauri desktop release.

## Highlights

- Tauri shell with hidden Node backend.
- Provider and model preset management.
- Identity-based Skills sync.
- MCP service management.
- Claude Code project and conversation navigation.
- Memory-first runner behavior and process cleanup.
- Usage cache and diagnostics export.
- Automatic backups before destructive settings or Skills writes.
- Windows installer and portable package.
- GitHub Actions workflow for Windows, macOS, and Linux release artifacts.
- Full GitHub README plus UN official language documentation set.

## Requirements

- Windows, macOS, or Linux.
- Node.js 18+ in PATH.
- Claude Code installed or installable.

## Notes

- This release is not code-signed.
- Node.js is still a prerequisite.
- Auto-update is not enabled yet.
```
