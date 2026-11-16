import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { mobileSurfaceTexture, showcaseTexture } from "./showcase-textures";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ModuleId } from "../../lib/v8/module-workspace";

type Machine = "quadruped" | "mobile" | "arm";
type Phase = {
  chapter: number;
  stage: string;
  machine: Machine;
  progress: number;
};
type Options = {
  module: ModuleId;
  journey?: boolean;
  onPhase: (phase: Phase) => void;
  onReady: () => void;
};
type Robot = {
  root: THREE.Group;
  body: THREE.Object3D;
  outline: THREE.Group;
  lines: THREE.LineBasicMaterial;
  materials: THREE.Material[];
  plane: THREE.Plane;
  height: number;
  joints: Map<
    string,
    { node: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }
  >;
  type: Machine;
  payload?: THREE.Group;
};
const assets: [Machine, string][] = [
  ["quadruped", "/v8-assets/go2-high-fidelity.glb"],
  ["mobile", "/v8-assets/cinematic/mobile-amr.glb"],
  ["arm", "/v8-assets/cinematic/industrial-arm.glb"],
];
// Only the three public presentation assets are retained; no project files or signed URLs.
const showcaseBytes = new Map<string, Promise<ArrayBuffer>>();
function readShowcaseAsset(url: string) {
  let pending = showcaseBytes.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("演示模型读取失败");
        return response.arrayBuffer();
      })
      .catch((error) => {
        showcaseBytes.delete(url);
        throw error;
      });
    showcaseBytes.set(url, pending);
  }
  return pending;
}
const smooth = (value: number) => {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};
const yAxis = new THREE.Vector3(0, 1, 0),
  xAxis = new THREE.Vector3(1, 0, 0),
  zAxis = new THREE.Vector3(0, 0, 1);

