import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
  DEFAULT_EQUIPMENT_PARAMETERS,
  FEATURE_GAPS,
  PARAMETER_BOUNDS,
  type EquipmentAlternative,
  type EquipmentBatchDetail,
  type EquipmentConceptParameters,
  type EquipmentFileReceipt,
} from '../lib/equipment/types';
import {
  validateConceptParameters,
  validateRequirement,
} from '../lib/equipment/validation';
import {
  computeActionFingerprint,
  createStableIdempotencyKey,
  getOrCreateActionIdempotencyKey,
  recordOperationForAction,
  clearActionIdempotencyKey,
  clearActionForOperation,
  clearUserEquipmentIdempotency,
  clearAllEquipmentIdempotency,
} from '../lib/equipment/idempotency';
import { validateGlbSecurity, checkGltfJsonSecurity } from '../lib/equipment/glb-security';
import {
  findAlternativeGlbReceipt,
  findCadZipReceipt,
  formatEquipmentTimestamp,
  getAlternativeDisplay,
  getBatchStatusDisplay,
  getOperationStatusDisplay,
  getSyncStatusLabel,
} from '../lib/equipment/state-helpers';

describe('Task-036 Frontend: 需求与 7 项参数本地及联合校验 (F04)', () => {
  test('默认参数完全合法且通过联合校验', () => {
    const res = validateConceptParameters(DEFAULT_EQUIPMENT_PARAMETERS);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(Object.keys(res.errors).length, 0);
    assert.strictEqual(res.generalError, undefined);
  });

  test('需求文本校验：拒绝空输入与超过 8000 字符', () => {
    assert.notStrictEqual(validateRequirement(''), null);
    assert.notStrictEqual(validateRequirement('   \n  '), null);
    assert.strictEqual(validateRequirement('设计桌面式分选设备'), null);

    const longText = 'a'.repeat(8001);
    const longRes = validateRequirement(longText);
    assert.notStrictEqual(longRes, null);
    assert.match(longRes!, /8000/);
  });

  test('参数边界校验：低于最小值或超出最大值报错', () => {
    // 布局长度 600 - 3000
    const tooShort = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      conveyor_length_mm: 599,
    });
    assert.strictEqual(tooShort.valid, false);
    assert.match(tooShort.errors.conveyor_length_mm, /600-3000/);

    const tooLong = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      conveyor_length_mm: 3001,
    });
    assert.strictEqual(tooLong.valid, false);

    // 布局宽度 150 - 2000
    const narrow = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      conveyor_width_mm: 140,
    });
    assert.strictEqual(narrow.valid, false);

    // 台面高度 400 - 1200
    const lowHeight = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      deck_height_mm: 350,
    });
    assert.strictEqual(lowHeight.valid, false);

    // 台面厚度 10 - 60
    const thinDeck = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      deck_thickness_mm: 5,
    });
    assert.strictEqual(thinDeck.valid, false);
  });

  test('工件尺寸必须为有限正数，拒绝 NaN/Infinity/非正数', () => {
    const nanRes = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      workpiece_length_mm: NaN,
    });
    assert.strictEqual(nanRes.valid, false);
    assert.match(nanRes.errors.workpiece_length_mm, /大于 0/);

    const zeroRes = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      workpiece_width_mm: 0,
    });
    assert.strictEqual(zeroRes.valid, false);

    const negRes = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      workpiece_height_mm: -10,
    });
    assert.strictEqual(negRes.valid, false);
  });

  test('三项联合约束校验', () => {
    // 联合约束 1: 工件宽度 + 40 <= 布局宽度
    const failWidthConstraint = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      conveyor_width_mm: 300,
      workpiece_width_mm: 270, // 270 + 40 = 310 > 300
    });
    assert.strictEqual(failWidthConstraint.valid, false);
    assert.match(failWidthConstraint.errors.workpiece_width_mm, /至少需比工件宽度大 40 mm/);

    // 联合约束 2: 工件长度 <= 布局长度 / 4
    const failLengthConstraint = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      conveyor_length_mm: 1000,
      workpiece_length_mm: 260, // 260 > 1000/4=250
    });
    assert.strictEqual(failLengthConstraint.valid, false);
    assert.match(failLengthConstraint.errors.workpiece_length_mm, /不能超过布局长度的 1\/4/);

    // 联合约束 3: 工件高度 <= 150
    const failHeightConstraint = validateConceptParameters({
      ...DEFAULT_EQUIPMENT_PARAMETERS,
      workpiece_height_mm: 151,
    });
    assert.strictEqual(failHeightConstraint.valid, false);
    assert.match(failHeightConstraint.errors.workpiece_height_mm, /不能超过 150 mm/);
  });
});

