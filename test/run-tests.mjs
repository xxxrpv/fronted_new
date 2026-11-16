import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require.extensions['.css'] = (module) => {
  module.exports = new Proxy({}, {
    get: (_target, prop) => String(prop),
  });
};
const jiti = require('jiti');
const runner = jiti(fileURLToPath(import.meta.url));
runner('./auth.test.ts');
runner('./simcore-training.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./simcore-evaluation.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./simcore-preview.test.ts');
runner('./ue-runtime.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./embodex-build.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./embodikit.test.ts');

runner('./conversation.test.ts');

jiti(fileURLToPath(import.meta.url), { jsx: true })('./original-chat.test.ts');

runner('./embodex-parts.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./workspace.test.ts');
runner('./task028-confirmation.test.ts');
runner('./task029-deployx.test.ts');

runner('./task029-state.test.ts');
runner('./task037-deployx-rc4.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./task033-model-training.test.tsx');
runner('./task036-equipment.test.ts');
runner('./task036-equipment-service.test.ts');
runner('./task037-equipment-ue.test.ts');
runner('./hub-session.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./hub-view.test.tsx');
runner('./workflow-header.test.ts');
runner('./topbar-navigation.test.ts');
runner('./feedback.test.ts');
runner('./account-settings.test.ts');
jiti(fileURLToPath(import.meta.url), { jsx: true })('./task038-projects-ui.test.ts');
runner('./mobile-responsive.test.ts');
