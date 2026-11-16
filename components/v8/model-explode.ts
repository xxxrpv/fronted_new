import { Matrix3, Vector3, type Object3D } from "three";

export type Point3 = readonly [number, number, number];
export interface PoseEntry {
  node: Object3D;
  base: Point3;
  direction: Point3;
  sensor: boolean;
  previewOffset: [number, number, number];
}
export interface AssemblyEntry {
  id: string;
  label: string;
  node: Object3D;
}
export interface ModelPose {
  entries: PoseEntry[];
  assemblies: AssemblyEntry[];
  meshCount: number;
}

const zero: Point3 = [0, 0, 0];
const finitePoint = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(
    (item) =>
      typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 5,
  );

/** Capture originals once. View transforms always derive from these immutable values. */
export function captureModelPose(root: Object3D): ModelPose {
  const entries: PoseEntry[] = [];
  const assemblies: AssemblyEntry[] = [];
  let meshCount = 0;
  root.traverse((node) => {
    if ("isMesh" in node && node.isMesh) meshCount++;
    const data = node.userData;
    const assembly =
      data.explodable === true &&
      typeof data.assemblyId === "string" &&
      typeof data.assemblyLabel === "string" &&
      finitePoint(data.explodeDirection);
    const sensor = data.part === "sensor";
    if (assembly)
      assemblies.push({ id: data.assemblyId, label: data.assemblyLabel, node });
    if (assembly || sensor)
      entries.push({
        node,
        base: [node.position.x, node.position.y, node.position.z],
        direction: assembly
          ? ([...data.explodeDirection] as [number, number, number])
          : zero,
        sensor,
        previewOffset: [0, 0, 0],
      });
  });
  return { entries, assemblies, meshCount };
}

const configuredPoses = new WeakSet<ModelPose>();
/** Keep the original source limit when editing a GLB that already contains a frozen offset. */
export function adoptConfiguredPoseBaseline(
  pose: ModelPose,
  metadata: unknown,
): boolean {
  if (metadata === undefined || configuredPoses.has(pose)) return false;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error("冻结模型的位置配置无效。");
  const data = metadata as Record<string, unknown>;
  const definitions: Record<string, { key: string; part: string }> = {
    "inspection-reference": {
      key: "inspectionCameraHeight",
      part: "inspection.camera-assembly",
    },
    "mobile-reference": { key: "mobileCameraHeight", part: "dock-camera" },
  };
  const snapshot = data.parameterSnapshot;
  if (
    data.schemaVersion !== 1 ||
    data.kind !== "configured-concept-glb" ||
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  )
    throw new Error("冻结模型的位置配置无效。");
  const definition =
    typeof data.sourceAssetKey === "string"
      ? definitions[data.sourceAssetKey]
      : undefined;
  const parameters = snapshot as Record<string, unknown>;
  if (!Object.keys(parameters).length) {
    configuredPoses.add(pose);
    return false;
  }
  if (
    !definition ||
    Object.keys(parameters).some((key) => key !== definition.key)
  )
    throw new Error("冻结模型包含未受支持的位置参数。");
  const height = parameters[definition.key];
  const assembly = pose.assemblies.find((part) => part.id === definition.part);
  const entry =
    assembly && pose.entries.find((item) => item.node === assembly.node);
  if (
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    Math.abs(height) > 0.05 ||
    !entry ||
    entry.node.userData.viewOffsetSupported !== true
  )
    throw new Error("冻结模型的位置参数与实际组件不一致。");
  entry.node.updateWorldMatrix(true, true);
  const delta = new Vector3(0, height, 0);
  if (entry.node.parent)
    delta.applyMatrix3(
      new Matrix3().setFromMatrix4(
        entry.node.parent.matrixWorld.clone().invert(),
      ),
    );
  const local = delta.toArray() as [number, number, number];
  const limit = entry.node.userData.viewOffsetMax;
  const axes = entry.node.userData.viewOffsetAxes;
  if (
    typeof limit !== "number" ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    limit > 0.05 ||
    !Array.isArray(axes) ||
    local.some(
      (value, axis) =>
        Math.abs(value) > limit + 1e-10 ||
        (Math.abs(value) > 1e-12 && !axes.includes(["x", "y", "z"][axis])),
    )
  )
    throw new Error("冻结模型的位置参数超过来源能力范围。");
  entry.base = entry.base.map((value, axis) => value - local[axis]) as [
    number,
    number,
    number,
  ];
  entry.previewOffset = local;
  configuredPoses.add(pose);
  return true;
}

/** The parent assembly displacement and local sensor offset compose without drift. */
export function applyModelPose(
  pose: ModelPose,
  separation: number,
  sensorOffset = 0,
): void {
  const level = Number.isFinite(separation)
    ? Math.min(1, Math.max(0, separation))
    : 0;
  const offset = Number.isFinite(sensorOffset)
    ? Math.min(0.18, Math.max(0, sensorOffset))
    : 0;
  for (const entry of pose.entries) {
    entry.node.position.set(
      entry.base[0] + entry.direction[0] * level + entry.previewOffset[0],
      entry.base[1] +
        entry.direction[1] * level +
        (entry.sensor ? offset : 0) +
        entry.previewOffset[1],
      entry.base[2] + entry.direction[2] * level + entry.previewOffset[2],
    );
  }
}