describe('Task-036 Frontend: 动作幂等键稳定生成与隔离管理 (F05)', () => {
  const testProject = 'proj_test_036_001';

  beforeEach(() => {
    clearActionIdempotencyKey(testProject, 'batch');
    clearActionIdempotencyKey(testProject, 'select');
    clearActionIdempotencyKey(testProject, 'revision');
  });

  test('幂等键格式满足 ^[A-Za-z0-9_-]{1,128}$ 契约要求', () => {
    const key = createStableIdempotencyKey('batch');
    assert.match(key, /^[A-Za-z0-9_-]{1,128}$/);
    assert.ok(key.startsWith('eq_batch_'));
  });

  test('相同动作与正文重放返回同一稳定幂等键（防连点重复建 CAD）', () => {
    const payload = { requirement: '测试需求', parameters: DEFAULT_EQUIPMENT_PARAMETERS };
    const first = getOrCreateActionIdempotencyKey(testProject, 'batch', payload);
    assert.strictEqual(first.isReplay, false);

    const second = getOrCreateActionIdempotencyKey(testProject, 'batch', payload);
    assert.strictEqual(second.isReplay, true);
    assert.strictEqual(first.key, second.key);
  });

  test('修改参数后自动生成新幂等键', () => {
    const payload1 = { requirement: '需求 A', parameters: DEFAULT_EQUIPMENT_PARAMETERS };
    const res1 = getOrCreateActionIdempotencyKey(testProject, 'batch', payload1);

    const payload2 = { requirement: '需求 B (已更改)', parameters: DEFAULT_EQUIPMENT_PARAMETERS };
    const res2 = getOrCreateActionIdempotencyKey(testProject, 'batch', payload2);

    assert.notStrictEqual(res1.key, res2.key);
    assert.strictEqual(res2.isReplay, false);
  });
});

describe('Task-036 Frontend: 状态机映射、未知状态与工程未验证提示 (F06, F07)', () => {
  test('本地已持久化 (local_persisted / status=null) 展示为受理中', () => {
    const display = getOperationStatusDisplay(null, 'local_persisted');
    assert.strictEqual(display.tone, 'pending');
    assert.match(display.label, /本地已受理/);
    assert.strictEqual(display.isTerminal, false);
  });

  test('上游未知 (upstream_unknown) 不误报失败，诚实表达未知状态', () => {
    const display = getOperationStatusDisplay(null, 'upstream_unknown');
    assert.strictEqual(display.tone, 'warning');
    assert.match(display.label, /上游连接未确认/);
    assert.strictEqual(display.isTerminal, false);
    assert.strictEqual(display.canRetry, false);
  });

  test('needs_attention 终止自动重做，提示人工核实', () => {
    const display = getOperationStatusDisplay('needs_attention', 'upstream_acknowledged');
    assert.strictEqual(display.tone, 'warning');
    assert.strictEqual(display.needsAttention, true);
    assert.strictEqual(display.isTerminal, true);
    assert.strictEqual(display.canRetry, false);
  });

  test('cad_succeeded 状态与文件 available 分开展示', () => {
    const display = getOperationStatusDisplay('cad_succeeded', 'upstream_acknowledged');
    assert.match(display.label, /CAD 建模完成/);
    assert.match(display.description, /正在安全回传与入库/);
    assert.strictEqual(display.isTerminal, false);
  });

  test('快照同步标记 (syncStatus) 与时间戳格式化', () => {
    assert.strictEqual(getSyncStatusLabel('persisted_snapshot'), '本地持久快照');
    assert.strictEqual(getSyncStatusLabel('upstream_synced'), '已与上游实时同步');
    assert.strictEqual(getSyncStatusLabel('upstream_unavailable'), '上游不可用 (展示持久快照)');

    const formatted = formatEquipmentTimestamp('2026-10-27T10:00:00Z');
    assert.ok(formatted.includes('2026'));
  });
});

