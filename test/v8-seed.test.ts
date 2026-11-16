import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PreviewRepository,
  type Project,
  type StoragePort,
  canDownload,
  runSourceValid,
  recommendTemplates,
} from "../lib/v8/repository";
import {
  createTypicalExampleProjects,
  createRetiredGo2Example,
  PREVIEW_EXAMPLE_IDS,
  PREVIEW_EXAMPLE_VERSION,
  RETIRED_EXAMPLE_REDIRECTS,
  LEGACY_CONCEPT_FIXTURE,
} from "../lib/v8/example-projects";
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
const key = "embodex-v8-preview-v1",
  now = () => Date.parse("2026-11-14T03:00:00Z");
const legacy = (storage: StoragePort) =>
  new PreviewRepository(storage, now, { seedPreset: "legacy-fixture" });
function snapshot(storage: MemoryStorage) {
  return JSON.parse(storage.getItem(key)!);
}
function historicalConcepts(project: Project) {
  for (let index = 0; index < 3; index++) {
    const item = LEGACY_CONCEPT_FIXTURE[index],
      branch = project.branches[index],
      revision = branch.revisions[0];
    branch.name = item.name;
    branch.differentiator = item.differentiator;
    branch.rationale = item.rationale;
    branch.limitation = item.limitation;
    revision.assetKey = item.assetKey;
    revision.mediaType = item.mediaType;
    revision.description = `开发样例方向：${item.name}。${item.differentiator}。\n用户需求（作为来源保留，不代表样例已满足）：${project.requirements[0].text}\n${item.limitation}`;
    project.journey[index + 1].message = `新增方向“${branch.name}” V01`;
  }
}
describe("Four useful defaults and conservative known-seed cleanup", () => {
  test("Fresh preview includes Q4, C2, version-review and complete-workflow examples, not hidden retired projects", async () => {
    const storage = new MemoryStorage(),
      repo = new PreviewRepository(storage, now);
    const projects = await repo.list();
    assert.equal(projects.length, 4);
    assert.deepEqual(
      new Set(projects.map((p) => p.id)),
      new Set(PREVIEW_EXAMPLE_IDS),
    );
    assert.equal(
      projects.some((p) =>
        [
          "demo-project-1",
          "demo-project-5",
          "demo-example-go2-reference",
        ].includes(p.id),
      ),
      false,
    );
    assert.deepEqual(
      createTypicalExampleProjects(),
      createTypicalExampleProjects(),
    );
    const user = await repo.create({ text: "真正的新需求" }, "new");
    assert.equal(user.id, "demo-project-65");
  });
  test("Template defaults retain real detailed GLBs, frozen HTML/MD and correct source/parameter snapshots", async () => {
    const repo = new PreviewRepository(new MemoryStorage(), now);
    for (const id of PREVIEW_EXAMPLE_IDS.slice(0, 2)) {
      const p = await repo.get(id);
      assert.equal(p.route, "library");
      assert.equal(p.artifacts.length, 3);
      assert.equal(p.tasks.length, 0);
      const model = p.artifacts.find((a) => a.kind === "model")!;
      assert(canDownload(p, model));
      const file = readFileSync(path.resolve("public", model.url!.slice(1)));
      assert.equal(file.subarray(0, 4).toString(), "glTF");
      assert.equal(file.length, model.sizeBytes);
      const html = p.artifacts.find((a) => a.mimeType.startsWith("text/html"))!,
        md = p.artifacts.find((a) => a.mimeType.startsWith("text/markdown"))!;
      assert(canDownload(p, html) && canDownload(p, md));
      assert.equal(html.requirementId, p.requirements[0].id);
      assert.deepEqual(html.parameterSnapshot, p.parameters);
      assert.equal(Buffer.byteLength(html.content!), html.sizeBytes);
      assert.match(html.content!, /已登记 1 个可用模型文件/);
      assert.equal(recommendTemplates(p).templates[0].id, p.templateId);
      if (p.templateId === "sample-mobile") {
        assert.equal(model.source, "supplied-concept-reference");
        assert.doesNotMatch(model.license!, /CC0/);
      }
    }
  });
  test("AI example retains independent versions and exact approval/task/model ownership without claiming verification", async () => {
    const repo = new PreviewRepository(new MemoryStorage(), now),
      p = await repo.get(PREVIEW_EXAMPLE_IDS[2]);
    assert.deepEqual(
      p.branches.map((b) => b.revisions.length),
      [2, 1],
    );
    const a = p.approvals[0],
      r = p.branches[0].revisions[1],
      run = p.cadRuns[0],
      model = p.artifacts.find((a) => a.kind === "model")!;
    assert.equal(a.revisionId, r.id);
    assert.equal(a.descriptionId, r.descriptionId);
    assert.equal(a.description, r.description);
    assert.equal(p.tasks[0].approvalId, a.id);
    assert(runSourceValid(p, run));
    assert.equal(run.validationStatus, "not_run");
    assert.equal(model.cadRunId, run.id);
    assert.equal(run.artifactIds[0], model.id);
    for (const artifact of p.artifacts) assert(canDownload(p, artifact));
    assert.match(p.tasks[0].currentStep, /未执行真实 CAD/);
  });
  test("Complete-workflow example has a ready brief, confirmed version, source model and readable report without replacing saved projects", async () => {
    const storage=new MemoryStorage(),repo=new PreviewRepository(storage,now);
    const original=await repo.list();
    const stored=snapshot(storage);stored.exampleSeedVersion=2;
    stored.projects=stored.projects.filter((p:Project)=>p.id!==PREVIEW_EXAMPLE_IDS[3]);
    storage.setItem(key,JSON.stringify(stored));
    const reopened=new PreviewRepository(storage,now),p=await reopened.get(PREVIEW_EXAMPLE_IDS[3]);
    assert.equal(p.requirements[0].status,'ready');assert.deepEqual(p.requirements[0].missingFields,[]);
    assert(p.branches.length>1 && p.branches[0].revisions.length>1);
    assert(runSourceValid(p,p.cadRuns[0]));
    const report=p.artifacts.find(a=>a.mimeType.startsWith('text/html'))!;
    assert(canDownload(p,report));assert(report.content?.includes('12 个设备测点'));
    assert.equal(report.requirementId,p.requirements[0].id);
    assert.equal(report.approvalId,p.approvals[0].id);
    for(const previous of original.filter(item=>item.id!==p.id))assert.deepEqual(await reopened.get(previous.id),previous);
  });
  test("Unmodified initial two plus the redundant Go2 example are removed only by exact known snapshot match", async () => {
    const storage = new MemoryStorage();
    await legacy(storage).list();
    const store = snapshot(storage);
    assert.deepEqual(
      store.projects.map((p: Project) => p.id),
      ["demo-project-1", "demo-project-5"],
    );
    store.projects.push(
      ...createTypicalExampleProjects(),
      createRetiredGo2Example(),
    );
    store.exampleSeedVersion = 1;
    storage.setItem(key, JSON.stringify(store));
    const projects = await new PreviewRepository(storage, now).list();
    assert.equal(projects.length, 4);
    assert.deepEqual(
      new Set(projects.map((p) => p.id)),
      new Set(PREVIEW_EXAMPLE_IDS),
    );
    assert.equal(snapshot(storage).exampleSeedVersion, PREVIEW_EXAMPLE_VERSION);
    assert.equal(
      RETIRED_EXAMPLE_REDIRECTS["demo-project-1"],
      PREVIEW_EXAMPLE_IDS[0],
    );
    assert.equal(
      RETIRED_EXAMPLE_REDIRECTS["demo-project-5"],
      PREVIEW_EXAMPLE_IDS[2],
    );
    assert.equal(RETIRED_EXAMPLE_REDIRECTS["unknown-project"], undefined);
  });
  test("The historical coarse concept seed is recognized conservatively, while unknown fields prevent deletion", async () => {
    const storage = new MemoryStorage();
    await legacy(storage).list();
    const store = snapshot(storage);
    historicalConcepts(store.projects[1]);
    storage.setItem(key, JSON.stringify(store));
    const projects = await new PreviewRepository(storage, now).list();
    assert.equal(projects.length, 4);
    const secondStorage = new MemoryStorage();
    await legacy(secondStorage).list();
    const second = snapshot(secondStorage);
    second.projects[0].userNotes = "不能删去的用户元数据";
    storageSafe(secondStorage, second);
    assert.equal(
      (await new PreviewRepository(secondStorage, now).list()).some(
        (p) => p.id === "demo-project-1",
      ),
      true,
    );
  });
  test("Edited original, edited Go2 and every unknown user project survive, with histories/intents/sequence/scenario unchanged", async () => {
    const storage = new MemoryStorage(),
      repo = legacy(storage);
    let p = (await repo.list())[0];
    p = await repo.saveRequirements(
      p.id,
      { text: "用户修改了原始示例需求" },
      "edit-original",
    );
    const user = await repo.create(
      { name: "已有用户项目", text: "私有需求" },
      "user-project",
    );
    const store = snapshot(storage),
      go2 = createRetiredGo2Example();
    go2.name = "用户改过的 Go2 项目";
    store.projects.push(go2);
    store.scenario = "offline";
    store.exampleSeedVersion = 1;
    const before = structuredClone(store);
    storageSafe(storage, store);
    const migrated = await new PreviewRepository(storage, now).list();
    const saved = snapshot(storage);
    for (const previous of [p, user, go2])
      assert.deepEqual(
        migrated.find((item) => item.id === previous.id),
        previous,
      );
    assert.equal(
      migrated.some((item) => item.id === "demo-project-5"),
      false,
    );
    assert.deepEqual(saved.intents, before.intents);
    assert.equal(saved.sequence, before.sequence);
    assert.equal(saved.scenario, "offline");
  });
  test("Existing active example edits survive; once migrated, deleted defaults never reappear", async () => {
    const storage = new MemoryStorage(),
      repo = new PreviewRepository(storage, now),
      id = PREVIEW_EXAMPLE_IDS[0];
    const edited = await repo.saveRequirements(
      id,
      { text: "用户继续修改仓储巡检" },
      "edit",
    );
    const store = snapshot(storage);
    store.exampleSeedVersion = 1;
    store.projects.push(createRetiredGo2Example());
    storageSafe(storage, store);
    const reopened = new PreviewRepository(storage, now);
    assert.deepEqual(await reopened.get(id), edited);
    const current = snapshot(storage);
    current.projects = current.projects.filter(
      (p: Project) => p.id !== PREVIEW_EXAMPLE_IDS[1],
    );
    storageSafe(storage, current);
    const raw = storage.getItem(key);
    assert.equal(
      (await reopened.list()).some((p) => p.id === PREVIEW_EXAMPLE_IDS[1]),
      false,
    );
    assert.equal(storage.getItem(key), raw);
  });
  test("Seed IDs are globally unique and production refuses fixture construction", () => {
    const ids: string[] = [];
    for (const p of createTypicalExampleProjects())
      ids.push(
        p.id,
        ...p.requirements.flatMap((r) => [r.id, ...r.sources.map((s) => s.id)]),
        ...p.branches.flatMap((b) => [
          b.id,
          ...b.revisions.flatMap((r) => [r.id, r.descriptionId]),
        ]),
        ...p.approvals.map((a) => a.id),
        ...p.tasks.map((t) => t.id),
        ...p.cadRuns.map((r) => r.id),
        ...p.artifacts.map((a) => a.id),
        ...p.journey.map((e) => e.id),
      );
    assert.equal(new Set(ids).size, ids.length);
    const environment = process.env.NODE_ENV;
    try {
      Object.assign(process.env, { NODE_ENV: "production" });
      assert.throws(() => createTypicalExampleProjects(), /生产环境不创建/);
    } finally {
      if (environment === undefined)
        Reflect.deleteProperty(process.env, "NODE_ENV");
      else Object.assign(process.env, { NODE_ENV: environment });
    }
  });
});
function storageSafe(storage: MemoryStorage, store: unknown) {
  storage.setItem(key, JSON.stringify(store));
}
