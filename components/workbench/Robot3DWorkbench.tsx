'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { parseUrdfXml } from './urdf/UrdfParser';
import { UrdfKinematicsController } from './urdf/UrdfKinematicsController';
import {
  UrdfThreeModel,
  PartSelectedInfo,
  ModelLoadProgress,
  DimensionLineProjection,
  PinnedLabelProjection,
} from './urdf/UrdfThreeModel';
import { UrdfRobot } from './urdf/types';

// SVG 图标库 (完全复用 EmboMiX 设计规范)
const ICONS: Record<string, string> = {
  file: 'M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8l-6-6z M14 2v6h6 M8 13h8 M8 17h6',
  box: 'M3 6l9-4 9 4v12l-9 4-9-4V6z M3 6l9 5 9-5 M12 11v11 M7 4l10 5',
  layers: 'M2 8l10-6 10 6-10 6L2 8z M2 12l10 6 10-6 M2 16l10 6 10-6',
  scan: 'M8 3H4a1 1 0 0 0-1 1v4 M16 3h4a1 1 0 0 1 1 1v4 M21 16v4a1 1 0 0 1-1 1h-4 M8 21H4a1 1 0 0 1-1-1v-4 M7 12h10 M12 7v10',
  joint: 'M8 5a3 3 0 1 1 6 0 3 3 0 0 1-6 0z M10 8L5 17l5 4 5-9 M5 17L2 21 M14 5l6 5-5 5',
  ruler: 'M4 18L18 4l4 4L8 22l-4-4z M7 15l2 2 M10 12l2 2 M13 9l2 2 M16 6l2 2',
  route: 'M5 18a3 3 0 1 1 0-6h14a3 3 0 0 0 0-6H8 M8 3L5 6l3 3 M5 15v6',
  reset: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7',
  side: 'M3 8h18v8H3z M8 8v8 M16 8v8',
  top: 'M7 3h10v18H7z M7 9h10 M7 15h10',
  expand: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
  play: 'M7 4l13 8-13 8V4z',
  pause: 'M7 4h3v16H7z M15 4h3v16h-3z',
};

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const d = ICONS[name] || ICONS.box;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <path d={d} />
    </svg>
  );
}

// 零件目录规格数据
interface CatalogGroup {
  id: string;
  name: string;
  items: { id: string; name: string; desc: string; dimensions?: string; material?: string }[];
}