describe('Task-036 Frontend: 真实 5 方案展示与 G01-G03 功能缺口对照 (F04, F09)', () => {
  const sampleOption: EquipmentAlternative = {
    id: 'custom_dual_slide',
    title: '双滑台伺服移载方案',
    condition: '适用于刚性工件快速换道',
    unverified: '双向换道节拍及急停冲击待校核',
    designRationale: '采用模块化滑台降低占地空间',
    componentCount: 14,
    geometrySource: 'param_cad_v1',
    engineeringVerified: false,
    files: [],
  };

  test('完整展示后端返回的真实方案标题、条件、组件数及几何来源', () => {
    const display = getAlternativeDisplay(sampleOption, 0);
    assert.strictEqual(display.id, 'custom_dual_slide');
    assert.strictEqual(display.displayNumber, 1);
    assert.strictEqual(display.title, '双滑台伺服移载方案');
    assert.strictEqual(display.condition, '适用于刚性工件快速换道');
    assert.strictEqual(display.unverified, '双向换道节拍及急停冲击待校核');
    assert.strictEqual(display.componentCount, 14);
    assert.strictEqual(display.geometrySource, 'param_cad_v1');
    assert.strictEqual(display.engineeringVerified, false);
  });

  test('缺口 G01、G02、G03 规范定义存在且具备清晰原因', () => {
    assert.strictEqual(FEATURE_GAPS.G01_DETAIL_PACKAGE.code, 'G01');
    assert.strictEqual(FEATURE_GAPS.G01_DETAIL_PACKAGE.status, 'DISABLED');
    assert.match(FEATURE_GAPS.G01_DETAIL_PACKAGE.reason, /equipment-detail-input/);

    assert.strictEqual(FEATURE_GAPS.G02_UE_RUNTIME.code, 'G02');
    assert.strictEqual(FEATURE_GAPS.G02_UE_RUNTIME.status, 'DISABLED');
    assert.match(FEATURE_GAPS.G02_UE_RUNTIME.reason, /排除 UE 运行时/);

    assert.strictEqual(FEATURE_GAPS.G03_ASSET_COUNT.code, 'G03');
    assert.strictEqual(FEATURE_GAPS.G03_ASSET_COUNT.status, 'OMITTED_HONESTLY');
  });
});

describe('Task-036 Frontend: GLB 与 CAD ZIP 产物文件回执安全门禁 (F08)', () => {
  const sampleFiles: EquipmentFileReceipt[] = [
    {
      kind: 'preview_glb',
      alternativeId: 'opt_1',
      fileName: 'opt_1.glb',
      status: 'available',
      artifactId: '00000000-0000-4000-8000-000000000001',
      assetId: '00000000-0000-4000-8000-000000000002',
      entryId: '00000000-0000-4000-8000-000000000003',
      sizeBytes: 1048576,
    },
    {
      kind: 'preview_glb',
      alternativeId: 'opt_2',
      fileName: 'opt_2.glb',
      status: 'pending',
      artifactId: null,
      assetId: null,
      entryId: null,
      sizeBytes: null,
    },
    {
      kind: 'cad_zip',
      alternativeId: 'opt_1',
      fileName: 'cad_opt_1.zip',
      status: 'available',
      artifactId: '00000000-0000-4000-8000-000000000004',
      assetId: '00000000-0000-4000-8000-000000000005',
      entryId: '00000000-0000-4000-8000-000000000006',
      sizeBytes: 5242880,
    },
  ];

  test('仅匹配 status 为 available 且具备有效 entryId 的 preview_glb', () => {
    const glb1 = findAlternativeGlbReceipt(sampleFiles, 'opt_1');
    assert.ok(glb1);
    assert.strictEqual(glb1?.status, 'available');
    assert.strictEqual(glb1?.entryId, '00000000-0000-4000-8000-000000000003');

    // opt_2 为 pending，应返回 undefined
    const glb2 = findAlternativeGlbReceipt(sampleFiles, 'opt_2');
    assert.strictEqual(glb2, undefined);
  });

  test('仅匹配 status 为 available 的 cad_zip 产物', () => {
    const cadZip = findCadZipReceipt(sampleFiles, 'opt_1');
    assert.ok(cadZip);
    assert.strictEqual(cadZip?.status, 'available');
    assert.strictEqual(cadZip?.fileName, 'cad_opt_1.zip');
  });

  test('S01: 支持在 selection.files 或多来源数组中正确查找 CAD ZIP', () => {
    const cadReceipt: EquipmentFileReceipt = {
      kind: 'cad_zip',
      status: 'available',
      entryId: 'entry_cad_001',
      alternativeId: 'alt_pick',
      fileName: 'assembly_pick.zip',
    };
    const batchFiles: EquipmentFileReceipt[] = [
      {
        kind: 'alternatives_json',
        status: 'available',
        entryId: 'entry_meta_001',
        fileName: 'meta.json',
      },
    ];

    // 1. 真实契约形状：batch.files 为通用元数据，selection.files 含 cad_zip
    const foundFromSelection = findCadZipReceipt(
      [null, batchFiles, [cadReceipt]],
      'alt_pick'
    );
    assert.ok(foundFromSelection);
    assert.strictEqual(foundFromSelection?.entryId, 'entry_cad_001');

    // 2. alternativeId 不匹配时返回 undefined
    const notMatched = findCadZipReceipt([batchFiles, [cadReceipt]], 'alt_other');
    assert.strictEqual(notMatched, undefined);
  });
});

