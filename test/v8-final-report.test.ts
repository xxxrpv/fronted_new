import { test } from "node:test";
import assert from "node:assert/strict";
import { readableDesignText } from "../lib/v8/presentation";
import {
  PreviewRepository,
  type Artifact,
  type StoragePort,
} from "../lib/v8/repository";
import {
  finalReportReadiness,
  groupDeliveryPackages,
  selectDeliveryPackage,
} from "../lib/v8/delivery-packages";

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
const html = (p: Awaited<ReturnType<PreviewRepository["get"]>>) =>
  p.artifacts.filter((a) => a.mimeType.startsWith("text/html"));
function fixture() {
  const storage = new MemoryStorage();
  let clock = Date.parse("2026-11-16T01:00:00Z"),
    fail = false;
  const options = {
    materializeArtifact: async (_artifact: Artifact) => {
      if (fail) throw Error("export unavailable");
      // Domain contract stub; configured-GLB tests separately validate actual bytes.
      return {
        sizeBytes: 100,
        sha256: "a".repeat(64),
        sourceSha256: "b".repeat(64),
      };
    },
  };
  return {
    storage,
    repo: new PreviewRepository(storage, () => clock, options),
    reopen: () => new PreviewRepository(storage, () => clock, options),
    advance: () => {
      clock += 3000;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
test("Template final HTML waits for file preparation; a failed export is retryable without CAD or duplicate files", async () => {
  const f = fixture();
  let p = await f.repo.create({ text: "巡检" }, "new");
  f.fail(true);
  p = await f.repo.useTemplate(
    p.id,
    "sample-inspection",
    { inspectionCameraHeight: 0 },
    "save",
  );
  assert.equal(html(p).length, 0);
  assert.equal(p.cadRuns.length, 0);
  assert.match(finalReportReadiness(p).missing, /文件准备失败/);
  await assert.rejects(() => f.repo.finalizeReport(p.id), /文件准备失败/);
  f.fail(false);
  p = await f.repo.syncTask(p.id);
  assert.equal(html(p).length, 1);
  assert.equal(p.cadRuns.length, 0);
  const snapshot = structuredClone(html(p)[0]);
  p = await f.repo.useTemplate(
    p.id,
    "sample-inspection",
    { inspectionCameraHeight: 0 },
    "save-again",
  );
  assert.equal(p.artifacts.filter((a) => a.kind === "model").length, 1);
  await Promise.all([
    f.repo.finalizeReport(p.id),
    f.reopen().finalizeReport(p.id),
  ]);
  p = await f.repo.syncTask(p.id);
  assert.deepEqual(html(p), [snapshot]);
});
test("AI confirmation does not generate HTML; exact successful CAD and ready model finalize once", async () => {
  const f = fixture();
  let p = await f.repo.create({ text: "设计四足巡检" }, "new");
  p = await f.repo.generateConcepts(p.id, 3, "concepts");
  f.advance();
  p = await f.repo.syncTask(p.id);
  const branch = p.branches.find(
    (b) => b.revisions[0].assetKey === "inspection-reference",
  )!;
  p = await f.repo.approve(p.id, branch.id, branch.revisions[0].id, "approve");
  assert.equal(html(p).length, 0);
  await assert.rejects(() => f.repo.finalizeReport(p.id), /工程模型/);
  p = await f.repo.startCad(p.id, p.approvals[0].id, "cad");
  assert.equal(html(p).length, 0);
  f.advance();
  p = await f.repo.syncTask(p.id);
  assert.equal(p.cadRuns[0].status, "succeeded");
  assert.equal(html(p).length, 0);
  f.advance();
  p = await f.repo.syncTask(p.id);
  assert.equal(html(p).length, 1);
  assert.equal(html(p)[0].cadRunId, p.cadRuns[0].id);
  assert(p.cadRuns[0].artifactIds.includes(html(p)[0].id));
  const saved = structuredClone(html(p)[0]);
  p = await f.reopen().syncTask(p.id);
  assert.deepEqual(html(p), [saved]);
});
test("Pending files and failed engineering cannot finalize; no HTML is created by reads", async () => {
  const f = fixture();
  let p = await f.repo.create({ text: "巡检" }, "new");
  f.repo.setScenario("files-pending");
  p = await f.repo.useTemplate(
    p.id,
    "sample-inspection",
    { inspectionCameraHeight: 0 },
    "save",
  );
  assert.equal(html(p).length, 0);
  const before = f.storage.getItem("embodex-v8-preview-v1");
  await f.repo.get(p.id);
  await f.repo.list();
  assert.equal(f.storage.getItem("embodex-v8-preview-v1"), before);
  await assert.rejects(() => f.repo.finalizeReport(p.id), /尚未就绪/);
  f.repo.setScenario("success");
  p = await f.repo.syncTask(p.id);
  assert.equal(html(p).length, 1);
  let ai = await f.repo.create({ text: "四足巡检" }, "ai");
  ai = await f.repo.generateConcepts(ai.id, 3, "g");
  f.advance();
  ai = await f.repo.syncTask(ai.id);
  ai = await f.repo.approve(
    ai.id,
    ai.branches[0].id,
    ai.branches[0].revisions[0].id,
    "a",
  );
  f.repo.setScenario("failure");
  ai = await f.repo.startCad(ai.id, ai.approvals[0].id, "c");
  f.advance();
  ai = await f.repo.syncTask(ai.id);
  assert.equal(html(ai).length, 0);
  assert.match(finalReportReadiness(ai).missing, /失败/);
  await assert.rejects(() => f.repo.finalizeReport(ai.id), /失败/);
});
test("A new requirement or concept cannot borrow old final files, including an old package deep link", async () => {
  const f = fixture();
  let p = await f.repo.get("demo-example-complete-inspection");
  const old = structuredClone(p.artifacts),
    oldKey = groupDeliveryPackages(p)[0].key;
  p = await f.repo.saveRequirements(p.id, { text: "新的巡检目标" }, "edit");
  assert.equal(
    selectDeliveryPackage(groupDeliveryPackages(p), oldKey),
    undefined,
  );
  assert.equal(finalReportReadiness(p).ready, false);
  await assert.rejects(() => f.repo.finalizeReport(p.id), /确认/);
  assert.deepEqual((await f.repo.get(p.id)).artifacts, old);
});
test("Legacy projects without HTML only finalize when the same current source is complete, retaining Markdown records", async () => {
  const f = fixture();
  await f.repo.list();
  const key = "embodex-v8-preview-v1";
  const store = JSON.parse(f.storage.getItem(key)!);
  for (const p of store.projects)
    p.artifacts = p.artifacts.filter(
      (a: Artifact) => !a.mimeType.startsWith("text/html"),
    );
  const ai = store.projects.find(
    (p: { id: string }) => p.id === "demo-example-complete-inspection",
  );
  ai.cadRuns[0].status = "failed";
  f.storage.setItem(key, JSON.stringify(store));
  let p = await f.repo.get("demo-example-q4-inspection");
  assert.equal(finalReportReadiness(p).ready, true);
  const md = p.artifacts.find((a) => a.mimeType.startsWith("text/markdown"))!;
  p = await f.repo.finalizeReport(p.id);
  assert.equal(html(p).length, 1);
  assert.deepEqual(
    p.artifacts.find((a) => a.id === md.id),
    md,
  );
  await assert.rejects(() => f.repo.finalizeReport(ai.id), /失败/);
  assert.equal(html(await f.repo.get(ai.id)).length, 0);
});

test("A mismatched engineering source, model configuration or pending task cannot finalize a legacy report", async () => {
  for (const invalidate of [
    (p: Awaited<ReturnType<PreviewRepository["get"]>>) => {
      p.cadRuns[0].sourceDescription += "changed";
    },
    (p: Awaited<ReturnType<PreviewRepository["get"]>>) => {
      p.artifacts.find((a) => a.kind === "model")!.parameterSnapshot = {
        inspectionCameraHeight: 0.04,
      };
    },
    (p: Awaited<ReturnType<PreviewRepository["get"]>>) => {
      p.tasks.find((t) => t.id === p.cadRuns[0].taskId)!.status = "running";
    },
  ]) {
    const f = fixture();
    const p = await f.repo.get("demo-example-complete-inspection");
    p.artifacts = p.artifacts.filter(
      (a) => !a.mimeType.startsWith("text/html"),
    );
    invalidate(p);
    const store = JSON.parse(f.storage.getItem("embodex-v8-preview-v1")!);
    store.projects = store.projects.map((item: typeof p) =>
      item.id === p.id ? p : item,
    );
    f.storage.setItem("embodex-v8-preview-v1", JSON.stringify(store));
    assert.equal(finalReportReadiness(p).ready, false);
    await assert.rejects(() => f.repo.finalizeReport(p.id));
    assert.equal(html(await f.repo.get(p.id)).length, 0);
  }
});

test("Readable descriptions preserve the stored source and user instructions while omitting generated internal references", async () => {
  const p = await fixture().repo.get("demo-example-complete-inspection");
  const r = p.branches[0].revisions[0],
    req = p.requirements[0];
  const text = `本次修订基于 V01（${r.id}）。\n本次需求版本：${req.id}\n保留相机，维修净空 40 mm。\n- 项目：${p.id}\n- 方向：${p.branches[0].id}`;
  const original = structuredClone(p);
  const display = readableDesignText(p, text);
  assert(display.includes("保留相机，维修净空 40 mm。"));
  for (const id of [r.id, req.id, p.id, p.branches[0].id])
    assert(!display.includes(id));
  assert(display.includes("V01"));
  assert.deepEqual(p, original);
  assert(text.includes(r.id));
});
