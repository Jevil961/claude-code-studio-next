# Claude Code Studio Next 1.0.0

Claude Code Studio Next 1.0.0 is the first formal desktop release candidate for a local-first Claude Code GUI.

## Highlights

- Modern desktop shell with provider, identity, Skills, MCP, project, session, runner, diagnostics, and usage management.
- Agent Task Center with isolated Git worktrees, branch creation, task dependencies, ready queue execution, file-level diff review, patch copying, audit export, discard, and commit flow.
- Teams workflow builder with member roles, graph execution, conditional handoff, approval gates, and run audit evidence.
- Main chat hardening with duplicate-submit protection, Git conflict preflight, provider/Claude readiness hints, slash commands, command palette, and conversation export.
- Safer local backend with path guards, plugin validation, settings backups, diagnostics, and broader smoke/regression coverage.

## Validation

Run before publishing:

```bash
npm run check
env HOME=/private/tmp/ccs-test-home npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

Build a local macOS package:

```bash
npm run build:macos
```

Build a portable package on Windows:

```powershell
npm run build:portable
```

## Notes

- Packaged builds include the bundled runtime path used by the desktop shell.
- System Node.js/npm may still be useful for installing or updating Claude Code itself.
- macOS distribution still needs Developer ID signing and notarization before public end-user distribution outside local testing.