describe('Task-036 Frontend R1: 状态机映射精细化与操作类型文案区分 (S06)', () => {
  test('S06: upstream_unknown 与 running 组合必须提示同步未确认且为 warning tone', () => {
    const display = getOperationStatusDisplay('running', 'upstream_unknown');
    assert.strictEqual(display.tone, 'warning');
    assert.match(display.label, /同步未确认/);
    assert.match(display.description, /同步中断或尚未确认/);
    assert.strictEqual(display.isTerminal, false);
  });

  test('S06: kind 为 generate_alternatives 时正确展示方案生成文案', () => {
    const queued = getOperationStatusDisplay('queued', 'upstream_acknowledged', 'generate_alternatives');
    assert.strictEqual(queued.label, '方案生成排队中');

    const running = getOperationStatusDisplay('running', 'upstream_acknowledged', 'generate_alternatives');
    assert.strictEqual(running.label, 'AI 方案求解生成中');
    assert.match(running.description, /生成 5 组概念结构方案/);

    const cadSucc = getOperationStatusDisplay('cad_succeeded', 'upstream_acknowledged', 'generate_alternatives');
    assert.strictEqual(cadSucc.label, '方案计算完成 (上传预览中)');

    const succ = getOperationStatusDisplay('succeeded', 'upstream_acknowledged', 'generate_alternatives');
    assert.strictEqual(succ.label, '方案已生成');
    assert.strictEqual(succ.tone, 'success');
    assert.strictEqual(succ.isTerminal, true);
  });
});

