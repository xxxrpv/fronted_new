// Isolated asset validation/rendering; never uses a user's browser profile.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "test-results/showcase-arm");
await mkdir(out, { recursive: true });
const bytes = await readFile(
  resolve(root, "public/v8-assets/cinematic/industrial-arm.glb"),
);
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const doc = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
const required = [
  "arm_j1_yaw",
  "arm_j2_shoulder",
  "arm_j3_elbow",
  "arm_j4_roll",
  "arm_j5_wrist",
  "arm_j6_tool",
  "arm_finger_left",
  "arm_finger_right",
  "arm_tool_center_point",
];
required.forEach((name) =>
  assert(
    doc.nodes.some((n) => n.name === name),
    name,
  ),
);
for (const view of doc.bufferViews)
  assert(view.byteOffset + view.byteLength <= doc.buffers[0].byteLength);
const html = `<!doctype html><style>html,body{margin:0;background:#e9ede8}canvas{display:block}#tag{position:absolute;left:34px;top:30px;font:14px system-ui;color:#607265}</style><div id="tag">Articulated robot · visual concept</div><script type="importmap">{"imports":{"three":"/vendor/build/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script><script type="module">
import * as T from 'three';import {GLTFLoader}from'three/addons/loaders/GLTFLoader.js';import{RoomEnvironment}from'three/addons/environments/RoomEnvironment.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#e9ede8');const camera=new T.PerspectiveCamera(32,innerWidth/innerHeight,.01,50);camera.position.set(2.25,1.45,2.55);camera.lookAt(.37,.57,0);const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();scene.add(new T.HemisphereLight(0xffffff,0x566053,1.5));const sun=new T.DirectionalLight(0xfff5e5,3.1);sun.position.set(-2,4,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-2;sun.shadow.camera.right=2;sun.shadow.camera.top=2;sun.shadow.camera.bottom=-2;sun.shadow.normalBias=.015;sun.shadow.bias=-.00015;scene.add(sun);
const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xe0e5de,roughness:.85}));floor.rotation.x=-Math.PI/2;floor.position.y=-.001;floor.receiveShadow=true;scene.add(floor);
const result=await new GLTFLoader().loadAsync('/arm.glb');const model=result.scene;scene.add(model);model.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}});window.arm=model;window.render=()=>renderer.render(scene,camera);window.render();window.ready=true;
window.pose=()=>{model.getObjectByName('arm_j1_yaw').rotation.y=-.55;model.getObjectByName('arm_j2_shoulder').rotation.z=-.15;model.getObjectByName('arm_j3_elbow').rotation.z=-1.65;model.getObjectByName('arm_j5_wrist').rotation.z=-Math.PI+.15+1.65;model.getObjectByName('arm_finger_left').position.x=-.02;model.getObjectByName('arm_finger_right').position.x=.02;model.updateMatrixWorld(true);window.render();return model.getObjectByName('arm_tool_center_point').getWorldPosition(new T.Vector3()).toArray()};
</script>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    if (req.url === "/arm.glb") {
      res.setHeader("Content-Type", "model/gltf-binary");
      res.end(bytes);
      return;
    }
    const base = resolve(root, "node_modules/three"),
      requested = resolve(
        base,
        decodeURIComponent((req.url || "").replace(/^\/vendor\//, "")),
      );
    if (!req.url?.startsWith("/vendor/") || !requested.startsWith(base + sep)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/javascript");
    res.end(await readFile(requested));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
const errors = [];
try {
  browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() => window.ready, {}, { timeout: 30000 });
  await page.screenshot({ path: resolve(out, "home.png") });
  const home = await page.evaluate(() => {
    const n = window.arm.getObjectByName("arm_tool_center_point");
    const v = n.position.clone();
    return n.getWorldPosition(v).toArray();
  });
  const pose = await page.evaluate(() => window.pose());
  await page.screenshot({ path: resolve(out, "articulated.png") });
  assert(
    Math.hypot(...pose.map((n, i) => n - home[i])) > 0.1,
    "Articulation must move tool",
  );
  assert.equal(errors.length, 0);
  const report = {
    validGlb: true,
    bytes: bytes.length,
    nodes: doc.nodes.length,
    meshes: doc.meshes.length,
    requiredNodes: required,
    homeTool: home,
    articulatedTool: pose,
    errors,
  };
  await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
