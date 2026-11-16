import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Artifact, Project } from "../lib/v8/types";
import { groupDeliveryPackages } from "../lib/v8/delivery-packages";
import { previewModelUrl } from "../lib/v8/preview-model-url";

const at = "2026-11-15T00:00:00.000Z";
const copy = <T>(value: T): T => structuredClone(value);
function configured(artifact: Artifact): Artifact {
  const provenance = Object.fromEntries(
    [
      "projectId",
      "requirementId",
      "templateId",
      "branchId",
      "revisionId",
      "descriptionId",
      "approvalId",
      "cadRunId",
    ].flatMap((key) =>
      typeof artifact[key as keyof Artifact] === "string"
        ? [[key, artifact[key as keyof Artifact] as string]]
        : [],
    ),
  );
  artifact.modelRecipe = {
    assetKey: artifact.assetKey!,
    parameterSnapshot: { ...artifact.parameterSnapshot },
    provenance,
  };
  artifact.url = previewModelUrl(artifact.modelRecipe);
  artifact.sha256 = "a".repeat(64);
  artifact.sourceSha256 = "b".repeat(64);
  return artifact;
}
function custom(): Project {
  const snapshot = { inspectionCameraHeight: 0.025 };
  const p = {
    id: "p",
    name: "Package fixture",
    ownerId: "u",
    projectType: "EMBODIED_AI",
    source: "preview",
    route: "custom",
    status: "ready",
    createdAt: at,
    updatedAt: at,
    parameters: {},
    requirements: [
      {
        id: "q1",
        projectId: "p",
        sequence: 1,
        text: "source requirement",
        purpose: "",
        constraints: "",
        sources: [],
        missingFields: [],
        status: "ready",
        createdAt: at,
      },
    ],
    branches: [
      {
        id: "b1",
        projectId: "p",
        name: "Source direction",
        differentiator: "",
        rationale: "",
        limitation: "",
        latestRevisionId: "r1",
        revisions: [
          {
            id: "r1",
            branchId: "b1",
            sequence: 1,
            descriptionId: "d1",
            description: "frozen description",
            requirementId: "q1",
            assetKey: "inspection-reference",
            parameterSnapshot: snapshot,
            mediaType: "model",
            status: "ready",
            changeSummary: "initial",
            createdAt: at,
          },
        ],
      },
    ],
    approvals: [
      {
        id: "a1",
        projectId: "p",
        branchId: "b1",
        revisionId: "r1",
        descriptionId: "d1",
        description: "frozen description",
        requirementId: "q1",
        assetKey: "inspection-reference",
        parameterSnapshot: snapshot,
        approvedAt: at,
      },
    ],
    cadRuns: [
      {
        id: "c1",
        projectId: "p",
        taskId: "t1",
        sourceApprovalId: "a1",
        branchId: "b1",
        revisionId: "r1",
        sourceDescriptionId: "d1",
        sourceDescription: "frozen description",
        requirementId: "q1",
        parameterSnapshot: snapshot,
        assetKey: "inspection-reference",
        status: "succeeded",
        artifactIds: ["m1"],
        validationStatus: "not_run",
        createdAt: at,
      },
    ],
    artifacts: [],
    tasks: [
      {
        id: "t1",
        projectId: "p",
        type: "cad",
        status: "succeeded",
        currentStep: "ready",
        createdAt: at,
        updatedAt: at,
        scenario: "success",
        resultIds: ["c1"],
        requirementId: "q1",
        parameterSnapshot: snapshot,
        sourceDescriptionId: "d1",
        sourceDescription: "frozen description",
        approvalId: "a1",
        submissionState: "accepted",
      },
    ],
    journey: [],
  } as Project;
  const common = {
    projectId: "p",
    branchId: "b1",
    revisionId: "r1",
    descriptionId: "d1",
    approvalId: "a1",
    requirementId: "q1",
    assetKey: "inspection-reference",
    parameterSnapshot: snapshot,
    source: "licensed-reference",
    authorized: true,
    status: "ready",
    createdAt: at,
  };
  p.artifacts = [
    {
      ...common,
      id: "doc1",
      kind: "design_document",
      fileName: "frozen.html",
      mimeType: "text/html",
      content: "frozen design",
      sizeBytes: 13,
    },
    {
      ...common,
      id: "m1",
      cadRunId: "c1",
      kind: "model",
      fileName: "same-name.glb",
      mimeType: "model/gltf-binary",
      url: "/fixture.glb",
      sizeBytes: 100,
    },
  ] as Artifact[];
  configured(p.artifacts[1]);
  return p;
}
function template(): Project {
  const p = custom();
  p.route = "library";
  p.templateId = "sample-inspection";
  p.parameters = { inspectionCameraHeight: 0.025 };
  p.branches = [];
  p.approvals = [];
  p.cadRuns = [];
  p.journey = [
    {
      id: "template-event",
      kind: "template",
      refId: p.templateId,
      message: "saved",
      createdAt: at,
    },
  ];
  p.artifacts = p.artifacts.map((a): Artifact => {
    const {
      branchId,
      revisionId,
      descriptionId,
      approvalId,
      cadRunId,
      modelRecipe,
      ...rest
    } = a;
    void [
      branchId,
      revisionId,
      descriptionId,
      approvalId,
      cadRunId,
      modelRecipe,
    ];
    const artifact = { ...rest, templateId: p.templateId };
    return artifact.kind === "model" ? configured(artifact) : artifact;
  });
  return p;
}