/** Only explicitly authored concept attachment capabilities allow temporary view offsets. */
export function setPartPreviewOffset(
  pose: ModelPose,
  partId: string,
  delta: Point3,
): {
  ok: boolean;
  message: string;
  partId?: string;
  before?: number[];
  after?: number[];
} {
  const assembly = pose.assemblies.find((entry) => entry.id === partId);
  const entry =
    assembly && pose.entries.find((item) => item.node === assembly.node);
  if (!entry || entry.node.userData.viewOffsetSupported !== true)
    return {
      ok: false,
      message:
        "此部件未开放位置调整。可以查看、聚焦或拆解，工程修改需要受支持的设计接口。",
    };
  const axes = entry.node.userData.viewOffsetAxes;
  const limit = entry.node.userData.viewOffsetMax;
  if (
    !Array.isArray(axes) ||
    typeof limit !== "number" ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    limit > 0.05 ||
    !Array.isArray(delta) ||
    delta.length !== 3 ||
    delta.some((value) => !Number.isFinite(value))
  )
    return { ok: false, message: "部件调整能力描述无效，未改变模型。" };
  const next = entry.previewOffset.map(
    (value, index) => value + delta[index],
  ) as [number, number, number];
  if (
    next.some(
      (value, index) =>
        Math.abs(value) > limit + 1e-10 ||
        (delta[index] !== 0 && !axes.includes(["x", "y", "z"][index])),
    )
  )
    return {
      ok: false,
      message: `超出该概念部件的视图调整范围（±${Math.round(limit * 1000)} mm），未改变模型。`,
    };
  const before = [...entry.previewOffset];
  entry.previewOffset = next;
  return {
    ok: true,
    message:
      "已调整概念附件的预览位置；这是可逆视图变化，未重建工程模型或修改源文件。",
    partId,
    before,
    after: [...next],
  };
}

/** Convert a user-facing world displacement into the existing source parent coordinate frame. */
export function setPartWorldPreviewOffset(
  pose: ModelPose,
  partId: string,
  delta: Point3,
  separation = 0,
  sensorOffset = 0,
): {
  ok: boolean;
  message: string;
  partId?: string;
  before?: number[];
  after?: number[];
  localOffset?: number[];
} {
  const part = pose.assemblies.find((item) => item.id === partId);
  if (
    !part ||
    !Array.isArray(delta) ||
    delta.length !== 3 ||
    delta.some((value) => !Number.isFinite(value))
  )
    return { ok: false, message: "部件或位移输入无效，未改变模型。" };
  part.node.updateWorldMatrix(true, true);
  const before = part.node.getWorldPosition(new Vector3()).toArray();
  const localDelta = new Vector3(...delta);
  if (part.node.parent)
    localDelta.applyMatrix3(
      new Matrix3().setFromMatrix4(
        part.node.parent.matrixWorld.clone().invert(),
      ),
    );
  const receipt = setPartPreviewOffset(pose, partId, localDelta.toArray());
  if (!receipt.ok) return receipt;
  applyModelPose(pose, separation, sensorOffset);
  part.node.updateWorldMatrix(true, true);
  return {
    ...receipt,
    before,
    after: part.node.getWorldPosition(new Vector3()).toArray(),
    localOffset: receipt.after,
  };
}

export function findAssembly(node: Object3D | null): Object3D | null {
  let cursor = node;
  while (cursor) {
    if (typeof cursor.userData.assemblyLabel === "string") return cursor;
    cursor = cursor.parent;
  }
  return null;
}

/** Fit all eight bounds corners inside a padded perspective frustum, at the current orbit angle. */
export function computePerspectiveFrame(
  bounds: { min: Point3; max: Point3 },
  viewDirection: Point3,
  verticalFov: number,
  aspect: number,
): { target: [number, number, number]; position: [number, number, number] } {
  const target = bounds.min.map(
    (value, index) => (value + bounds.max[index]) / 2,
  ) as [number, number, number];
  const source =
    Math.hypot(...viewDirection) > 0.0001 ? viewDirection : [1.35, 0.85, 1.65];
  const length = Math.hypot(...source);
  const direction = source.map((value) => value / length);
  const rightLength = Math.hypot(direction[0], direction[2]);
  const right =
    rightLength > 0.0001
      ? [direction[2] / rightLength, 0, -direction[0] / rightLength]
      : [1, 0, 0];
  const up = [
    direction[1] * right[2],
    direction[2] * right[0] - direction[0] * right[2],
    -direction[1] * right[0],
  ];
  const tanVertical = Math.tan(
    (Math.max(1, Math.min(170, verticalFov)) * Math.PI) / 360,
  );
  const tanHorizontal = tanVertical * Math.max(0.1, aspect);
  let distance = 0.1;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = [x - target[0], y - target[1], z - target[2]];
        const dot = (axis: number[]) =>
          point.reduce((sum, value, index) => sum + value * axis[index], 0);
        const depth = dot(direction);
        distance = Math.max(
          distance,
          depth + Math.abs(dot(right)) / (tanHorizontal * 0.82),
          depth + Math.abs(dot(up)) / (tanVertical * 0.68),
        );
      }
  distance *= 1.025;
  return {
    target,
    position: target.map(
      (value, index) => value + direction[index] * distance,
    ) as [number, number, number],
  };
}
