import { existsSync } from "node:fs";
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

const steps = [
  ["npm", ["run", "check"]],
  ["npm", ["test"]],
  ["cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]],
  ["npm", ["run", "tauri:build:exe"]],
];

for (const [cmd, args] of steps) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd: root, env, shell: process.platform === "win32", stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("\nRelease check passed.");
