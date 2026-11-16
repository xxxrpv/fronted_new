/** Original presentation AMR, metres / Y up / forward -Z. Not manufacturing CAD. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { encodeThreeGlb } from "./encode-three-glb.mjs";

function createMobile() {
  const root = new THREE.Group();
  root.name = "industrial_mobile_robot";
  root.userData = {
    sourceKind: "original-visual-concept",
    nativeCad: false,
    engineeringValidated: false,
    units: "metres",
    forwardAxis: "-Z",
  };
  const material = (name, color, metalness, roughness) => {
    const value = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
    });
    value.name = name;
    return value;
  };
  const m = {
    shell: material("mobile_powder_coat", "#e3e6e5", 0.12, 0.34),
    dark: material("mobile_anodized_chassis", "#252d32", 0.65, 0.38),
    steel: material("mobile_brushed_alloy", "#b4bdc1", 0.88, 0.24),
    machined: material("mobile_machined_edges", "#d5dcdf", 0.95, 0.18),
    tire: material("mobile_tire_rubber", "#232627", 0.02, 0.85),
    rubber: material("mobile_bumper_rubber", "#363c40", 0.02, 0.68),
    recess: material("mobile_recess", "#0f161c", 0.04, 0.5),
    lens: material("mobile_optical_glass", "#111f29", 0.28, 0.065),
    optic: material("mobile_optical_coating", "#264d64", 0.48, 0.11),
    red: material("mobile_emergency_switch", "#b83c31", 0.05, 0.28),
    amber: material("mobile_safety_collar", "#d2a54d", 0.08, 0.43),
    light: material("mobile_status_diffuser", "#82c5dc", 0.05, 0.3),
    copper: material("mobile_charging_contacts", "#bd9466", 0.9, 0.28),
    label: material("mobile_service_plate", "#d0d5d5", 0.65, 0.4),
  };
  m.light.emissive.set("#3d829f");
  m.light.emissiveIntensity = 0.45;
  const geometries = new Map();
  const cached = (key, create) => {
    if (!geometries.has(key)) geometries.set(key, create());
    return geometries.get(key);
  };
  const group = (parent, name, xyz = [0, 0, 0], rotation = [0, 0, 0]) => {
    const result = new THREE.Group();
    result.name = name;
    result.position.fromArray(xyz);
    result.rotation.fromArray(rotation);
    parent.add(result);
    return result;
  };
  const mesh = (
    parent,
    name,
    geometry,
    mat,
    xyz = [0, 0, 0],
    rotation = [0, 0, 0],
  ) => {
    const result = new THREE.Mesh(geometry, mat);
    result.name = name;
    result.position.fromArray(xyz);
    result.rotation.fromArray(rotation);
    result.castShadow = result.receiveShadow = true;
    parent.add(result);
    return result;
  };
  const box = (p, n, size, mat, xyz, radius = 0.003, rotation) =>
    mesh(
      p,
      n,
      cached(
        `b${size}/${radius}`,
        () =>
          new RoundedBoxGeometry(
            ...size,
            3,
            Math.min(radius, ...size.map((v) => v / 3)),
          ),
      ),
      mat,
      xyz,
      rotation,
    );
  const cyl = (p, n, radius, height, mat, xyz, rotation, segments = 48) =>
    mesh(
      p,
      n,
      cached(
        `c${radius}/${height}/${segments}`,
        () => new THREE.CylinderGeometry(radius, radius, height, segments),
      ),
      mat,
      xyz,
      rotation,
    );
  const ring = (p, n, radius, tube, mat, xyz, rotation) =>
    mesh(
      p,
      n,
      cached(
        `t${radius}/${tube}`,
        () => new THREE.TorusGeometry(radius, tube, 8, 64),
      ),
      mat,
      xyz,
      rotation,
    );
  const bolt = (parent, xyz, rotation = [0, 0, 0], scale = 1) => {
    const b = group(parent, "recessed_socket_fastener", xyz, rotation);
    b.scale.setScalar(scale);
    cyl(b, "countersunk_seat", 0.0063, 0.001, m.dark, [0, 0, 0]);
    cyl(b, "stainless_socket_head", 0.0047, 0.0025, m.machined, [0, 0.0008, 0]);
    cyl(
      b,
      "hex_socket",
      0.0025,
      0.0005,
      m.recess,
      [0, 0.0022, 0],
      [0, Math.PI / 6, 0],
      6,
    );
  };
  const cable = (parent, name, points, radius) => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
    );
    return mesh(
      parent,
      name,
      new THREE.TubeGeometry(curve, 30, radius, 8, false),
      m.rubber,
    );
  };

  const chassis = group(root, "sealed_chassis_and_service_panels");
  box(
    chassis,
    "lower_cast_chassis",
    [0.63, 0.17, 1.015],
    m.dark,
    [0, 0.16, 0],
    0.025,
  );
  box(
    chassis,
    "underbody_skid_plate",
    [0.57, 0.014, 0.92],
    m.steel,
    [0, 0.077, 0],
    0.012,
  );
  // The split side panels leave a real wheel well instead of intersecting a solid box.
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      box(
        chassis,
        "side_service_pod",
        [0.085, 0.18, 0.39],
        m.shell,
        [side * 0.345, 0.253, end * 0.339],
        0.027,
      );
      box(
        chassis,
        "replaceable_side_bumper",
        [0.096, 0.038, 0.365],
        m.rubber,
        [side * 0.345, 0.165, end * 0.344],
        0.013,
      );
      for (const z of [end * 0.205, end * 0.47])
        bolt(
          chassis,
          [side * 0.389, 0.285, z],
          [0, 0, (-side * Math.PI) / 2],
          0.75,
        );
    }
    box(
      chassis,
      "wheel_well_inner",
      [0.018, 0.16, 0.25],
      m.recess,
      [side * 0.308, 0.23, 0],
      0.035,
    );
    box(
      chassis,
      "side_status_recess",
      [0.007, 0.014, 0.19],
      m.recess,
      [side * 0.39, 0.31, -0.335],
      0.006,
    );
    box(
      chassis,
      "side_status_light",
      [0.008, 0.006, 0.175],
      m.light,
      [side * 0.394, 0.312, -0.335],
      0.002,
    );
    const grille = group(chassis, "motor_controller_vent", [
      side * 0.389,
      0.237,
      0.355,
    ]);
    box(
      grille,
      "recessed_vent_panel",
      [0.005, 0.075, 0.19],
      m.dark,
      [0, 0, 0],
      0.007,
    );
    for (let i = 0; i < 9; i++)
      box(
        grille,
        "louver_opening",
        [0.003, 0.047, 0.007],
        m.recess,
        [side * 0.003, 0, -0.07 + i * 0.0175],
        0.003,
        [0.2, 0, 0],
      );
  }
  // Removable top cover, gasket, perimeter bead and separate load deck.
  box(
    chassis,
    "upper_cover_gasket",
    [0.77, 0.008, 1.085],
    m.recess,
    [0, 0.338, 0],
    0.045,
  );
  box(
    chassis,
    "upper_powder_coated_cover",
    [0.778, 0.069, 1.092],
    m.shell,
    [0, 0.378, 0],
    0.034,
  );
  box(
    chassis,
    "deck_isolation_gasket",
    [0.652, 0.005, 0.91],
    m.rubber,
    [0, 0.414, 0],
    0.025,
  );
  box(
    chassis,
    "aluminium_payload_deck",
    [0.642, 0.012, 0.9],
    m.steel,
    [0, 0.423, 0],
    0.021,
  );
  box(
    chassis,
    "replaceable_non_slip_deck",
    [0.565, 0.006, 0.74],
    m.rubber,
    [0, 0.432, 0],
    0.017,
  );
  for (const x of [-0.275, 0.275])
    for (const z of [-0.37, 0.37]) {
      cyl(chassis, "machined_payload_mount", 0.025, 0.007, m.machined, [
        x,
        0.434,
        z,
      ]);
      cyl(chassis, "threaded_mount_hole", 0.007, 0.001, m.recess, [
        x,
        0.438,
        z,
      ]);
      ring(
        chassis,
        "mount_machining_ring",
        0.018,
        0.0005,
        m.steel,
        [x, 0.438, z],
        [Math.PI / 2, 0, 0],
      );
    }
  for (const x of [-0.348, 0.348])
    for (const z of [-0.445, 0, 0.445])
      bolt(chassis, [x, 0.41, z], [0, 0, 0], 0.8);
  for (const end of [-1, 1]) {
    box(
      chassis,
      "bumper_pressure_strip",
      [0.65, 0.052, 0.054],
      m.rubber,
      [0, 0.161, end * 0.514],
      0.018,
    );
    box(
      chassis,
      "bumper_separation_line",
      [0.51, 0.003, 0.008],
      m.recess,
      [0, 0.16, end * 0.542],
      0.001,
    );
  }

  const tireProfile = [
    [0.067, -0.046],
    [0.092, -0.046],
    [0.107, -0.041],
    [0.113, -0.03],
    [0.114, -0.025],
    [0.111, -0.023],
    [0.115, -0.021],
    [0.115, -0.009],
    [0.112, -0.007],
    [0.115, -0.005],
    [0.115, 0.005],
    [0.112, 0.007],
    [0.115, 0.009],
    [0.115, 0.021],
    [0.111, 0.023],
    [0.114, 0.025],
    [0.113, 0.03],
    [0.107, 0.041],
    [0.092, 0.046],
    [0.067, 0.046],
    [0.067, -0.046],
  ];
  const tireGeometry = new THREE.LatheGeometry(
    tireProfile.map((p) => new THREE.Vector2(...p)),
    80,
  );
  for (const side of [-1, 1]) {
    const wheel = group(
      root,
      side < 0 ? "mobile_drive_left" : "mobile_drive_right",
      [side * 0.349, 0.115, 0],
    );
    wheel.userData = { jointAxis: "X", radius: 0.115, presentationOnly: true };
    mesh(
      wheel,
      "moulded_tire_with_tread_channels",
      tireGeometry,
      m.tire,
      [0, 0, 0],
      [0, 0, Math.PI / 2],
    );
    cyl(
      wheel,
      "alloy_wheel_barrel",
      0.069,
      0.086,
      m.steel,
      [0, 0, 0],
      [0, 0, Math.PI / 2],
    );
    const face = group(
      wheel,
      "cast_alloy_wheel_face",
      [side * 0.046, 0, 0],
      [0, 0, (-side * Math.PI) / 2],
    );
    cyl(face, "dark_recessed_web", 0.063, 0.004, m.dark, [0, 0, 0]);
    ring(
      face,
      "polished_rim_edge",
      0.066,
      0.003,
      m.machined,
      [0, 0.002, 0],
      [Math.PI / 2, 0, 0],
    );
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const spoke = group(face, "cast_spoke", [0, 0, 0], [0, a, 0]);
      box(
        spoke,
        "beveled_spoke",
        [0.014, 0.007, 0.043],
        m.steel,
        [0, 0.005, 0.037],
        0.003,
        [0, 0.14, 0],
      );
      bolt(
        face,
        [Math.sin(a) * 0.047, 0.01, Math.cos(a) * 0.047],
        [0, 0, 0],
        0.68,
      );
    }
    cyl(face, "hub_bearing_cap", 0.025, 0.014, m.machined, [0, 0.006, 0]);
    cyl(face, "axle_end_cap", 0.014, 0.002, m.dark, [0, 0.014, 0]);
    ring(
      wheel,
      "outer_sidewall_bead",
      0.089,
      0.0015,
      m.rubber,
      [side * 0.0465, 0, 0],
      [0, Math.PI / 2, 0],
    );
  }
  let casterIndex = 0;
  for (const x of [-0.271, 0.271])
    for (const z of [-0.393, 0.393]) {
      const fork = group(root, "caster_fork", [x, 0.052, z]);
      cyl(fork, "swivel_bearing", 0.036, 0.014, m.steel, [0, 0.058, 0]);
      for (const side of [-1, 1])
        box(
          fork,
          "cast_clevis",
          [0.008, 0.055, 0.047],
          m.steel,
          [side * 0.027, 0.027, 0],
          0.007,
        );
      const wheel = group(fork, `mobile_caster_${casterIndex++}`);
      cyl(
        wheel,
        "polyurethane_caster_tread",
        0.052,
        0.043,
        m.tire,
        [0, 0, 0],
        [0, 0, Math.PI / 2],
      );
      for (const side of [-1, 1]) {
        cyl(
          wheel,
          "caster_rim",
          0.034,
          0.002,
          m.steel,
          [side * 0.023, 0, 0],
          [0, 0, Math.PI / 2],
        );
        bolt(fork, [side * 0.032, 0, 0], [0, 0, (-side * Math.PI) / 2], 1.05);
      }
    }

  const front = group(root, "front_navigation_and_safety", [0, 0, -0.53]);
  box(
    front,
    "scanner_protective_housing",
    [0.28, 0.105, 0.08],
    m.dark,
    [0, 0.241, 0],
    0.028,
  );
  box(
    front,
    "scanner_optical_window",
    [0.257, 0.064, 0.018],
    m.lens,
    [0, 0.237, -0.043],
    0.008,
  );
  box(
    front,
    "scanner_window_lower_seal",
    [0.247, 0.005, 0.008],
    m.rubber,
    [0, 0.204, -0.052],
    0.002,
  );
  box(
    front,
    "scanner_protective_brow",
    [0.295, 0.013, 0.083],
    m.shell,
    [0, 0.295, -0.003],
    0.008,
  );
  for (const x of [-0.075, 0.075]) {
    cyl(
      front,
      "stereo_camera_barrel",
      0.021,
      0.014,
      m.dark,
      [x, 0.356, -0.019],
      [Math.PI / 2, 0, 0],
    );
    cyl(
      front,
      "lens_machined_rim",
      0.016,
      0.003,
      m.machined,
      [x, 0.356, -0.027],
      [Math.PI / 2, 0, 0],
    );
    cyl(
      front,
      "optical_front_element",
      0.0138,
      0.003,
      m.optic,
      [x, 0.356, -0.029],
      [Math.PI / 2, 0, 0],
    );
    cyl(
      front,
      "aperture",
      0.0078,
      0.0008,
      m.lens,
      [x, 0.356, -0.031],
      [Math.PI / 2, 0, 0],
    );
  }
  for (const x of [-0.243, 0.243]) {
    const sensor = group(front, "front_ultrasonic_sensor", [x, 0.259, 0.001]);
    cyl(
      sensor,
      "sensor_mount",
      0.017,
      0.009,
      m.dark,
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    );
    cyl(
      sensor,
      "ultrasonic_membrane",
      0.011,
      0.002,
      m.steel,
      [0, 0, -0.006],
      [Math.PI / 2, 0, 0],
    );
    ring(sensor, "sensor_seal", 0.014, 0.0016, m.rubber, [0, 0, -0.006]);
  }
  box(
    front,
    "front_led_recess",
    [0.23, 0.009, 0.008],
    m.recess,
    [0, 0.391, -0.015],
    0.003,
  );
  box(
    front,
    "front_led_diffuser",
    [0.213, 0.004, 0.009],
    m.light,
    [0, 0.391, -0.019],
    0.002,
  );

  const rear = group(root, "battery_and_service_interfaces", [0, 0, 0.526]);
  box(
    rear,
    "battery_drawer_gap",
    [0.44, 0.133, 0.018],
    m.recess,
    [0, 0.251, 0],
    0.008,
  );
  box(
    rear,
    "removable_battery_door",
    [0.43, 0.123, 0.019],
    m.dark,
    [0, 0.251, 0.004],
    0.007,
  );
  box(
    rear,
    "recessed_handle",
    [0.127, 0.031, 0.004],
    m.recess,
    [0, 0.26, 0.015],
    0.01,
  );
  box(
    rear,
    "flush_drawer_handle",
    [0.104, 0.008, 0.008],
    m.steel,
    [0, 0.267, 0.019],
    0.003,
  );
  for (const x of [-0.188, 0.188])
    for (const y of [0.211, 0.291])
      bolt(rear, [x, y, 0.017], [Math.PI / 2, 0, 0], 0.75);
  for (const x of [-0.1, 0.1])
    box(
      rear,
      "spring_charging_contact",
      [0.047, 0.024, 0.006],
      m.copper,
      [x, 0.151, 0.018],
      0.004,
    );
  const service = group(root, "service_controls", [0.277, 0.419, 0.32]);
  box(service, "control_inset", [0.13, 0.006, 0.132], m.dark, [0, 0, 0], 0.011);
  cyl(
    service,
    "emergency_yellow_collar",
    0.024,
    0.005,
    m.amber,
    [0, 0.006, -0.024],
  );
  cyl(
    service,
    "emergency_stop_neck",
    0.011,
    0.017,
    m.recess,
    [0, 0.015, -0.024],
  );
  cyl(
    service,
    "emergency_stop_mushroom",
    0.02,
    0.012,
    m.red,
    [0, 0.028, -0.024],
  );
  ring(
    service,
    "emergency_button_edge",
    0.017,
    0.003,
    m.red,
    [0, 0.034, -0.024],
    [Math.PI / 2, 0, 0],
  );
  cyl(
    service,
    "power_button_bezel",
    0.0105,
    0.003,
    m.steel,
    [-0.025, 0.006, 0.035],
  );
  cyl(
    service,
    "power_button_lens",
    0.007,
    0.002,
    m.light,
    [-0.025, 0.008, 0.035],
  );
  cyl(
    service,
    "service_key_port",
    0.012,
    0.003,
    m.machined,
    [0.026, 0.006, 0.035],
  );
  box(
    service,
    "key_slot",
    [0.002, 0.001, 0.012],
    m.recess,
    [0.026, 0.008, 0.035],
    0.0005,
  );
  box(
    root,
    "serial_service_plate",
    [0.145, 0.001, 0.053],
    m.label,
    [-0.24, 0.414, 0.475],
    0.003,
  );
  for (const x of [-0.298, -0.182])
    bolt(root, [x, 0.416, 0.475], [0, 0, 0], 0.5);
  cable(
    chassis,
    "protected_motor_loom",
    [
      [-0.25, 0.11, 0.08],
      [-0.22, 0.095, 0.18],
      [0.1, 0.095, 0.24],
      [0.25, 0.14, 0.13],
    ],
    0.006,
  );
  for (const x of [-0.22, 0.22])
    cyl(
      chassis,
      "motor_cable_gland",
      0.012,
      0.018,
      m.dark,
      [x, 0.117, 0.14],
      [0, 0, Math.PI / 2],
    );
  root.updateMatrixWorld(true);
  return root;
}

const destination = fileURLToPath(
  new URL("../public/v8-assets/cinematic/", import.meta.url),
);
await mkdir(destination, { recursive: true });
const robot = createMobile();
const result = encodeThreeGlb(robot, {
  copyright: "Original Embodex presentation asset",
  source: {
    kind: "original-procedural-visual-concept",
    engineeringValidated: false,
    nativeCad: false,
    units: "metres",
    animationProtocol: "named-local-joints-v1",
  },
});
if (result.data.length > 4 * 1024 * 1024)
  throw new Error("Mobile presentation asset exceeds 4 MiB budget");
const bounds = new THREE.Box3().setFromObject(robot);
const report = {
  ...result.stats,
  bytes: result.data.length,
  sha256: createHash("sha256").update(result.data).digest("hex"),
  bounds: bounds.min.toArray().concat(bounds.max.toArray()),
  size: bounds.getSize(new THREE.Vector3()).toArray(),
  source: "scripts/create-showcase-mobile.mjs",
  engineeringValidated: false,
};
await writeFile(`${destination}/mobile-amr.glb`, result.data);
await writeFile(
  `${destination}/mobile-amr.provenance.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
