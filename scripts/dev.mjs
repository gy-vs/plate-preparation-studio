// 同时启动后端（tsx watch）与前端（vite），无额外依赖。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const children = [
  spawn("npm", ["run", "dev", "-w", "server"], { cwd: root, stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "web"], { cwd: root, stdio: "inherit" }),
];

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const child of children) child.on("exit", (code) => process.exit(code ?? 0));
