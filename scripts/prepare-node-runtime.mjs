import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = process.execPath;
const outDir = join(root, "src-tauri", "node");
const outName = process.platform === "win32" ? "node.exe" : "node";
const target = join(outDir, outName);

if (!source || !existsSync(source)) {
  console.error("Cannot locate current Node.js runtime.");
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);

if (process.platform !== "win32") {
  chmodSync(target, 0o755);
}

const size = statSync(target).size;
console.log(`Prepared bundled Node runtime: ${basename(target)} (${size} bytes)`);
