import type { Project } from "./types";
import { TEMPLATE_CATALOG } from "./catalog";

/** Present existing preview prose without rewriting frozen descriptions or files. */
export function readableDesignText(project: Project, text: string) {
  const names = new Map<string, string>([[project.id, project.name]]);
  for (const r of project.requirements)
    names.set(r.id, `V${String(r.sequence).padStart(2, "0")}`);
  for (const b of project.branches) {
    names.set(b.id, b.name);
    for (const r of b.revisions) {
      const version = `V${String(r.sequence).padStart(2, "0")}`;
      names.set(r.id, version);
      names.set(r.descriptionId, `${version} 设计描述`);
      text = text.replaceAll(
        `本次修订基于 ${version}（${r.id}）。`,
        `基于 ${version} 调整：`,
      );
    }
  }
  for (const a of project.approvals)
    names.set(a.id, `已确认 ${names.get(a.revisionId) || "方案"}`);
  for (const t of TEMPLATE_CATALOG) {
    names.set(t.id, t.name);
    text = text.replaceAll(`参考模板：${t.id}；`, `参考模型：${t.name}；`);
  }
  return text
    .split("\n")
    .filter((line) => {
      if (line.startsWith("本次需求版本：") && names.has(line.slice(7)))
        return false;
      return (
        line !==
        "本机预览创建新的设计描述；仅受支持参数可用于确定性配置导出，文字要求不会自动重建任意拓扑，未执行真实 AI/SolidWorks。"
      );
    })
    .map((line) => {
      const source = line.match(
        /^((?:- )?(?:项目|方向|版本|描述|确认|需求|需求版本|模板)：)(.+)$/,
      );
      if (source && names.has(source[2]))
        return `${source[1]}${names.get(source[2])}`;
      return line
        .replace(/^> Embodex V8 开发样例。/, "> Embodex 开发样例。")
        .replace(/^开发样例方向：/, "")
        .replace(/^示例设计 V\d+：/, "")
        .replace("保留来源网格与参数，不代表真实 CAD 执行或现场验收通过。", "")
        .replace(/^用户需求（作为来源保留，不代表样例已满足）：/, "设计需求：");
    })
    .join("\n");
}
