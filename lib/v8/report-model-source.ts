import type { Artifact } from "./types";

export function sameParameterSnapshot(
  first: Record<string, number> | undefined,
  second: Record<string, number> | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  const keys = Object.keys(first).sort();
  const other = Object.keys(second).sort();
  return (
    keys.length === other.length &&
    keys.every(
      (key, index) =>
        key === other[index] &&
        Number.isFinite(first[key]) &&
        first[key] === second[key],
    )
  );
}

/** A historical report may only borrow a model carrying the same frozen source facts. */
export function reportModelMatches(
  report: Pick<
    Artifact,
    | "projectId"
    | "requirementId"
    | "parameterSnapshot"
    | "templateId"
    | "approvalId"
    | "branchId"
    | "revisionId"
    | "descriptionId"
  >,
  candidate: Artifact,
): boolean {
  if (
    candidate.kind !== "model" ||
    report.projectId !== candidate.projectId ||
    report.requirementId !== candidate.requirementId ||
    !sameParameterSnapshot(
      report.parameterSnapshot,
      candidate.parameterSnapshot,
    )
  )
    return false;
  if (report.templateId) return report.templateId === candidate.templateId;
  return (
    Boolean(report.approvalId) &&
    report.approvalId === candidate.approvalId &&
    report.branchId === candidate.branchId &&
    report.revisionId === candidate.revisionId &&
    report.descriptionId === candidate.descriptionId
  );
}
