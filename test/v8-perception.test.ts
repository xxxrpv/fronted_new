import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {PerceptionPreview} from '../components/v8/perception-preview';
import {applyModelPose,captureModelPose,setPartWorldPreviewOffset} from '../components/v8/model-explode';
const load=async(name:string)=>{const bytes=readFileSync(`public/v8-assets/${name}.glb`);return(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'')).scene;};
test('Q4 coverage uses actual retained sensor anchors and follows source camera movement',async()=>{
  const model=await load('inspection-reference'),preview=new PerceptionPreview(model);
  assert.deepEqual(preview.available,{lidar:true,vision:true,thermal:true});
  assert.equal(preview.group.userData.sensorOverlay,true,'all optical/thermal/depth captures must exclude the entire coverage visualization group');
  assert.equal(preview.group.children.length,4);
  preview.update(false,{lidar:true,vision:true,thermal:true});assert.equal(preview.visibleCount(),0);
  preview.update(true,{lidar:true,vision:false,thermal:false});assert.equal(preview.visibleCount(),1);
  preview.update(true,{lidar:false,vision:true,thermal:true});assert.equal(preview.visibleCount(),3);
  const field=preview.group.getObjectByName('coverage-vision-inspectionCamera')!;assert.ok(field);
  const before=field.position.clone(),pose=captureModelPose(model);
  assert.equal(setPartWorldPreviewOffset(pose,'inspection.camera-assembly',[0,.025,0]).ok,true);
  model.updateMatrixWorld(true);preview.update(true,{lidar:false,vision:true,thermal:false});
  assert.ok(Math.abs(field.position.y-before.y-.025)<1e-9);
  assert.ok(Math.abs(field.position.x-before.x)<1e-9&&Math.abs(field.position.z-before.z)<1e-9);
  applyModelPose(pose,0);preview.dispose();
});
test('C2 coverage is anchored to both actual ranging units and the real docking camera',async()=>{
  const model=await load('mobile-reference'),preview=new PerceptionPreview(model);
  assert.deepEqual(preview.available,{lidar:true,vision:true,thermal:false});
  preview.update(true,{lidar:true,vision:false,thermal:false});assert.equal(preview.visibleCount(),2);
  preview.update(true,{lidar:false,vision:true,thermal:true});assert.equal(preview.visibleCount(),1);
  assert.ok(preview.anchors.every(anchor=>anchor.node.userData.assemblyId));preview.dispose();
});
test('Unspecified OEM optics do not receive invented calibrated coverage',async()=>{
  const model=await load('go2-high-fidelity'),preview=new PerceptionPreview(model);
  assert.deepEqual(preview.available,{lidar:false,vision:false,thermal:false});assert.equal(preview.group.children.length,0);preview.dispose();
});
