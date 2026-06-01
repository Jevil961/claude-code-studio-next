# Performance Budget

These are release gates for the Tauri build. They protect perceived speed without removing useful behavior.

## Startup

- Cold start to interactive UI: <= 3000 ms.
- Warm start to interactive UI: <= 1500 ms.
- Startup bootstrap must not load full Skills/MCP/plugins/usage data on the critical path.
- Deep project indexing, diagnostics, usage, and automations must run after first paint or idle.

## Processes

- Idle app: one Tauri process, one WebView2 process group, one hidden backend `node.exe`.
- After a Claude task completes in strict mode: 0 lingering Claude Code processes after 3 seconds.
- Switching identities should not create extra backend Node processes.
- Closing the app must terminate the backend Node process.

## Data Loading

- Project list initial load should use cache when available.
- Background project indexing budget: <= 500 ms per refresh batch.
- Usage statistics must use cache for repeated reads within 5 minutes.
- Skills sync must skip unchanged directories by content hash.

## Memory

- Default runner strategy: strict / task ends immediately.
- Persistent runner mode is a compatibility option only.
- No automatic full Skills render on the first screen.

## Manual Measurement

Use Diagnostics after a run and check:

- `counts.nodeProcesses`
- `counts.claudeProcesses`
- `processes[].workingSetMb`
- `performanceBudgets`

Useful commands:

```powershell
npm run release:check
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|claude|msedgewebview2|claude-code-studio' } | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine
```
