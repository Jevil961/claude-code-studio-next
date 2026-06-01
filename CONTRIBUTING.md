# Contributing

This project is currently optimized for local Windows use. Keep changes small, testable, and aligned with the Tauri-first direction.

## Setup

```powershell
npm install
npm run dev
```

Rust is required for Tauri builds. This workspace expects Rust under `E:\Rust` when using the bundled release scripts, but a normal Rust installation also works if `cargo` is on `PATH`.

## Before Opening A PR

```powershell
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

For release-sensitive changes:

```powershell
npm run release:check
```

## Product Rules

- Do not expose low-level process details in the main user experience.
- Keep the default runner strategy memory-first.
- Avoid first-screen blocking work. Load heavy data after first paint or during idle time.
- Back up Claude settings or Skills before destructive writes.
- Keep the framework boundary Tauri-first. Do not add another desktop shell unless the product direction changes.

## Commit Scope

Prefer focused commits:

- `runtime`: Tauri or backend process changes
- `ui`: user-facing interface changes
- `data`: providers, Skills, MCP, usage, project index
- `release`: packaging, scripts, docs, CI
- `test`: tests and fixtures
