# Security

## Supported Version

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Sensitive Data

The app may read or update local Claude and provider configuration. Do not commit:

- API keys
- tokens
- local `.db` files
- generated diagnostic reports containing private paths
- build artifacts

The diagnostics report redacts common token-like command-line fields, but users should still review reports before sharing them.

## Reporting

For private use, report issues directly in the GitHub repository. Include:

- app version
- Windows version
- Node version
- whether the Tauri installer or portable zip was used
- sanitized diagnostics report

## Local Safety

Before overwriting Claude settings or Skills, the app writes backups under:

```text
~\.claude-code-studio\backups
```