describe("Delivery packages preserve actual frozen sources instead of mixing latest documents and old CAD", () => {
  test("Complete exact approval/run/source snapshots form a ready current package", () => {
    const p = custom(),
      packages = groupDeliveryPackages(p);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].key, "cad:c1");
    assert.equal(packages[0].status, "ready");
    assert.equal(packages[0].isCurrent, true);
    assert.deepEqual(
      packages[0].readyArtifacts.map((a) => a.id),
      ["doc1", "m1"],
    );
    assert.equal(packages[0].source.descriptionId, "d1");
    assert.deepEqual(packages[0].source.parameterSnapshot, {
      inspectionCameraHeight: 0.025,
    });
  });
  test("A newer approved document never joins the old successful model package", () => {
    const p = custom(),
      revision = {
        ...p.branches[0].revisions[0],
        id: "r2",
        descriptionId: "d2",
        description: "new body",
        sequence: 2,
        parameterSnapshot: { inspectionCameraHeight: 0.04 },
      };
    p.branches[0].revisions.push(revision);
    p.branches[0].latestRevisionId = "r2";
    p.approvals.push({
      ...p.approvals[0],
      id: "a2",
      revisionId: "r2",
      descriptionId: "d2",
      description: "new body",
      parameterSnapshot: revision.parameterSnapshot,
    });
    p.artifacts.push({
      ...p.artifacts[0],
      id: "doc2",
      revisionId: "r2",
      descriptionId: "d2",
      approvalId: "a2",
      parameterSnapshot: revision.parameterSnapshot,
    });
    const packages = groupDeliveryPackages(p),
      old = packages.find((p) => p.key === "cad:c1")!,
      latest = packages.find((p) => p.key === "approval:a2")!;
    assert.deepEqual(
      old.artifacts.map((a) => a.id),
      ["doc1", "m1"],
    );
    assert.equal(old.isCurrent, false);
    assert.deepEqual(
      latest.artifacts.map((a) => a.id),
      ["doc2"],
    );
    assert.equal(latest.modelReady, false);
    assert.equal(latest.isCurrent, true);
  });
  test("Failed and retry runs remain separate even with identical filename; only exact approved documents are shared", () => {
    const p = custom();
    p.cadRuns[0].status = "failed";
    p.cadRuns.push({
      ...p.cadRuns[0],
      id: "c2",
      taskId: "t2",
      status: "running",
      artifactIds: [],
      createdAt: "2026-11-15T00:01:00Z",
    });
    p.tasks.push({ ...p.tasks[0], id: "t2", status: "running", resultIds: [] });
    let packages = groupDeliveryPackages(p);
    const retry = packages.find((p) => p.key === "cad:c2")!;
    assert.equal(retry.status, "preparing");
    assert.equal(retry.modelReady, false);
    assert.deepEqual(
      retry.artifacts.map((a) => a.id),
      ["doc1"],
    );
    assert.equal(packages.find((p) => p.key === "cad:c1")!.status, "blocked");
    assert.equal(retry.isCurrent, true);
    p.cadRuns[1].status = "succeeded";
    p.cadRuns[1].artifactIds = ["m2"];
    p.artifacts.push(
      configured({ ...p.artifacts[1], id: "m2", cadRunId: "c2" }),
    );
    packages = groupDeliveryPackages(p);
    assert.deepEqual(
      packages.find((p) => p.key === "cad:c2")!.artifacts.map((a) => a.id),
      ["doc1", "m2"],
    );
  });
  test("Uploading, expired and unauthorized models cannot make their source package ready", () => {
    for (const change of [
      { status: "uploading" },
      { status: "expired" },
      { authorized: false },
    ] as const) {
      const p = custom();
      Object.assign(p.artifacts[1], change);
      const pkg = groupDeliveryPackages(p).find((p) => p.key === "cad:c1")!;
      assert.notEqual(pkg.status, "ready");
      assert.equal(pkg.modelReady, false);
      assert.deepEqual(
        pkg.readyArtifacts.map((a) => a.id),
        ["doc1"],
      );
    }
  });
  test("Templates separate requirement and parameter versions; zero and negative zero normalize without using mutable current parameters", () => {
    const p = template();
    p.parameters = { inspectionCameraHeight: 0 };
    p.artifacts[0].parameterSnapshot = { inspectionCameraHeight: 0 };
    p.artifacts[1].parameterSnapshot = { inspectionCameraHeight: -0 };
    configured(p.artifacts[1]);
    assert.equal(groupDeliveryPackages(p).length, 1);
    const old = copy(p.artifacts[0]);
    old.id = "old-doc";
    old.parameterSnapshot = { inspectionCameraHeight: 0.025 };
    p.artifacts.push(old);
    const packages = groupDeliveryPackages(p);
    assert.equal(packages.length, 2);
    assert.equal(packages.filter((p) => p.isCurrent).length, 1);
    assert.deepEqual(
      packages.find((p) => p.isCurrent)!.artifacts.map((a) => a.id),
      ["doc1", "m1"],
    );
  });
  test("Legacy missing snapshots remain individually readable unresolved files; current parameters never retrofit them", () => {
    const p = template();
    delete p.artifacts[0].parameterSnapshot;
    delete p.artifacts[1].requirementId;
    delete p.artifacts[1].modelRecipe;
    // The historical Artifact schema had no frozen asset/parameter metadata.
    // Partially stripping a new record must stay invalid, rather than pass as legacy.
    for (const artifact of p.artifacts) {
      delete artifact.assetKey;
      delete artifact.parameterSnapshot;
      delete artifact.sha256;
      delete artifact.sourceSha256;
    }
    p.artifacts[1].url = "/legacy-source.glb";
    const before = JSON.stringify(p),
      packages = groupDeliveryPackages(p);
    assert(
      packages.every(
        (p) =>
          p.source.kind === "unresolved" &&
          !p.isCurrent &&
          p.status === "blocked",
      ),
    );
    assert(
      packages.every(
        (p) => p.artifacts.length === 1 && p.readyArtifacts.length === 1,
      ),
    );
    assert.equal(JSON.stringify(p), before);
  });
  test("A recipe whose parameters or provenance contradict the frozen artifact is isolated rather than paired", () => {
    const p = custom();
    p.artifacts[1].modelRecipe = {
      assetKey: "inspection-reference",
      parameterSnapshot: { inspectionCameraHeight: 0.04 },
      provenance: { projectId: "p", cadRunId: "c1" },
    };
    let packages = groupDeliveryPackages(p);
    assert.equal(packages.find((p) => p.key === "cad:c1")!.modelReady, false);
    assert(packages.some((p) => p.key === "unresolved:m1"));
    p.artifacts[1].modelRecipe!.parameterSnapshot = {
      inspectionCameraHeight: 0.025,
    };
    p.artifacts[1].modelRecipe!.provenance.cadRunId = "other-run";
    packages = groupDeliveryPackages(p);
    assert.equal(packages.find((p) => p.key === "cad:c1")!.modelReady, false);
  });
  test("Raw source GLB plus nonzero view parameters cannot be advertised as configured geometry", () => {
    const p = custom();
    delete p.artifacts[1].modelRecipe;
    p.artifacts[1].url = "/original.glb";
    const packages = groupDeliveryPackages(p);
    assert.equal(packages.find((p) => p.key === "cad:c1")!.modelReady, false);
    const raw = packages.find((p) => p.key === "unresolved:m1")!;
    assert.equal(raw.artifacts.length, 1);
    assert.equal(raw.readyArtifacts.length, 1);
  });
  test("Tampered approval, foreign artifact and non-finite parameter metadata cannot create a valid source package", () => {
    const p = custom();
    p.approvals[0].description = "tampered";
    assert(
      groupDeliveryPackages(p)
        .filter((p) => p.source.kind !== "unresolved")
        .every((p) => p.status === "blocked"),
    );
    const t = template();
    t.artifacts[1].projectId = "foreign";
    t.artifacts[0].parameterSnapshot = { inspectionCameraHeight: NaN };
    assert(
      groupDeliveryPackages(t).every(
        (p) => p.source.kind === "unresolved" && p.readyArtifacts.length <= 1,
      ),
    );
  });
  test("New unapproved revisions leave old CAD historical and grouping never mutates deeply frozen input", () => {
    const p = custom();
    p.branches[0].revisions.push({
      ...p.branches[0].revisions[0],
      id: "newer",
      sequence: 2,
    });
    p.branches[0].latestRevisionId = "newer";
    const freeze = (value: unknown) => {
      if (value && typeof value === "object") {
        Object.freeze(value);
        Object.values(value).forEach(freeze);
      }
    };
    freeze(p);
    const packages = groupDeliveryPackages(p);
    assert.equal(packages.find((p) => p.key === "cad:c1")!.isCurrent, false);
    packages[0].source.parameterSnapshot!.inspectionCameraHeight = 0;
    assert.equal(
      p.approvals[0].parameterSnapshot!.inspectionCameraHeight,
      0.025,
    );
  });
});
