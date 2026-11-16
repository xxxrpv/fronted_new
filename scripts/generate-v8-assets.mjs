// Original, dependency-free fixture authoring. glTF 2.0 geometry, never native CAD.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output = fileURLToPath(new URL("../public/v8-assets/", import.meta.url));
await mkdir(output, { recursive: true });
const palette = {
  white: "#E9EFF3",
  blue: "#2377D7",
  dark: "#182D43",
  rubber: "#253646",
  cyan: "#14B8CF",
  steel: "#A7BBC9",
  orange: "#F1AA58",
};
const materials = Object.entries(palette).map(([name, value]) => ({
  name,
  pbrMetallicRoughness: {
    baseColorFactor: [
      ...value.match(/\w\w/g).map((v) => parseInt(v, 16) / 255),
      1,
    ],
    metallicFactor: name === "steel" ? 0.45 : 0.12,
    roughnessFactor: name === "rubber" ? 0.85 : 0.48,
  },
}));
const mat = (name) => Object.keys(palette).indexOf(name);
function box() {
  const p = [],
    n = [],
    ix = [];
  for (const [normal, corners] of [
    [
      [1, 0, 0],
      [
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [0.5, 0.5, 0.5],
        [0.5, -0.5, 0.5],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-0.5, -0.5, 0.5],
        [-0.5, 0.5, 0.5],
        [-0.5, 0.5, -0.5],
        [-0.5, -0.5, -0.5],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-0.5, 0.5, -0.5],
        [-0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5],
        [0.5, 0.5, -0.5],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-0.5, -0.5, 0.5],
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, -0.5, 0.5],
      ],
    ],
    [
      [0, 0, 1],
      [
        [-0.5, -0.5, 0.5],
        [0.5, -0.5, 0.5],
        [0.5, 0.5, 0.5],
        [-0.5, 0.5, 0.5],
      ],
    ],
    [
      [0, 0, -1],
      [
        [0.5, -0.5, -0.5],
        [-0.5, -0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [0.5, 0.5, -0.5],
      ],
    ],
  ]) {
    const start = p.length / 3;
    corners.forEach((c) => {
      p.push(...c);
      n.push(...normal);
    });
    ix.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { p, n, ix };
}
function cylinder(segments = 24) {
  const p = [],
    n = [],
    ix = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2,
      x = Math.cos(a) * 0.5,
      z = Math.sin(a) * 0.5;
    p.push(x, -0.5, z, x, 0.5, z);
    n.push(x * 2, 0, z * 2, x * 2, 0, z * 2);
    if (i < segments) {
      const j = i * 2;
      ix.push(j, j + 1, j + 3, j, j + 3, j + 2);
    }
  }
  for (const [y, ny] of [
    [-0.5, -1],
    [0.5, 1],
  ]) {
    const k = p.length / 3;
    p.push(0, y, 0);
    n.push(0, ny, 0);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      p.push(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5);
      n.push(0, ny, 0);
      if (i < segments) {
        if (ny > 0) {
          ix.push(k, k + i + 2, k + i + 1);
        } else {
          ix.push(k, k + i + 1, k + i + 2);
        }
      }
    }
  }
  return { p, n, ix };
}
const geometries = { box: box(), cylinder: cylinder() };
const rotate = (x, y, z) => {
  const cx = Math.cos(x / 2),
    sx = Math.sin(x / 2),
    cy = Math.cos(y / 2),
    sy = Math.sin(y / 2),
    cz = Math.cos(z / 2),
    sz = Math.sin(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
};
function make(id) {
  const objects = [];
  const part = (
    name,
    shape,
    color,
    size,
    pos,
    rotation = [0, 0, 0],
    key = name,
  ) =>
    objects.push({
      name,
      shape,
      color,
      size,
      pos,
      q: rotate(...rotation),
      key,
    });
  const b = (name, color, size, pos, rot, key) =>
    part(name, "box", color, size, pos, rot, key);
  const c = (name, color, size, pos, rot, key) =>
    part(name, "cylinder", color, size, pos, rot, key);
  if (id === "compact") {
    b("chassis", "dark", [1.3, 0.25, 1.8], [0, 0.48, 0]);
    b("body", "white", [1.28, 0.4, 1.55], [0, 0.78, -0.03]);
    b("blue-panel", "blue", [1.3, 0.12, 1.5], [0, 1, -0.03]);
    for (const x of [-0.73, 0.73])
      for (const z of [-0.57, 0.57]) {
        c(
          "wheel",
          "rubber",
          [0.5, 0.18, 0.5],
          [x, 0.35, z],
          [0, 0, Math.PI / 2],
        );
        c(
          "wheel-hub",
          "steel",
          [0.24, 0.19, 0.24],
          [x, 0.35, z],
          [0, 0, Math.PI / 2],
        );
      }
    for (const x of [-0.43, 0.43]) {
      b("headlight", "cyan", [0.2, 0.09, 0.035], [x, 0.78, 0.765]);
      b("side-rail", "steel", [0.055, 0.16, 1.25], [x, 1.12, 0]);
    }
    b("mast", "steel", [0.095, 0.65, 0.095], [0, 1.35, -0.28]);
    c(
      "sensor",
      "blue",
      [0.4, 0.13, 0.4],
      [0, 1.72, -0.28],
      undefined,
      "sensor",
    );
    c(
      "sensor-cap",
      "dark",
      [0.34, 0.07, 0.34],
      [0, 1.82, -0.28],
      undefined,
      "sensor",
    );
    b(
      "sensor-camera",
      "dark",
      [0.36, 0.21, 0.25],
      [0, 1.4, 0.33],
      undefined,
      "sensor",
    );
    b(
      "camera-eye",
      "cyan",
      [0.23, 0.07, 0.02],
      [0, 1.41, 0.465],
      undefined,
      "sensor",
    );
    b("bumper", "dark", [1.42, 0.11, 0.1], [0, 0.54, 0.95]);
  } else if (id === "quadruped") {
    b("body", "white", [0.88, 0.41, 1.48], [0, 1.06, 0]);
    b("backbone", "blue", [0.9, 0.11, 1.3], [0, 1.32, 0]);
    b("front-visor", "dark", [0.78, 0.23, 0.15], [0, 1.07, 0.79]);
    for (const x of [-0.24, 0.24])
      b("camera-eye", "cyan", [0.15, 0.07, 0.035], [x, 1.1, 0.88]);
    for (const s of [-1, 1])
      for (const z of [-0.52, 0.52]) {
        c(
          "hip-joint",
          "dark",
          [0.3, 0.23, 0.3],
          [s * 0.52, 1.01, z],
          [0, 0, Math.PI / 2],
        );
        b(
          "upper-leg",
          "blue",
          [0.17, 0.48, 0.2],
          [s * 0.61, 0.77, z + 0.08],
          [0.38, 0, s * -0.18],
        );
        c(
          "knee-joint",
          "dark",
          [0.24, 0.23, 0.24],
          [s * 0.66, 0.55, z + 0.16],
          [0, 0, Math.PI / 2],
        );
        b(
          "lower-leg",
          "steel",
          [0.105, 0.44, 0.13],
          [s * 0.66, 0.33, z + 0.04],
          [-0.5, 0, 0],
        );
        b("foot", "rubber", [0.25, 0.1, 0.3], [s * 0.68, 0.1, z - 0.04]);
      }
    c(
      "sensor",
      "dark",
      [0.25, 0.12, 0.25],
      [0, 1.45, -0.3],
      undefined,
      "sensor",
    );
    c(
      "sensor-cover",
      "cyan",
      [0.2, 0.035, 0.2],
      [0, 1.525, -0.3],
      undefined,
      "sensor",
    );
  } else if (id === "tripod") {
    c("central-core", "dark", [0.8, 0.65, 0.8], [0, 0.98, 0]);
    b("chest", "white", [0.75, 0.56, 0.55], [0, 1.2, 0.05]);
    b("visor", "dark", [0.65, 0.17, 0.14], [0, 1.3, 0.36]);
    b(
      "sensor",
      "cyan",
      [0.4, 0.055, 0.025],
      [0, 1.32, 0.44],
      undefined,
      "sensor",
    );
    c("lidar", "blue", [0.32, 0.15, 0.32], [0, 1.61, 0], undefined, "sensor");
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3,
        x = Math.sin(a),
        z = Math.cos(a);
      c("hip-joint", "blue", [0.27, 0.22, 0.27], [x * 0.42, 0.85, z * 0.42]);
      b(
        "upper-leg",
        "white",
        [0.18, 0.47, 0.23],
        [x * 0.59, 0.64, z * 0.59],
        [z * -0.4, 0, x * 0.4],
      );
      c("knee-joint", "dark", [0.23, 0.2, 0.23], [x * 0.69, 0.43, z * 0.69]);
      b(
        "lower-leg",
        "steel",
        [0.13, 0.36, 0.16],
        [x * 0.83, 0.26, z * 0.83],
        [z * -0.55, 0, x * 0.55],
      );
      b("foot", "rubber", [0.32, 0.1, 0.34], [x * 0.93, 0.07, z * 0.93]);
    }
  } else {
    b("belt", "dark", [1.25, 0.13, 3.2], [0, 0.93, 0]);
    for (const x of [-0.7, 0.7]) {
      b("side-frame", "white", [0.14, 0.23, 3.4], [x, 0.85, 0]);
      b(
        "safety-stripe",
        "blue",
        [0.025, 0.07, 3.1],
        [x + Math.sign(x) * 0.08, 0.92, 0],
      );
      for (const z of [-1.25, 1.25]) {
        b("leg", "steel", [0.12, 0.72, 0.12], [x, 0.42, z]);
        b("foot", "dark", [0.28, 0.07, 0.26], [x, 0.045, z]);
      }
    }
    for (let i = -5; i <= 5; i++)
      c(
        "roller",
        "steel",
        [0.14, 1.22, 0.14],
        [0, 0.99, i * 0.28],
        [0, 0, Math.PI / 2],
      );
    for (const x of [-0.76, 0.76])
      b("gantry", "white", [0.14, 1.15, 0.2], [x, 1.48, -0.4]);
    b("crossbeam", "white", [1.65, 0.15, 0.25], [0, 2.02, -0.4]);
    b("sensor", "dark", [0.4, 0.23, 0.3], [0, 1.82, -0.4], undefined, "sensor");
    b(
      "sensor-light",
      "cyan",
      [0.23, 0.035, 0.21],
      [0, 1.69, -0.4],
      undefined,
      "sensor",
    );
    b("parcel", "orange", [0.5, 0.36, 0.53], [0.2, 1.24, 0.64]);
    b("side-console", "blue", [0.38, 0.27, 0.15], [0.9, 1.2, -0.6]);
  }
  return objects;
}
function rotatePoint(p, q) {
  const [x, y, z] = p,
    [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
}
function thumbnail(objects, label) {
  const faces = [];
  for (const o of objects) {
    const g = geometries[o.shape];
    const vertices = [];
    for (let i = 0; i < g.p.length; i += 3)
      vertices.push(
        rotatePoint(
          g.p.slice(i, i + 3).map((v, k) => v * o.size[k]),
          o.q,
        ).map((v, k) => v + o.pos[k]),
      );
    for (let i = 0; i < g.ix.length; i += 3) {
      const v = g.ix.slice(i, i + 3).map((k) => vertices[k]);
      const depth = v.reduce((a, p) => a + p[0] + p[2] - p[1] * 0.2, 0) / 3;
      const points = v.map(([x, y, z]) => [
        x * 0.76 - z * 0.65,
        -y + (x + z) * 0.3,
      ]);
      const normal = rotatePoint(g.n.slice(g.ix[i] * 3, g.ix[i] * 3 + 3), o.q);
      const light = Math.max(
        0.55,
        Math.min(
          1.1,
          0.8 + normal[1] * 0.25 + normal[0] * 0.08 + normal[2] * 0.08,
        ),
      );
      const rgb = palette[o.color]
        .match(/\w\w/g)
        .map((v) => Math.round(Math.min(255, parseInt(v, 16) * light)));
      faces.push({ points, depth, color: `rgb(${rgb})` });
    }
  }
  const all = faces.flatMap((f) => f.points),
    xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1]),
    minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys),
    scale = Math.min(380 / (maxX - minX), 238 / (maxY - minY));
  const polygons = faces
    .sort((a, b) => a.depth - b.depth)
    .map(
      (f) =>
        `<polygon points="${f.points.map(([x, y]) => `${((x - (minX + maxX) / 2) * scale + 256).toFixed(1)},${((y - (minY + maxY) / 2) * scale + 164).toFixed(1)}`).join(" ")}" fill="${f.color}" stroke="${f.color}" stroke-width=".35"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 320" role="img" aria-label="${label} · 原创样例"><defs><radialGradient id="g"><stop stop-color="#fff"/><stop offset="1" stop-color="#edf4f9"/></radialGradient></defs><path fill="url(#g)" d="M0 0h512v320H0z"/><ellipse cx="256" cy="267" rx="145" ry="19" fill="#ccdae6" opacity=".4"/>${polygons}</svg>`;
}
// Assembly membership is authored with the fixtures, never inferred by the viewer.
function assemblyFor(id, object) {
  const { name, key, pos } = object;
  const side = pos[0] < 0 ? -1 : 1;
  const end = pos[2] < 0 ? -1 : 1;
  const corner = `${side < 0 ? "left" : "right"}-${end > 0 ? "front" : "rear"}`;
  const cornerLabel = `${side < 0 ? "左" : "右"}${end > 0 ? "前" : "后"}`;
  if (id === "compact") {
    if (name === "wheel" || name === "wheel-hub") return { id: `wheel-${corner}`, label: `${cornerLabel}轮组`, direction: [side * .7, .03, end * .25] };
    if (key === "sensor" || name === "mast") return { id: "sensor", label: "传感器与支架", direction: [0, .85, -.2] };
    if (["body", "blue-panel", "side-rail"].includes(name)) return { id: "cover", label: "上部机壳", direction: [0, .45, 0] };
    if (["headlight", "bumper"].includes(name)) return { id: "front", label: "前部防护与照明", direction: [0, .1, .6] };
    return { id: "chassis", label: "底盘主体", direction: [0, 0, 0] };
  }
  if (id === "quadruped") {
    if (["hip-joint", "upper-leg", "knee-joint", "lower-leg", "foot"].includes(name)) return { id: `leg-${corner}`, label: `${cornerLabel}腿总成`, direction: [side * .7, .03, end * .55] };
    if (key === "sensor") return { id: "sensor", label: "顶部感知组件", direction: [0, .85, -.15] };
    if (name === "backbone") return { id: "cover", label: "顶部防护盖", direction: [0, .4, 0] };
    return { id: "body", label: "机身与前视组件", direction: [0, 0, 0] };
  }
  if (id === "tripod") {
    if (["hip-joint", "upper-leg", "knee-joint", "lower-leg", "foot"].includes(name)) {
      const index = (Math.round(Math.atan2(pos[0], pos[2]) / (Math.PI * 2 / 3)) + 3) % 3;
      const angle = index * Math.PI * 2 / 3;
      return { id: `leg-${index + 1}`, label: `第 ${index + 1} 支撑腿总成`, direction: [Math.sin(angle) * .85, .02, Math.cos(angle) * .85] };
    }
    if (key === "sensor" || name === "visor") return { id: "sensor", label: "感知头部组件", direction: [0, .8, .2] };
    if (name === "chest") return { id: "shell", label: "上部机壳", direction: [0, .4, 0] };
    return { id: "core", label: "中央支承核心", direction: [0, 0, 0] };
  }
  if (key === "sensor") return { id: "sensor", label: "检测传感器组件", direction: [0, .9, .5] };
  if (["belt", "roller"].includes(name)) return { id: "belt", label: "输送面与辊筒", direction: [0, .65, 0] };
  if (["gantry", "crossbeam"].includes(name)) return { id: "gantry", label: "检测门架", direction: [0, .35, -.8] };
  if (["side-frame", "safety-stripe"].includes(name)) return { id: `rail-${side}`, label: `${side < 0 ? "左" : "右"}侧防护梁`, direction: [side * .6, .1, 0] };
  if (name === "parcel") return { id: "parcel", label: "样例物料", direction: [.75, .4, .65] };
  if (name === "side-console") return { id: "console", label: "操作面板", direction: [.7, .25, 0] };
  return { id: "frame", label: "支承框架", direction: [0, 0, 0] };
}