/** Actual articulated geometry and scene construction. No moving photographs. */
export async function createShowcase(host: HTMLElement, options: Options) {
  let alive = true,
    frame = 0,
    elapsed = 0,
    previous = 0,
    paused = false,
    visible = true;
  let jump = -1,
    lastPhase = "",
    currentRobot = -1,
    currentModule = "",
    environment: THREE.Group | null = null;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: Boolean(options.journey),
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = options.journey ? null : new THREE.Color(0xe9eff4);
  renderer.setClearColor(0xf2f6fb, options.journey ? 0 : 1);
  scene.fog = options.journey ? null : new THREE.Fog(0xe9eff4, 14, 30);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 70);
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const environmentMap = pmrem.fromScene(room, 0.04).texture;
  scene.environment = environmentMap;
  scene.environmentIntensity = 0.42;
  let photoMap: THREE.Texture | undefined;
  const lightingReady = new HDRLoader()
    .loadAsync("/v8-assets/cinematic/studio_small_09_1k.hdr")
    .then((hdr) => {
      if (!alive) {
        hdr.dispose();
        return;
      }
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      photoMap = hdr;
      scene.environment = hdr;
      scene.environmentIntensity = 0.58;
      scene.environmentRotation.y = 0.65;
    })
    .catch(() => {
      /* The local studio environment remains available. */
    });
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x8b8e91, 0.28));
  const key = new THREE.DirectionalLight(0xfff5e8, 2.1);
  key.position.set(-3, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -4.5,
    right: 4.5,
    top: 4.5,
    bottom: -4.5,
    near: 0.1,
    far: 22,
  });
  key.shadow.radius = options.journey ? 18 : 8;
  key.shadow.normalBias = 0.007;
  key.shadow.bias = -0.0002;
  key.shadow.intensity = 0.75;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd9e9fc, 0.42);
  fill.position.set(4, 3, -2);
  scene.add(fill);
  const concrete = showcaseTexture("concrete"),
    cardboard = showcaseTexture("cardboard"),
    labelTexture = showcaseTexture("label"),
    contactTexture = showcaseTexture("contact");
  const mobileTextures = {
    paint: mobileSurfaceTexture("paint"),
    rubber: mobileSurfaceTexture("rubber"),
    brushed: mobileSurfaceTexture("brushed"),
    plate: mobileSurfaceTexture("plate"),
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    options.journey
      ? new THREE.ShadowMaterial({ opacity: 0.14 })
      : new THREE.MeshStandardMaterial({
          color: 0xe2e7eb,
          roughness: 0.75,
          metalness: 0.02,
        }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.position.y = -0.022;
  scene.add(floor);
  const palette = {
    ivory: new THREE.MeshStandardMaterial({
      color: 0xbec8ce,
      roughness: 0.42,
      metalness: 0.3,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x65747e,
      roughness: 0.3,
      metalness: 0.82,
    }),
    graphite: new THREE.MeshStandardMaterial({
      color: 0x303b40,
      roughness: 0.48,
      metalness: 0.3,
    }),
    carton: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: cardboard,
      bumpMap: cardboard,
      bumpScale: 0.003,
      roughness: 0.92,
    }),
    parcel: new THREE.MeshStandardMaterial({
      color: 0xddd1ba,
      map: cardboard,
      bumpMap: cardboard,
      bumpScale: 0.002,
      roughness: 0.86,
    }),
    tape: new THREE.MeshStandardMaterial({ color: 0xd4cbb7, roughness: 0.65 }),
    label: new THREE.MeshStandardMaterial({
      map: labelTexture,
      roughness: 0.83,
    }),
    safety: new THREE.MeshStandardMaterial({
      color: 0xb68b45,
      roughness: 0.53,
      metalness: 0.25,
    }),
    white: new THREE.MeshStandardMaterial({ color: 0xf3f5f4, roughness: 0.35 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xd7e7ef,
      roughness: 0.13,
      metalness: 0.1,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
    light: new THREE.MeshStandardMaterial({
      color: 0x7daac6,
      emissive: 0x5c99be,
      emissiveIntensity: 0.7,
      roughness: 0.25,
    }),
  };
  const robotCache: Robot[] = [];
  const props: THREE.Object3D[] = [];
  const propStart = new Map<THREE.Object3D, { y: number; index: number }>();
  const box = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    radius = 0.025,
  ) => {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const cylinder = (
    r: number,
    height: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, height, 32),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const addProp = (parent: THREE.Group, object: THREE.Object3D) => {
    parent.add(object);
    props.push(object);
    propStart.set(object, { y: object.position.y, index: props.length - 1 });
  };
  const crate = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    variant = false,
  ) => {
    const item = new THREE.Group();
    item.position.set(x, y, z);
    item.add(
      box(
        w,
        h,
        d,
        variant ? palette.parcel : palette.carton,
        0,
        h / 2,
        0,
        0.015,
      ),
    );
    item.add(
      box(0.035, 0.004, d + 0.006, palette.tape, 0, h + 0.003, 0, 0.001),
    );
    item.add(
      box(
        0.035,
        h * 0.25,
        0.006,
        palette.tape,
        0,
        h * 0.875,
        d / 2 + 0.004,
        0.001,
      ),
    );
    item.add(
      box(
        w * 0.3,
        h * 0.28,
        0.004,
        palette.label,
        w * 0.2,
        h * 0.62,
        d / 2 + 0.003,
        0.001,
      ),
    );
    return item;
  };
  const shelf = (x: number, z: number) => {
    const rack = new THREE.Group();
    rack.position.set(x, 0, z);
    for (const sx of [-0.67, 0.67])
      for (const sz of [-0.26, 0.26])
        rack.add(box(0.045, 2.1, 0.045, palette.metal, sx, 1.05, sz, 0.005));
    for (let level = 0; level < 3; level++) {
      const h = 0.12 + level * 0.65;
      rack.add(box(1.45, 0.055, 0.64, palette.graphite, 0, h, 0, 0.006));
      for (const side of [-1, 1]) {
        rack.add(
          box(1.43, 0.085, 0.035, palette.safety, 0, h, side * 0.32, 0.004),
        );
        for (const sx of [-0.66, 0.66])
          for (const dy of [-0.02, 0.02])
            rack.add(
              box(
                0.014,
                0.014,
                0.008,
                palette.metal,
                sx,
                h + dy,
                side * 0.343,
                0.002,
              ),
            );
      }
      for (let i = 0; i < 3; i++)
        rack.add(
          crate(
            0.38,
            0.38 + (i % 2) * 0.1,
            0.43,
            -0.48 + i * 0.47,
            h + 0.03,
            0,
            Boolean((i + level) % 2),
          ),
        );
    }
    return rack;
  };
  const table = (x: number, z: number) => {
    const item = new THREE.Group();
    item.position.set(x, 0, z);
    item.add(box(1.65, 0.09, 1.1, palette.metal, 0, 0.74, 0, 0.025));
    for (const sx of [-0.67, 0.67])
      for (const sz of [-0.42, 0.42])
        item.add(box(0.065, 0.7, 0.065, palette.graphite, sx, 0.36, sz, 0.01));
    item.add(box(1.4, 0.055, 0.8, palette.graphite, 0, 0.2, 0));
    return item;
  };
  const environmentCache = new Map<string, THREE.Group>();
  const buildEnvironment = (module: ModuleId, type: Machine) => {
    const id = `${module}:${type}`;
    const cached = environmentCache.get(id);
    props.length = 0;
    propStart.clear();
    if (cached) {
      cached.children.forEach((child) => {
        props.push(child);
        propStart.set(child, {
          y: Number(child.userData.baseY || 0),
          index: props.length - 1,
        });
      });
      return cached;
    }
    const env = new THREE.Group();
    if (module === "embodex") {
      const plinth = cylinder(
        1.75,
        0.1,
        new THREE.MeshStandardMaterial({
          color: 0xd4dfe5,
          roughness: 0.42,
          metalness: 0.25,
        }),
        0,
        -0.06,
        0,
      );
      if (!options.journey) addProp(env, plinth);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.69, 0.008, 8, 100),
        palette.white,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.005;
      if (!options.journey) addProp(env, ring);
    } else {
      const base = box(
        7.5,
        0.12,
        6.4,
        new THREE.MeshStandardMaterial({
          color: 0xd6dce1,
          map: concrete,
          bumpMap: concrete,
          bumpScale: 0.008,
          roughness: 0.72,
          metalness: 0.08,
        }),
        0,
        -0.1,
        -0.4,
        0.12,
      );
      if (!options.journey) addProp(env, base);
      if (type !== "arm") {
        for (let i = 0; i < (options.journey ? 2 : 3); i++)
          addProp(
            env,
            shelf(
              (options.journey ? -0.8 : -2.1) + i * 1.55,
              options.journey ? -1.85 : -2.35,
            ),
          );
        if (!options.journey) addProp(env, shelf(2.8, -0.95));
        if (!options.journey)
          addProp(env, crate(0.5, 0.4, 0.55, -2.45, 0.02, 0.4));
        const bollard = new THREE.Group();
        for (const x of [-2.7, 2.7]) {
          bollard.add(cylinder(0.06, 0.6, palette.graphite, x, 0.3, 1.45));
          bollard.add(cylinder(0.066, 0.12, palette.ivory, x, 0.42, 1.45));
        }
        if (!options.journey) addProp(env, bollard);
      } else {
        addProp(env, table(-2, -1.35));
        addProp(env, table(2, -1.4));
        const cell = new THREE.Group();
        cell.position.set(0, 0, -2.2);
        for (const x of [-2.6, 0, 2.6])
          cell.add(box(0.055, 2.5, 0.055, palette.metal, x, 1.25, 0));
        cell.add(box(5.25, 0.055, 0.055, palette.metal, 0, 2.5, 0));
        cell.add(box(5.1, 2.35, 0.02, palette.glass, 0, 1.25, 0, 0.002));
        addProp(env, cell);
        const cabinet = box(
          0.9,
          1.6,
          0.55,
          palette.ivory,
          2.8,
          0.8,
          -0.2,
          0.04,
        );
        cabinet.add(
          box(0.4, 0.27, 0.012, palette.graphite, 0, 0.38, 0.283, 0.014),
        );
        cabinet.add(cylinder(0.025, 0.02, palette.light, 0.26, 0.12, 0.29));
        addProp(env, cabinet);
        const part = box(
          0.23,
          0.25,
          0.23,
          palette.metal,
          1.1,
          0.13,
          0.2,
          0.025,
        );
        addProp(env, part);
      }
      if (module === "deployx") {
        const dock = new THREE.Group();
        dock.position.set(-1.2, 0, 0.1);
        dock.add(box(0.22, 0.38, 1.15, palette.graphite, -0.95, 0.19, 0));
        dock.add(box(0.025, 0.025, 0.75, palette.light, -0.825, 0.27, 0));
        dock.add(box(1.4, 0.035, 1.25, palette.metal, -0.35, 0.005, 0, 0.02));
        addProp(env, dock);
      }
      if (module === "simcore") {
        const path = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-1.5, 0.015, 0.9),
          new THREE.Vector3(-0.3, 0.015, 1.2),
          new THREE.Vector3(1.3, 0.015, 0.55),
          new THREE.Vector3(1.65, 0.015, -0.5),
        ]);
        const route = new THREE.Mesh(
          new THREE.TubeGeometry(path, 48, 0.012, 6, false),
          new THREE.MeshBasicMaterial({
            color: module === "simcore" ? 0xe4f5ff : 0xf5f4ee,
            transparent: true,
            opacity: 0.8,
          }),
        );
        route.name = "simulation-route";
        addProp(env, route);
      }
    }
    env.children.forEach((child) => {
      child.userData.baseY = child.position.y;
    });
    environmentCache.set(id, env);
    return env;
  };
  const loadRobot = async ([type, url]: [Machine, string]) => {
    const gltf = await new GLTFLoader().parseAsync(
      await readShowcaseAsset(url),
      "",
    );
    const body = gltf.scene,
      root = new THREE.Group(),
      bounds = new THREE.Box3().setFromObject(body),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    const scale =
      (type === "arm" ? 2.15 : 2.2) / Math.max(size.x, size.y, size.z);
    body.scale.setScalar(scale);
    body.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );
    root.add(body);
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
    const mats = new Set<THREE.Material>(),
      joints: Robot["joints"] = new Map();
    const materialClones = new Map<THREE.Material, THREE.Material>();
    const cloneMaterial = (material: THREE.Material) => {
      if (!materialClones.has(material))
        materialClones.set(material, material.clone());
      return materialClones.get(material)!;
    };
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x7896aa,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const outline = new THREE.Group();
    root.add(outline);
    body.updateMatrixWorld(true);
    const rootInverse = root.matrixWorld.clone().invert();
    body.traverse((node) => {
      if (
        /_(?:hip|thigh|calf)$/.test(node.name) ||
        /差速驱动轮/.test(node.name) ||
        /^mobile_(drive|caster)_/.test(node.name) ||
        /^arm_(j\d|finger)/.test(node.name)
      )
        joints.set(node.name, {
          node,
          q: node.quaternion.clone(),
          p: node.position.clone(),
        });
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.material = Array.isArray(node.material)
        ? node.material.map(cloneMaterial)
        : cloneMaterial(node.material);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        mats.add(material);
        material.clippingPlanes = [plane];
        material.clipShadows = true;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.envMapIntensity = 0.8;
          if (type === "mobile") {
            // Preserve the authored rubber, coated metal and optical roughness.
            if (material.name === "mobile_powder_coat") {
              material.bumpMap = mobileTextures.paint;
              material.bumpScale = 0.00065;
            } else if (/mobile_(tire|bumper)_rubber/.test(material.name)) {
              material.bumpMap = mobileTextures.rubber;
              material.bumpScale = 0.001;
            } else if (
              /mobile_(brushed_alloy|machined_edges)/.test(material.name)
            ) {
              material.bumpMap = mobileTextures.brushed;
              material.bumpScale = 0.00022;
            } else if (material.name === "mobile_service_plate") {
              material.map = mobileTextures.plate;
            }
          } else {
            if (
              material.color.r > 0.65 &&
              material.color.g > 0.65 &&
              material.color.b > 0.65
            ) {
              material.roughness = Math.max(0.48, material.roughness);
              material.metalness = Math.min(0.08, material.metalness);
            }
            material.roughness = Math.max(
              0.22,
              Math.min(0.8, material.roughness),
            );
          }
        }
      }
      node.geometry.computeBoundingBox();
      const meshSize = node.geometry
        .boundingBox!.getSize(new THREE.Vector3())
        .multiply(node.getWorldScale(new THREE.Vector3()));
      if (Math.max(meshSize.x, meshSize.y, meshSize.z) > 0.07) {
        const lines = new THREE.LineSegments(
          new THREE.EdgesGeometry(node.geometry, 52),
          lineMaterial,
        );
        lines.applyMatrix4(rootInverse.clone().multiply(node.matrixWorld));
        outline.add(lines);
      }
    });
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(
        type === "arm" ? 1.3 : 2.2,
        type === "quadruped" ? 1.4 : 1.8,
      ),
      new THREE.MeshBasicMaterial({
        map: contactTexture,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -0.009;
    contact.name = "contact-shadow";
    root.add(contact);
    let payload: THREE.Group | undefined;
    if (type === "mobile") {
      payload = new THREE.Group();
      payload.name = "deployment_payload";
      const deckHeight = 0.435 * scale;
      payload.add(crate(0.61, 0.4, 0.67, -0.23, deckHeight, 0.13));
      payload.add(crate(0.42, 0.3, 0.56, 0.29, deckHeight, 0.2, true));
      payload.visible = false;
      root.add(payload);
    }
    scene.add(root);
    root.visible = false;
    const robot: Robot = {
      root,
      body,
      outline,
      lines: lineMaterial,
      materials: [...mats],
      plane,
      height: size.y * scale,
      joints,
      type,
      payload,
    };
    robotCache.push(robot);
    return robot;
  };
  const resize = () => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (w < 1 || h < 1) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  visibility.observe(host);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const disposeObject = (object: THREE.Object3D) => {
    object.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const material of materials) {
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      }
    });
  };
  const dispose = () => {
    alive = false;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    visibility.disconnect();
    environmentCache.forEach((env) => disposeObject(env));
    disposeObject(scene);
    Object.values(palette).forEach((material) => material.dispose());
    environmentMap.dispose();
    photoMap?.dispose();
    concrete.dispose();
    cardboard.dispose();
    labelTexture.dispose();
    contactTexture.dispose();
    Object.values(mobileTextures).forEach((texture) => texture.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  // Return the cleanup handle immediately, so an unmount during loading never leaks a renderer.
  const ready = Promise.allSettled(assets.map(loadRobot)).then(
    async (results) => {
      await lightingReady;
      if (!alive) {
        robotCache.forEach((robot) => disposeObject(robot.root));
        return;
      }
      const robots = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (!robots.length) throw new Error("机器人演示暂未载入");
      host.dataset.modelCount = String(robots.length);
      options.onReady();
      const setJoint = (
        robot: Robot,
        name: string,
        axis: THREE.Vector3,
        angle: number,
      ) => {
        const joint = robot.joints.get(name);
        if (joint)
          joint.node.quaternion
            .copy(joint.q)
            .multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      };
      const packetMaterial = new THREE.MeshBasicMaterial({
        color: 0x6eaccf,
        transparent: true,
        opacity: 0.78,
      });
      const signal = new THREE.Group();
      scene.add(signal);
      for (let i = 0; i < 3; i++) {
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(0.22 + i * 0.15, 0.008, 6, 36, Math.PI * 1.3),
          packetMaterial,
        );
        arc.rotation.z = -0.47;
        arc.position.set(-1.7, 1.25, -0.2 - i * 0.025);
        signal.add(arc);
      }
      const packets = Array.from({ length: 6 }, () => {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.025, 8, 8),
          packetMaterial,
        );
        signal.add(dot);
        return dot;
      });
      const checkpointMaterial = new THREE.MeshBasicMaterial({
        color: 0x7fb7d6,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      const checkpoint = new THREE.Mesh(
        new THREE.RingGeometry(0.24, 0.255, 48),
        checkpointMaterial,
      );
      checkpoint.rotation.x = -Math.PI / 2;
      checkpoint.position.set(1, 0.025, 0.4);
      scene.add(checkpoint);
      const animateRobot = (
        robot: Robot,
        t: number,
        activity: number,
        module: ModuleId,
      ) => {
        for (const joint of robot.joints.values()) {
          joint.node.quaternion.copy(joint.q);
          joint.node.position.copy(joint.p);
        }
        robot.root.position.set(0, 0, 0);
        robot.root.rotation.set(0, robot.type === "arm" ? -0.4 : 2.5, 0);
        signal.visible = module === "deployx" && t < 5.5;
        signal.children.slice(0, 3).forEach((arc, i) => {
          arc.visible = t > 0.55 + i * 0.22;
          arc.scale.setScalar(1 + Math.sin(t * 3 - i) * 0.035);
        });
        for (let i = 0; i < packets.length; i++) {
          const p = (t * 0.6 + i / 6) % 1;
          packets[i].visible = t > 1.8 && t < 4.5;
          packets[i].position.set(
            -1.65 + p * 1.65,
            1.23 + Math.sin(p * Math.PI) * 0.32,
            -0.2,
          );
        }
        checkpoint.visible = module === "simcore" && t > 2.7;
        checkpoint.scale.setScalar(1 + Math.sin(t * 2) * 0.08);
        if (module === "embodex") {
          host.dataset.motionProfile = "sketch-materialize";
          robot.root.rotation.y += Math.sin(t * 0.24) * 0.21;
          return;
        }
        let locomotion = activity,
          travel = 0;
        if (module === "deployx") {
          // Program transfer and startup checks precede a single stop–go task, unlike the repeated simulation pass.
          const departure = smooth((t - 5.1) / 3),
            returnToDock = smooth((t - 11) / 2.7);
          travel = departure * (1 - returnToDock);
          locomotion =
            (t > 5.1 && t < 8.1) || (t > 11 && t < 13.7)
              ? Math.sin(Math.PI * (t > 11 ? (t - 11) / 2.7 : (t - 5.1) / 3))
              : 0;
        } else {
          travel = 0.5 - 0.5 * Math.cos((t - 3.2) * 0.8);
          locomotion = activity;
        }
        if (robot.type === "quadruped") {
          const cycle = (module === "deployx" ? t - 5.1 : t) * 4.1;
          for (const [name, offset] of [
            ["FL", 0],
            ["RR", 0],
            ["FR", Math.PI],
            ["RL", Math.PI],
          ] as const) {
            const angle = cycle + offset;
            setJoint(
              robot,
              `${name}_thigh`,
              yAxis,
              Math.sin(angle) * 0.25 * locomotion,
            );
            setJoint(
              robot,
              `${name}_calf`,
              yAxis,
              Math.max(0, Math.cos(angle)) * 0.38 * locomotion,
            );
            setJoint(
              robot,
              `${name}_hip`,
              xAxis,
              Math.sin(angle) * 0.025 * locomotion,
            );
          }
          robot.root.position.y =
            Math.abs(Math.sin(cycle)) * 0.018 * locomotion;
        } else if (robot.type === "mobile") {
          for (const name of ["mobile_drive_left", "mobile_drive_right"])
            setJoint(robot, name, xAxis, -travel * 7.1);
          for (let i = 0; i < 4; i++)
            setJoint(robot, `mobile_caster_${i}`, xAxis, -travel * 15.7);
        } else if (module === "simcore") {
          // Repeated reachability sweeps exercise the joints independently.
          setJoint(
            robot,
            "arm_j1_yaw",
            yAxis,
            Math.sin(t * 0.8) * 0.72 * activity,
          );
          const shoulder = Math.sin(t * 0.8 + 0.5) * 0.3 * activity,
            elbow = Math.sin(t * 0.8 + 1.2) * 0.42 * activity;
          setJoint(robot, "arm_j2_shoulder", zAxis, shoulder);
          setJoint(robot, "arm_j3_elbow", zAxis, elbow);
          setJoint(robot, "arm_j5_wrist", zAxis, -shoulder - elbow);
        } else {
          // A staged pick/place cycle: calibrate, approach, grip, transfer, release and return.
          const cycle = THREE.MathUtils.clamp((t - 5.1) / 8.2, 0, 1);
          const sweep = smooth((cycle - 0.3) / 0.35),
            returning = smooth((cycle - 0.83) / 0.17);
          const yaw = (-0.58 + sweep * 1.16) * (1 - returning) * activity;
          const lower =
            (smooth(cycle / 0.17) -
              smooth((cycle - 0.28) / 0.12) +
              smooth((cycle - 0.62) / 0.1) -
              smooth((cycle - 0.8) / 0.1)) *
            0.22;
          const shoulder = lower,
            elbow = -lower * 0.5;
          setJoint(robot, "arm_j1_yaw", yAxis, yaw);
          setJoint(robot, "arm_j2_shoulder", zAxis, shoulder);
          setJoint(robot, "arm_j3_elbow", zAxis, elbow);
          setJoint(robot, "arm_j5_wrist", zAxis, -shoulder - elbow);
          for (const [name, side] of [
            ["arm_finger_left", -1],
            ["arm_finger_right", 1],
          ] as const) {
            const joint = robot.joints.get(name);
            if (joint)
              joint.node.position.x =
                joint.p.x +
                side *
                  0.021 *
                  (smooth((cycle - 0.2) / 0.07) -
                    smooth((cycle - 0.74) / 0.06));
          }
        }
        if (robot.type !== "arm") {
          robot.root.position.x = -0.8 + travel * 1.6;
          robot.root.position.z =
            module === "simcore" ? Math.sin(travel * Math.PI) * 0.35 : 0.12;
          robot.root.rotation.y = 2.4 + (travel - 0.5) * 0.3;
          if (robot.type === "mobile") {
            const tangent =
              module === "simcore"
                ? (Math.cos(travel * Math.PI) * 0.35 * Math.PI) / 1.6
                : 0;
            robot.root.rotation.y = -Math.PI / 2 - Math.atan(tangent);
          }
        }
        host.dataset.motionProfile =
          module === "simcore"
            ? "repeated-validation"
            : "connect-transfer-calibrate-execute";
        host.dataset.motionValue = (
          robot.type === "arm"
            ? robot.joints.get("arm_j1_yaw")?.node.quaternion.y || 0
            : travel
        ).toFixed(4);
      };
      const render = (now: number) => {
        if (!alive) return;
        frame = requestAnimationFrame(render);
        const delta = previous ? Math.min(now - previous, 80) : 0;
        previous = now;
        if (!visible || document.hidden) return;
        if (jump >= 0) {
          elapsed = [0, 3500, 15500, 27500][jump];
          jump = -1;
        }
        if (!paused && !motion.matches) elapsed += delta;
        let module = options.module,
          chapter = module === "embodex" ? 1 : module === "simcore" ? 2 : 3,
          index = 0,
          t = 0;
        if (options.journey) {
          const loop = elapsed % 39500;
          chapter = loop < 3500 ? 0 : loop < 15500 ? 1 : loop < 27500 ? 2 : 3;
          module =
            chapter < 2 ? "embodex" : chapter === 2 ? "simcore" : "deployx";
          const local =
            chapter === 0 ? loop : loop - [0, 3500, 15500, 27500][chapter];
          const segment = chapter === 0 ? 3500 : 4000;
          index =
            chapter === 0 ? 0 : Math.floor(local / segment) % robots.length;
          t = ((local % segment) / 1000) * (chapter === 0 ? 1 : 3.6);
        } else {
          index =
            (Math.floor(elapsed / 14400) +
              (module === "simcore" ? 1 : module === "deployx" ? 2 : 0)) %
            robots.length;
          t = (elapsed % 14400) / 1000;
        }
        if (motion.matches && !options.journey) t = 7.5;
        const robot = robots[index];
        if (currentRobot !== index || currentModule !== module) {
          robots.forEach((item) => {
            item.root.visible = false;
          });
          robot.root.visible = true;
          if (environment) scene.remove(environment);
          environment = buildEnvironment(module, robot.type);
          environment.scale.setScalar(
            options.journey && module !== "embodex" ? 0.82 : 1,
          );
          scene.add(environment);
          currentRobot = index;
          currentModule = module;
        }
        robot.root.visible = chapter > 0;
        if (robot.payload) robot.payload.visible = module === "deployx";
        if (environment) environment.visible = chapter > 0;
        const build =
          chapter === 0
            ? 0
            : module === "embodex"
              ? smooth((t - 1.2) / 3.9)
              : 1;
        robot.body.visible = build > 0.005;
        robot.outline.visible = module === "embodex" && build < 0.999;
        robot.plane.constant =
          module === "embodex" ? -0.03 + build * (robot.height + 0.12) : 10;
        robot.lines.opacity = (1 - build) * 0.83;
        for (const line of robot.outline.children) {
          if (line instanceof THREE.LineSegments) {
            const count = line.geometry.attributes.position.count;
            line.geometry.setDrawRange(
              0,
              Math.floor(
                (count * smooth((chapter === 0 ? t + 0.8 : t) / 1.5)) / 2,
              ) * 2,
            );
          }
        }
        const activity =
          module === "simcore"
            ? smooth((t - 2.4) / 1.3)
            : module === "deployx"
              ? smooth((t - 4.3) / 0.8)
              : 0;
        animateRobot(robot, t, activity, module);
        for (const prop of props) {
          const start = propStart.get(prop)!;
          const amount =
            module === "simcore" ? smooth(t / 1.4 - start.index * 0.1) : 1;
          prop.visible = amount > 0.005;
          prop.scale.setScalar(Math.max(0.001, amount));
          prop.position.y = start.y - (1 - amount) * 0.45;
        }
        const modelFade = options.journey ? 1 : 1 - smooth((t - 13.8) / 0.55);
        for (const material of robot.materials) {
          material.opacity = modelFade;
          const transparent = modelFade < 0.999;
          if (material.transparent !== transparent) {
            material.transparent = transparent;
            material.needsUpdate = true;
          }
        }
        palette.light.emissiveIntensity =
          module === "deployx" ? (t > 1.7 ? 1.4 : 0.1) : 0.45;
        const distance = module === "embodex" ? 4.8 : 5.85,
          angle =
            (module === "embodex" ? 0.42 : 0.34) +
            Math.sin(elapsed / 18000) * 0.055;
        const fit = options.journey
          ? Math.max(1, 1.18 / camera.aspect)
          : camera.aspect < 1
            ? 1.12
            : 1;
        camera.position.set(
          Math.sin(angle) * distance * fit,
          module === "embodex" ? 2.1 : 2.95,
          Math.cos(angle) * distance * fit,
        );
        camera.lookAt(
          0,
          module === "embodex" ? robot.height * 0.43 : 0.65,
          -0.2,
        );
        const stage =
          chapter === 0
            ? "输入需求"
            : module === "embodex"
              ? t < 1.5
                ? "轮廓草图"
                : t < 5.1
                  ? "结构成型"
                  : "材质与细节"
              : module === "simcore"
                ? t < 2.7
                  ? "场景构建"
                  : "运动仿真"
                : t < 1.8
                  ? "设备连接"
                  : t < 3.5
                    ? "程序下发"
                    : t < 5.1
                      ? "启动自检"
                      : "执行任务";
        const signature = `${chapter}:${index}:${stage}:${chapter === 0 ? Math.floor(t * 12) : ""}`;
        if (signature !== lastPhase) {
          lastPhase = signature;
          options.onPhase({
            chapter,
            stage,
            machine: robot.type,
            progress: options.journey && chapter === 0 ? t / 3.5 : t / 14.4,
          });
        }
        host.dataset.animationStage = stage;
        host.dataset.robotType = robot.type;
        renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(render);
    },
  );
  return {
    dispose,
    ready,
    pause(value: boolean) {
      paused = value;
    },
    jump(chapter: number) {
      jump = chapter;
    },
  };
}
