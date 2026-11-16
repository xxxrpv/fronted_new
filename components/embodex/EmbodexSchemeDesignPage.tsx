/**
 * 方案设计页面的原有三栏外壳，负责侧栏导航、零件清单和旧版设计入口。
 * Hub 模式通过可选插槽替换 UE 与聊天内容，继续复用本文件的布局和样式。
 * 未传入插槽时保留原有行为；传入后不恢复旧构建任务，也不进入旧发布流程。
 * 数据通信由各模式自己的控制器负责，外壳仅分发导航和用户点击动作。
 */
'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { EmbodexPartsSession, initialPartsState } from '../../lib/embodex/parts';
import type { ModelImportEvent } from '../../lib/embodex/conversation';
import ProjectUeViewer from '../ue/ProjectUeViewer';
import EmbodexBaselineBuildPanel from './EmbodexBaselineBuildPanel';
import ExistingBuildArtifacts from './ExistingBuildArtifacts';
import EmbodexPublicationForm from './EmbodexPublicationForm';
import { EmbodexBuildSession, readDesignRecovery, writeDesignRecovery } from '../../lib/embodex/design-workflow';

type ViewMode = 'parts' | 'ue';
type JointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic';

interface PartItem {
  uid: string;
  label: string;
  role: string;
  parentLink: string;
  visualsCount: number;
  linkName: string;
  jointType: JointType;
  xyz: string;
  rpy: string;
  axis: string;
}

