import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPortListeners, isPortTaken } from "./port.js";
import { resolvePythonCommand } from "./python-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { command, args } = resolvePythonCommand();

const fallbackLocalPort = 5507;
const port = Number(process.env.PORT || fallbackLocalPort);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const appUrl = `http://127.0.0.1:${port}/`;
const startupTimeoutMs = 30_000;

const portInUse = await isPortTaken(port, host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1");
if (portInUse) {
  const listeners = await getPortListeners(port);
  if (await appIsReady()) {
    console.log(`Navo AI FastAPI allaqachon ishlayapti: ${appUrl}`);
    console.log(`Ilova va ro'yxatdan o'tish/kirish: ${appUrl}app/`);
  } else {
    console.error(
      `XATO: ${port}-port band, lekin unda Navo AI FastAPI aniqlanmadi. ` +
      `Tinglayotgan jarayon PID: ${listeners.join(", ") || "aniqlanmadi"}. ` +
      "Boshqa jarayonni to'xtatmasdan avval uning egasini tekshiring.",
    );
    process.exitCode = 1;
  }
} else {
  await startBackend();
}

async function appIsReady() {
  try {
    const [healthResponse, pageResponse, appResponse, configResponse] = await Promise.all([
      fetch(`${appUrl}api/health`, { signal: AbortSignal.timeout(1500) }),
      fetch(appUrl, { signal: AbortSignal.timeout(1500) }),
      fetch(`${appUrl}app/`, { signal: AbortSignal.timeout(1500) }),
      fetch(`${appUrl}api/config`, { signal: AbortSignal.timeout(1500) }),
    ]);
    if (!healthResponse.ok || !pageResponse.ok || !appResponse.ok || !configResponse.ok) return false;

    const [health, page, appPage, config] = await Promise.all([
      healthResponse.json(),
      pageResponse.text(),
      appResponse.text(),
      configResponse.json(),
    ]);
    return health.status === "ok"
      && page.includes("<title>Navo AI")
      && page.includes("data-nav")
      && appPage.includes('id="root"')
      && typeof config.google_login === "boolean"
      && typeof config.email_channel === "string";
  } catch {
    return false;
  }
}

async function startBackend() {
  console.log(`Navo AI FastAPI ishga tushmoqda: ${appUrl}`);
  console.log(`Python: ${command} ${args.join(" ")}`.trim());

  const backend = spawn(
    command,
    [...args, "-m", "uvicorn", "backend.main:app", "--host", host, "--port", String(port)],
    {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(port), PYTHONPATH: projectRoot },
      stdio: "inherit",
    },
  );
  let backendExit = null;
  let startupError = null;

  backend.on("error", (error) => {
    startupError = error;
    backendExit = 1;
    console.error(`FastAPI jarayonini ishga tushirib bo'lmadi: ${error.message}`);
  });

  backend.on("exit", (code, signal) => {
    backendExit = code ?? (signal ? 1 : 0);
    process.exitCode = backendExit;
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => backend.kill(signal));
  }

  try {
    await waitForBackend(() => backendExit, () => startupError);
    console.log(`Navo AI tayyor: ${appUrl}`);
    console.log(`Ilova va ro'yxatdan o'tish/kirish: ${appUrl}app/`);
    console.log(`API tekshiruvi: ${appUrl}api/health`);
    console.log("Serverni to'xtatish uchun Ctrl+C bosing.");
  } catch (error) {
    console.error(error.message);
    if (backendExit === null) backend.kill();
    process.exitCode = 1;
  }
}

async function waitForBackend(getExitCode, getStartupError) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (getExitCode() !== null) {
      const startupError = getStartupError();
      throw new Error(
        startupError
          ? `FastAPI ishga tushmadi: ${startupError.message}`
          : `FastAPI tayyor bo'lishidan oldin to'xtadi (exit code ${getExitCode()}).`,
      );
    }
    if (await appIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`FastAPI ${startupTimeoutMs / 1000} soniyada ${appUrl} manzilida tayyor bo'lmadi.`);
}
