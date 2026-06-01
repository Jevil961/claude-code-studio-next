# What To Upload To GitHub

This file is the source-of-truth upload checklist for the repository.

## Upload These Files And Folders

Commit these to GitHub:

```text
.github/
.gitattributes
.gitignore
CHANGELOG.md
CONTRIBUTING.md
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

## Important Notes

Upload `src-tauri/`, but do not upload `src-tauri/target/`.

Upload `src-tauri/Cargo.lock`. This is an application, so the lockfile should be committed for reproducible builds.

Upload `package-lock.json`. It locks the Node dependency tree for reproducible installs.

## Do Not Upload These Files And Folders

These are local dependencies, build outputs, logs, local profiles, or private/generated data:

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

Specific local files currently excluded:

```text
Claude-Code-Studio-Next-v0.1.0.zip
app-run.log
app-stderr.log
app-stdout.log
```

## Git Commands

Check what will be committed:

```powershell
git status --short
```

Check ignored local/build files:

```powershell
git status --short --ignored
```

Stage only uploadable files:

```powershell
git add .github .gitattributes .gitignore CHANGELOG.md CONTRIBUTING.md README.md SECURITY.md docs package.json package-lock.json public scripts src src-tauri test
```

Verify staged files:

```powershell
git diff --cached --name-only
```

Commit:

```powershell
git commit -m "Initial Tauri desktop studio release"
```

## GitHub Releases

Do not commit release binaries to the repository. Upload these files to GitHub Releases instead:

```text
src-tauri/target/release/bundle/nsis/Claude Code Studio Next_0.1.0_x64-setup.exe
dist-tauri/Claude-Code-Studio-Next-portable.zip
```

## Before First Push

Run:

```powershell
npm run release:check
```

Expected result:

```text
Release check passed.
```
