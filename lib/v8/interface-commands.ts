import { normalizeModules, type ModuleId } from "./module-workspace";

export type InterfaceCommand =
  | { kind: "workspace" }
  | { kind: "all-projects" }
  | { kind: "modules"; modules: ModuleId[]; enter: boolean }
  | { kind: "project"; query: string }
  | { kind: "search"; query: string }
  | { kind: "create"; name: string }
  | {
      kind: "stage";
      stage:
        | "requirements"
        | "start"
        | "library"
        | "concepts"
        | "cad"
        | "delivery";
    }
  | { kind: "report" }
  | { kind: "history" };

/** Local actions are explicit and bounded; arbitrary language is never executed as code. */
export function planInterfaceCommand(input: string): InterfaceCommand | null {
  const text = input
    .trim()
    .replace(/[。！!？?]+$/, "")
    .replace(/^请/, "");
  if (/^(返回|打开|进入)(工作空间|工作区)$/.test(text))
    return { kind: "workspace" };
  if (/^(查看|显示|打开)?全部项目$/.test(text)) return { kind: "all-projects" };
  if (/^(查看|打开)?(设计方案|完整方案|方案概览)$/.test(text))
    return { kind: "report" };
  if (/^(查看|打开)?(设计历程|版本历史)$/.test(text))
    return { kind: "history" };
  const stage = text.match(
    /^(?:打开|进入|查看|切换到)?(明确需求|设计探索|模型概览|模板库|专业定制|工程模型|方案交付)$/,
  );
  if (stage)
    return {
      kind: "stage",
      stage: (
        {
          明确需求: "requirements",
          设计探索: "start",
          模型概览: "concepts",
          模板库: "library",
          专业定制: "concepts",
          工程模型: "cad",
          方案交付: "delivery",
        } as const
      )[stage[1] as "明确需求"],
    };
  const modules = text.match(/^(打开|进入|选择|筛选|组合|拼接)(.+)$/i);
  if (modules) {
    const tokens = modules[2]
      .split(/\s*(?:[+＋、,，]|和|与|及)\s*/)
      .map((s) => s.trim().toLowerCase());
    const names: Record<string, ModuleId> = {
      embodex: "embodex",
      设计: "embodex",
      simcore: "simcore",
      仿真: "simcore",
      deployx: "deployx",
      部署: "deployx",
    };
    if (tokens.length && tokens.every((t) => names[t]))
      return {
        kind: "modules",
        modules: normalizeModules(tokens.map((t) => names[t])),
        enter: /打开|进入/.test(modules[1]) && tokens.length === 1,
      };
  }
  const search = text.match(/^(?:搜索|筛选项目)[：:\s]*(.+)$/);
  if (search) return { kind: "search", query: search[1].trim() };
  const project = text.match(/^(?:打开项目|进入项目)[：:\s]*(.+)$/);
  if (project) return { kind: "project", query: project[1].trim() };
  const create = text.match(/^(?:新建项目|创建设计项目)[：:\s]*(.*)$/);
  if (create) return { kind: "create", name: create[1].trim() };
  return null;
}