const CATALOG_DATA: CatalogGroup[] = [
  {
    id: 'body',
    name: '机身主体与感知单元',
    items: [
      { id: 'trunk', name: '机身主躯干总成 (Trunk)', desc: '一体化高强度工程机身，集成控制器、动力电池与机载传感器', dimensions: '414 × 194 × 117 mm', material: '宇树经典橙黑涂装 · 铝合金' },
      { id: 'imu_link', name: 'IMU 惯导单元 (IMU Link)', desc: '高精度六轴惯性测量单元，提供姿态角速度与加速度反馈', dimensions: '1 × 1 × 1 mm', material: '微电子封装' },
      { id: 'base', name: '基座原点坐标系 (Base)', desc: '机器人几何与运动学根节点定位基准', dimensions: '1 × 1 × 1 mm', material: '虚拟坐标基准' },
    ],
  },
  {
    id: 'front_legs',
    name: '前腿总成 (FR / FL)',
    items: [
      { id: 'FR_hip', name: '右前髋关节 (FR_hip)', desc: '右前腿准直驱力控横摆伺服模组', dimensions: '100 × 45 × 92 mm', material: '铝质外壳 · 钢制行星减速器' },
      { id: 'FR_thigh', name: '右前大腿摆臂 (FR_thigh)', desc: '轻量化高刚性航空铝合金大腿连杆', dimensions: '92 × 78 × 260 mm', material: '航空 7075 铝合金' },
      { id: 'FR_calf', name: '右前小腿连杆 (FR_calf)', desc: '耐冲击高弹性连杆，吸附地面反冲力', dimensions: '46 × 40 × 251 mm', material: '宇树耐磨复合连杆' },
      { id: 'FR_foot', name: '右前耐磨足垫 (FR_foot)', desc: '高抓地力减震硅胶足端，内置接地触力感知', dimensions: '20 × 20 × 20 mm', material: '高弹减震橡胶' },
      { id: 'FL_hip', name: '左前髋关节 (FL_hip)', desc: '左前腿准直驱力控横摆伺服模组', dimensions: '100 × 45 × 92 mm', material: '铝质外壳 · 钢制行星减速器' },
      { id: 'FL_thigh', name: '左前大腿摆臂 (FL_thigh)', desc: '轻量化高刚性航空铝合金大腿连杆', dimensions: '92 × 78 × 260 mm', material: '航空 7075 铝合金' },
      { id: 'FL_calf', name: '左前小腿连杆 (FL_calf)', desc: '耐冲击高弹性连杆，吸附地面反冲力', dimensions: '46 × 40 × 251 mm', material: '宇树耐磨复合连杆' },
      { id: 'FL_foot', name: '左前耐磨足垫 (FL_foot)', desc: '高抓地力减震硅胶足端，内置接地触力感知', dimensions: '20 × 20 × 20 mm', material: '高弹减震橡胶' },
    ],
  },
  {
    id: 'rear_legs',
    name: '后腿总成 (RR / RL)',
    items: [
      { id: 'RR_hip', name: '右后髋关节 (RR_hip)', desc: '右后腿准直驱力控横摆伺服模组', dimensions: '100 × 45 × 92 mm', material: '铝质外壳 · 钢制行星减速器' },
      { id: 'RR_thigh', name: '右后大腿摆臂 (RR_thigh)', desc: '后驱推力主承力大腿摆臂连杆', dimensions: '92 × 78 × 260 mm', material: '航空 7075 铝合金' },
      { id: 'RR_calf', name: '右后小腿连杆 (RR_calf)', desc: '耐冲击高弹性后小腿连杆', dimensions: '46 × 40 × 251 mm', material: '宇树耐磨复合连杆' },
      { id: 'RR_foot', name: '右后耐磨足垫 (RR_foot)', desc: '高抓地力减震硅胶足端，内置接地触力感知', dimensions: '20 × 20 × 20 mm', material: '高弹减震橡胶' },
      { id: 'RL_hip', name: '左后髋关节 (RL_hip)', desc: '左后腿准直驱力控横摆伺服模组', dimensions: '100 × 45 × 92 mm', material: '铝质外壳 · 钢制行星减速器' },
      { id: 'RL_thigh', name: '左后大腿摆臂 (RL_thigh)', desc: '后驱推力主承力大腿摆臂连杆', dimensions: '92 × 78 × 260 mm', material: '航空 7075 铝合金' },
      { id: 'RL_calf', name: '左后小腿连杆 (RL_calf)', desc: '耐冲击高弹性后小腿连杆', dimensions: '46 × 40 × 251 mm', material: '宇树耐磨复合连杆' },
      { id: 'RL_foot', name: '左后耐磨足垫 (RL_foot)', desc: '高抓地力减震硅胶足端，内置接地触力感知', dimensions: '20 × 20 × 20 mm', material: '高弹减震橡胶' },
    ],
  },
  {
    id: 'actuators',
    name: '12 核心力控关节伺服 (Actuators)',
    items: [
      { id: 'FR_hip_joint', name: 'FR 侧摆伺服关节', desc: '峰值扭矩 33.5 N·m 高爆发力控关节模组', dimensions: '100 × 45 × 92 mm', material: '宇树准直驱电机' },
      { id: 'FR_thigh_joint', name: 'FR 大腿俯仰伺服', desc: '大传动比准直驱力控电机，负责前进俯仰驱动', dimensions: '100 × 45 × 92 mm', material: '双编码器力矩传感' },
      { id: 'FR_calf_joint', name: 'FR 小腿屈伸伺服', desc: '小腿连杆屈伸电机，限位 -154.5° ~ -52.5°', dimensions: '100 × 45 × 92 mm', material: '高响应无刷力控电机' },
      { id: 'FL_hip_joint', name: 'FL 侧摆伺服关节', desc: '峰值扭矩 33.5 N·m 高爆发力控关节模组', dimensions: '100 × 45 × 92 mm', material: '宇树准直驱电机' },
      { id: 'FL_thigh_joint', name: 'FL 大腿俯仰伺服', desc: '大传动比准直驱力控电机，负责前进俯仰驱动', dimensions: '100 × 45 × 92 mm', material: '双编码器力矩传感' },
      { id: 'FL_calf_joint', name: 'FL 小腿屈伸伺服', desc: '小腿连杆屈伸电机，限位 -154.5° ~ -52.5°', dimensions: '100 × 45 × 92 mm', material: '高响应无刷力控电机' },
      { id: 'RR_hip_joint', name: 'RR 侧摆伺服关节', desc: '后驱侧摆关节电机，协调转弯与横向平移', dimensions: '100 × 45 × 92 mm', material: '宇树准直驱电机' },
      { id: 'RR_thigh_joint', name: 'RR 大腿俯仰伺服', desc: '后驱主爆发俯仰电机，提供蹬地推进动力', dimensions: '100 × 45 × 92 mm', material: '双编码器力矩传感' },
      { id: 'RR_calf_joint', name: 'RR 小腿屈伸伺服', desc: '后腿屈伸电机，吸收冲击并传递蹬地反冲', dimensions: '100 × 45 × 92 mm', material: '高响应无刷力控电机' },
      { id: 'RL_hip_joint', name: 'RL 侧摆伺服关节', desc: '后驱侧摆关节电机，协调转弯与横向平移', dimensions: '100 × 45 × 92 mm', material: '宇树准直驱电机' },
      { id: 'RL_thigh_joint', name: 'RL 大腿俯仰伺服', desc: '后驱主爆发俯仰电机，提供蹬地推进动力', dimensions: '100 × 45 × 92 mm', material: '双编码器力矩传感' },
      { id: 'RL_calf_joint', name: 'RL 小腿屈伸伺服', desc: '后腿屈伸电机，吸收冲击并传递蹬地反冲', dimensions: '100 × 45 × 92 mm', material: '高响应无刷力控电机' },
    ],
  },
];

