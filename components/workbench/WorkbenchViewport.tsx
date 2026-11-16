'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { UrdfThreeModel } from './urdf/UrdfThreeModel';

export interface ViewportControlsState {
  showGrid: boolean;
  showShadows: boolean;
  showAxes: boolean;
  showWireframe: boolean;
  showReachSphere: boolean;
  autoRotate: boolean;
}

interface WorkbenchViewportProps {
  model: UrdfThreeModel | null;
  controlsState: ViewportControlsState;
  onControlsChange: (state: ViewportControlsState) => void;
  onResetView?: () => void;
  onEndEffectorPosChange?: (pos: { x: number; y: number; z: number }) => void;
}

export default function WorkbenchViewport({
  model,
  controlsState,
  onControlsChange,
  onEndEffectorPosChange,
}: WorkbenchViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const reachSphereRef = useRef<THREE.Mesh | null>(null);
  const groundMeshRef = useRef<THREE.Mesh | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());

  // 1. 初始化 Three.js 场景、相机、灯光与控制器
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f7fa); // 工业淡冰灰蓝背景 (与 EmboMiX 风格一致)
    sceneRef.current = scene;

    // 相机 (轴测初始位)
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 100);
    camera.position.set(0.65, 0.45, 0.7);
    cameraRef.current = camera;

    // 渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 轨道控制器
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 0.18, 0);
    controls.minDistance = 0.15;
    controls.maxDistance = 5.0;
    controls.maxPolarAngle = Math.PI / 2 + 0.05; // 限制在地面附近
    controlsRef.current = controls;

    // 工业柔和环境光与主阴影平行光
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
    dirLight.position.set(1.5, 2.5, 1.8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 10;
    dirLight.shadow.camera.left = -0.8;
    dirLight.shadow.camera.right = 0.8;
    dirLight.shadow.camera.top = 0.8;
    dirLight.shadow.camera.bottom = -0.8;
    dirLight.shadow.bias = -0.0002;
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const fillLight = new THREE.DirectionalLight(0xb4cdde, 0.9);
    fillLight.position.set(-1.8, 1.5, -1.2);
    scene.add(fillLight);

    // 地面平面 (接收柔和阴影与科技反射感)
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.16 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.001;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    groundMeshRef.current = groundMesh;

    // 科技细网格 (对齐 EmboMiX 蓝灰基底)
    const gridHelper = new THREE.GridHelper(4, 40, 0x8aa4bc, 0xd0dce6);
    gridHelper.position.y = 0;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // 坐标轴辅助器 (RGB -> XYZ)
    const axesHelper = new THREE.AxesHelper(0.25);
    axesHelper.visible = false;
    scene.add(axesHelper);
    axesHelperRef.current = axesHelper;

    // 工作空间半透明可达球体 (Reach Envelope)
    const reachGeo = new THREE.SphereGeometry(0.38, 32, 24);
    const reachMat = new THREE.MeshBasicMaterial({
      color: 0x3d82c4,
      transparent: true,
      opacity: 0.08,
      wireframe: true,
    });
    const reachSphere = new THREE.Mesh(reachGeo, reachMat);
    reachSphere.position.set(0, 0.15, 0);
    reachSphere.visible = false;
    scene.add(reachSphere);
    reachSphereRef.current = reachSphere;

    // 渲染循环
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // 尺寸响应
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // 2. 挂载 / 卸载机器人模型
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !model) return;

    scene.add(model.rootGroup);

    // 计算末端位置并回调
    if (onEndEffectorPosChange) {
      const pos = model.getEndEffectorWorldPosition();
      onEndEffectorPosChange({
        x: Math.round(pos.x * 1000 * 10) / 10,
        y: Math.round(pos.y * 1000 * 10) / 10,
        z: Math.round(pos.z * 1000 * 10) / 10,
      });
    }

    return () => {
      scene.remove(model.rootGroup);
    };
  }, [model, onEndEffectorPosChange]);

  // 3. 辅助控制状态响应 (网格、线框、阴影、坐标轴、可达球、自转)
  useEffect(() => {
    if (gridHelperRef.current) gridHelperRef.current.visible = controlsState.showGrid;
    if (axesHelperRef.current) axesHelperRef.current.visible = controlsState.showAxes;
    if (reachSphereRef.current) reachSphereRef.current.visible = controlsState.showReachSphere;
    if (groundMeshRef.current) groundMeshRef.current.visible = controlsState.showShadows;
    if (controlsRef.current) controlsRef.current.autoRotate = controlsState.autoRotate;
    if (model) model.setWireframe(controlsState.showWireframe);
  }, [controlsState, model]);

  // 4. 视角切换函数
  const setCameraView = useCallback((preset: 'iso' | 'front' | 'side' | 'top') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    controls.target.set(0, 0.18, 0);

    switch (preset) {
      case 'iso':
        camera.position.set(0.65, 0.45, 0.7);
        break;
      case 'front':
        camera.position.set(0, 0.28, 0.85);
        break;
      case 'side':
        camera.position.set(0.85, 0.28, 0);
        break;
      case 'top':
        camera.position.set(0.001, 1.0, 0.001);
        break;
    }
    camera.lookAt(controls.target);
    controls.update();
  }, []);

  // 5. 点击拾取模型零件 (Raycasting)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!container || !camera || !model) return;

    const rect = container.getBoundingClientRect();
    mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.current.setFromCamera(mouse.current, camera);
    model.raycast(raycaster.current);

    if (onEndEffectorPosChange) {
      const pos = model.getEndEffectorWorldPosition();
      onEndEffectorPosChange({
        x: Math.round(pos.x * 1000 * 10) / 10,
        y: Math.round(pos.y * 1000 * 10) / 10,
        z: Math.round(pos.z * 1000 * 10) / 10,
      });
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* 视口浮动快捷视角控制条 (复用 EmboMiX 磨砂按钮风格) */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 16,
          zIndex: 10,
          display: 'flex',
          gap: 6,
          background: 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(12px)',
          padding: '4px 6px',
          borderRadius: 8,
          border: '1px solid rgba(220, 230, 240, 0.8)',
          boxShadow: '0 2px 10px rgba(50, 75, 100, 0.06)',
        }}
      >
        <button
          type="button"
          onClick={() => setCameraView('iso')}
          style={btnStyle}
          title="轴测视角"
        >
          轴测
        </button>
        <button
          type="button"
          onClick={() => setCameraView('front')}
          style={btnStyle}
          title="正视视角"
        >
          正视
        </button>
        <button
          type="button"
          onClick={() => setCameraView('side')}
          style={btnStyle}
          title="侧视视角"
        >
          侧视
        </button>
        <button
          type="button"
          onClick={() => setCameraView('top')}
          style={btnStyle}
          title="俯视视角"
        >
          俯视
        </button>
      </div>

      {/* 视口右上方辅助显示开关 */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 16,
          zIndex: 10,
          display: 'flex',
          gap: 6,
          background: 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(12px)',
          padding: '4px 6px',
          borderRadius: 8,
          border: '1px solid rgba(220, 230, 240, 0.8)',
          boxShadow: '0 2px 10px rgba(50, 75, 100, 0.06)',
        }}
      >
        <button
          type="button"
          onClick={() => onControlsChange({ ...controlsState, showGrid: !controlsState.showGrid })}
          style={controlsState.showGrid ? activeBtnStyle : btnStyle}
          title="切换地面参考网格"
        >
          网格
        </button>
        <button
          type="button"
          onClick={() => onControlsChange({ ...controlsState, showAxes: !controlsState.showAxes })}
          style={controlsState.showAxes ? activeBtnStyle : btnStyle}
          title="切换世界坐标轴"
        >
          坐标轴
        </button>
        <button
          type="button"
          onClick={() => onControlsChange({ ...controlsState, showWireframe: !controlsState.showWireframe })}
          style={controlsState.showWireframe ? activeBtnStyle : btnStyle}
          title="切换线框结构视图"
        >
          线框
        </button>
        <button
          type="button"
          onClick={() => onControlsChange({ ...controlsState, showReachSphere: !controlsState.showReachSphere })}
          style={controlsState.showReachSphere ? activeBtnStyle : btnStyle}
          title="显示末端工作空间包络"
        >
          包络球
        </button>
        <button
          type="button"
          onClick={() => onControlsChange({ ...controlsState, autoRotate: !controlsState.autoRotate })}
          style={controlsState.autoRotate ? activeBtnStyle : btnStyle}
          title="自动旋转环绕演示"
        >
          自转
        </button>
      </div>

      {/* 视口左下角提示 */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 16,
          zIndex: 5,
          fontSize: 11,
          color: '#8aa3b8',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span>左键拖拽旋转 · 右键平移 · 滚轮缩放 · 点击零件检视</span>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '5px 9px',
  borderRadius: 5,
  fontSize: 11,
  color: '#557490',
  cursor: 'pointer',
  transition: 'background 0.16s, color 0.16s',
};

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'linear-gradient(135deg, #e4effb, #d5e5f5)',
  color: '#285885',
  fontWeight: 600,
};
