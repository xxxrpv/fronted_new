"use client";

import type { Project } from "../../lib/v8/types";
import type { WorkspaceProject } from "../../lib/v8/module-workspace";
import { MODULES } from "../../lib/v8/module-workspace";
import { TEMPLATE_CATALOG } from "../../lib/v8/catalog";
import { groupDeliveryPackages } from "../../lib/v8/delivery-packages";
import { parseRequirementBrief } from "../../lib/v8/requirements-brief";
import { projectResumePath } from "../../lib/v8/project-navigation";

const stages = ["明确需求", "设计探索", "模型概览", "工程模型", "方案交付"];
const stageIndex: Record<string, number> = {
  requirements: 0,
  start: 1,
  library: 2,
  concepts: 2,
  cad: 3,
  delivery: 4,
};
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
const version = (value: number) => `V${String(value).padStart(2, "0")}`;

export default function WorkspaceProjectOverview({
  project,
  design,
  busy,
  onClose,
  onContinue,
}: {
  project: WorkspaceProject;
  design?: Project;
  busy: boolean;
  onClose(): void;
  onContinue(): void;
}) {
  const requirement = design?.requirements.at(-1);
  const brief = parseRequirementBrief(
    requirement?.purpose,
    requirement?.constraints,
  );
  const revisions =
    design?.branches
      .flatMap((b) => b.revisions)
      .filter((r) => r.requirementId === requirement?.id) || [];
  const approval = design?.approvals
    .filter(
      (a) =>
        a.requirementId === requirement?.id &&
        design.branches.some(
          (b) => b.id === a.branchId && b.latestRevisionId === a.revisionId,
        ),
    )
    .at(-1);
  const revision =
    revisions.find((r) => r.id === approval?.revisionId) || revisions.at(-1);
  const template = TEMPLATE_CATALOG.find((t) =>
    design?.templateId
      ? t.id === design.templateId
      : t.assetKey === revision?.assetKey,
  );
  const delivery = design
    ? groupDeliveryPackages(design).find(
        (p) => p.isCurrent && (p.documentReady || p.modelReady),
      )
    : undefined;
  const activeTask = design?.tasks
    .filter(
      (t) =>
        t.requirementId === requirement?.id &&
        ["running", "queued", "unknown"].includes(t.status),
    )
    .at(-1);
  const latestTask = design?.tasks
    .filter((t) => t.requirementId === requirement?.id)
    .at(-1);
  const hasDesign = project.modules.includes("embodex");
  const currentIndex = design
    ? (stageIndex[projectResumePath(design).split(/[/?]/)[0]] ?? 0)
    : 0;
  const state = !hasDesign
    ? "暂未开放"
    : !design
      ? "尚未开始"
      : activeTask
        ? (
            {
              queued: "等待执行",
              running: "任务进行中",
              unknown: "任务待确认",
            } as Record<string, string>
          )[activeTask.status]
        : latestTask?.status === "failed"
          ? "任务未完成"
          : stages[currentIndex];
  const goal = requirement?.text || project.summary || "尚未填写设计需求";
  const fields = [
    ["任务", brief.task || brief.purposeNotes],
    ["场景", brief.site],
    ["工作范围", brief.workspace],
    ["载荷", brief.payload],
    ["性能", brief.performance],
    ["环境", brief.environment],
    ["安全", brief.safety],
    ["对接", brief.integration],
    ["验收", brief.acceptance],
    ["约束", brief.constraintNotes],
  ].filter(([, value]) => value);
  const completed: { label: string; value: string; date?: string }[] = [];
  if (requirement)
    completed.push({
      label: "需求已保存",
      value: version(requirement.sequence),
      date: requirement.createdAt,
    });
  if (design?.templateId && template)
    completed.push({ label: "模板已选择", value: template.name });
  else if (revisions.length)
    completed.push({
      label: "概念已生成",
      value: `${revisions.length} 个版本`,
      date: revision?.createdAt,
    });
  if (approval)
    completed.push({
      label: "设计已确认",
      value: revision ? version(revision.sequence) : "已确认",
      date: approval.approvedAt,
    });
  if (delivery?.documentReady)
    completed.push({
      label: "设计方案已就绪",
      value: "可在线查看",
      date: delivery.createdAt,
    });
  if (delivery?.modelReady)
    completed.push({
      label: "三维模型已就绪",
      value: "可交互查看",
      date: delivery.createdAt,
    });
  const poster =
    template &&
    ["go2-high-fidelity", "inspection-reference", "mobile-reference"].includes(
      template.assetKey,
    )
      ? `/v8-assets/catalog/${template.assetKey}.png`
      : undefined;

  return (
    <section className="mx-project-detail mx-overview" aria-label="项目概览">
      <header className="mx-overview-heading">
        <div>
          <span className="mx-overview-caption">项目概览</span>
          <h1>{project.name}</h1>
        </div>
        <button
          className="mx-overview-close"
          aria-label="关闭项目概览"
          title="返回模块选择"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </header>
      <div className="mx-overview-meta">
        <div>
          {MODULES.filter((m) => project.modules.includes(m.id)).map((m) => (
            <span key={m.id}>
              {m.name}
              {m.id !== "embodex" && <small>未开放</small>}
            </span>
          ))}
        </div>
        <time dateTime={project.updatedAt}>
          更新于 {shortDate(project.updatedAt)}
        </time>
      </div>
      <div className={`mx-overview-hero ${poster ? "" : "without-model"}`}>
        {poster && (
          <figure>
            <img src={poster} alt={template?.name} width={420} height={320} />
            <figcaption>{template?.name}</figcaption>
          </figure>
        )}
        <div className="mx-overview-progress">
          <span className="mx-overview-caption">当前进展</span>
          <h2>{state}</h2>
          {activeTask && <p role="status">{activeTask.currentStep}</p>}
          {hasDesign && (
            <ol aria-label="设计进展">
              {stages.map((label, i) => (
                <li
                  key={label}
                  className={
                    design && i === currentIndex
                      ? "current"
                      : design && i < currentIndex
                        ? "reached"
                        : ""
                  }
                  aria-current={
                    design && i === currentIndex ? "step" : undefined
                  }
                >
                  <i>{String(i + 1).padStart(2, "0")}</i>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          )}
          {hasDesign && (
            <button
              className="mx-overview-continue"
              disabled={busy}
              onClick={onContinue}
            >
              {busy
                ? "正在打开…"
                : project.embodexProjectId
                  ? "继续设计"
                  : "开始设计"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </div>
      <div className="mx-overview-panels">
        <section
          className="mx-overview-requirements"
          aria-labelledby="mx-overview-requirements-title"
        >
          <header>
            <h2 id="mx-overview-requirements-title">需求</h2>
            {requirement && <span>{version(requirement.sequence)}</span>}
          </header>
          <p className="mx-overview-goal">{goal}</p>
          {fields.length > 0 && (
            <dl>
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section
          className="mx-overview-completed"
          aria-labelledby="mx-overview-completed-title"
        >
          <header>
            <h2 id="mx-overview-completed-title">已完成</h2>
            <span>{completed.length.toString().padStart(2, "0")}</span>
          </header>
          {completed.length ? (
            <ul>
              {completed.map((item) => (
                <li key={item.label}>
                  <span className="mx-overview-check" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.value}</span>
                  </div>
                  {item.date && (
                    <time dateTime={item.date}>{shortDate(item.date)}</time>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mx-overview-empty">尚无完成记录</p>
          )}
        </section>
      </div>
    </section>
  );
}
