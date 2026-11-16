/** Read-only audit of the supplied official-site runtime. Run: node --experimental-vm-modules test/reference-runtime-audit.mjs */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as THREE from 'three';

const root = path.resolve('../../../网站设计/EmbodiX官网-交付版/dist/cases/warehouse');
const original = path.resolve('../../embodex-warehouse-demo/dist/assets/open-source-go2');
const output = path.resolve('test-results/reference-runtime-audit.json');
const report = { mode: 'read-only supplied-source runtime; no renderer or production backend', root, startedAt: new Date().toISOString(), files: [], models: [], errors: [], interactionWarnings: [], fetchCalls: 0 };
const context = vm.createContext({ console, atob, btoa, performance, TextEncoder, TextDecoder, fetch: () => { report.fetchCalls++; throw new Error('Audit prohibits network fetch'); } });
const three = new vm.SyntheticModule(Object.keys(THREE), function () { for (const name of Object.keys(THREE)) this.setExport(name, THREE[name]); }, { context, identifier: 'three' });
const cache = new Map();
async function load(file) {
  const absolute = path.resolve(root, file);
  assert(absolute.toLowerCase().startsWith(root.toLowerCase() + path.sep), 'module escaped supplied reference root');
  if (cache.has(absolute)) return cache.get(absolute);
  const source = await readFile(absolute, 'utf8');
  const module = new vm.SourceTextModule(source, { context, identifier: pathToFileURL(absolute).href });
  cache.set(absolute, module);
  return module;
}
async function namespace(file) {
  const module = await load(file);
  if (module.status === 'unlinked') await module.link(async (specifier, referencing) => {
    if (specifier === 'three') return three;
    assert(specifier.startsWith('./'), `unexpected dependency ${specifier}`);
    const absolute = path.resolve(path.dirname(fileURLToPath(referencing.identifier)), specifier.split('?')[0]);
    return load(path.relative(root, absolute));
  });
  if (module.status !== 'evaluated') await module.evaluate();
  return module.namespace;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function checkFile(label, file, expectedHash) {
  try {
    const bytes = await readFile(file);
    const actualHash = hash(bytes), ok = !expectedHash || actualHash === expectedHash;
    report.files.push({ label, file, bytes: bytes.length, sha256: actualHash, hashMatches: ok });
    assert(ok, `hash mismatch ${label}`);
  } catch (error) { report.errors.push(`${label}: ${error.message}`); }
}
function meshStats(model) {
  const stats = { meshes: 0, vertices: 0, triangles: 0, invalidPositions: 0, invalidIndices: 0, invalidMaterialGroups: 0, emptyMeshes: 0 };
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if (!node.isMesh) return;
    stats.meshes++;
    const geometry = node.geometry, positions = geometry.getAttribute('position');
    if (!positions?.count) { stats.emptyMeshes++; return; }
    stats.vertices += positions.count;
    for (const value of positions.array) if (!Number.isFinite(value)) stats.invalidPositions++;
    const index = geometry.getIndex();
    stats.triangles += (index ? index.count : positions.count) / 3;
    if (index) for (const value of index.array) if (!Number.isInteger(value) || value < 0 || value >= positions.count) stats.invalidIndices++;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const group of geometry.groups) if ((Array.isArray(node.material) && (group.materialIndex || 0) >= materials.length) || group.start < 0 || group.count < 0 || group.start + group.count > (index?.count || positions.count)) stats.invalidMaterialGroups++;
  });
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  return { ...stats, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: size.toArray() } };
}

