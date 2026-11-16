import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  PreviewRepository,
  type StoragePort,
  type Artifact,
  type Project,
  type ArtifactMaterialization,
  canDownload,
  approvalSourceValid,
  runSourceValid,
} from "../lib/v8/repository";
import { exportConfiguredGlb } from "../lib/v8/export-configured-glb";
import { previewModelUrl } from "../lib/v8/preview-model-url";

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const hash = (buffer: ArrayBuffer) =>
  createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
const glbJson = (buffer: ArrayBuffer) =>
  JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true)),
    ),
  );
async function actualMaterialize(artifact: Artifact) {
  const recipe = artifact.modelRecipe!;
  const bytes = readFileSync(
    path.resolve("public/v8-assets", `${recipe.assetKey}.glb`),
  );
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return exportConfiguredGlb(source, recipe);
}
function fixture(
  materialize?: (artifact: Artifact) => Promise<ArtifactMaterialization>,
) {
  let clock = Date.parse("2026-11-15T01:00:00Z");
  const storage = new MemoryStorage(),
    outputs = new Map<string, ArrayBuffer>();
  const repo = new PreviewRepository(storage, () => clock, {
    materializeArtifact:
      materialize ||
      (async (artifact) => {
        const result = await actualMaterialize(artifact);
        outputs.set(artifact.id, result.buffer);
        return {
          sizeBytes: result.byteLength,
          sha256: result.sha256,
          sourceSha256: result.sourceSha256,
        };
      }),
  });
  return {
    repo,
    storage,
    outputs,
    advance: (ms = 3000) => {
      clock += ms;
    },
  };
}
async function concept(f: ReturnType<typeof fixture>) {
  let p = await f.repo.create(
    {
      text: "冻结巡检方案和相机配置",
      purpose: "巡检",
      constraints: "保留来源结构",
    },
    "new",
  );
  p = await f.repo.generateConcepts(p.id, 3, "concepts");
  f.advance();
  p = await f.repo.syncTask(p.id);
  const branch = p.branches.find(
    (item) => item.revisions[0].assetKey === "inspection-reference",
  )!;
  assert(branch);
  return { p, branch };
}
async function finishCad(
  f: ReturnType<typeof fixture>,
  p: Project,
  approvalId: string,
  key: string,
) {
  p = await f.repo.startCad(p.id, approvalId, key);
  f.advance();
  p = await f.repo.syncTask(p.id);
  const pending = p.artifacts
    .filter((item) => item.kind === "model" && item.cadRunId)
    .at(-1)!;
  assert.equal(pending.status, "uploading");
  assert.equal(pending.sizeBytes, 0);
  assert.equal(canDownload(p, pending), false);
  f.advance();
  return f.repo.syncTask(p.id);
}

