/** Human-readable structure inside the existing purpose/constraints contract. */
export interface RequirementBrief {
  task: string;
  site: string;
  payload: string;
  workspace: string;
  performance: string;
  environment: string;
  safety: string;
  integration: string;
  acceptance: string;
  purposeNotes: string;
  constraintNotes: string;
}

export const REQUIREMENT_BRIEF_FIELDS = [
  {
    key: "task",
    label: "任务与对象",
    placeholder: "做什么、面向什么对象；如巡查设备温升、搬运料箱",
    group: "purpose",
  },
  {
    key: "site",
    label: "作业场景",
    placeholder: "在哪里、怎样作业；如室内仓库、定时巡检、人工复核",
    group: "purpose",
  },
  {
    key: "payload",
    label: "任务载荷",
    placeholder: "工具、传感器或搬运物；填写质量、尺寸、安装需求",
    group: "purpose",
  },
  {
    key: "workspace",
    label: "空间与工作范围",
    placeholder: "通道净宽、工作半径、目标高度、坡度或作业区域",
    group: "constraints",
  },
  {
    key: "performance",
    label: "作业性能",
    placeholder: "节拍、精度、速度、续航或每日工作量；注明单位",
    group: "constraints",
  },
  {
    key: "environment",
    label: "环境边界",
    placeholder: "温湿度、光照、粉尘、雨水、地面及供电条件",
    group: "constraints",
  },
  {
    key: "safety",
    label: "安全与协作",
    placeholder: "人员与设备接近方式、隔离区域、停机及人工接管要求",
    group: "constraints",
  },
  {
    key: "integration",
    label: "系统对接",
    placeholder: "通信、控制、数据格式、现有系统及充电/维护接口",
    group: "constraints",
  },
  {
    key: "acceptance",
    label: "验收标准",
    placeholder: "怎样证明完成；如测试场景、成功率、误差和测试次数",
    group: "constraints",
  },
] as const;
export type RequirementBriefField =
  (typeof REQUIREMENT_BRIEF_FIELDS)[number]["key"];
const PURPOSE_HEADER = "【任务定义】";
const CONSTRAINT_HEADER = "【设计边界】";
const empty = (): RequirementBrief => ({
  task: "",
  site: "",
  payload: "",
  workspace: "",
  performance: "",
  environment: "",
  safety: "",
  integration: "",
  acceptance: "",
  purposeNotes: "",
  constraintNotes: "",
});

function readSection(
  text: string,
  group: "purpose" | "constraints",
  brief: RequirementBrief,
) {
  const header = group === "purpose" ? PURPOSE_HEADER : CONSTRAINT_HEADER;
  const notes = group === "purpose" ? "purposeNotes" : "constraintNotes";
  if (!text.startsWith(header + "\n")) {
    brief[notes] = text;
    return;
  }
  const fields = REQUIREMENT_BRIEF_FIELDS.filter(
    (field) => field.group === group,
  );
  let current: keyof RequirementBrief = notes;
  const seen = new Set<keyof RequirementBrief>();
  const append = (key: keyof RequirementBrief, value: string) => {
    brief[key] += (seen.has(key) ? "\n" : "") + value;
    seen.add(key);
  };
  for (const line of text.slice(header.length + 1).split("\n")) {
    const field =
      !line.startsWith("  ") &&
      fields.find((field) => line.startsWith(field.label + "："));
    const noteLabel = group === "purpose" ? "补充用途：" : "补充约束：";
    if (field) {
      current = field.key;
      append(current, line.slice(field.label.length + 1));
    } else if (!line.startsWith("  ") && line.startsWith(noteLabel)) {
      current = notes;
      append(current, line.slice(noteLabel.length));
    } else {
      append(current, line.startsWith("  ") ? line.slice(2) : line);
    }
  }
}

/** Legacy text is preserved verbatim; it is never guessed into a field. */
export function parseRequirementBrief(
  purpose = "",
  constraints = "",
): RequirementBrief {
  const brief = empty();
  readSection(purpose, "purpose", brief);
  readSection(constraints, "constraints", brief);
  return brief;
}

function writeSection(
  brief: RequirementBrief,
  group: "purpose" | "constraints",
) {
  const fields = REQUIREMENT_BRIEF_FIELDS.filter(
    (field) => field.group === group,
  );
  const noteKey = group === "purpose" ? "purposeNotes" : "constraintNotes";
  const noteLabel = group === "purpose" ? "补充用途" : "补充约束";
  if (!fields.some((field) => brief[field.key].trim())) return brief[noteKey];
  const lines = fields
    .filter((field) => brief[field.key].trim())
    .map(
      (field) => `${field.label}：${brief[field.key].replace(/\n/g, "\n  ")}`,
    );
  if (brief[noteKey])
    lines.push(`${noteLabel}：${brief[noteKey].replace(/\n/g, "\n  ")}`);
  return [
    group === "purpose" ? PURPOSE_HEADER : CONSTRAINT_HEADER,
    ...lines,
  ].join("\n");
}
export const serializeRequirementsPurpose = (brief: RequirementBrief): string =>
  writeSection(brief, "purpose");
export const serializeRequirementsConstraints = (
  brief: RequirementBrief,
): string => writeSection(brief, "constraints");

/** Review prompts only; these never block a user from saving a design goal. */
export function missingRequirementItems(
  purpose: string,
  constraints: string,
): string[] {
  const brief = parseRequirementBrief(purpose, constraints);
  const critical = [
    ["task", "作业任务与对象"],
    ["site", "作业场景"],
    ["workspace", "空间与工作范围"],
    ["safety", "安全与协作边界"],
    ["acceptance", "可验证的验收标准"],
  ] as const;
  return critical
    .filter(([key]) => !brief[key].trim())
    .map(([, label]) => label);
}
