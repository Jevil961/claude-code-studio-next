# Changelog

## 0.1.0

- Migrated the desktop shell to Tauri while keeping the existing HTML/CSS UI.
- Added hidden Node backend bridge for providers, Skills, MCP, project history, diagnostics, and Claude runner orchestration.
- Added memory-first Claude runner mode that exits each task by default.
- Added watchdog cleanup for Claude and backend child processes.
- Added Skills sync hashing to skip unchanged directories.
- Added usage statistics cache to avoid repeated JSONL scans.
- Added startup bootstrap optimization and deferred secondary data loading.
- Added configuration backups for Claude settings and Skills.
- Added diagnostics export with runtime, process, path, count, and performance budget data.
- Added release scripts for release exe, NSIS installer, portable zip, and release gate checks.
