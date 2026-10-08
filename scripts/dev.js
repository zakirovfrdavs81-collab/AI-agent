import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellCommand = process.platform === "win32" ? "cmd" : "sh";
const shellArgs = process.platform === "win32" ? ["/c", "npm run build"] : ["-lc", "npm run build"];

function runBuildAndStart() {
  const build = spawn(shellCommand, shellArgs, {
    cwd: projectRoot,
    env: { ...process.env, PORT: "5507", HOST: "127.0.0.1" },
    stdio: "inherit",
  });

  build.on("error", (error) => {
    console.error(`Build failed to start: ${error.message}`);
    process.exit(1);
  });

  build.on("exit", (code) => {
    if (code !== 0) {
      process.exit(code ?? 1);
      return;
    }

    const backend = spawn(process.execPath, [path.join(projectRoot, "scripts", "start.js")], {
      cwd: projectRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: "5507" },
      stdio: "inherit",
    });

    backend.on("error", (error) => {
      console.error(`Backend failed to start: ${error.message}`);
      process.exit(1);
    });

    backend.on("exit", (exitCode, signal) => {
      process.exit(exitCode ?? (signal ? 1 : 0));
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => backend.kill(signal));
    }
  });
}

runBuildAndStart();
