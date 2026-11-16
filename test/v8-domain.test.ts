import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PreviewRepository,
  LiveRepository,
  getRepository,
  type StoragePort,
  type Project,
  canDownload,
  canDeliver,
  currentRequirement,
  legalStage,
  matchingApproval,
  approvalSourceValid,
  canEnterEngineering,
  recommendTemplates,
  runSourceValid,
  MODEL_BYTES,
  assetPreviewUrl,
  V8Error,
} from "../lib/v8/repository";
import { evaluateRouteGuard } from "../lib/auth-guard";
import { isValidNextUrl } from "../lib/auth-errors";

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
function fixture() {
  let time = Date.parse("2026-11-14T01:00:00Z");
  const storage = new MemoryStorage();
  const repo = new PreviewRepository(storage, () => time, {
    seedPreset: "legacy-fixture",
  });
  return {
    repo,
    storage,
    advance: (ms = 3000) => {
      time += ms;
    },
    now: () => time,
  };
}
async function project(repo: PreviewRepository) {
  return (await repo.list())[1];
}
async function cadFixture() {
  const f = fixture();
  let p = await project(f.repo);
  const b = p.branches[0];
  p = await f.repo.approve(p.id, b.id, b.revisions[0].id, "approve");
  p = await f.repo.startCad(p.id, p.approvals[0].id, "cad");
  f.advance();
  p = await f.repo.syncTask(p.id);
  f.advance();
  p = await f.repo.syncTask(p.id);
  return { ...f, p };
}

