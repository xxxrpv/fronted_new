/** Exact OBJ/MJCF conversion. No decimation, centring individual meshes, or invented internal parts. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../../embodex-warehouse-demo/dist/assets/open-source-go2');
const output = path.resolve(here, '../public/v8-assets');
await mkdir(output, { recursive: true });
const provenance = JSON.parse(await readFile(path.join(source, 'provenance.json'), 'utf8'));
const licenseText = await readFile(path.join(source, 'LICENSE'), 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const record of provenance.files) {
  const data = await readFile(path.join(source, record.path));
  if (data.length !== record.bytes || sha(data) !== record.sha256) throw new Error(`Source hash mismatch: ${record.path}`);
}
const xml = await readFile(path.join(source, 'go2.xml'), 'utf8');
function parseXml(input) {
  const root = { name: '#document', attrs: {}, children: [] }, stack = [root];
  for (const match of input.matchAll(/<!--[\s\S]*?-->|<([^>]+)>/g)) {
    if (match[0].startsWith('<!--')) continue;
    const token = match[1].trim();
    if (token.startsWith('?') || token.startsWith('!')) continue;
    if (token.startsWith('/')) { stack.pop(); continue; }
    const name = token.match(/^([^\s/]+)/)?.[1];
    const attrs = Object.fromEntries([...token.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(item => [item[1], item[2]]));
    const node = { name, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!token.endsWith('/')) stack.push(node);
  }
  return root.children[0];
}
const tree = parseXml(xml);
const child = (node, name) => node.children.find(item => item.name === name);
const values = (input, fallback) => input ? input.trim().split(/\s+/).map(Number) : fallback;
const quat = input => { const [w,x,y,z] = values(input, [1,0,0,0]); return new THREE.Quaternion(x,y,z,w).normalize(); };
const home = values(child(child(tree, 'keyframe'), 'key').attrs.qpos);
const geometryCache = new Map(), sourceStats = [];

function parseObj(input, name) {
  const positions = [], normals = [], packed = [], packedNormals = [], indices = [], unique = new Map();
  let sourceTriangles = 0;
  const add = field => {
    if (unique.has(field)) return unique.get(field);
    const [position, , normal] = field.split('/').map(Number);
    const pi = position > 0 ? position - 1 : positions.length / 3 + position;
    const ni = normal > 0 ? normal - 1 : normals.length / 3 + normal;
    if (!Number.isInteger(pi) || pi < 0 || pi * 3 + 2 >= positions.length || !Number.isInteger(ni) || ni < 0 || ni * 3 + 2 >= normals.length) throw new Error(`Invalid source face ${name}: ${field}`);
    const index = packed.length / 3;
    packed.push(...positions.slice(pi * 3, pi * 3 + 3));
    packedNormals.push(...normals.slice(ni * 3, ni * 3 + 3));
    unique.set(field, index);
    return index;
  };
  for (const line of input.split(/\r?\n/)) {
    if (line.startsWith('v ')) positions.push(...line.slice(2).trim().split(/\s+/).map(Number));
    else if (line.startsWith('vn ')) normals.push(...line.slice(3).trim().split(/\s+/).map(Number));
    else if (line.startsWith('f ')) {
      const fields = line.slice(2).trim().split(/\s+/);
      for (let i=1;i<fields.length-1;i++) { indices.push(add(fields[0]), add(fields[i]), add(fields[i+1])); sourceTriangles++; }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(packed, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(packedNormals, 3));
  geometry.setIndex(packed.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices,1) : new THREE.Uint16BufferAttribute(indices,1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  sourceStats.push({ name, sourceVertices: positions.length / 3, retainedVertexTuples: packed.length / 3, triangles: sourceTriangles, sourceNormals: normals.length / 3 });
  return geometry;
}
for (const mesh of child(tree,'asset').children.filter(item => item.name === 'mesh')) {
  const name = mesh.attrs.name || path.parse(mesh.attrs.file).name;
  geometryCache.set(name, parseObj(await readFile(path.join(source,'assets',mesh.attrs.file),'utf8'), name));
}
const appearance = {
  metal: { color: '#a8b5bd', metalness: .72, roughness: .28 },
  black: { color: '#171c23', metalness: .15, roughness: .43 },
  white: { color: '#edf0f2', metalness: .12, roughness: .32 },
  gray: { color: '#b9c3cd', metalness: .32, roughness: .36 },
};
const materials = Object.fromEntries(Object.entries(appearance).map(([name, config]) => { const material = new THREE.MeshStandardMaterial(config); material.name = name; return [name, material]; }));
const model = new THREE.Group(); model.name = 'Unitree Go2 · exact source visual mesh reference';
model.userData = { sample: true, sourceKind: 'licensed-original-mesh-conversion', sourceCommit: provenance.source_commit, engineeringValidation: 'not-performed', nativeCad: false, sensorAdjustmentSupported: false };
const coordinates = new THREE.Group(); coordinates.name = 'MJCF-Z-up_to_Web-Y-up';
coordinates.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(-1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1));
model.add(coordinates);
const visualRecords = [], joints = [], sideNames = { FL:'左前', FR:'右前', RL:'左后', RR:'右后' };
let jointIndex = 0;
function visualInfo(bodyName, meshName) {
  const leg = bodyName.slice(0,2), side = sideNames[leg];
  if (bodyName === 'base') {
    const i = Number(meshName.slice(-1));
    return { id: `base.${meshName}`, label: `机身可视分件 ${String(i+1).padStart(2,'0')} · ${meshName}`, category: i === 2 ? 'perception' : 'housing', globalOffset: new THREE.Vector3(i === 2 ? .15 : (i-2)*.028, 0, .07+i*.075) };
  }
  const category = meshName === 'foot' ? 'foot' : bodyName.endsWith('_hip') ? 'hip' : bodyName.endsWith('_thigh') ? 'thigh' : 'calf';
  const suffix = meshName === 'foot' ? '' : ` ${meshName.endsWith('_0') ? 'A' : 'B'}`;
  const label = `${side}${({hip:'髋部',thigh:'上腿',calf:'小腿',foot:'足端'})[category]}可视分件${suffix}`;
  const lateral = leg.endsWith('L') ? 1 : -1, fore = leg.startsWith('F') ? 1 : -1;
  const segmentOffset = { hip:.10, thigh:.14, calf:.18, foot:.22 }[category];
  const layer = meshName.endsWith('_1') ? .10 : 0;
  return { id:`${bodyName}.${meshName}`, label, category, globalOffset:new THREE.Vector3(fore * .025, lateral * (segmentOffset+layer), category==='foot' ? -.13 : category==='calf' ? -.055 : .015) };
}
function buildBody(sourceBody, parent) {
  const body = new THREE.Group(); body.name = sourceBody.attrs.name;
  body.position.fromArray(values(sourceBody.attrs.pos,[0,0,0]));
  body.quaternion.copy(quat(sourceBody.attrs.quat));
  if (body.name === 'base') { body.position.fromArray(home.slice(0,3)); body.quaternion.copy(new THREE.Quaternion(home[4],home[5],home[6],home[3])); }
  const joint = child(sourceBody,'joint');
  if (joint) {
    const axis = new THREE.Vector3(...values(joint.attrs.axis, joint.attrs.class === 'abduction' ? [1,0,0] : [0,1,0])).normalize();
    const angle = home[7+jointIndex++];
    body.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis,angle));
    body.userData = { sourceJoint:joint.attrs.name, sourceJointAxis:axis.toArray(), sourceHomeAngle:angle, sourceBody:body.name };
    joints.push({ name:joint.attrs.name, body:body.name, axis:axis.toArray(), angle });
  }
  parent.add(body);
  for (const geom of sourceBody.children.filter(item => item.name === 'geom' && item.attrs.class === 'visual')) {
    if (!geometryCache.has(geom.attrs.mesh)) throw new Error(`Missing mesh ${geom.attrs.mesh}`);
    const part = new THREE.Group(); const info = visualInfo(body.name,geom.attrs.mesh);
    part.name=info.id; part.position.fromArray(values(geom.attrs.pos,[0,0,0])); part.quaternion.copy(quat(geom.attrs.quat));
    part.userData = { assemblyId:info.id, assemblyLabel:info.label, explodable:true, sourceBody:body.name, sourceMesh:geom.attrs.mesh, category:info.category, part:info.id, precision:'original-source-visual-mesh', adjustable:false };
    const mesh = new THREE.Mesh(geometryCache.get(geom.attrs.mesh), materials[geom.attrs.material]);
    mesh.name=`${info.id}.mesh`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={ sourceMesh:geom.attrs.mesh, sourceBody:body.name, part:info.id, category:info.category };
    part.add(mesh);body.add(part);visualRecords.push({part,body,info,material:geom.attrs.material});
  }
  for (const bodyChild of sourceBody.children.filter(item => item.name === 'body')) buildBody(bodyChild,body);
}
buildBody(child(child(tree,'worldbody'),'body'),coordinates);
model.updateMatrixWorld(true);
for (const {part,body,info} of visualRecords) {
  // explodeDirection is in the visual parent's local coordinate frame.
  const desiredWorld=info.globalOffset.clone().applyQuaternion(coordinates.quaternion);
  part.userData.explodeDirection=desiredWorld.applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()).invert()).toArray();
}
const rawBounds=new THREE.Box3().setFromObject(model);
const displayGroundOffset=-rawBounds.min.y;
coordinates.position.y=displayGroundOffset;
model.updateMatrixWorld(true);
const bounds=new THREE.Box3().setFromObject(model);

function exportGlb(root) {
  const views=[], accessors=[], nodes=[], meshes=[], buffers=[], geometryIndices=new Map(), meshIndices=new Map();let byteLength=0;
  const materialList=Object.values(materials);
  const append=(array,target)=>{const data=Buffer.from(array.buffer,array.byteOffset,array.byteLength),index=views.length;views.push({buffer:0,byteOffset:byteLength,byteLength:data.length,target});buffers.push(data);byteLength+=data.length;const pad=(4-byteLength%4)%4;if(pad){buffers.push(Buffer.alloc(pad));byteLength+=pad}return index};
  function geometryData(geometry) {
    if(geometryIndices.has(geometry.uuid))return geometryIndices.get(geometry.uuid);
    const position=geometry.attributes.position,normal=geometry.attributes.normal,index=geometry.index;
    const result={position:accessors.length};
    accessors.push({bufferView:append(position.array,34962),componentType:5126,count:position.count,type:'VEC3',min:geometry.boundingBox.min.toArray(),max:geometry.boundingBox.max.toArray()});
    result.normal=accessors.length;accessors.push({bufferView:append(normal.array,34962),componentType:5126,count:normal.count,type:'VEC3'});
    result.index=accessors.length;accessors.push({bufferView:append(index.array,34963),componentType:index.array instanceof Uint32Array?5125:5123,count:index.count,type:'SCALAR'});geometryIndices.set(geometry.uuid,result);return result;
  }
  function visit(object) {
    const index=nodes.length,node={name:object.name,translation:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray()};nodes.push(node);
    if(Object.keys(object.userData).length)node.extras=object.userData;
    if(object instanceof THREE.Mesh){const key=`${object.geometry.uuid}/${object.material.uuid}`;if(!meshIndices.has(key)){const g=geometryData(object.geometry);meshIndices.set(key,meshes.length);meshes.push({name:object.geometry.name,primitives:[{attributes:{POSITION:g.position,NORMAL:g.normal},indices:g.index,material:materialList.indexOf(object.material)}]})}node.mesh=meshIndices.get(key)}
    if(object.children.length)node.children=object.children.map(visit);
    return index;
  }
  const rootIndex=visit(root);
  const json={asset:{version:'2.0',generator:'Embodex exact OBJ/MJCF conversion',copyright:provenance.license.copyright,extras:{license:'BSD-3-Clause',licenseText,sourceRepository:provenance.source_repository,sourceCommit:provenance.source_commit}},scene:0,scenes:[{name:'Unitree Go2 · source home pose',nodes:[rootIndex]}],nodes,meshes,materials:materialList.map(material=>({name:material.name,pbrMetallicRoughness:{baseColorFactor:[...material.color.toArray(),1],metallicFactor:material.metalness,roughnessFactor:material.roughness}})),accessors,bufferViews:views,buffers:[{byteLength}],extras:{sourceCommit:provenance.source_commit,license:'BSD-3-Clause',sample:true,sourcePrecision:'unchanged source vertices and normals; no decimation',engineeringValidation:'not-performed',nativeCad:false}};
  const jsonData=Buffer.from(JSON.stringify(json)),jsonPadded=Buffer.concat([jsonData,Buffer.alloc((4-jsonData.length%4)%4,32)]),binary=Buffer.concat(buffers),header=Buffer.alloc(12),jsonHeader=Buffer.alloc(8),binaryHeader=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonPadded.length+8+binary.length,8);jsonHeader.writeUInt32LE(jsonPadded.length);jsonHeader.writeUInt32LE(0x4e4f534a,4);binaryHeader.writeUInt32LE(binary.length);binaryHeader.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,jsonHeader,jsonPadded,binaryHeader,binary]);
}
const data=exportGlb(model),fileName='go2-high-fidelity.glb';
await writeFile(path.join(output,fileName),data);
await copyFile(path.join(source,'LICENSE'),path.join(output,'go2-LICENSE.txt'));
await copyFile(path.join(source,'provenance.json'),path.join(output,'go2-source-provenance.json'));
await copyFile(path.join(source,'provenance.json'),path.join(output,'go2-provenance.json'));
await copyFile(path.join(source,'go2.png'),path.join(output,'go2-source-preview.png'));
const triangleInstances=visualRecords.reduce((sum,record)=>sum+geometryCache.get(record.part.userData.sourceMesh).index.count/3,0);
const report={name:'Unitree Go2 · 开源精细网格参考',fileName,url:`/v8-assets/${fileName}`,previewUrl:'/v8-assets/go2-source-preview.png',mimeType:'model/gltf-binary',size:data.length,sha256:sha(data),license:'BSD-3-Clause',licenseUrl:'/v8-assets/go2-LICENSE.txt',sourceRepository:provenance.source_repository,sourceCommit:provenance.source_commit,sourceDirectory:provenance.source_directory,sourceHashVerified:true,uniqueSourceMeshes:geometryCache.size,visualParts:visualRecords.length,joints:joints.length,triangleInstances,uniqueTriangles:sourceStats.reduce((sum,item)=>sum+item.triangles,0),sourceStats,home,jointTransforms:joints,coordinateMapping:'MJCF(x,y,z) -> Web(-x,z,y)',displayGroundOffset,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new THREE.Vector3()).toArray()},parts:visualRecords.map(({part,material})=>({id:part.userData.assemblyId,label:part.userData.assemblyLabel,sourceMesh:part.userData.sourceMesh,sourceBody:part.userData.sourceBody,category:part.userData.category,material,explodeLocal:part.userData.explodeDirection})),limitations:['Original detailed visual meshes, not native CAD or certified manufacturing parts.','Visual material segmentation is not a manufacturer BOM. No invented internal parts are included.','Home pose follows source MJCF keyframe; inertial quaternions are not body rotations.','Display-only ground alignment, PBR material remapping and illustrative exploded displacement are recorded derivations.','No hardware performance, manufacturing tolerance, engineering validation or endorsement is claimed.']};
await writeFile(path.join(output,'go2-high-fidelity.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(output,'go2-ATTRIBUTION.md'),`# Unitree Go2 开源精细网格参考\n\n来自 Google DeepMind MuJoCo Menagerie 的 unitree_go2，固定提交 ${provenance.source_commit}，原始模型版权属于 Unitree Robotics。BSD-3-Clause 许可全文见 go2-LICENSE.txt。来源 ${provenance.source_directory_url}。未暗示来源作者为 Embodex 背书。\n\n转换前逐一验证20个原始文件的SHA-256。保留16个OBJ的全部顶点、原始法线、三角面和MJCF body/geom/joint层级，采用原始home关键帧。只转换为glTF float32，不进行减面、单件居中或独立缩放。${visualRecords.length}个实际可视分件、12个源关节、${triangleInstances.toLocaleString('en-US')}个实例三角面。\n\n派生处理：Y向上刚性坐标转换与整体落地；将MJCF材料名称映射为PBR表面；组件拆解为真实视觉分件的可逆平移。视觉分件不是制造BOM，不包含未经来源证实的电机内部、齿轮、电路板或螺钉模型。未提供原生CAD、制造公差、工程验证或硬件性能保证。\n\n来源图片 go2-source-preview.png 为上游模型渲染图，不是自行拍摄的实物照片。详见 go2-high-fidelity.json 与 go2-source-provenance.json。\n`);
console.log(JSON.stringify({fileName,size:data.length,sha256:report.sha256,visualParts:report.visualParts,joints:report.joints,triangleInstances:report.triangleInstances,uniqueTriangles:report.uniqueTriangles,bounds:report.bounds},null,2));
