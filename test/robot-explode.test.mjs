import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../node_modules/three/build/three.cjs';

// 模拟 URDF Three 模型树形结构与两级分层拆解算法
function createTestRobot() {
  const rootGroup = new THREE.Group();
  rootGroup.rotation.x = -Math.PI / 2;
  rootGroup.position.y = 0.2762;

  const hierarchy = [
    { name: 'base', parent: null, origin: [0, 0, 0] },
    { name: 'trunk', parent: 'base', origin: [0, 0, 0] },
    // FR leg
    { name: 'FR_hip', parent: 'trunk', origin: [0.1805, -0.047, 0] },
    { name: 'FR_thigh', parent: 'FR_hip', origin: [0, -0.0838, 0] },
    { name: 'FR_calf', parent: 'FR_thigh', origin: [0, 0, -0.2] },
    { name: 'FR_foot', parent: 'FR_calf', origin: [0, 0, -0.2] },
    // FL leg
    { name: 'FL_hip', parent: 'trunk', origin: [0.1805, 0.047, 0] },
    { name: 'FL_thigh', parent: 'FL_hip', origin: [0, 0.0838, 0] },
    { name: 'FL_calf', parent: 'FL_thigh', origin: [0, 0, -0.2] },
    { name: 'FL_foot', parent: 'FL_calf', origin: [0, 0, -0.2] },
    // RR leg
    { name: 'RR_hip', parent: 'trunk', origin: [-0.1805, -0.047, 0] },
    { name: 'RR_thigh', parent: 'RR_hip', origin: [0, -0.0838, 0] },
    { name: 'RR_calf', parent: 'RR_thigh', origin: [0, 0, -0.2] },
    { name: 'RR_foot', parent: 'RR_calf', origin: [0, 0, -0.2] },
    // RL leg
    { name: 'RL_hip', parent: 'trunk', origin: [-0.1805, 0.047, 0] },
    { name: 'RL_thigh', parent: 'RL_hip', origin: [0, 0.0838, 0] },
    { name: 'RL_calf', parent: 'RL_thigh', origin: [0, 0, -0.2] },
    { name: 'RL_foot', parent: 'RL_calf', origin: [0, 0, -0.2] },
  ];

  const linkGroups = {};
  const jointPivots = {};

  const standAngles = {
    FR_thigh: 0.85,
    FL_thigh: 0.85,
    RR_thigh: 0.85,
    RL_thigh: 0.85,
    FR_calf: -1.8,
    FL_calf: -1.8,
    RR_calf: -1.8,
    RL_calf: -1.8,
  };

  for (const item of hierarchy) {
    const anchor = new THREE.Group();
    anchor.position.set(...item.origin);
    const pivot = new THREE.Group();
    anchor.add(pivot);
    const childGroup = new THREE.Group();
    pivot.add(childGroup);

    if (standAngles[item.name]) {
      pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), standAngles[item.name]);
    }

    if (item.parent === null) {
      rootGroup.add(anchor);
    } else {
      linkGroups[item.parent].add(anchor);
    }
    linkGroups[item.name] = childGroup;
    jointPivots[item.name] = pivot;
  }

  rootGroup.updateMatrixWorld(true);

  const initialWorldPositions = {};
  for (const item of hierarchy) {
    const wp = new THREE.Vector3();
    linkGroups[item.name].getWorldPosition(wp);
    initialWorldPositions[item.name] = wp.clone();
  }

  const explodeConfigs = {
    FR_hip:   { stage: 1, parent: 'trunk', offset: new THREE.Vector3(0.025, -0.075, 0.0) },
    FL_hip:   { stage: 1, parent: 'trunk', offset: new THREE.Vector3(0.025,  0.075, 0.0) },
    RR_hip:   { stage: 1, parent: 'trunk', offset: new THREE.Vector3(-0.025, -0.075, 0.0) },
    RL_hip:   { stage: 1, parent: 'trunk', offset: new THREE.Vector3(-0.025,  0.075, 0.0) },

    FR_thigh: { stage: 2, parent: 'FR_hip', offset: new THREE.Vector3(0.0, -0.055, 0.0) },
    FL_thigh: { stage: 2, parent: 'FL_hip', offset: new THREE.Vector3(0.0,  0.055, 0.0) },
    RR_thigh: { stage: 2, parent: 'RR_hip', offset: new THREE.Vector3(0.0, -0.055, 0.0) },
    RL_thigh: { stage: 2, parent: 'RL_hip', offset: new THREE.Vector3(0.0,  0.055, 0.0) },

    FR_calf:  { stage: 2, parent: 'FR_thigh', offset: new THREE.Vector3(0.0, -0.025, 0.0) },
    FL_calf:  { stage: 2, parent: 'FL_thigh', offset: new THREE.Vector3(0.0,  0.025, 0.0) },
    RR_calf:  { stage: 2, parent: 'RR_thigh', offset: new THREE.Vector3(0.0, -0.025, 0.0) },
    RL_calf:  { stage: 2, parent: 'RL_thigh', offset: new THREE.Vector3(0.0,  0.025, 0.0) },

    FR_foot:  { stage: 2, parent: 'FR_calf', offset: new THREE.Vector3(0.0, 0.0, -0.030) },
    FL_foot:  { stage: 2, parent: 'FL_calf', offset: new THREE.Vector3(0.0, 0.0, -0.030) },
    RR_foot:  { stage: 2, parent: 'RR_calf', offset: new THREE.Vector3(0.0, 0.0, -0.030) },
    RL_foot:  { stage: 2, parent: 'RL_calf', offset: new THREE.Vector3(0.0, 0.0, -0.030) },
  };

  function setExplode(factor) {
    factor = Math.max(0, Math.min(1, factor));
    const w1 = Math.min(1, factor / 0.5);
    const w2 = Math.max(0, Math.min(1, (factor - 0.3) / 0.7));

    for (const item of hierarchy) {
      const group = linkGroups[item.name];
      if (item.name === 'base' || item.name === 'trunk') {
        group.position.set(0, 0, 0);
        continue;
      }
      const cfg = explodeConfigs[item.name];
      if (!cfg) {
        group.position.set(0, 0, 0);
        continue;
      }
      const w = cfg.stage === 1 ? w1 : w2;
      group.position.set(cfg.offset.x * w, cfg.offset.y * w, cfg.offset.z * w);
    }
    rootGroup.updateMatrixWorld(true);
  }

  function getDiagnostics() {
    rootGroup.updateMatrixWorld(true);
    return hierarchy.map((item) => {
      const init = initialWorldPositions[item.name];
      const curr = new THREE.Vector3();
      linkGroups[item.name].getWorldPosition(curr);
      const cfg = explodeConfigs[item.name] || { stage: 1, parent: item.parent || 'none', offset: new THREE.Vector3(0, 0, 0) };
      return {
        unitId: `unit_${item.name}`,
        linkName: item.name,
        parentLink: item.parent || 'none',
        initialWorldPosition: { x: init.x, y: init.y, z: init.z },
        explodeOffset: { x: cfg.offset.x, y: cfg.offset.y, z: cfg.offset.z },
        finalWorldPosition: { x: curr.x, y: curr.y, z: curr.z },
      };
    });
  }

  return { rootGroup, linkGroups, initialWorldPositions, setExplode, getDiagnostics };
}