describe("V8 P0 contract/state regression — development fixtures, NOT live backend integration", () => {
  test("F01 未登录项目路由保存 returnTo，不渲染私有内容", () => {
    const guard = evaluateRouteGuard(
      "/projects/private/embodex",
      "unauthenticated",
    );
    assert.equal(guard.viewType, "unauthenticated");
    assert.equal(
      guard.redirectUrl,
      "/login?next=%2Fprojects%2Fprivate%2Fembodex",
    );
  });
  test("F02 真实会话守卫支持安全登录返回，服务异常不伪装登出", () => {
    assert.equal(
      evaluateRouteGuard("/login", "authenticated", "/projects/a/embodex")
        .redirectUrl,
      "/projects/a/embodex",
    );
    assert.equal(
      evaluateRouteGuard("/projects/a", "error").shouldRedirect,
      false,
    );
    assert.equal(isValidNextUrl("//attacker"), false);
  });
  test("F03 需求与实际附件内容持久化；不支持文件不假称上传", async () => {
    const { repo } = fixture();
    const file = new File(["负载：2kg"], "requirements.txt", {
      type: "text/plain",
    });
    const source = await repo.upload(file);
    assert.equal(source.text, "负载：2kg");
    assert.equal(source.location, "local-preview");
    let p = await repo.create(
      { text: "巡检机器人", attachments: [source] },
      "new",
    );
    assert.equal(currentRequirement(p)!.sources[1].id, source.id);
    const unsupported = await repo.upload(
      new File(["binary"], "private.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    assert.equal(unsupported.parseStatus, "failed");
    assert.ok(unsupported.error);
    p = await repo.saveRequirements(
      p.id,
      { text: "修订需求", attachments: [source] },
      "req2",
    );
    assert.equal(p.requirements.length, 2);
    assert.equal(p.requirements[0].text, "巡检机器人");
  });
  test("F04 关闭并重建 repository 后恢复项目与未完成任务", async () => {
    const f = fixture();
    let p = await project(f.repo);
    p = await f.repo.generateConcepts(p.id, 1, "more");
    const reopened = new PreviewRepository(f.storage, f.now, {
      seedPreset: "legacy-fixture",
    });
    const restored = await reopened.get(p.id);
    assert.equal(restored.tasks[0].id, p.tasks[0].id);
    assert.equal(restored.tasks[0].status, "queued");
  });
  test("F05 预置模板匹配只返回显式关联的有效模型", async () => {
    const { repo } = fixture();
    const p = (await repo.list()).find((p) => p.name === "园区巡检机器人")!;
    assert.deepEqual(
      recommendTemplates(p).templates.map((t) => t.assetKey),
      ["quadruped"],
    );
  });
  test("F06 无声明匹配的三足需求可以直接 AI 定制", async () => {
    const { repo } = fixture();
    let p = await repo.create({ text: "三足人形机器人" }, "tripod");
    assert.equal(recommendTemplates(p).templates.length, 0);
    p = await repo.chooseRoute(p.id, "custom");
    assert.equal(p.route, "custom");
  });
  test("F07 有模板仍可 AI 定制；项目类型不等同设计路线", async () => {
    const { repo } = fixture();
    let p = (await repo.list())[0];
    p = await repo.chooseRoute(p.id, "custom");
    assert.equal(p.projectType, "EMBODIED_AI");
    assert.equal(p.route, "custom");
    let automation = await repo.create(
      { text: "输送工位", projectType: "AUTOMATION" },
      "automation",
    );
    automation = await repo.chooseRoute(automation.id, "library");
    assert.equal(automation.projectType, "AUTOMATION");
    assert.equal(automation.route, "library");
  });
  test("F08 概念任务排队、运行、部分完成均可观察，没有虚构百分比", async () => {
    const f = fixture();
    let p = await f.repo.create({ text: "测试方向" }, "p");
    f.repo.setScenario("partial");
    p = await f.repo.generateConcepts(p.id, 3, "generate");
    assert.equal(p.tasks[0].status, "queued");
    f.advance(900);
    p = await f.repo.syncTask(p.id);
    assert.equal(p.tasks[0].status, "running");
    assert.equal(p.branches.length, 0);
    f.advance(1800);
    p = await f.repo.syncTask(p.id);
    assert.equal(p.tasks[0].status, "partial");
    assert.equal(p.branches.length, 2);
    assert.equal("progressPercent" in p.tasks[0], false);
  });
  test("F09 只有一个候选时如实展示一个", async () => {
    const f = fixture();
    let p = await f.repo.create({ text: "单方向" }, "p");
    f.repo.setScenario("single");
    p = await f.repo.generateConcepts(p.id, 3, "one");
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.equal(p.branches.length, 1);
  });
  test("F10 新概念追加且无重复卡片补数", async () => {
    const f = fixture();
    let p = await project(f.repo);
    const previous = p.branches.map((b) => b.id);
    p = await f.repo.generateConcepts(p.id, 3, "more");
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.deepEqual(
      p.branches.slice(0, 3).map((b) => b.id),
      previous,
    );
    assert.equal(p.branches.length, 4);
    assert.equal(
      new Set(p.branches.map((b) => b.revisions[0].assetKey)).size,
      4,
    );
  });
  test("F11 两次修改创建 V01/V02/V03，旧描述保持不变", async () => {
    const f = fixture();
    let p = await project(f.repo);
    const b = p.branches[0];
    const original = b.revisions[0];
    p = await f.repo.refine(p.id, b.id, original.id, "增大维护空间", "r2");
    f.advance();
    p = await f.repo.syncTask(p.id);
    p = await f.repo.refine(
      p.id,
      b.id,
      p.branches[0].revisions.at(-1)!.id,
      "提高传感器位置",
      "r3",
    );
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.deepEqual(
      p.branches[0].revisions.map((r) => r.sequence),
      [1, 2, 3],
    );
    assert.deepEqual(p.branches[0].revisions[0], original);
  });
  test("F12 A→B→A 各分支版本保持独立", async () => {
    const f = fixture();
    let p = await project(f.repo);
    const [a, b] = p.branches;
    const originalB = structuredClone(b);
    p = await f.repo.refine(p.id, a.id, a.revisions[0].id, "修改 A", "r");
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.equal(p.branches[0].revisions.length, 2);
    assert.deepEqual(p.branches[1], originalB);
  });
  test("F13 只读 get/list 不创建请求任务或改变批准", async () => {
    const f = await cadFixture();
    const before = structuredClone(f.p);
    await f.repo.get(f.p.id);
    await f.repo.list();
    const after = await f.repo.get(f.p.id);
    assert.deepEqual(after, before);
  });
  test("F14 确认锁定方向、版本、描述和不可变正文", async () => {
    const { repo } = fixture();
    let p = await project(repo);
    const b = p.branches[0],
      r = b.revisions[0];
    p = await repo.approve(p.id, b.id, r.id, "a");
    assert.deepEqual(
      [
        p.approvals[0].branchId,
        p.approvals[0].revisionId,
        p.approvals[0].descriptionId,
        p.approvals[0].description,
      ],
      [b.id, r.id, r.descriptionId, r.description],
    );
    assert.equal(matchingApproval(p, b.id, r.id)!.id, p.approvals[0].id);
  });
  test("F15 CAD 来源严格引用已批准的同一描述", async () => {
    const { p } = await cadFixture();
    assert.equal(runSourceValid(p, p.cadRuns[0]), true);
    assert.equal(
      p.cadRuns[0].sourceDescriptionId,
      p.approvals[0].descriptionId,
    );
    const tampered = structuredClone(p);
    tampered.cadRuns[0].sourceDescriptionId = "other";
    assert.equal(runSourceValid(tampered, tampered.cadRuns[0]), false);
  });
  test("F16 CAD 失败保留成功历史并且不伪造新模型", async () => {
    const f = await cadFixture();
    let p = f.p;
    const before = p.artifacts
      .filter((a) => a.kind === "model")
      .map((a) => a.id);
    const b = p.branches[1];
    p = await f.repo.approve(p.id, b.id, b.revisions[0].id, "b");
    f.repo.setScenario("failure");
    p = await f.repo.startCad(p.id, p.approvals.at(-1)!.id, "fail");
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.equal(p.cadRuns.at(-1)!.status, "failed");
    assert.deepEqual(
      p.artifacts.filter((a) => a.kind === "model").map((a) => a.id),
      before,
    );
  });
  test("F17 成功工程预览对应实际有效 GLB 文件，真实大小与来源一致", async () => {
    const { p } = await cadFixture();
    const artifact = p.artifacts.find((a) => a.kind === "model")!;
    assert.equal(canDownload(p, artifact), true);
    const bytes = readFileSync(path.resolve("public", artifact.url!.slice(1)));
    assert.equal(bytes.subarray(0, 4).toString(), "glTF");
    assert.equal(bytes.length, artifact.sizeBytes);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    for (const [key, size] of Object.entries(MODEL_BYTES))
      assert.equal(
        readFileSync(path.resolve("public/v8-assets", `${key}.glb`)).length,
        size,
      );
  });
  test("F18 CAD 后新修订不继承旧批准；历史模型仍可下载", async () => {
    const f = await cadFixture();
    let p = f.p;
    const b = p.branches[0];
    p = await f.repo.refine(
      p.id,
      b.id,
      b.revisions[0].id,
      "增加新的修改",
      "new",
    );
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.equal(
      matchingApproval(p, b.id, p.branches[0].revisions.at(-1)!.id),
      undefined,
    );
    assert.equal(p.cadRuns.length, 1);
    assert.equal(
      canDownload(p, p.artifacts.find((a) => a.kind === "model")!),
      true,
    );
  });
  test("F19 缺失、过期、未授权、错误来源均不能下载", async () => {
    const { p } = await cadFixture();
    const artifact = p.artifacts.find((a) => a.kind === "model")!;
    for (const status of [
      "missing",
      "expired",
      "uploading",
      "validating",
      "failed",
    ] as const)
      assert.equal(canDownload(p, { ...artifact, status }), false);
    assert.equal(canDownload(p, { ...artifact, authorized: false }), false);
    assert.equal(
      canDownload(p, { ...artifact, descriptionId: "other" }),
      false,
    );
  });
  test("F20 live adapter 只投影已授权平台事实，403 与 401、服务错误明确区分", async () => {
    const { client } = await import("../lib/api/client");
    const original = client.getConfig();
    try {
      for (const [status, code] of [
        [401, "AUTHENTICATION_REQUIRED"],
        [403, "FORBIDDEN"],
        [500, "SERVICE_ERROR"],
      ] as const) {
        client.setConfig({
          baseUrl: "http://127.0.0.1:9",
          fetch: async () =>
            new Response(JSON.stringify({ error: { code } }), {
              status,
              headers: { "content-type": "application/json" },
            }),
        });
        await assert.rejects(
          () => new LiveRepository().get("private"),
          (error: unknown) =>
            error instanceof V8Error &&
            error.code === code &&
            error.status === status,
        );
      }
      client.setConfig({
        baseUrl: "http://127.0.0.1:9",
        fetch: async () =>
          new Response(
            JSON.stringify({
              id: "p",
              name: "Real",
              projectType: "AUTOMATION",
              createdAt: "a",
              updatedAt: "b",
            }),
            { headers: { "content-type": "application/json" } },
          ),
      });
      const p = await new LiveRepository().get("p");
      assert.equal(p.source, "platform");
      assert.equal(p.projectType, "AUTOMATION");
      assert.equal(p.route, undefined);
      assert.deepEqual(p.branches, []);
    } finally {
      client.setConfig(original);
    }
  });
  test("F21 深链接所需项目、方向与版本标识在刷新后仍存在", async () => {
    const f = fixture();
    const p = await project(f.repo);
    const reopened = await new PreviewRepository(f.storage, f.now, {
      seedPreset: "legacy-fixture",
    }).get(p.id);
    assert.equal(
      reopened.branches[0].revisions[0].id,
      p.branches[0].revisions[0].id,
    );
    assert.equal(legalStage(reopened, "concept"), "concept");
  });
  test("F22 未确认概念不能跳入工程阶段，读取门槛不创建任务或改变历史", async () => {
    const { repo } = fixture();
    const p = await project(repo);
    const before = JSON.stringify(p);
    assert.equal(canEnterEngineering(p), false);
    assert.equal(legalStage(p, "cad"), "concepts");
    assert.equal(JSON.stringify(p), before);
    assert.equal(legalStage({ ...p, requirements: [] }, "cad"), "requirements");
    assert.equal(legalStage(p, "delivery"), "start");
    await assert.rejects(
      () => repo.startCad(p.id, "missing", "cad"),
      /请先确认/,
    );
    assert.deepEqual(await repo.get(p.id), p);
    const draft = await repo.create({ text: "未选择路线的项目" }, "new-stage");
    assert.equal(legalStage(draft, "cad"), "start");
    assert.equal(canEnterEngineering(draft), false);
  });
  test("工程入口允许已保存的真实模板，不生成伪 CAD；无效文件和参考转定制不能误解锁", async () => {
    const { repo } = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(
      p.id,
      "sample-inspection",
      { inspectionCameraHeight: 0.025 },
      "template-stage",
    );
    const before = JSON.stringify(p);
    assert.equal(canEnterEngineering(p), true);
    assert.equal(legalStage(p, "cad"), "cad");
    assert.equal(p.tasks.length, 0);
    assert.equal(p.cadRuns.length, 0);
    assert.equal(JSON.stringify(p), before);
    const model = p.artifacts.find((a) => a.kind === "model")!;
    for (const change of [
      { status: "expired" },
      { status: "missing" },
      { authorized: false },
      { projectId: "foreign" },
      { url: undefined },
    ] as const) {
      const invalid = structuredClone(p);
      Object.assign(invalid.artifacts.find((a) => a.id === model.id)!, change);
      assert.equal(canEnterEngineering(invalid), false, JSON.stringify(change));
    }
    const reference = await repo.chooseRoute(p.id, "custom");
    assert.equal(reference.referenceTemplateId, "sample-inspection");
    assert.equal(canEnterEngineering(reference), false);
    assert.equal(legalStage(reference, "cad"), "concepts");
  });
  test("不可变批准解锁工程，但伪造项目/方向/描述/需求来源不能解锁", async () => {
    const { repo } = fixture();
    let p = await project(repo);
    const branch = p.branches[0];
    p = await repo.approve(
      p.id,
      branch.id,
      branch.revisions[0].id,
      "source-stage",
    );
    const approval = p.approvals[0],
      before = JSON.stringify(p);
    assert.equal(approvalSourceValid(p, approval), true);
    assert.equal(canEnterEngineering(p), true);
    assert.equal(legalStage(p, "cad"), "cad");
    assert.equal(JSON.stringify(p), before);
    for (const tamper of [
      (invalid: Project) => {
        invalid.approvals[0].projectId = "foreign";
      },
      (invalid: Project) => {
        invalid.branches[0].projectId = "foreign";
      },
      (invalid: Project) => {
        invalid.branches[0].revisions[0].branchId = "foreign";
      },
      (invalid: Project) => {
        invalid.approvals[0].description += " different body";
      },
      (invalid: Project) => {
        invalid.branches[0].revisions[0].descriptionId = "foreign";
      },
      (invalid: Project) => {
        invalid.requirements[0].projectId = "foreign";
      },
      (invalid: Project) => {
        invalid.requirements = [];
      },
    ]) {
      const invalid = structuredClone(p);
      tamper(invalid);
      assert.equal(approvalSourceValid(invalid, invalid.approvals[0]), false);
      assert.equal(canEnterEngineering(invalid), false);
    }
  });
  test("新概念修订保留旧批准和历史 CAD 的合法入口，不把旧模型变成新修订成果", async () => {
    const f = await cadFixture();
    const original = f.p,
      branch = original.branches[0],
      approval = original.approvals[0];
    let p = await f.repo.refine(
      original.id,
      branch.id,
      branch.revisions[0].id,
      "补充检修空间",
      "history-stage",
    );
    f.advance();
    p = await f.repo.syncTask(p.id);
    const latest = p.branches[0].revisions.at(-1)!;
    assert.notEqual(latest.id, approval.revisionId);
    assert.equal(matchingApproval(p, branch.id, latest.id), undefined);
    assert.equal(approvalSourceValid(p, p.approvals[0]), true);
    assert.equal(runSourceValid(p, p.cadRuns[0]), true);
    assert.equal(canEnterEngineering(p), true);
    assert.equal(legalStage(p, "cad"), "cad");
    const oldModel = p.artifacts.find((a) => a.kind === "model")!;
    assert.equal(canDownload(p, oldModel), true);
    assert.equal(oldModel.revisionId, approval.revisionId);
    const wrongGeometry = structuredClone(p);
    wrongGeometry.cadRuns[0].assetKey = "conveyor";
    assert.equal(
      runSourceValid(wrongGeometry, wrongGeometry.cadRuns[0]),
      false,
    );
  });
  test("直接调用 CAD repository 时也在提交前拒绝伪造批准，不写 queued task、run 或幂等记录", async () => {
    const f = fixture();
    let p = await project(f.repo);
    const branch = p.branches[0];
    p = await f.repo.approve(
      p.id,
      branch.id,
      branch.revisions[0].id,
      "direct-source",
    );
    const storageKey = "embodex-v8-preview-v1",
      store = JSON.parse(f.storage.getItem(storageKey)!);
    const record = store.projects.find((item: Project) => item.id === p.id);
    record.approvals[0].projectId = "foreign-project";
    f.storage.setItem(storageKey, JSON.stringify(store));
    const before = f.storage.getItem(storageKey);
    await assert.rejects(
      () => f.repo.startCad(p.id, p.approvals[0].id, "must-not-submit"),
      (error: unknown) =>
        error instanceof V8Error && error.code === "SOURCE_MISMATCH",
    );
    assert.equal(f.storage.getItem(storageKey), before);
    const after = await f.repo.get(p.id);
    assert.equal(after.tasks.length, 0);
    assert.equal(after.cadRuns.length, 0);
  });
  test("F23 相同提交意图幂等；响应丢失先同步，不重复 CAD", async () => {
    const f = fixture();
    let p = await project(f.repo);
    const b = p.branches[0];
    p = await f.repo.approve(p.id, b.id, b.revisions[0].id, "a");
    f.repo.setScenario("response-lost");
    await assert.rejects(
      () => f.repo.startCad(p.id, p.approvals[0].id, "lost"),
      (e: unknown) => e instanceof V8Error && e.code === "UNKNOWN_SUBMISSION",
    );
    p = await f.repo.syncTask(p.id);
    assert.equal(p.tasks[0].submissionState, "accepted");
    p = await f.repo.startCad(p.id, p.approvals[0].id, "lost");
    assert.equal(p.cadRuns.length, 1);
    await assert.rejects(
      () => f.repo.generateConcepts(p.id, 3, "lost"),
      /同一个提交标识/,
    );
  });
  test("F24 离线不意味着任务取消；恢复后同步权威样例状态", async () => {
    const f = fixture();
    let p = await project(f.repo);
    p = await f.repo.generateConcepts(p.id, 1, "g");
    f.repo.setScenario("offline");
    f.advance();
    await assert.rejects(() => f.repo.syncTask(p.id), /网络已中断/);
    assert.equal(
      f.repo.snapshot().find((x) => x.id === p.id)!.tasks[0].status,
      "queued",
    );
    f.repo.setScenario("success");
    p = await f.repo.syncTask(p.id);
    assert.equal(p.tasks[0].status, "succeeded");
  });
  test("F25 UE 不参与 Web3D 或文件交付的前置条件", async () => {
    const { p } = await cadFixture();
    assert.equal(canDeliver(p), true);
    assert.ok(p.artifacts.some((a) => a.url?.endsWith(".glb")));
    assert.equal("ueSession" in p, false);
  });
  test("F26 恶意 HTML 作为普通文本原样保留，不解释执行", async () => {
    const { repo } = fixture();
    const input = "<img src=x onerror=alert(1)><script>attack()</script>";
    const p = await repo.create({ text: input }, "html");
    assert.equal(currentRequirement(p)!.text, input);
  });
  test("F27 图片概念显式携带 image 媒体能力", async () => {
    const { repo } = fixture();
    const p = await project(repo);
    assert.equal(
      p.branches.find((b) => b.revisions[0].assetKey === "tripod")!.revisions[0]
        .mediaType,
      "image",
    );
  });
  test("F28 移动端依赖同一领域数据，预览模型有对应实际 PNG/SVG 查看资源", async () => {
    const { repo } = fixture();
    const p = await project(repo);
    for (const b of p.branches) {
      const url = assetPreviewUrl(b.revisions[0].assetKey);
      const data = readFileSync(path.resolve("public", url.slice(1)));
      if (url.endsWith(".svg")) assert.match(data.toString("utf8"), /<svg/);
      else
        assert.deepEqual(
          [...data.subarray(0, 8)],
          [137, 80, 78, 71, 13, 10, 26, 10],
        );
    }
  });
  test("F29 阶段回看无状态副作用且合法阶段按事实决定", async () => {
    const { p } = await cadFixture();
    const before = JSON.stringify(p);
    assert.equal(legalStage(p, "requirements"), "requirements");
    assert.equal(legalStage(p, "concepts"), "concepts");
    assert.equal(legalStage(p, "delivery"), "delivery");
    assert.equal(JSON.stringify(p), before);
  });
  test("F30 计算成功、文件准备与工程验证独立；pending 可恢复", async () => {
    const f = fixture();
    let p = await project(f.repo);
    const b = p.branches[0];
    p = await f.repo.approve(p.id, b.id, b.revisions[0].id, "a");
    f.repo.setScenario("files-pending");
    p = await f.repo.startCad(p.id, p.approvals[0].id, "cad");
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.equal(p.cadRuns[0].status, "succeeded");
    assert.equal(p.cadRuns[0].validationStatus, "not_run");
    assert.equal(
      p.artifacts.find((a) => a.kind === "model")!.status,
      "uploading",
    );
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.equal(
      p.artifacts.find((a) => a.kind === "model")!.status,
      "validating",
    );
    assert.equal(
      canDownload(p, p.artifacts.find((a) => a.kind === "model")!),
      false,
    );
    f.repo.setScenario("success");
    p = await f.repo.syncTask(p.id);
    assert.equal(p.artifacts.find((a) => a.kind === "model")!.status, "ready");
  });
  test("模板适配按真实能力校验参数，下载原模型与视图配置分开", async () => {
    const { repo } = fixture();
    let p = (await repo.list())[0];
    await assert.rejects(
      () =>
        repo.useTemplate(p.id, "sample-quadruped", { sensorOffset: 3 }, "bad"),
      /参数不在/,
    );
    p = await repo.useTemplate(
      p.id,
      "sample-quadruped",
      { sensorOffset: 0.1 },
      "good",
    );
    assert.equal(p.tasks.length, 0);
    assert.equal(p.artifacts.filter((a) => a.kind === "model").length, 1);
    assert.equal(
      p.artifacts.filter((a) => a.mimeType.startsWith("text/html")).length,
      0,
    );
    assert.equal(canDownload(p, p.artifacts[1]), true);
    assert.match(p.artifacts[0].content!, /原始模板几何/);
  });
  test("空概念结果与失败结果均不会伪造方向", async () => {
    for (const scenario of ["empty", "failure"] as const) {
      const f = fixture();
      let p = await f.repo.create({ text: "测试" }, "p");
      f.repo.setScenario(scenario);
      p = await f.repo.generateConcepts(p.id, 3, "g");
      f.advance();
      p = await f.repo.syncTask(p.id);
      assert.equal(p.branches.length, 0);
      assert.equal(
        p.tasks[0].status,
        scenario === "empty" ? "succeeded" : "failed",
      );
    }
  });
  test("live 业务缺口明确阻止，不回退本地成功", async () => {
    const repo = new LiveRepository();
    await assert.rejects(
      () => repo.create({ text: "private" }),
      (e: unknown) =>
        e instanceof V8Error && e.code === "CAPABILITY_UNAVAILABLE",
    );
    assert.deepEqual(repo.snapshot(), []);
  });
  test("运行任务锁定提交时需求版本，之后保存需求不偷换来源", async () => {
    const f = fixture();
    let p = await f.repo.create({ text: "原始需求" }, "p");
    const requirementId = p.requirements[0].id;
    p = await f.repo.generateConcepts(p.id, 1, "g");
    p = await f.repo.saveRequirements(p.id, { text: "新需求" }, "req2");
    f.advance();
    p = await f.repo.syncTask(p.id);
    assert.equal(p.branches[0].revisions[0].requirementId, requirementId);
    assert.match(p.branches[0].revisions[0].description, /原始需求/);
    assert.doesNotMatch(p.branches[0].revisions[0].description, /新需求/);
  });
  test("旧模板成果保留历史下载，不因切换模板而失效", async () => {
    const { repo } = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(
      p.id,
      "sample-quadruped",
      { sensorOffset: 0 },
      "q",
    );
    const old = p.artifacts[1];
    p = await repo.useTemplate(
      p.id,
      "sample-compact",
      { sensorOffset: 0.1 },
      "c",
    );
    assert.equal(canDownload(p, old), true);
    assert.equal(p.artifacts.filter((a) => a.kind === "model").length, 2);
    assert.equal(
      p.artifacts.filter((a) => a.mimeType.startsWith("text/html")).length,
      1,
    );
  });
  test("生产环境在构造器、工厂与已创建实例三处阻止样例", () => {
    const existing = fixture().repo;
    const original = process.env.NODE_ENV;
    try {
      Object.assign(process.env, { NODE_ENV: "production" });
      const disabled = (error: unknown) =>
        error instanceof V8Error && error.code === "PREVIEW_DISABLED";
      assert.throws(() => new PreviewRepository(), disabled);
      assert.throws(() => getRepository("preview"), disabled);
      assert.throws(() => existing.snapshot(), disabled);
    } finally {
      if (original === undefined)
        Reflect.deleteProperty(process.env, "NODE_ENV");
      else Object.assign(process.env, { NODE_ENV: original });
    }
  });
  test("离线可读取已保存项目；同步与写入仍被阻止", async () => {
    const { repo } = fixture();
    const p = await project(repo);
    const savedIds = (await repo.list()).map((item) => item.id);
    repo.setScenario("offline");
    assert.equal((await repo.get(p.id)).id, p.id);
    assert.deepEqual(
      (await repo.list()).map((item) => item.id),
      savedIds,
    );
    await assert.rejects(
      () => repo.saveRequirements(p.id, { text: "离线修改" }, "offline"),
      /网络已中断/,
    );
    await assert.rejects(() => repo.syncTask(p.id), /网络已中断/);
  });
  test("设计文档同样验证不可变描述；相同 ID 的正文篡改不能交付", async () => {
    const { p } = await cadFixture();
    const doc = p.artifacts.find((a) => a.kind === "design_document")!;
    assert.equal(canDownload(p, doc), true);
    const tampered = structuredClone(p);
    tampered.branches[0].revisions[0].description = "不同正文";
    assert.equal(canDownload(tampered, doc), false);
    assert.equal(
      matchingApproval(tampered, doc.branchId!, doc.revisionId!),
      undefined,
    );
  });
  test("模板转 AI 定制保留参考资产来源", async () => {
    const { repo } = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(
      p.id,
      "sample-quadruped",
      { sensorOffset: 0.1 },
      "q",
    );
    p = await repo.chooseRoute(p.id, "custom");
    assert.equal(p.referenceTemplateId, "sample-quadruped");
    assert.equal(p.artifacts.filter((a) => a.kind === "model").length, 1);
    assert.equal(
      p.artifacts.filter((a) => a.mimeType.startsWith("text/html")).length,
      0,
    );
  });
});
