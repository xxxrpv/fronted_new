/** Optional maintainer audit against original inputs, never a startup/package dependency. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { captureModelPose } from '../components/v8/model-explode';

const directory = path.resolve('public/v8-assets');
const upstream = path.resolve(process.env.V8_GO2_SOURCE_DIR || '../../embodex-warehouse-demo/dist/assets/open-source-go2');
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
async function load(name: string) {
  const bytes = readFileSync(path.join(directory, `${name}.glb`));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { model: (await new GLTFLoader().parseAsync(buffer, '')).scene,
    report: readJson(path.join(directory, `${name}.json`)) };
}

function triangleTupleHash(meshes: THREE.Mesh[]) {
  const count = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count || mesh.geometry.attributes.position.count), 0);
  const tuples = new Float32Array(count * 6);
  let offset = 0;
  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal, index = mesh.geometry.index;
    assert(normals && normals.count === positions.count);
    const size = index?.count || positions.count;
    for (let i = 0; i < size; i++) {
      const v = index ? index.getX(i) : i;
      tuples[offset++] = positions.getX(v); tuples[offset++] = positions.getY(v); tuples[offset++] = positions.getZ(v);
      tuples[offset++] = normals.getX(v); tuples[offset++] = normals.getY(v); tuples[offset++] = normals.getZ(v);
    }
  }
  return hash(new Uint8Array(tuples.buffer));
}

describe('Optional original-source audit — requires upstream files', () => {
  test('all original Go2 manifest entries exist with exact bytes and SHA256', () => {
    const provenance = readJson(path.join(upstream, 'provenance.json'));
    assert.equal(provenance.files.length, 20);
    for (const entry of provenance.files) {
      const bytes = readFileSync(path.join(upstream, entry.path));
      assert.equal(bytes.length, entry.bytes, entry.path);
      assert.equal(hash(bytes), entry.sha256, entry.path);
    }
  });

  test('all 16 original OBJ triangle positions and normals match an independent OBJLoader parse', async () => {
    const { model, report } = await load('go2-high-fidelity');
    const actual = new Map<string, THREE.Mesh>();
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      let source: THREE.Object3D | null = node;
      while (source && !source.userData.sourceMesh) source = source.parent;
      if (source?.userData.sourceMesh && !actual.has(source.userData.sourceMesh)) actual.set(source.userData.sourceMesh, node);
    });
    assert.equal(actual.size, 16);
    for (const source of report.sourceStats) {
      const original = new OBJLoader().parse(readFileSync(path.join(upstream, 'assets', `${source.name}.obj`), 'utf8'));
      const expected: THREE.Mesh[] = [];
      original.traverse(node => { if (node instanceof THREE.Mesh) expected.push(node); });
      assert.equal(triangleTupleHash([actual.get(source.name)!]), triangleTupleHash(expected), source.name);
    }
  });

  test('original MJCF home footprint and right/rear geom quaternions survive coordinate conversion', async () => {
    const { model, report } = await load('go2-high-fidelity');
    const xml = readFileSync(path.join(upstream, 'go2.xml'), 'utf8');
    model.updateMatrixWorld(true);
    const pose = captureModelPose(model);
    const y = .27 - .426 * Math.cos(.9) + report.displayGroundOffset;
    for (const [leg, x, z] of [['FL', -.1934, .142], ['FR', -.1934, -.142], ['RL', .1934, .142], ['RR', .1934, -.142]] as const) {
      const foot = pose.assemblies.find(part => part.id === `${leg}_calf.foot`)!;
      assert(foot);
      assert(foot.node.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(x, y, z)) < 1e-8, leg);
    }
    const mapping = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(-1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1));
    for (const leg of ['FR', 'RL', 'RR']) {
      const section = xml.slice(xml.indexOf(`<body name="${leg}_hip"`));
      const geom = section.match(/<geom\s+mesh="hip_0"[^>]*>/)![0];
      const [w, x, y, z] = geom.match(/quat="([^"]+)"/)![1].split(/\s+/).map(Number);
      const expected = mapping.clone().multiply(new THREE.Quaternion(x, y, z, w).normalize());
      const actual = pose.assemblies.find(part => part.id === `${leg}_hip.hip_0`)!.node.getWorldQuaternion(new THREE.Quaternion());
      assert(Math.abs(Math.abs(expected.dot(actual)) - 1) < 1e-9, leg);
    }
  });

  test('mobile original source bytes match the retained provenance', () => {
    const provenance = readJson(path.join(directory, 'mobile-provenance.json'));
    const source = readFileSync(process.env.V8_MOBILE_SOURCE_FILE || path.resolve('../../../', provenance.sourceFile));
    assert.equal(hash(source), provenance.sourceSha256);
  });
});
