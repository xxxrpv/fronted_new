/** Preserve the detailed user-supplied AMR concept robot, without its business/physics controller.
 * Run: node --experimental-vm-modules scripts/convert-mobile-reference.mjs
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { encodeThreeGlb } from './encode-three-glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = path.resolve(here, '../../../../网站设计/EmbodiX官网-交付版/dist/cases/warehouse');
const output = path.resolve(here, '../public/v8-assets');
const sourceFile = path.join(reference, 'industrial-mobile.js');
const sourceBytes = await readFile(sourceFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const derivation = JSON.parse(await readFile(path.join(reference, 'assets/concept-model/DERIVATION.json'), 'utf8'));
const sourceRecord = derivation.runtimeFiles.find(item => path.resolve(reference, 'assets/concept-model', item.path).toLowerCase() === sourceFile.toLowerCase());
assert(sourceRecord, 'No supplied source hash record for industrial-mobile.js');
assert.equal(sha(sourceBytes), sourceRecord.sha256, 'Supplied mobile runtime differs from recorded source');
let fetchCalls = 0;
const context = vm.createContext({ console, performance, fetch: () => { fetchCalls++; throw new Error('Conversion prohibits network requests'); } });
const module = new vm.SourceTextModule(sourceBytes.toString('utf8'), { context, identifier: 'supplied-industrial-mobile' });
await module.link(specifier => { throw new Error(`Unexpected mobile source dependency ${specifier}`); });
await module.evaluate();
const project = module.namespace.createProject(THREE);
const root = project.robot;
root.name = 'AMR · supplied detailed mobile concept reference';
root.updateMatrixWorld(true);
const visible = node => { for (let item = node; item; item = item.parent) if (item.visible === false) return false; return true; };
const sensorNodes = new Set(project.sensors.map(sensor => sensor.node));
const parts = project.parts.map(part => {
  const node = part.node;
  assert(node?.isObject3D);
  const category = sensorNodes.has(node) ? 'perception' : part.kind === 'electrical' ? 'electrical' : part.kind === 'harness' ? 'electrical' : 'mechanical';
  node.userData = { ...node.userData, assemblyId: part.id, assemblyLabel: `${part.name} · 概念结构`, explodable: true, explodeDirection: part.offset.toArray(),
    part: part.id, category, sourceKind: 'concept-attachment', adjustable: false, engineeringValidated: false };
  // Camera housing and lens belong to this same original source part root.
  if (part.id === 'dock-camera') Object.assign(node.userData, { viewOffsetSupported: true, viewOffsetMax: .05, viewOffsetAxes: ['x', 'y', 'z'] });
  return { id: part.id, label: node.userData.assemblyLabel, originalLabel: part.name, category, sourceKind: node.userData.sourceKind, present: visible(node),
    description: part.description, parentLocalPosition: node.position.toArray(), parentLocalRotation: node.quaternion.toArray(), parentLocalScale: node.scale.toArray(), explodeDirection: part.offset.toArray() };
});
const sourceMeshes = [];
function visit(node, nodePath) {
  node.userData = { ...node.userData, sourceNodePath: nodePath };
  if (node.isMesh) {
    const positions = node.geometry.attributes.position;
    assert(positions?.count > 0);
    for (const value of positions.array) assert(Number.isFinite(value));
    sourceMeshes.push({ nodePath, name: node.name, visible: visible(node), vertices: positions.count, triangles: (node.geometry.index?.count || positions.count) / 3,
      matrixWorld: node.matrixWorld.toArray(), positionSha256: sha(Buffer.from(positions.array.buffer, positions.array.byteOffset, positions.array.byteLength)) });
  }
  node.children.forEach((child, index) => visit(child, `${nodePath}/${index}`));
}
visit(root, 'root');
const visibleMeshes = sourceMeshes.filter(mesh => mesh.visible);
const triangleInstances = visibleMeshes.reduce((sum, mesh) => sum + mesh.triangles, 0);
root.userData = { ...root.userData, sourceKind: 'supplied-concept-reference', sample: true, nativeCad: false, engineeringValidated: false,
  sensorAdjustmentSupported: false, sourceVisiblePartCount: parts.filter(part => part.present).length };
const notice = `Detailed AMR concept geometry from the user-provided EmbodiX official-site source, industrial-mobile.js.\nThe supplied file declares original concept geometry; it does not declare a separate SPDX redistribution license.\nReused under the user's explicit instruction for this implementation, with source attribution retained.\nThis output is not CC0, not Unitree geometry, not OEM CAD, and not validated hardware.\nNo source-author endorsement, manufacturing accuracy or global redistribution permission is inferred.\n`;
const source = { license: 'User-provided original concept source; no separate SPDX declaration', sourceKind: 'supplied-concept-reference',
  sourceFile: '网站设计/EmbodiX官网-交付版/dist/cases/warehouse/industrial-mobile.js', sourceSha256: sourceRecord.sha256,
  sample: true, nativeCad: false, engineeringValidation: 'not-performed', sourcePrecision: 'Retained actual procedural mesh attributes, material groups and captured source robot/part transforms; no decimation',
  configuration: 'Source initial robot structure only; business environment, physical test field and motion/controller code excluded' };
const { data, stats } = encodeThreeGlb(root, { copyright: 'User-provided EmbodiX official-site original AMR concept; see mobile-source-NOTICE.txt', licenseText: notice, source, includeHidden: false });
assert.equal(fetchCalls, 0);
assert.equal(stats.outputMeshCount, visibleMeshes.length);
assert.equal(stats.triangleInstances, triangleInstances);
const bounds = new THREE.Box3();
root.traverse(node => { if (node.isMesh && visible(node)) { node.geometry.computeBoundingBox(); bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld)); } });
const metadata = { name: 'AMR · 精细移动概念参考', fileName: 'mobile-reference.glb', url: '/v8-assets/mobile-reference.glb', mimeType: 'model/gltf-binary',
  size: data.length, sha256: sha(data), sourceKind: source.sourceKind, source: source.sourceFile, sourceSha256: sourceRecord.sha256, sourceHashVerified: true,
  license: '用户提供站点原创概念源（未单独声明 SPDX）', licenseUrl: '/v8-assets/mobile-source-NOTICE.txt', provenanceUrl: '/v8-assets/mobile-provenance.json',
  sourceTotalMeshes: sourceMeshes.length, sourceVisibleMeshes: visibleMeshes.length, sourceTotalTriangles: sourceMeshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
  sourceVisibleTriangles: triangleInstances, sourceCatalogParts: parts.length, visibleCatalogParts: parts.filter(part => part.present).length,
  ...stats, parts, sourceMeshes, viewOffsetAssemblies: [{ id: 'dock-camera', maxMetres: .05, axes: ['x', 'y', 'z'], scope: 'view-only shift of the actual source camera housing and lens group' }],
  bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() }, configuration: source.configuration,
  limitations: ['Original procedural concept, not a manufacturer CAD model or verified AMR product.', 'Detailed bearings, motor coils, reducers, electronics and harnesses are the actual source concept geometry; they do not certify hardware design.', 'No source material is silently relicensed as CC0 or BSD.', 'Only current visible robot geometry is exported; task environments, physics and business state are not model delivery.', 'Part movement and explosion are reversible viewing transforms; no native CAD or engineering validation.'] };
const provenance = { schema: 'embodex.supplied-mobile-reference/1', sourceKind: source.sourceKind, sourceFile: source.sourceFile, sourceSha256: sourceRecord.sha256,
  sourceBytes: sourceBytes.length, sourceHashVerified: true, declaredSourceAuthorship: 'Original AMR concept, authored for the local Embodex interactive example',
  license: 'No separate SPDX license declared in supplied original concept source', authorization: 'User explicitly requested reuse of the supplied official-site source for this implementation',
  conversion: { geometrySimplified: false, capturedSourceTransforms: true, sourceVisibleTriangleCountPreserved: true, sourceRobotOnly: true, fabricatedInternals: false },
  generatedFile: { name: metadata.fileName, size: metadata.size, sha256: metadata.sha256 }, sourceNoticeUrl: metadata.licenseUrl };
await mkdir(output, { recursive: true });
await writeFile(path.join(output, metadata.fileName), data);
await writeFile(path.join(output, 'mobile-reference.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(path.join(output, 'mobile-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
await writeFile(path.join(output, 'mobile-source-NOTICE.txt'), notice);
await writeFile(path.join(output, 'mobile-ATTRIBUTION.md'), `# 精细移动概念参考\n\n模型取自用户提供的 EmbodiX 官网交付源 industrial-mobile.js。原文件明确标识为原创 AMR 概念，尺寸、接触及硬件参数为简化设计试验，不是额定硬件数据。源文件 SHA-256：${sourceRecord.sha256}。\n\n按用户明确指示复用并保留来源，未将源代码或导出几何改标为 CC0/BSD；源文件没有另行声明通用 SPDX 许可。详见 mobile-source-NOTICE.txt 和 mobile-provenance.json。\n\n导出实际可见 robot 的 ${stats.outputMeshCount} 个 mesh、${triangleInstances} 个三角面实例、${metadata.visibleCatalogParts} 个源目录组件；保留驱动轮、轴承、绕组、减速器、举升、电池、电路板、线束与相机的真实源几何和捕获变换。没有复制任务家具、物理试验场或控制器，没有补造制造商内部结构。\n\n这是详细的原创概念模型，不是原厂工程模型、制造 BOM、装配验证或可制造性认证。只提供有效 GLB 与来源，不制造 STEP 或原生 CAD。\n`);
console.log(JSON.stringify({ fileName: metadata.fileName, bytes: metadata.size, sha256: metadata.sha256, sourceTotalMeshes: sourceMeshes.length,
  visibleMeshes: visibleMeshes.length, visibleCatalogParts: metadata.visibleCatalogParts, sourceTriangles: triangleInstances, ...stats, fetchCalls }, null, 2));