interface Robot3DWorkbenchProps {
  urdfUrl?: string;
  meshBaseUrl?: string;
}

export default function Robot3DWorkbench({
  urdfUrl = '/models/a1/robot.urdf',
  meshBaseUrl = '/models/a1/',
}: Robot3DWorkbenchProps = {}) {

  // 核心模型与运动学状态
  const [robot, setRobot] = useState<UrdfRobot | null>(null);
  const [kinematics, setKinematics] = useState<UrdfKinematicsController | null>(null);
  const [model, setModel] = useState<UrdfThreeModel | null>(null);

  // 6 大模式导航 (整机 | 拆解 | 感知 | 运动仿真 | 物理环境 | 应用场景)
  const [mode, setMode] = useState<
    'overview' | 'exploded' | 'sensors' | 'motion' | 'physics' | 'application'
  >('overview');

  // 交互选定零部件 (默认选中主躯干)
  const [selectedPart, setSelectedPart] = useState<PartSelectedInfo | null>({
    linkName: 'trunk',
    partName: '机身主躯干总成 (Trunk)',
    category: '主躯干总成',
    description: '一体化高强度工程机身，集成控制器、动力电池与机载传感器',
    dimensions: { x: 414.2, y: 194.0, z: 117.0 },
    materialName: 'orange',
  });

  // 零件目录筛选与搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // 辅助开关
  const [showDimensions, setShowDimensions] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [explodeValue, setExplodeValue] = useState(0);

  // 动态投影尺寸标注线与 3D 浮动标签
  const [dimensionLines, setDimensionLines] = useState<DimensionLineProjection[]>([]);
  const [pinnedLabels, setPinnedLabels] = useState<PinnedLabelProjection[]>([]);

  // 仿真运动与环境参数
  const [isPlayingTrot, setIsPlayingTrot] = useState(false);
  const [thresholdHeightMm, setThresholdHeightMm] = useState(50);
  const [sensorType, setSensorType] = useState<'rgb' | 'thermal' | 'pointcloud'>('rgb');

  // 巡检任务状态
  const [missionRunning, setMissionRunning] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);

  // 3D 画布容器与 Three.js 引用
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // 物理环境 3D 障碍与巡检路线 Mesh
  const thresholdMeshRef = useRef<THREE.Mesh | null>(null);
  const aisleGroupRef = useRef<THREE.Group | null>(null);
  const missionPathRef = useRef<THREE.Line | null>(null);

  // 1. 初始化 Three.js 场景与渲染器
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 640;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdce5ed); // 科技冰蓝灰主背景
    sceneRef.current = scene;

    // 相机 (轴测 3/4 初始视角，从前侧方观察整狗)
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 100);
    camera.position.set(1.15, 0.65, 1.15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 0.17, 0);
    controls.minDistance = 0.4;
    controls.maxDistance = 6.0;
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controlsRef.current = controls;

    // 灯光
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.45);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
    dirLight.position.set(2.0, 3.5, 2.2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0002;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x9ebfd8, 1.1);
    fillLight.position.set(-2.5, 2.0, -1.8);
    scene.add(fillLight);

    // 地面平面与网格
    const groundGeo = new THREE.PlaneGeometry(30, 30);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xc6d1dc, roughness: 0.9, metalness: 0.05 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.005;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(20, 80, 0xa0b3c3, 0xb5c4d0);
    grid.position.y = 0;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.32;
    scene.add(grid);

    // 物理环境：门槛障碍台阶 (可调高度)
    const thresholdGeo = new THREE.BoxGeometry(0.12, 0.05, 0.9);
    const thresholdMat = new THREE.MeshStandardMaterial({ color: 0xc3ad77, metalness: 0.5, roughness: 0.45 });
    const thresholdMesh = new THREE.Mesh(thresholdGeo, thresholdMat);
    thresholdMesh.position.set(0.45, 0.025, 0);
    thresholdMesh.castShadow = true;
    thresholdMesh.receiveShadow = true;
    thresholdMesh.visible = false;
    scene.add(thresholdMesh);
    thresholdMeshRef.current = thresholdMesh;

    // 物理环境：仓库窄道货架 (1.0 m 宽)
    const aisleGroup = new THREE.Group();
    aisleGroup.visible = false;
    for (const z of [-0.55, 0.55]) {
      const rackGeo = new THREE.BoxGeometry(1.6, 0.9, 0.08);
      const rackMat = new THREE.MeshStandardMaterial({ color: 0x486b88, transparent: true, opacity: 0.22, wireframe: true });
      const rack = new THREE.Mesh(rackGeo, rackMat);
      rack.position.set(0, 0.45, z);
      aisleGroup.add(rack);
    }
    scene.add(aisleGroup);
    aisleGroupRef.current = aisleGroup;

    // 应用场景：巡检路线虚线
    const pathPoints = [
      new THREE.Vector3(-0.9, 0.01, -0.6),
      new THREE.Vector3(0.0, 0.01, -0.6),
      new THREE.Vector3(0.6, 0.01, 0.0),
      new THREE.Vector3(0.0, 0.01, 0.6),
      new THREE.Vector3(-0.9, 0.01, 0.6),
      new THREE.Vector3(-0.9, 0.01, -0.6),
    ];
    const pathGeo = new THREE.BufferGeometry().setFromPoints(pathPoints);
    const pathMat = new THREE.LineDashedMaterial({ color: 0x2e86de, dashSize: 0.06, gapSize: 0.04 });
    const pathLine = new THREE.Line(pathGeo, pathMat);
    pathLine.computeLineDistances();
    pathLine.visible = false;
    scene.add(pathLine);
    missionPathRef.current = pathLine;

    // 渲染循环与尺寸投影
    let animId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // 小跑 (Trot) 步态回放
      if (isPlayingTrot && kinematics) {
        kinematics.updateTrotGait(elapsed, 2.2);
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container && renderer.domElement) container.removeChild(renderer.domElement);
    };
  }, [isPlayingTrot, kinematics]);

  // 2. 加载 Unitree A1 机器狗 URDF 与网格
  useEffect(() => {
    let active = true;

    async function loadA1Robot() {
      try {
        const res = await fetch(urdfUrl);
        const xmlText = await res.text();
        const parsed = parseUrdfXml(xmlText);
        if (!active) return;
        setRobot(parsed);

        const kc = new UrdfKinematicsController(parsed);
        if (!active) return;
        setKinematics(kc);

        const threeModel = new UrdfThreeModel(parsed, kc, meshBaseUrl, (info) => {
          if (active && info) setSelectedPart(info);
        });

        await threeModel.loadMeshes();
        if (!active) {
          threeModel.dispose();
          return;
        }

        // 默认应用四足标准站立姿态
        kc.setPose('stand');

        setModel(threeModel);
        if (sceneRef.current) {
          sceneRef.current.add(threeModel.rootGroup);
        }
      } catch (err) {
        console.error('加载 Unitree A1 模型失败:', err);
      }
    }

    loadA1Robot();

    return () => {
      active = false;
      if (model && sceneRef.current) {
        sceneRef.current.remove(model.rootGroup);
        model.dispose();
      }
    };
  }, [urdfUrl, meshBaseUrl]);

  // 3. 实时投影尺寸线 (486 mm, 324 mm, 728 mm) 与 3D 浮动零件标签
  useEffect(() => {
    const timer = setInterval(() => {
      const container = canvasContainerRef.current;
      const camera = cameraRef.current;
      if (!container || !camera || !model) return;

      const w = container.clientWidth;
      const h = container.clientHeight;

      if (showDimensions && mode === 'overview') {
        setDimensionLines(model.projectDimensions(camera, w, h));
        setPinnedLabels(model.projectPinnedLabels(camera, w, h));
      } else {
        setDimensionLines([]);
        setPinnedLabels([]);
      }
    }, 40);

    return () => clearInterval(timer);
  }, [model, showDimensions, mode]);

  // 4. 模式切换处理 (感知、拆解、运动仿真、物理环境、应用场景)
  const handleModeChange = (nextMode: typeof mode) => {
    setMode(nextMode);
    if (!model) return;

    // 视场重置
    model.setSensorFovVisible(nextMode === 'sensors');
    if (thresholdMeshRef.current) thresholdMeshRef.current.visible = nextMode === 'physics';
    if (aisleGroupRef.current) aisleGroupRef.current.visible = nextMode === 'physics';
    if (missionPathRef.current) missionPathRef.current.visible = nextMode === 'application';

    if (nextMode === 'exploded') {
      model.setExplode(0.65);
      setExplodeValue(65);
      // 控制台输出装配拆解单元诊断数据
      const diag = model.getExplodeDiagnostics();
      console.log('[EmbodiX] 机器人装配结构拆解单元诊断数据 (Explode Diagnostics):');
      console.table(diag);
    } else {
      model.setExplode(0);
      setExplodeValue(0);
    }

    if (nextMode !== 'motion') {
      setIsPlayingTrot(false);
    }
  };

  // 5. 点击拾取模型零件
  const handlePointerDown = (e: React.PointerEvent) => {
    const container = canvasContainerRef.current;
    const camera = cameraRef.current;
    if (!container || !camera || !model) return;

    const rect = container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const hitInfo = model.raycast(raycaster);
    if (hitInfo) {
      setSelectedPart(hitInfo);
    }
  };

  // 视角重置
  const resetCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(1.15, 0.65, 1.15);
    controls.target.set(0, 0.17, 0);
    controls.update();
  }, []);

  // 零件目录筛选
  const filteredCatalog = CATALOG_DATA.map((group) => {
    const items = group.items.filter((item) => {
      const matchQuery = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchCat = categoryFilter === 'all' || group.id === categoryFilter;
      return matchQuery && matchCat;
    });
    return { ...group, items };
  }).filter((group) => group.items.length > 0);

  const totalCatalogCount = CATALOG_DATA.reduce((sum, g) => sum + g.items.length, 0);
  const currentCatalogCount = filteredCatalog.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 280px',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#dce5ed',
        color: '#496d8b',
        fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif",
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: '12px',
        gap: '12px',
      }}
    >
      {/* 左侧 3D 主视口舞台 (Stage) */}
      <div
        ref={canvasContainerRef}
        onPointerDown={handlePointerDown}
        style={{
          position: 'relative',
          borderRadius: 16,
          overflow: 'hidden',
          background: '#dce5ed',
          border: '1px solid #cbd9e5',
          boxShadow: '0 4px 20px rgba(45, 75, 105, 0.08)',
        }}
      >
        {/* 顶部左侧悬浮 Dock (与用户截图完全一致的胶囊药丸 Tabs) */}
        <nav
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            background: 'rgba(255, 255, 255, 0.82)',
            backdropFilter: 'blur(16px)',
            padding: '3px 4px',
            borderRadius: 9,
            border: '1px solid rgba(220, 230, 240, 0.85)',
            boxShadow: '0 2px 10px rgba(50, 75, 100, 0.05)',
          }}
        >
          {[
            { id: 'overview', label: '整机', icon: 'box' },
            { id: 'exploded', label: '拆解', icon: 'layers' },
            { id: 'sensors', label: '感知', icon: 'scan' },
            { id: 'motion', label: '运动仿真', icon: 'joint' },
            { id: 'physics', label: '物理环境', icon: 'ruler' },
            { id: 'application', label: '应用场景', icon: 'route' },
          ].map((tab) => {
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleModeChange(tab.id as typeof mode)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '7px 11px',
                  borderRadius: 7,
                  border: 'none',
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  color: active ? '#24537e' : '#6988a2',
                  background: active ? 'linear-gradient(135deg, #e4effb, #d5e5f5)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <Icon name={tab.icon} size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 舞台左上方淡色文字水印 (与截图一致: DESIGN EXPLORER) */}
        <div
          style={{
            position: 'absolute',
            left: 20,
            top: 76,
            fontSize: 9,
            letterSpacing: '1.8px',
            fontWeight: 600,
            color: '#8da6bc',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          DESIGN EXPLORER
        </div>

        {/* 右上方悬浮快捷工具 (与截图一致: 视角复位、尺寸开关、线框切换、全屏) */}
        <div
          style={{
            position: 'absolute',
            top: 140,
            right: 14,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <button type="button" onClick={resetCamera} style={glassIconBtnStyle} title="复位视角">
            <Icon name="reset" size={15} />
          </button>
          <button
            type="button"
            onClick={() => setShowDimensions(!showDimensions)}
            style={showDimensions ? activeGlassIconBtnStyle : glassIconBtnStyle}
            title="切换 3D 尺寸标注"
          >
            <Icon name="ruler" size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !showWireframe;
              setShowWireframe(next);
              model?.setWireframe(next);
            }}
            style={showWireframe ? activeGlassIconBtnStyle : glassIconBtnStyle}
            title="切换线框结构视图"
          >
            <Icon name="side" size={15} />
          </button>
          <button
            type="button"
            onClick={() => canvasContainerRef.current?.requestFullscreen?.()}
            style={glassIconBtnStyle}
            title="放大视窗全屏"
          >
            <Icon name="expand" size={15} />
          </button>
        </div>

        {/* 3D 尺寸标注投影层 (与截图一致: 728 mm, 486 mm, 324 mm SVG 投影线) */}
        {showDimensions && mode === 'overview' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 6,
            }}
          >
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              {dimensionLines.map((dim) => {
                if (!dim.visible) return null;
                return (
                  <g key={dim.id}>
                    <line
                      x1={dim.startX}
                      y1={dim.startY}
                      x2={dim.endX}
                      y2={dim.endY}
                      stroke={dim.color}
                      strokeWidth="1.2"
                      strokeDasharray="3 3"
                    />
                    <circle cx={dim.startX} cy={dim.startY} r="2.5" fill={dim.color} />
                    <circle cx={dim.endX} cy={dim.endY} r="2.5" fill={dim.color} />
                  </g>
                );
              })}
            </svg>

            {dimensionLines.map((dim) => {
              if (!dim.visible) return null;
              return (
                <div
                  key={`label-${dim.id}`}
                  style={{
                    position: 'absolute',
                    left: dim.labelX,
                    top: dim.labelY,
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(250, 253, 255, 0.94)',
                    border: `1px solid ${dim.color}55`,
                    color: dim.color,
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 9,
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dim.label}
                </div>
              );
            })}
          </div>
        )}

        {/* 3D 零件锚定浮动标签 (与截图一致: 热像模块, RGB 模块, 边缘计算) */}
        {mode === 'overview' && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 7 }}>
            {pinnedLabels.map((lbl) => (
              <div
                key={lbl.id}
                style={{
                  position: 'absolute',
                  left: lbl.x,
                  top: lbl.y,
                  transform: 'translate(-50%, -100%)',
                  background: 'rgba(255, 255, 255, 0.88)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid #c9dbe9',
                  borderRadius: 5,
                  padding: '3px 8px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#345573',
                  boxShadow: '0 2px 8px rgba(35, 65, 95, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#3984be' }} />
                <span>{lbl.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* 舞台底部各模式专属操作栏 */}
        {mode === 'overview' && (
          <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14, display: 'flex', justifyContent: 'space-between', zIndex: 10 }}>
            <button
              type="button"
              onClick={() => setShowDimensions(!showDimensions)}
              style={glassPillBtnStyle}
            >
              <Icon name="ruler" size={12} />
              <span>{showDimensions ? '隐藏尺寸' : '显示尺寸'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                kinematics?.resetToStand();
              }}
              style={glassPillBtnStyle}
            >
              <Icon name="play" size={12} />
              <span>姿态复位 (Stand)</span>
            </button>
          </div>
        )}

        {mode === 'exploded' && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 14,
              right: 14,
              background: 'rgba(255, 255, 255, 0.88)',
              backdropFilter: 'blur(12px)',
              padding: '10px 16px',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              border: '1px solid #d4e2ed',
              boxShadow: '0 4px 16px rgba(40, 70, 95, 0.08)',
              zIndex: 10,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: '#274b6e', whiteSpace: 'nowrap' }}>
              分层拆解展开度: {explodeValue}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={explodeValue}
              onChange={(e) => {
                const val = Number(e.target.value);
                setExplodeValue(val);
                model?.setExplode(val / 100);
              }}
              style={{ flex: 1, accentColor: '#3d7bb0', cursor: 'pointer' }}
            />
            <button
              type="button"
              onClick={() => {
                const nextVal = explodeValue > 5 ? 0 : 70;
                setExplodeValue(nextVal);
                model?.setExplode(nextVal / 100);
              }}
              style={glassPillBtnStyle}
            >
              {explodeValue > 5 ? '合拢整机' : '一键拆解'}
            </button>
            <button
              type="button"
              onClick={() => {
                setExplodeValue(0);
                model?.setExplode(0);
              }}
              style={glassPillBtnStyle}
            >
              复位归位
            </button>
          </div>
        )}

        {mode === 'sensors' && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 14,
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px)',
              padding: '6px 8px',
              borderRadius: 8,
              display: 'flex',
              gap: 6,
              border: '1px solid #d4e2ed',
              zIndex: 10,
            }}
          >
            {[
              { id: 'rgb', label: '相机 (RGB)' },
              { id: 'thermal', label: '热像 (Thermal)' },
              { id: 'pointcloud', label: '点云 (LiDAR)' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSensorType(s.id as any)}
                style={sensorType === s.id ? activePillBtnStyle : pillBtnStyle}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'motion' && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 14,
              right: 14,
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px)',
              padding: '8px 14px',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              border: '1px solid #d4e2ed',
              zIndex: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  setIsPlayingTrot(false);
                  kinematics?.setPose('stand');
                }}
                style={pillBtnStyle}
              >
                正常站立
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPlayingTrot(false);
                  kinematics?.setPose('lie');
                }}
                style={pillBtnStyle}
              >
                趴下休息
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPlayingTrot(false);
                  kinematics?.setPose('crouch');
                }}
                style={pillBtnStyle}
              >
                低伏避障
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsPlayingTrot(!isPlayingTrot)}
              style={{
                ...activePillBtnStyle,
                background: isPlayingTrot
                  ? 'linear-gradient(135deg, #d3e5f6, #b8d7f2)'
                  : 'linear-gradient(135deg, #e4effb, #d5e5f5)',
              }}
            >
              <Icon name={isPlayingTrot ? 'pause' : 'play'} size={12} />
              <span>{isPlayingTrot ? '暂停小跑 (Trot)' : '踏步小跑 (Trot)'}</span>
            </button>
          </div>
        )}

        {mode === 'physics' && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 14,
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px)',
              padding: '8px 14px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              border: '1px solid #d4e2ed',
              zIndex: 10,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: '#355470' }}>
              门槛障碍高度: {thresholdHeightMm} mm
            </span>
            <input
              type="range"
              min={0}
              max={80}
              value={thresholdHeightMm}
              onChange={(e) => {
                const val = Number(e.target.value);
                setThresholdHeightMm(val);
                if (thresholdMeshRef.current) {
                  const m = val / 1000;
                  thresholdMeshRef.current.scale.y = Math.max(m / 0.05, 0.01);
                  thresholdMeshRef.current.position.y = m / 2;
                }
              }}
              style={{ width: 140, accentColor: '#3d7bb0', cursor: 'pointer' }}
            />
          </div>
        )}

        {mode === 'application' && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 14,
              right: 14,
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px)',
              padding: '8px 14px',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: '1px solid #d4e2ed',
              zIndex: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#2b5a84' }}>
                巡检路线: 仓库 A 区环线 (共 4 个巡检测点)
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setEventModalOpen(true)}
                style={pillBtnStyle}
              >
                查看巡检异常留证
              </button>
              <button
                type="button"
                onClick={() => setMissionRunning(!missionRunning)}
                style={activePillBtnStyle}
              >
                <Icon name="play" size={12} />
                <span>{missionRunning ? '巡检中 (0.8 m/s)' : '开始巡检任务'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 右侧属性检视器 (与用户截图完全一致: DESIGN EXPLORER / 本体与系统组成) */}
      <aside
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: '#fbfdff',
          borderRadius: 14,
          border: '1px solid #dbe6ef',
          overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(40, 70, 95, 0.05)',
        }}
      >
        {/* 检视器头部 */}
        <header style={{ padding: '20px 16px 14px', borderBottom: '1px solid #e9eff5' }}>
          <small
            style={{
              display: 'block',
              fontSize: 8,
              letterSpacing: '1px',
              fontWeight: 600,
              color: '#a0b5c7',
              textTransform: 'uppercase',
            }}
          >
            {mode === 'exploded' ? 'ASSEMBLY EXPLORER' : 'DESIGN EXPLORER'}
          </small>
          <h3
            style={{
              margin: '6px 0 0',
              fontSize: 17,
              fontWeight: 650,
              color: '#385d7e',
              letterSpacing: '-0.3px',
            }}
          >
            {mode === 'exploded' ? '分层拆解与精密装配' : '本体与系统组成'}
          </h3>
        </header>

        {/* 零部件目录与搜索区 */}
        <div style={{ flex: 1, padding: '14px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 小标与数量 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#688ca8' }}>本体与任务附件</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#97afc2', fontFamily: 'monospace' }}>
              {currentCatalogCount} / {totalCatalogCount}
            </span>
          </div>

          {/* 搜索与分类下拉框 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              placeholder="搜索零件名称 / 编号"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #dce7f0',
                borderRadius: 8,
                background: '#f6fbff',
                color: '#557692',
                fontSize: 11,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 8px',
                border: '1px solid #dce7f0',
                borderRadius: 8,
                background: '#f6fbff',
                color: '#557692',
                fontSize: 11,
                boxSizing: 'border-box',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">全部零件与关节</option>
              <option value="body">机身主体与感知</option>
              <option value="front_legs">前腿总成 (FR/FL)</option>
              <option value="rear_legs">后腿总成 (RR/RL)</option>
              <option value="actuators">核心力控伺服关节</option>
            </select>
          </div>

          {/* 折叠零件分类列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {filteredCatalog.map((group) => (
              <details key={group.id} open style={{ borderBottom: '1px solid #f0f4f8', paddingBottom: 6 }}>
                <summary
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#829eb6',
                    padding: '6px 2px',
                    userSelect: 'none',
                  }}
                >
                  <span>{group.name}</span>
                  <span style={{ fontSize: 9, color: '#a3b8c8' }}>{group.items.length} ⌄</span>
                </summary>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {group.items.map((item) => {
                    const isSelected = selectedPart?.linkName === item.id || selectedPart?.partName === item.name;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          const info = model?.selectLinkByName(item.id);
                          if (!info) {
                            setSelectedPart({
                              linkName: item.id,
                              partName: item.name,
                              category: group.name,
                              description: item.desc,
                              materialName: item.material,
                            });
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          padding: '7px 10px',
                          border: isSelected ? '1px solid #b2d2ec' : '1px solid #e5eff6',
                          borderRadius: 7,
                          background: isSelected ? '#eaf4fd' : '#f9fcfe',
                          color: isSelected ? '#1c5586' : '#5f809c',
                          fontSize: 11,
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.15s, border-color 0.15s',
                        }}
                      >
                        <span style={{ fontWeight: isSelected ? 600 : 450 }}>{item.name}</span>
                        <span style={{ fontSize: 10, color: isSelected ? '#256da6' : '#9bb0c2' }}>↗</span>
                      </button>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* 检视器底部：选中部件详细卡片 (与用户截图完全一致) */}
        {selectedPart && (
          <footer
            style={{
              padding: '16px',
              borderTop: '1px solid #e7eff6',
              background: '#ffffff',
            }}
          >
            <h4
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 650,
                color: '#2e5170',
              }}
            >
              {selectedPart.partName}
            </h4>
            <p
              style={{
                margin: '5px 0 10px',
                fontSize: 11,
                lineHeight: 1.6,
                color: '#7694ac',
              }}
            >
              {selectedPart.description || '探索这个部件的结构与安装'}
            </p>
            {selectedPart.dimensions && (
              <div
                style={{
                  fontSize: 10,
                  color: '#496d8b',
                  background: '#f2f7fb',
                  padding: '5px 8px',
                  borderRadius: 5,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>包络尺寸</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {selectedPart.dimensions.x} × {selectedPart.dimensions.y} × {selectedPart.dimensions.z} mm
                </span>
              </div>
            )}
            {mode === 'exploded' && (
              <div
                style={{
                  fontSize: 10,
                  color: '#2e5a80',
                  background: '#eef5fc',
                  padding: '6px 8px',
                  borderRadius: 6,
                  marginTop: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#688ca8' }}>装配层级</span>
                  <span style={{ fontWeight: 600 }}>
                    {selectedPart.linkName === 'trunk' || selectedPart.linkName === 'base'
                      ? '固定装配基准 (Anchor)'
                      : selectedPart.linkName.endsWith('_hip')
                      ? '一级总成 (四足腿根)'
                      : '二级零件 (铰接展开)'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#688ca8' }}>装配父节点</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    {selectedPart.linkName === 'trunk'
                      ? 'base'
                      : selectedPart.linkName.endsWith('_hip')
                      ? 'trunk'
                      : selectedPart.linkName.endsWith('_thigh')
                      ? selectedPart.linkName.replace('_thigh', '_hip')
                      : selectedPart.linkName.endsWith('_calf')
                      ? selectedPart.linkName.replace('_calf', '_thigh')
                      : selectedPart.linkName.endsWith('_foot')
                      ? selectedPart.linkName.replace('_foot', '_calf')
                      : 'trunk'}
                  </span>
                </div>
              </div>
            )}
          </footer>
        )}
      </aside>

      {/* 巡检事件留证弹窗 */}
      {eventModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(25, 45, 65, 0.45)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setEventModalOpen(false)}
        >
          <div
            style={{
              width: 520,
              background: '#fff',
              borderRadius: 14,
              padding: 24,
              border: '1px solid #dce5ef',
              boxShadow: '0 12px 36px rgba(30, 50, 75, 0.16)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <span style={{ fontSize: 9, letterSpacing: '1px', color: '#88a3ba', fontWeight: 600 }}>
                  INSPECTION EVIDENCE / SIMULATED
                </span>
                <h3 style={{ margin: '4px 0 0', fontSize: 16, color: '#274764' }}>
                  航点 #02 配电盘发热留证
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEventModalOpen(false)}
                style={{ border: 'none', background: 'none', fontSize: 18, color: '#889eb0', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
              <div
                style={{
                  flex: 1,
                  aspectRatio: '4/3',
                  background: 'linear-gradient(135deg, #2b1055, #75157b, #b9326e, #f17841, #fde86d)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                热成像最高温 68.4℃
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: '#557692' }}>
                <div><strong>事件类型：</strong>设备局部超温</div>
                <div><strong>坐标位置：</strong>X: 0.60 m, Y: 0.00 m</div>
                <div><strong>时间戳：</strong>2026-11-12 15:10:24</div>
                <div><strong>处置建议：</strong>通知值班电工复核断路器</div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setEventModalOpen(false)}
                style={glassPillBtnStyle}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 按钮样式
const glassIconBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255, 255, 255, 0.85)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(220, 230, 240, 0.85)',
  boxShadow: '0 2px 8px rgba(45, 75, 105, 0.06)',
  color: '#557692',
  cursor: 'pointer',
  transition: 'background 0.16s, color 0.16s',
};

const activeGlassIconBtnStyle: React.CSSProperties = {
  ...glassIconBtnStyle,
  background: 'linear-gradient(135deg, #e4effb, #d5e5f5)',
  color: '#24537e',
  borderColor: '#b8d6ee',
};

const glassPillBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 7,
  border: '1px solid #cbdde9',
  background: 'rgba(255, 255, 255, 0.88)',
  backdropFilter: 'blur(10px)',
  color: '#496d8b',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: '0 2px 6px rgba(45, 75, 105, 0.05)',
  transition: 'background 0.15s, color 0.15s',
};

const pillBtnStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid #d5e3ee',
  background: '#f4f8fb',
  color: '#537592',
  fontSize: 11,
  cursor: 'pointer',
};

const activePillBtnStyle: React.CSSProperties = {
  ...pillBtnStyle,
  background: 'linear-gradient(135deg, #e4effb, #d5e5f5)',
  borderColor: '#b5d4ed',
  color: '#1f5280',
  fontWeight: 600,
};

const reqMetricCardStyle: React.CSSProperties = {
  background: '#f7faff',
  border: '1px solid #d8e6f2',
  borderRadius: 10,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
