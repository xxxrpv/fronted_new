import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { validateGlbSecurity } from "../lib/equipment/glb-security";
import {
  applyModelPose,
  captureModelPose,
  findAssembly,
  computePerspectiveFrame,
  setPartPreviewOffset,
} from "../components/v8/model-explode";

async function loadFixture(id: string) {
  const bytes = readFileSync(
    path.join(process.cwd(), "public", "v8-assets", `${id}.glb`),
  );
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  validateGlbSecurity(buffer);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  return gltf.scene;
}

describe("真实 GLB 组件拆解", () => {
  test("Agent adjustments require explicit capability, compose with exploded pose and reject range violations", () => {
    const root=new THREE.Group(),camera=new THREE.Group();camera.position.set(.1,.3,.2);camera.userData={assemblyId:'concept-camera',assemblyLabel:'概念相机总成',explodable:true,explodeDirection:[0,.2,0],viewOffsetSupported:true,viewOffsetMax:.05,viewOffsetAxes:['x','y','z']};root.add(camera);
    const pose=captureModelPose(root);
    const receipt=setPartPreviewOffset(pose,'concept-camera',[0,.025,0]);
    assert.equal(receipt.ok,true);assert.deepEqual(receipt.before,[0,0,0]);assert.deepEqual(receipt.after,[0,.025,0]);
    applyModelPose(pose,1);assert.ok(Math.abs(camera.position.y-.525)<1e-10);
    applyModelPose(pose,0);assert.ok(Math.abs(camera.position.y-.325)<1e-10);
    assert.equal(setPartPreviewOffset(pose,'concept-camera',[0,.1,0]).ok,false);assert.deepEqual(pose.entries[0].previewOffset,[0,.025,0]);
    assert.equal(setPartPreviewOffset(pose,'absent',[0,.01,0]).ok,false);
    setPartPreviewOffset(pose,'concept-camera',[0,-.025,0]);applyModelPose(pose,0);assert.deepEqual(camera.position.toArray(),[.1,.3,.2]);
  });
  test("all exploded corners remain in frame on desktop and phone at different orbit angles", async () => {
    for (const id of ["compact", "quadruped", "tripod", "conveyor"]) {
      const model = await loadFixture(id);
      applyModelPose(captureModelPose(model), 1, 0.18);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      for (const aspect of [2.1, 1, 390 / 440])
        for (const direction of [
          [1.35, 0.85, 1.65],
          [-2, 1, 0.5],
          [0, 0.25, 2],
        ] as const) {
          const frame = computePerspectiveFrame(
            { min: bounds.min.toArray(), max: bounds.max.toArray() },
            direction,
            35,
            aspect,
          );
          const camera = new THREE.PerspectiveCamera(35, aspect, 0.001, 1000);
          camera.position.set(...frame.position);
          camera.lookAt(new THREE.Vector3(...frame.target));
          camera.updateMatrixWorld(true);
          for (const x of [bounds.min.x, bounds.max.x])
            for (const y of [bounds.min.y, bounds.max.y])
              for (const z of [bounds.min.z, bounds.max.z]) {
                const projected = new THREE.Vector3(x, y, z).project(camera);
                assert.ok(
                  Math.abs(projected.x) <= 0.82,
                  `${id} horizontal corner clipping at aspect ${aspect}`,
                );
                assert.ok(
                  Math.abs(projected.y) <= 0.68,
                  `${id} vertical corner clipping at aspect ${aspect}`,
                );
                assert.ok(projected.z > -1 && projected.z < 1);
              }
        }
    }
  });
  for (const [id, groupCount, meshCount] of [
    ["compact", 8, 21],
    ["quadruped", 7, 27],
    ["tripod", 6, 20],
    ["conveyor", 8, 31],
  ] as const) {
    test(`${id}: uses real hierarchy, separates assemblies and restores exact transforms`, async () => {
      const model = await loadFixture(id);
      const pose = captureModelPose(model);
      assert.equal(pose.assemblies.length, groupCount);
      assert.equal(pose.meshCount, meshCount);
      const original = pose.entries.map((entry) => ({
        node: entry.node,
        position: entry.node.position.clone(),
        rotation: entry.node.quaternion.clone(),
        scale: entry.node.scale.clone(),
      }));
      model.updateMatrixWorld(true);
      const sensor = pose.entries.find((entry) => entry.sensor)!;
      const sensorAssembly = findAssembly(sensor.node)!;
      const originalWorld = sensor.node.getWorldPosition(new THREE.Vector3());
      applyModelPose(pose, 1, 0.15);
      model.updateMatrixWorld(true);
      const movedWorld = sensor.node.getWorldPosition(new THREE.Vector3());
      assert.ok(
        movedWorld.distanceTo(originalWorld) > 0.5,
        "real sensor mesh must move in world space",
      );
      assert.ok(
        Math.abs(
          movedWorld.y -
            originalWorld.y -
            (sensorAssembly.userData.explodeDirection[1] + 0.15),
        ) < 1e-10,
        "sensor offset composes with parent assembly translation",
      );
      assert.ok(
        pose.assemblies.some(
          (assembly) => assembly.node.position.length() > 0.5,
        ),
      );
      for (let i = 0; i < 100; i++) {
        applyModelPose(pose, 0.75, 0.12);
        applyModelPose(pose, 0.2, 0.03);
      }
      applyModelPose(pose, 0, 0);
      model.updateMatrixWorld(true);
      for (const entry of original) {
        assert.deepEqual(
          entry.node.position.toArray(),
          entry.position.toArray(),
        );
        assert.deepEqual(
          entry.node.quaternion.toArray(),
          entry.rotation.toArray(),
        );
        assert.deepEqual(entry.node.scale.toArray(), entry.scale.toArray());
      }
      assert.deepEqual(
        sensor.node.getWorldPosition(new THREE.Vector3()).toArray(),
        originalWorld.toArray(),
      );
    });
  }

  test("unsupported metadata cannot create fictional explode controls", () => {
    const root = new THREE.Group();
    const node = new THREE.Group();
    node.userData = {
      assemblyId: "fake",
      assemblyLabel: "Invalid",
      explodable: true,
      explodeDirection: [Infinity, 0, 0],
    };
    root.add(node);
    assert.equal(captureModelPose(root).assemblies.length, 0);
    assert.equal(findAssembly(new THREE.Object3D()), null);
  });

  test("clamps unsupported offset values and derives each position from its source", async () => {
    const model = await loadFixture("quadruped");
    const pose = captureModelPose(model);
    const cover = pose.entries.find(
      (entry) => entry.node.userData.assemblyId === "cover",
    )!;
    applyModelPose(pose, 200, 200);
    assert.equal(cover.node.position.y, cover.base[1] + cover.direction[1]);
    applyModelPose(pose, NaN, Infinity);
    for (const entry of pose.entries)
      assert.deepEqual(entry.node.position.toArray(), [...entry.base]);
  });
});
