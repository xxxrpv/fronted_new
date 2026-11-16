/**
 * 单独运行本地 GLB SDK 传输测试，隔离其他测试对全局客户端的 mock。
 * 复用仓库已有 jiti，不新增测试框架或运行时依赖。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
require('jiti')(fileURLToPath(import.meta.url))('./equipment-local-preview.test.ts');
