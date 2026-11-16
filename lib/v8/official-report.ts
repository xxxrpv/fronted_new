import type { Artifact, Project } from "./types";
import { TEMPLATE_CATALOG } from "./catalog";
import { readableDesignText } from "./presentation";
import { parseRequirementBrief } from "./requirements-brief";
import { REPORT_FORMAT, embedDesignReportHtml } from "./design-report";
import { OFFICIAL_REPORT_STYLE } from "./official/style";
import { installOfficialRuntime } from "./official/runtime";

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const adapterStyle = `html,body{height:100%;overflow:hidden}body{background:transparent}.case-experience.is-expanded{position:absolute;inset:0;transform:none;width:100%;height:100%;max-height:none;border:0;border-radius:0;scroll-padding-top:calc(var(--solution-toolbar-height,64px) + var(--solution-project-height,70px) + var(--solution-nav-height,58px) + 16px)}.case-experience.is-expanded .case-frame-mount{padding:20px;background:#f4f8fc}.report-workbench-heading{display:flex;align-items:center;gap:20px;padding:0 0 18px;color:#526f8c}.report-workbench-heading b{font-size:20px}.report-workbench-heading span{padding:9px 14px;border:1px solid #cbddea;border-radius:12px;font-size:12px;background:#fff9}.report-workspace-loading{min-height:620px;display:grid;place-items:center;margin:0;color:#6b829b;font-size:12px}@media(max-width:820px){.report-workspace-loading{min-height:440px}}.report-interactive-fallback{display:none;margin:0}.report-interactive-fallback img{max-height:480px;margin:auto}.report-assumption-note{margin:0 0 24px;color:#6b829b;font-size:12px}.official-report-error{padding:40px;color:#5f7286}.official-model-unavailable{padding:24px;color:#6b829b}.case-toolbar.toolbar-minimal .case-tools{gap:8px}.case-tools .report-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;min-height:36px;padding:7px 12px;border:1px solid #cbddea;border-radius:11px;background:#ffffff9c;box-shadow:inset 0 1px 0 #fff;color:#526f8c;font-size:11px;white-space:nowrap}.case-tools .report-action svg{width:16px;height:16px;flex:none}.case-toolbar.toolbar-minimal .report-close{width:36px;height:36px;padding:8px;border:1px solid #cbddea;border-radius:11px;background:#ffffff9c;box-shadow:inset 0 1px 0 #fff;color:#526f8c}.case-tools .report-close svg{width:18px;height:18px}.case-tools .report-action:hover,.case-tools .report-close:hover{background:#eaf3fb;border-color:#b6cfe2}.case-tools .report-action:active,.case-tools .report-close:active{background:#e0edf7}.case-tools :is(.report-action,.report-close):focus-visible{outline:2px solid #8aaecb;outline-offset:3px}.case-tools .report-action:disabled{opacity:.45;cursor:wait}.report-action-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:760px){.case-toolbar.toolbar-minimal .case-tools{gap:6px}.case-tools .report-action{width:34px;height:34px;min-height:34px;padding:8px}.case-tools .report-action>span{display:none}.case-toolbar.toolbar-minimal .report-close{width:34px;height:34px;padding:8px}.case-tools .report-action svg{width:17px;height:17px}}.solution-projects button{max-width:none}.business-plan-price:empty:before{content:'—'}@media(max-width:760px){.case-experience.is-expanded .case-frame-mount{padding:12px}.report-workbench-heading b{font-size:17px}.report-workbench-heading span{font-size:11px}}.report-task-reading>.business-task-detail{margin:12px 0;break-inside:avoid}@media print{html,body{height:auto;overflow:visible}.business-task-steps,#business-task-detail{display:none!important}.report-task-reading[hidden]{display:block!important}.case-experience.is-expanded{position:static;height:auto;overflow:visible}.case-toolbar,.solution-projects,.solution-nav,.report-interactive-host,.business-export-actions,.solution-footer button{display:none!important}.report-interactive-fallback{display:block!important}.solution-before,.solution-after{width:100%}.solution-section{break-inside:auto}.business-glass,.system-illustrated-card{break-inside:avoid}details>div{display:block!important}.business-field input{border:0!important;box-shadow:none!important}}`;

