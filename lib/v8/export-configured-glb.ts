import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { validateGlbSecurity } from "../equipment/glb-security";
import type { AssetKey } from "./types";

/** Frozen domain identifiers embedded in the actual exported GLB. */
export interface ConfiguredGlbProvenance {
  projectId?: string;
  requirementId?: string;
  templateId?: string;
  branchId?: string;
  revisionId?: string;
  descriptionId?: string;
  approvalId?: string;
  cadRunId?: string;
}

export interface ConfiguredGlbOptions {
  assetKey: AssetKey;
  /** Absolute, source-relative values in metres; never the current exploded pose. */
  parameterSnapshot: Record<string, number>;
  provenance?: ConfiguredGlbProvenance;
  expectedSourceSha256?: string;
}

export interface ConfiguredGlbExport {
  buffer: ArrayBuffer;
  byteLength: number;
  sourceSha256: string;
  sha256: string;
  changedParts: string[];
  parameterSnapshot: Record<string, number>;
}

type JsonObject = Record<string, unknown>;
interface GlbNode extends JsonObject {
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: JsonObject;
}
interface SourceGlb extends JsonObject {
  asset: JsonObject;
  nodes: GlbNode[];
  scenes: Array<{ nodes?: number[] }>;
  scene?: number;
}

const jsonChunk = 0x4e4f534a;
const maximumBytes = 32 * 1024 * 1024;
const supported: Partial<Record<AssetKey, { key: string; part: string }>> = {
  "inspection-reference": {
    key: "inspectionCameraHeight",
    part: "inspection.camera-assembly",
  },
  "mobile-reference": { key: "mobileCameraHeight", part: "dock-camera" },
};
const record = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);

function point(value: unknown, length: number, fallback: number[]): number[] {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  )
    throw new Error("来源模型的组件变换无效。");
  return value;
}

function localMatrix(node: GlbNode): Matrix4 {
  if (node.matrix !== undefined)
    return new Matrix4().fromArray(point(node.matrix, 16, []));
  return new Matrix4().compose(
    new Vector3().fromArray(point(node.translation, 3, [0, 0, 0])),
    new Quaternion().fromArray(point(node.rotation, 4, [0, 0, 0, 1])),
    new Vector3().fromArray(point(node.scale, 3, [1, 1, 1])),
  );
}

