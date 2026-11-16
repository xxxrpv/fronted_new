import type { AssetKey, Project, Template } from "./types";

export const TEMPLATE_CATALOG: Template[] = [
  {
    id: "sample-go2",
    name: "Go2 · 精细结构参考",
    category: "开源四足机器人",
    assetKey: "go2-high-fidelity",
    description:
      "采用来源 OBJ 的完整可视网格与 MJCF 装配坐标，保留壳体曲面、关节和足部细节。可按真实来源组件查看与拆解。",
    source: "Unitree Robotics / MuJoCo Menagerie · 固定来源版本",
    license: "BSD-3-Clause",
    sourceKind: "licensed-reference",
    licenseUrl: "/v8-assets/go2-LICENSE.txt",
    provenanceUrl: "/v8-assets/go2-provenance.json",
    precisionNote:
      "保留来源网格精度与米制坐标；原资产为可视化/运动学参考，不是制造级 CAD 或完整制造 BOM。",
    capabilities: ["精细网格查看", "来源组件拆解", "部件定位", "感知结构查看"],
    parameters: [],
  },
  {
    id: "sample-inspection",
    name: "Q4 · 精细巡检构型",
    category: "官网巡检概念参考",
    assetKey: "inspection-reference",
    description:
      "沿用官网巡检构型的精细可视网格、相机总成、电子部件与安装结构，保留原有组件坐标与曲面细节。",
    source: "EmbodiX 官网交付版 · 巡检概念构型 / BSD 衍生网格",
    license: "BSD-3-Clause + 项目提供的概念附件",
    sourceKind: "licensed-reference",
    licenseUrl: "/v8-assets/inspection-LICENSE.txt",
    provenanceUrl: "/v8-assets/inspection-provenance.json",
    precisionNote:
      "来源可视网格与组件变换保持一致。额外巡检附件属于官网概念设计，不能视为 Go2 原厂内部零件或已验证制造 BOM。",
    capabilities: [
      "精细网格查看",
      "部件详情",
      "连续拆解",
      "感知结构",
      "相机总成位置预览",
    ],
    parameters: [
      {
        key: "inspectionCameraHeight",
        part: "inspection.camera-assembly",
        label: "相机总成高度偏移",
        unit: "m",
        min: -0.05,
        max: 0.05,
        step: 0.005,
        defaultValue: 0,
        effect: "visual",
        description: "调整相机总成的竖直位置；保存时写入配置模型。",
      },
    ],
  },
  {
    id: "sample-mobile",
    name: "C2 · 精细移动平台",
    category: "官网 AMR 概念参考",
    assetKey: "mobile-reference",
    description:
      "复用官网移动平台的底盘、驱动、电控、举升与感知细节，原样保留来源模型的部件和几何。",
    source: "EmbodiX 官网交付版 · AMR 移动平台概念源",
    license: "项目提供的原创概念源 · 使用说明见来源文件",
    sourceKind: "supplied-concept-reference",
    licenseUrl: "/v8-assets/mobile-source-NOTICE.txt",
    provenanceUrl: "/v8-assets/mobile-provenance.json",
    precisionNote:
      "属于项目提供的详细概念模型。零件名称、曲面和坐标来自原示例，不代表某款量产 AMR 的制造图纸或经过验证的装配精度。",
    capabilities: [
      "精细网格查看",
      "部件详情",
      "连续拆解",
      "感知结构",
      "对接相机位置预览",
    ],
    parameters: [
      {
        key: "mobileCameraHeight",
        part: "dock-camera",
        label: "对接相机高度偏移",
        unit: "m",
        min: -0.05,
        max: 0.05,
        step: 0.005,
        defaultValue: 0,
        effect: "visual",
        description: "调整对接相机的竖直位置；保存时写入配置模型。",
      },
    ],
  },
  {
    id: "sample-quadruped",
    retired: true,
    name: "Q4 · 四足巡检平台",
    category: "四足机器人",
    assetKey: "quadruped",
    description: "四足支撑、抬高的传感器平台。原创可打开的结构示意模型。",
    source: "Embodex 原创开发样例",
    license: "CC0-1.0",
    capabilities: [
      "旋转与缩放",
      "真实部件选择",
      "结构拆解",
      "传感器视觉高度调整",
    ],
    parameters: [
      {
        key: "sensorOffset",
        part: "sensor",
        label: "传感器高度偏移",
        unit: "m",
        min: 0,
        max: 0.18,
        step: 0.01,
        defaultValue: 0,
        effect: "visual",
        description:
          "仅改变当前 Web3D 视图；原始 GLB 不会被重写，不属于 CAD 重新生成。",
      },
    ],
  },
  {
    id: "sample-compact",
    retired: true,
    name: "C2 · 紧凑移动平台",
    category: "移动机器人",
    assetKey: "compact",
    description: "紧凑轮式底盘、低重心上装。原创结构示意模型。",
    source: "Embodex 原创开发样例",
    license: "CC0-1.0",
    capabilities: [
      "旋转与缩放",
      "真实部件选择",
      "结构拆解",
      "传感器视觉高度调整",
    ],
    parameters: [
      {
        key: "sensorOffset",
        part: "sensor",
        label: "传感器高度偏移",
        unit: "m",
        min: 0,
        max: 0.18,
        step: 0.01,
        defaultValue: 0,
        effect: "visual",
        description:
          "当前视图的临时位置调整；下载原始 GLB 与配置说明分别交付。",
      },
    ],
  },
];