export interface OfficialReportFacts {
  projectId: string;
  artifactId: string;
  requirementId: string;
  approvalId?: string;
  branchId?: string;
  cadRunId?: string;
  revisionId?: string;
  descriptionId?: string;
  isTemplate: boolean;
  caseId: "quadruped" | "mobile" | "arm";
  projectName: string;
  modelName: string;
  version: string;
  request: string;
  purpose: string;
  constraints: string;
  description: string;
  validationLabel: string;
  image: string;
  template?: (typeof TEMPLATE_CATALOG)[number];
  parameters: Record<string, number>;
  brief: ReturnType<typeof parseRequirementBrief>;
}

/** Resolve only the saved report and its immutable source, never the latest design. */
export function readOfficialReportFacts(
  project: Project,
  artifact: Artifact,
): OfficialReportFacts {
  const doc = new DOMParser().parseFromString(
    artifact.content || "",
    "text/html",
  );
  const revision = project.branches
    .find((b) => b.id === artifact.branchId)
    ?.revisions.find((r) => r.id === artifact.revisionId);
  const template = TEMPLATE_CATALOG.find((t) =>
    artifact.templateId
      ? t.id === artifact.templateId
      : t.assetKey === revision?.assetKey,
  );
  const requirementId =
    artifact.requirementId || doc.body.dataset.requirementId || "";
  const requirement = project.requirements.find((r) => r.id === requirementId);
  const title = doc.querySelector("#report-title")?.cloneNode(true) as
    | HTMLElement
    | undefined;
  const modelName =
    doc
      .querySelector(".hero-art img")
      ?.getAttribute("alt")
      ?.replace(/的对应模型可视化快照$/, "") ||
    template?.name ||
    "设计模型";
  const version =
    doc.querySelector(".hero-facts div:nth-child(2) dd")?.textContent?.trim() ||
    "已保存";
  title?.querySelector("span")?.remove();
  const request =
    requirement?.text ||
    doc.querySelector("#requirements .brief-text")?.textContent?.trim() ||
    "";
  const purpose =
    requirement?.purpose ||
    doc.querySelector("#requirements .two-col article:first-child p")
      ?.textContent ||
    "";
  const constraints =
    requirement?.constraints ||
    doc.querySelector("#requirements .two-col article:nth-child(2) p")
      ?.textContent ||
    "";
  const assetKey =
    template?.assetKey || revision?.assetKey || "inspection-reference";
  const caseId = /mobile|compact/.test(assetKey)
    ? "mobile"
    : assetKey === "conveyor"
      ? "arm"
      : "quadruped";
  const originalImage =
    doc.querySelector(".hero-art img")?.getAttribute("src") || "";
  const image =
    assetKey === "inspection-reference"
      ? "/v8-assets/official-inspection-hero.png"
      : assetKey === "mobile-reference"
        ? "/v8-assets/official-mobile-hero.png"
        : originalImage;
  const imageUrl = new URL(
    image || "/v8-assets/quadruped.svg",
    window.location.origin,
  );
  const safeImage =
    imageUrl.origin === window.location.origin &&
    imageUrl.pathname.startsWith("/v8-assets/")
      ? imageUrl.pathname
      : "/v8-assets/quadruped.svg";
  return {
    projectId: project.id,
    artifactId: artifact.id,
    requirementId,
    approvalId: artifact.approvalId,
    branchId: artifact.branchId,
    cadRunId: artifact.cadRunId,
    revisionId: artifact.revisionId,
    descriptionId: artifact.descriptionId,
    isTemplate: Boolean(artifact.templateId),
    caseId,
    projectName: title?.textContent?.trim() || project.name,
    modelName,
    version,
    request,
    purpose,
    constraints,
    description: readableDesignText(
      project,
      project.approvals.find((a) => a.id === artifact.approvalId)
        ?.description ||
        revision?.description ||
        template?.description ||
        "",
    ),
    validationLabel:
      project.source === "preview"
        ? "概念参考 · 工程验证未执行"
        : "工程验证状态未提供",
    image: safeImage,
    template,
    parameters: { ...artifact.parameterSnapshot },
    brief: parseRequirementBrief(purpose, constraints),
  };
}

