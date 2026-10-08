import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolvePythonCommand } from "./python-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { command, args } = resolvePythonCommand();
const port = process.env.PORT || "5507";
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

const backend = spawn(
  command,
  [...args, "-m", "uvicorn", "main:app", "--host", host, "--port", port],
  { cwd: projectRoot, env: process.env, stdio: "inherit" },
);

backend.on("error", (error) => {
  console.error(`Could not start FastAPI using "${command}": ${error.message}`);
  process.exitCode = 1;
});

backend.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => backend.kill(signal));
}
