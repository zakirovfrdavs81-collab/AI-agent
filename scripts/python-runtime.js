import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolvePythonCommand() {
  const configuredPython = process.env.PYTHON?.trim();
  if (configuredPython) return { command: configuredPython, args: [] };

  const virtualEnvPython = path.join(
    projectRoot,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (existsSync(virtualEnvPython)) {
    return { command: virtualEnvPython, args: [] };
  }

  return process.platform === "win32"
    ? { command: "py", args: ["-3"] }
    : { command: "python3", args: [] };
}
