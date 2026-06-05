# GitHub Submission Guide

This document is for maintainers. It keeps public-facing messaging separate from packaging and repository operations.

## Public Positioning

Claude Code Studio Next is a local-first desktop control center for Claude Code.

Lead with user value:

- One place to manage providers, models, Skills, MCP services, projects, conversations, diagnostics, and usage visibility.
- Identity-based Skills workflows for people who switch between roles or task modes.
- Local-first data ownership with backups before risky settings changes.
- Cleaner desktop behavior through controlled Claude Code task lifecycles.
- Cross-platform packaging for Windows, macOS, and Linux across x64 and ARM64.
- MIT-licensed source for community review and contribution.
- macOS downloads must be signed and notarized before they are presented as normal user installers.

Avoid leading with maintainer details:

- Internal artifact paths.
- Git upload rules.
- CI workflow mechanics.
- "We made the README professional" style statements.
- Nonessential implementation disclaimers in release highlights.

## Suggested GitHub Description

```text
Local-first desktop control center for Claude Code providers, Skills, MCP services, project memory, diagnostics, and clean task execution.
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
ai-workflow
mit-license
```

## Suggested Release Notes

```markdown
# Claude Code Studio Next 1.0.0

Claude Code Studio Next is a local-first desktop control center for Claude Code. This first release focuses on making advanced Claude Code workflows easier to organize, inspect, and run cleanly.

## Highlights

- Unified workspace for providers, model presets, Skills, MCP services, projects, conversations, diagnostics, and usage visibility.
- Identity-based Skills workflows for switching between roles, projects, or working styles.
- MCP service management from a desktop interface.
- Project and conversation navigation for Claude Code history.
- Controlled Claude Code task lifecycle to reduce leftover background processes.
- Local backups before risky settings or Skills changes.
- Cross-platform release strategy for Windows, macOS, and Linux on x64 and ARM64.
- macOS packages are published only after Developer ID signing and Apple notarization.

## Install

Download the package that matches your operating system and CPU architecture from this release page.

## Requirements

- Packaged builds include the desktop backend runtime; Node.js 18+ is still useful for development and Claude Code npm updates.
- Claude Code installed, or available to install during setup guidance.
- Packaged desktop builds include the runtime needed to launch the app.
```
