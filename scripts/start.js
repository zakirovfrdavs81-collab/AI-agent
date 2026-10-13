import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPortListeners, isPortTaken } from "./port.js";
import { resolvePythonCommand } from "./python-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { command, args } = resolvePythonCommand();

const fallbackLocalPort = 5507;
const port = Number(process.env.PORT || fallbackLocalPort);
const host = process.env.HOST || "0.0.0.0";
const loopbackHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const appUrl = process.env.APP_ORIGIN
  ? `${process.env.APP_ORIGIN.replace(/\/+$/, "")}/`
  : `http://${loopbackHost}:${port}/`;
const startupTimeoutMs = 30_000;

const portInUse = await isPortTaken(port, loopbackHost);
if (portInUse) {
  const listeners = await getPortListeners(port, loopbackHost);
  if (await isNavoAiRunning()) {
    console.log(`Navo AI FastAPI allaqachon ishlayapti: ${appUrl}`);
    console.log(`Ilova va ro'yxatdan o'tish/kirish: ${appUrl}app/`);
  } else {
    const pidText = listeners.filter(Boolean).join(", ") || "aniqlanmadi";
    console.error(
      `XATO: ${port}-port band, lekin unda Navo AI FastAPI aniqlanmadi.\n` +
      `Tinglayotgan jarayon PID: ${pidText}.\n` +
      `Boshqa dastur (masalan, Live Server yoki boshqa jarayon) ${port}-portni band qilib turibdi.\n` +
      `Iltimos, ushbu jarayonni to'xtating yoki portni bo'shatib, run.bat ni qayta ishga tushiring.`
    );
    process.exit(1);
  }
} else {
  await startBackend();
}

async function isNavoAiRunning() {
  try {
    const [healthRes, apiHealthRes] = await Promise.all([
      fetch(`${appUrl}health`, { signal: AbortSignal.timeout(1500) }).catch(() => null),
      fetch(`${appUrl}api/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null),
    ]);

    const activeRes = (healthRes && healthRes.ok) ? healthRes : ((apiHealthRes && apiHealthRes.ok) ? apiHealthRes : null);
    if (!activeRes) return false;

    const data = await activeRes.json().catch(() => null);
    if (!data || data.status !== "ok") return false;

    try {
      const configRes = await fetch(`${appUrl}api/config`, { signal: AbortSignal.timeout(1500) });
      if (configRes.ok) {
        const config = await configRes.json();
        if (typeof config.google_login === "boolean" || typeof config.email_channel === "string") {
          return true;
        }
      }
    } catch {
      // config tekshiruvi kutish vaqtida xato bersa ham, health ok bo'lsa yetarli
    }
    return true;
  } catch {
    return false;
  }
}

const appIsReady = isNavoAiRunning;

async function startBackend() {
  console.log(`Navo AI FastAPI ishga tushmoqda: ${appUrl}`);
  console.log(`Python: ${command} ${args.join(" ")}`.trim());

  const forwardedAllowIps = process.env.FORWARDED_ALLOW_IPS || "*";

  const backend = spawn(
    command,
    [
      ...args,
      "-m",
      "uvicorn",
      "backend.main:app",
      "--host",
      host,
      "--port",
      String(port),
      "--proxy-headers",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOST: host,
        PORT: String(port),
        FORWARDED_ALLOW_IPS: forwardedAllowIps,
        PYTHONPATH: projectRoot,
      },
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
    if (await isNavoAiRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`FastAPI ${startupTimeoutMs / 1000} soniyada ${appUrl} manzilida tayyor bo'lmadi.`);
}
