import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import { resolvePythonCommand } from "./python-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { command, args } = resolvePythonCommand();

const fallbackLocalPort = 5507;
const port = Number(process.env.PORT || fallbackLocalPort);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

function isPortTaken(portToCheck) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(true));
    server.listen(portToCheck, host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1", () => {
      server.close(() => resolve(false));
    });
  });
}

const portInUse = await isPortTaken(port);
if (portInUse && !process.env.PORT) {
  console.error(`Port ${port} is already in use. Stop the existing process or free port 5507 before starting the app.`);
  process.exit(1);
}

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