// 23 个零件初始数据集 (严格对标参考图中的足式机器人 / Unitree A1 拓扑)
const INITIAL_PARTS: PartItem[] = [
  {
    uid: 'part-base',
    label: 'Base',
    role: '底座 / 安装结构',
    parentLink: 'world',
    visualsCount: 1,
    linkName: 'base',
    jointType: 'fixed',
    xyz: '0 0 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-trunk',
    label: 'Trunk',
    role: '机器人刚性 Link',
    parentLink: 'base',
    visualsCount: 1,
    linkName: 'trunk',
    jointType: 'fixed',
    xyz: '0 0 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-imu',
    label: 'Imu Link',
    role: '惯导传感器',
    parentLink: 'trunk',
    visualsCount: 1,
    linkName: 'imu_link',
    jointType: 'fixed',
    xyz: '0 0 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-fr-hip',
    label: 'FR Hip',
    role: '机器人刚性 Link',
    parentLink: 'trunk',
    visualsCount: 1,
    linkName: 'FR_hip',
    jointType: 'revolute',
    xyz: '0.1805 -0.047 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-fr-thigh-shoulder',
    label: 'FR Thigh Shoulder',
    role: '肩部关节模块',
    parentLink: 'FR_hip',
    visualsCount: 1,
    linkName: 'FR_thigh_shoulder',
    jointType: 'revolute',
    xyz: '0 -0.083 0',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-fr-thigh',
    label: 'FR Thigh',
    role: '机器人刚性 Link',
    parentLink: 'FR_thigh_shoulder',
    visualsCount: 1,
    linkName: 'FR_thigh',
    jointType: 'fixed',
    xyz: '0 0 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-fr-calf',
    label: 'FR Calf',
    role: '机器人刚性 Link',
    parentLink: 'FR_thigh',
    visualsCount: 1,
    linkName: 'FR_calf',
    jointType: 'revolute',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-fr-foot',
    label: 'FR Foot',
    role: '机器人刚性 Link',
    parentLink: 'FR_calf',
    visualsCount: 1,
    linkName: 'FR_foot',
    jointType: 'fixed',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-fl-hip',
    label: 'FL Hip',
    role: '机器人刚性 Link',
    parentLink: 'trunk',
    visualsCount: 1,
    linkName: 'FL_hip',
    jointType: 'revolute',
    xyz: '0.1805 0.047 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-fl-thigh-shoulder',
    label: 'FL Thigh Shoulder',
    role: '肩部关节模块',
    parentLink: 'FL_hip',
    visualsCount: 1,
    linkName: 'FL_thigh_shoulder',
    jointType: 'revolute',
    xyz: '0 0.083 0',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-fl-thigh',
    label: 'FL Thigh',
    role: '机器人刚性 Link',
    parentLink: 'FL_thigh_shoulder',
    visualsCount: 1,
    linkName: 'FL_thigh',
    jointType: 'fixed',
    xyz: '0 0 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-fl-calf',
    label: 'FL Calf',
    role: '机器人刚性 Link',
    parentLink: 'FL_thigh',
    visualsCount: 1,
    linkName: 'FL_calf',
    jointType: 'revolute',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-fl-foot',
    label: 'FL Foot',
    role: '机器人刚性 Link',
    parentLink: 'FL_calf',
    visualsCount: 1,
    linkName: 'FL_foot',
    jointType: 'fixed',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-rr-hip',
    label: 'RR Hip',
    role: '机器人刚性 Link',
    parentLink: 'trunk',
    visualsCount: 1,
    linkName: 'RR_hip',
    jointType: 'revolute',
    xyz: '-0.1805 -0.047 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-rr-thigh-shoulder',
    label: 'RR Thigh Shoulder',
    role: '肩部关节模块',
    parentLink: 'RR_hip',
    visualsCount: 1,
    linkName: 'RR_thigh_shoulder',
    jointType: 'revolute',
    xyz: '0 -0.083 0',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-rr-thigh',
    label: 'RR Thigh',
    role: '机器人刚性 Link',
    parentLink: 'RR_thigh_shoulder',
    visualsCount: 1,
    linkName: 'RR_thigh',
    jointType: 'fixed',
    xyz: '0 0 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-rr-calf',
    label: 'RR Calf',
    role: '机器人刚性 Link',
    parentLink: 'RR_thigh',
    visualsCount: 1,
    linkName: 'RR_calf',
    jointType: 'revolute',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-rr-foot',
    label: 'RR Foot',
    role: '机器人刚性 Link',
    parentLink: 'RR_calf',
    visualsCount: 1,
    linkName: 'RR_foot',
    jointType: 'fixed',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-rl-hip',
    label: 'RL Hip',
    role: '机器人刚性 Link',
    parentLink: 'trunk',
    visualsCount: 1,
    linkName: 'RL_hip',
    jointType: 'revolute',
    xyz: '-0.1805 0.047 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-rl-thigh-shoulder',
    label: 'RL Thigh Shoulder',
    role: '肩部关节模块',
    parentLink: 'RL_hip',
    visualsCount: 1,
    linkName: 'RL_thigh_shoulder',
    jointType: 'revolute',
    xyz: '0 0.083 0',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-rl-thigh',
    label: 'RL Thigh',
    role: '机器人刚性 Link',
    parentLink: 'RL_thigh_shoulder',
    visualsCount: 1,
    linkName: 'RL_thigh',
    jointType: 'fixed',
    xyz: '0 0 0',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
  {
    uid: 'part-rl-calf',
    label: 'RL Calf',
    role: '机器人刚性 Link',
    parentLink: 'RL_thigh',
    visualsCount: 1,
    linkName: 'RL_calf',
    jointType: 'revolute',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 1 0',
  },
  {
    uid: 'part-rl-foot',
    label: 'RL Foot',
    role: '机器人刚性 Link',
    parentLink: 'RL_calf',
    visualsCount: 1,
    linkName: 'RL_foot',
    jointType: 'fixed',
    xyz: '0 0 -0.2',
    rpy: '0 0 0',
    axis: '0 0 1',
  },
];

// 5 阶段进度数据 (方案设计为当前活跃阶段 1)
const WORKFLOW_STAGES = [
  { id: 1, name: 'Embodex・方案设计', status: 'active', link: '/embodex' },
  { id: 2, name: 'Lexis・自动编程', status: 'pending' },
  { id: 3, name: 'Simcore・仿真训练', status: 'pending', link: '/simcore' },
  { id: 4, name: 'Embokit・算法管理', status: 'pending', link: '/algorithms' },
  { id: 5, name: 'Deplox・真机部署', status: 'pending', link: '/deploy' },
];

export default function EmbodexSchemeDesignPage({ projectId, managed }: { projectId?: string; managed?: { viewer: React.ReactNode; chat: React.ReactNode; publish: () => void } } = {}) {
  // 视图模式: 'parts' (零件清单) | 'ue' (UE交互)
  const [activeView, setActiveView] = useState<ViewMode>(managed ? 'ue' : 'parts');
  const [showBanner, setShowBanner] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [demoParts, setParts] = useState<PartItem[]>(INITIAL_PARTS);
  const auth=useAuth(),userId=auth.status==='authenticated'?auth.user?.id||'':'';
  const [storedParts,setRealParts]=useState(()=>initialPartsState(userId,projectId||''));
  const modelSession=useRef<EmbodexPartsSession|null>(null);
  const mounted=useRef(true);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;modelSession.current?.dispose();modelSession.current=null;buildSession.current?.dispose();buildSession.current=null;};},[userId,projectId]);
  const ownerRef=useRef(`${userId}:${projectId||''}`);ownerRef.current=`${userId}:${projectId||''}`;
  const currentModelSession=()=>{const current=modelSession.current;return mounted.current&&ownerRef.current===`${userId}:${projectId||''}`&&current?.userId===userId&&current.projectId===projectId?current:null;};
  const real=storedParts.userId===userId&&storedParts.projectId===(projectId||'')?storedParts:initialPartsState(userId,projectId||'');
  const parts=projectId?real.parts:demoParts;
  const [importTask,setImportTask]=useState<{userId:string;projectId:string;taskId:string}|null>(null);
  const [importNotice,setImportNotice]=useState<{userId:string;projectId:string;text:string}|null>(null);
  const activeImport=importTask?.userId===userId&&importTask.projectId===projectId?importTask:null;
  useEffect(()=>{setRealParts(initialPartsState(userId,projectId||''));if(!userId||!projectId)return;
    const current=new EmbodexPartsSession(userId,projectId,setRealParts);modelSession.current=current;void current.loadRobots();
    return()=>{current.dispose();if(modelSession.current===current)modelSession.current=null;};
  },[userId,projectId]);
  const onModelImport=(event:ModelImportEvent)=>{if(!mounted.current||!userId||event.projectId!==projectId||ownerRef.current!==`${userId}:${projectId||''}`)return;
    if(event.status==='TASK_CREATED'&&event.taskId){setImportTask({userId,projectId:projectId!,taskId:event.taskId});const url=new URL(window.location.href);url.searchParams.set('taskId',event.taskId);window.history.replaceState(window.history.state,'',url);setImportNotice({userId,projectId:projectId!,text:'模型导入任务已登记，正在核实平台产物。'});}
    else setImportNotice({userId,projectId:projectId!,text:event.status==='NOT_IMPORTED'?'本轮未导入模型；工具反馈不是平台产物。':'本轮模型导入未确认；请恢复已有任务核实，不会自动重发。'});
  };
  const downloadBlob=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();URL.revokeObjectURL(url);};
  const downloadPackage=async()=>{const current=currentModelSession();const selected=current?.state.selectedId;const blob=await current?.downloadPackage();if(blob&&current===currentModelSession()&&selected===current?.state.selectedId)downloadBlob(blob,'robot-runtime-model-package.zip');};
  const [highlightedUid, setHighlightedUid] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [showBuildArtifacts,setShowBuildArtifacts]=useState(false);
  const artifactsDialog=useRef<HTMLDialogElement|null>(null);

  const partCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [showPublicationDialog, setShowPublicationDialog] = useState(false);
  const [publicationSubmitting, setPublicationSubmitting] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const publicationDialog = useRef<HTMLDialogElement | null>(null);
  const buildSession = useRef<EmbodexBuildSession | null>(null);
  const [publicationTask,setPublicationTask]=useState<{userId:string;projectId:string;taskId:string}|null>(null);
  const activePublication=publicationTask?.userId===userId&&publicationTask.projectId===projectId?publicationTask:null;
  useLayoutEffect(()=>{
    setPublicationSubmitting(false);setPublicationError(null);setShowPublicationDialog(false);setShowBuildArtifacts(false);
    publicationDialog.current?.close();artifactsDialog.current?.close();
    if(managed||!userId||!projectId)return;
    const owner=`${userId}:${projectId}`;
    const current=new EmbodexBuildSession(projectId,()=>{},2000,{initial:readDesignRecovery(window.location.search),persist:value=>{
      if(!mounted.current||ownerRef.current!==owner||buildSession.current!==current)return;
      window.history.replaceState(window.history.state,'',writeDesignRecovery(window.location.href,value));
    }});
    buildSession.current=current;
    const taskId=readDesignRecovery(window.location.search)?.taskId||new URLSearchParams(window.location.search).get('taskId');
    if(taskId){setPublicationTask({userId,projectId,taskId});void current.resume(taskId);}
    return()=>{current.dispose();if(buildSession.current===current)buildSession.current=null;};
  },[userId,projectId,!!managed]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 2500);
  };

  // 导航到指定零件卡片并高亮
  const handleNavigateToPart = (uid: string) => {
    setHighlightedUid(uid);
    setIsExpanded(true);
    const el = partCardRefs.current[uid];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => {
      setHighlightedUid(null);
    }, 1800);
  };

  // 更新零件字段
  const handleUpdatePart = (uid: string, field: keyof PartItem, val: string) => {
    setParts((prev) =>
      prev.map((p) => (p.uid === uid ? { ...p, [field]: val } : p))
    );
  };

  // 移动零件
  const handleMovePart = (uid: string, direction: -1 | 1) => {
    setParts((prev) => {
      const idx = prev.findIndex((p) => p.uid === uid);
      const nextIdx = idx + direction;
      if (idx <= 0 || nextIdx <= 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  // 删除零件
  const handleRemovePart = (uid: string) => {
    setParts((prev) => prev.filter((p) => p.uid !== uid));
    showToast('已移除零件');
  };

  // 复制 URDF
  const currentOriginal=()=>{const current=currentModelSession();return current&&real.bytes&&real.xml&&current.state.selectedId===real.selectedId&&current.state.bytes===real.bytes&&current.state.xml===real.xml?{session:current,selectedId:real.selectedId,bytes:real.bytes,xml:real.xml}:null;};
  const originalStillCurrent=(snapshot:NonNullable<ReturnType<typeof currentOriginal>>)=>snapshot.session===currentModelSession()&&snapshot.selectedId===snapshot.session.state.selectedId&&snapshot.bytes===snapshot.session.state.bytes&&snapshot.xml===snapshot.session.state.xml;
  const handleDownloadUrdf=()=>{const snapshot=currentOriginal();if(snapshot&&originalStillCurrent(snapshot))downloadBlob(new Blob([snapshot.bytes],{type:'application/xml'}),'robot.urdf');};
  const handleCopyUrdf = async () => {
    if(projectId){const snapshot=currentOriginal();if(!snapshot)return;try{await navigator.clipboard.writeText(snapshot.xml);if(originalStillCurrent(snapshot))showToast('原 XML 已复制');}catch{if(originalStillCurrent(snapshot))showToast('原 XML 复制失败，请重试。');}return;}
    const xml = `<?xml version="1.0"?>\n<robot name="unitree_a1_baseline">\n${parts
      .map(
        (p) =>
          `  <link name="${p.linkName}"/>\n  <joint name="${p.linkName}_joint" type="${p.jointType}">\n    <parent link="${p.parentLink}"/>\n    <child link="${p.linkName}"/>\n    <origin xyz="${p.xyz}" rpy="${p.rpy}"/>\n    <axis xyz="${p.axis}"/>\n  </joint>`
      )
      .join('\n')}\n</robot>`;
    navigator.clipboard.writeText(xml);
    showToast('示例 XML 已复制；这是本页示例，不是项目构建产物');
  };

  return (
    <div className="embodex-root" style={{ height: "calc(100dvh - 48px)", width: "100%" }}>
      {/* 提示通知 */}
      {toastMsg && (
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
          {toastMsg}
        </div>
      )}


      {/* 主体三栏布局: 左侧功能导航栏 | 中间主工作区 | 右侧 Simplaix Agent */}
      <div className="embodex-body">
        {/* 左侧侧边栏 (用户要求: "加一个左边的侧边栏，零件清单和ue交互") */}
        <aside className="embodex-sidebar" aria-label="方案设计侧边栏">
          <div className="embodex-nav-wrapper">
            <div className="embodex-sidebar-title">方案设计</div>
            <div className="embodex-nav-group">

            {/* 1. 零件清单 Tab */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'parts' ? 'active' : ''}`}
              onClick={() => setActiveView('parts')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
              <span>零件清单</span>
              <span className="embodex-nav-badge">{parts.length}</span>
            </button>

            {/* 2. UE 交互 Tab */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'ue' ? 'active' : ''}`}
              onClick={() => setActiveView('ue')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>UE 交互</span>
              
            </button>
          </div>

          {projectId&&<button type="button" className="embodex-nav-item" onClick={()=>{setShowBuildArtifacts(true);artifactsDialog.current?.showModal();}}>已有构建与模型包</button>}
          {projectId&&<button type="button" className="embodex-nav-item" onClick={()=>{if(managed){managed.publish();return;}setShowPublicationDialog(true);publicationDialog.current?.showModal();}}>平台设计发布</button>}

          </div>

          {/* 侧边栏底部状态看板 */}
          <div className="embodex-sidebar-footer">
            <div className="embodex-sidebar-footer-row">
              <span style={{ fontWeight: 600, color: '#0f172a' }}>运行环境</span>
              <span>
                待核验
              </span>
            </div>
            <div className="embodex-sidebar-footer-row">
              <span>渲染引擎</span>
              <span style={{ color: '#0f172a' }}>UE 交互</span>
            </div>
            <div className="embodex-sidebar-footer-row">
              <span>CAD 建模</span>
              <span style={{ color: '#0f172a' }}>SolidWorks</span>
            </div>
            <div className="embodex-sidebar-footer-row">
              <span>运动学格式</span>
              <span style={{ color: '#0070f3', fontWeight: 600 }}>URDF 1.0</span>
            </div>
          </div>
        </aside>

        {/* 中间主工作区 */}
        <main className="embodex-center-pane">
          {/* 视图 A: 零件清单 (严格对标 simplaix-frontend 对应页面及截图) */}
          {activeView === 'parts' && (
            <>
              {/* LeRobot Lab 顶部通知横条 */}
              {showBanner && (
                <div className="embodex-lerobot-banner">
                  <div>
                    <div className="embodex-lerobot-title-wrap">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="18" height="14" x="3" y="6" rx="2" />
                        <path d="M12 2v4" />
                        <circle cx="8" cy="13" r="1.5" />
                        <circle cx="16" cy="13" r="1.5" />
                      </svg>
                      <span>LeRobot Lab</span>
                    </div>
                    <div className="embodex-lerobot-desc">
                      {projectId?'项目关联模型 · 原 URDF 只读零件视图，不回写 CAD。':'示例零件工作台 · 仅演示结构，不代表真实生成模型。'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="embodex-lerobot-close-btn"
                    onClick={() => setShowBanner(false)}
                    title="关闭横条"
                  >
                    <span>✕</span>
                    <span>关闭</span>
                  </button>
                </div>
              )}

              {/* 零件清单卡片 */}
              <div className="embodex-urdf-section">
                <div className="embodex-urdf-header">
                  <div>
                    <h2
                      className="embodex-urdf-title"
                      onClick={() => setIsExpanded(!isExpanded)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span>{isExpanded ? '▴' : '▾'}</span>
                      <span>{projectId?'零件清单 · 原 URDF':'零件清单 · 示例'}</span>
                    </h2>
                    <p className="embodex-urdf-subtitle">
                      {projectId?`原 URDF ${real.linkCount} 个 graph links / ${real.jointCount} 个 joints`:'示例 Unitree A1'} · {parts.length} 个零件 · {isExpanded ? '点击收起部分内容' : '当前显示部分内容，点击展开全部'}
                    </p>
                  </div>

                  <div className="embodex-urdf-actions">
                    <button
                      type="button"
                      className="embodex-btn-outline"
                      onClick={() => setIsExpanded(!isExpanded)}
                    >
                      {isExpanded ? '收起部分' : '展开全部'}
                    </button>
                    <button
                      type="button"
                      className="embodex-btn-outline"
                      disabled={!!projectId&&!real.xml}
                      title={projectId ? '复制所选模型的原 XML，不重新生成' : '复制示例 XML'}
                      onClick={handleCopyUrdf}
                    >
                      {projectId?'Copy original URDF':'Copy URDF · 示例'}
                    </button>
                    <button
                      type="button"
                      className="embodex-btn-download"
                      disabled={!projectId||!real.bytes}
                      title={projectId?'下载原 URDF 单文件；网格请下载完整包':'示例没有真实下载产物'}
                      onClick={handleDownloadUrdf}
                    >
                      Download URDF
                    </button>
                  </div>
                </div>

                {projectId&&<div className="embodex-urdf-actions" style={{ flexWrap: 'wrap', minWidth: 0, marginBottom: 16 }}>
                  <label style={{ display: 'grid', gap: 6, flex: '1 1 100%', minWidth: 0 }}>项目关联机器人 <select style={{ width: '100%', minWidth: 0 }} aria-label="项目关联机器人" value={real.selectedId} disabled={!userId||real.loadingRobots} onChange={event=>{void currentModelSession()?.select(event.target.value);}}><option value="">请选择模型</option>{real.robots.map(robot=><option key={robot.id} value={robot.id}>{robot.displayMetadata.name} · {robot.id}</option>)}</select></label>
                  <button style={{ flexShrink: 0, whiteSpace: 'nowrap' }} type="button" className="embodex-btn-outline" disabled={!userId||real.loadingRobots} onClick={()=>{void currentModelSession()?.loadRobots();}}>刷新模型列表</button>
                  <button style={{ flexShrink: 0, whiteSpace: 'nowrap' }} type="button" className="embodex-btn-download" disabled={!real.bytes||real.downloading} onClick={()=>{void downloadPackage();}}>下载完整模型包 ZIP</button>
                  <p style={{ flexBasis: '100%', minWidth: 0, overflowWrap: 'anywhere' }} role="status">{!userId?'请登录后读取项目模型。':real.loadingRobots?'正在读取项目模型…':real.loading?'正在校验原 URDF…':!real.robots.length?'当前项目没有已关联机器人模型。':!real.selectedId?'请选择已关联模型。':real.bytes?`原文件已读取 · model ${real.modelId} · 包指纹 ${real.manifestSha256}`:'所选模型尚无可读取的原 URDF。'}</p>
                  {real.error&&<p role="alert">{real.error}</p>}
                  {importNotice?.userId===userId&&importNotice.projectId===projectId&&<p role="status">{importNotice.text}</p>}
                </div>}
                {/* 零件导航与部件配置表单 */}
                <div className="embodex-parts-layout">
                  {/* 左栏: 零件导航 */}
                  <div className="embodex-parts-nav-panel">
                    <div className="embodex-parts-nav-title">零件导航</div>
                    {parts.map((p) => (
                      <button
                        key={p.uid}
                        type="button"
                        className="embodex-part-nav-btn"
                        onClick={() => handleNavigateToPart(p.uid)}
                      >
                        <div className="embodex-part-nav-label">{p.label}</div>
                        <div className="embodex-part-nav-role">{p.role}</div>
                      </button>
                    ))}
                  </div>

                  {/* 右栏: 零件卡片列表 */}
                  <div className="embodex-cards-list">
                    {parts.map((p, index) => (
                      <div
                        key={p.uid}
                        ref={(el) => {
                          partCardRefs.current[p.uid] = el;
                        }}
                        className={`embodex-part-card ${highlightedUid === p.uid ? 'highlight' : ''}`}
                      >
                        <div className="embodex-part-card-header">
                          <div>
                            <span className="embodex-part-card-title">
                              {index + 1}. {p.label}
                            </span>
                            <div className="embodex-part-card-meta">
                              parent: {p.parentLink} / child: {p.linkName} / joint: {'jointName' in p?p.jointName:'示例'} / axis: {p.axis} / visuals: {p.visualsCount}
                            </div>
                          </div>
                          <div className="embodex-part-card-actions">
                            <button
                              type="button"
                              className="embodex-btn-sm"
                              disabled={!!projectId || index <= 1}
                              onClick={() => handleMovePart(p.uid, -1)}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              className="embodex-btn-sm"
                              disabled={!!projectId || index === 0 || index === parts.length - 1}
                              onClick={() => handleMovePart(p.uid, 1)}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              className="embodex-btn-sm remove"
                              disabled={!!projectId || index === 0}
                              onClick={() => handleRemovePart(p.uid)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        {/* 字段输入表单 */}
                        <div className="embodex-part-form-grid">
                          <div className="embodex-field-wrap">
                            <label className="embodex-field-label">Link name</label>
                            <input
                              type="text"
                              className="embodex-field-input"
                              value={p.linkName}
                              readOnly={!!projectId}
                              onChange={(e) => handleUpdatePart(p.uid, 'linkName', e.target.value)}
                            />
                          </div>

                          <div className="embodex-field-wrap">
                            <label className="embodex-field-label">Joint type</label>
                            <select
                              className="embodex-field-input"
                              value={p.jointType}
                              disabled={!!projectId || index === 0}
                              onChange={(e) =>
                                handleUpdatePart(p.uid, 'jointType', e.target.value as JointType)
                              }
                            >
                              <option value="fixed">fixed</option>
                              <option value="revolute">revolute</option>
                              <option value="continuous">continuous</option>
                              <option value="prismatic">prismatic</option>
                            </select>
                          </div>

                          <div className="embodex-field-wrap">
                            <label className="embodex-field-label">Origin xyz</label>
                            <input
                              type="text"
                              className="embodex-field-input"
                              value={p.xyz}
                              readOnly={!!projectId}
                              onChange={(e) => handleUpdatePart(p.uid, 'xyz', e.target.value)}
                            />
                          </div>

                          <div className="embodex-field-wrap">
                            <label className="embodex-field-label">Origin rpy</label>
                            <input
                              type="text"
                              className="embodex-field-input"
                              value={p.rpy}
                              readOnly={!!projectId}
                              onChange={(e) => handleUpdatePart(p.uid, 'rpy', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 退出模型平台浮动红按钮 (严格对标截图) */}
              <button
                type="button"
                className="embodex-floating-exit-btn"
                disabled
                title="尚未实现模型平台退出或方案保存"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>退出模型平台</span>
              </button>
            </>
          )}

          {/* 视图 B: UE 交互；切回零件清单会卸载 Viewer 与所有轮询 */}
          {activeView === 'ue' && (
            <div className="interactive-studio-stage" style={{ padding: '16px 20px' }}>
              {projectId ? (
                managed ? managed.viewer : <ProjectUeViewer key={projectId} projectId={projectId} />
              ) : (
                <section className="embodex-ue-workspace">
                  <div className="studio-stage-header">
                    <h3 className="studio-stage-title">UE 交互工作区</h3>
                    <div className="studio-stage-controls">{['继续评测','注入动态障碍物','重置初始位姿'].map(label=><button key={label} type="button" className="btn-stage-pill" disabled title="请先选择项目；此控制尚未实现">{label}</button>)}</div>
                  </div>
                  <p>请从已授权的具身智能项目进入 Embodex，再选择项目关联机器人进行真实预览。</p>
                  <Link href="/projects" className="btn-stage-pill">选择项目</Link>
                  <div className="sim-render-canvas" style={{ minHeight: 380 }}>
                    <div className="sim-metrics-bar">{['仿真周期','末端位姿误差','碰撞风险概率','逆运动学迭代'].map(label=><div key={label} className="sim-metric-chip"><span className="metric-label">{label}:</span><span className="metric-value">—</span></div>)}</div>
                    <div className="sim-world-grid"><div className="embodex-ue-empty"><span>UE Pixel Streaming</span><p>尚未选择项目，不会加载或显示旧模型。</p></div></div>
                  </div>
                </section>
              )}
            </div>
          )}
        </main>

        {/* 用户当前聊天 UI；普通消息仅使用授权 Conversation 接口。 */}
        <aside className="embodex-agent-dock">
          {managed ? managed.chat : <EmbodexBaselineBuildPanel
            projectId={projectId}
            navigate={setActiveView}
            onModelImport={onModelImport}
            onPublishCreated={(taskId) => {
              if (!userId || !projectId) return;
              setPublicationTask({ userId, projectId, taskId });
              setShowBuildArtifacts(true);
              artifactsDialog.current?.showModal();
            }}
          />}
        </aside>
      </div>
      {projectId&&<dialog ref={artifactsDialog} aria-label="已有平台构建与模型包" onCancel={()=>setShowBuildArtifacts(false)} onClose={()=>setShowBuildArtifacts(false)} style={{maxWidth:'min(720px,90vw)',maxHeight:'80vh',overflow:'auto'}}>
        <button type="button" className="embodex-btn-outline" onClick={()=>{artifactsDialog.current?.close();setShowBuildArtifacts(false);}}>关闭</button>
        {(showBuildArtifacts||activeImport)&&<ExistingBuildArtifacts key={`${userId}:${projectId}`} projectId={projectId} initialTaskId={activePublication?.taskId||activeImport?.taskId} onRobotReady={(robot,taskId)=>{const current=currentModelSession();if(current){if(activeImport?.taskId===taskId)setImportNotice(null);void current.loadRobots(robot.id);}}}/>}
      </dialog>}
      {projectId&&<dialog ref={publicationDialog} aria-label="正式机器人设计发布" onCancel={()=>setShowPublicationDialog(false)} onClose={()=>setShowPublicationDialog(false)} style={{maxWidth:'min(720px,90vw)',maxHeight:'80vh',overflow:'auto'}}>
        <button type="button" className="embodex-btn-outline" onClick={()=>{publicationDialog.current?.close();setShowPublicationDialog(false);}}>关闭</button>
        {showPublicationDialog && (
          <EmbodexPublicationForm
            key={`${userId}:${projectId}`}
            projectId={projectId}
            disabled={!userId}
            submitting={publicationSubmitting}
            error={publicationError}
            onSubmit={async (payload) => {
              const session=buildSession.current;
              const live=()=>mounted.current&&ownerRef.current===`${userId}:${projectId||''}`&&buildSession.current===session;
              if (!userId || !projectId || !session || !live()) {
                return;
              }
              if(session.state.submitting||session.state.checking)return;
              if(session.state.task&&!session.newIntent()){
                setPublicationError('原任务尚未确认，请先恢复并核实原任务，勿重复构建。');return;
              }
              setPublicationSubmitting(true);
              setPublicationError(null);
              try {
                await session.submit(payload);
                if(!live())return;
                if (session.state.error && !session.state.task) {
                  setPublicationError(session.state.error);
                  return;
                }
                if(!session.state.task)return;
                const taskId=session.state.task.id;
                setPublicationTask({userId,projectId,taskId});
                const url=new URL(window.location.href);url.searchParams.set('taskId',taskId);window.history.replaceState(window.history.state,'',url);
                publicationDialog.current?.close();
                setShowPublicationDialog(false);
                setShowBuildArtifacts(true);
                artifactsDialog.current?.showModal();
              } catch (err: unknown) {
                if(live())setPublicationError(err instanceof Error ? err.message : '提交任务失败');
              } finally {
                if(live())setPublicationSubmitting(false);
              }
            }}
          />
        )}
      </dialog>}
    </div>
  );
}
