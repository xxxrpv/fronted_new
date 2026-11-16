import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { validateGlbSecurity } from '../lib/equipment/glb-security';
import { captureModelPose, applyModelPose } from '../components/v8/model-explode';

const directory = path.resolve('public/v8-assets');
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const arrayBuffer = (value: Buffer) => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
async function load(name: string) {
  const bytes = readFileSync(path.join(directory, `${name}.glb`));
  validateGlbSecurity(arrayBuffer(bytes));
  return { bytes, model: (await new GLTFLoader().parseAsync(arrayBuffer(bytes), '')).scene,
    report: readJson(path.join(directory, `${name}.json`)), json: JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) };
}
describe('Detailed references: actual source precision, attribution and geometry round trip', () => {
  for (const name of ['inspection-reference', 'mobile-reference']) {
    test(`${name}: self-contained real geometry, exact retained visible triangles and source hashes`, async () => {
      const { bytes, model, report, json } = await load(name);
      assert.equal(bytes.length, report.size);
      assert.equal(hash(bytes), report.sha256);
      assert.equal(report.sourceHashVerified, true);
      assert.equal(json.extras.nativeCad, false);
      assert.equal(json.extras.engineeringValidation, 'not-performed');
      assert(json.buffers.every((buffer: { uri?: string }) => !buffer.uri));
      assert(json.asset.extras.licenseText.length > 100);
      const nodes = new Map<string, THREE.Object3D>();
      model.updateMatrixWorld(true);
      model.traverse(node => { if (node.userData.sourceNodePath) nodes.set(node.userData.sourceNodePath, node); });
      for (const source of report.sourceMeshes.filter((mesh: { visible: boolean }) => mesh.visible)) {
        const node = nodes.get(source.nodePath);
        assert(node, `${name} missing source node ${source.nodePath}`);
        node.matrixWorld.toArray().forEach((value, index) => assert(Math.abs(value - source.matrixWorld[index]) < 1e-8, `${name} changed source transform ${source.nodePath}`));
        const mesh = node instanceof THREE.Mesh ? node : node.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
        assert(mesh instanceof THREE.Mesh);
        const positions = mesh.geometry.attributes.position;
        assert.equal(hash(new Uint8Array(positions.array.buffer, positions.array.byteOffset, positions.array.byteLength)), source.positionSha256, `${name} changed source vertices ${source.nodePath}`);
      }
      let triangles = 0;
      model.traverse(node => { if (node instanceof THREE.Mesh) triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3; });
      assert.equal(triangles, report.sourceVisibleTriangles);
      const pose = captureModelPose(model), original = pose.entries.map(entry => ({ node: entry.node, position: entry.node.position.toArray(), rotation: entry.node.quaternion.toArray(), scale: entry.node.scale.toArray() }));
      for (let i = 0; i < 20; i++) { applyModelPose(pose, 1, 0); applyModelPose(pose, .2, 0); }
      applyModelPose(pose, 0, 0);
      for (const entry of original) { assert.deepEqual(entry.node.position.toArray(), entry.position); assert.deepEqual(entry.node.quaternion.toArray(), entry.rotation); assert.deepEqual(entry.node.scale.toArray(), entry.scale); }
    });
  }

  test('inspection source license and mixed concept attachments remain distinguished', async () => {
    const { report, json } = await load('inspection-reference');
    const provenance = readJson(path.join(directory, 'inspection-provenance.json'));
    assert.equal(provenance.sourceFiles.length, 39);
    assert.equal(report.sourceTotalMeshes, 186);
    assert.equal(report.sourceVisibleMeshes, 183);
    assert.equal(report.sourceCatalogParts, 57);
    assert.equal(report.visibleCatalogParts, 55);
    assert.equal(report.sourceVisibleTriangles, 410641);
    assert(json.asset.extras.licenseText.includes('Unitree Robotics'));
    assert(report.parts.some((part: { sourceKind: string }) => part.sourceKind === 'licensed-modified-visual-mesh'));
    assert(report.parts.some((part: { sourceKind: string }) => part.sourceKind === 'concept-attachment'));
    assert(report.parts.filter((part: { present: boolean }) => !part.present).every((part: { id: string }) => /optional-lidar|lidar-bracket/.test(part.id)));
  });

  test('mobile original concept is not silently relicensed as CC0/BSD or labelled OEM', async () => {
    const { report, json } = await load('mobile-reference');
    const provenance = readJson(path.join(directory, 'mobile-provenance.json'));
    assert.match(provenance.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.sourceTotalMeshes, 457);
    assert.equal(report.sourceVisibleTriangles, 52404);
    assert.equal(report.visibleCatalogParts, 44);
    assert.match(json.asset.extras.licenseText, /does not declare a separate SPDX/);
    assert.notEqual(json.extras.license, 'CC0-1.0');
    assert.notEqual(json.extras.license, 'BSD-3-Clause');
  });

  test('view-offset capabilities exist only on actual concept camera parent groups', async () => {
    const expected: Record<string, string[]> = { 'go2-high-fidelity': [], 'inspection-reference': ['inspection.camera-assembly'], 'mobile-reference': ['dock-camera'] };
    for (const [name, ids] of Object.entries(expected)) {
      const { model } = await load(name);
      const editable: string[] = [];
      model.traverse(node => {
        if (!node.userData.viewOffsetSupported) return;
        assert.equal(node.userData.sourceKind, 'concept-attachment');
        assert.equal(node.userData.viewOffsetMax, .05);
        assert.deepEqual(node.userData.viewOffsetAxes, ['x', 'y', 'z']);
        assert(node.children.length > 0);
        editable.push(node.userData.assemblyId);
      });
      assert.deepEqual(editable, ids);
    }
  });
});