function graph(source: SourceGlb) {
  const parents = new Map<number, number>();
  const worlds = new Map<number, Matrix4>();
  const index = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < source.nodes.length;
  source.nodes.forEach((node, parent) => {
    if (!record(node)) throw new Error("来源模型的组件记录无效。");
    if (node.children !== undefined && !Array.isArray(node.children))
      throw new Error("来源模型的组件层级无效。");
    for (const child of node.children || []) {
      if (!index(child) || parents.has(child) || child === parent)
        throw new Error("来源模型的组件父子关系无效。");
      parents.set(child, parent);
    }
  });
  const active = new Set<number>();
  const visit = (id: number, world: Matrix4, stack: Set<number>) => {
    if (!index(id) || stack.has(id) || active.has(id))
      throw new Error("来源模型包含无效或循环的装配层级。");
    const next = new Set(stack).add(id);
    const matrix = world.clone().multiply(localMatrix(source.nodes[id]));
    if (
      !Number.isFinite(matrix.determinant()) ||
      Math.abs(matrix.determinant()) < 1e-12
    )
      throw new Error("来源模型含不可逆的组件变换。");
    active.add(id);
    worlds.set(id, matrix);
    for (const child of source.nodes[id].children || [])
      visit(child, matrix, next);
  };
  const scene = source.scenes[source.scene ?? 0];
  if (!scene || !Array.isArray(scene.nodes))
    throw new Error("来源模型缺少有效的默认场景。");
  for (const root of scene.nodes) visit(root, new Matrix4(), new Set());
  return { parents, worlds, active };
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("当前浏览器无法校验导出文件，请使用本机安全预览地址。");
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (entry) =>
    entry.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Export an assembled concept GLB from immutable source bytes and a frozen recipe.
 * Mesh buffers, materials, source hierarchy and license text remain unchanged.
 * This applies supported attachment transforms; it does not generate native CAD.
 */
export async function exportConfiguredGlb(
  source: ArrayBuffer,
  options: ConfiguredGlbOptions,
): Promise<ConfiguredGlbExport> {
  if (!(source instanceof ArrayBuffer) || source.byteLength > maximumBytes)
    throw new Error("来源 GLB 无效或超过 32 MB 限制。");
  // Freeze caller-owned data before the first asynchronous hash operation.
  source = source.slice(0);
  validateGlbSecurity(source);
  const view = new DataView(source);
  if (view.getUint32(0, true) !== 0x46546c67)
    throw new Error("配置导出只接受独立二进制 GLB 来源。");
  if (!options || !record(options.parameterSnapshot))
    throw new Error("缺少冻结参数快照。");
  if (options.provenance !== undefined && !record(options.provenance))
    throw new Error("导出版本来源记录无效。");
  options = {
    ...options,
    parameterSnapshot: { ...options.parameterSnapshot },
    provenance:
      options.provenance === undefined ? undefined : { ...options.provenance },
  };
  const sourceSha256 = await sha256(source);
  if (
    options.expectedSourceSha256 !== undefined &&
    options.expectedSourceSha256 !== sourceSha256
  )
    throw new Error("来源文件校验值与冻结记录不一致，已停止导出。");
  const jsonLength = view.getUint32(12, true);
  const document: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(source, 20, jsonLength),
    ),
  );
  if (
    !record(document) ||
    !record(document.asset) ||
    !Array.isArray(document.nodes) ||
    !Array.isArray(document.scenes)
  )
    throw new Error("来源 GLB 缺少有效装配层级。");
  const model = document as SourceGlb;
  const originalExtras = record(model.asset.extras) ? model.asset.extras : {};
  if (originalExtras.embodexConfiguredExport !== undefined)
    throw new Error("请使用原始来源 GLB 导出，不能在已导出版本上叠加参数。");
  const definition = supported[options.assetKey];
  const parameterSnapshot: Record<string, number> = {};
  for (const key of Object.keys(options.parameterSnapshot).sort()) {
    const value = options.parameterSnapshot[key];
    if (
      !definition ||
      key !== definition.key ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 0.05
    )
      throw new Error("参数未获支持或超出组件位置范围（±50 mm）。");
    parameterSnapshot[key] = Object.is(value, -0) ? 0 : value;
  }
  const { parents, worlds, active } = graph(model);
  const changedParts: string[] = [];
  if (definition && Object.hasOwn(parameterSnapshot, definition.key)) {
    const matches = model.nodes
      .map((node, id) => ({ node, id }))
      .filter(
        ({ node, id }) =>
          active.has(id) && node.extras?.assemblyId === definition.part,
      );
    if (matches.length !== 1)
      throw new Error("来源模型缺少唯一、可调整的实际组件。");
    const { node, id } = matches[0];
    const data = node.extras!;
    if (
      data.viewOffsetSupported !== true ||
      typeof data.viewOffsetMax !== "number" ||
      !Number.isFinite(data.viewOffsetMax) ||
      data.viewOffsetMax <= 0 ||
      data.viewOffsetMax > 0.05 ||
      !Array.isArray(data.viewOffsetAxes)
    )
      throw new Error("来源组件未开放这项位置调整能力。");
    const parent = parents.get(id);
    const parentWorld =
      parent === undefined ? new Matrix4() : worlds.get(parent)!;
    const displacement = new Vector3(
      0,
      parameterSnapshot[definition.key],
      0,
    ).applyMatrix3(new Matrix3().setFromMatrix4(parentWorld.clone().invert()));
    const delta = displacement.toArray();
    if (
      delta.some(
        (value, axis) =>
          Math.abs(value) > (data.viewOffsetMax as number) + 1e-10 ||
          (Math.abs(value) > 1e-12 &&
            !(data.viewOffsetAxes as unknown[]).includes(
              ["x", "y", "z"][axis],
            )),
      )
    )
      throw new Error("偏移超过来源组件声明的能力范围。");
    if (node.matrix !== undefined) {
      const matrix = [...node.matrix];
      delta.forEach((value, axis) => {
        matrix[12 + axis] += value;
      });
      node.matrix = matrix;
    } else {
      const base = point(node.translation, 3, [0, 0, 0]);
      node.translation = base.map((value, axis) => value + delta[axis]);
    }
    if (delta.some((value) => Math.abs(value) > 1e-12))
      changedParts.push(definition.part);
  }
  const provenance: ConfiguredGlbProvenance = {};
  if (options.provenance !== undefined) {
    if (!record(options.provenance)) throw new Error("导出版本来源记录无效。");
    const allowed = [
      "projectId",
      "requirementId",
      "templateId",
      "branchId",
      "revisionId",
      "descriptionId",
      "approvalId",
      "cadRunId",
    ];
    for (const key of Object.keys(options.provenance).sort()) {
      const value = options.provenance[key as keyof ConfiguredGlbProvenance];
      if (
        !allowed.includes(key) ||
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 200
      )
        throw new Error("导出版本来源记录无效。");
      provenance[key as keyof ConfiguredGlbProvenance] = value;
    }
  }
  model.asset.extras = {
    ...originalExtras,
    embodexConfiguredExport: {
      schemaVersion: 1,
      kind: "configured-concept-glb",
      nativeCad: false,
      engineeringVerified: false,
      coordinateFrame: "source world Y-up, metres",
      sourceAssetKey: options.assetKey,
      sourceSha256,
      parameterSnapshot,
      changedParts,
      provenance,
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(model));
  const paddedLength = Math.ceil(bytes.byteLength / 4) * 4;
  const remainderOffset = 20 + jsonLength;
  const byteLength = 20 + paddedLength + source.byteLength - remainderOffset;
  if (byteLength > maximumBytes) throw new Error("导出文件超过 32 MB 限制。");
  const buffer = new ArrayBuffer(byteLength);
  const output = new Uint8Array(buffer);
  output.set(new Uint8Array(source, 0, 12));
  const header = new DataView(buffer);
  header.setUint32(8, byteLength, true);
  header.setUint32(12, paddedLength, true);
  header.setUint32(16, jsonChunk, true);
  output.fill(0x20, 20, 20 + paddedLength);
  output.set(bytes, 20);
  output.set(new Uint8Array(source, remainderOffset), 20 + paddedLength);
  validateGlbSecurity(buffer);
  return {
    buffer,
    byteLength,
    sourceSha256,
    sha256: await sha256(buffer),
    changedParts,
    parameterSnapshot,
  };
}