export const CONCEPT_CATALOG: Array<{
  assetKey: AssetKey;
  name: string;
  differentiator: string;
  rationale: string;
  limitation: string;
  mediaType: "model" | "image";
}> = [
  {
    assetKey: "mobile-reference",
    name: "移动巡检构型",
    differentiator: "轮式底盘 · 举升与电控结构",
    rationale: "以官网提供的精细移动平台为参考，比较平整场地的移动与装载布局。",
    limitation:
      "详细概念参考；来源零件和网格已保留，尚未进行制造或任务性能验证。",
    mediaType: "model",
  },
  {
    assetKey: "inspection-reference",
    name: "四足巡检构型",
    differentiator: "四足本体 · 复合感知总成",
    rationale: "参考官网巡检构型，比较多关节结构、相机布置和维护空间。",
    limitation:
      "BSD 衍生网格与官网概念附件，不是原厂内部 BOM 或已验证工程成果。",
    mediaType: "model",
  },
  {
    assetKey: "tripod",
    name: "三足布局探索",
    differentiator: "三点支撑 · 中央设备空间",
    rationale: "通过二维布局示意讨论三足方向，后续精细建模需要设计服务。",
    limitation: "仅提供二维结构探索，不提供虚假的三维或制造精度承诺。",
    mediaType: "image",
  },
  {
    assetKey: "go2-high-fidelity",
    name: "原始四足结构基线",
    differentiator: "原始开源几何 · 关节与曲面细节",
    rationale: "使用来源明确的 Go2 原始网格，作为巡检附件方案的结构对照。",
    limitation: "保留来源几何与运动学坐标，未完成针对本项目的工程设计。",
    mediaType: "model",
  },
];

/** Generated fixture byte counts are populated from original authored GLB files. */
export const MODEL_BYTES: Record<AssetKey, number> = {
  "go2-high-fidelity": 5819168,
  "inspection-reference": 13151488,
  "mobile-reference": 3781220,
  compact: 26588,
  quadruped: 21916,
  tripod: 19340,
  conveyor: 18644,
};

export const TEMPLATES = TEMPLATE_CATALOG.filter((t) => !t.retired);
export function recommendTemplates(project: Project): {
  templates: Template[];
  rationale: string;
} {
  if (project.source !== "preview")
    return {
      templates: [],
      rationale: "真实模板匹配与能力描述接口尚待后端确认。",
    };
  const exampleTemplates: Record<string, string> = {
    "demo-example-q4-inspection": "sample-inspection",
    "demo-example-c2-logistics": "sample-mobile",
    "demo-example-go2-reference": "sample-go2",
  };
  const exampleTemplateId = exampleTemplates[project.id];
  if (exampleTemplateId)
    return {
      templates: TEMPLATE_CATALOG.filter(
        (template) => template.id === exampleTemplateId,
      ),
      rationale:
        "此典型场景样例已保存对应的详细来源模型和视图配置；匹配是明确的样例关联，不代表实际任务性能已验证。",
    };
  // This is a visible fixture catalog, not a semantic matcher or production recommendation.
  // Only the explicitly seeded quadruped sample has a declared fixture relationship.
  if (project.name === "园区巡检机器人")
    return {
      templates: TEMPLATE_CATALOG.filter((t) => t.assetKey === "quadruped"),
      rationale:
        "这个预置巡检样例关联 Q4 四足样例；仅供流程体验，载荷、地形与续航仍需核对。",
    };
  return {
    templates: [],
    rationale:
      "此需求没有已声明匹配的样例模板。可以直接进入 专业定制，也可以浏览资源库作参考。",
  };
}

export function modelSourceInfo(assetKey: AssetKey) {
  const template = TEMPLATE_CATALOG.find((t) => t.assetKey === assetKey);
  return {
    source: template?.sourceKind || ("authored-sample" as const),
    label: template?.source || "Embodex 原创结构示意",
    license: template?.license || "CC0-1.0",
    licenseUrl: template?.licenseUrl || "/v8-assets/LICENSE",
    provenanceUrl: template?.provenanceUrl || "/v8-assets/manifest.json",
    precisionNote: template?.precisionNote || "原创结构示意，不是制造模型",
  };
}
export function assetPreviewUrl(key: AssetKey) {
  return `/v8-assets/${key}${["go2-high-fidelity", "inspection-reference", "mobile-reference"].includes(key) ? ".png" : ".svg"}`;
}
