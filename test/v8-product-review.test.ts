import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewRepository, type StoragePort } from "../lib/v8/repository";
import { projectResumePath } from "../lib/v8/project-navigation";
import { groupDeliveryPackages } from "../lib/v8/delivery-packages";
import { createDesignReport } from "../lib/v8/design-report";
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
const examples = () => new PreviewRepository(new MemoryStorage()).list();

test("Reopening a delivery does not restore the previously inspected history package", async () => {
  const p = (await examples())[0];
  const key = groupDeliveryPackages(p)[0].key;
  assert.equal(
    projectResumePath(p, `delivery?package=${encodeURIComponent(key)}`),
    "delivery",
  );
});
test("Project reopening restores an exact historical concept without changing design state", async () => {
  const p = (await examples()).find((p) => p.id === "demo-example-ai-review")!;
  const branch = p.branches[0],
    revision = branch.revisions[0];
  const path = `concepts/${branch.id}?revision=${revision.id}`,
    before = JSON.stringify(p);
  assert.equal(projectResumePath(p, path), path);
  assert.equal(JSON.stringify(p), before);
});
test("Project reopening restores a specific engineering record", async () => {
  const p = (await examples()).find((p) => p.id === "demo-example-ai-review")!;
  const path = `cad?run=${p.cadRuns[0].id}`;
  assert.equal(projectResumePath(p, path), path);
});
test("Deleted or foreign view references cannot be restored as valid project state", async () => {
  const p = (await examples()).find((p) => p.id === "demo-example-ai-review")!;
  for (const path of [
    "concepts/foreign?revision=foreign",
    "cad?run=foreign",
    "delivery?package=foreign",
    "https://example.com/",
    "../cad",
  ])
    assert.notEqual(projectResumePath(p, path), path);
});
test("A draft cannot resume an unavailable future stage", async () => {
  const repo = new PreviewRepository(new MemoryStorage());
  const p = await repo.create({ text: "新设计，尚未选择路线" }, "new");
  assert.equal(projectResumePath(p, "cad"), "requirements");
  assert.equal(projectResumePath(p, "delivery"), "requirements");
});
test("Newer unconfirmed concepts are the continuation target when no current complete delivery exists", async () => {
  const p = (await examples()).find((p) => p.id === "demo-example-ai-review")!;
  p.artifacts = [];
  p.cadRuns = [];
  assert.equal(projectResumePath(p), "concepts");
});
test("Report file table excludes other configurations of the same source template", async () => {
  const p = (await examples()).find(
    (p) => p.id === "demo-example-q4-inspection",
  )!;
  const source = p.artifacts.find((a) => a.kind === "model")!;
  p.artifacts.push({
    ...source,
    id: "other-config",
    fileName: "other-configuration.glb",
    parameterSnapshot: { inspectionCameraHeight: 0.025 },
  });
  const report = createDesignReport(p, {
    templateId: p.templateId,
    parameters: p.parameters,
  });
  assert(report.html.includes(source.fileName));
  assert(!report.html.includes("other-configuration.glb"));
});
test("Report file table excludes other requirements while retaining matching source files", async () => {
  const p = (await examples()).find(
    (p) => p.id === "demo-example-q4-inspection",
  )!;
  const source = p.artifacts.find((a) => a.kind === "model")!;
  p.artifacts.push({
    ...source,
    id: "other-req",
    fileName: "other-requirement.glb",
    requirementId: "older-requirement",
  });
  const report = createDesignReport(p, {
    templateId: p.templateId,
    parameters: p.parameters,
  });
  assert(report.html.includes(source.fileName));
  assert(!report.html.includes("other-requirement.glb"));
});
