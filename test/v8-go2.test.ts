import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { validateGlbSecurity } from "../lib/equipment/glb-security";
import { captureModelPose, applyModelPose, computePerspectiveFrame, setPartWorldPreviewOffset } from "../components/v8/model-explode";

const directory = path.join(process.cwd(), "public", "v8-assets");
const bytes = readFileSync(path.join(directory,"go2-high-fidelity.glb"));
const report = JSON.parse(readFileSync(path.join(directory,"go2-high-fidelity.json"),"utf8"));
const buffer = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
const sourceJson = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const load = async () => (await new GLTFLoader().parseAsync(buffer,"")).scene;

describe("Go2 original detailed mesh conversion", () => {
  test("Agent moves actual concept camera assemblies in world Y and all original child meshes follow", async () => {
    for (const [asset,partId] of [['inspection-reference','inspection.camera-assembly'],['mobile-reference','dock-camera']]) {
      const file=readFileSync(path.join(directory,`${asset}.glb`));
      const scene=(await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer,'')).scene;
      const pose=captureModelPose(scene),part=pose.assemblies.find(item=>item.id===partId)!;
      assert.ok(part,`${asset} must contain the actual camera assembly`);
      scene.updateMatrixWorld(true);
      const children:{mesh:THREE.Object3D;position:THREE.Vector3}[]=[];
      part.node.traverse(mesh=>{if(mesh instanceof THREE.Mesh)children.push({mesh,position:mesh.getWorldPosition(new THREE.Vector3())});});
      assert.ok(children.length>=2,'camera shell and lens must move together');
      const receipt=setPartWorldPreviewOffset(pose,partId,[0,.025,0]);
      assert.equal(receipt.ok,true);
      scene.updateMatrixWorld(true);
      for(const child of children){const delta=child.mesh.getWorldPosition(new THREE.Vector3()).sub(child.position);assert.ok(Math.abs(delta.x)<1e-9&&Math.abs(delta.y-.025)<1e-9&&Math.abs(delta.z)<1e-9,'world up command must remain world up through original parent rotations');}
      assert.equal(setPartWorldPreviewOffset(pose,partId,[0,.1,0]).ok,false);
      assert.equal(setPartWorldPreviewOffset(pose,partId,[0,-.025,0]).ok,true);
      scene.updateMatrixWorld(true);
      for(const child of children)assert.ok(child.mesh.getWorldPosition(new THREE.Vector3()).distanceTo(child.position)<1e-9);
    }
    const original=await load();
    assert.equal(setPartWorldPreviewOffset(captureModelPose(original),'base.base_2',[0,.025,0]).ok,false,'original OEM visual source has no fabricated position editing capability');
  });
  test("binary is self-contained, hash-verified, licensed and has exact source mesh counts", () => {
    validateGlbSecurity(buffer);
    assert.equal(bytes.length,report.size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"),report.sha256);
    assert.equal(report.uniqueSourceMeshes,16);
    assert.equal(report.visualParts,33);
    assert.equal(report.joints,12);
    assert.equal(report.triangleInstances,398432);
    assert.equal(report.uniqueTriangles,196748);
    assert.ok(sourceJson.asset.extras.licenseText.includes("Redistribution and use in source and binary forms"));
    assert.ok(sourceJson.asset.copyright.includes("Unitree Robotics"));
    assert.equal(sourceJson.extras.nativeCad,false);
    assert.ok(sourceJson.buffers.every((item:{uri?:string})=>!item.uri));
  });
  test("retains source home joints, source geom hierarchy and original instance triangle counts", async () => {
    const model = await load();
    const pose = captureModelPose(model);
    assert.equal(pose.assemblies.length,33);
    assert.equal(pose.meshCount,33);
    let triangles=0,joints=0;
    model.traverse(node=>{
      if(node instanceof THREE.Mesh)triangles+=(node.geometry.index?.count||0)/3;
      if(node.userData.sourceJoint){joints++;assert.ok(!node.userData.sourceJoint.includes("foot"));}
    });
    assert.equal(triangles,398432);
    assert.equal(joints,12);
    for(const leg of ["FL","FR","RL","RR"]){
      assert.equal(model.getObjectByName(`${leg}_hip`)?.userData.sourceHomeAngle,0);
      assert.equal(model.getObjectByName(`${leg}_thigh`)?.userData.sourceHomeAngle,.9);
      assert.equal(model.getObjectByName(`${leg}_calf`)?.userData.sourceHomeAngle,-1.8);
      const foot=pose.assemblies.find(part=>part.id===`${leg}_calf.foot`)!;
      assert.equal(foot.node.parent?.name,`${leg}_calf`);
      assert.deepEqual(foot.node.position.toArray(),[0,0,-.213]);
    }
    assert.equal(model.getObjectByName("base")?.position.z,.27);
    const bounds=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    report.bounds.size.forEach((value:number,index:number)=>assert.ok(Math.abs(bounds.toArray()[index]-value)<1e-7));
  });
  test("source visual parts explode and restore without changing geometry, joint rotation or original scale", async () => {
    const model=await load(),pose=captureModelPose(model);
    const original=pose.entries.map(entry=>({node:entry.node,position:entry.node.position.toArray(),quaternion:entry.node.quaternion.toArray(),scale:entry.node.scale.toArray()}));
    for(let i=0;i<100;i++){applyModelPose(pose,1,.18);applyModelPose(pose,.2,0);}
    applyModelPose(pose,0,0);
    for(const state of original){assert.deepEqual(state.node.position.toArray(),state.position);assert.deepEqual(state.node.quaternion.toArray(),state.quaternion);assert.deepEqual(state.node.scale.toArray(),state.scale);}
    assert.equal(pose.entries.filter(entry=>entry.sensor).length,0,"source Go2 exposes no fictional sensor parameter");
    const sourceFront=pose.assemblies.filter(part=>part.node.userData.category==='perception');
    assert.equal(sourceFront.length,1);
    assert.equal(sourceFront[0].node.userData.sourceMesh,'base_2');
  });
  test("fully exploded source meshes fit desktop and phone perspective views",async()=>{
    const model=await load(),pose=captureModelPose(model);applyModelPose(pose,1);model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model);
    for(const aspect of [2,390/440]){
      const frame=computePerspectiveFrame({min:bounds.min.toArray(),max:bounds.max.toArray()},[-1.35,.85,1.65],35,aspect);
      const camera=new THREE.PerspectiveCamera(35,aspect,.001,100);camera.position.set(...frame.position);camera.lookAt(new THREE.Vector3(...frame.target));camera.updateMatrixWorld(true);
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
        const point=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(point.x)<.82&&Math.abs(point.y)<.68);
      }
    }
  });
});
