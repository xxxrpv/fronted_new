"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { validateGlbSecurity } from "../../lib/equipment/glb-security";
import {
  applyModelPose,
  captureModelPose,
  adoptConfiguredPoseBaseline,
  findAssembly,
  computePerspectiveFrame,
  setPartWorldPreviewOffset,
  type ModelPose,
} from "./model-explode";
import styles from "./ModelViewer.module.css";
import { PerceptionPreview } from './perception-preview';
import { SensorRenderer } from './reference-sensor-renderer.js';

export interface ViewerCommandReceipt {
  ok: boolean;
  message: string;
  partId?: string;
  before?: number[];
  after?: number[];
}
export type ViewerFovKind = "lidar" | "vision" | "thermal";
export type ViewerSensorView = "external" | "rgb" | "thermal" | "depth" | "pointcloud";
export interface ViewerUiState {
  mode: "whole" | "exploded" | "perception";
  separation: number;
  xray: boolean;
  dimensions: boolean;
  fov: Record<ViewerFovKind, boolean>;
  availableFov: Record<ViewerFovKind, boolean>;
  sensorView: ViewerSensorView;
  availableSensorViews: ViewerSensorView[];
  comparison?: boolean;
}
export interface ModelViewerController {
  readonly assetUrl: string;
  getParts(): {
    id: string;
    label: string;
    category?: string;
    sourceMesh?: string;
    offsetMax?: number;
    parentId?: string;
  }[];
  setMode(mode: "whole" | "exploded" | "perception"): ViewerCommandReceipt;
  setSeparation(level: number): ViewerCommandReceipt;
  focusPart(query: string): ViewerCommandReceipt;
  resetView(): ViewerCommandReceipt;
  setView(view: "front" | "side" | "top" | "iso"): ViewerCommandReceipt;
  zoom(factor: number): ViewerCommandReceipt;
  /** World-space metres, converted to the real parent's local frame before capability checks. */
  setPartOffset(
    partId: string,
    deltaXYZ: readonly [number, number, number],
  ): ViewerCommandReceipt;
  getUiState?(): ViewerUiState;
  setXray?(enabled: boolean): ViewerCommandReceipt;
  setFov?(kind: ViewerFovKind, enabled: boolean): ViewerCommandReceipt;
  setDimensions?(enabled: boolean): ViewerCommandReceipt;
  toggleExploded?(): ViewerCommandReceipt;
  clearSelection?(): ViewerCommandReceipt;
  setSensorView?(view: ViewerSensorView): ViewerCommandReceipt;
  setSensorComparison?(enabled:boolean):ViewerCommandReceipt;
}

export interface ModelPartDetails {
  id: string;
  label: string;
  mesh: string;
  body: string;
  joint: string;
  /** Current world-axis mesh bounds in metres; an appearance envelope, not manufacturing dimensions. */
  size: [number, number, number];
  triangles: number;
  category?: string;
  viewOffsetMax?: number;
  sourceKind?: string;
}

export interface ModelViewerProps {
  url: string;
  expectedSha256?: string;
  label: string;
  onPartSelect?: (part: string) => void;
  /** Temporary fixture sensor view offset, in metres. Does not change the asset. */
  visualOffset?: number;
  compact?: boolean;
  onControllerReady?: (controller: ModelViewerController | null) => void;
  inspectorPlacement?: "overlay" | "external";
  onPartDetailsChange?: (details: ModelPartDetails | null) => void;
  onViewStateChange?: (state: ViewerUiState | null) => void;
}

type ViewerControl = {
  reset: () => void;
  zoom: (factor: number) => void;
  rotate: (angle: number) => void;
  fit: () => void;
  selectAssembly: (id: string) => void;
  inspect: (mode: "whole" | "perception" | "part", partId?: string) => void;
};

