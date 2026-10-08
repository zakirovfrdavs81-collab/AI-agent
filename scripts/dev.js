import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteEntry = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteEntry)) {
  console.error("Vite is not installed. Run npm install before npm run dev.");
  process.exit(1);
}

const children = [
  spawn(process.execPath, [path.join(projectRoot, "scripts", "start.js")], {
    cwd: projectRoot,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "5507" },
    stdio: "inherit",
  }),
  spawn(process.execPath, [viteEntry, "--host", "127.0.0.1"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  }),
];

let stopping = false;

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(`Development process failed to start: ${error.message}`);
    process.exitCode = 1;
    stopChildren();
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stopChildren();
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopChildren(signal));
}