test('1. Trunk 作为固定锚点不参与平移', () => {
  const robot = createTestRobot();
  robot.setExplode(0.5);
  const p50 = new THREE.Vector3();
  robot.linkGroups['trunk'].getWorldPosition(p50);
  assert.ok(Math.abs(p50.x - robot.initialWorldPositions['trunk'].x) < 1e-6);
  assert.ok(Math.abs(p50.y - robot.initialWorldPositions['trunk'].y) < 1e-6);
  assert.ok(Math.abs(p50.z - robot.initialWorldPositions['trunk'].z) < 1e-6);

  robot.setExplode(1.0);
  const p100 = new THREE.Vector3();
  robot.linkGroups['trunk'].getWorldPosition(p100);
  assert.ok(Math.abs(p100.x - robot.initialWorldPositions['trunk'].x) < 1e-6);
  assert.ok(Math.abs(p100.y - robot.initialWorldPositions['trunk'].y) < 1e-6);
  assert.ok(Math.abs(p100.z - robot.initialWorldPositions['trunk'].z) < 1e-6);
});

test('2. 拆解方向优先使用水平外扩，禁止出现向上漂浮 (ΔY <= 0)', () => {
  const robot = createTestRobot();
  robot.setExplode(1.0);

  const units = ['trunk', 'FR_hip', 'FL_hip', 'RR_hip', 'RL_hip', 'FR_thigh', 'FL_thigh', 'RR_thigh', 'RL_thigh', 'FR_calf', 'FL_calf', 'RR_calf', 'RL_calf', 'FR_foot', 'FL_foot', 'RR_foot', 'RL_foot'];
  for (const name of units) {
    const init = robot.initialWorldPositions[name];
    const curr = new THREE.Vector3();
    robot.linkGroups[name].getWorldPosition(curr);
    const deltaY = curr.y - init.y;
    // deltaY 必须严格小于等于 0 (足端向下微抽，其余部件完全水平无垂直漂移)
    assert.ok(deltaY <= 1e-5, `${name} 不得向上漂浮，当前 deltaY=${deltaY}`);
  }
});

