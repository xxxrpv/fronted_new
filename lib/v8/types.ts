/** V8 domain facts. These are adapter types, not claims about the platform contract. */
export type Mode = "preview" | "live";
export type DesignRoute = "library" | "custom";
export type Scenario =
  | "success"
  | "partial"
  | "failure"
  | "offline"
  | "response-lost"
  | "files-pending"
  | "single"
  | "empty";
export type TaskStatus =
  | "queued"
  | "running"
  | "partial"
  | "succeeded"
  | "failed"
  | "unknown";
export type AssetKey =
  | "compact"
  | "quadruped"
  | "tripod"
  | "conveyor"
  | "go2-high-fidelity"
  | "inspection-reference"
  | "mobile-reference";
export interface SourceRef {
  id: string;
  name: string;
  kind: "text" | "file";
  sizeBytes?: number;
  mimeType?: string;
  parseStatus: "ready" | "failed";
  text?: string;
  error?: string;
  /** Preview sources stay on this device; never imply a server upload. */
  location: "local-preview" | "server";
}
export interface RequirementRevision {
  id: string;
  sequence: number;
  projectId: string;
  text: string;
  purpose: string;
  constraints: string;
  sources: SourceRef[];
  missingFields: string[];
  status: "ready" | "needs_input";
  createdAt: string;
}
export interface ConceptRevision {
  id: string;
  branchId: string;
  sequence: number;
  descriptionId: string;
  description: string;
  assetKey: AssetKey;
  mediaType: "model" | "image";
  changeSummary: string;
  status: "ready";
  requirementId: string;
  /** Supported source-model parameters, frozen when this revision is created. */
  parameterSnapshot?: Record<string, number>;
  parentRevisionId?: string;
  referenceTemplateId?: string;
  referenceParameterSnapshot?: Record<string, number>;
  createdAt: string;
}
export interface ConceptBranch {
  id: string;
  projectId: string;
  name: string;
  differentiator: string;
  rationale: string;
  limitation: string;
  revisions: ConceptRevision[];
  latestRevisionId: string;
}
export interface Approval {
  id: string;
  projectId: string;
  branchId: string;
  revisionId: string;
  descriptionId: string;
  description: string;
  requirementId?: string;
  assetKey?: AssetKey;
  parameterSnapshot?: Record<string, number>;
  approvedAt: string;
}
export interface Task {
  id: string;
  projectId: string;
  type: "concepts" | "refine" | "cad";
  status: TaskStatus;
  currentStep: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  scenario: Scenario;
  requestedCount?: number;
  resultIds: string[];
  branchId?: string;
  sourceRevisionId?: string;
  prompt?: string;
  approvalId?: string;
  requirementId: string;
  parameterSnapshot?: Record<string, number>;
  sourceDescriptionId?: string;
  sourceDescription?: string;
  referenceTemplateId?: string;
  referenceParameterSnapshot?: Record<string, number>;
  error?: string;
  submissionState: "accepted" | "unknown";
}
export interface CADRun {
  id: string;
  projectId: string;
  taskId: string;
  sourceApprovalId: string;
  branchId: string;
  revisionId: string;
  sourceDescriptionId: string;
  sourceDescription?: string;
  requirementId?: string;
  parameterSnapshot?: Record<string, number>;
  assetKey: AssetKey;
  status: TaskStatus;
  artifactIds: string[];
  validationStatus: "not_run";
  createdAt: string;
}
/** Recipe for the development-only deterministic, configured source GLB. */
export interface ModelRecipe {
  assetKey: AssetKey;
  parameterSnapshot: Record<string, number>;
  provenance: Record<string, string>;
}
export interface Artifact {
  id: string;
  projectId: string;
  kind: "design_document" | "model";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status:
    | "uploading"
    | "validating"
    | "ready"
    | "failed"
    | "missing"
    | "expired";
  url?: string;
  content?: string;
  source:
    | "authored-sample"
    | "licensed-reference"
    | "supplied-concept-reference";
  license?: string;
  licenseUrl?: string;
  provenanceUrl?: string;
  branchId?: string;
  revisionId?: string;
  descriptionId?: string;
  approvalId?: string;
  cadRunId?: string;
  templateId?: string;
  requirementId?: string;
  parameterSnapshot?: Record<string, number>;
  assetKey?: AssetKey;
  modelRecipe?: ModelRecipe;
  sha256?: string;
  sourceSha256?: string;
  error?: string;
  createdAt: string;
  authorized: boolean;
}
export interface JourneyEvent {
  id: string;
  kind: string;
  message: string;
  refId?: string;
  createdAt: string;
}
export interface Project {
  id: string;
  name: string;
  ownerId: string;
  projectType: "EMBODIED_AI" | "AUTOMATION";
  route?: DesignRoute;
  status: string;
  updatedAt: string;
  createdAt: string;
  requirements: RequirementRevision[];
  branches: ConceptBranch[];
  approvals: Approval[];
  cadRuns: CADRun[];
  tasks: Task[];
  artifacts: Artifact[];
  journey: JourneyEvent[];
  templateId?: string;
  parameters: Record<string, number>;
  referenceTemplateId?: string;
  source: "preview" | "platform";
}
export interface ParameterDefinition {
  key: string;
  part: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  effect: "visual";
  description: string;
}
export interface Template {
  id: string;
  name: string;
  category: string;
  assetKey: AssetKey;
  description: string;
  source: string;
  license: string;
  sourceKind?:
    | "authored-sample"
    | "licensed-reference"
    | "supplied-concept-reference";
  retired?: boolean;
  licenseUrl?: string;
  provenanceUrl?: string;
  precisionNote?: string;
  capabilities: string[];
  parameters: ParameterDefinition[];
}
export interface RequirementInput {
  text: string;
  purpose?: string;
  constraints?: string;
  attachments?: SourceRef[];
}
export interface CreateInput extends RequirementInput {
  name?: string;
  projectType?: Project["projectType"];
}
export interface V8Repository {
  readonly mode: Mode;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project>;
  snapshot(): Project[];
  create(input: CreateInput, key?: string): Promise<Project>;
  saveRequirements(
    id: string,
    input: RequirementInput,
    key?: string,
  ): Promise<Project>;
  chooseRoute(id: string, route: DesignRoute): Promise<Project>;
  useTemplate(
    id: string,
    templateId: string,
    parameters: Record<string, number>,
    key?: string,
  ): Promise<Project>;
  generateConcepts(
    id: string,
    quantity?: number,
    key?: string,
  ): Promise<Project>;
  refine(
    id: string,
    branchId: string,
    revisionId: string,
    prompt: string,
    key?: string,
    parameterSnapshot?: Record<string, number>,
  ): Promise<Project>;
  approve(
    id: string,
    branchId: string,
    revisionId: string,
    key?: string,
  ): Promise<Project>;
  startCad(id: string, approvalId: string, key?: string): Promise<Project>;
  syncTask(id: string, taskId?: string): Promise<Project>;
  finalizeReport(id: string): Promise<Project>;
  upload(file: File): Promise<SourceRef>;
  setScenario(scenario: Scenario): void;
  getScenario(): Scenario;
  reset(): Promise<Project[]>;
  download(artifact: Artifact): Promise<{
    url?: string;
    content?: string;
    fileName: string;
    mimeType: string;
  }>;
}
