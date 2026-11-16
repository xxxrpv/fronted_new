// Self-contained glTF writer for retained Three.js source geometry; no quantisation or mesh simplification.
export function encodeThreeGlb(root, { copyright = '', licenseText = '', source = {}, includeHidden = false } = {}) {
  const views=[], accessors=[], nodes=[], meshes=[], materials=[], chunks=[];
  const materialIndices=new Map(), attributeIndices=new Map(), meshIndices=new Map();
  let length=0, outputMeshCount=0, triangleInstances=0;
  const append=(array,target)=>{const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),view=views.length;views.push({buffer:0,byteOffset:length,byteLength:bytes.length,target});chunks.push(bytes);length+=bytes.length;const pad=(4-length%4)%4;if(pad){chunks.push(Buffer.alloc(pad));length+=pad}return view};
  function attribute(geometry,name,type) {
    const key=`${geometry.uuid}/${name}`;
    if(attributeIndices.has(key))return attributeIndices.get(key);
    const value=geometry.attributes[name];
    if(!value || value.isInterleavedBufferAttribute)throw new Error(`Unsupported retained attribute: ${name}`);
    const array=value.array instanceof Float32Array ? value.array : Float32Array.from(value.array);
    const data={bufferView:append(array,34962),componentType:5126,count:value.count,type};
    if(name==='position'){geometry.computeBoundingBox();data.min=geometry.boundingBox.min.toArray();data.max=geometry.boundingBox.max.toArray()}
    const index=accessors.length;accessors.push(data);attributeIndices.set(key,index);return index;
  }
  function material(value) {
    if(materialIndices.has(value.uuid))return materialIndices.get(value.uuid);
    for(const property of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap'])if(value[property])throw new Error(`Texture ${property} requires an explicit retained image exporter; refusing silent loss`);
    const entry={name:value.name||'retained PBR material',pbrMetallicRoughness:{baseColorFactor:[...(value.color?.toArray()||[1,1,1]),value.opacity??1],metallicFactor:value.metalness??0,roughnessFactor:value.roughness??.6}};
    if(value.transparent || value.opacity<1)entry.alphaMode='BLEND';
    if(value.side===2)entry.doubleSided=true;
    if(value.emissive)entry.emissiveFactor=value.emissive.toArray().map(v=>v*(value.emissiveIntensity??1));
    const index=materials.length;materials.push(entry);materialIndices.set(value.uuid,index);return index;
  }
  function mesh(object) {
    const geometry=object.geometry, matList=Array.isArray(object.material)?object.material:[object.material];
    const key=`${geometry.uuid}/${matList.map(value=>value.uuid).join('/')}`;
    const sourceIndex=geometry.index?.array || Uint32Array.from({length:geometry.attributes.position.count},(_,index)=>index);
    const groups=Array.isArray(object.material)&&geometry.groups.length?geometry.groups:[{start:0,count:sourceIndex.length,materialIndex:0}];
    triangleInstances+=groups.reduce((sum,group)=>sum+group.count/3,0);outputMeshCount++;
    if(meshIndices.has(key))return meshIndices.get(key);
    const attrs={POSITION:attribute(geometry,'position','VEC3'),NORMAL:attribute(geometry,'normal','VEC3')};
    if(geometry.attributes.uv)attrs.TEXCOORD_0=attribute(geometry,'uv','VEC2');
    if(geometry.attributes.color)attrs.COLOR_0=attribute(geometry,'color',geometry.attributes.color.itemSize===4?'VEC4':'VEC3');
    const primitives=groups.map(group=>{const selection=sourceIndex.slice(group.start,group.start+group.count),indices=geometry.attributes.position.count>65535?Uint32Array.from(selection):Uint16Array.from(selection),index=accessors.length;accessors.push({bufferView:append(indices,34963),componentType:indices instanceof Uint32Array?5125:5123,count:indices.length,type:'SCALAR'});return{attributes:attrs,indices:index,material:material(matList[group.materialIndex||0])}});
    const index=meshes.length;meshes.push({name:geometry.name,primitives});meshIndices.set(key,index);return index;
  }
  function node(object) {
    const index=nodes.length,entry={name:object.name,translation:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray()};nodes.push(entry);
    if(Object.keys(object.userData||{}).length){const safe={};for(const[key,value]of Object.entries(object.userData)){if(value===null||['string','number','boolean'].includes(typeof value)||(Array.isArray(value)&&value.every(item=>['string','number','boolean'].includes(typeof item))))safe[key]=value}if(Object.keys(safe).length)entry.extras=safe}
    if(object.isMesh)entry.mesh=mesh(object);
    const children=object.children.filter(value=>includeHidden||value.visible!==false);
    if(children.length)entry.children=children.map(node);
    return index;
  }
  const rootId=node(root),json={asset:{version:'2.0',generator:'Embodex retained-geometry GLB encoder',copyright,extras:{licenseText,...source}},scene:0,scenes:[{name:root.name,nodes:[rootId]}],nodes,meshes,materials,accessors,bufferViews:views,buffers:[{byteLength:length}],extras:{...source,outputMeshCount,triangleInstances,geometryConversion:'retained source Float32 geometry; no decimation'}};
  const raw=Buffer.from(JSON.stringify(json)),jsonData=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),binary=Buffer.concat(chunks),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonData.length+8+binary.length,8);jh.writeUInt32LE(jsonData.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);
  return { data:Buffer.concat([header,jh,jsonData,bh,binary]), stats:{outputMeshCount,triangleInstances,gltfMeshes:meshes.length,gltfMaterials:materials.length,nodeCount:nodes.length} };
}