test('3. 四条腿先按腿根部整体拆开 (Stage 1)，再在二级拆解中展开 hip / thigh / calf / foot (Stage 2)', () => {
  const robot = createTestRobot();

  // 阶段 1 前期 (t = 0.25): 仅 Stage 1 展开，Stage 2 未启动 (w2 = 0)
  robot.setExplode(0.25);
  // FR_thigh 相对 FR_hip 的局部位置应保持为 0
  const thighLocal = robot.linkGroups['FR_thigh'].position;
  assert.ok(Math.abs(thighLocal.x) < 1e-6);
  assert.ok(Math.abs(thighLocal.y) < 1e-6);
  assert.ok(Math.abs(thighLocal.z) < 1e-6);

  // 但 FR_hip 已相对 trunk 水平外扩
  const hipLocal = robot.linkGroups['FR_hip'].position;
  assert.ok(Math.abs(hipLocal.y) > 0.02, 'FR_hip 应在外扩');

  // 阶段 2 (t = 1.0): Stage 1 与 Stage 2 均完全展开
  robot.setExplode(1.0);
  assert.ok(Math.abs(robot.linkGroups['FR_thigh'].position.y) > 0.04, 'FR_thigh 应完成二级横向抽离');
  assert.ok(Math.abs(robot.linkGroups['FR_calf'].position.y) > 0.02, 'FR_calf 应完成二级铰接横向抽离');
  assert.ok(Math.abs(robot.linkGroups['FR_foot'].position.z) > 0.02, 'FR_foot 应完成二级管口抽离');
});

test('4. 滑块从 0 → 100% → 0 来回拖动后，严格恢复初始位置 (误差 < 1e-9)', () => {
  const robot = createTestRobot();

  robot.setExplode(0.5);
  robot.setExplode(1.0);
  robot.setExplode(0.3);
  robot.setExplode(0.8);
  robot.setExplode(0.0);

  for (const [name, init] of Object.entries(robot.initialWorldPositions)) {
    const curr = new THREE.Vector3();
    robot.linkGroups[name].getWorldPosition(curr);
    const dist = curr.distanceTo(init);
    assert.ok(dist < 1e-9, `${name} 归位误差过大: ${dist}`);
  }
});

test('5. 能够正确输出每个拆解单元的初始/最终位置及 parentLink 诊断结构', () => {
  const robot = createTestRobot();
  robot.setExplode(1.0);
  const diag = robot.getDiagnostics();

  assert.equal(diag.length, 18);
  const trunkDiag = diag.find((d) => d.linkName === 'trunk');
  assert.ok(trunkDiag);
  assert.equal(trunkDiag.parentLink, 'base');

  const frHipDiag = diag.find((d) => d.linkName === 'FR_hip');
  assert.ok(frHipDiag);
  assert.equal(frHipDiag.parentLink, 'trunk');

  const frThighDiag = diag.find((d) => d.linkName === 'FR_thigh');
  assert.ok(frThighDiag);
  assert.equal(frThighDiag.parentLink, 'FR_hip');
});
