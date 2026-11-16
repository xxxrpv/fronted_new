import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PreviewRepository,
  type StoragePort,
  V8Error,
} from "../lib/v8/repository";
import {
  createDesignReport,
  createDesignReportPreviewHtml,
  REPORT_CHAPTERS,
  emptyReportPlanning,
  calculateReportPlanning,
  embedDesignReportHtml,
} from "../lib/v8/design-report";
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
  return new PreviewRepository(
    new MemoryStorage(),
    () => Date.parse("2026-11-14T02:00:00Z"),
    { seedPreset: "legacy-fixture" },
  );
}
const escaped = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
describe("Full design report: source, immutable snapshots, safe portable HTML", () => {
  test("Seven required modules have exact chapter labels, real targets and controlled interactive hosts", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(p.id, "sample-go2", {}, "seven");
    const report = createDesignReport(p, {
      templateId: "sample-go2",
      parameters: {},
    });
    assert.deepEqual(
      REPORT_CHAPTERS.map(([, label]) => label),
      [
        "需求与方案",
        "交互式方案",
        "整体方案",
        "场景任务",
        "投资预算",
        "企业效益",
        "交付流程",
      ],
    );
    for (const [index, [id, label]] of REPORT_CHAPTERS.entries()) {
      assert.ok(
        report.html.includes(
          `href="#${id}"><i>${String(index + 1).padStart(2, "0")}</i>${label}</a>`,
        ),
      );
      assert.ok(report.html.includes(`id="${id}"`));
    }
    for (const id of ["interactive", "budget", "economics"])
      assert.ok(report.html.includes(`id="report-${id}-host"`));
    assert.match(report.html, /尚未提供报价/);
    assert.doesNotMatch(report.html, /<script\b|on(?:click|load)\s*=/i);
  });
  test("Budget/value inputs stay unknown until explicit assumptions and use transparent original-site formulas", () => {
    const blank = emptyReportPlanning();
    assert.equal(calculateReportPlanning(blank).total, null);
    assert.equal(calculateReportPlanning(blank).netCash, null);
    const assumed = {
      ...blank,
      quantity: "2",
      unitHardware: "100000",
      software: "20000",
      integration: "30000",
      contingencyPct: "10",
      annualMaintenance: "10000",
      annualEnergy: "5000",
      annualOther: "0",
      annualReleasedHours: "1000",
      hourlyCost: "50",
      cashRatePct: "50",
      otherAnnualSavings: "1000",
    };
    const original = structuredClone(assumed),
      result = calculateReportPlanning(assumed);
    assert.equal(result.total, 275000);
    assert.equal(result.annualOperating, 15000);
    assert.equal(result.netCash, 11000);
    assert.equal(result.payback, 25);
    assert.equal(result.threeYearCost, 320000);
    assert.equal(result.threeYearNet, -242000);
    assert.deepEqual(assumed, original);
    assert.equal(
      calculateReportPlanning({ ...assumed, quantity: "" }).total,
      null,
    );
    assert.equal(
      calculateReportPlanning({ ...assumed, cashRatePct: "101" }).netCash,
      null,
    );
    assert.equal(
      calculateReportPlanning({ ...assumed, cashRatePct: "0" }).netCash,
      -14000,
    );
    assert.equal(
      calculateReportPlanning({ ...assumed, cashRatePct: "0" }).payback,
      null,
    );
    assert.equal(
      calculateReportPlanning({ ...assumed, unitHardware: "NaN" }).total,
      null,
    );
  });
  test("Overview presentation preserves every frozen fact and never inserts executable content", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(p.id, "sample-go2", {}, "save-overview");
    const saved = p.artifacts.find((item) =>
      item.mimeType.startsWith("text/html"),
    )!;
    const original = saved.content!;
    const view = createDesignReportPreviewHtml(original);
    assert.match(view, /data-report-presentation="overview-v2"/);
    assert.equal(
      view.replace(
        /<style data-report-presentation="overview-v2">[\s\S]*?<\/style>/,
        "",
      ),
      original,
    );
    assert.equal(saved.content, original);
    assert.equal(saved.sizeBytes, Buffer.byteLength(original));
    assert.doesNotMatch(view, /<script\b|on(?:load|click|error)\s*=/i);
    assert.throws(
      () => createDesignReportPreviewHtml("<html>unknown</html>"),
      /不支持|受支持/,
    );
  });
  test("HTML format, filename, MIME and exact bytes agree; matching Go2 source and full BSD notice remain", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(p.id, "sample-go2", {}, "save");
    const report = createDesignReport(
      p,
      {
        templateId: "sample-go2",
        requirementId: p.requirements[0].id,
        parameters: {},
      },
      { assetBaseUrl: "http://127.0.0.1:3108" },
    );
    assert.match(report.fileName, /\.html$/);
    assert.equal(report.mimeType, "text/html;charset=utf-8");
    assert.match(report.html, /^<!doctype html>/);
    assert.equal(report.sizeBytes, Buffer.byteLength(report.html, "utf8"));
    assert.match(report.html, /go2-high-fidelity\.png/);
    assert.match(report.html, /Unitree Robotics/);
    assert.match(report.html, /BSD-3-Clause/);
    assert.ok(
      report.html.includes(
        escaped(
          readFileSync(path.resolve("public/v8-assets/go2-LICENSE.txt"), "utf8")
            .replace(/\r\n/g, "\n")
            .trim(),
        ),
      ),
    );
    assert.match(report.html, /工程验证未执行/);
    assert.doesNotMatch(
      report.html,
      /已通过工程验证|投资回报率|年节省|5000 m²/,
    );
  });
  test("All user-controlled requirements, titles and branch descriptions remain escaped text", async () => {
    const repo = fixture();
    const malicious =
      '<img src=x onerror="alert(1)"><script>window.attack=1</script>&';
    let p = await repo.create(
      {
        name: malicious,
        text: malicious,
        purpose: malicious,
        constraints: malicious,
      },
      "p",
    );
    p = await repo.useTemplate(p.id, "sample-go2", {}, "t");
    const report = createDesignReport(p, {
      templateId: "sample-go2",
      parameters: {},
    });
    assert.ok(report.html.includes(escaped(malicious)));
    assert.doesNotMatch(report.html, /<script\b/i);
    assert.doesNotMatch(report.html, /<img src=x/);
    assert.match(report.html, /Content-Security-Policy/);
    assert.doesNotMatch(report.fileName, /[<>:"/\\|?*]/);
  });
  test("Saved template report captures ready model after its authoritative template relationship exists", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(p.id, "sample-go2", {}, "save");
    const stored = p.artifacts.find(
      (item) =>
        item.kind === "design_document" &&
        item.mimeType.startsWith("text/html"),
    )!;
    assert.ok(stored);
    assert.match(stored.content!, /已登记 1 个可用模型文件/);
    assert.match(stored.content!, /go2-high-fidelity\.glb/);
    assert.match(stored.content!, />文件可用<\/td>/);
    assert.doesNotMatch(stored.content!, /尚不可交付/);
  });
  test("Approved report resolves its original requirement and description after upstream edits", async () => {
    const repo = fixture();
    let p = (await repo.list()).find((item) => item.branches.length)!;
    const b = p.branches[0],
      r = b.revisions[0],
      original = p.requirements[0].text;
    p = await repo.approve(p.id, b.id, r.id, "approve");
    const approval = p.approvals[0];
    p = await repo.saveRequirements(
      p.id,
      { text: "NEW REQUIREMENT MUST NOT REPLACE SNAPSHOT" },
      "new-req",
    );
    const report = createDesignReport(p, { approvalId: approval.id });
    assert.equal(report.source.requirementId, r.requirementId);
    assert.ok(report.html.includes(escaped(original)));
    assert.ok(report.html.includes(escaped(approval.description)));
    assert.doesNotMatch(
      report.html,
      /NEW REQUIREMENT MUST NOT REPLACE SNAPSHOT/,
    );
    assert.ok(
      report.html.includes(`data-description-id="${approval.descriptionId}"`),
    );
    assert.throws(
      () =>
        createDesignReport(p, {
          approvalId: approval.id,
          requirementId: p.requirements.at(-1)!.id,
        }),
      /来源不一致/,
    );
  });
  test("Source mismatch and unavailable real backend facts cannot yield a deliverable report", async () => {
    const repo = fixture();
    let p = (await repo.list()).find((item) => item.branches.length)!;
    const b = p.branches[0];
    p = await repo.approve(p.id, b.id, b.revisions[0].id, "a");
    const tampered = structuredClone(p);
    tampered.approvals[0].description = "different immutable body";
    assert.throws(
      () => createDesignReport(tampered, { approvalId: p.approvals[0].id }),
      /来源不一致/,
    );
    assert.throws(
      () =>
        createDesignReport(
          { ...p, source: "platform" },
          { approvalId: p.approvals[0].id },
        ),
      (e: unknown) =>
        e instanceof V8Error && e.code === "REPORT_CONTRACT_UNAVAILABLE",
    );
    assert.throws(
      () => createDesignReport(p, { artifactId: "another-project-artifact" }),
      /不属于当前项目/,
    );
  });
  test("Explicit template requirement and parameter snapshots survive later edits", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    const requirementId = p.requirements[0].id;
    p = await repo.useTemplate(
      p.id,
      "sample-inspection",
      { inspectionCameraHeight: 0.025 },
      "t",
    );
    p = await repo.saveRequirements(
      p.id,
      { text: "LATER PRIVATE TEXT" },
      "edit",
    );
    const report = createDesignReport(p, {
      templateId: "sample-inspection",
      requirementId,
      parameters: { inspectionCameraHeight: 0.025 },
    });
    assert.equal(report.source.requirementId, requirementId);
    assert.equal(report.source.parameters!.inspectionCameraHeight, 0.025);
    assert.doesNotMatch(report.html, /LATER PRIVATE TEXT/);
    assert.match(report.html, /0\.025 m/);
    assert.throws(
      () =>
        createDesignReport(p, {
          templateId: "sample-inspection",
          parameters: { inspectionCameraHeight: 9 },
        }),
      /参数超出/,
    );
  });
  test("Supplied AMR concept keeps project-source ownership instead of being relicensed CC0", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(
      p.id,
      "sample-mobile",
      { mobileCameraHeight: 0 },
      "t",
    );
    const report = createDesignReport(p, {
      templateId: "sample-mobile",
      parameters: { mobileCameraHeight: 0 },
    });
    assert.match(report.html, /official-mobile-hero\.png/);
    assert.match(report.html, /项目提供的原创概念源/);
    assert.doesNotMatch(report.html, /来源与许可<\/dt><dd>[^<]*CC0-1\.0/);
  });
  test("Offline export embeds actual local image while preserving frozen facts byte-for-byte", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(p.id, "sample-go2", {}, "t");
    const original = createDesignReport(p, {
      templateId: "sample-go2",
      parameters: {},
    }).html;
    const image = readFileSync(
      path.resolve("public/v8-assets/go2-high-fidelity.png"),
    );
    let fetched = 0;
    const result = await embedDesignReportHtml(original, {
      baseUrl: "http://127.0.0.1:3108",
      fetcher: (async (url, init) => {
        fetched++;
        assert.equal(
          String(url),
          "http://127.0.0.1:3108/v8-assets/go2-high-fidelity.png",
        );
        assert.equal(init?.credentials, "same-origin");
        return new Response(image, {
          headers: { "Content-Type": "image/png" },
        });
      }) as typeof fetch,
    });
    assert.equal(fetched, 1);
    assert.equal(result.embeddedCount, 1);
    assert.equal(result.sizeBytes, Buffer.byteLength(result.html));
    assert.match(result.html, /src="data:image\/png;base64,/);
    const restored = result.html.replace(
      /src="data:image\/png;base64,[^"]+"/g,
      'src="/v8-assets/go2-high-fidelity.png"',
    );
    assert.equal(restored, original);
  });
  test("Unknown remote assets, missing assets, corrupt images and active SVG cannot become offline exports", async () => {
    const repo = fixture();
    let p = (await repo.list())[0];
    p = await repo.useTemplate(p.id, "sample-go2", {}, "t");
    const html = createDesignReport(p, {
      templateId: "sample-go2",
      parameters: {},
    }).html;
    await assert.rejects(
      () =>
        embedDesignReportHtml(
          html.replace(
            "/v8-assets/go2-high-fidelity.png",
            "https://untrusted.invalid/image.png",
          ),
          {
            baseUrl: "http://127.0.0.1:3108",
            fetcher: (async () => {
              throw new Error("must not fetch");
            }) as typeof fetch,
          },
        ),
      /未受控/,
    );
    await assert.rejects(
      () =>
        embedDesignReportHtml(html, {
          baseUrl: "http://127.0.0.1:3108",
          fetcher: (async () =>
            new Response("", { status: 404 })) as typeof fetch,
        }),
      /预览图暂不可用/,
    );
    await assert.rejects(
      () =>
        embedDesignReportHtml(html, {
          baseUrl: "http://127.0.0.1:3108",
          fetcher: (async () => new Response("not a PNG")) as typeof fetch,
        }),
      /内容与扩展名不一致/,
    );
    const active = html.replace(
      "/v8-assets/go2-high-fidelity.png",
      "/v8-assets/quadruped.svg",
    );
    await assert.rejects(
      () =>
        embedDesignReportHtml(active, {
          baseUrl: "http://127.0.0.1:3108",
          fetcher: (async () =>
            new Response(
              '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
            )) as typeof fetch,
        }),
      /活动内容/,
    );
  });
});
