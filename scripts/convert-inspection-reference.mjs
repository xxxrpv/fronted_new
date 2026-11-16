/** Preserve the supplied official inspection concept geometry. No website controller is shipped.
 * Run: node --experimental-vm-modules scripts/convert-inspection-reference.mjs
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { encodeThreeGlb } from './encode-three-glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = path.resolve(here, '../../../../网站设计/EmbodiX官网-交付版/dist/cases/warehouse');
const upstream = path.resolve(here, '../../../embodex-warehouse-demo/dist/assets/open-source-go2');
const output = path.resolve(here, '../public/v8-assets');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const derivation = JSON.parse(await readFile(path.join(reference, 'assets/concept-model/DERIVATION.json'), 'utf8'));
const licenseText = await readFile(path.join(reference, 'assets/concept-model/LICENSE'), 'utf8');
const checked = [];
async function verify(file, expected, label) {
  const bytes = await readFile(file);
  assert.equal(sha(bytes), expected, `Reference source hash mismatch: ${label}`);
  checked.push({ path: label, bytes: bytes.length, sha256: expected });
}
for (const item of derivation.sourceFiles) await verify(path.join(upstream, item.path), item.sha256, `upstream/${item.path}`);
await verify(path.join(reference, 'assets/concept-model/mesh-data.js'), derivation.output.sha256, 'official/assets/concept-model/mesh-data.js');
for (const item of derivation.runtimeFiles || []) await verify(path.resolve(reference, 'assets/concept-model', item.path), item.sha256, `official/${path.relative(reference, path.resolve(reference, 'assets/concept-model', item.path)).replaceAll('\\', '/')}`);

let fetchCalls = 0;
const context = vm.createContext({ console, atob, btoa, performance, TextEncoder, TextDecoder, fetch: () => { fetchCalls++; throw new Error('Conversion prohibits external requests'); } });
const three = new vm.SyntheticModule(Object.keys(THREE), function () { for (const key of Object.keys(THREE)) this.setExport(key, THREE[key]); }, { context, identifier: 'three' });
const cache = new Map();
async function moduleAt(file) {
  const absolute = path.resolve(reference, file);
  assert(absolute.toLowerCase().startsWith(reference.toLowerCase() + path.sep), 'Reference import escaped authorized directory');
  if (cache.has(absolute)) return cache.get(absolute);
  const module = new vm.SourceTextModule(await readFile(absolute, 'utf8'), { context, identifier: pathToFileURL(absolute).href });
  cache.set(absolute, module);
  return module;
}
const entry = await moduleAt('concept-platform.js');
await entry.link(async (specifier, parent) => {
  if (specifier === 'three') return three;
  assert(specifier.startsWith('./'), `Unexpected reference import ${specifier}`);
  return moduleAt(path.relative(reference, path.resolve(path.dirname(fileURLToPath(parent.identifier)), specifier.split('?')[0])));
});
await entry.evaluate();
const platform = await entry.namespace.ConceptQuadrupedPlatform.load();
const root = platform.group;
root.name = 'WD-01 · supplied inspection concept reference';
root.updateMatrixWorld(true);
const visible = node => { for (let item = node; item; item = item.parent) if (item.visible === false) return false; return true; };
const records = new Map(platform.records.map(record => [record.id, record]));
const parts = platform.getPartCatalog().map(part => {
  const node = platform.partRoots[part.id];
  assert(node, `Catalog part lacks actual source node: ${part.id}`);
  const present = visible(node);
  const sourceKind = part.sourceKind === 'concept_attachment' ? 'concept-attachment' : 'licensed-modified-visual-mesh';
  const perception = /attachment\.(rgb|thermal|depth|downward|optional-lidar|lidar-bracket)/.test(part.id);
  const category = perception ? 'perception' : part.category === 'electrical' ? 'electrical' : part.id.startsWith('base.') ? 'housing' : part.category;
  const direction = records.get(part.id)?.offset?.toArray() || [0, 0, 0];
  node.userData = { ...node.userData, assemblyId: part.id, assemblyLabel: `${part.name} · ${sourceKind === 'concept-attachment' ? '概念加装' : '网格参考'}`, explodable: true,
    explodeDirection: direction, part: part.id, category, sourceKind, adjustable: false, engineeringValidated: false };
  return { id: part.id, label: node.userData.assemblyLabel, originalLabel: part.name, category, sourceKind, present, sourceCatalogKind: part.sourceKind,
    parentLocalPosition: node.position.toArray(), parentLocalRotation: node.quaternion.toArray(), parentLocalScale: node.scale.toArray(), explodeDirection: direction };
});
// This is an existing source Group containing bracket, both camera heads and lenses.
// Move the whole concept assembly, never a shell alone or an unverified OEM sensor.
platform.cameraAssembly.name = '巡检双传感器总成';
platform.cameraAssembly.userData = { ...platform.cameraAssembly.userData, assemblyId: 'inspection.camera-assembly', assemblyLabel: '巡检双传感器总成 · 概念加装',
  explodable: true, explodeDirection: [0, 0, 0], part: 'inspection.camera-assembly', category: 'perception', sourceKind: 'concept-attachment',
  viewOffsetSupported: true, viewOffsetMax: .05, viewOffsetAxes: ['x', 'y', 'z'], adjustable: false, engineeringValidated: false };
const sourceMeshes = [];
function visit(node, nodePath) {
  node.userData = { ...node.userData, sourceNodePath: nodePath };
  if (node.isMesh) {
    const positions = node.geometry.attributes.position;
    assert(positions?.count > 0);
    for (const value of positions.array) assert(Number.isFinite(value));
    const triangles = (node.geometry.index?.count || positions.count) / 3;
    sourceMeshes.push({ nodePath, sourcePart: node.userData.part || '', sourceMesh: node.userData.sourceMesh || '', sourceKind: node.userData.sourceKind || '', visible: visible(node), vertices: positions.count, triangles,
      matrixWorld: node.matrixWorld.toArray(), positionSha256: sha(Buffer.from(positions.array.buffer, positions.array.byteOffset, positions.array.byteLength)) });
  }
  node.children.forEach((child, index) => visit(child, `${nodePath}/${index}`));
}
visit(root, 'root');
const sourceVisible = sourceMeshes.filter(item => item.visible);
const sourceTriangleInstances = sourceVisible.reduce((sum, mesh) => sum + mesh.triangles, 0);
root.userData = { ...root.userData, sourceKind: 'licensed-concept-reference', sourceCommit: derivation.sourceCommit,
  sample: true, nativeCad: false, engineeringValidated: false, sensorAdjustmentSupported: false, sourceVisiblePartCount: parts.filter(part => part.present).length };
const source = { license: 'BSD-3-Clause source visual meshes; supplied concept attachments separately attributed', sourceCommit: derivation.sourceCommit,
  sourceRepository: derivation.sourceRepository, sourceKind: root.userData.sourceKind, sourceModel: 'ConceptQuadrupedPlatform',
  originalSourceGeometry: false, sample: true, nativeCad: false, engineeringValidation: 'not-performed',
  configuration: 'Official source default standing configuration, attachments enabled, optional top lidar disabled, hypothetical payload hidden' };
const { data, stats } = encodeThreeGlb(root, { copyright: derivation.copyright, licenseText, source, includeHidden: false });
assert.equal(fetchCalls, 0);
assert.equal(stats.outputMeshCount, sourceVisible.length);
assert.equal(stats.triangleInstances, sourceTriangleInstances, 'Conversion changed visible triangle count');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'inspection-reference.glb'), data);
await copyFile(path.join(reference, 'assets/concept-model/LICENSE'), path.join(output, 'inspection-LICENSE.txt'));
await copyFile(path.join(reference, 'assets/concept-model/DERIVATION.json'), path.join(output, 'inspection-source-DERIVATION.json'));
const bounds = new THREE.Box3();
root.traverse(node => { if (node.isMesh && visible(node)) { node.geometry.computeBoundingBox(); bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld)); } });
const metadata = { name: 'WD-01 · 巡检概念参考', fileName: 'inspection-reference.glb', url: '/v8-assets/inspection-reference.glb', mimeType: 'model/gltf-binary', size: data.length, sha256: sha(data),
  license: 'BSD-3-Clause（来源网格）/ 用户提供站点的概念加装组件', licenseUrl: '/v8-assets/inspection-LICENSE.txt', provenanceUrl: '/v8-assets/inspection-provenance.json',
  sourceKind: source.sourceKind, sourceCommit: derivation.sourceCommit, sourceRepository: derivation.sourceRepository, sourceHashVerified: true,
  sourceFilesVerified: checked.length, sourceTotalMeshes: sourceMeshes.length, sourceVisibleMeshes: sourceVisible.length, sourceTotalTriangles: sourceMeshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
  sourceVisibleTriangles: sourceTriangleInstances, sourceCatalogParts: parts.length, visibleCatalogParts: parts.filter(part => part.present).length, sourceJoints: platform.joints.length,
  ...stats, parts, sourceMeshes, viewOffsetAssemblies: [{ id: 'inspection.camera-assembly', sourceNodePath: platform.cameraAssembly.userData.sourceNodePath, maxMetres: .05, axes: ['x', 'y', 'z'], scope: 'view-only movement of the actual source parent group, including both camera modules and lenses' }], bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() }, configuration: source.configuration,
  limitations: ['Modified licensed visual geometry, not an unchanged OEM model or manufacturer BOM.', 'Inspection optics, electronics and mounts are supplied procedural concept additions, not verified hardware or CAD.', 'Invisible optional lidar, its bracket and the hypothetical payload are excluded from the exported default configuration.', 'Source geometry, material groups and captured static hierarchy transforms are retained; no decimation or independent centering.', 'This GLB contains no motion controller, physics solver, native CAD, manufacturing tolerance or engineering validation.'] };
const provenance = { schema: 'embodex.supplied-inspection-reference/1', sourceRoot: '网站设计/EmbodiX官网-交付版/dist/cases/warehouse', upstreamRepository: derivation.sourceRepository,
  upstreamCommit: derivation.sourceCommit, sourceDirectory: derivation.sourceDirectory, copyright: derivation.copyright,
  sourceMeshLicense: 'BSD-3-Clause', licenseScope: 'The retained source visual meshes keep the complete upstream license. Procedural inspection additions are taken from the user-provided official-site source; no separate SPDX license was declared for those additions.',
  originalDerivationRecord: '/v8-assets/inspection-source-DERIVATION.json', sourceFiles: checked, generatedFile: { name: metadata.fileName, size: metadata.size, sha256: metadata.sha256 },
  conversion: { geometrySimplified: false, capturedSourceTransforms: true, sourceVisibleTriangleCountPreserved: true, skippedInvisibleNodes: true, fabricatedInternals: false, configuration: source.configuration },
  attribution: 'Original Unitree Robotics geometry distributed through Google DeepMind MuJoCo Menagerie; modified official inspection concept supplied by the user. No source-author endorsement is implied.' };
await writeFile(path.join(output, 'inspection-reference.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(path.join(output, 'inspection-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
await writeFile(path.join(output, 'inspection-ATTRIBUTION.md'), `# WD-01 巡检概念参考\n\n模型取自用户提供的 EmbodiX 官网交付源代码。底层四足网格是 Unitree Robotics / Google DeepMind MuJoCo Menagerie 的 BSD-3-Clause 许可衍生版本，固定提交 ${derivation.sourceCommit}。许可全文见 inspection-LICENSE.txt；原修改记录见 inspection-source-DERIVATION.json。\n\n巡检相机、热像模块、近距感知、计算、电气及安装件是该站点提供的概念加装几何，不是制造商原装结构或已验证设备。未将这些组件改标为 CC0。当前导出保留默认站立配置，排除隐藏的可选雷达、支架和假设载荷。\n\n已逐项核验 ${checked.length} 个来源文件；导出 ${stats.outputMeshCount} 个可见 mesh、${sourceTriangleInstances} 个三角面实例、${metadata.visibleCatalogParts} 个实际可见目录组件。原始构造器包含 ${sourceMeshes.length} 个 mesh 和 ${parts.length} 个目录组件，差异为明确隐藏的配置。保留当前位置、朝向、缩放、材料分组和网格精度，未减面；不携带网站运动/物理控制器。\n\n这是一份细节丰富的可视化/结构参考，不是原生 CAD、完整制造 BOM、安装认证或工程验证。拆解只对文件中的实际组件进行可逆平移，不补造来源没有证实的内部硬件。\n`);
platform.dispose();
console.log(JSON.stringify({ fileName: metadata.fileName, bytes: metadata.size, sha256: metadata.sha256, sourceFilesVerified: checked.length, sourceTotalMeshes: sourceMeshes.length,
  visibleMeshes: sourceVisible.length, visibleCatalogParts: metadata.visibleCatalogParts, sourceTriangles: sourceTriangleInstances, ...stats, fetchCalls }, null, 2));
