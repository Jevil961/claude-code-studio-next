# What To Upload To GitHub

This file is the source-of-truth checklist for keeping the repository clean and GitHub-ready.

## Commit These Files And Folders

```text
.github/
.gitattributes
.gitignore
CHANGELOG.md
CONTRIBUTING.md
LICENSE
README.md
SECURITY.md
docs/
package.json
package-lock.json
public/
scripts/
src/
src-tauri/
test/
```

Important committed subfolders:

```text
.github/workflows/
docs/assets/
docs/i18n/
src-tauri/capabilities/
src-tauri/icons/
```

Commit `src-tauri/Cargo.lock` because this is an application and reproducible desktop builds matter. Commit `package-lock.json` for reproducible Node installs.

## Do Not Commit Local Outputs

These are dependencies, build products, logs, local profiles, or private/generated data:

```text
.claude/
.venv/
node_modules/
dist/
dist-ai-classify/
dist-next/
dist-tauri/
edge-profile/
src-tauri/target/
tmp/
*.db
*.log
*.zip
*.exe
*.msi
*.tmp
```

Release binaries belong in GitHub Releases, not in Git history.

## Git Commands

Check the repository:

```powershell
git status --short
git status --short --ignored
```

Stage only uploadable files:

```powershell
git add .github .gitattributes .gitignore CHANGELOG.md CONTRIBUTING.md LICENSE README.md SECURITY.md docs package.json package-lock.json public scripts src src-tauri test
```

Verify staged files:

```powershell
git diff --cached --name-only
```

Commit:

```powershell
git commit -m "Prepare professional cross-platform GitHub release"
```

## GitHub Release Assets

Upload generated products to GitHub Releases:

```text
src-tauri/target/release/bundle/nsis/Claude Code Studio Next_0.1.0_x64-setup.exe
dist-tauri/Claude-Code-Studio-Next-portable.zip
GitHub Actions generated macOS/Linux artifacts
```

## Before Push Or Release

Run:

```powershell
npm install
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
npm run build
npm run build:portable
```

For a full local Windows gate:

```powershell
npm run release:check
```
