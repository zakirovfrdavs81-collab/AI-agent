import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import { resolvePythonCommand } from "./python-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { command, args } = resolvePythonCommand();

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function resolvePort(preferredPort) {
  if (process.env.PORT && process.env.PORT !== "") return Number(process.env.PORT);
  const candidate = Number(preferredPort);
  if (await isPortFree(candidate)) return candidate;
  for (let port = candidate + 1; port < candidate + 50; port += 1) {
    if (await isPortFree(port)) return port;
  }
  return candidate;
}

const port = await resolvePort(5507);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

const backend = spawn(
  command,
  [...args, "-m", "uvicorn", "backend.main:app", "--host", host, "--port", String(port)],
  { cwd: projectRoot, env: { ...process.env, PORT: String(port), PYTHONPATH: projectRoot }, stdio: "inherit" },
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
