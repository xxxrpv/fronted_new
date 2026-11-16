import { createJiti } from 'jiti';
const runner = createJiti(import.meta.url, { jsx: true });
await runner.import('./v8-reference.test.ts');
await runner.import('./v8-original-sources.test.ts');
