import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missingRequirementItems,
  parseRequirementBrief,
  serializeRequirementsPurpose,
  serializeRequirementsConstraints,
} from "../lib/v8/requirements-brief";

test("Existing free-text purposes and constraints survive roundtrip without guessing structured facts", () => {
  const purpose = "任务与对象：这仍然是一段旧资料\n\n保留换行与空格  ";
  const constraints = "  通道条件待确认\n续航未知\n";
  const brief = parseRequirementBrief(purpose, constraints);
  assert.equal(brief.task, "");
  assert.equal(brief.workspace, "");
  assert.equal(serializeRequirementsPurpose(brief), purpose);
  assert.equal(serializeRequirementsConstraints(brief), constraints);
  assert.equal(missingRequirementItems(purpose, constraints).length, 5);
});

test("All nine explicit fields and original notes persist through the existing readable text contract", () => {
  const brief = {
    ...parseRequirementBrief("原始用途", "原始限制"),
    task: "设备温升检测",
    site: "仓库夜间巡查",
    payload: "热像仪与相机",
    workspace: "通道净宽 1.2 m",
    performance: "每晚两轮",
    environment: "室内弱光",
    safety: "人员接近时停机并通知",
    integration: "现有报警平台",
    acceptance: "10 次路线测试均完成且记录可回放",
  };
  const purpose = serializeRequirementsPurpose(brief);
  const constraints = serializeRequirementsConstraints(brief);
  assert.match(purpose, /任务与对象：设备温升检测/);
  assert.match(constraints, /验收标准：10 次路线测试/);
  assert.deepEqual(parseRequirementBrief(purpose, constraints), brief);
  assert.deepEqual(missingRequirementItems(purpose, constraints), []);
});

test("Multiline field values including label-looking lines cannot spill into another field", () => {
  const brief = {
    ...parseRequirementBrief("\n原用途\n", "原约束\n"),
    task: "\n首行留白\n作业场景：这属于任务正文\n",
    safety: "\n禁止接近\n验收标准：这属于安全正文\n",
  };
  const saved = parseRequirementBrief(
    serializeRequirementsPurpose(brief),
    serializeRequirementsConstraints(brief),
  );
  assert.deepEqual(saved, brief);
  assert.equal(saved.site, "");
  assert.equal(saved.acceptance, "");
});

test("A single populated field does not silently mark the requirement ready", () => {
  const brief = { ...parseRequirementBrief("", ""), environment: "室内" };
  assert.equal(
    missingRequirementItems(
      serializeRequirementsPurpose(brief),
      serializeRequirementsConstraints(brief),
    ).length,
    5,
  );
  brief.task = "巡检设备";
  assert.deepEqual(
    missingRequirementItems(
      serializeRequirementsPurpose(brief),
      serializeRequirementsConstraints(brief),
    ),
    ["作业场景", "空间与工作范围", "安全与协作边界", "可验证的验收标准"],
  );
});

test("Removing optional structured fields restores the original free text", () => {
  const brief = {
    ...parseRequirementBrief("旧用途", "旧约束"),
    payload: "相机",
  };
  const edited = parseRequirementBrief(
    serializeRequirementsPurpose(brief),
    serializeRequirementsConstraints(brief),
  );
  edited.payload = "";
  assert.equal(serializeRequirementsPurpose(edited), "旧用途");
  assert.equal(serializeRequirementsConstraints(edited), "旧约束");
});