function ViewerIcon({ name }: { name: 'whole' | 'explode' | 'sense' | 'iso' | 'side' | 'top' | 'parts' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'whole' && <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>}
    {name === 'explode' && <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>}
    {name === 'sense' && <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></>}
    {name === 'iso' && <><path d="M4 9a8 8 0 1 1 0 6"/><path d="M4 4v5h5"/></>}
    {name === 'side' && <><path d="M5 5h14v14H5zM9 5v14"/><path d="m12 9 4 3-4 3"/></>}
    {name === 'top' && <><path d="m12 4 8 5-8 5-8-5 8-5ZM4 14l8 5 8-5"/><path d="M12 4v10"/></>}
    {name === 'parts' && <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>}
  </svg>;
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material)
      ? child.material
      : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export default function ModelViewer({
  url,
  expectedSha256,
  label,
  onPartSelect,
  visualOffset = 0,
  compact = false,
  onControllerReady,
  inspectorPlacement = "overlay",
  onPartDetailsChange,
  onViewStateChange,
}: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const poseRef = useRef<ModelPose | null>(null);
  const controlsRef = useRef<ViewerControl | null>(null);
  const onPartRef = useRef(onPartSelect);
  const onControllerRef = useRef(onControllerReady);
  const commandControllerRef = useRef<ModelViewerController | null>(null);
  const onDetailsRef = useRef(onPartDetailsChange);
  const onViewStateRef = useRef(onViewStateChange);
  const [viewerUi,setViewerUi] = useState<ViewerUiState | null>(null);
  const offsetRef = useRef(visualOffset);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState("");
  const [selectedAssembly, setSelectedAssembly] = useState("");
  const [partsOpen, setPartsOpen] = useState(false);
  const [assemblies, setAssemblies] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [separation, setSeparation] = useState(0);
  const [inspection, setInspection] = useState<"whole" | "perception" | "part">(
    "whole",
  );
  const [hasPerception, setHasPerception] = useState(false);
  const [sourceKind, setSourceKind] = useState("");
  const inspectionRef = useRef(inspection);
  const [partDetails, setPartDetails] = useState<ModelPartDetails | null>(null);
  const separationRef = useRef(separation);
  onPartRef.current = onPartSelect;
  onControllerRef.current = onControllerReady;
  onDetailsRef.current = onPartDetailsChange;
  onViewStateRef.current = onViewStateChange;
  offsetRef.current = visualOffset;
  separationRef.current = separation;
  inspectionRef.current = inspection;

  useEffect(() => {
    if (poseRef.current)
      applyModelPose(poseRef.current, separation, visualOffset);
    if (hostRef.current)
      hostRef.current.dataset.explodeLevel = String(separation);
  }, [visualOffset, separation]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let model: THREE.Object3D | null = null;
    let modelSourceKind = '';
    let selectedObject: THREE.Object3D | null = null;
    let selectionOutline: THREE.BoxHelper | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let perception: PerceptionPreview | null = null;
    let lastSeparation=.65;
    const ui:ViewerUiState={mode:'whole',separation:0,xray:false,dimensions:false,fov:{lidar:true,vision:false,thermal:false},availableFov:{lidar:false,vision:false,thermal:false},sensorView:'external',availableSensorViews:['external']};
    const publishUi=()=>{if(disposed)return;const snapshot={...ui,fov:{...ui.fov},availableFov:{...ui.availableFov},availableSensorViews:[...ui.availableSensorViews]};setViewerUi(snapshot);onViewStateRef.current?.(snapshot);host.dataset.workspaceMode=ui.mode;host.dataset.xray=String(ui.mode==='exploded'&&ui.xray);host.dataset.dimensions=String(ui.dimensions);host.dataset.fov=JSON.stringify(ui.mode==='perception'?ui.fov:{lidar:false,vision:false,thermal:false});host.dataset.sensorView=ui.sensorView;};
    const controller = new AbortController();
    setLoad("loading");
    setError("");
    setSelected("");
    setSelectedAssembly("");
    setPartsOpen(false);
    setAssemblies([]);
    setSeparation(0);
    setInspection("whole");
    setHasPerception(false);
    setSourceKind("");
    setPartDetails(null);
    onDetailsRef.current?.(null);
    onViewStateRef.current?.(null);
    setViewerUi(null);
    separationRef.current = 0;
    host.dataset.modelLoaded = "false";
    host.dataset.modelSha256 = "";
    host.dataset.expectedSha256 = expectedSha256 || "";
    host.dataset.configuredParameters = "";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#edf4fa");
    scene.environmentIntensity = 0.65;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const hemi = new THREE.HemisphereLight("#ffffff", "#9caebd", 0.75);
    const key = new THREE.DirectionalLight("#fffaf4", 2.4);
    key.position.set(-2, 5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.002;
    const fill = new THREE.DirectionalLight("#c5ddff", 0.65);
    fill.position.set(4, 2, -3);
    scene.add(hemi, key, fill, key.target);

    try {
      renderer = new THREE.WebGLRenderer({
        canvas: document.createElement('canvas'),
        preserveDrawingBuffer: host.ownerDocument !== document,
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch {
      setLoad("error");
      setError("浏览器无法启用 WebGL。可开启硬件加速后重试，或下载原始模型。");
      return () => controller.abort();
    }
    const activeRenderer = renderer;
    // The script-disabled report cannot composite its canvas reliably. Present
    // the same WebGL frames as a native media stream, with no image encoding.
    const crossDocument=host.ownerDocument!==document;
    const displayCanvas=crossDocument?host.ownerDocument.createElement('canvas'):activeRenderer.domElement;
    const presentation=crossDocument?displayCanvas.getContext('2d',{alpha:false}):null;
    let presentationImage:HTMLImageElement|null=null;
    let presentationVideo:HTMLVideoElement|null=null;
    let presentationStream:MediaStream|null=null;
    let streamTrack:CanvasCaptureMediaStreamTrack|null=null;
    const inputElement:HTMLElement=crossDocument?host:displayCanvas;
    if(crossDocument)displayCanvas.style.pointerEvents='none';
    let lastPresentationTime=0;
    let lastPresentationSignature='';
    let presentationPending=false;
    let presentationGeneration=0;
    const frameStyle='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;';
    const markStreamReady=()=>{
      if(disposed || !model || !presentationVideo || presentationVideo.readyState<2)return;
      if(presentationVideo.videoWidth!==activeRenderer.domElement.width || presentationVideo.videoHeight!==activeRenderer.domElement.height)return;
      presentationVideo.style.visibility='visible';host.dataset.presentationReady='true';
    };
    const stopStream=()=>{
      streamTrack?.removeEventListener('ended',imageFallback);
      presentationStream?.getTracks().forEach(track=>track.stop());presentationStream=null;streamTrack=null;
      if(presentationVideo){presentationVideo.pause();presentationVideo.srcObject=null;presentationVideo.remove();presentationVideo=null;}
    };
    const imageFallback=()=>{
      if(disposed || presentationImage)return;
      stopStream();
      presentationImage=host.ownerDocument.createElement('img');presentationImage.alt='';
      presentationImage.setAttribute('aria-hidden','true');presentationImage.dataset.liveWebglFrame='true';
      presentationImage.decoding='async';presentationImage.style.cssText=frameStyle;host.appendChild(presentationImage);
      host.dataset.rendererPresentation='live-webgl-image-fallback';lastPresentationSignature='';host.dataset.presentationReady='false';
    };
    host.dataset.rendererPresentation=crossDocument?'live-webgl-stream-v1':'direct-webgl-v3';
    host.dataset.canvasDocument=host.ownerDocument===document?'parent':'child';
    host.dataset.preserveDrawingBuffer=String(activeRenderer.getContext().getContextAttributes()?.preserveDrawingBuffer);
    activeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    activeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    activeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    activeRenderer.toneMappingExposure = 0.85;
    activeRenderer.shadowMap.enabled = true;
    activeRenderer.shadowMap.type = THREE.PCFShadowMap;
    if(crossDocument)activeRenderer.shadowMap.autoUpdate=false;
    displayCanvas.setAttribute('aria-hidden','true');
    if(crossDocument)displayCanvas.dataset.liveWebglPresentation='true';
    host.appendChild(displayCanvas);
    if(crossDocument){
      try{
        presentationStream=activeRenderer.domElement.captureStream(0);
        streamTrack=presentationStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        if(typeof streamTrack?.requestFrame!=='function')throw Error('Manual canvas capture unavailable');
        streamTrack.addEventListener('ended',imageFallback);
        presentationVideo=host.ownerDocument.createElement('video');
        presentationVideo.muted=true;presentationVideo.autoplay=true;presentationVideo.playsInline=true;
        presentationVideo.setAttribute('aria-hidden','true');presentationVideo.dataset.liveWebglFrame='true';
        presentationVideo.style.cssText=frameStyle;presentationVideo.srcObject=presentationStream;
        presentationVideo.addEventListener('loadeddata',markStreamReady);
        presentationVideo.addEventListener('resize',markStreamReady);
        presentationVideo.addEventListener('error',imageFallback);
        host.appendChild(presentationVideo);
        void presentationVideo.play().catch(imageFallback);
      }catch{imageFallback();}
    }
    const pmrem = new THREE.PMREMGenerator(activeRenderer);
    const environmentScene = new RoomEnvironment();
    const environment = pmrem.fromScene(environmentScene, 0.035);
    scene.environment = environment.texture;
    disposeObject(environmentScene);
    pmrem.dispose();
    const sensorRenderer=new SensorRenderer(activeRenderer,{getTemperature:object=>{for(let node:THREE.Object3D|null=object;node;node=node.parent)if(typeof node.userData.temperature==='number')return node.userData.temperature;return 20;}});

    const grid = new THREE.GridHelper(12, 48, "#c1d3e3", "#dce7f0");
    for (const material of Array.isArray(grid.material)
      ? grid.material
      : [grid.material]) {
      material.transparent = true;
      material.opacity = 0.42;
    }
    grid.position.y = -0.018;
    scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ color: "#344b62", opacity: 0.26 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    scene.add(floor);
    const dimensionBox=new THREE.Box3Helper(new THREE.Box3(),0x7196b7);dimensionBox.visible=false;scene.add(dimensionBox);
    dimensionBox.userData.sensorOverlay=true;
    const controls = new OrbitControls(camera, inputElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.maxPolarAngle = Math.PI / 2 + 0.03;
    controls.minDistance = 0.3;
    controls.maxDistance = 30;
    controls.enablePan = true;
    let homePosition = new THREE.Vector3(3, 2.5, 4);
    let homeTarget = new THREE.Vector3(0, 0.7, 0);
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
    let lastRenderedSignature = "";
    let renderedFrames = 0;
    let lastShadowSignature="";
    let shadowUpdates=0;
    let cameraRevision = 0;
    const cameraChanged = () => { cameraRevision++; };
    controls.addEventListener('change', cameraChanged);
    const updateView = (updateControls = true) => {
      if (activeRenderer.domElement.width < 2 || activeRenderer.domElement.height < 2) return;
      if (updateControls) controls.update();
      const renderSignature = [model?.uuid, cameraRevision, camera.projectionMatrix.elements, JSON.stringify(ui), separationRef.current, inspectionRef.current, selectedObject?.uuid, offsetRef.current, host.dataset.partWorldAfter, activeRenderer.domElement.width, activeRenderer.domElement.height].join('|');
      // Keep damping and input responsive, without redrawing an unchanged heavy mesh.
      const renderChanged = renderSignature !== lastRenderedSignature;
      markStreamReady();
      if (!renderChanged && (!presentationImage || (host.dataset.presentationReady === 'true' && lastPresentationSignature === renderSignature))) return;
      if (renderChanged) {
        lastRenderedSignature = renderSignature;
        selectionOutline?.update();
        if(model && ui.dimensions){model.updateMatrixWorld(true);dimensionBox.box.setFromObject(model);}
        dimensionBox.visible=ui.dimensions;
        perception?.update(ui.mode==='perception',ui.fov);
        host.dataset.fovVisibleCount=String(perception?.visibleCount()||0);
        host.dataset.cameraPosition=camera.position.toArray().join(',');
        host.dataset.cameraAspect=String(camera.aspect);
        host.dataset.rendererBufferSize=`${activeRenderer.domElement.width},${activeRenderer.domElement.height}`;
        if(crossDocument){
          const shadowSignature=[model?.uuid,separationRef.current,offsetRef.current,host.dataset.partWorldAfter,inspectionRef.current,selectedObject?.uuid,ui.mode,ui.xray,ui.sensorView].join('|');
          if(lastShadowSignature!==shadowSignature){lastShadowSignature=shadowSignature;activeRenderer.shadowMap.needsUpdate=true;host.dataset.shadowUpdates=String(++shadowUpdates);}
        }
        if(ui.mode==='perception'&&ui.sensorView!=='external')sensorRenderer.render(scene,camera,{mode:ui.sensorView,comparison:Boolean(ui.comparison)});
        else activeRenderer.render(scene, camera);
        host.dataset.renderedFrames = String(++renderedFrames);
        if(streamTrack){streamTrack.requestFrame();lastPresentationSignature=renderSignature;}
        // Compatibility fallback only; normal report playback stays on the media path.
        else if(presentation)presentation.drawImage(activeRenderer.domElement,0,0);
      }
      // A pending image decode may finish after the final input event. Publish
      // that final rendered frame even when no further GPU redraw is needed.
      if(presentationImage && model && !presentationPending && performance.now()-lastPresentationTime>66){
        const signature=renderSignature;
        const image= presentationImage;
        if(signature!==lastPresentationSignature){
          const generation=presentationGeneration;
          const width=activeRenderer.domElement.width,height=activeRenderer.domElement.height;
          const snapshot=activeRenderer.domElement.toDataURL('image/png');
          const decoded=document.createElement('img');
          presentationPending=true; decoded.src=snapshot;
          void decoded.decode().then(()=>{
            if(disposed || generation!==presentationGeneration || decoded.naturalWidth!==width || decoded.naturalHeight!==height) return;
            image.width=width;image.height=height;
            image.src=snapshot;
            lastPresentationSignature=signature;lastPresentationTime=performance.now();
            return image.decode().then(()=>{
              if(disposed || generation!==presentationGeneration) return;
              image.style.visibility='visible';
              host.dataset.presentationReady='true';
            }).catch(()=>{});
          }).catch(()=>{}).finally(()=>{presentationPending=false;});
        }
      }
    };
    const fit = () => {
      if (!model) return;
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(
        inspectionRef.current === "part" && selectedObject
          ? selectedObject
          : model,
      );
      const dimensions = bounds.getSize(new THREE.Vector3());
      const span = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.1);
      const direction = camera.position.clone().sub(controls.target);
      const framing = computePerspectiveFrame(
        { min: bounds.min.toArray(), max: bounds.max.toArray() },
        direction.toArray(),
        camera.fov,
        camera.aspect,
      );
      homeTarget = new THREE.Vector3(...framing.target);
      homePosition = new THREE.Vector3(...framing.position);
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      controls.minDistance = span * 0.45;
      controls.maxDistance = span * 8;
      updateView();
    };
    const inspect = (
      mode: "whole" | "perception" | "part",
      partId?: string,
    ) => {
      if (!model) return;
      setInspection(mode);
      inspectionRef.current = mode;
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const assembly = findAssembly(node);
        const focused =
          mode !== "part" || (()=>{for(let cursor:THREE.Object3D|null=node;cursor;cursor=cursor.parent)if(cursor.userData.assemblyId===partId)return true;return false;})();
        const category=String(assembly?.userData.category || assembly?.userData.assemblyId);
        const industrialXray=ui.mode==='exploded'&&ui.xray&&modelSourceKind==='supplied-concept-reference';
        const transparentShell=ui.mode==='exploded'&&ui.xray&&['housing','body','shell','cover'].includes(category);
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          const baseOpacity=typeof material.userData.v8BaseOpacity==='number'?material.userData.v8BaseOpacity:1;
          material.transparent = !focused || transparentShell || industrialXray || Boolean(material.userData.v8BaseTransparent);
          material.opacity = !focused ? .10 : industrialXray ? (['electrical','electronics','perception'].includes(category)?.9:.24) : transparentShell ? .18 : baseOpacity;
          material.depthWrite = focused && !transparentShell && !industrialXray && material.userData.v8BaseDepthWrite!==false;
          material.needsUpdate = true;
        }
        node.castShadow = focused;
      });
      host.dataset.inspectionMode = mode;
      fit();
    };
    const selectObject = (node: THREE.Object3D, part: string) => {
      const assembly = findAssembly(node);
      const target = assembly || node;
      selectedObject = target;
      if (selectionOutline) {
        scene.remove(selectionOutline);
        selectionOutline.geometry.dispose();
        selectionOutline.material.dispose();
      }
      selectionOutline = new THREE.BoxHelper(target, "#2477e0");
      scene.add(selectionOutline);
      setSelected(
        String(
          assembly?.userData.assemblyLabel ||
            (part === "sensor" ? "传感器组件" : node.name || "已选部件"),
        ),
      );
      setSelectedAssembly(String(assembly?.userData.assemblyId || ""));
      const box = new THREE.Box3().setFromObject(target);
      let triangles = 0;
      target.traverse((child) => {
        if (child instanceof THREE.Mesh)
          triangles +=
            (child.geometry.index?.count ||
              child.geometry.attributes.position.count) / 3;
      });
      let ancestor: THREE.Object3D | null = target;
      while (ancestor && !ancestor.userData.sourceJoint)
        ancestor = ancestor.parent;
      const details: ModelPartDetails = {
        id: String(assembly?.userData.assemblyId || part),
        label: String(assembly?.userData.assemblyLabel || node.name),
        mesh: String(
          assembly?.userData.sourceMesh || node.userData.sourceMesh || "",
        ),
        body: String(
          assembly?.userData.sourceBody || node.userData.sourceBody || "",
        ),
        joint: String(ancestor?.userData.sourceJoint || ""),
        size: box.getSize(new THREE.Vector3()).toArray(),
        triangles,
        category: typeof assembly?.userData.category === 'string' ? assembly.userData.category : undefined,
        viewOffsetMax: assembly?.userData.viewOffsetSupported === true ? assembly.userData.viewOffsetMax : undefined,
        sourceKind: String(assembly?.userData.sourceKind || modelSourceKind),
      };
      setPartDetails(details);
      onDetailsRef.current?.(details);
      if (inspectionRef.current === "part" && assembly)
        inspect("part", String(assembly.userData.assemblyId));
      onPartRef.current?.(part);
    };
    controlsRef.current = {
      reset: () => {
        camera.position.copy(homePosition);
        controls.target.copy(homeTarget);
        updateView();
      },
      zoom: (factor) => {
        camera.position
          .sub(controls.target)
          .multiplyScalar(factor)
          .add(controls.target);
        updateView();
      },
      rotate: (angle) => {
        const direction = camera.position.clone().sub(controls.target);
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        camera.position.copy(controls.target).add(direction);
        updateView();
      },
      fit,
      inspect,
      selectAssembly: (id) => {
        const assembly = poseRef.current?.assemblies.find(
          (entry) => entry.id === id,
        );
        if (assembly) selectObject(assembly.node, assembly.id);
      },
    };
    const resize = () => {
      if (disposed) return;
      const width = host.clientWidth,
        height = host.clientHeight;
      // A report can briefly have no layout while its styles and chapter hosts
      // mount. Never publish that one-pixel projection as a stretched live frame.
      if (width < 2 || height < 2) return;
      if(activeRenderer.domElement.width===Math.round(width*activeRenderer.getPixelRatio()) && activeRenderer.domElement.height===Math.round(height*activeRenderer.getPixelRatio()) && Math.abs(camera.aspect-width/height)<0.00001) return;
      presentationGeneration++;
      if(presentationVideo || presentationImage){host.dataset.presentationReady='false';lastPresentationSignature='';}
      activeRenderer.setSize(width, height);
      if(presentation){displayCanvas.width=activeRenderer.domElement.width;displayCanvas.height=activeRenderer.domElement.height;displayCanvas.style.width=`${width}px`;displayCanvas.style.height=`${height}px`;}
      sensorRenderer.resize(width,height,activeRenderer.getPixelRatio());
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (model) fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let inViewport = true;
    const visibilityObserver = new IntersectionObserver(([entry]) => { inViewport = entry.isIntersecting; });
    visibilityObserver.observe(host);
    let lastInlineRender=0;
    const render = () => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      if (inViewport && document.visibilityState === "visible") {
        controls.update();
        if (!presentationImage || performance.now()-lastInlineRender>=66) {lastInlineRender=performance.now();updateView(false);}
      }
    };
    render();
    const contextLost = (event: Event) => {
      event.preventDefault();
      if (disposed) return;
      cancelAnimationFrame(frame);
      setLoad("error");
      setError("三维显示连接已中断。当前设计与文件仍保留，请重新加载视图。");
    };
    activeRenderer.domElement.addEventListener("webglcontextlost", contextLost);

    let pointerStart: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const pointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      if (
        !model ||
        !pointerStart ||
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) > 6
      )
        return;
      const rect = inputElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster
        .intersectObject(model, true)
        .find((result) => result.object instanceof THREE.Mesh);
      if (!hit) return;
      const part = String(
        hit.object.userData.part || hit.object.name || "body",
      );
      selectObject(hit.object, part);
    };
    inputElement.addEventListener("pointerdown", pointerDown);
    inputElement.addEventListener("pointerup", pointerUp);

    const fail = (reason: unknown) => {
      if (disposed || controller.signal.aborted) return;
      setLoad("error");
      setError(
        reason instanceof Error ? reason.message : "模型读取失败，请重试。",
      );
    };
    void (async () => {
      const resolved = new URL(url, window.location.origin);
      if (
        resolved.origin !== window.location.origin ||
        !["http:", "https:"].includes(resolved.protocol)
      )
        throw new Error("当前模型地址未通过同源授权检查，已停止加载。");
      const response = await fetch(resolved, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "当前账户没有读取此模型的权限。"
            : response.status === 401
              ? "会话已失效，请重新登录后读取模型。"
              : `模型读取失败（${response.status}），请刷新文件状态后重试。`,
        );
      const limit = 32 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit)
        throw new Error("当前模型超过 32 MB 预览限制，请下载后查看。");
      const buffer = await response.arrayBuffer();
      if (disposed) return;
      if (buffer.byteLength > limit)
        throw new Error("当前模型超过 32 MB 预览限制，请下载后查看。");
      if (expectedSha256 !== undefined) {
        if (!/^[a-f0-9]{64}$/i.test(expectedSha256) || !globalThis.crypto?.subtle)
          throw new Error("模型文件校验记录无效或当前环境无法校验，已停止加载。");
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        if (disposed) return;
        const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
        if (actual !== expectedSha256.toLowerCase())
          throw new Error("模型文件 SHA-256 与保存版本不一致，已停止加载。请重新核实文件来源。");
        host.dataset.modelSha256 = actual;
      }
      validateGlbSecurity(buffer);
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((resource) => {
        if (resource.startsWith("data:") || resource.startsWith("blob:"))
          return resource;
        throw new Error("模型引用了未经授权的外部资源，已停止解析。");
      });
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, "");
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      model = gltf.scene;
      modelRef.current = model;
      const originalMaterials = new Set<THREE.Material>();
      const cloneMaterial=(material:THREE.Material)=>{originalMaterials.add(material);const clone=material.clone();clone.userData={...clone.userData,v8BaseOpacity:material.opacity,v8BaseTransparent:material.transparent,v8BaseDepthWrite:material.depthWrite};return clone;};
      let declaredSource = "";
      model.traverse((child) => {
        if (!declaredSource && typeof child.userData.sourceKind === "string")
          declaredSource = child.userData.sourceKind;
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        if (Array.isArray(child.material))
          child.material = child.material.map((material) => {
            return cloneMaterial(material);
          });
        else {
          child.material = cloneMaterial(child.material);
        }
      });
      originalMaterials.forEach((material) => material.dispose());
      setSourceKind(declaredSource);
      modelSourceKind = declaredSource;
      if (declaredSource.startsWith('licensed-'))
        camera.position.set(-3, 2.5, 4);
      const pose = captureModelPose(model);
      const configuredMetadata: unknown = gltf.asset.extras?.embodexConfiguredExport;
      adoptConfiguredPoseBaseline(pose, configuredMetadata);
      if (configuredMetadata && typeof configuredMetadata === "object" && "parameterSnapshot" in configuredMetadata)
        host.dataset.configuredParameters = JSON.stringify(configuredMetadata.parameterSnapshot);
      poseRef.current = pose;
      perception=new PerceptionPreview(model);scene.add(perception.group);ui.availableFov={...perception.available};
      ui.availableSensorViews=['external','rgb','thermal','depth','pointcloud'];
      applyModelPose(pose, separationRef.current, offsetRef.current);
      setAssemblies(
        pose.assemblies.map((entry) => ({ id: entry.id, label: entry.label })),
      );
      setHasPerception(
        pose.assemblies.some(
          (entry) => entry.node.userData.category === "perception",
        ),
      );
      const bounds = new THREE.Box3().setFromObject(model);
      if (bounds.isEmpty()) {
        disposeObject(model);
        model = null;
        throw new Error("模型没有可显示的网格。请核实源文件。");
      }
      scene.add(model);
      const dimensions = bounds.getSize(new THREE.Vector3());
      const span = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.1);
      key.target.position.copy(bounds.getCenter(new THREE.Vector3()));
      key.shadow.camera.left = -span * 1.5;
      key.shadow.camera.right = span * 1.5;
      key.shadow.camera.top = span * 1.5;
      key.shadow.camera.bottom = -span * 1.5;
      key.shadow.camera.near = 0.1;
      key.shadow.camera.far = 30;
      key.shadow.camera.updateProjectionMatrix();
      key.shadow.normalBias = span * 0.001;
      floor.position.y = bounds.min.y - 0.001;
      homeTarget = bounds.getCenter(new THREE.Vector3());
      homePosition = homeTarget
        .clone()
        .add(new THREE.Vector3(span * 1.35, span * 0.85, span * 1.65));
      camera.near = Math.max(span / 1000, 0.001);
      camera.far = Math.max(span * 60, 100);
      camera.updateProjectionMatrix();
      controls.minDistance = span * 0.45;
      controls.maxDistance = span * 8;
      controlsRef.current?.fit();
      host.dataset.modelLoaded = "true";
      host.dataset.assemblyCount = String(pose.assemblies.length);
      host.dataset.meshCount = String(pose.meshCount);
      host.dataset.explodeLevel = String(separationRef.current);
      host.dataset.inspectionMode = "whole";
      host.dataset.sourceKind = declaredSource;
      const unavailable = (): ViewerCommandReceipt => ({
        ok: false,
        message: "当前模型视图已关闭或已切换，请在新视图加载完成后重试。",
      });
      const active = () =>
        !disposed && model !== null && poseRef.current === pose;
      const resolvePart = (query: string) => {
        const text = query.trim();
        const exact = pose.assemblies.filter(
          (part) => part.id === text || part.label === text,
        );
        if (exact.length) return exact;
        const category = ["感知", "前部感知"].includes(text)
          ? "perception"
          : text;
        return pose.assemblies.filter(
          (part) =>
            part.node.userData.sourceMesh === text ||
            part.node.userData.category === category,
        );
      };
      const commandController: ModelViewerController = {
        getUiState:()=>({...ui,fov:{...ui.fov},availableFov:{...ui.availableFov},availableSensorViews:[...ui.availableSensorViews]}),
        setXray:enabled=>{if(!active())return unavailable();ui.xray=Boolean(enabled);inspect(inspectionRef.current,selectedObject?.userData.assemblyId);publishUi();return{ok:true,message:enabled?'已开启外壳透视。':'已恢复实体材质。'};},
        setDimensions:enabled=>{if(!active())return unavailable();ui.dimensions=Boolean(enabled);dimensionBox.visible=ui.dimensions;updateView();publishUi();return{ok:true,message:enabled?'已显示实际网格包围尺寸。':'已隐藏尺寸辅助线。'};},
        toggleExploded:()=>commandController.setSeparation(separationRef.current>.05?0:1),
        clearSelection:()=>{if(!active())return unavailable();selectedObject=null;setSelected('');setSelectedAssembly('');setPartDetails(null);onDetailsRef.current?.(null);if(selectionOutline){scene.remove(selectionOutline);selectionOutline.geometry.dispose();selectionOutline.material.dispose();selectionOutline=null;}inspect('whole');publishUi();return{ok:true,message:'已返回整机。'};},
        setFov:(kind,enabled)=>{
          if(!active())return unavailable();
          if(!ui.availableFov[kind])return{ok:false,message:'来源模型未提供这个感知节点。'};
          ui.fov[kind]=Boolean(enabled);
          if(enabled){
            const ids=kind==='thermal'?['attachment.thermal-head']:kind==='vision'?['attachment.rgb-head','dock-camera']:['base.base_2','lidar-0.555'];
            const part=ids.map(id=>pose.assemblies.find(item=>item.id===id)).find(Boolean);
            if(part)selectObject(part.node,part.id);
          }
          updateView();publishUi();
          return{ok:true,message:enabled?'已显示来源节点上的覆盖示意。':'已隐藏该覆盖示意。'};
        },
        setSensorView:view=>{if(!active())return unavailable();if(!ui.availableSensorViews.includes(view))return{ok:false,message:'该感知视图不可用。'};if(ui.mode!=='perception')commandController.setMode('perception');ui.sensorView=view;if(view==='rgb'||view==='external')ui.comparison=false;updateView();publishUi();return{ok:true,message:view==='external'?'已返回外部视场示意。':view==='rgb'?'已显示同一虚拟视点的RGB画面。':view==='thermal'?'已显示基于源对象温度假设的合成热像。':view==='depth'?'已显示同帧深度缓冲的可见表面距离。':'已显示从同帧深度采样的可见表面点云。'};},
        setSensorComparison:enabled=>{if(!active())return unavailable();ui.comparison=Boolean(enabled)&&!['external','rgb'].includes(ui.sensorView);updateView();publishUi();return{ok:true,message:ui.comparison?'已开启同一帧RGB与当前通道对照。':'已关闭同帧对照。'};},
        assetUrl: url,
        getParts: () =>
          active()
            ? pose.assemblies.map((part) => ({
                id: part.id,
                label: part.label,
                parentId:(()=>{let parent=part.node.parent;while(parent){if(typeof parent.userData.assemblyId==='string')return parent.userData.assemblyId;parent=parent.parent;}return undefined;})(),
                category:
                  typeof part.node.userData.category === "string"
                    ? part.node.userData.category
                    : undefined,
                sourceMesh:
                  typeof part.node.userData.sourceMesh === "string"
                    ? part.node.userData.sourceMesh
                    : undefined,
                offsetMax:
                  part.node.userData.viewOffsetSupported === true
                    ? part.node.userData.viewOffsetMax
                    : undefined,
              }))
            : [],
        setMode: (mode) => {
          if (!active()) return unavailable();
          if (!["whole", "exploded", "perception"].includes(mode))
            return { ok: false, message: "未识别的查看方式，未改变模型。" };
          if (mode === "exploded" && pose.assemblies.length <= 1)
            return {
              ok: false,
              message: "此模型未提供可拆解的组件结构，未改变模型。",
            };
          const perception =
            mode === "perception"
              ? pose.assemblies.find(
                  (part) => part.node.userData.category === "perception",
                )
              : null;
          if (mode === "perception" && !perception)
            return {
              ok: false,
              message:
                "此模型没有明确的感知组件元数据，可以查看整机、拆解或选择实际部件。",
            };
          const level = mode === "exploded" ? (lastSeparation>.05?lastSeparation:.65) : 0;
          ui.mode=mode;ui.separation=level;ui.sensorView='external';
          separationRef.current = level;
          setSeparation(level);
          applyModelPose(pose, level, offsetRef.current);
          inspect(mode === "perception" ? "perception" : "whole");
          publishUi();
          fit();
          host.dataset.explodeLevel = String(level);
          return {
            ok: true,
            message:
              mode === "whole"
                ? "已还原整机视图。"
                : mode === "exploded"
                  ? "已按实际组件层级展开模型。"
                  : "已显示整机与来源节点上的感知视场示意。",
            partId: perception?.id,
          };
        },
        setSeparation: (level) => {
          if (!active()) return unavailable();
          if (!Number.isFinite(level) || level < 0 || level > 1)
            return {
              ok: false,
              message: "拆解程度必须在0至1之间，未改变模型。",
            };
          if (level > 0 && pose.assemblies.length <= 1)
            return {
              ok: false,
              message: "此模型未提供可拆解的组件结构，未改变模型。",
            };
          const before = separationRef.current;
          ui.mode='exploded';ui.separation=level;lastSeparation=level;
          separationRef.current = level;
          setSeparation(level);
          applyModelPose(pose, level, offsetRef.current);
          inspect("whole");
          fit();
          host.dataset.explodeLevel = String(level);
          publishUi();
          return {
            ok: true,
            message: `已将真实组件展开程度调整为${Math.round(level * 100)}%。`,
            before: [before],
            after: [level],
          };
        },
        focusPart: (query) => {
          if (!active()) return unavailable();
          const matches = resolvePart(query);
          if (matches.length !== 1)
            return {
              ok: false,
              message: matches.length
                ? `匹配到${matches.length}个实际部件，请使用完整部件名称或ID。`
                : "未找到这个部件，请从当前模型的实际组件列表中选择。",
            };
          selectObject(matches[0].node, matches[0].id);
          if(ui.mode!=='perception'){inspect("part", matches[0].id);fit();}
          return {
            ok: true,
            message: ui.mode==='perception'?`已选中${matches[0].label}，保留整机与视场。`:`已聚焦${matches[0].label}的实际网格。`,
            partId: matches[0].id,
          };
        },
        resetView: () => {
          if (!active()) return unavailable();
          const before = camera.position.toArray();
          controlsRef.current?.reset();
          return {
            ok: true,
            message: "已重置模型视角。",
            before,
            after: camera.position.toArray(),
          };
        },
        setView: (view) => {
          if (!active()) return unavailable();
          const sourced = declaredSource.startsWith("licensed-");
          const directions = {
            front: sourced ? [-1, 0.1, 0] : [0, 0.1, 1],
            side: sourced ? [0, 0.15, 1] : [1, 0.15, 0],
            top: [0, 1, 0.001],
            iso: sourced ? [-1.35, 0.85, 1.65] : [1.35, 0.85, 1.65],
          };
          if (!Object.hasOwn(directions, view))
            return { ok: false, message: "不支持这个视角，未改变模型。" };
          const before = camera.position.toArray();
          camera.position
            .copy(controls.target)
            .add(new THREE.Vector3(...directions[view]));
          fit();
          return {
            ok: true,
            message: `已切换${{ front: "前视", side: "侧视", top: "俯视", iso: "轴测" }[view]}视角。`,
            before,
            after: camera.position.toArray(),
          };
        },
        zoom: (factor) => {
          if (!active()) return unavailable();
          if (!Number.isFinite(factor) || factor < 0.5 || factor > 2)
            return { ok: false, message: "缩放倍率超出支持范围，未改变视图。" };
          const before = camera.position.toArray();
          controlsRef.current?.zoom(factor);
          return {
            ok: true,
            message: factor < 1 ? "已放大模型视图。" : "已缩小模型视图。",
            before,
            after: camera.position.toArray(),
          };
        },
        setPartOffset: (partId, delta) => {
          if (!active()) return unavailable();
          const part = pose.assemblies.find((item) => item.id === partId);
          if (
            !part ||
            !Array.isArray(delta) ||
            delta.length !== 3 ||
            delta.some((value) => !Number.isFinite(value))
          )
            return { ok: false, message: "部件或位移输入无效，未改变模型。" };
          const receipt = setPartWorldPreviewOffset(
            pose,
            partId,
            delta,
            separationRef.current,
            offsetRef.current,
          );
          if (!receipt.ok) return receipt;
          selectObject(part.node, part.id);
          fit();
          host.dataset.adjustedPart = partId;
          host.dataset.partOffset = receipt.localOffset?.join(",") || "";
          host.dataset.partWorldBefore = receipt.before?.join(",") || "";
          host.dataset.partWorldAfter = receipt.after?.join(",") || "";
          return receipt;
        },
      };
      commandControllerRef.current = commandController;
      onControllerRef.current?.(commandController);
      publishUi();
      setLoad("ready");
    })().catch(fail);

    return () => {
      disposed = true;
      onControllerRef.current?.(null);
      commandControllerRef.current = null;
      onDetailsRef.current?.(null);
      onViewStateRef.current?.(null);
      perception?.dispose();dimensionBox.geometry.dispose();for(const material of Array.isArray(dimensionBox.material)?dimensionBox.material:[dimensionBox.material])material.dispose();
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibilityObserver.disconnect();
      activeRenderer.domElement.removeEventListener(
        "webglcontextlost",
        contextLost,
      );
      inputElement.removeEventListener("pointerdown", pointerDown);
      inputElement.removeEventListener("pointerup", pointerUp);
      controls.removeEventListener('change', cameraChanged);
      controls.dispose();
      controlsRef.current = null;
      modelRef.current = null;
      poseRef.current = null;
      if (selectionOutline) {
        selectionOutline.geometry.dispose();
        selectionOutline.material.dispose();
      }
      disposeObject(scene);
      grid.geometry.dispose();
      if (Array.isArray(grid.material))
        grid.material.forEach((material) => material.dispose());
      else grid.material.dispose();
      activeRenderer.dispose();
      sensorRenderer.dispose();
      environment.dispose();
      activeRenderer.forceContextLoss();
      activeRenderer.domElement.remove();
      displayCanvas.remove();
      stopStream();
      presentationImage?.remove();
      presentationImage?.removeAttribute('src');
      if(presentation){displayCanvas.width=1;displayCanvas.height=1;}
    };
  }, [url, expectedSha256, attempt]);

  return (
    <section
      className={`${styles.viewer} ${compact ? styles.compact : ""}`}
      aria-label={`${label}三维查看器`}
      data-view-mode={separation > 0 ? "exploded" : "assembled"}
      data-inspector-placement={inspectorPlacement}
      onKeyDown={event => { if (event.key === 'Escape') setPartsOpen(false); }}
    >
      <div
        className={styles.viewport}
        ref={hostRef}
        tabIndex={0}
        aria-label="三维模型。拖动旋转、滚轮缩放；键盘左右键旋转，加减号缩放。"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            controlsRef.current?.rotate(
              event.key === "ArrowLeft" ? -0.15 : 0.15,
            );
          }
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            controlsRef.current?.zoom(0.85);
          }
          if (event.key === "-") {
            event.preventDefault();
            controlsRef.current?.zoom(1.15);
          }
          if (event.key === "Home") {
            event.preventDefault();
            controlsRef.current?.reset();
          }
        }}
      />
      {assemblies.length <= 1 && <div className={styles.topline}>
        {selected && assemblies.length <= 1 && (
          <span className={styles.selected}>{selected}</span>
        )}
      </div>}
      {load === "ready" && assemblies.length > 1 && (
        <div className={styles.chrome}>
          <div
            className={styles.modeDock}
            role="group"
            aria-label="模型结构查看方式"
          >
            <button
              aria-label="还原整机"
              aria-pressed={viewerUi?.mode === 'whole'}
              onClick={() => {
                commandControllerRef.current?.setMode('whole');
              }}
            >
              <ViewerIcon name="whole"/>整机
            </button>
            <button
              aria-label="拆解模型"
              aria-pressed={viewerUi?.mode === 'exploded'}
              onClick={() => {
                commandControllerRef.current?.setMode('exploded');
              }}
            >
              <ViewerIcon name="explode"/>拆解
            </button>
            {hasPerception && (
              <button
                aria-label="查看感知外观"
                aria-pressed={viewerUi?.mode === 'perception'}
                onClick={() => {
                  commandControllerRef.current?.setMode('perception');
                }}
              >
                <ViewerIcon name="sense"/>感知
              </button>
            )}
            {inspectorPlacement === 'overlay' && (
              <button
                aria-label="打开模型部件目录"
                aria-expanded={partsOpen}
                onClick={() => setPartsOpen(value => !value)}
              >
                <ViewerIcon name="parts"/>部件
              </button>
            )}
          </div>
          {viewerUi?.mode === 'exploded' && inspectorPlacement !== 'external' && (
            <label className={styles.explodeRange}>
              展开
              <input
                aria-label="拆解程度"
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(separation * 100)}
                onChange={(event) => {
                  const level = Number(event.target.value) / 100;
                  commandControllerRef.current?.setSeparation(level);
                }}
              />
              <output>{Math.round(separation * 100)}%</output>
            </label>
          )}
          <div className={`${styles.partsMenu} ${separation > 0 ? styles.belowSlider : ''}`} hidden={!partsOpen || inspectorPlacement === 'external'}>
          <label className={styles.partPicker}>
            <span>组件</span>
            <select
              aria-label="选择模型组件"
              value={selectedAssembly}
              onChange={(event) => {
                controlsRef.current?.selectAssembly(event.target.value);
                setPartsOpen(false);
              }}
            >
              <option value="" disabled>
                定位部件
              </option>
              {assemblies.map((assembly) => (
                <option key={assembly.id} value={assembly.id}>
                  {assembly.label}
                </option>
              ))}
            </select>
          </label>
          <span
            className={styles.partCount}
            aria-live="polite"
          >
            {selected || `${assemblies.length} 个组件`}
          </span>
          </div>
        </div>
      )}
      {load === "ready" && inspectorPlacement === 'overlay' && (partDetails || inspection !== "whole") && (
        <div className={styles.inspectionInfo}>
          <div className={styles.inspectionHeading}>
            <strong>
              {inspection === "perception"
                ? "感知部件"
                : partDetails?.label}
            </strong>
            <button
              aria-label="关闭部件信息"
              onClick={() => {
                setPartDetails(null);
                onDetailsRef.current?.(null);
                controlsRef.current?.inspect("whole");
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
            </button>
          </div>
          {partDetails && (
            <>
              <span>
                外观尺寸 ·{" "}
                {partDetails.size.map((value) => (value * 1000).toFixed(1)).join(" × ")}{" "}
                mm
              </span>
                <details>
                  <summary>几何与来源</summary>
                  <p>{partDetails.triangles.toLocaleString()} 三角面</p>
                  {partDetails.mesh && <code>
                    {partDetails.mesh}.obj
                    <br />
                    {partDetails.body}
                    {partDetails.joint && (
                      <>
                        <br />
                        {partDetails.joint}
                      </>
                    )}
                  </code>}
                </details>
            </>
          )}
          <small>
            {sourceKind === "licensed-original-mesh-conversion"
              ? "结构参考 · 未经工程验证"
              : "概念模型 · 未经工程验证"}
          </small>
          {partDetails && (
            <button
              className={styles.focusPart}
              aria-label={
                inspection === "part" ? "显示全部部件" : "聚焦选中部件"
              }
              onClick={() =>
                controlsRef.current?.inspect(
                  inspection === "part" ? "whole" : "part",
                  selectedAssembly,
                )
              }
            >
              {inspection === "part" ? "显示全部" : "聚焦部件"} <span>↗</span>
            </button>
          )}
        </div>
      )}
      {load === 'ready' && viewerUi?.mode === 'perception' && <div className={styles.sensorLegend} aria-label="感知视图说明">
        <span className={styles.sensorLegendDot}/>
        {viewerUi.sensorView==='external'?'覆盖范围示意 · 非实测':viewerUi.sensorView==='rgb'?'RGB · 同一虚拟视点':viewerUi.sensorView==='thermal'?'合成热像 · 源对象温度假设':viewerUi.sensorView==='depth'?'深度 · 同帧可见表面 0.3–15 m':'点云 · 同帧深度采样'}
      </div>}
      {load==='ready' && viewerUi?.mode==='perception' && viewerUi.comparison && !['external','rgb'].includes(viewerUi.sensorView) && <div className={styles.sensorComparison} aria-hidden="true"><span>RGB · 同一帧</span><i/><span>{viewerUi.sensorView==='thermal'?'合成热像':viewerUi.sensorView==='depth'?'深度':'点云'} · 同一帧</span></div>}
      {load === "loading" && (
        <div className={styles.overlay} role="status">
          <span className={styles.spinner} />
          <strong>正在读取三维模型</strong>
        </div>
      )}
      {load === "error" && (
        <div className={styles.overlay} role="alert">
          <strong>暂时无法显示模型</strong>
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            重新加载
          </button>
        </div>
      )}
      {load === "ready" && (
        <div className={styles.cameraTools} role="group" aria-label="模型视角与缩放">
            <button aria-label="重置模型视角" title="轴测视角" onClick={() => commandControllerRef.current?.setView('iso')}><ViewerIcon name="iso"/></button>
            <button aria-label="模型侧视图" title="侧视图" onClick={() => commandControllerRef.current?.setView('side')}><ViewerIcon name="side"/></button>
            <button aria-label="模型俯视图" title="俯视图" onClick={() => commandControllerRef.current?.setView('top')}><ViewerIcon name="top"/></button>
            <button
              aria-label="放大模型"
              title="放大"
              onClick={() => controlsRef.current?.zoom(0.8)}
            >
              ＋
            </button>
            <button
              aria-label="缩小模型"
              title="缩小"
              onClick={() => controlsRef.current?.zoom(1.25)}
            >
              −
            </button>
        </div>
      )}
    </section>
  );
}
