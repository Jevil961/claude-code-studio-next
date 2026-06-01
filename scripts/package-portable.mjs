import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env };
const rustRoot = "E:\\Rust";

if (existsSync(join(rustRoot, ".rustup")) && existsSync(join(rustRoot, "cargo", "bin"))) {
  env.RUSTUP_HOME = join(rustRoot, ".rustup");
  env.CARGO_HOME = join(rustRoot, "cargo");
  env.Path = `${join(rustRoot, "cargo", "bin")}${delimiter}${env.Path || ""}`;
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd: root, env, shell: process.platform === "win32", stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

run("npm", ["run", "tauri:build:exe"]);

const exe = join(root, "src-tauri", "target", "release", "claude-code-studio-next.exe");
if (!existsSync(exe)) {
  console.error(`Missing release executable: ${exe}`);
  process.exit(1);
}

const outRoot = join(root, "dist-tauri");
const portableDir = join(outRoot, "Claude-Code-Studio-Next-portable");
const zipPath = join(outRoot, "Claude-Code-Studio-Next-portable.zip");
rmSync(portableDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(portableDir, { recursive: true });

cpSync(exe, join(portableDir, "Claude Code Studio Next.exe"));
if (existsSync(join(root, "src-tauri", "node"))) cpSync(join(root, "src-tauri", "node"), join(portableDir, "node"), { recursive: true });
cpSync(join(root, "src"), join(portableDir, "src"), { recursive: true });
cpSync(join(root, "node_modules", "sql.js"), join(portableDir, "node_modules", "sql.js"), { recursive: true });
cpSync(join(root, "README.md"), join(portableDir, "README.md"));
if (existsSync(join(root, "docs"))) cpSync(join(root, "docs"), join(portableDir, "docs"), { recursive: true });

if (process.platform === "win32") {
  run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${portableDir}\\*' -DestinationPath '${zipPath}' -Force`]);
}

console.log(`Portable directory: ${portableDir}`);
if (existsSync(zipPath)) console.log(`Portable zip: ${zipPath}`);
