import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { exportConfiguredGlb } from "../lib/v8/export-configured-glb";
import { validateGlbSecurity } from "../lib/equipment/glb-security";
import type { AssetKey } from "../lib/v8/types";
import {
  adoptConfiguredPoseBaseline,
  applyModelPose,
  captureModelPose,
  setPartWorldPreviewOffset,
} from "../components/v8/model-explode";
import { reportModelMatches } from "../lib/v8/report-model-source";
import type { Artifact } from "../lib/v8/types";

const loadSource = (asset: AssetKey) => {
  const bytes = readFileSync(
    path.join(process.cwd(), "public/v8-assets", `${asset}.glb`),
  );
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};
const json = (buffer: ArrayBuffer) =>
  JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true)),
    ),
  );
const binary = (buffer: ArrayBuffer) =>
  new Uint8Array(buffer, 20 + new DataView(buffer).getUint32(12, true));
const hash = (buffer: ArrayBuffer) =>
  createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
const fixtures = [
  {
    asset: "inspection-reference",
    key: "inspectionCameraHeight",
    part: "inspection.camera-assembly",
  },
  { asset: "mobile-reference", key: "mobileCameraHeight", part: "dock-camera" },
] as const;

describe("configured concept GLB export", () => {
  test("exports actual frozen camera positions with every source mesh, binary byte and license retained", async () => {
    for (const fixture of fixtures) {
      const source = loadSource(fixture.asset);
      const beforeHash = hash(source);
      const provenance = {
        projectId: "p1",
        requirementId: "req1",
        templateId: "t1",
        branchId: "b1",
        revisionId: "r2",
        descriptionId: "d2",
        approvalId: "a2",
        cadRunId: "c2",
      };
      const result = await exportConfiguredGlb(source, {
        assetKey: fixture.asset,
        parameterSnapshot: { [fixture.key]: 0.025 },
        provenance,
        expectedSourceSha256: beforeHash,
      });
      validateGlbSecurity(result.buffer);
      assert.equal(result.byteLength, result.buffer.byteLength);
      assert.equal(result.sha256, hash(result.buffer));
      assert.equal(result.sourceSha256, beforeHash);
      assert.equal(
        hash(source),
        beforeHash,
        "immutable source must remain untouched",
      );
      assert.deepEqual(result.changedParts, [fixture.part]);
      assert.deepEqual(
        binary(result.buffer),
        binary(source),
        "all non-JSON GLB chunks must remain byte-identical",
      );
      const original = json(source),
        exported = json(result.buffer);
      for (const key of [
        "meshes",
        "accessors",
        "bufferViews",
        "buffers",
        "materials",
        "textures",
        "images",
        "scenes",
        "scene",
      ])
        assert.deepEqual(
          exported[key],
          original[key],
          `${fixture.asset} ${key} must be retained`,
        );
      assert.equal(exported.asset.copyright, original.asset.copyright);
      assert.equal(
        exported.asset.extras.licenseText,
        original.asset.extras.licenseText,
      );
      assert.deepEqual(
        exported.asset.extras.embodexConfiguredExport.provenance,
        provenance,
      );
      assert.equal(
        exported.asset.extras.embodexConfiguredExport.nativeCad,
        false,
      );
      assert.equal(
        exported.asset.extras.embodexConfiguredExport.engineeringVerified,
        false,
      );
      const oldScene = (await new GLTFLoader().parseAsync(source, "")).scene;
      const newScene = (await new GLTFLoader().parseAsync(result.buffer, ""))
        .scene;
      oldScene.updateMatrixWorld(true);
      newScene.updateMatrixWorld(true);
      const moved = new Set<string>();
      oldScene.traverse((node) => {
        if (node.userData.assemblyId === fixture.part)
          node.traverse((child) => moved.add(child.name));
      });
      const previous = new Map<string, THREE.Vector3>();
      oldScene.traverse((node) => {
        if (node instanceof THREE.Mesh)
          previous.set(node.name, node.getWorldPosition(new THREE.Vector3()));
      });
      let count = 0;
      newScene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        count++;
        const prior = previous.get(node.name);
        assert.ok(prior, "source mesh identities must remain");
        const difference = node
          .getWorldPosition(new THREE.Vector3())
          .sub(prior);
        const expected = moved.has(node.name) ? 0.025 : 0;
        assert.ok(
          Math.abs(difference.x) < 1e-9 &&
            Math.abs(difference.y - expected) < 1e-9 &&
            Math.abs(difference.z) < 1e-9,
          `${fixture.asset} ${node.name} must move only with its real parent assembly`,
        );
      });
      assert.equal(count, previous.size);
      assert.ok(
        moved.size > 2,
        "camera shell, lenses and bracket must move as actual descendants",
      );
      const pose = captureModelPose(newScene);
      const part = pose.assemblies.find((item) => item.id === fixture.part)!;
      const originalPart = captureModelPose(oldScene).assemblies.find(
        (item) => item.id === fixture.part,
      )!;
      const originalPosition = originalPart.node.getWorldPosition(
        new THREE.Vector3(),
      );
      const frozenPosition = part.node.getWorldPosition(new THREE.Vector3());
      assert.equal(
        adoptConfiguredPoseBaseline(
          pose,
          exported.asset.extras.embodexConfiguredExport,
        ),
        true,
      );
      applyModelPose(pose, 0);
      part.node.updateWorldMatrix(true, true);
      assert.ok(
        part.node
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(frozenPosition) < 1e-9,
        "adopting a configured baseline must not double the frozen offset",
      );
      assert.equal(
        adoptConfiguredPoseBaseline(
          pose,
          exported.asset.extras.embodexConfiguredExport,
        ),
        false,
        "baseline adoption must be idempotent",
      );
      assert.equal(
        setPartWorldPreviewOffset(pose, fixture.part, [0, -0.075, 0]).ok,
        true,
        "25mm configured camera must be able to move to the original source limit -50mm",
      );
      assert.ok(
        part.node
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(
            originalPosition.clone().add(new THREE.Vector3(0, -0.05, 0)),
          ) < 1e-9,
      );
      assert.equal(
        setPartWorldPreviewOffset(pose, fixture.part, [0, -0.001, 0]).ok,
        false,
        "source-relative limit still applies",
      );
      assert.equal(
        setPartWorldPreviewOffset(pose, fixture.part, [0, 0.075, 0]).ok,
        true,
      );
      applyModelPose(pose, 1);
      applyModelPose(pose, 0);
      part.node.updateWorldMatrix(true, true);
      assert.ok(
        part.node
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(frozenPosition) < 1e-9,
        "explode/restore must retain exactly the frozen position",
      );
      oldScene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            material.dispose();
        }
      });
      newScene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            material.dispose();
        }
      });
    }
  });

  test("same frozen recipe is deterministic; distinct supported values create distinct downloadable geometry", async () => {
    const source = loadSource("mobile-reference");
    const base = {
      assetKey: "mobile-reference" as const,
      provenance: { projectId: "p", revisionId: "r" },
    };
    const zero = await exportConfiguredGlb(source, {
      ...base,
      parameterSnapshot: { mobileCameraHeight: 0 },
    });
    const raised = await exportConfiguredGlb(source, {
      ...base,
      parameterSnapshot: { mobileCameraHeight: 0.025 },
    });
    const lowered = await exportConfiguredGlb(source, {
      ...base,
      parameterSnapshot: { mobileCameraHeight: -0.015 },
    });
    const repeat = await exportConfiguredGlb(source, {
      ...base,
      provenance: { revisionId: "r", projectId: "p" },
      parameterSnapshot: { mobileCameraHeight: 0.025 },
    });
    assert.equal(raised.sha256, repeat.sha256);
    assert.equal(new Set([zero.sha256, raised.sha256, lowered.sha256]).size, 3);
    assert.deepEqual(zero.changedParts, []);
    const noParameters = await exportConfiguredGlb(
      loadSource("go2-high-fidelity"),
      {
        assetKey: "go2-high-fidelity",
        parameterSnapshot: {},
        provenance: { descriptionId: "immutable-description" },
      },
    );
    assert.equal(
      json(noParameters.buffer).asset.extras.embodexConfiguredExport.provenance
        .descriptionId,
      "immutable-description",
    );
    assert.deepEqual(noParameters.changedParts, []);
  });

  test("rejects unsupported parameters, source drift and exported-input accumulation", async () => {
    const source = loadSource("inspection-reference");
    const invalidSnapshots: Record<string, number>[] = [
      { inspectionCameraHeight: 0.051 },
      { inspectionCameraHeight: NaN },
      { width: 0.02 },
    ];
    for (const parameters of invalidSnapshots)
      await assert.rejects(
        exportConfiguredGlb(source, {
          assetKey: "inspection-reference",
          parameterSnapshot: parameters,
        }),
      );
    await assert.rejects(
      exportConfiguredGlb(loadSource("go2-high-fidelity"), {
        assetKey: "go2-high-fidelity",
        parameterSnapshot: { inspectionCameraHeight: 0.025 },
      }),
    );
    await assert.rejects(
      exportConfiguredGlb(source, {
        assetKey: "inspection-reference",
        parameterSnapshot: {},
        expectedSourceSha256: "0".repeat(64),
      }),
      /校验值/,
    );
    await assert.rejects(
      exportConfiguredGlb(source, {
        assetKey: "inspection-reference",
        parameterSnapshot: {},
        provenance: { projectId: "" },
      }),
      /来源记录/,
    );
    const result = await exportConfiguredGlb(source, {
      assetKey: "inspection-reference",
      parameterSnapshot: { inspectionCameraHeight: 0.025 },
    });
    await assert.rejects(
      exportConfiguredGlb(result.buffer, {
        assetKey: "inspection-reference",
        parameterSnapshot: { inspectionCameraHeight: 0.025 },
      }),
      /原始来源/,
    );
    await assert.rejects(
      exportConfiguredGlb(loadSource("mobile-reference"), {
        assetKey: "inspection-reference",
        parameterSnapshot: { inspectionCameraHeight: 0.025 },
      }),
      /实际组件/,
    );
  });

  test("freezes caller-owned source bytes and recipe before asynchronous hashing", async () => {
    const source = loadSource("mobile-reference");
    const sourceHash = hash(source);
    const parameters = { mobileCameraHeight: 0.025 };
    const provenance = {
      projectId: "original-project",
      revisionId: "original-revision",
    };
    const pending = exportConfiguredGlb(source, {
      assetKey: "mobile-reference",
      parameterSnapshot: parameters,
      provenance,
    });
    parameters.mobileCameraHeight = -0.05;
    provenance.revisionId = "later-revision";
    new Uint8Array(source).fill(0);
    const result = await pending;
    assert.equal(result.sourceSha256, sourceHash);
    assert.deepEqual(result.parameterSnapshot, { mobileCameraHeight: 0.025 });
    assert.equal(
      json(result.buffer).asset.extras.embodexConfiguredExport.provenance
        .revisionId,
      "original-revision",
    );
  });

  test("historical reports only match exact requirement, parameters and concept provenance", () => {
    const report: Artifact = {
      id: "doc",
      projectId: "p",
      kind: "design_document",
      fileName: "design.html",
      mimeType: "text/html",
      sizeBytes: 1,
      status: "ready",
      source: "authored-sample",
      authorized: true,
      createdAt: "2026-11-15T00:00:00.000Z",
      templateId: "sample-inspection",
      requirementId: "req1",
      parameterSnapshot: { inspectionCameraHeight: 0.025 },
    };
    const model = { ...report, id: "model", kind: "model" } as Artifact;
    assert.equal(reportModelMatches(report, model), true);
    assert.equal(
      reportModelMatches(report, { ...model, requirementId: "req2" }),
      false,
    );
    assert.equal(
      reportModelMatches(report, {
        ...model,
        parameterSnapshot: { inspectionCameraHeight: 0.03 },
      }),
      false,
    );
    assert.equal(
      reportModelMatches(report, { ...model, parameterSnapshot: undefined }),
      false,
    );
    assert.equal(
      reportModelMatches(report, { ...model, projectId: "other-project" }),
      false,
    );
    const conceptReport = {
      ...report,
      templateId: undefined,
      branchId: "b1",
      revisionId: "r1",
      descriptionId: "d1",
      approvalId: "a1",
    };
    const conceptModel = { ...conceptReport, kind: "model" as const };
    assert.equal(reportModelMatches(conceptReport, conceptModel), true);
    for (const field of [
      "branchId",
      "revisionId",
      "descriptionId",
      "approvalId",
    ] as const)
      assert.equal(
        reportModelMatches(conceptReport, {
          ...conceptModel,
          [field]: "later",
        }),
        false,
      );
  });
});