export function officialReportDocument(facts: OfficialReportFacts) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="embodex-report-format" content="${REPORT_FORMAT}"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(facts.projectName)} · 方案概览</title><style>${OFFICIAL_REPORT_STYLE}\n${adapterStyle}</style></head><body data-project-id="${escape(facts.projectId)}" data-requirement-id="${escape(facts.requirementId)}" data-artifact-id="${escape(facts.artifactId)}" data-approval-id="${escape(facts.approvalId)}" data-revision-id="${escape(facts.revisionId)}" data-description-id="${escape(facts.descriptionId)}" data-branch-id="${escape(facts.branchId)}" data-cad-run-id="${escape(facts.cadRunId)}"><div class="case-experience is-expanded"><header class="case-toolbar toolbar-minimal"><div class="case-tools"><button class="report-action report-close" type="button" aria-label="关闭完整设计方案" title="关闭方案"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div></header><div class="case-frame-mount"><div class="report-workbench-heading"><b>EmboMiX</b><span>${escape(facts.projectName)}</span></div><div id="report-interactive-host" class="report-interactive-host"></div><figure class="report-interactive-fallback"><img src="${escape(facts.image)}" alt="${escape(facts.modelName)}"></figure></div></div><img hidden data-robot-form="${facts.caseId}" src="${escape(facts.image)}" alt=""></body></html>`;
}

const budgetFields = [
  "quantity",
  "hardware",
  "software",
  "integration",
  "contingencyRate",
];
const operationFields = [
  "days",
  "dailyVolume",
  "windowHours",
  "taskMinutes",
  "rechargeMinutes",
  "batteryWh",
  "powerW",
  "usableFactor",
  "segmentsPerTask",
];
const economicFields = [
  "baselineMinutes",
  "hourlyCost",
  "successRate",
  "eligibleMinutes",
  "supervisionMinutes",
  "reviewMinutes",
  "recoveryMinutes",
  "careHours",
  "reworkSavings",
  "extraLaborCashRate",
];

export function mountOfficialReport(
  doc: Document,
  facts: OfficialReportFacts,
  actions: {
    onClose(): void;
    onMode(mode: string): void;
    onExport(kind: "print" | "html"): void;
  },
) {
  const id = facts.caseId;
  const workspaceArea = facts.brief.workspace
    .match(/\d[\d,.]*\s*(?:m²|m2|㎡|平方米)/i)?.[0]
    .replace(/m2/i, "m²");
  const workspaceMetric =
    workspaceArea ||
    (facts.brief.workspace.length <= 16 ? facts.brief.workspace : "按需求");
  const defaults: Record<string, number> = {
    quantity: 1,
    cashRate: 0,
    extraLaborCashRate: 0,
    segmentsPerTask: 1,
    usableFactor: 1,
  };
  const parameterSpecs =
    facts.template?.parameters.map((p) => ({
      label: p.label,
      value: `${facts.parameters[p.key] ?? p.defaultValue} ${p.unit}`,
    })) || [];
  const machineSpecs = [
    { label: "模型", value: facts.modelName },
    { label: "设计版本", value: facts.version },
    ...parameterSpecs,
  ];
  const brief = facts.brief;
  const task =
    brief.task || brief.purposeNotes || facts.purpose || facts.request;
  const place = brief.site || "作业场景待确认";
  const boundary =
    brief.workspace ||
    brief.constraintNotes ||
    facts.constraints ||
    "作业边界待确认";
  const safety = brief.safety || "安全与异常处理待确认";
  const acceptance = brief.acceptance || "验收标准待确认";
  const integration = brief.integration || "系统对接待确认";
  const configuration = [
    facts.modelName,
    ...parameterSpecs.map((p) => `${p.label} ${p.value}`),
  ].join("；");
  // Keep the supplied renderer; all project-specific narrative comes from its frozen source.
  const tasks = [
    {
      id: "prepare",
      title: "任务准备",
      place,
      action: boundary,
      output: brief.environment || "环境条件待确认",
      exception: safety,
    },
    {
      id: "configure",
      title: "配置核对",
      place,
      action: configuration,
      output: brief.payload || "任务载荷待确认",
      exception: "超出模型支持范围的修改需重新设计。",
    },
    {
      id: "execute",
      title: "执行任务",
      place,
      action: task,
      output: brief.performance || "作业性能目标待确认",
      exception: safety,
    },
    {
      id: "coordinate",
      title: "现场协作",
      place,
      action: safety,
      output: integration,
      exception: "按已确认的安全边界处理，未明确的处置方式需补充确认。",
    },
    {
      id: "review",
      title: "结果验收",
      place,
      action: acceptance,
      output: "依据验收标准记录结果与待验证项。",
      exception: "未达到标准时保留记录并修订设计。",
    },
  ];
  const visuals = /inspection-reference|mobile-reference/.test(
    facts.template?.assetKey || "",
  )
    ? {
        [id]: Object.fromEntries(
          ["sensors", "task", "engineering"].map((kind) => [
            kind,
            kind === "task"
              ? facts.image
              : `/v8-assets/official-${id === "mobile" ? "c2" : "q4"}-${kind}.png`,
          ]),
        ),
      }
    : {
        [id]: {
          sensors: facts.image,
          task: facts.image,
          engineering: facts.image,
        },
      };
  const runtime = installOfficialRuntime(doc, {
    projectIds: [id],
    visuals,
    adaptSolutions(data) {
      const current = data[id];
      current.title = `${facts.projectName}方案`.replace(/方案方案$/, "方案");
      current.taskLabel = facts.projectName;
      current.eyebrow = `PROJECT / ${facts.version}`;
      current.request = facts.request;
      current.summary = [task, brief.site].filter(Boolean).join(" · ");
      current.image = facts.image;
      current.steps = tasks.map((step) => ({
        title: step.title,
        text: step.action,
      }));
      current.systems = [
        { title: "模型设计", text: facts.description },
        { title: "任务与载荷", text: brief.payload || task },
        { title: "系统对接", text: integration },
      ];
      current.deliverables = ["设计方案", "三维模型"];
      current.metrics = [
        { label: "设计状态", value: facts.approvalId ? "已确认" : "已保存" },
        {
          label: "设计路径",
          value: facts.isTemplate ? "模板适配" : "专业定制",
        },
        {
          label: facts.brief.workspace ? "作业空间" : "模型配置",
          value: workspaceMetric || facts.modelName.split(" · ")[0],
        },
      ];
      current.validation = [
        {
          title: "任务与结果",
          text:
            facts.brief.acceptance ||
            facts.brief.task ||
            "按已确认需求核对任务结果，记录待验证项。",
        },
        {
          title: "空间与装配",
          text:
            facts.brief.workspace ||
            facts.brief.payload ||
            "核对模型外廓、零件关系与安装空间。",
        },
        {
          title: "环境与协作",
          text:
            facts.brief.safety ||
            facts.brief.environment ||
            "现场环境、人员协作与异常恢复需在后续验证。",
        },
      ];
    },
    adaptScenarios(projects, cards, engineering, integration) {
      projects[id].overview.title = facts.modelName;
      projects[id].overview.intro = facts.description;
      projects[id].overview.systems = [
        { name: facts.modelName, short: "模型配置", detail: configuration },
        {
          name: "感知与任务载荷",
          short: "任务载荷",
          detail: brief.payload || "按来源模型查看；任务载荷待确认。",
        },
        {
          name: "系统对接",
          short: "系统对接",
          detail: brief.integration || "系统对接待确认",
        },
        { name: "任务安排", short: "项目任务", detail: task },
      ];
      projects[id].title = "任务安排";
      projects[id].intro = place;
      projects[id].tasks = tasks;
      projects[id].KPIs = [
        {
          name: "作业性能",
          value: brief.performance || "待确认",
          unit: "",
          note: "设计目标",
        },
        {
          name: "工作范围",
          value: brief.workspace || "待确认",
          unit: "",
          note: "需求边界",
        },
        { name: "验收标准", value: acceptance, unit: "", note: "待执行验证" },
      ];
      cards[id].specs = [
        facts.modelName,
        `设计来源 · ${facts.version}`,
        ...parameterSpecs.map((p) => `${p.label} ${p.value}`),
      ];
      cards[id].views = [[brief.payload ? "任务载荷" : "来源模型", "camera"]];
      cards[id].integration = [
        boundary,
        brief.integration || "系统对接待确认",
        safety,
      ];
      engineering[id].detail = facts.description;
      engineering[id].features = [
        facts.validationLabel,
        ...parameterSpecs.map((p) => `${p.label} ${p.value}`),
      ];
      integration[id] = [
        ["本体配置", configuration, "对应来源三维模型", facts.validationLabel],
        [
          "任务载荷",
          brief.payload || "待确认",
          "安装与维护要求",
          facts.description,
        ],
        [
          "作业边界",
          boundary,
          brief.performance || "性能目标待确认",
          brief.environment || "环境条件待确认",
        ],
        ["系统与验收", brief.integration || "待确认", acceptance, safety],
      ];
    },
    adaptBusiness(data) {
      const config = data[id],
        plan = structuredClone(config.plans[0]);
      config.scope = task;
      config.engineering = [
        {
          title: "模型配置",
          text: configuration,
          simulation: facts.validationLabel,
          integration: facts.description,
        },
        {
          title: "作业边界",
          text: boundary,
          simulation: brief.performance || "作业性能待确认",
          integration: brief.environment || "环境条件待确认",
        },
        {
          title: "系统对接",
          text: integration,
          simulation: "接口行为待验证",
          integration,
        },
        {
          title: "安全与验收",
          text: safety,
          simulation: "工程验证待执行",
          integration: acceptance,
        },
      ];
      config.economics.unit = "次";
      config.economics.volumeLabel = "年任务量";
      Object.assign(plan, {
        id: "confirmed",
        name: "当前设计配置",
        model: facts.modelName,
        platform: facts.modelName,
        summary:
          facts.brief.task ||
          facts.brief.purposeNotes ||
          facts.purpose ||
          facts.description,
        // A unit weight keeps the website's hardware allocation formula valid.
        // No price is displayed or exported until the user supplies one.
        hardware: 1,
        software: 0,
        integration: 0,
        annualMaintenance: 0,
        repeatIntegration: 0,
        features: [
          facts.modelName,
          ...parameterSpecs.map((p) => `${p.label} ${p.value}`),
        ],
        included: [facts.modelName, "对应来源的三维模型", "本项目设计方案"],
        specs: machineSpecs,
        items: [
          {
            id: "platform",
            name: facts.modelName,
            qty: 1,
            unit: "台",
            unitPrice: 1,
            group: "hardware",
          },
        ],
        requirements: [
          {
            id: "task",
            label: "项目任务",
            mode: "设计目标",
            detail: facts.request,
          },
        ],
        operations: Object.fromEntries(
          Object.keys(plan.operations).map((k) => [k, 0]),
        ),
        cycle: {
          taskMinutes: 0,
          rechargeMinutes: 0,
          segmentsPerTask: 1,
          batteryWh: 0,
          powerW: 0,
          usableFactor: 1,
        },
        cycleNote: "",
      });
      config.plans = [plan];
      config.defaultPlanId = plan.id;
      config.budget.options = [];
      config.budget.defaults = { quantity: 1, contingencyRate: 0 };
      config.capacity.defaults = { days: 0, dailyVolume: 0, windowHours: 0 };
      config.capacity.note = "";
      config.economics.defaults = Object.fromEntries(
        Object.keys(config.economics.defaults).map((k) => [k, 0]),
      );
      config.economics.baselineNote = "填写项目的测算假设。";
      config.modelSources = [];
      config.delivery = [
        {
          module: "01",
          title: "明确需求",
          text: facts.request,
          output: "需求与约束 / 验收目标",
        },
        {
          module: "02",
          title: "设计探索",
          text: facts.isTemplate
            ? "从模板库选择对应构型。"
            : "比较概念并记录设计修改。",
          output: "设计方向 / 方案记录",
        },
        {
          module: "03",
          title: "模型概览",
          text: facts.description,
          output: "整机与组件 / 参数快照",
        },
        {
          module: "04",
          title: "工程模型",
          text: facts.approvalId
            ? "工程任务使用本方案确认的描述与参数。"
            : "保留来源模型与支持的配置。",
          output: "来源模型 / 配置记录",
        },
        {
          module: "05",
          title: "方案交付",
          text: "交付当前来源对应的方案与三维模型。",
          output: "设计方案 / 三维模型",
        },
      ];
    },
    onBusinessRefresh(root, current, state) {
      root
        .querySelectorAll(
          ".solution-kicker,.system-card-index,.business-module-heading>span",
        )
        .forEach((node) => node.remove());
      root.querySelector(".business-export")?.remove();
      // The interactive step disclosure has one active item. Print/offline reading
      // must retain every frozen step without depending on the site's JavaScript.
      if (!root.querySelector(".report-task-reading")) {
        const reading = doc.createElement("div");
        reading.className = "report-task-reading";
        reading.hidden = true;
        reading.setAttribute("data-i18n-ignore", "");
        reading.innerHTML = tasks
          .map(
            (step, index) =>
              `<article class="business-task-detail business-glass"><h4>${index + 1}. ${escape(step.title)}</h4><p>${escape(step.place)}</p><div>${[
                ["执行动作", step.action],
                ["任务输出", step.output],
                ["异常处理", step.exception],
              ]
                .map(
                  ([label, value]) =>
                    `<article><h5>${label}</h5><p>${escape(value)}</p></article>`,
                )
                .join("")}</div></article>`,
          )
          .join("");
        root.querySelector("#business-task-detail")?.after(reading);
      }
      root
        .querySelectorAll<HTMLElement>(".business-context-band article p")
        .forEach((node, index) => {
          node.textContent =
            [safety, integration, acceptance][index] || "待确认";
          node.setAttribute("data-i18n-ignore", "");
        });
      root
        .querySelectorAll<HTMLElement>(".business-value-summary article p")
        .forEach((node, index) => {
          node.textContent =
            [acceptance, safety, integration][index] || "待确认";
          node.setAttribute("data-i18n-ignore", "");
        });
      const segmentsLabel = root
        .querySelector('[data-business-field="segmentsPerTask"]')
        ?.closest("label")
        ?.querySelector("span");
      if (segmentsLabel) segmentsLabel.textContent = "每项任务分段";
      root
        .querySelectorAll(
          ".business-operation-card:nth-child(2) .business-note:not([data-business-out])",
        )
        .forEach((node) => {
          node.textContent = "功耗按当前模型及配套设备的实测值填写。";
        });
      const known = (key: string) =>
        Number.isFinite(state[key]) ||
        (state[key] !== null && key in defaults) ||
        (key === "annualVolume" &&
          Number.isFinite(state.days) &&
          Number.isFinite(state.dailyVolume));
      const budgetReady = budgetFields.every(known);
      const operationReady = operationFields.every(known);
      const operatingReady =
        operationReady && ["annualMaintenance", "energyPrice"].every(known);
      const economyReady =
        budgetReady && operatingReady && economicFields.every(known);
      root
        .querySelectorAll<HTMLInputElement>("[data-business-field]")
        .forEach((input) => {
          const key = input.dataset.businessField!;
          if (!known(key)) {
            input.value = "";
            input.placeholder = "待填写";
          }
        });
      const budgetKeys = [
        "total",
        "reserve",
        "threeYear",
        "repeatUnit",
        "repeatFleet",
        "investmentBase",
      ];
      const operationKeys = [
        "perUnitDaily",
        "annualCapacity",
        "runtimeMinutes",
        "requiredWh",
        "availableWh",
        "energyStatus",
        "perDay",
        "annualKWh",
        "requestedVolume",
        "countedVolume",
        "unservedVolume",
      ];
      const economyKeys = [
        "releasedHours",
        "laborValue",
        "netCash",
        "payback",
        "laborCash",
        "threeYearNet",
        "breakEvenCash",
        "remainingManualHours",
        "successful",
        "failed",
      ];
      root
        .querySelectorAll<HTMLElement>("[data-business-out]")
        .forEach((node) => {
          const key = node.dataset.businessOut!;
          if (
            (budgetKeys.includes(key) && !budgetReady) ||
            ([
              "hardware",
              "software",
              "integration",
              "annualMaintenance",
            ].includes(key) &&
              !known(key)) ||
            (operationKeys.includes(key) && !operationReady) ||
            (["annualEnergy", "annualOperating", "threeYear"].includes(key) &&
              !operatingReady) ||
            (economyKeys.includes(key) && !economyReady)
          )
            node.textContent = "—";
          if (
            ["repeatUnit", "repeatFleet"].includes(key) &&
            !known("repeatIntegration")
          )
            node.textContent = "—";
        });
      root.querySelectorAll(".business-plan-price").forEach((node) => {
        node.innerHTML = "—<small>待填写预算</small>";
      });
      root
        .querySelectorAll<HTMLElement>("[data-business-cash-chart]")
        .forEach((node) => {
          node.hidden = !economyReady;
          if (!economyReady) node.replaceChildren();
        });
      if (!economyReady)
        root
          .querySelectorAll("[data-business-sensitivity] td")
          .forEach((node) => {
            node.textContent = "—";
          });
      const comparisonReady: Record<string, boolean> = {
        一次投入: budgetReady,
        年度维护费: known("annualMaintenance"),
        年度任务电费: operatingReady,
        年度运行费: operatingReady,
        单台每日能力: operationReady,
        年度净工时变化: economyReady,
        年度净现金: economyReady,
      };
      root
        .querySelectorAll("[data-business-comparison] tbody tr")
        .forEach((row) => {
          const label = row.querySelector("th")?.textContent?.trim() || "";
          if (comparisonReady[label] === false)
            row.querySelectorAll("td").forEach((cell) => {
              cell.textContent = "—";
            });
        });
      if (!known("hardware"))
        root
          .querySelectorAll(
            "[data-business-inventory] tbody td:nth-child(n+3),[data-business-inventory] tfoot td",
          )
          .forEach((node) => {
            node.textContent = "—";
          });
      const options = root.querySelector<HTMLElement>(".business-options");
      if (options) options.hidden = true;
      const header = root.querySelector(
        "#solution-delivery .solution-section-description",
      );
      header?.remove();
      const footer = root.querySelector(".solution-footer p>span");
      if (footer) footer.textContent = "方案配置、预算测算与交付流程";
      const quoteNote = root.querySelector(
        "#solution-budget > .report-assumption-note",
      );
      if (!quoteNote) {
        const note = doc.createElement("p");
        note.className = "report-assumption-note";
        note.textContent = "以下为可编辑测算，未填写的金额与性能不作估算。";
        root.querySelector("#solution-budget > header")?.after(note);
      }
      current.source = {
        projectId: facts.projectId,
        artifactId: facts.artifactId,
        requirementId: facts.requirementId,
        revisionId: facts.revisionId,
        approvalId: facts.approvalId,
      };
    },
  });
  const shell = doc.querySelector<HTMLElement>(".case-experience")!;
  const mount = doc.querySelector<HTMLElement>(".case-frame-mount")!;
  const solution = runtime.api.initSolutionPage({
    shell,
    mount,
    onProjectSelect: () => {},
    onModeSelect: actions.onMode,
  });
  solution.setExpanded(true);
  doc
    .querySelectorAll(
      ".solution-kicker,.report-workbench-heading,.solution-parameter-note,.solution-example-label,.solution-hero-art figcaption",
    )
    .forEach((node) => node.remove());
  // Project-authored facts stay intact when the supplied UI changes language.
  doc
    .querySelectorAll(
      "#solution-title,.solution-summary,.solution-brief>div>p:last-child,.solution-metrics dd,.solution-projects,.report-workbench-heading,.business-selected-specs dd",
    )
    .forEach((node) => node.setAttribute("data-i18n-ignore", ""));
  const interactiveNote = doc.querySelector(
    "#solution-interactive .solution-section-description",
  );
  interactiveNote?.remove();
  const tools = doc.querySelector<HTMLElement>(".case-tools")!;
  const close = doc.querySelector(".report-close");
  for (const [kind, label, path] of [
    ["print", "打印 / 另存为 PDF", "M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7Z"],
    ["html", "下载 HTML", "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"],
  ]) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "report-action";
    button.dataset.reportExport = kind;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      path +
      '"/></svg><span>' +
      label +
      "</span>";
    tools.insertBefore(button, close);
  }
  const topStatus = doc.createElement("span");
  topStatus.className = "report-action-status";
  topStatus.setAttribute("role", "status");
  tools.append(topStatus);
  const topExport = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "[data-report-export]",
    );
    const kind = button?.dataset.reportExport;
    if (button && !button.disabled && (kind === "html" || kind === "print"))
      actions.onExport(kind);
  };
  tools.addEventListener("click", topExport);
  close?.addEventListener("click", actions.onClose);
  const openNotice = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (
      link &&
      new URL(link.href, window.location.origin).pathname.startsWith(
        "/v8-assets/",
      )
    ) {
      event.preventDefault();
      window.open(
        new URL(link.getAttribute("href")!, window.location.origin).href,
        "_blank",
        "noopener",
      );
    }
  };
  doc.addEventListener("click", openNotice);
  const modelHost = doc.getElementById("report-interactive-host")!;
  if (facts.template) {
    const source = doc.createElement("details");
    source.className = "business-detail";
    const heading = doc.createElement("summary");
    heading.textContent = "模型来源";
    source.append(heading);
    const content = doc.createElement("div");
    content.className = "business-detail-body";
    const name = doc.createElement("p");
    name.textContent = facts.template.source;
    content.append(name);
    const license = doc.createElement("p");
    license.textContent = facts.template.license;
    content.append(license);
    if (facts.template.licenseUrl?.startsWith("/v8-assets/")) {
      const link = doc.createElement("a");
      link.href = facts.template.licenseUrl;
      link.textContent = "查看使用说明";
      link.target = "_blank";
      link.rel = "noopener";
      content.append(link);
    }
    source.append(content);
    doc.querySelector("#solution-delivery .solution-footer")?.before(source);
    if (!source.isConnected)
      doc.querySelector("#solution-delivery")?.append(source);
  }
  return {
    modelHost,
    api: runtime.api,
    dispose() {
      close?.removeEventListener("click", actions.onClose);
      doc.removeEventListener("click", openNotice);
      tools.removeEventListener("click", topExport);
      runtime.dispose();
    },
  };
}

/** Freeze the original reader's current values into a standalone, script-free document. */
export function snapshotOfficialReading(doc: Document) {
  const copy = doc.documentElement.cloneNode(true) as HTMLElement;
  // Copy live form values before removing the viewer and its own form controls.
  const liveInputs = doc.querySelectorAll<HTMLInputElement>("input");
  copy.querySelectorAll<HTMLInputElement>("input").forEach((input, index) => {
    input.setAttribute("value", liveInputs[index]?.value || "");
    input.readOnly = true;
    if (liveInputs[index]?.checked) input.setAttribute("checked", "");
    else input.removeAttribute("checked");
    if (["radio", "checkbox"].includes(input.type)) input.disabled = true;
  });
  copy.querySelector("#report-interactive-host")?.remove();
  copy.querySelector(".report-workbench-heading")?.remove();
  // Offline reading and browser printing must not defer figures below the fold.
  copy.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    img.loading = "eager";
  });
  copy
    .querySelectorAll<HTMLElement>(".report-interactive-fallback")
    .forEach((n) => {
      n.style.display = "block";
    });
  copy
    .querySelectorAll(
      "[data-language-toggle],.report-close,[data-report-export],.report-action-status,.business-export-actions,[data-report-workspace]",
    )
    .forEach((n) => n.remove());
  copy
    .querySelector<HTMLElement>(".report-task-reading")
    ?.removeAttribute("hidden");
  copy
    .querySelectorAll(
      ".business-task-steps,#business-task-detail,#solution-engineering>.business-subheading>p,[data-business-reset],[data-solution-mode]",
    )
    .forEach((node) => node.remove());
  copy
    .querySelectorAll<HTMLElement>("[data-solution-jump]")
    .forEach((button) => {
      const link = doc.createElement("a");
      link.href = `#solution-${button.dataset.solutionJump}`;
      link.className = button.className;
      link.innerHTML = button.innerHTML;
      if (button.getAttribute("aria-current"))
        link.setAttribute("aria-current", button.getAttribute("aria-current")!);
      button.replaceWith(link);
    });
  copy
    .querySelectorAll<HTMLAnchorElement>('a[href^="/v8-assets/"]')
    .forEach((link) => {
      link.href = new URL(
        link.getAttribute("href")!,
        window.location.origin,
      ).href;
    });
  copy.querySelectorAll("style").forEach((style) => {
    style.textContent =
      style.textContent
        ?.replaceAll(".solution-nav button", ".solution-nav :is(button,a)")
        .replaceAll(
          ".solution-footer button",
          ".solution-footer :is(button,a)",
        ) || "";
  });
  copy.querySelector(".case-experience")?.removeAttribute("style");
  const style = doc.createElement("style");
  style.textContent =
    ".solution-nav a,.solution-footer a{text-decoration:none;display:inline-flex;align-items:center}.case-experience{--solution-toolbar-height:64px;--solution-project-height:70px;--solution-nav-height:58px}";
  copy.querySelector("head")?.append(style);
  return `<!doctype html>${copy.outerHTML}`;
}

export async function createOfficialReadingExport(
  project: Project,
  artifact: Artifact,
) {
  const facts = readOfficialReportFacts(project, artifact);
  const doc = new DOMParser().parseFromString(
    officialReportDocument(facts),
    "text/html",
  );
  const reader = mountOfficialReport(doc, facts, {
    onClose() {},
    onMode() {},
    onExport() {},
  });
  try {
    return (
      await embedDesignReportHtml(snapshotOfficialReading(doc), {
        baseUrl: window.location.origin,
      })
    ).html;
  } finally {
    reader.dispose();
  }
}
