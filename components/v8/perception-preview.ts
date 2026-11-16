import * as THREE from 'three';

export type FovKind = 'lidar' | 'vision' | 'thermal';
type Anchor = { node: THREE.Object3D; kind: FovKind; forward: THREE.Vector3; industrial:boolean };

/** Coverage illustrations use source nodes; they do not specify measured sensor performance. */
export class PerceptionPreview {
  readonly group = new THREE.Group();
  readonly anchors: Anchor[] = [];
  readonly available: Record<FovKind,boolean> = {lidar:false,vision:false,thermal:false};
  private fields: {anchor:Anchor;group:THREE.Group}[]=[];
  constructor(model:THREE.Object3D) {
    this.group.name='sensor-coverage-illustration';
    this.group.userData.sensorOverlay=true;
    const byPart=(id:string)=>{let result:THREE.Object3D|undefined;model.traverse(node=>{if(node.userData.assemblyId===id)result=node;});return result;};
    const add=(kind:FovKind,node:THREE.Object3D|undefined,forward:THREE.Vector3,industrial=false)=>{if(!node)return;const anchor={kind,node,forward,industrial};this.anchors.push(anchor);this.available[kind]=true;};
    add('lidar',model.getObjectByName('rangeSensor'),new THREE.Vector3(-1,0,0));
    add('vision',model.getObjectByName('inspectionCamera'),new THREE.Vector3(-1,0,0));
    add('vision',model.getObjectByName('downCamera'),new THREE.Vector3(-1,0,0));
    add('thermal',model.getObjectByName('thermalCamera'),new THREE.Vector3(-1,0,0));
    for(const id of ['lidar-0.555','lidar--0.555'])add('lidar',byPart(id),new THREE.Vector3(0,0,id==='lidar-0.555'?1:-1),true);
    add('vision',byPart('dock-camera'),new THREE.Vector3(0,0,1),true);
    for(const anchor of this.anchors){const group=this.makeField(anchor);group.name=`coverage-${anchor.kind}-${anchor.node.name}`;group.userData={illustrative:true,sourceAnchor:anchor.node.name,kind:anchor.kind};this.group.add(group);this.fields.push({anchor,group});}
    this.group.visible=false;
  }
  private makeField(anchor:Anchor) {
    const kind=anchor.kind;
    const group=new THREE.Group(),vertices:number[]=[],lines:number[]=[];
    const color=anchor.industrial?'#5d9fbe':kind==='lidar'?'#63a9b6':kind==='thermal'?'#c99c51':'#4b99cc';
    if(kind==='lidar'&&!anchor.industrial){
      const near=.09,far=.7;
      for(let i=0;i<72;i++){const a=i/72*Math.PI*2,b=(i+1)/72*Math.PI*2;for(const beta of [22,-18]){const point=(angle:number,r:number)=>[Math.cos(angle)*r,Math.tan(beta*Math.PI/180)*r,Math.sin(angle)*r];vertices.push(...point(a,near),...point(a,far),...point(b,far),...point(a,near),...point(b,far),...point(b,near));lines.push(...point(a,far),...point(b,far));if(i%9===0)lines.push(...point(a,near),...point(a,far));}}
    }else{
      const down=anchor.node.name==='downCamera';
      const horizontal=anchor.industrial?2*Math.atan(.46)*180/Math.PI:kind==='thermal'?45:down?70:87;
      const vertical=anchor.industrial?2*Math.atan(.28)*180/Math.PI:kind==='thermal'?34:down?55:58;
      const far=anchor.industrial?.65:kind==='thermal'?.72:down?.34:.85;
      const corners=(d:number)=>[[-d,-d*Math.tan(vertical*Math.PI/360),-d*Math.tan(horizontal*Math.PI/360)],[-d,-d*Math.tan(vertical*Math.PI/360),d*Math.tan(horizontal*Math.PI/360)],[-d,d*Math.tan(vertical*Math.PI/360),d*Math.tan(horizontal*Math.PI/360)],[-d,d*Math.tan(vertical*Math.PI/360),-d*Math.tan(horizontal*Math.PI/360)]];
      const near=corners(anchor.industrial?.03:.035),outer=corners(far);
      for(let i=0;i<4;i++){const j=(i+1)%4;vertices.push(...near[i],...outer[i],...outer[j],...near[i],...outer[j],...near[j]);lines.push(...near[i],...outer[i],...outer[i],...outer[j],...near[i],...near[j]);}
    }
    const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.055,side:THREE.DoubleSide,depthWrite:false})));
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(lines,3)),new THREE.LineBasicMaterial({color,transparent:true,opacity:.55,depthWrite:false})));
    return group;
  }
  update(active:boolean,enabled:Record<FovKind,boolean>){
    this.group.visible=active;
    for(const field of this.fields){field.group.visible=enabled[field.anchor.kind];field.anchor.node.updateWorldMatrix(true,false);field.anchor.node.getWorldPosition(field.group.position);field.anchor.node.getWorldQuaternion(field.group.quaternion);if(field.anchor.kind!=='lidar'||field.anchor.industrial)field.group.quaternion.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1,0,0),field.anchor.forward));}
  }
  visibleCount(){return this.group.visible?this.fields.filter(field=>field.group.visible).length:0;}
  dispose(){this.group.removeFromParent();this.group.traverse(node=>{if(node instanceof THREE.Mesh || node instanceof THREE.LineSegments){node.geometry.dispose();for(const material of Array.isArray(node.material)?node.material:[node.material])material.dispose();}});}
}
