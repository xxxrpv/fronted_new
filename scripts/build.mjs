import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const child = spawn(
  process.execPath,
  [path.join(cwd, "node_modules/next/dist/bin/next"), "build"],
  {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_BUILD_DIR: ".next-production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
child.on("exit", (code) => process.exit(code || 0));
