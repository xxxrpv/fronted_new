import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const runner = createJiti(fileURLToPath(import.meta.url), { jsx: true });
await runner.import("./v8-auth.test.ts");
