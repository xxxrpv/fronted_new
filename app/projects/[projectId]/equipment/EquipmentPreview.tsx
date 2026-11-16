/**
 * 在浏览器中安全解析和渲染 GLB，保留既有 Three.js 视图交互。
 * 文件来自平台本地预览代理，使用方案回执判断就绪，不依赖 Workspace 文件 ID。
 */
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fetchLocalPreview } from '../../../../lib/equipment/equipment-service';
import { validateGlbSecurity } from '../../../../lib/equipment/glb-security';
export { validateGlbSecurity };

export interface EquipmentPreviewProps {
  projectId: string;
  batchId: string;
  previewReady?: boolean;
  previewSha256?: string | null;
  fileName?: string | null;
  alternativeId: string;
  alternativeTitle?: string;
}

export default function EquipmentPreview({
  projectId,
  batchId,
  previewReady,
  previewSha256,
  fileName,
  alternativeId,
  alternativeTitle,
}: EquipmentPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const retryLoad = useCallback(() => {
    setError(null);
    setReloadTrigger((v) => v + 1);
  }, []);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    if (!previewReady) {
      setError('当前方案三维预览模型文件尚在准备中或暂不可用');
      setIsLoading(false);
      return;
    }

    let isDisposed = false;
    let animFrameId = 0;
    const abortController = new AbortController();

    setIsLoading(true);
    setError(null);
    container.dataset.modelLoaded = 'false';

    // 释放 Object3D 资源（包含几何、材质与纹理）
    const disposeObject = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            for (const mat of materials) {
              // 释放可能附带的纹理贴图
              for (const key of Object.keys(mat)) {
                const value = (mat as any)[key];
                if (value && typeof value.dispose === 'function') {
                  value.dispose();
                }
              }
              mat.dispose();
            }
          }
        }
      });
    };

    // 1. 初始化 Three.js 基础场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
    // 严格遵循原 Z-up 坐标系统
    camera.up.set(0, 0, 1);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError('无法启用 WebGL 三维预览环境，请检查浏览器硬件加速或直接下载 GLB 模型');
      setIsLoading(false);
      return;
    }

    renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
    const initialWidth = container.clientWidth || 600;
    const initialHeight = container.clientHeight || 400;
    renderer.setSize(initialWidth, initialHeight);
    camera.aspect = initialWidth / initialHeight;
    camera.updateProjectionMatrix();

    // 挂载 Canvas
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // 灯光配置（复用原 preview 设定）
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x777777, 3);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 3);
    dirLight.position.set(2, 3, 5);
    scene.add(dirLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 尺寸监听自适应
    const resizeObserver = new ResizeObserver(() => {
      if (isDisposed || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    });
    resizeObserver.observe(container);

    // 动画渲染帧
    const renderLoop = () => {
      if (isDisposed) return;
      animFrameId = requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    // 2. 通过 SDK 获取受控二进制流并用 LoadingManager 安全解析
    fetchLocalPreview(projectId, batchId, alternativeId, 'arrayBuffer', abortController.signal, previewSha256)
      .then((data) => {
        if (isDisposed) return;

        // 安全管理器：严禁发起外部网络请求，仅允许内嵌 data: 或当前解析流程动态生成的 blob: 资源
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          // 仅允许内部内嵌资源（data: 或当前解析流程动态生成的 blob:），拒绝任何相对、绝对或未经授权的外部预置协议
          if (url.startsWith('data:')) {
            return url;
          }
          if (url.startsWith('blob:')) {
            return url;
          }
          throw new Error(`拒绝未经平台代理的外部模型资源引用: ${url}`);
        });

        const loader = new GLTFLoader(manager);
        const arrayBuffer = data as ArrayBuffer;

        try {
          validateGlbSecurity(arrayBuffer);
        } catch (valErr: any) {
          setIsLoading(false);
          setError(`模型存在非安全外部引用风险（${valErr?.message || '非法资源引用'}），已终止加载`);
          return;
        }

        loader.parse(
          arrayBuffer,
          '',
          (gltf) => {
              if (isDisposed) {
              disposeObject(gltf.scene);
              return;
            }

            scene.add(gltf.scene);
            container.dataset.modelLoaded = 'true';
            setIsLoading(false);

            // 视口与包围盒自适应
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const center = box.getCenter(new THREE.Vector3());
            const sizeVector = box.getSize(new THREE.Vector3());
            const size = sizeVector.length() || 1;

            camera.position.copy(center).add(new THREE.Vector3(size, -size, size * 0.7));
            controls.target.copy(center);
            controls.update();
          },
          (parseError) => {
              if (isDisposed) return;
            setIsLoading(false);
            const errMsg =
              parseError instanceof Error ? parseError.message : '模型数据解析异常';
            setError(`模型解析失败（${errMsg}），请重新读取或下载模型查看`);
          }
        );
      })
      .catch((err) => {
        if (isDisposed || abortController.signal.aborted) return;
        setIsLoading(false);
        const errMsg = err instanceof Error ? err.message : '网络或服务读取异常';
        setError(`模型加载中断（${errMsg}），请点击下方重试，无需重新生成方案`);
      });

    // 3. 清理资源：保证切换模型或卸载时不泄露内存
    return () => {
      isDisposed = true;
      abortController.abort();
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [projectId, batchId, previewReady, previewSha256, alternativeId, reloadTrigger]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 400 }}>
      {/* 3D Canvas 挂载容器 */}
      <div
        ref={hostRef}
        style={{
          width: '100%',
          height: 420,
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          borderRadius: 8,
          overflow: 'hidden',
          display: 'block',
        }}
        tabIndex={0}
        aria-label={`${alternativeTitle || alternativeId} 三维预览视图，拖动鼠标旋转，滚轮缩放`}
      />

      {/* 加载中遮罩 */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(248, 250, 252, 0.75)',
            backdropFilter: 'blur(2px)',
            borderRadius: 8,
            zIndex: 10,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: '3px solid #cbd5e1',
              borderTopColor: '#0284c7',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              marginBottom: 12,
            }}
          />
          <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
            正在安全获取并解析 GLB 模型...
          </span>
        </div>
      )}

      {/* 错误提示与重试 */}
      {error && !isLoading && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'rgba(255, 255, 255, 0.9)',
            borderRadius: 8,
            zIndex: 10,
            textAlign: 'center',
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            style={{ marginBottom: 12 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ fontSize: 13, color: '#b91c1c', marginBottom: 14, maxWidth: 440 }}>
            {error}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={retryLoad}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: 600,
                color: '#ffffff',
                background: '#0f172a',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              重新读取模型
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
