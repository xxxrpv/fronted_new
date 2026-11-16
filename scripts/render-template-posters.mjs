/** Renders source GLBs into transparent catalog posters, without altering existing images. */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const root = process.cwd(),
  out = resolve(root, "public/v8-assets/catalog");
await mkdir(out, { recursive: true });
const assets = [
  "go2-high-fidelity",
  "inspection-reference",
  "mobile-reference",
];
const html = `<!doctype html><style>html,body{margin:0;background:transparent}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/build/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script><script type="module">
import * as T from 'three';import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';import{HDRLoader}from'three/addons/loaders/HDRLoader.js';
const renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setSize(1000,760);renderer.setPixelRatio(1);renderer.setClearColor(0,0);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;document.body.appendChild(renderer.domElement);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1000/760,.01,50);camera.position.set(.6,1.8,4.6);camera.lookAt(0,.65,0);const hdr=await new HDRLoader().loadAsync('/assets/cinematic/studio_small_09_1k.hdr');hdr.mapping=T.EquirectangularReflectionMapping;scene.environment=hdr;scene.environmentIntensity=.48;scene.environmentRotation.y=.65;scene.add(new T.HemisphereLight(0xe9f2ff,0x8b8e91,.3));
const key=new T.DirectionalLight(0xfff6ed,2.15);key.position.set(-3,7,5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:20});key.shadow.radius=5;key.shadow.normalBias=.006;key.shadow.bias=-.0002;key.shadow.intensity=.55;scene.add(key);const fill=new T.DirectionalLight(0xd9e9fc,.4);fill.position.set(4,3,-2);scene.add(fill);
const floor=new T.Mesh(new T.PlaneGeometry(30,30),new T.ShadowMaterial({opacity:.12}));floor.rotation.x=-Math.PI/2;floor.position.y=-.006;floor.receiveShadow=true;scene.add(floor);
let model;window.renderAsset=async(asset)=>{if(model)scene.remove(model);const result=await new GLTFLoader().loadAsync('/assets/'+asset+'.glb');model=result.scene;const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());const scale=2.55/Math.max(size.x,size.y,size.z);model.scale.setScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);const root=new T.Group();root.add(model);root.rotation.y=2.35;scene.add(root);model=root;model.traverse(n=>{if(!n.isMesh)return;n.castShadow=true;n.receiveShadow=true;for(const m of Array.isArray(n.material)?n.material:[n.material])if(m.isMeshStandardMaterial){m.envMapIntensity=.8;if(m.color.r>.65&&m.color.g>.65&&m.color.b>.65){m.roughness=Math.max(.5,m.roughness);m.metalness=Math.min(.08,m.metalness);}}});camera.lookAt(0,size.y*scale*.43,0);renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');};window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    const vendor = req.url?.startsWith("/vendor/"),
      base = resolve(root, vendor ? "node_modules/three" : "public/v8-assets"),
      relative = decodeURIComponent(
        (req.url || "").replace(vendor ? "/vendor/" : "/assets/", ""),
      ),
      path = resolve(base, relative);
    if (!path.startsWith(base + sep)) throw Error();
    res.setHeader(
      "Content-Type",
      vendor ? "application/javascript" : "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
const manifest = [];
try {
  browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 760 },
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() => window.ready);
  for (const asset of assets) {
    const data = await page.evaluate(
      (asset) => window.renderAsset(asset),
      asset,
    );
    const bytes = Buffer.from(data.split(",")[1], "base64");
    await writeFile(resolve(out, asset + ".png"), bytes);
    const source = await readFile(
      resolve(root, "public/v8-assets", asset + ".glb"),
    );
    manifest.push({
      asset,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      posterSha256: createHash("sha256").update(bytes).digest("hex"),
      width: 1000,
      height: 760,
      transparent: true,
      bytes: bytes.length,
    });
    console.log(asset, bytes.length);
  }
  await writeFile(
    resolve(out, "provenance.json"),
    JSON.stringify(manifest, null, 2),
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