describe("Frozen source parameters → approved sample task → actual configured GLB", () => {
  test("Template saves materialize actual bytes with frozen requirement/parameters and retain prior configured files", async () => {
    const f = fixture();
    let p = await f.repo.create({ text: "检查来源相机的支持配置" }, "new");
    const req = p.requirements[0].id;
    p = await f.repo.useTemplate(
      p.id,
      "sample-inspection",
      { inspectionCameraHeight: 0.025 },
      "save-1",
    );
    const first = p.artifacts.find((item) => item.kind === "model")!;
    assert.equal(first.status, "ready");
    assert.equal(first.requirementId, req);
    assert.equal(first.assetKey, "inspection-reference");
    assert.deepEqual(first.parameterSnapshot, {
      inspectionCameraHeight: 0.025,
    });
    assert.match(first.fileName, new RegExp(first.id));
    assert.equal(first.sizeBytes, f.outputs.get(first.id)!.byteLength);
    assert.equal(first.sha256, hash(f.outputs.get(first.id)!));
    const embedded = glbJson(f.outputs.get(first.id)!).asset.extras
      .embodexConfiguredExport;
    assert.deepEqual(embedded.provenance, first.modelRecipe!.provenance);
    assert.deepEqual(embedded.parameterSnapshot, first.parameterSnapshot);
    const old = structuredClone(first);
    const crossed = structuredClone(p),
      wrong = crossed.artifacts.find((item) => item.id === first.id)!;
    wrong.assetKey = "mobile-reference";
    wrong.parameterSnapshot = { mobileCameraHeight: 0.015 };
    wrong.modelRecipe = {
      ...wrong.modelRecipe!,
      assetKey: "mobile-reference",
      parameterSnapshot: { mobileCameraHeight: 0.015 },
    };
    wrong.url = previewModelUrl(wrong.modelRecipe);
    assert.equal(
      canDownload(crossed, wrong),
      false,
      "a valid mobile recipe cannot masquerade as an inspection template",
    );
    p = await f.repo.saveRequirements(
      p.id,
      { text: "另一个需求版本，不覆盖之前文件" },
      "req-2",
    );
    p = await f.repo.useTemplate(
      p.id,
      "sample-inspection",
      { inspectionCameraHeight: -0.025 },
      "save-2",
    );
    const second = p.artifacts.filter((item) => item.kind === "model").at(-1)!;
    assert.notEqual(second.fileName, first.fileName);
    assert.notEqual(second.sha256, first.sha256);
    assert.notEqual(second.requirementId, req);
    assert(canDownload(p, first) && canDownload(p, second));
    assert.deepEqual(
      p.artifacts.find((item) => item.id === first.id),
      old,
    );
    assert.equal(p.tasks.length, 0);
    assert.equal(p.cadRuns.length, 0);
    for (const document of p.artifacts.filter(
      (item) => item.kind === "design_document",
    ))
      assert(canDownload(p, document));
  });

  test("Approval and CAD keep the original requirement/description/configuration after a new requirement and revision", async () => {
    const f = fixture();
    const initialState = await concept(f);
    let p = initialState.p;
    const branch = initialState.branch;
    const initial = branch.revisions[0],
      originalReq = p.requirements[0].id;
    const callerParams = { inspectionCameraHeight: 0.025 };
    p = await f.repo.refine(
      p.id,
      branch.id,
      initial.id,
      "相机上移25毫米",
      "refine-1",
      callerParams,
    );
    callerParams.inspectionCameraHeight = 0.05;
    f.advance();
    p = await f.repo.syncTask(p.id);
    const selected = p.branches
      .find((item) => item.id === branch.id)!
      .revisions.at(-1)!;
    assert.deepEqual(selected.parameterSnapshot, {
      inspectionCameraHeight: 0.025,
    });
    assert.equal(selected.parentRevisionId, initial.id);
    p = await f.repo.approve(p.id, branch.id, selected.id, "approve-1");
    const approved = structuredClone(p.approvals[0]);
    p = await f.repo.saveRequirements(
      p.id,
      { text: "后来的需求，不可偷换之前批准" },
      "req-later",
    );
    p = await f.repo.refine(
      p.id,
      branch.id,
      initial.id,
      "基于V01另做下移方案",
      "refine-old",
      { inspectionCameraHeight: -0.025 },
    );
    f.advance();
    p = await f.repo.syncTask(p.id);
    const latest = p.branches
      .find((item) => item.id === branch.id)!
      .revisions.at(-1)!;
    assert.equal(latest.parentRevisionId, initial.id);
    assert.notEqual(latest.requirementId, originalReq);
    assert.match(latest.description, new RegExp(initial.id));
    p = await finishCad(f, p, approved.id, "cad-1");
    const run = p.cadRuns[0],
      task = p.tasks.find((item) => item.id === run.taskId)!,
      model = p.artifacts.find((item) => item.cadRunId === run.id)!;
    assert.equal(task.requirementId, originalReq);
    assert.equal(run.requirementId, originalReq);
    assert.equal(model.requirementId, originalReq);
    assert.equal(task.sourceDescription, approved.description);
    assert.equal(run.sourceDescription, approved.description);
    for (const snapshot of [approved, task, run, model])
      assert.deepEqual(snapshot.parameterSnapshot, {
        inspectionCameraHeight: 0.025,
      });
    assert.equal(model.modelRecipe!.provenance.revisionId, selected.id);
    assert.equal(model.modelRecipe!.provenance.cadRunId, run.id);
    assert.match(model.fileName, /-V02-/);
    assert.equal(model.sha256, hash(f.outputs.get(model.id)!));
    assert(canDownload(p, model));
    p = await f.repo.approve(p.id, branch.id, latest.id, "approve-2");
    p = await finishCad(f, p, p.approvals.at(-1)!.id, "cad-2");
    const next = p.artifacts.filter((item) => item.kind === "model").at(-1)!;
    assert.notEqual(next.sha256, model.sha256);
    assert.notEqual(next.cadRunId, model.cadRunId);
    assert(canDownload(p, model));
    assert.deepEqual(p.approvals[0], approved);
  });

  test("Export failure is a file failure, not a fake ready model or another CAD submission; explicit sync retries the same file", async () => {
    let attempts = 0;
    const f = fixture(async (artifact) => {
      if (++attempts === 1) throw new Error("本地导出暂时不可用");
      const result = await actualMaterialize(artifact);
      return {
        sizeBytes: result.byteLength,
        sha256: result.sha256,
        sourceSha256: result.sourceSha256,
      };
    });
    let p = await f.repo.create({ text: "重试同一个冻结文件" }, "new");
    p = await f.repo.useTemplate(
      p.id,
      "sample-mobile",
      { mobileCameraHeight: 0.015 },
      "save",
    );
    const failed = p.artifacts.find((item) => item.kind === "model")!;
    assert.equal(failed.status, "failed");
    assert.equal(failed.sizeBytes, 0);
    assert.equal(canDownload(p, failed), false);
    p = await f.repo.syncTask(p.id);
    const ready = p.artifacts.find((item) => item.id === failed.id)!;
    assert.equal(ready.status, "ready");
    assert(ready.sha256);
    assert.equal(p.artifacts.filter((item) => item.kind === "model").length, 1);
    assert.equal(p.cadRuns.length, 0);
    assert.equal(p.tasks.length, 0);
    assert.equal(attempts, 2);
  });

  test("Asynchronous materialization only updates its own artifact and cannot overwrite a concurrent requirement or route save", async () => {
    let release!: (result: ArtifactMaterialization) => void;
    let requested!: Artifact;
    const gate = new Promise<ArtifactMaterialization>((resolve) => {
      release = resolve;
    });
    const f = fixture(async (artifact) => {
      requested = artifact;
      return gate;
    });
    let p = await f.repo.create({ text: "原始需求" }, "new");
    const original = p.requirements[0].id;
    const pending = f.repo.useTemplate(
      p.id,
      "sample-inspection",
      { inspectionCameraHeight: 0.02 },
      "save",
    );
    assert(requested);
    p = await f.repo.get(p.id);
    const before = p.artifacts.find((item) => item.kind === "model")!;
    assert.equal(before.status, "validating");
    assert.equal(before.sizeBytes, 0);
    assert.equal(canDownload(p, before), false);
    await f.repo.saveRequirements(
      p.id,
      { text: "并发保存的需求必须保留" },
      "concurrent",
    );
    await f.repo.chooseRoute(p.id, "custom");
    const exported = await actualMaterialize(requested);
    release({
      sizeBytes: exported.byteLength,
      sha256: exported.sha256,
      sourceSha256: exported.sourceSha256,
    });
    p = await pending;
    assert.equal(p.requirements.length, 2);
    assert.equal(p.requirements[1].text, "并发保存的需求必须保留");
    assert.equal(p.route, "custom");
    const saved = p.artifacts.find((item) => item.id === before.id)!;
    assert.equal(saved.requirementId, original);
    assert.equal(saved.status, "ready");
    const document = p.artifacts.find((item) =>
      item.mimeType.startsWith("text/html"),
    )!;
    assert.equal(document, undefined, "A superseded route/requirement cannot finalize a report after export finishes");
  });

  test("Changing any frozen task/run/file/recipe source rejects delivery and never borrows mutable project parameters", async () => {
    const f = fixture();
    const initialState = await concept(f);
    let p = initialState.p;
    const branch = initialState.branch;
    p = await f.repo.approve(
      p.id,
      branch.id,
      branch.revisions[0].id,
      "approve",
    );
    p = await finishCad(f, p, p.approvals[0].id, "cad");
    const model = p.artifacts.find((item) => item.kind === "model")!;
    assert(canDownload(p, model));
    for (const tamper of [
      (value: Project) => {
        value.approvals[0].parameterSnapshot = {
          inspectionCameraHeight: 0.025,
        };
      },
      (value: Project) => {
        value.tasks.find((item) => item.type === "cad")!.requirementId =
          "other";
      },
      (value: Project) => {
        value.tasks.find((item) => item.type === "cad")!.sourceDescription =
          "other";
      },
      (value: Project) => {
        value.cadRuns[0].sourceDescription = "other";
      },
      (value: Project) => {
        value.cadRuns[0].parameterSnapshot = { inspectionCameraHeight: 0.025 };
      },
      (value: Project) => {
        value.artifacts.find(
          (item) => item.id === model.id,
        )!.parameterSnapshot = { inspectionCameraHeight: 0.025 };
      },
      (value: Project) => {
        value.artifacts.find((item) => item.id === model.id)!.requirementId =
          "other";
      },
      (value: Project) => {
        value.artifacts.find(
          (item) => item.id === model.id,
        )!.modelRecipe!.provenance.cadRunId = "other";
      },
      (value: Project) => {
        value.artifacts.find((item) => item.id === model.id)!.sha256 = "";
      },
    ]) {
      const invalid = structuredClone(p);
      tamper(invalid);
      assert.equal(
        canDownload(
          invalid,
          invalid.artifacts.find((item) => item.id === model.id)!,
        ),
        false,
      );
    }
    p.parameters = { inspectionCameraHeight: 0.04 };
    assert(canDownload(p, model));
    assert(approvalSourceValid(p, p.approvals[0]));
    assert(runSourceValid(p, p.cadRuns[0]));
  });

  test("Unsupported topology/parameters do not pretend to rebuild geometry; supported values are frozen at submission", async () => {
    const f = fixture();
    const initialState = await concept(f);
    let p = initialState.p;
    const branch = initialState.branch;
    const revision = branch.revisions[0],
      before = JSON.stringify(p);
    await assert.rejects(
      () =>
        f.repo.refine(p.id, branch.id, revision.id, "增加一条腿", "bad", {
          legCount: 5,
        }),
      /参数不在/,
    );
    assert.equal(JSON.stringify(await f.repo.get(p.id)), before);
    p = await f.repo.refine(
      p.id,
      branch.id,
      revision.id,
      "讨论增加支撑结构",
      "text-only",
    );
    f.advance();
    p = await f.repo.syncTask(p.id);
    const next = p.branches
      .find((item) => item.id === branch.id)!
      .revisions.at(-1)!;
    assert.equal(next.assetKey, revision.assetKey);
    assert.match(next.description, /文字要求不会自动重建任意拓扑/);
    assert.equal(p.cadRuns.length, 0);
  });
  test("Reference-template configuration is captured by the concept task; later template changes cannot leak into its candidates", async () => {
    const f = fixture();
    let p = await f.repo.create(
      { text: "从保存的巡检相机配置继续探索" },
      "new-reference",
    );
    p = await f.repo.useTemplate(
      p.id,
      "sample-inspection",
      { inspectionCameraHeight: 0.025 },
      "reference-q4",
    );
    p = await f.repo.chooseRoute(p.id, "custom");
    p = await f.repo.generateConcepts(p.id, 3, "reference-concepts");
    const task = p.tasks.at(-1)!;
    assert.equal(task.referenceTemplateId, "sample-inspection");
    assert.deepEqual(task.referenceParameterSnapshot, {
      inspectionCameraHeight: 0.025,
    });
    await f.repo.useTemplate(
      p.id,
      "sample-mobile",
      { mobileCameraHeight: -0.015 },
      "different-template",
    );
    await f.repo.chooseRoute(p.id, "custom");
    f.advance();
    p = await f.repo.syncTask(p.id, task.id);
    const q4 = p.branches.find(
      (item) => item.revisions[0].assetKey === "inspection-reference",
    )!.revisions[0];
    const c2 = p.branches.find(
      (item) => item.revisions[0].assetKey === "mobile-reference",
    )!.revisions[0];
    assert.deepEqual(q4.parameterSnapshot, { inspectionCameraHeight: 0.025 });
    assert.equal(q4.referenceTemplateId, "sample-inspection");
    assert.deepEqual(c2.parameterSnapshot, { mobileCameraHeight: 0 });
    assert.deepEqual(c2.referenceParameterSnapshot, {
      inspectionCameraHeight: 0.025,
    });
    assert.match(c2.description, /结构不同.*不套用/);
  });
  test("File-pending keeps an actually verified GLB unavailable until synchronization releases that explicit preview state", async () => {
    const f = fixture();
    let p = await f.repo.create({ text: "计算与文件可用分开" }, "new-pending");
    f.repo.setScenario("files-pending");
    p = await f.repo.useTemplate(
      p.id,
      "sample-mobile",
      { mobileCameraHeight: 0.01 },
      "save-pending",
    );
    const file = p.artifacts.find((item) => item.kind === "model")!;
    assert.equal(file.status, "validating");
    assert(file.sizeBytes > 0 && file.sha256);
    assert.equal(canDownload(p, file), false);
    const frozen = structuredClone(file);
    f.repo.setScenario("success");
    p = await f.repo.syncTask(p.id);
    const ready = p.artifacts.find((item) => item.id === file.id)!;
    assert.equal(ready.status, "ready");
    assert.equal(ready.sha256, frozen.sha256);
    assert.deepEqual(ready.modelRecipe, frozen.modelRecipe);
    assert(canDownload(p, ready));
    assert.equal(p.tasks.length, 0);
    assert.equal(p.cadRuns.length, 0);
  });
  test("Invalid materializer metadata cannot turn an unknown file into ready", async () => {
    const f = fixture(async () => ({
      sizeBytes: 0,
      sha256: "bad",
      sourceSha256: "bad",
    }));
    let p = await f.repo.create(
      { text: "拒绝虚假的文件元数据" },
      "new-invalid",
    );
    p = await f.repo.useTemplate(p.id, "sample-go2", {}, "save-invalid");
    const file = p.artifacts.find((item) => item.kind === "model")!;
    assert.equal(file.status, "failed");
    assert.equal(canDownload(p, file), false);
    assert.equal(file.sizeBytes, 0);
    assert.match(file.error!, /实际大小和摘要/);
  });
});
