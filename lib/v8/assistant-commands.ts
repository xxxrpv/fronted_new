import type {
  ModelViewerController,
  ViewerCommandReceipt,
} from "../../components/v8/ModelViewer";

export type ViewerCommand =
  | { type: "mode"; mode: "whole" | "exploded" | "perception" }
  | { type: "separation"; level: number }
  | { type: "focus"; query: string }
  | { type: "view"; view: "front" | "side" | "top" | "iso" }
  | { type: "zoom"; factor: number }
  | { type: "reset" }
  | { type: "parts" }
  | { type: "offset"; query: string; y: number };
export type CommandPlan =
  | { kind: "command"; command: ViewerCommand }
  | { kind: "discussion"; message: string };

/** Explicit developer-preview tool grammar. It is not a remote Agent or a geometry generator. */
export function planViewerCommand(input: string): CommandPlan {
  const text = input.trim().replace(/[。！!？?]$/, "");
  const percent = text.match(
    /^(?:请)?(?:把|将)?(?:机器人|模型)?(?:拆解|展开)(?:到|至|程度(?:设置为|设为|为)?)?\s*(-?\d+(?:\.\d+)?)\s*%$/,
  );
  if (percent) {
    const value = Number(percent[1]);
    return value > 100 || value < 0
      ? {
          kind: "discussion",
          message: "拆解程度支持 0–100%。请指定这个范围内的值。",
        }
      : {
          kind: "command",
          command: { type: "separation", level: value / 100 },
        };
  }
  if (
    /^(?:请)?(?:把|将)?(?:机器人|模型)?(?:完全)?(?:拆解|展开)(?:机器人|模型)?$/.test(
      text,
    )
  )
    return { kind: "command", command: { type: "mode", mode: "exploded" } };
  if (
    /^(?:请)?(?:(?:还原|恢复|显示)?(?:整机|装配状态)|全部还原|显示全部|还原机器人)$/.test(
      text,
    )
  )
    return { kind: "command", command: { type: "mode", mode: "whole" } };
  if (/^(?:请)?(?:查看|显示|进入)?感知(?:结构|组件|模式)?$/.test(text))
    return { kind: "command", command: { type: "mode", mode: "perception" } };
  if (/^(?:重置|复位)(?:视角|镜头)$/.test(text))
    return { kind: "command", command: { type: "reset" } };
  if (
    /^(?:列出|查看|有哪些)(?:可用|真实)?(?:零件|组件|部件)(?:清单)?$/.test(text)
  )
    return { kind: "command", command: { type: "parts" } };
  const view = text.match(
    /^(?:切换到?|查看|显示)?(正视|前视|侧视|俯视|顶部|等轴|三维)(?:图|视角)?$/,
  );
  if (view)
    return {
      kind: "command",
      command: {
        type: "view",
        view: (
          {
            正视: "front",
            前视: "front",
            侧视: "side",
            俯视: "top",
            顶部: "top",
            等轴: "iso",
            三维: "iso",
          } as const
        )[view[1] as "正视"],
      },
    };
  if (/^(?:请)?放大(?:模型|机器人)?$/.test(text))
    return { kind: "command", command: { type: "zoom", factor: 0.8 } };
  if (/^(?:请)?缩小(?:模型|机器人)?$/.test(text))
    return { kind: "command", command: { type: "zoom", factor: 1.25 } };
  const focus = text.match(
    /^(?:请)?(?:聚焦|定位|查看部件|放大查看)[：:\s]*(.+)$/,
  );
  if (focus)
    return {
      kind: "command",
      command: { type: "focus", query: focus[1].trim() },
    };
  const offset = text.match(
    /^(?:请)?(?:把|将)?(.+?)(?:向上移动|向上调整|上移|抬高)(-?\d+(?:\.\d+)?)\s*(毫米|mm|厘米|cm|米|m)$/i,
  );
  if (offset) {
    const unit = offset[3].toLowerCase();
    const value =
      Number(offset[2]) *
      (unit === "厘米" || unit === "cm"
        ? 0.01
        : unit === "米" || unit === "m"
          ? 1
          : 0.001);
    return {
      kind: "command",
      command: { type: "offset", query: offset[1].trim(), y: value },
    };
  }
  return {
    kind: "discussion",
    message:
      "已记录你的想法。当前开发预览可执行整机、拆解程度、感知结构、部件聚焦与镜头操作；带明确能力的概念相机还可调整预览位置。任意拓扑修改需要真实设计 Agent，当前不会伪装成已经生成了新几何。",
  };
}

export function executeViewerCommand(
  controller: ModelViewerController,
  command: ViewerCommand,
): ViewerCommandReceipt {
  switch (command.type) {
    case "mode":
      return controller.setMode(command.mode);
    case "separation":
      return controller.setSeparation(command.level);
    case "focus": {
      const parts = controller.getParts();
      const exact = parts.filter(
        (p) =>
          p.id === command.query ||
          p.label === command.query ||
          p.sourceMesh === command.query,
      );
      const candidates = exact.length
        ? exact
        : parts.filter(
            (p) =>
              p.label.includes(command.query) || p.id.includes(command.query),
          );
      if (candidates.length > 1)
        return {
          ok: false,
          message: `找到多个实际部件，请指定：${candidates.map((p) => p.label).join("、")}。`,
        };
      return controller.focusPart(candidates[0]?.id || command.query);
    }
    case "view":
      return controller.setView(command.view);
    case "reset":
      return controller.resetView();
    case "zoom":
      return controller.zoom(command.factor);
    case "parts":
      return {
        ok: true,
        message:
          controller
            .getParts()
            .map((p) => p.label)
            .join("\n") || "当前模型没有提供可定位的真实部件。",
      };
    case "offset": {
      const parts = controller.getParts();
      const exact = parts.filter(
        (p) => p.id === command.query || p.label === command.query,
      );
      const candidates = exact.length
        ? exact
        : parts.filter(
            (p) =>
              p.label.includes(command.query) || p.id.includes(command.query),
          );
      if (candidates.length !== 1)
        return {
          ok: false,
          message: candidates.length
            ? `找到多个部件，请使用具体名称：${candidates.map((p) => p.label).join("、")}。`
            : "没有找到这个部件，请先“列出部件”或在模型中选择。",
        };
      const part = candidates[0];
      if (!part.offsetMax)
        return {
          ok: false,
          message: `${part.label}没有开放位置调整。可以聚焦和拆解查看，当前不会更改它的源几何。`,
          partId: part.id,
        };
      return controller.setPartOffset(part.id, [0, command.y, 0]);
    }
  }
}
