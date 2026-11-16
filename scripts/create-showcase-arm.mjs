/** Original articulated visual concept. Metres, Y-up. Not manufacturer CAD. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { encodeThreeGlb } from "./encode-three-glb.mjs";

export function createShowcaseArm() {
  const root = new THREE.Group();
  root.name = "industrial_arm_concept";
  root.userData = {
    sourceKind: "original-procedural-visual-concept",
    engineeringValidated: false,
    nativeCad: false,
    unit: "metre",
    upAxis: "Y",
    animationProtocol: "named-local-joints-v1",
  };
  const mat = (name, color, metalness, roughness) => {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    m.name = name;
    return m;
  };
  const ivory = mat("warm_powder_coated_aluminium", "#e8e7df", 0.25, 0.3);
  const steel = mat("brushed_stainless_steel", "#a6afb1", 0.88, 0.24);
  const graphite = mat("graphite_anodized_aluminium", "#343a3b", 0.65, 0.34);
  const rubber = mat("soft_cable_and_joint_seal", "#1d2425", 0.06, 0.71);
  const darksteel = mat("blackened_socket_screws", "#41494b", 0.88, 0.27);
  const amber = mat("muted_status_lens", "#8aaf91", 0.15, 0.28);
  const geometry = new Map();
  const cache = (key, factory) => {
    if (!geometry.has(key)) geometry.set(key, factory());
    return geometry.get(key);
  };
  const group = (parent, name, position = [0, 0, 0]) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.fromArray(position);
    parent.add(g);
    return g;
  };
  const mesh = (
    parent,
    name,
    shape,
    material,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
  ) => {
    const m = new THREE.Mesh(shape, material);
    m.name = name;
    m.position.fromArray(position);
    m.rotation.fromArray(rotation);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const cylinder = (p, n, r, h, m, xyz = [0, 0, 0], rot = [0, 0, 0]) =>
    mesh(
      p,
      n,
      cache(`c${r}/${h}`, () => new THREE.CylinderGeometry(r, r, h, 48, 1)),
      m,
      xyz,
      rot,
    );
  const roundbox = (p, n, w, h, d, r, m, xyz = [0, 0, 0]) =>
    mesh(
      p,
      n,
      cache(
        `b${w}/${h}/${d}/${r}`,
        () => new RoundedBoxGeometry(w, h, d, 3, r),
      ),
      m,
      xyz,
    );
  const torus = (p, n, r, t, m, xyz = [0, 0, 0], rot = [0, 0, 0]) =>
    mesh(
      p,
      n,
      cache(`t${r}/${t}`, () => new THREE.TorusGeometry(r, t, 8, 48)),
      m,
      xyz,
      rot,
    );
  const bolt = (p, xyz, rot = [0, 0, 0], scale = 1) => {
    const g = group(p, "socket_fastener", xyz);
    g.rotation.fromArray(rot);
    g.scale.setScalar(scale);
    cylinder(g, "washer", 0.008, 0.0018, steel, [0, 0.001, 0]);
    cylinder(g, "socket_head", 0.0058, 0.006, darksteel, [0, 0.004, 0]);
    const recess = mesh(
      g,
      "hexagonal_recess",
      cache("hex", () => new THREE.CylinderGeometry(0.003, 0.003, 0.0006, 6)),
      rubber,
      [0, 0.0073, 0],
    );
    recess.rotation.y = Math.PI / 6;
    return g;
  };
  const lathe = (p, n, points, m, xyz = [0, 0, 0], scale = [1, 1, 1]) => {
    const profile = new THREE.SplineCurve(
      points.map((v) => new THREE.Vector2(...v)),
    ).getPoints(points.length * 4);
    const g = new THREE.LatheGeometry(profile, 48);
    g.name = n;
    const result = mesh(p, n, g, m, xyz);
    result.scale.fromArray(scale);
    return result;
  };
  const screwCircle = (p, r, y, count = 8, scale = 1) => {
    for (let i = 0; i < count; i++) {
      const a = (i * Math.PI * 2) / count;
      bolt(p, [Math.cos(a) * r, y, Math.sin(a) * r], [0, 0, 0], scale);
    }
  };
  const joint = (p, name, xyz, axis, home, range) => {
    const g = group(p, name, xyz);
    g.rotation[axis] = home;
    g.userData = {
      jointAxis: axis,
      homeAngle: home,
      lowerLimit: range[0],
      upperLimit: range[1],
      visualOnly: true,
    };
    return g;
  };
  const servo = (p, name, radius, width, axis = "z") => {
    const g = group(p, `${name}_servo`);
    // Geometry is authored along local Y, then aligned with the rotation axis.
    if (axis === "z") g.rotation.x = Math.PI / 2;
    lathe(
      g,
      `${name}_cast_housing`,
      [
        [0, -width * 0.5],
        [radius * 0.72, -width * 0.5],
        [radius * 0.95, -width * 0.42],
        [radius, -width * 0.3],
        [radius, width * 0.28],
        [radius * 0.95, width * 0.42],
        [radius * 0.77, width * 0.5],
        [0, width * 0.5],
      ],
      ivory,
    );
    for (const s of [-1, 1]) {
      cylinder(g, `${name}_bearing_band_${s}`, radius * 0.94, 0.013, graphite, [
        0,
        s * width * 0.4,
        0,
      ]);
      cylinder(g, `${name}_machined_flange_${s}`, radius * 0.83, 0.017, steel, [
        0,
        s * (width * 0.5 + 0.001),
        0,
      ]);
      cylinder(g, `${name}_removable_cap_${s}`, radius * 0.77, 0.012, ivory, [
        0,
        s * (width * 0.5 + 0.011),
        0,
      ]);
      torus(
        g,
        `${name}_seal_${s}`,
        radius * 0.78,
        0.0026,
        rubber,
        [0, s * (width * 0.5 + 0.014), 0],
        [Math.PI / 2, 0, 0],
      );
      const end = group(g, `${name}_cap_screws_${s}`, [
        0,
        s * (width * 0.5 + 0.018),
        0,
      ]);
      if (s < 0) end.rotation.x = Math.PI;
      screwCircle(end, radius * 0.64, 0, 6, (radius / 0.14) * 0.78);
      cylinder(
        end,
        "central_encoder_cap",
        radius * 0.33,
        0.002,
        graphite,
        [0, 0.002, 0],
      );
    }
    return g;
  };
  const cable = (p, name, points, r = 0.012, corrugated = true) => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((v) => new THREE.Vector3(...v)),
    );
    mesh(p, name, new THREE.TubeGeometry(curve, 40, r, 8, false), rubber);
    if (corrugated) {
      const count = Math.max(8, Math.floor(curve.getLength() / 0.018));
      for (let i = 0; i <= count; i++) {
        const t = i / count,
          ring = torus(
            p,
            `${name}_rib_${i}`,
            r,
            0.0018,
            graphite,
            curve.getPoint(t).toArray(),
          );
        ring.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          curve.getTangent(t).normalize(),
        );
      }
    }
  };
  const armLink = (p, name, length, r1, r2) => {
    const body = group(p, name);
    lathe(
      body,
      `${name}_oval_shell`,
      [
        [0, 0.03],
        [r1 * 0.72, 0.04],
        [r1, 0.09],
        [r1 * 0.9, 0.16],
        [r1 * 0.73, length * 0.43],
        [r2 * 0.84, length * 0.73],
        [r2, length - 0.07],
        [r2 * 0.76, length - 0.025],
        [0, length - 0.02],
      ],
      ivory,
      [0, 0, 0],
      [1, 1, 0.76],
    );
    // Recessed service strip, shallow panel seam and retained attachment screws.
    roundbox(
      body,
      `${name}_service_cover`,
      r1 * 0.55,
      length * 0.48,
      0.012,
      0.009,
      graphite,
      [0, length * 0.49, -r1 * 0.72],
    );
    for (const y of [length * 0.27, length * 0.72])
      for (const x of [-r1 * 0.18, r1 * 0.18])
        bolt(body, [x, y, -r1 * 0.79], [-Math.PI / 2, 0, 0], 0.55);
    const z = -Math.max(r1, r2) * 0.92;
    cable(
      body,
      `${name}_harness`,
      [
        [r1 * 0.4, 0.055, z],
        [r1 * 0.8, 0.16, z - 0.045],
        [r1 * 0.78, length * 0.6, z - 0.025],
        [r2 * 0.5, length - 0.025, z],
      ],
      0.009,
    );
    for (const y of [length * 0.23, length * 0.58])
      roundbox(
        body,
        `${name}_cable_retainer`,
        0.043,
        0.022,
        0.035,
        0.004,
        steel,
        [r1 * 0.72, y, z - 0.022],
      );
    return body;
  };

  roundbox(
    root,
    "foundation_plate",
    0.43,
    0.035,
    0.38,
    0.028,
    steel,
    [0, 0.0175, 0],
  );
  roundbox(
    root,
    "foundation_gasket",
    0.4,
    0.006,
    0.35,
    0.024,
    rubber,
    [0, 0.038, 0],
  );
  for (const x of [-0.175, 0.175])
    for (const z of [-0.15, 0.15]) bolt(root, [x, 0.036, z], [0, 0, 0], 1.5);
  lathe(
    root,
    "fixed_pedestal",
    [
      [0, 0.04],
      [0.145, 0.04],
      [0.151, 0.053],
      [0.15, 0.07],
      [0.135, 0.115],
      [0.124, 0.162],
      [0.124, 0.174],
      [0, 0.174],
    ],
    ivory,
  );
  torus(
    root,
    "base_seal",
    0.126,
    0.003,
    rubber,
    [0, 0.163, 0],
    [Math.PI / 2, 0, 0],
  );
  const j1 = joint(root, "arm_j1_yaw", [0, 0.174, 0], "y", 0, [
    -Math.PI,
    Math.PI,
  ]);
  cylinder(j1, "j1_bearing_ring", 0.126, 0.028, steel, [0, 0.012, 0]);
  lathe(
    j1,
    "j1_turret",
    [
      [0, 0.025],
      [0.125, 0.025],
      [0.13, 0.045],
      [0.13, 0.105],
      [0.11, 0.168],
      [0.085, 0.2],
      [0, 0.205],
    ],
    ivory,
  );
  cylinder(j1, "j1_rotation_seal", 0.13, 0.007, graphite, [0, 0.036, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3,
      vent = roundbox(j1, "j1_heat_vent", 0.028, 0.005, 0.006, 0.002, rubber, [
        Math.sin(a) * 0.127,
        0.09,
        Math.cos(a) * 0.127,
      ]);
    vent.rotation.y = a;
  }
  const port = group(j1, "j1_connector", [0, 0.085, -0.129]);
  port.rotation.x = -Math.PI / 2;
  cylinder(port, "power_socket", 0.019, 0.018, graphite);
  torus(
    port,
    "socket_metal_collar",
    0.016,
    0.002,
    steel,
    [0, 0.01, 0],
    [Math.PI / 2, 0, 0],
  );
  roundbox(
    j1,
    "status_window",
    0.035,
    0.006,
    0.006,
    0.003,
    amber,
    [0, 0.12, 0.13],
  );
  const j2 = joint(
    j1,
    "arm_j2_shoulder",
    [0, 0.205, 0],
    "z",
    -0.45,
    [-1.5, 1.5],
  );
  servo(j2, "j2", 0.133, 0.22);
  armLink(j2, "upper_arm", 0.68, 0.108, 0.096);
  const j3 = joint(j2, "arm_j3_elbow", [0, 0.68, 0], "z", -1.55, [-2.45, 0.4]);
  servo(j3, "j3", 0.109, 0.192);
  armLink(j3, "forearm", 0.56, 0.086, 0.065);
  const j4 = joint(j3, "arm_j4_roll", [0, 0.56, 0], "y", 0, [
    -Math.PI,
    Math.PI,
  ]);
  servo(j4, "j4", 0.066, 0.12, "y");
  cylinder(j4, "wrist_neck", 0.058, 0.09, ivory, [0, 0.071, 0]);
  torus(
    j4,
    "wrist_neck_seal",
    0.057,
    0.0026,
    rubber,
    [0, 0.09, 0],
    [Math.PI / 2, 0, 0],
  );
  const j5 = joint(
    j4,
    "arm_j5_wrist",
    [0, 0.132, 0],
    "z",
    -1.1415926535897931,
    [-1.8, 1.8],
  );
  servo(j5, "j5", 0.065, 0.112);
  lathe(
    j5,
    "wrist_output_neck",
    [
      [0, 0.025],
      [0.052, 0.025],
      [0.056, 0.045],
      [0.05, 0.08],
      [0.041, 0.11],
      [0, 0.11],
    ],
    ivory,
  );
  const j6 = joint(j5, "arm_j6_tool", [0, 0.108, 0], "y", 0, [
    -Math.PI,
    Math.PI,
  ]);
  cylinder(j6, "tool_flange", 0.051, 0.015, steel, [0, 0.006, 0]);
  cylinder(j6, "flange_isolator", 0.047, 0.008, graphite, [0, 0.018, 0]);
  screwCircle(j6, 0.039, 0.014, 6, 0.5);
  roundbox(
    j6,
    "parallel_gripper_housing",
    0.13,
    0.075,
    0.072,
    0.014,
    graphite,
    [0, 0.061, 0],
  );
  roundbox(
    j6,
    "gripper_service_lid",
    0.115,
    0.054,
    0.005,
    0.01,
    steel,
    [0, 0.06, 0.037],
  );
  for (const x of [-0.046, 0.046])
    for (const y of [0.043, 0.079])
      bolt(j6, [x, y, 0.042], [Math.PI / 2, 0, 0], 0.42);
  for (const z of [-0.019, 0.019])
    cylinder(
      j6,
      "hardened_gripper_slide",
      0.004,
      0.108,
      steel,
      [0, 0.102, z],
      [0, 0, Math.PI / 2],
    );
  for (const [name, sign] of [
    ["arm_finger_left", -1],
    ["arm_finger_right", 1],
  ]) {
    const finger = group(j6, name, [sign * 0.041, 0.1, 0]);
    finger.userData = {
      slideAxis: "x",
      homePosition: sign * 0.041,
      minAbsPosition: 0.018,
      maxAbsPosition: 0.047,
      visualOnly: true,
    };
    roundbox(
      finger,
      "jaw_carriage",
      0.033,
      0.026,
      0.056,
      0.004,
      steel,
      [0, 0.014, 0],
    );
    roundbox(finger, "jaw_finger", 0.019, 0.095, 0.045, 0.005, graphite, [
      sign * 0.006,
      0.067,
      0,
    ]);
    roundbox(
      finger,
      "replaceable_grip_pad",
      0.006,
      0.045,
      0.037,
      0.002,
      rubber,
      [-sign * 0.006, 0.092, 0],
    );
    for (const y of [0.055, 0.096])
      bolt(finger, [sign * 0.016, y, 0], [0, 0, (-sign * Math.PI) / 2], 0.45);
  }
  const tcp = group(j6, "arm_tool_center_point", [0, 0.205, 0]);
  tcp.userData = { purpose: "visual tool attachment marker" };
  root.updateMatrixWorld(true);
  return root;
}

const output = fileURLToPath(
  new URL("../public/v8-assets/cinematic/", import.meta.url),
);
await mkdir(output, { recursive: true });
const root = createShowcaseArm();
const result = encodeThreeGlb(root, {
  copyright: "Original Embodex visual demonstration asset",
  source: {
    kind: "procedural-visual-concept",
    engineeringValidated: false,
    nativeCad: false,
    units: "metres",
    animationProtocol: "named-local-joints-v1",
  },
});
if (result.data.length > 3 * 1024 * 1024)
  throw new Error("Arm exceeds 3 MiB budget");
await writeFile(`${output}/industrial-arm.glb`, result.data);
const box = new THREE.Box3().setFromObject(root),
  size = box.getSize(new THREE.Vector3());
console.log(
  JSON.stringify(
    {
      ...result.stats,
      bytes: result.data.length,
      bounds: box.min.toArray().concat(box.max.toArray()),
      size: size.toArray(),
    },
    null,
    2,
  ),
);
