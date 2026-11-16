/* eslint-disable @typescript-eslint/no-explicit-any -- isolated, user-supplied JavaScript renderer boundary */
export type OfficialData = Record<string, any>;
export interface OfficialRuntimeOptions {
  projectIds: string[];
  visuals?: OfficialData;
  adaptSolutions?: (data: OfficialData) => void;
  adaptScenarios?: (
    projects: OfficialData,
    cards: OfficialData,
    engineering: OfficialData,
    integration: OfficialData,
  ) => void;
  adaptBusiness?: (data: OfficialData) => void;
  onBusinessRefresh?: (
    root: HTMLElement,
    current: OfficialData,
    state: OfficialData,
  ) => void;
  onExport?: (kind: string, snapshot: OfficialData, root: HTMLElement) => void;
}
export function installOfficialRuntime(
  document: Document,
  options: OfficialRuntimeOptions,
): {
  api: OfficialData;
  dispose(): void;
};