describe('Task-036 Frontend R2: 稳定幂等键多指纹保留与用户/项目隔离 (S02)', () => {
  const proj = 'proj_idem_r2_test';

  beforeEach(() => {
    clearAllEquipmentIdempotency();
  });

  test('S02: 网络超时或未知错误时不清除键，同一动作重试复用原稳定键', () => {
    const payload = { requirement: '高精度输送线', parameters: DEFAULT_EQUIPMENT_PARAMETERS };
    const first = getOrCreateActionIdempotencyKey(proj, 'batch', payload);
    assert.strictEqual(first.isReplay, false);

    // 模拟服务端响应丢失 / 503 超时：不调用 clearActionIdempotencyKey
    const retry = getOrCreateActionIdempotencyKey(proj, 'batch', payload);
    assert.strictEqual(retry.isReplay, true);
    assert.strictEqual(retry.key, first.key);
  });

  test('S02: A -> B -> A 输入修改往返，原未决 A 的幂等键不被覆盖破坏', () => {
    const payloadA = { requirement: '输入 A', parameters: DEFAULT_EQUIPMENT_PARAMETERS };
    const payloadB = { requirement: '输入 B', parameters: DEFAULT_EQUIPMENT_PARAMETERS };

    const actionA = getOrCreateActionIdempotencyKey(proj, 'batch', payloadA);
    recordOperationForAction(proj, 'batch', 'op_A', computeActionFingerprint(payloadA));

    // 用户修改为 B
    const actionB = getOrCreateActionIdempotencyKey(proj, 'batch', payloadB);
    assert.notStrictEqual(actionB.key, actionA.key);

    // 用户又改回 A，必须返回 actionA 原键及记录的 operationId
    const actionAReturned = getOrCreateActionIdempotencyKey(proj, 'batch', payloadA);
    assert.strictEqual(actionAReturned.isReplay, true);
    assert.strictEqual(actionAReturned.key, actionA.key);
    assert.strictEqual(actionAReturned.operationId, 'op_A');
  });

  test('S02: 用户账号空间严格隔离，不同账号不串用幂等键与 operationId', () => {
    const payload = { requirement: '账号隔离测试', parameters: DEFAULT_EQUIPMENT_PARAMETERS };
    
    // 用户 1 发起
    const user1Key = getOrCreateActionIdempotencyKey(proj, 'batch', payload, 'user_1');
    recordOperationForAction(proj, 'batch', 'op_user_1', undefined, 'user_1');
    assert.strictEqual(user1Key.isReplay, false);

    // 用户 2 发起完全相同的 payload
    const user2Key = getOrCreateActionIdempotencyKey(proj, 'batch', payload, 'user_2');
    assert.strictEqual(user2Key.isReplay, false);
    assert.notStrictEqual(user2Key.key, user1Key.key);
    assert.strictEqual(user2Key.operationId, undefined); // 绝对不串用户 1 的 operationId
  });

  test('S02: 登出或账号切换时清理用户幂等数据', () => {
    const payload = { requirement: '登出清理测试', parameters: DEFAULT_EQUIPMENT_PARAMETERS };
    const key1 = getOrCreateActionIdempotencyKey(proj, 'batch', payload, 'user_logout');
    clearUserEquipmentIdempotency('user_logout');
    
    const key2 = getOrCreateActionIdempotencyKey(proj, 'batch', payload, 'user_logout');
    assert.strictEqual(key2.isReplay, false);
    assert.notStrictEqual(key2.key, key1.key);
  });
});

describe('Task-036 Frontend R2: GLTF 外部网络资源与预存 blob 注入防御 (STD-02-R2)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const previewSource = fs.readFileSync(
    path.join(__dirname, '../app/projects/[projectId]/equipment/EquipmentPreview.tsx'),
    'utf8'
  );
  const marker = 'manager.setURLModifier((url) => {';
  const begin = previewSource.indexOf(marker) + marker.length;
  const end = previewSource.indexOf('\n        });', begin);
  const actualModifier = new Function('url', previewSource.slice(begin, end));

  test('允许合法内部 data: URI', () => {
    const dataUri = 'data:application/octet-stream;base64,AAAA';
    assert.strictEqual(actualModifier(dataUri), dataUri);
  });

  test('预检拒绝源文件中的 blob URI，解析器创建的 blob 可通过局部 manager', () => {
    const untrustedBlobUri = 'blob:http://localhost:3000/00000000-0000-4000-8000-000000000001';
    assert.throws(() => checkGltfJsonSecurity({ images: [{ uri: untrustedBlobUri }] }), /不受信任/);
    assert.strictEqual(actualModifier(untrustedBlobUri), untrustedBlobUri);
  });

  test('拒绝相对路径、外部网络 URL 及协议相对 URL', () => {
    const dangerousUris = [
      '/api/v1/projects/bypass-resource',
      'textures/diffuse.png',
      '../secret.bin',
      'http://external.invalid/model.bin',
      'https://external.invalid/model.bin',
      '//cdn.invalid/model.bin',
      'ftp://untrusted.invalid/model.bin',
    ];

    for (const uri of dangerousUris) {
      assert.throws(
        () => actualModifier(uri),
        /拒绝未经平台代理的外部模型资源引用/
      );
    }
  });

  test('validateGlbSecurity: 深入检查 GLB 内部 JSON，拦截 buffers/images 中注入的 blob/http 引用', () => {
    // 构造合法的自包含 GLB
    const safeGltf = { asset: { version: '2.0' }, buffers: [{ byteLength: 32 }] };
    const safeRaw = Buffer.from(JSON.stringify(safeGltf));
    const safeBytes = Buffer.concat([safeRaw, Buffer.alloc((4 - safeRaw.length % 4) % 4, 0x20)]);
    const safeGlb = Buffer.alloc(20 + safeBytes.length);
    safeGlb.writeUInt32LE(0x46546c67, 0); // magic 'glTF'
    safeGlb.writeUInt32LE(2, 4); // version
    safeGlb.writeUInt32LE(safeGlb.length, 8); // total length
    safeGlb.writeUInt32LE(safeBytes.length, 12); // chunk length
    safeGlb.writeUInt32LE(0x4e4f534a, 16); // chunk type 'JSON'
    safeBytes.copy(safeGlb, 20);

    // 校验安全 GLB 不报错
    assert.doesNotThrow(() => validateGlbSecurity(safeGlb.buffer));

    // 构造包含外部 blob: 协议的恶意 GLB
    const maliciousGltf = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'blob:http://evil.invalid/injected.bin', byteLength: 32 }],
    };
    const malRaw = Buffer.from(JSON.stringify(maliciousGltf));
    const malBytes = Buffer.concat([malRaw, Buffer.alloc((4 - malRaw.length % 4) % 4, 0x20)]);
    const malGlb = Buffer.alloc(20 + malBytes.length);
    malGlb.writeUInt32LE(0x46546c67, 0);
    malGlb.writeUInt32LE(2, 4);
    malGlb.writeUInt32LE(malGlb.length, 8);
    malGlb.writeUInt32LE(malBytes.length, 12);
    malGlb.writeUInt32LE(0x4e4f534a, 16);
    malBytes.copy(malGlb, 20);

    // 校验恶意 GLB 必须抛出安全拦截异常
    assert.throws(
      () => validateGlbSecurity(malGlb.buffer),
      /检测到不受信任的模型资源引用/
    );
  });
});


