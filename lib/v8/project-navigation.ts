import type { Project } from "./types";
import { legalStage } from "./state";
import { groupDeliveryPackages } from "./delivery-packages";

/** A remembered view is a UI preference, never a change to the design route. */
export function projectResumePath(
  project: Project,
  remembered?: string,
): string {
  if (
    remembered &&
    !remembered.startsWith("/") &&
    !remembered.includes("://")
  ) {
    const [path, query = ""] = remembered.split("?");
    const [stage, branchId, extra] = path.split("/");
    const params = new URLSearchParams(query);
    const branch = project.branches.find((item) => item.id === branchId);
    const valid =
      !extra &&
      [
        "requirements",
        "start",
        "library",
        "concepts",
        "cad",
        "delivery",
      ].includes(stage) &&
      legalStage(project, stage) === stage &&
      (!branchId || (stage === "concepts" && Boolean(branch))) &&
      (!params.has("revision") ||
        Boolean(
          branch?.revisions.some((item) => item.id === params.get("revision")),
        )) &&
      (!params.has("run") ||
        (stage === "cad" &&
          project.cadRuns.some((item) => item.id === params.get("run")))) &&
      (!params.has("package") ||
        (stage === "delivery" &&
          groupDeliveryPackages(project).some(
            (item) => item.key === params.get("package"),
          )));
    if (valid) return stage === "delivery" ? "delivery" : remembered;
  }
  const running = project.tasks.find((item) =>
    ["queued", "running", "unknown"].includes(item.status),
  );
  if (running)
    return legalStage(project, running.type === "cad" ? "cad" : "concepts");
  const current = groupDeliveryPackages(project).find(
    (item) => item.isCurrent && item.modelReady && item.documentReady,
  );
  if (current) return "delivery";
  if (project.branches.length) return "concepts";
  return project.templateId
    ? "library"
    : project.route === "custom"
      ? "concepts"
      : "requirements";
}