try {
  const derivation = JSON.parse(await readFile(path.join(root, 'assets/concept-model/DERIVATION.json'), 'utf8'));
  for (const source of derivation.sourceFiles) await checkFile(`upstream:${source.path}`, path.join(original, source.path), source.sha256);
  await checkFile('official frozen mesh-data', path.join(root, 'assets/concept-model/mesh-data.js'), derivation.output.sha256);
  for (const file of derivation.runtimeFiles || []) await checkFile(`official runtime:${file.path}`, path.resolve(root, 'assets/concept-model', file.path), file.sha256);
  const xml = await readFile(path.join(original, 'go2.xml'), 'utf8');
  const visualGeoms = [...xml.matchAll(/<geom\b[^>]*>/g)].map(match => match[0]).filter(tag => /class="visual"/.test(tag));
  const home = xml.match(/<key\s+name="home"\s+qpos="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
  report.mjcf = { uniqueObjAssets: [...xml.matchAll(/<mesh\s+file="([^"]+)"/g)].length, visualGeomInstances: visualGeoms.length, namedJoints: [...xml.matchAll(/<joint\s+name="([^"]+)"/g)].map(match => match[1]), freeJoints: [...xml.matchAll(/<freejoint\s*\//g)].length, homeQpos: home, quaternionConvention: 'w x y z; source Z-up' };
  assert.equal(report.mjcf.uniqueObjAssets, 16);
  assert.equal(report.mjcf.visualGeomInstances, 33);
  assert.equal(report.mjcf.namedJoints.length, 12);
  assert.equal(home.length, 19);
  const entries = [
    ['licensed reference', 'concept-model.js', ns => ns.ConceptQuadrupedReference.load()],
    ['licensed inspection quadruped', 'concept-platform.js', ns => ns.ConceptQuadrupedPlatform.load()],
    ['original humanoid concept', 'humanoid-platform.js', ns => ns.HumanoidPlatform.load()],
    ['original industrial arm concept', 'industrial-arm.js', ns => ns.createProject(THREE)],
    ['original mobile concept', 'industrial-mobile.js', ns => ns.createProject(THREE)],
    ['original aerial concept', 'industrial-aerial.js', ns => ns.createProject(THREE)],
  ];
  for (const [name, file, construct] of entries) {
    let instance;
    try {
      instance = await construct(await namespace(file));
      const model = instance.group || instance.robot;
      assert(model?.isObject3D);
      const stats = meshStats(model);
      assert(stats.meshes > 0 && !stats.emptyMeshes && !stats.invalidPositions && !stats.invalidIndices && !stats.invalidMaterialGroups, `${name}: invalid source geometry ${JSON.stringify(stats)}`);
      const catalog = instance.getPartCatalog?.() || instance.catalog || instance.parts || [];
      const ids = catalog.map(part => part.id), duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      const missingRoots = catalog.filter(part => !(instance.partRoots?.[part.id] || part.node)).map(part => part.id);
      assert.equal(duplicates.length, 0, `${name}: duplicate catalog ids`);
      assert.equal(missingRoots.length, 0, `${name}: missing catalog part roots`);
      const sensors = instance.sensors?.map(item => ({ name: item.name, keys: Object.keys(item) })) || [];
      const item = { name, file, ...stats, catalogCount: catalog.length, duplicateIds: duplicates, missingRoots, joints: instance.joints?.length || 0, sensorAnchors: Object.keys(instance.sensorAnchors || {}), sensors, explosion: 'source controller uses these same part nodes and offsets' };
      if (instance.setExplode) {
        const roots = Object.values(instance.partRoots || {}), originalPositions = roots.map(node => node.position.clone());
        instance.setExplode(1);
        item.movedRoots = roots.filter((node, index) => node.position.distanceTo(originalPositions[index]) > 1e-9).length;
        instance.setExplode(0);
        item.restoreError = Math.max(0, ...roots.map((node, index) => node.position.distanceTo(originalPositions[index])));
        if (name === 'licensed reference') item.explosion = 'Reference base class is intentionally a no-op; ConceptQuadrupedPlatform owns explosion';
        else {
          assert(item.movedRoots > 0, `${name}: no actual part roots moved`);
          if (item.restoreError > 1e-9) report.interactionWarnings.push({ name, detail: 'Direct setExplode(1) then (0) does not restore the initially posed local part transforms; source controller update sequencing or a captured-transform adapter is required.', restoreError: item.restoreError });
        }
      }
      report.models.push(item);
    } catch (error) { report.errors.push(`${name}: ${error.stack || error.message}`); }
    finally { instance?.dispose?.(); }
  }
  assert.equal(report.fetchCalls, 0);
} catch (error) { report.errors.push(error.stack || String(error)); }
report.finishedAt = new Date().toISOString();
report.summary = { verifiedFiles: report.files.filter(file => file.hashMatches).length, missingOrHashMismatch: report.files.filter(file => !file.hashMatches).length, models: report.models.length, interactionWarnings: report.interactionWarnings.length, errors: report.errors.length, assetIntegrityPass: report.errors.length === 0 };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary: report.summary, mjcf: report.mjcf, models: report.models.map(({ name, meshes, vertices, triangles, catalogCount, movedRoots, restoreError }) => ({ name, meshes, vertices, triangles, catalogCount, movedRoots, restoreError })), errors: report.errors, interactionWarnings: report.interactionWarnings }, null, 2));
if (!report.summary.assetIntegrityPass) process.exitCode = 1;
