'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createProject, checkProjectName } from '../../../lib/api';

export default function NewProjectPage() {
  const router = useRouter();

  // 项目名称输入状态 (对标截图中的 Build an ...)
  const [projectName, setProjectName] = useState('');

  // 分类单选状态: 'automation' (非标自动化) | 'embodied' (具身智能) | null
  const [selectedCategory, setSelectedCategory] = useState<'automation' | 'embodied' | null>(null);

  // 构建加载状态
  const [isBuilding, setIsBuilding] = useState(false);

  // 项目名称唯一性校验状态
  const [nameError, setNameError] = useState<string | null>(null);
  const [isCheckingName, setIsCheckingName] = useState(false);

  // 异步请求取消控制器，防止连续输入产生竞态覆盖
  const abortControllerRef = useRef<AbortController | null>(null);

  // 项目名称输入框引用，便于选择分类后自动聚焦
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Toast 提示
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // 页面卸载时清理未完成的异步查重请求
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // 检查项目名称可用性 (忽略大小写, 根据当前用户校验)
  const checkNameAvailability = useCallback(async (nameToCheck: string): Promise<'AVAILABLE' | 'TAKEN' | 'ERROR'> => {
    const trimmed = nameToCheck.trim();
    if (!trimmed) {
      setNameError(null);
      return 'AVAILABLE';
    }

    // 中断上一个进行中的查重请求，杜绝竞态响应错乱
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsCheckingName(true);
    try {
      const res = await checkProjectName({
        name: trimmed,
        signal: controller.signal,
      });

      // 竞态守卫：若已有后续请求发起，静默丢弃过时响应
      if (abortControllerRef.current !== controller) {
        return 'ERROR';
      }

      if (res.data) {
        if (res.data.exists) {
          setNameError(`该名称“${trimmed}”已存在，请换一个项目名`);
          return 'TAKEN';
        } else {
          setNameError(null);
          return 'AVAILABLE';
        }
      }
      console.error('Check project name error:', res.error);
      return 'ERROR';
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        // 请求被主动取消，不视为错误
        return 'ERROR';
      }
      console.error('Failed to check project name:', err);
      return 'ERROR';
    } finally {
      if (abortControllerRef.current === controller) {
        setIsCheckingName(false);
      }
    }
  }, []);

  // 停止输入 400ms 后自动触发防抖查重
  useEffect(() => {
    const trimmed = projectName.trim();
    if (!trimmed) {
      setNameError(null);
      return;
    }

    const timer = setTimeout(() => {
      checkNameAvailability(trimmed);
    }, 400);

    return () => clearTimeout(timer);
  }, [projectName, checkNameAvailability]);

  // 单选切换项目分类
  const handleSelectCategory = (category: 'automation' | 'embodied', name: string) => {
    setSelectedCategory(category);
    // 若用户尚未输入项目名，自动填充推荐名称（会触发 useEffect 查重，避免重复调用）
    if (!projectName.trim()) {
      const defaultName =
        category === 'automation'
          ? '工业自动化非标定制流水线系统'
          : '双臂协作装配机械臂控制系统';
      setProjectName(defaultName);
    }
    // 顺畅聚焦到下方的项目名称输入框
    setTimeout(() => {
      inputRef.current?.focus();
    }, 60);
    showToast(`✓ 已选择工程类型：【${name}】`);
  };

  // 点击新建项目按钮逻辑 (必须已选择工程类型)
  const handleBuild = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // 校验：必须先选择分类
    if (!selectedCategory) {
      showToast('⚠️ 新建项目前请先在上方选择一个工程分类（非标自动化 或 具身智能）！');
      return;
    }

    const rawName = projectName.trim() || (selectedCategory === 'automation' ? '工业自动化非标定制流水线系统' : '双臂协作装配机械臂控制系统');

    // 新建前校验：项目名称唯一性
    const checkStatus = await checkNameAvailability(rawName);
    if (checkStatus === 'TAKEN') {
      showToast(`❌ 项目名称“${rawName}”已被占用，请修改后再新建！`);
      return;
    }
    if (checkStatus === 'ERROR') {
      showToast('⚠️ 无法验证项目名称可用性，请检查网络连接后重试');
      return;
    }

    setIsBuilding(true);
    showToast(`🚀 正在创建【${selectedCategory === 'automation' ? '非标自动化' : '具身智能'}】项目《${rawName}》...`);

    try {
      const res = await createProject({
        body: {
          name: rawName,
          projectType: selectedCategory === 'automation' ? 'AUTOMATION' : 'EMBODIED_AI',
        },
      });

      if (res.error || !res.data) {
        const errMsg = (res.error as any)?.error?.message || '创建项目失败，请稍后重试';
        if ((res.error as any)?.error?.code === 'PROJECT_NAME_EXISTS') {
          setNameError(`该名称“${rawName}”已被占用，请换一个名称`);
        }
        showToast(`❌ ${errMsg}`);
        setIsBuilding(false);
        return;
      }

      showToast(`✓ 项目《${res.data.name}》创建成功，正在进入项目...`);
      const targetUrl =
        res.data.projectType === 'AUTOMATION' || selectedCategory === 'automation'
          ? `/projects/${res.data.id}/equipment`
          : `/projects/${res.data.id}`;
      router.push(targetUrl);
    } catch (err: any) {
      showToast(`❌ ${err?.message || '网络连接异常，创建失败'}`);
      setIsBuilding(false);
    }
  };

  return (
    <div className="np-page-root">
      {/* 提示消息 Toast */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a',
            color: '#ffffff',
            padding: '10px 22px',
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 9999,
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* 顶部工具栏 (保持一致的高水准) */}
      <header className="np-topbar">
        <div className="np-topbar-left">
          <Link href="/projects" className="np-back-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>返回</span>
          </Link>
        </div>

        <div className="np-topbar-center">
          <span>新项目</span>
        </div>

        <div className="np-topbar-right">
          <button type="button" className="np-icon-btn" title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div className="np-avatar-circle" title="User Account: xxxrpv-6393" />
        </div>
      </header>

      {/* 主体区域 */}
      <main
        className="np-main"
        style={{
          padding: "20px 32px 48px",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        {/* 顶部标题区 (保持原版 38px 经典大标题与 1040px 定宽左对齐) */}
        <div className="np-hero-header" style={{ maxWidth: 1040, margin: "0 auto 20px", width: "100%" }}>
          <div>
            <h1 className="np-hero-title">Let&apos;s build something new</h1>
            <p className="np2-hero-subtitle">
              选择适合您的项目工程类型，系统将针对性提供定制化方案设计与智能推演工作流。
            </p>
          </div>
        </div>

        {/* 工程分类双卡片区域 (1040px 居中定宽，高度拉长至 290px，舒展充盈不局促) */}
        <div className="np3-tiles-container" style={{ maxWidth: 1040, margin: "0 auto 24px", width: "100%" }}>
          <div className="np2-tiles-grid" style={{ gap: 24 }}>
            {/* 方块 1: 非标自动化 */}
            <div
              className={`np2-tile-card ${selectedCategory === "automation" ? "selected" : ""}`}
              onClick={() => handleSelectCategory("automation", "非标自动化")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleSelectCategory("automation", "非标自动化");
                }
              }}
              style={
                selectedCategory === "automation"
                  ? {
                      borderColor: "#0284c7",
                      boxShadow: "0 0 0 2.5px #0284c7, 0 14px 32px -4px rgba(2, 132, 199, 0.16)",
                      transition: "all 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
                    }
                  : { transition: "all 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }
              }
            >
              {/* 背景水印微图标 (保留设计感) */}
              <svg className="np2-tile-watermark" width="180" height="180" viewBox="0 0 24 24" fill="currentColor">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>

              <div>
                <div className="np2-tile-top" style={{ marginBottom: 16 }}>
                  <div className="np2-tile-icon-box" style={{ background: "#f0f9ff", color: "#0284c7" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2" />
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      <circle cx="12" cy="14" r="2" />
                    </svg>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {selectedCategory === "automation" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#0284c7", color: "#ffffff", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 9999 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>已选定</span>
                      </span>
                    ) : (
                      <span className="np2-tile-badge" style={{ background: "#f0f9ff", color: "#0284c7", border: "1px solid #bae6fd" }}>
                        Industrial
                      </span>
                    )}
                  </div>
                </div>

                <div className="np2-tile-title-row" style={{ marginBottom: 8 }}>
                  <div className="np2-tile-title">非标自动化</div>
                  <div className="np2-tile-en">Non-Standard Automation</div>
                </div>

                <p className="np2-tile-desc" style={{ marginBottom: 18 }}>
                  面向现代工业制造的定制化装配与非标产线方案。涵盖机构选型设计、气动电气元件匹配与 PLC 时序逻辑节拍推演。
                </p>

                {/* 2×2 对称网格标签组 (拉长空间后从容舒展，左右严格齐平对称) */}
                <div
                  className="np2-tile-tags"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "8px 10px",
                    marginBottom: 20,
                  }}
                >
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    工业流水线
                  </span>
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    非标机构选型
                  </span>
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    PLC时序控制
                  </span>
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    节拍仿真优化
                  </span>
                </div>
              </div>

              {/* 底部行动条 (精简文案) */}
              <div
                className="np2-tile-action-btn"
                style={{
                  background: selectedCategory === "automation" ? "#0284c7" : "#f8fafc",
                  color: selectedCategory === "automation" ? "#ffffff" : "#0284c7",
                  border: selectedCategory === "automation" ? "none" : "1px solid #bae6fd",
                  transition: "all 0.15s ease",
                  padding: "10px 18px",
                  fontSize: 13,
                }}
              >
                <span>{selectedCategory === "automation" ? "✓ 已选定【非标自动化】" : "选择【非标自动化】 →"}</span>
                {selectedCategory !== "automation" && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                )}
              </div>
            </div>

            {/* 方块 2: 具身智能 */}
            <div
              className={`np2-tile-card ${selectedCategory === "embodied" ? "selected" : ""}`}
              onClick={() => handleSelectCategory("embodied", "具身智能")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleSelectCategory("embodied", "具身智能");
                }
              }}
              style={
                selectedCategory === "embodied"
                  ? {
                      borderColor: "#10b981",
                      boxShadow: "0 0 0 2.5px #10b981, 0 14px 32px -4px rgba(16, 185, 129, 0.16)",
                      transition: "all 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
                    }
                  : { transition: "all 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }
              }
            >
              {/* 背景水印微图标 (保留设计感) */}
              <svg className="np2-tile-watermark" width="180" height="180" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
                <line x1="8" y1="16" x2="8" y2="16" />
                <line x1="16" y1="16" x2="16" y2="16" />
              </svg>

              <div>
                <div className="np2-tile-top" style={{ marginBottom: 16 }}>
                  <div className="np2-tile-icon-box" style={{ background: "#ecfdf5", color: "#10b981" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="10" rx="2" />
                      <circle cx="12" cy="5" r="2" />
                      <path d="M12 7v4" />
                      <line x1="8" y1="16" x2="8.01" y2="16" />
                      <line x1="16" y1="16" x2="16.01" y2="16" />
                    </svg>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {selectedCategory === "embodied" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#10b981", color: "#ffffff", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 9999 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>已选定</span>
                      </span>
                    ) : (
                      <span className="np2-tile-badge" style={{ background: "#ecfdf5", color: "#10b981", border: "1px solid #a7f3d0" }}>
                        Next-Gen AI
                      </span>
                    )}
                  </div>
                </div>

                <div className="np2-tile-title-row" style={{ marginBottom: 8 }}>
                  <div className="np2-tile-title">具身智能</div>
                  <div className="np2-tile-en">Embodied AI & Robotics</div>
                </div>

                <p className="np2-tile-desc" style={{ marginBottom: 18 }}>
                  面向泛化机器人的软硬件一体化创新。覆盖双臂柔性协作、多模态具身视觉、Simcore 物理仿真引擎与强化学习虚实闭环。
                </p>

                {/* 2×2 对称网格标签组 (拉长空间后从容舒展，左右严格齐平对称) */}
                <div
                  className="np2-tile-tags"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "8px 10px",
                    marginBottom: 20,
                  }}
                >
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                    </svg>
                    双臂柔性装配
                  </span>
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                    强化学习训练
                  </span>
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="m4.93 4.93 4.24 4.24" />
                      <path d="m14.83 9.17 4.24-4.24" />
                      <path d="m14.83 14.83 4.24 4.24" />
                      <path d="m9.17 14.83-4.24 4.24" />
                    </svg>
                    Sim2Real闭环
                  </span>
                  <span className="np2-tile-tag" style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M9 3v18" />
                      <path d="M15 3v18" />
                    </svg>
                    具身通用大脑
                  </span>
                </div>
              </div>

              {/* 底部行动条 (精简文案) */}
              <div
                className="np2-tile-action-btn"
                style={{
                  background: selectedCategory === "embodied" ? "#0f172a" : "#f8fafc",
                  color: selectedCategory === "embodied" ? "#ffffff" : "#0f172a",
                  border: selectedCategory === "embodied" ? "none" : "1px solid #cbd5e1",
                  transition: "all 0.15s ease",
                  padding: "10px 18px",
                  fontSize: 13,
                }}
              >
                <span>{selectedCategory === "embodied" ? "✓ 已选定【具身智能】" : "选择【具身智能】 →"}</span>
                {selectedCategory !== "embodied" && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 核心项目名输入框与新建按钮 (1040px 居中对齐，与卡片齐平，新建按钮改回原样) */}
        <div className="np3-prompt-container" style={{ maxWidth: 1040, margin: "0 auto", width: "100%" }}>
          <form
            className="np-prompt-box"
            onSubmit={handleBuild}
            style={{
              borderColor: nameError ? "#ef4444" : (selectedCategory ? "#0f172a" : undefined),
              boxShadow: nameError
                ? "0 0 0 2px rgba(239, 68, 68, 0.15)"
                : (selectedCategory ? "0 0 0 2px rgba(15, 23, 42, 0.08)" : undefined),
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* 左侧小旗帜图标 */}
            <div className="np-prompt-logo" title="项目名称">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
            </div>

            <input
              ref={inputRef}
              type="text"
              className="np-prompt-input"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                if (nameError) setNameError(null);
              }}
              onBlur={() => {
                if (projectName.trim()) {
                  checkNameAvailability(projectName.trim());
                }
              }}
              placeholder={
                selectedCategory
                  ? `Build an ... (输入项目名称，如：${selectedCategory === "automation" ? "工业自动化非标定制流水线系统" : "双臂协作装配机械臂控制系统"})`
                  : "Build an ... (输入项目名称，如：双臂协作装配机械臂控制系统)"
              }
              disabled={isBuilding}
            />

            {/* 新建按钮：改回原样 (保持深黑常亮与坚实手感，未选分类点击由 handleBuild 弹出 Toast 提示) */}
            <button
              type="submit"
              className="np-build-btn"
              disabled={isBuilding}
              title={!selectedCategory ? "请先在上方选择一个工程分类" : (nameError ? "项目名称已被占用" : "点击新建项目")}
            >
              {isBuilding ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span>正在新建...</span>
                </>
              ) : (
                <span>新建</span>
              )}
            </button>
          </form>

          {/* 重名警告提示 */}
          {nameError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                padding: "8px 14px",
                borderRadius: 8,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#dc2626",
                fontSize: 12,
                fontWeight: 500,
                transition: "all 0.2s ease",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{nameError}</span>
            </div>
          )}

          {/* 底部轻量提示 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, padding: "0 4px", fontSize: 12, color: "#64748b" }}>
            <span>
              * 点击 <strong>新建</strong> 前请先在上方选定工程分类
            </span>
            {selectedCategory && (
              <span style={{ color: "#0f172a", fontWeight: 600 }}>
                ✓ 当前选定：{selectedCategory === "automation" ? "非标自动化" : "具身智能"}
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
