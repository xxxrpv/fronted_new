import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const production = process.argv.includes("--production");
const requested = Number(process.env.PORT || (production ? 3109 : 3108));
async function available(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}
let port = requested;
while (port < requested + 20 && !(await available(port))) port++;
if (port === requested + 20)
  throw new Error("No free local preview port; set PORT to an available port.");
const child = spawn(
  process.execPath,
  [
    path.join(cwd, "node_modules/next/dist/bin/next"),
    production ? "start" : "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      ...(production
        ? { NEXT_BUILD_DIR: ".next-production", ENABLE_V8_PREVIEW: "0" }
        : { ENABLE_V8_PREVIEW: "1" }),
    },
  },
);
console.log(
  `Embodex ${production ? "platform" : "development preview"}: http://127.0.0.1:${port}${production ? "/design" : "/v8"}`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