function glb(objects, label, id) {
  const chunks = [],
    views = [],
    accessors = [],
    meshes = [],
    nodes = [],
    cache = new Map();
  let length = 0;
  const append = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const idx = views.length;
    views.push({
      buffer: 0,
      byteOffset: length,
      byteLength: bytes.length,
      target,
    });
    chunks.push(bytes);
    length += bytes.length;
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      length += pad;
    }
    return idx;
  };
  for (const o of objects) {
    const cacheKey = o.shape + o.color;
    let mesh = cache.get(cacheKey);
    if (mesh === undefined) {
      const g = geometries[o.shape],
        pi = accessors.length;
      accessors.push({
        bufferView: append(new Float32Array(g.p), 34962),
        componentType: 5126,
        count: g.p.length / 3,
        type: "VEC3",
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      });
      const ni = accessors.length;
      accessors.push({
        bufferView: append(new Float32Array(g.n), 34962),
        componentType: 5126,
        count: g.n.length / 3,
        type: "VEC3",
      });
      const ii = accessors.length;
      accessors.push({
        bufferView: append(new Uint16Array(g.ix), 34963),
        componentType: 5123,
        count: g.ix.length,
        type: "SCALAR",
      });
      mesh = meshes.length;
      meshes.push({
        primitives: [
          {
            attributes: { POSITION: pi, NORMAL: ni },
            indices: ii,
            material: mat(o.color),
          },
        ],
      });
      cache.set(cacheKey, mesh);
    }
    nodes.push({
      name: o.name,
      mesh,
      translation: o.pos,
      rotation: o.q,
      scale: o.size,
      extras: { part: o.key, fixture: true },
    });
  }
  const assemblies = new Map();
  objects.forEach((object, index) => {
    const assembly = assemblyFor(id, object);
    if (!assemblies.has(assembly.id)) assemblies.set(assembly.id, { ...assembly, children: [] });
    assemblies.get(assembly.id).children.push(index);
  });
  const roots = [];
  for (const assembly of assemblies.values()) {
    roots.push(nodes.length);
    nodes.push({
      name: `assembly-${assembly.id}`,
      children: assembly.children,
      translation: [0, 0, 0],
      extras: { fixture: true, assemblyId: assembly.id, assemblyLabel: assembly.label, explodeDirection: assembly.direction, explodable: true },
    });
  }
  const json = {
    asset: {
      version: "2.0",
      generator: "Embodex V8 original fixtures",
      copyright: "CC0-1.0",
    },
    scene: 0,
    scenes: [{ name: label, nodes: roots }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length }],
    extras: {
      sample: true,
      engineeringValidation: "not-performed",
      nativeCad: false,
      explodedView: "authored-assembly-transforms",
    },
  };
  const j = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 32)]),
    bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + padded.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8),
    bh = Buffer.alloc(8);
  jh.writeUInt32LE(padded.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, padded, bh, bin]);
}
const labels = {
  compact: "轻型轮式巡检平台",
  quadruped: "四足巡检平台",
  tripod: "三足全向探索概念",
  conveyor: "模块化分拣输送线",
};
const manifest = {
  license: "CC0-1.0",
  source:
    "Original procedural fixtures authored for Embodex V8 development preview",
  sample: true,
  engineeringValidated: false,
  assets: [],
};
for (const [id, label] of Object.entries(labels)) {
  const objects = make(id),
    data = glb(objects, label, id),
    svg = thumbnail(objects, label);
  await writeFile(`${output}${id}.glb`, data);
  await writeFile(`${output}${id}.svg`, svg);
  manifest.assets.push({
    id,
    label,
    url: `/v8-assets/${id}.glb`,
    previewUrl: `/v8-assets/${id}.svg`,
    mimeType: "model/gltf-binary",
    size: data.length,
    parts: [...new Set(objects.map((o) => o.key))],
    meshCount: objects.length,
    assemblies: [...new Map(objects.map(object => { const assembly = assemblyFor(id, object); return [assembly.id, assembly]; })).values()],
  });
}
await writeFile(
  `${output}manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  `${output}LICENSE`,
  "SPDX-License-Identifier: CC0-1.0\n\nThese original procedural sample geometries and preview illustrations are dedicated to the public domain under CC0 1.0 Universal. They are design visualization fixtures, not generated CAD or validated engineering models.\nhttps://creativecommons.org/publicdomain/zero/1.0/\n",
);
await writeFile(
  `${output}README.md`,
  "# Embodex V8 原创预览资产\n\n这四个 GLB 是 scripts/generate-v8-assets.mjs 实际生成的 glTF 2.0 二进制模型。无外部网格、纹理或私有来源。SVG 由同一模型几何投影生成。CC0-1.0。\n\n每个 GLB 包含真实网格和明确命名的组件父节点；父节点 extras 记录 assemblyId、assemblyLabel、explodeDirection。拆解通过实际组件的局部变换实现，可精确还原；不是换图或伪造部件。\n\n仅用于开发预览的概念可视化，不是 Agent/SolidWorks 生成结果，不代表原生 CAD、物理仿真或工程验证。sensor 部件可临时调整视图位置，下载原始 GLB 不包含临时拆解与参数变换。\n",
);
console.log(JSON.stringify(manifest, null, 2));