test('返工：乱序回执只绑定和清除对应正文及用户的操作', () => {
  clearAllEquipmentIdempotency();
  const project = 'project-r3';
  const a = { requirement: 'A' };
  const b = { requirement: 'B' };
  const keyA = getOrCreateActionIdempotencyKey(project, 'batch', a, 'user-a').key;
  const keyB = getOrCreateActionIdempotencyKey(project, 'batch', b, 'user-a').key;
  const other = getOrCreateActionIdempotencyKey(project, 'batch', a, 'user-b').key;
  recordOperationForAction(project, 'batch', 'op-b', computeActionFingerprint(b), 'user-a');
  recordOperationForAction(project, 'batch', 'op-a', computeActionFingerprint(a), 'user-a');
  assert.equal(getOrCreateActionIdempotencyKey(project, 'batch', a, 'user-a').operationId, 'op-a');
  assert.equal(getOrCreateActionIdempotencyKey(project, 'batch', b, 'user-a').operationId, 'op-b');
  clearActionForOperation(project, 'op-a', 'user-a');
  assert.notEqual(getOrCreateActionIdempotencyKey(project, 'batch', a, 'user-a').key, keyA);
  assert.equal(getOrCreateActionIdempotencyKey(project, 'batch', b, 'user-a').key, keyB);
  assert.equal(getOrCreateActionIdempotencyKey(project, 'batch', a, 'user-b').key, other);
});


test('GLB 预检拒绝重复 JSON、错误头和损坏的 JSON', () => {
  const rawJson = Buffer.from('{"asset":{"version":"2.0"}}');
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
  const chunk = Buffer.alloc(8 + json.length);
  chunk.writeUInt32LE(json.length, 0); chunk.writeUInt32LE(0x4e4f534a, 4); json.copy(chunk, 8);
  const duplicate = Buffer.alloc(12 + chunk.length * 2);
  duplicate.writeUInt32LE(0x46546c67, 0); duplicate.writeUInt32LE(2, 4); duplicate.writeUInt32LE(duplicate.length, 8);
  chunk.copy(duplicate, 12); chunk.copy(duplicate, 12 + chunk.length);
  assert.throws(() => validateGlbSecurity(duplicate.buffer), /多个 JSON/);
  const badHeader = Buffer.from(duplicate); badHeader.writeUInt32LE(1, 4);
  assert.throws(() => validateGlbSecurity(badHeader.buffer.slice(badHeader.byteOffset, badHeader.byteOffset + badHeader.length)), /头部/);
  assert.throws(() => validateGlbSecurity(new TextEncoder().encode('{broken').buffer));
});
