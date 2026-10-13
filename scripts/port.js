import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getPortListeners(port, host = "127.0.0.1") {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "netstat.exe",
        ["-ano", "-p", "tcp"],
        { windowsHide: true },
      );
      return [...new Set(stdout.split(/\r?\n/).flatMap((line) => {
        const fields = line.trim().split(/\s+/);
        if (
          fields[0] !== "TCP"
          || fields[3] !== "LISTENING"
          || fields[1].slice(fields[1].lastIndexOf(":") + 1) !== String(port)
        ) {
          return [];
        }
        const pid = Number(fields[4]);
        return pid ? [pid] : [];
      }))];
    } catch {
      // fallback to net.createServer check
    }
  } else {
    try {
      const { stdout } = await execFileAsync("lsof", ["-ti", `:${port}`]);
      const pids = stdout.trim().split(/\s+/).map(Number).filter(Boolean);
      if (pids.length > 0) return [...new Set(pids)];
    } catch {
      // fallback
    }
  }

  const taken = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(true);
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(false);
      });
    });
  });
  return taken ? [null] : [];
}

export async function isPortTaken(port, host) {
  return (await getPortListeners(port, host)).length > 0;
}
