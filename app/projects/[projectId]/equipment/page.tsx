/**
 * 非标自动化设备工作台（Embodex 左右分栏与四页 Tab 版）
 * 布局：
 * - 顶部：项目导航与四页 Tab 切换（1 五方案设计、2 设备UE 交互仿真、3 SolidWorks 异步建模、4 批次历史）
 * - 左侧：对话框侧栏（整合需求与尺寸参数输入、方案状态与 Agent 交互流，自适应高度）
 * - 右侧：主工作台画布
 * 接口与业务状态完整复用原有后端契约及幂等逻辑。
 */
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getProject } from '../../../../lib/api';
import type { Project } from '../../../../lib/api/generated/types.gen';
import {
  DEFAULT_EQUIPMENT_PARAMETERS,
  FEATURE_GAPS,
  type EquipmentAlternative,
  type EquipmentBatchDetail,
  type EquipmentBatchSummary,
  type EquipmentConceptParameters,
  type EquipmentFileReceipt,
  type EquipmentOperationDetail,
  type EquipmentOperationReceipt,
} from '../../../../lib/equipment/types';
import {
  validateConceptParameters,
  validateRequirement,
} from '../../../../lib/equipment/validation';
import {
  clearActionIdempotencyKey,
  computeActionFingerprint,
  getOrCreateActionIdempotencyKey,
  recordOperationForAction,
} from '../../../../lib/equipment/idempotency';
import { useAuth } from '../../../../lib/auth-context';
import {
  createBatch,
  createRevision,
  fetchArtifactBinary,
  fetchLocalPreview,
  fetchBatchDetail,
  fetchBatchList,
  fetchOperationDetail,
  fetchOperationList,
  selectAlternative,
} from '../../../../lib/equipment/equipment-service';
import {
  findCadZipReceipt,
  formatEquipmentTimestamp,
  getAlternativeDisplay,
  getAlternativeDisplayName,
  getBatchStatusDisplay,
  getOperationStatusDisplay,
  getSyncStatusLabel,
} from '../../../../lib/equipment/state-helpers';
import styles from './equipment.module.css';

// 3D 视口及 UE 组件 (动态加载，禁用 SSR)
const EquipmentUeViewer = dynamic(() => import('./EquipmentUeViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: 480, background: '#0f172a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
      UE 仿真交互视口初始化中...
    </div>
  ),
});

const EquipmentPreview = dynamic(() => import('./EquipmentPreview'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: 440, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
      三维视口初始化中...
    </div>
  ),
});

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  type?: 'text' | 'card' | 'error';
}

const CAD_PIPELINE_STEPS = [
  { key: 'queued', title: '1. 算力排队受理', desc: '分配 SolidWorks 算力节点' },
  { key: 'running', title: '2. 草图与特征构建', desc: '参数化零件草图拉伸与切除' },
  { key: 'cad_succeeded', title: '3. 装配配合与求解', desc: '机构约束装配与干涉解算' },
  { key: 'verifying', title: '4. 图纸打包校验', desc: '打包 CAD ZIP 并校验哈希' },
  { key: 'succeeded', title: '5. 实体交付就绪', desc: '完成工程装配体交付' },
];

function getCadStepIndex(
  status?: string | null,
  submissionState?: string | null,
  cadGenerated?: boolean | null,
  isCadReady?: boolean,
  isArtifactUploadSkipped?: boolean
): { currentIndex: number; isFailed: boolean; isAttention: boolean } {
  if (isCadReady || status === 'succeeded' || cadGenerated || isArtifactUploadSkipped) {
    return { currentIndex: 4, isFailed: false, isAttention: false };
  }
  if (status === 'failed') return { currentIndex: 1, isFailed: true, isAttention: false };
  if (status === 'needs_attention') return { currentIndex: 2, isFailed: false, isAttention: true };
  if (status === 'uploading' || status === 'verifying') {
    return { currentIndex: 3, isFailed: false, isAttention: false };
  }
  if (status === 'cad_succeeded') {
    return { currentIndex: 2, isFailed: false, isAttention: false };
  }
  if (status === 'running') {
    return { currentIndex: 1, isFailed: false, isAttention: false };
  }
  if (status === 'queued' || submissionState === 'upstream_acknowledged') {
    return { currentIndex: 0, isFailed: false, isAttention: false };
  }
  return { currentIndex: 0, isFailed: false, isAttention: false };
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileKindInfo(kind?: string) {
  switch (kind) {
    case 'cad_zip':
      return { label: 'SolidWorks 原生工程装配包', ext: '.zip', icon: '📦', isCad: true };
    case 'parts_json':
      return { label: '机构零部件 BOM 物料清单', ext: '.json', icon: '📋', isCad: false };
    case 'preview_glb':
      return { label: '轻量三维概念几何模型', ext: '.glb', icon: '🌐', isCad: false };
    case 'alternatives_json':
      return { label: '多方案比选与工况定义', ext: '.json', icon: '📄', isCad: false };
    default:
      return { label: kind || '产物文件', ext: '', icon: '📁', isCad: false };
  }
}

function getFileStatusBadge(status?: string) {
  switch (status) {
    case 'available':
      return { label: '已就绪 ✓', bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' };
    case 'uploading':
      return { label: '上传中...', bg: '#e0f2fe', text: '#0284c7', border: '#bae6fd' };
    case 'verifying':
      return { label: '哈希校验中...', bg: '#fef3c7', text: '#b45309', border: '#fde68a' };
    case 'pending':
      return { label: '等待生成', bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' };
    case 'upload_failed':
      return { label: '上传失败', bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' };
    default:
      return { label: status || '处理中', bg: '#f8fafc', text: '#475569', border: '#e2e8f0' };
  }
}


function getSessionChatKey(pId: string, bId?: string | null): string {
  return bId ? `embodix_equipment_chat_${pId}_${bId}` : `embodix_equipment_chat_${pId}`;
}

function saveChatMessagesToSession(pId: string, bId: string | null | undefined, messages: ChatMessage[]) {
  if (typeof window === 'undefined' || !pId) return;
  try {
    window.sessionStorage.setItem(getSessionChatKey(pId, bId), JSON.stringify(messages));
  } catch {}
}

function deduplicateChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    const prev = result[result.length - 1];
    // 过滤相邻完全重复的 agent 状态或完成通知卡片，避免页面刷新或重复同步堆积相同消息
    if (prev && prev.sender === msg.sender && prev.text.trim() === msg.text.trim()) {
      continue;
    }
    result.push(msg);
  }
  return result;
}

function loadChatMessagesFromSession(pId: string, bId?: string | null): ChatMessage[] | null {
  if (typeof window === 'undefined' || !pId) return null;
  try {
    const raw = window.sessionStorage.getItem(getSessionChatKey(pId, bId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return deduplicateChatMessages(parsed);
  } catch {
    return null;
  }
}

function generateMessagesFromBatch(b: EquipmentBatchDetail): ChatMessage[] {
  const msgs: ChatMessage[] = [
    {
      id: 'welcome',
      sender: 'agent',
      text: '您好！我是非标自动化方案设计助手。请在下方输入需求并确认尺寸参数，我将为您计算生成 5 种结构方案与 3D GLB 预览。',
      timestamp: '已启动',
    },
  ];
  if (b.requirement) {
    const dims = b.parameters
      ? `\n工况尺寸：长 ${b.parameters.conveyor_length_mm}mm × 宽 ${b.parameters.conveyor_width_mm}mm × 台高 ${b.parameters.deck_height_mm}mm`
      : '';
    msgs.push({
      id: `batch-req-${b.batchId}`,
      sender: 'user',
      text: `需求：${b.requirement}${dims}`,
      timestamp: formatEquipmentTimestamp(b.createdAt) || '已提交',
      type: 'text',
    });

    msgs.push({
      id: `batch-alts-${b.batchId}`,
      sender: 'agent',
      text: `已基于工业知识库推导生成 5 套对比机构方案（批次号：${b.batchId.slice(0, 8)}），请在右侧卡片中比选三维几何模型并确认选型。`,
      timestamp: formatEquipmentTimestamp(b.createdAt) || '已生成',
      type: 'card',
    });
  }

  if (b.selection?.alternativeId) {
    const chosenName = getAlternativeDisplayName(b.selection.alternativeId, b.alternatives);
    msgs.push({
      id: `batch-select-${b.batchId}`,
      sender: 'user',
      text: `确认选择【${chosenName}】并开始 SolidWorks 参数化装配建模`,
      timestamp: '已选型',
      type: 'text',
    });

    const isCadDone = ['succeeded', 'needs_attention', 'cad_completed'].includes(b.selection.status || '') || b.selection.cadGenerated;
    if (isCadDone) {
      msgs.push({
        id: `batch-cad-done-${b.batchId}`,
        sender: 'agent',
        text: `【${chosenName}】SolidWorks 工业级装配体已完成特征建模与约束配合，已具备 UE 交互仿真条件。`,
        timestamp: '已就绪',
        type: 'card',
      });
    }
  }
  return msgs;
}

export default function EquipmentWorkbenchPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = (params?.projectId as string) || '';

  const { user } = useAuth();
  const currentUserId = user?.id || '';

  // 1. 视图切换（1 五方案设计 / 2 SolidWorks 建模 / 3 设备UE 交互仿真 / 4 批次历史）
  const [activeTab, setActiveTab] = useState<'design' | 'solidworks' | 'ue' | 'history'>('design');

  // 2. 项目与鉴权状态
  const [project, setProject] = useState<Project | null>(null);
  const [isProjectLoading, setIsProjectLoading] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);

  // 3. 需求与 7 项概念参数
  const [requirement, setRequirement] = useState('');
  const [parameters, setParameters] = useState<EquipmentConceptParameters>(
    DEFAULT_EQUIPMENT_PARAMETERS
  );
  const [paramsDrawerOpen, setParamsDrawerOpen] = useState(true);

  // 4. 批次与方案状态
  const [batch, setBatch] = useState<EquipmentBatchDetail | null>(null);
  const [activeOptionId, setActiveOptionId] = useState<string>('');
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  // 5. 操作与轮询状态
  const [currentOperation, setCurrentOperation] = useState<EquipmentOperationDetail | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);


  // 5.1 异步任务运行态与实时耗时计时器
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isOperating) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isOperating]);

  const formatElapsedTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const isCadOperating = isSelecting || (isOperating && currentOperation?.kind === 'select_cad');
  const isGeneratingBatch = isOperating && !isSelecting && currentOperation?.kind === 'generate_alternatives';
  const isCurrentCadOp = Boolean(
    currentOperation &&
    currentOperation.kind === 'select_cad' &&
    (!batch || currentOperation.batchId === batch.batchId)
  );

  const isCadFailed = Boolean(
    (isCurrentCadOp && (
      currentOperation?.status === 'failed' ||
      currentOperation?.error?.code === 'CAD_EXECUTION_FAILED' ||
      (Boolean(currentOperation?.error) && currentOperation?.error?.code !== 'ARTIFACT_UPLOAD_UNCONFIRMED')
    )) ||
    (batch?.selection?.status === 'failed')
  );

  // 6. 服务端历史列表
  const [batchList, setBatchList] = useState<EquipmentBatchSummary[]>([]);
  const [batchCursor, setBatchCursor] = useState<string | null>(null);
  const [hasMoreBatches, setHasMoreBatches] = useState(false);
  const [isLoadingMoreBatches, setIsLoadingMoreBatches] = useState(false);
  const [batchHistoryError, setBatchHistoryError] = useState<string | null>(null);

  const [operationList, setOperationList] = useState<EquipmentOperationReceipt[]>([]);
  const [operationCursor, setOperationCursor] = useState<string | null>(null);
  const [hasMoreOperations, setHasMoreOperations] = useState(false);
  const [isLoadingMoreOperations, setIsLoadingMoreOperations] = useState(false);
  const [operationHistoryError, setOperationHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // 7. 对话记录 (方案 B: 服务端批次还原 + SessionStorage 暂存)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: '您好！我是非标自动化方案设计助手。请在下方输入需求并确认尺寸参数，我将为您计算生成 5 种结构方案与 3D GLB 预览。',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // 初始化尝试从 sessionStorage 恢复
  useEffect(() => {
    if (!projectId) return;
    const cached = loadChatMessagesFromSession(projectId);
    if (cached && cached.length > 0) {
      setChatMessages(cached);
    }
  }, [projectId]);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 输入框随文本内容自适应展开高度
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(Math.max(el.scrollHeight, 40), 180);
    el.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [requirement, adjustTextareaHeight]);

  const appendChatMessage = useCallback((sender: 'user' | 'agent', text: string, type: 'text' | 'card' | 'error' = 'text') => {
    setChatMessages((prev) => {
      // 防御拦截：如果上一条消息与待追加消息完全一致，不重复追加
      const last = prev[prev.length - 1];
      if (last && last.sender === sender && last.text.trim() === text.trim()) {
        return prev;
      }
      return [
        ...prev,
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender,
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type,
        },
      ];
    });
  }, []);

  // 监听对话消息变更，按批次持久化至 sessionStorage
  useEffect(() => {
    if (projectId && chatMessages.length > 0) {
      saveChatMessagesToSession(projectId, batch?.batchId, chatMessages);
    }
  }, [chatMessages, projectId, batch?.batchId]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isOperating]);

  // 轮询与生命周期作用域
  const recoveryCheckedRef = useRef(new Set<string>());
  const handledTerminalOpIdsRef = useRef(new Set<string>());
  const lastRestoredBatchIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollAbortControllerRef = useRef<AbortController | null>(null);
  const activeBatchIdRef = useRef<string | null>(null);
  const batchFetchTokenRef = useRef(0);
  const currentOperationIdRef = useRef<string | null>(null);
  const startOperationPollingRef = useRef<(opId: string, notifyOnTerminal?: boolean) => void>(() => {});

  const scopeRef = useRef({ identity: `${currentUserId}:${projectId}`, generation: 0, mounted: true });
  const identity = `${currentUserId}:${projectId}`;
  if (scopeRef.current.identity !== identity) {
    scopeRef.current.identity = identity;
    scopeRef.current.generation++;
  }
  const captureScope = () => {
    const curGen = scopeRef.current.generation;
    const curId = scopeRef.current.identity;
    return () => scopeRef.current.mounted && scopeRef.current.identity === curId && scopeRef.current.generation === curGen;
  };

  const clearPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollAbortControllerRef.current) {
      pollAbortControllerRef.current.abort();
      pollAbortControllerRef.current = null;
    }
    currentOperationIdRef.current = null;
  }, []);

  // 校验需求与尺寸参数
  const reqValidationError = useMemo(() => {
    return validateRequirement(requirement);
  }, [requirement]);

  const paramValidation = useMemo(() => {
    return validateConceptParameters(parameters);
  }, [parameters]);

  const updateParameter = (field: keyof EquipmentConceptParameters, value: number) => {
    setParameters((prev) => ({ ...prev, [field]: value }));
  };

  // 校验当前选中的方案
  const activeOption = useMemo(() => {
    if (!batch?.alternatives) return null;
    return batch.alternatives.find((a) => a.id === activeOptionId) || batch.alternatives[0];
  }, [batch, activeOptionId]);

  // 读取项目信息
  useEffect(() => {
    scopeRef.current.mounted = true;
    if (!projectId) {
      setIsProjectLoading(false);
      setProjectError('缺少项目标识');
      return;
    }

    const isCurrent = captureScope();
    setIsProjectLoading(true);
    setProjectError(null);

    getProject({ path: { projectId } })
      .then((res) => {
        if (!isCurrent()) return;
        if (res.data) {
          setProject(res.data);
        } else {
          setProjectError('未找到项目或数据为空');
        }
      })
      .catch((err) => {
        if (!isCurrent()) return;
        setProjectError(err?.message || '读取项目信息失败');
      })
      .finally(() => {
        if (isCurrent()) setIsProjectLoading(false);
      });

    return () => {
      scopeRef.current.mounted = false;
      clearPolling();
    };
  }, [projectId, clearPolling]);

  // 加载指定批次详情
  const loadBatchById = useCallback(
    async (bId: string, resetOption = false) => {
      if (!projectId || !bId) return;
      activeBatchIdRef.current = bId;
      const fetchToken = ++batchFetchTokenRef.current;
      const isCurrent = captureScope();

      setIsBatchLoading(true);
      setBatchError(null);

      try {
        const data = await fetchBatchDetail(projectId, bId);
        if (!isCurrent() || fetchToken !== batchFetchTokenRef.current) return;
        setBatch(data);
        if (resetOption || !activeOptionId) {
          const defaultOpt = data.selection?.alternativeId || data.alternatives[0]?.id || '';
          setActiveOptionId(defaultOpt);
        }
        if (data.parameters) setParameters(data.parameters);
        // 方案 B: 历史需求不再倒灌进输入框，输入框保持清爽供输入修改意见

        // 按批次隔离还原对话历史
        const cachedChat = loadChatMessagesFromSession(projectId, data.batchId);
        if (cachedChat) {
          setChatMessages(cachedChat);
        } else if (data.requirement) {
          const restoredChat = generateMessagesFromBatch(data);
          saveChatMessagesToSession(projectId, data.batchId, restoredChat);
          setChatMessages(restoredChat);
        }

        // 若批次已有选型操作且当前未对其轮询/同步，拉取该选型 operation 状态与 CAD 产物（状态同步，不向对话框发重复通知）
        if (data.selection?.operationId && currentOperationIdRef.current !== data.selection.operationId) {
          startOperationPollingRef.current(data.selection.operationId, false);
        }
      } catch (err: any) {
        if (!isCurrent() || fetchToken !== batchFetchTokenRef.current) return;
        setBatchError(err?.message || '获取方案批次详情失败');
      } finally {
        if (isCurrent() && fetchToken === batchFetchTokenRef.current) {
          setIsBatchLoading(false);
        }
      }
    },
    [projectId, activeOptionId]
  );

  // 加载历史记录
  const loadHistories = useCallback(async () => {
    if (!projectId) return;
    const isCurrent = captureScope();
    setIsHistoryLoading(true);
    try {
      const [batchesRes, opsRes] = await Promise.all([
        fetchBatchList(projectId, null, 5),
        fetchOperationList(projectId, null, 5),
      ]);
      if (!isCurrent()) return;
      setBatchList(batchesRes.items);
      setBatchCursor(batchesRes.nextCursor);
      setHasMoreBatches(Boolean(batchesRes.nextCursor));

      setOperationList(opsRes.items);
      setOperationCursor(opsRes.nextCursor);
      setHasMoreOperations(Boolean(opsRes.nextCursor));
    } catch {
      // 忽略历史静默加载错误
    } finally {
      if (isCurrent()) setIsHistoryLoading(false);
    }
  }, [projectId]);

  // 加载更多批次（分页）
  const loadMoreBatches = useCallback(async () => {
    if (!projectId || !batchCursor || isLoadingMoreBatches) return;
    const isCurrent = captureScope();
    setIsLoadingMoreBatches(true);
    setBatchHistoryError(null);
    try {
      const res = await fetchBatchList(projectId, batchCursor, 10);
      if (!isCurrent()) return;

      const newItems = res.items || [];
      setBatchList((prev) => {
        const existingIds = new Set(prev.map((b) => b.batchId));
        const filtered = newItems.filter((b) => !existingIds.has(b.batchId));
        return [...prev, ...filtered];
      });
      setBatchCursor(res.nextCursor || null);
      setHasMoreBatches(Boolean(res.nextCursor));
    } catch (err: any) {
      if (isCurrent()) {
        setBatchHistoryError(err?.message || '加载更多批次失败');
      }
    } finally {
      if (isCurrent()) setIsLoadingMoreBatches(false);
    }
  }, [projectId, batchCursor, isLoadingMoreBatches]);

  // 加载更多操作（分页）
  const loadMoreOperations = useCallback(async () => {
    if (!projectId || !operationCursor || isLoadingMoreOperations) return;
    const isCurrent = captureScope();
    setIsLoadingMoreOperations(true);
    setOperationHistoryError(null);
    try {
      const res = await fetchOperationList(projectId, operationCursor, 10);
      if (!isCurrent()) return;

      const newItems = res.items || [];
      setOperationList((prev) => {
        const existingIds = new Set(prev.map((o) => o.operationId));
        const filtered = newItems.filter((o) => !existingIds.has(o.operationId));
        return [...prev, ...filtered];
      });
      setOperationCursor(res.nextCursor || null);
      setHasMoreOperations(Boolean(res.nextCursor));
    } catch (err: any) {
      if (isCurrent()) {
        setOperationHistoryError(err?.message || '加载更多操作历史失败');
      }
    } finally {
      if (isCurrent()) setIsLoadingMoreOperations(false);
    }
  }, [projectId, operationCursor, isLoadingMoreOperations]);

  // 轮询 operation 状态
  const startOperationPolling = useCallback(
    (opId: string, notifyOnTerminal = true) => {
      clearPolling();
      currentOperationIdRef.current = opId;
      const abortCtrl = new AbortController();
      pollAbortControllerRef.current = abortCtrl;

      setIsOperating(true);
      const isCurrent = captureScope();

      const poll = async () => {
        if (abortCtrl.signal.aborted || !isCurrent()) return;
        try {
          const detail = await fetchOperationDetail(projectId, opId, abortCtrl.signal);
          if (abortCtrl.signal.aborted || !isCurrent()) return;
          setCurrentOperation(detail);

          const opStatus = getOperationStatusDisplay(detail.status, detail.submissionState, detail.kind);
          const isTerminal = opStatus.isTerminal || detail.status === 'succeeded' || detail.status === 'failed' || detail.status === 'needs_attention';
          if (isTerminal) {
            setIsOperating(false);
            const sessionHandledKey = `embodix_handled_op_${projectId}_${opId}`;
            const alreadyHandledInSession = typeof window !== 'undefined' && window.sessionStorage.getItem(sessionHandledKey) === '1';

            if (notifyOnTerminal && !handledTerminalOpIdsRef.current.has(opId) && !alreadyHandledInSession) {
              handledTerminalOpIdsRef.current.add(opId);
              if (typeof window !== 'undefined') {
                try {
                  window.sessionStorage.setItem(sessionHandledKey, '1');
                } catch {}
              }
              const kindLabel = detail.kind === 'select_cad' ? 'SolidWorks 参数化建模' : detail.kind === 'generate_alternatives' ? '五方案生成' : detail.kind;
              if (detail.status === 'succeeded') {
                appendChatMessage('agent', `【${kindLabel}】已成功完成！`, 'card');
              } else if (detail.status === 'needs_attention') {
                appendChatMessage('agent', `【${kindLabel}】已生成完毕（需人工核查工况）。`, 'card');
              } else if (detail.status === 'failed') {
                setActionError(detail.error?.message || '异步操作执行失败');
                appendChatMessage('agent', `执行遇到问题：${detail.error?.message || '异步操作未成功'}`, 'error');
              }
            } else {
              handledTerminalOpIdsRef.current.add(opId);
            }
            if (detail.batchId) {
              void loadBatchById(detail.batchId, false);
            }
            void loadHistories();
            return;
          }

          pollTimerRef.current = setTimeout(poll, 1500);
        } catch (err: any) {
          if (abortCtrl.signal.aborted || !isCurrent()) return;
          pollTimerRef.current = setTimeout(poll, 2500);
        }
      };

      void poll();
    },
    [projectId, clearPolling, loadBatchById, loadHistories, appendChatMessage]
  );
  startOperationPollingRef.current = startOperationPolling;

  // 页面初始化：读取 URL 参数中的 batch 或 operation
  useEffect(() => {
    if (!projectId || !project) return;
    const urlBatch = searchParams?.get('batch');
    const urlOp = searchParams?.get('operation');

    if (urlBatch) {
      void loadBatchById(urlBatch, true);
    } else {
      // 若无指定 batch，尝试读取最近历史批次
      fetchBatchList(projectId, null, 1).then((res) => {
        if (res.items.length > 0 && !activeBatchIdRef.current) {
          void loadBatchById(res.items[0].batchId, true);
        }
      }).catch(() => {});
    }

    if (urlOp) {
      startOperationPolling(urlOp, false);
    }

    void loadHistories();
  }, [projectId, project, searchParams, loadBatchById, startOperationPolling, loadHistories]);

  // 1. 生成五个方案
  const handleGenerate = async () => {
    if (!requirement.trim()) {
      setActionError('请先输入设备需求描述');
      return;
    }
    if (reqValidationError || !paramValidation.valid || isOperating) return;

    scopeRef.current.generation++;
    clearPolling();
    const isCurrent = captureScope();
    setActionError(null);
    setIsOperating(true);
    setBatch(null);

    const payload = {
      requirement: requirement.trim(),
      parameters,
    };

    appendChatMessage('user', `需求：${payload.requirement}\n工况尺寸：长 ${parameters.conveyor_length_mm}mm × 宽 ${parameters.conveyor_width_mm}mm × 台高 ${parameters.deck_height_mm}mm`);

    // 方案 B: 发送后立即清空输入框并重置自适应高度
    setRequirement('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const { key, operationId, isReplay } = getOrCreateActionIdempotencyKey(projectId, 'batch', payload, currentUserId);

    try {
      if (operationId) {
        startOperationPolling(operationId);
        return;
      }

      if (isReplay && !recoveryCheckedRef.current.has(key)) {
        await fetchOperationList(projectId, null, 10);
        if (!isCurrent()) return;
        recoveryCheckedRef.current.add(key);
        void loadHistories();
        setIsOperating(false);
        setActionError('请先检查操作历史并恢复已有操作。已沿用原幂等键。');
        return;
      }

      const receipt = await createBatch(
        projectId,
        key,
        payload.requirement,
        payload.parameters
      );

      if (scopeRef.current.identity !== `${currentUserId}:${projectId}`) return;
      recordOperationForAction(projectId, 'batch', receipt.operationId, computeActionFingerprint(payload), currentUserId);
      if (!isCurrent()) return;

      router.replace(`/projects/${projectId}/equipment?${receipt.batchId ? `batch=${receipt.batchId}&` : ''}operation=${receipt.operationId}`);
      if (receipt.batchId) {
        await loadBatchById(receipt.batchId, false);
      }
      startOperationPolling(receipt.operationId);
    } catch (err: any) {
      if (!isCurrent()) return;
      setIsOperating(false);
      const errMsg = err?.message || '发起方案生成失败';
      setActionError(errMsg);
      appendChatMessage('agent', `发起方案生成失败：${errMsg}`, 'error');
    }
  };

  // 2. 按当前参数生成修改版
  const handleRevise = async () => {
    if (!batch || reqValidationError || !paramValidation.valid || isOperating) return;

    scopeRef.current.generation++;
    clearPolling();
    const isCurrent = captureScope();
    setActionError(null);
    setIsOperating(true);
    setBatch(null);

    const sourceAlternativeId = activeOptionId || batch.alternatives[0]?.id;
    const payload = {
      sourceBatchId: batch.batchId,
      sourceAlternativeId,
      requirement: requirement.trim(),
      parameters,
    };

    const sourceAltDisplayName = getAlternativeDisplayName(sourceAlternativeId, batch.alternatives);
    appendChatMessage('user', `按【${sourceAltDisplayName}】生成修改版`);

    const { key, operationId, isReplay } = getOrCreateActionIdempotencyKey(projectId, 'revision', payload, currentUserId);

    try {
      if (operationId) {
        startOperationPolling(operationId);
        return;
      }

      const receipt = await createRevision(
        projectId,
        batch.batchId,
        sourceAlternativeId,
        key,
        payload.requirement,
        payload.parameters
      );

      if (scopeRef.current.identity !== `${currentUserId}:${projectId}`) return;
      recordOperationForAction(projectId, 'revision', receipt.operationId, computeActionFingerprint(payload), currentUserId);
      if (!isCurrent()) return;
      router.replace(`/projects/${projectId}/equipment?${receipt.batchId ? `batch=${receipt.batchId}&` : ''}operation=${receipt.operationId}`);
      if (receipt.batchId) {
        await loadBatchById(receipt.batchId, false);
      }
      startOperationPolling(receipt.operationId);
    } catch (err: any) {
      if (!isCurrent()) return;
      setIsOperating(false);
      setActionError(err?.message || '生成修改版失败');
    }
  };

  // 3. 选型并启动 SolidWorks 建模
  const handleSelect = async (optId: string, isRetryOrReselect = false) => {
    if (!batch || isSelecting) return;

    if (batch.selection?.alternativeId && !isRetryOrReselect && !isCadFailed && isCadReady) {
      if (batch.selection.alternativeId !== optId) {
        setActionError(`该批次已确认选择【方案 ${batch.selection.alternativeId}】，且已完成 CAD 建模，锁定不可修改。`);
        return;
      }
      setActionError('该批次已确认选型。');
      return;
    }

    if (isRetryOrReselect || isCadFailed || !isCadReady) {
      clearActionIdempotencyKey(projectId, 'select', undefined, currentUserId);
    }

    scopeRef.current.generation++;
    clearPolling();
    const isCurrent = captureScope();
    setActiveOptionId(optId);
    setActionError(null);
    setIsSelecting(true);
    setIsOperating(true);
    setActiveTab('solidworks');

    const optDisplayName = getAlternativeDisplayName(optId, batch.alternatives);
    appendChatMessage('user', `确认选定【${optDisplayName}】并启动 SolidWorks 建模`);

    const payload = {
      batchId: batch.batchId,
      alternativeId: optId,
    };

    const { key, operationId } = getOrCreateActionIdempotencyKey(projectId, 'select', payload, currentUserId);

    try {
      if (operationId) {
        startOperationPolling(operationId);
        return;
      }

      const receipt = await selectAlternative(
        projectId,
        batch.batchId,
        optId,
        key
      );

      if (scopeRef.current.identity !== `${currentUserId}:${projectId}`) return;
      recordOperationForAction(projectId, 'select', receipt.operationId, computeActionFingerprint(payload), currentUserId);
      if (!isCurrent()) return;
      router.replace(`/projects/${projectId}/equipment?${batch.batchId ? `batch=${batch.batchId}&` : ''}operation=${receipt.operationId}`);
      if (batch.batchId) {
        await loadBatchById(batch.batchId, false);
      }
      startOperationPolling(receipt.operationId);
    } catch (err: any) {
      if (!isCurrent()) return;
      setIsOperating(false);
      setActionError(err?.message || '选型失败');
    } finally {
      if (scopeRef.current.mounted) {
        setIsSelecting(false);
      }
    }
  };

  // 3.1 失败重试当前方案建模
  const handleRetrySelection = async () => {
    const targetAltId = selectedAltId || activeOptionId;
    if (!targetAltId || isSelecting || isCadOperating) return;
    clearActionIdempotencyKey(projectId, 'select', undefined, currentUserId);
    await handleSelect(targetAltId, true);
  };

  // 3.2 放弃失败任务并解锁其他方案
  const handleCancelAndReselect = () => {
    clearActionIdempotencyKey(projectId, 'select', undefined, currentUserId);
    scopeRef.current.generation++;
    clearPolling();
    setCurrentOperation(null);
    setActionError(null);
    setIsOperating(false);
    setIsSelecting(false);
    if (batch?.batchId) {
      router.replace(`/projects/${projectId}/equipment?batch=${batch.batchId}`);
    } else {
      router.replace(`/projects/${projectId}/equipment`);
    }
    setActiveTab('design');
    appendChatMessage('agent', '已取消当前建模任务。您可以在方案卡片中重新选择任意方案进行建模。');
  };

  // 4. 下载 GLB 模型
  const handleDownloadGlb = async (option: EquipmentAlternative) => {
    if (!batch) return;
    if (option.preview?.status !== 'ready') {
      setActionError('该方案的 GLB 产物文件尚未就绪');
      return;
    }

    const isCurrent = captureScope();
    setDownloadingFile(`glb-${option.id}`);
    try {
      const blobData = (await fetchLocalPreview(
        projectId,
        batch.batchId,
        option.id,
        'blob',
        undefined,
        option.preview?.sha256
      )) as Blob;

      if (!isCurrent()) return;
      const blobUrl = URL.createObjectURL(blobData);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${option.id}.glb`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      if (isCurrent()) setActionError(err?.message || '下载 GLB 失败');
    } finally {
      if (isCurrent()) setDownloadingFile(null);
    }
  };

  // 5. 下载 CAD ZIP
  const handleDownloadCadZip = async () => {
    if (!batch || !batch.selection?.alternativeId) {
      setActionError('当前批次尚未选型');
      return;
    }
    const cadReceipt = findCadZipReceipt([batch.selection?.files, batch.files], batch.selection.alternativeId);
    if (!cadReceipt || !cadReceipt.entryId) {
      setActionError('SolidWorks CAD ZIP 产物尚未就绪');
      return;
    }

    const isCurrent = captureScope();
    setDownloadingFile('cad-zip');
    try {
      const blobData = (await fetchArtifactBinary(projectId, batch.batchId, cadReceipt.entryId, 'blob')) as Blob;
      if (!isCurrent()) return;
      const blobUrl = URL.createObjectURL(blobData);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = cadReceipt.fileName || `equipment_cad_${batch.batchId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      if (isCurrent()) setActionError(err?.message || '下载 CAD ZIP 失败');
    } finally {
      if (isCurrent()) setDownloadingFile(null);
    }
  };

  const isSelectedConfirmed = Boolean(batch?.selection?.alternativeId);
  const selectedAltId = batch?.selection?.alternativeId;
  const selectedAltDisplayName = useMemo(() => {
    return getAlternativeDisplayName(selectedAltId, batch?.alternatives);
  }, [selectedAltId, batch?.alternatives]);
  const localPreviewReady = activeOption?.preview?.status === 'ready';

  const validOperationFiles =
    currentOperation &&
    currentOperation.batchId === batch?.batchId &&
    currentOperation.alternativeId === selectedAltId
      ? currentOperation.files
      : undefined;

  const cadZipReceipt =
    batch && selectedAltId
      ? findCadZipReceipt(
          [batch.selection?.files, batch.files, validOperationFiles],
          selectedAltId
        )
      : undefined;

  const selectedAlternative = useMemo(() => {
    if (!selectedAltId || !batch?.alternatives) return null;
    return batch.alternatives.find((a) => a.id === selectedAltId) || null;
  }, [batch, selectedAltId]);

  const isCadReady = Boolean(
    selectedAltId && (
      cadZipReceipt ||
      batch?.selection?.cadGenerated ||
      ['succeeded', 'needs_attention'].includes(batch?.selection?.status || '') ||
      (currentOperation?.kind === 'select_cad' &&
        currentOperation.batchId === batch?.batchId &&
        (currentOperation.cadGenerated || ['succeeded', 'cad_succeeded', 'needs_attention'].includes(currentOperation.status || '')))
    )
  );

  const isArtifactUploadSkipped = Boolean(
    selectedAltId && (
      (currentOperation?.kind === 'select_cad' && currentOperation.batchId === batch?.batchId && currentOperation?.error?.code === 'ARTIFACT_UPLOAD_UNCONFIRMED') ||
      (currentOperation?.kind === 'select_cad' && currentOperation.batchId === batch?.batchId && currentOperation?.status === 'needs_attention') ||
      (batch?.selection && ['succeeded', 'needs_attention'].includes(batch.selection.status || ''))
    )
  );

  const currentOpStatus = useMemo(() => {
    if (!currentOperation) return null;
    const base = getOperationStatusDisplay(
      currentOperation.status,
      currentOperation.submissionState,
      currentOperation.kind
    );
    if (isArtifactUploadSkipped) {
      return {
        ...base,
        label: 'CAD 建模已就绪',
        description: 'SolidWorks 工业级装配体参数化建模已完成，模型资产已成功生成构建。',
        tone: 'success' as const,
        needsAttention: false,
      };
    }
    return base;
  }, [currentOperation, isArtifactUploadSkipped]);

  const displayFiles: EquipmentFileReceipt[] = useMemo(() => {
    const list: EquipmentFileReceipt[] = [];
    if (currentOperation?.files && currentOperation.files.length > 0) {
      list.push(...currentOperation.files);
    } else if (batch?.selection?.files && batch.selection.files.length > 0) {
      list.push(...batch.selection.files);
    } else if (batch?.files && batch.files.length > 0) {
      list.push(...batch.files);
    }
    let filtered = list;
    if (selectedAltId) {
      filtered = list.filter((f) => !f.alternativeId || f.alternativeId === selectedAltId);
    }
    if (cadZipReceipt && !filtered.some((f) => f.kind === 'cad_zip')) {
      filtered.push(cadZipReceipt);
    }
    if (filtered.length === 0 && (selectedAltId || isCadOperating)) {
      return [
        {
          kind: 'cad_zip',
          fileName: `assembly_${selectedAltId || 'option'}.zip`,
          status: isCadReady ? 'available' : 'pending',
          alternativeId: selectedAltId,
        },
        {
          kind: 'parts_json',
          fileName: `bom_parts_${selectedAltId || 'option'}.json`,
          status: isCadReady ? 'available' : 'pending',
          alternativeId: selectedAltId,
        },
        {
          kind: 'preview_glb',
          fileName: 'preview.glb',
          status: localPreviewReady ? 'available' : 'pending',
          alternativeId: selectedAltId,
        },
      ];
    }
    return filtered;
  }, [currentOperation, batch, selectedAltId, cadZipReceipt, isCadOperating, isCadReady, localPreviewReady]);

  if (isProjectLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
        正在读取项目设备工作区...
      </div>
    );
  }

  if (projectError || !project) {
    return (
      <div style={{ maxWidth: 540, margin: '60px auto', padding: 24, textAlign: 'center', background: '#fff', borderRadius: 12, border: '1px solid #fee2e2' }}>
        <h3 style={{ color: '#ef4444', marginBottom: 8 }}>无法加载设备工作台</h3>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>{projectError || '项目不存在'}</p>
        <Link href="/projects" className={styles.btnSecondary} style={{ textDecoration: 'none' }}>
          返回项目列表
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.pageRoot}>
      {/* 顶部 Header: 左栏与下方对话框(380px)贯穿对齐，右栏与主工作台对齐 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link
            href="/projects"
            className={styles.headerBackBtn}
            title="返回项目列表"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className={styles.headerDivider} />
          <div className={styles.headerMainTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5">
              <rect width="7" height="7" x="3" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="14" rx="1" />
              <rect width="7" height="7" x="3" y="14" rx="1" />
            </svg>
            <span>非标自动化设备工作台</span>
          </div>
        </div>

        <div className={styles.headerRight}>
          {/* 页面切换 Tab：1 五方案设计 / 2 SolidWorks 建模 / 3 设备UE 交互仿真 / 4 批次历史 */}
          <div className={styles.pageTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'design'}
              onClick={() => setActiveTab('design')}
              className={`${styles.tabBtn} ${activeTab === 'design' ? styles.tabBtnActive : ''}`}
            >
              <span className={styles.tabStepNum}>1</span>
              <span className={styles.tabText}>五方案设计</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'solidworks'}
              onClick={() => setActiveTab('solidworks')}
              className={`${styles.tabBtn} ${activeTab === 'solidworks' ? styles.tabBtnActive : ''}`}
            >
              <span className={styles.tabStepNum}>2</span>
              <span className={styles.tabText}>SolidWorks 建模</span>
              {isCadOperating && (
                <span className={styles.tabLoadingSpinner} title="SolidWorks 后台建模中..." />
              )}
              {Boolean(batch?.selection?.cadGenerated || cadZipReceipt) && (
                <span className={styles.tabSuccessCheck} title="SolidWorks CAD 产物已就绪">✓</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'ue'}
              onClick={() => setActiveTab('ue')}
              className={`${styles.tabBtn} ${activeTab === 'ue' ? styles.tabBtnActive : ''}`}
            >
              <span className={styles.tabStepNum}>3</span>
              <span className={styles.tabText}>设备UE 交互仿真</span>
              {isCadReady && (
                <span className={styles.tabSuccessCheck} title="已具备 UE 交互仿真条件">✓</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
              onClick={() => setActiveTab('history')}
              className={`${styles.tabBtn} ${activeTab === 'history' ? styles.tabBtnActive : ''}`}
            >
              <span className={styles.tabStepNum}>4</span>
              <span className={styles.tabText}>批次历史</span>
            </button>
          </div>

          <div className={styles.headerRightActions}>
            {isSelectedConfirmed ? (
              <div className={styles.statusPillActive}>
                <span className={styles.statusDotGreen} />
                <span>方案已锁定 ({selectedAltDisplayName})</span>
              </div>
            ) : batch ? (
              <div className={styles.statusPill}>
                <span className={styles.statusDotBlue} />
                <span>批次 {batch.batchId.slice(0, 8)}</span>
              </div>
            ) : (
              <div className={styles.statusPillIdle}>
                <span className={styles.statusDotGray} />
                <span>等待需求输入</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 全局异步任务浮动 HUD 状态条 (建模时隐藏) */}
      {isOperating && !isCadOperating && (
        <div className={styles.progressHud}>
          <div className={styles.hudLeft}>
            <span className={styles.hudSpinner} />
            <span className={styles.hudTitle}>
              {isCadOperating
                ? '正在执行 SolidWorks 异步建模与装配...'
                : '正在构思并生成非标五方案 (含 3D 几何与装配清单)...'}
            </span>
            <span className={styles.hudPhaseBadge}>
              {isCadOperating
                ? elapsedSeconds < 15
                  ? '阶段 1/3: 选型参数锁定'
                  : elapsedSeconds < 40
                  ? '阶段 2/3: 特征构建与装配'
                  : '阶段 3/3: 导出 CAD 装配包'
                : elapsedSeconds < 8
                ? '阶段 1/3: 需求与工况解析'
                : elapsedSeconds < 22
                ? '阶段 2/3: AI 机构拓扑推导'
                : '阶段 3/3: 构建轻量三维几何'}
            </span>
          </div>
          <div className={styles.hudRight}>
            <span className={styles.hudTimer}>⏱️ 已耗时 {formatElapsedTime(elapsedSeconds)}</span>
            <span className={styles.hudHeartbeat}>
              <span className={styles.hudHeartbeatDot} />
              计算同步中
            </span>
          </div>
        </div>
      )}

      {/* 主布局：左侧 Agent 对话框 + 右侧主工作台 */}
      <div className={styles.mainLayout}>
        {/* =====================================================================
            左侧 Agent 侧栏 (复用 Embodex 对话框设计)
            ===================================================================== */}
        <aside className={styles.agentDock}>
          {/* Agent 头部 */}
          <div className={styles.agentHeader}>
            <div className={styles.agentBrand}>
              <span className={styles.agentDot} />
              <span>Embodex Agent</span>
            </div>
            <button
              type="button"
              className={styles.btnSecondary}
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => {
                if (batch) void loadBatchById(batch.batchId, false);
                void loadHistories();
              }}
              title="刷新最新方案与会话状态"
            >
              刷新状态
            </button>
          </div>

          {/* 消息历史滚动区 */}
          <div ref={chatScrollRef} className={styles.agentScroll}>
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={msg.sender === 'user' ? styles.msgUser : styles.msgAgent}
              >
                <span style={{ fontSize: 10, color: '#94a3b8', textAlign: msg.sender === 'user' ? 'right' : 'left' }}>
                  {msg.sender === 'user' ? '你' : 'Embodex Agent'} · {msg.timestamp}
                </span>
                <div
                  className={
                    msg.type === 'card'
                      ? styles.bubbleCard
                      : msg.sender === 'user'
                      ? styles.bubbleUser
                      : styles.bubbleAgent
                  }
                  style={msg.type === 'error' ? { background: '#fee2e2', color: '#b91c1c' } : {}}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {isOperating && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, color: '#0284c7', fontSize: 12, padding: '4px 0' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0284c7', display: 'inline-block' }} />
                <span>Agent 正在计算并生成方案中...</span>
              </div>
            )}
          </div>

          {/* 方案 A：可折叠 7 项概念尺寸参数抽屉 */}
          <div className={styles.paramsDrawer}>
            <button
              type="button"
              className={styles.paramsDrawerToggle}
              onClick={() => setParamsDrawerOpen((prev) => !prev)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📐 需求与尺寸参数 (7项)</span>
                {!paramValidation.valid && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                )}
              </span>
              <span>{paramsDrawerOpen ? '收起 ▲' : '展开 ▼'}</span>
            </button>

            {paramsDrawerOpen && (
              <div className={styles.paramsDrawerBody}>
                <div className={styles.paramField}>
                  <label className={styles.paramLabel}>布局长 (600~3000 mm)</label>
                  <input
                    type="number"
                    className={`${styles.paramInput} ${paramValidation.errors.conveyor_length_mm ? styles.paramInputError : ''}`}
                    value={parameters.conveyor_length_mm}
                    onChange={(e) => updateParameter('conveyor_length_mm', Number(e.target.value))}
                  />
                  {paramValidation.errors.conveyor_length_mm && (
                    <span className={styles.errorHint}>{paramValidation.errors.conveyor_length_mm}</span>
                  )}
                </div>

                <div className={styles.paramField}>
                  <label className={styles.paramLabel}>布局宽 (150~2000 mm)</label>
                  <input
                    type="number"
                    className={`${styles.paramInput} ${paramValidation.errors.conveyor_width_mm ? styles.paramInputError : ''}`}
                    value={parameters.conveyor_width_mm}
                    onChange={(e) => updateParameter('conveyor_width_mm', Number(e.target.value))}
                  />
                  {paramValidation.errors.conveyor_width_mm && (
                    <span className={styles.errorHint}>{paramValidation.errors.conveyor_width_mm}</span>
                  )}
                </div>

                <div className={styles.paramField}>
                  <label className={styles.paramLabel}>台面高 (400~1200 mm)</label>
                  <input
                    type="number"
                    className={`${styles.paramInput} ${paramValidation.errors.deck_height_mm ? styles.paramInputError : ''}`}
                    value={parameters.deck_height_mm}
                    onChange={(e) => updateParameter('deck_height_mm', Number(e.target.value))}
                  />
                  {paramValidation.errors.deck_height_mm && (
                    <span className={styles.errorHint}>{paramValidation.errors.deck_height_mm}</span>
                  )}
                </div>

                <div className={styles.paramField}>
                  <label className={styles.paramLabel}>台面厚 (10~60 mm)</label>
                  <input
                    type="number"
                    className={`${styles.paramInput} ${paramValidation.errors.deck_thickness_mm ? styles.paramInputError : ''}`}
                    value={parameters.deck_thickness_mm}
                    onChange={(e) => updateParameter('deck_thickness_mm', Number(e.target.value))}
                  />
                  {paramValidation.errors.deck_thickness_mm && (
                    <span className={styles.errorHint}>{paramValidation.errors.deck_thickness_mm}</span>
                  )}
                </div>

                <div className={styles.paramField}>
                  <label className={styles.paramLabel}>工件长 (≤ 布局长/4)</label>
                  <input
                    type="number"
                    className={`${styles.paramInput} ${paramValidation.errors.workpiece_length_mm ? styles.paramInputError : ''}`}
                    value={parameters.workpiece_length_mm}
                    onChange={(e) => updateParameter('workpiece_length_mm', Number(e.target.value))}
                  />
                  {paramValidation.errors.workpiece_length_mm && (
                    <span className={styles.errorHint}>{paramValidation.errors.workpiece_length_mm}</span>
                  )}
                </div>

                <div className={styles.paramField}>
                  <label className={styles.paramLabel}>工件宽 (+40 ≤ 布局宽)</label>
                  <input
                    type="number"
                    className={`${styles.paramInput} ${paramValidation.errors.workpiece_width_mm ? styles.paramInputError : ''}`}
                    value={parameters.workpiece_width_mm}
                    onChange={(e) => updateParameter('workpiece_width_mm', Number(e.target.value))}
                  />
                  {paramValidation.errors.workpiece_width_mm && (
                    <span className={styles.errorHint}>{paramValidation.errors.workpiece_width_mm}</span>
                  )}
                </div>

                <div className={styles.paramField} style={{ gridColumn: 'span 2' }}>
                  <label className={styles.paramLabel}>工件高 (≤ 150 mm)</label>
                  <input
                    type="number"
                    className={`${styles.paramInput} ${paramValidation.errors.workpiece_height_mm ? styles.paramInputError : ''}`}
                    value={parameters.workpiece_height_mm}
                    onChange={(e) => updateParameter('workpiece_height_mm', Number(e.target.value))}
                  />
                  {paramValidation.errors.workpiece_height_mm && (
                    <span className={styles.errorHint}>{paramValidation.errors.workpiece_height_mm}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 底部输入框与生成按钮 */}
          <div className={styles.agentInputWrap}>
            {reqValidationError && requirement.trim() && (
              <span className={styles.errorHint}>{reqValidationError}</span>
            )}
            <div className={styles.inputRow}>
              <textarea
                ref={textareaRef}
                className={styles.reqTextarea}
                placeholder="输入设备需求（例如：桌面式分流与装配输送线，支持双向顶升...）"
                value={requirement}
                onChange={(e) => {
                  setRequirement(e.target.value);
                  adjustTextareaHeight();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isOperating && !reqValidationError && paramValidation.valid && requirement.trim()) {
                      void handleGenerate();
                    }
                  }
                }}
              />
              <button
                type="button"
                className={styles.sendBtn}
                title="生成五个方案"
                disabled={isOperating || Boolean(reqValidationError) || !paramValidation.valid || !requirement.trim()}
                onClick={handleGenerate}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* =====================================================================
            右侧主工作台 Stage
            ===================================================================== */}
        <main className={styles.workbenchStage}>
          {actionError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 14px', borderRadius: 8, color: '#b91c1c', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#b91c1c' }}>✕</button>
            </div>
          )}

          {/* ---------------- 第一页：五方案对比 + 第三项 GLB 预览 ---------------- */}
          {activeTab === 'design' && (
            <>
              {/* 1. 五方案对比卡片区 */}
              <section className={styles.cardSection}>
                <div className={styles.sectionHeaderRow}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <span>1. 五方案对比</span>
                      {batch && (
                        <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 9999, background: '#e0f2fe', color: '#0369a1' }}>
                          批次 {batch.batchId.slice(0, 8)} · {batch.alternatives?.length || 0} 套备选
                        </span>
                      )}
                    </h2>
                    <p className={styles.sectionSubtitle}>
                      点击卡片切换三维视口模型；确认单选后将自动开启 SolidWorks 建模。
                    </p>
                  </div>
                  {isBatchLoading && (
                    <span style={{ fontSize: 12, color: '#64748b' }}>方案数据加载中...</span>
                  )}
                </div>

                {isGeneratingBatch && (!batch || !batch.alternatives || batch.status === 'generating') ? (
                  <div className={styles.generatingContainer}>
                    <div className={styles.generatingHeader}>
                      <div className={styles.generatingTitleRow}>
                        <span className={styles.generatingPulseIcon}>⚙️</span>
                        <strong className={styles.generatingTitle}>
                          {elapsedSeconds < 8
                            ? '正在深度解析设备需求与工件尺寸参数...'
                            : elapsedSeconds < 22
                            ? '正在基于工业知识库推导 5 种差异化传动拓扑方案...'
                            : '正在并行生成五套三维装配几何与组件清单...'}
                        </strong>
                        <span className={styles.generatingTimerBadge}>
                           已耗时 {formatElapsedTime(elapsedSeconds)}
                        </span>
                      </div>
                      <p className={styles.generatingSubtitle}>
                        Agent 正在进行多方案受力与机构比选，通常需要 3~4 分钟，请保持耐心...
                      </p>
                    </div>

                    <div className={styles.optionsContainer}>
                      <div className={styles.alternativesGrid}>
                        {[1, 2, 3, 4, 5].map((num) => (
                          <div key={num} className={styles.altCardSkeleton}>
                            <div className={styles.skeletonBadgeRow}>
                              <span className={styles.skeletonNumber}>{num}</span>
                              <div className={styles.skeletonLineTitle} />
                            </div>
                            <div className={styles.skeletonLineP} />
                            <div className={styles.skeletonLineP} style={{ width: '80%' }} />
                            <div className={styles.skeletonLineP} style={{ width: '90%', marginTop: 8 }} />
                            <div className={styles.skeletonLineTag} />
                            <div className={styles.skeletonBtn} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : batch && batch.alternatives && batch.alternatives.length > 0 ? (
                  <div className={styles.optionsContainer}>
                    {isCadFailed && (
                      <div style={{
                        marginBottom: 16,
                        padding: '10px 16px',
                        background: '#fff1f2',
                        border: '1px solid #fecdd3',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        color: '#9f1239',
                        fontSize: 12.5,
                      }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>⚠️</span>
                          <span>
                            之前选择的【{selectedAltDisplayName}】SolidWorks 建模遇到异常，五套备选方案已解除锁定，您可以重新发起当前方案或自由改选其他方案。
                          </span>
                        </span>
                      </div>
                    )}
                    <div className={styles.alternativesGrid} role="radiogroup" aria-label="五个设计方案对比">
                      {batch.alternatives.map((opt, idx) => {
                        const display = getAlternativeDisplay(opt, idx);
                        const isActive = opt.id === activeOptionId;
                        const isConfirmed = batch.selection?.alternativeId === opt.id;

                        return (
                          <div
                            key={opt.id}
                            tabIndex={0}
                            role="radio"
                            aria-checked={isActive}
                            aria-label={`方案 ${display.displayNumber}: ${display.title}`}
                            onClick={() => setActiveOptionId(opt.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setActiveOptionId(opt.id);
                              }
                            }}
                            className={`${styles.altCard} ${isActive ? styles.altCardActive : ''} ${
                              isConfirmed ? styles.altCardSelected : ''
                            }`}
                          >
                            <div className={styles.altCardBadgeRow}>
                              <span className={styles.altNumberBadge}>{display.displayNumber}</span>
                              <strong className={styles.altTitle}>{display.title}</strong>
                            </div>

                            <p className={styles.altCondition}>
                              {display.condition}
                            </p>
                            <p className={styles.altUnverified}>
                              {display.unverified}
                            </p>

                            <div className={styles.altTagsRow}>
                              <span className={`${styles.altTag} ${styles.altTagGray}`}>
                                {display.componentCount} 个组件
                              </span>
                              {!display.engineeringVerified && (
                                <span className={`${styles.altTag} ${styles.altTagYellow}`}>
                                  概念几何 (未工程验证)
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              disabled={isSelecting || isCadOperating || (isSelectedConfirmed && !isConfirmed && isCadReady)}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleSelect(opt.id, isCadFailed || !isCadReady);
                              }}
                              className={styles.btnAltAction}
                              style={{
                                marginTop: 'auto',
                                background: isConfirmed ? (isCadFailed ? '#ef4444' : '#10b981') : undefined,
                              }}
                            >
                              {isConfirmed
                                ? (isCadFailed ? '建模未完成 (点击重试)' : '已确认选型')
                                : isCadOperating && (activeOptionId === opt.id || batch.selection?.alternativeId === opt.id)
                                ? `SolidWorks 建模中 (⏱️ ${formatElapsedTime(elapsedSeconds)})...`
                                : (isSelectedConfirmed && isCadReady)
                                ? '已锁定其他方案'
                                : isSelecting && activeOptionId === opt.id
                                ? '正在提交选型...'
                                : '选择此方案并导入 SolidWorks'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '36px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1' }}>
                    <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
                      当前批次暂无可用方案。请在左侧输入需求并点击「发送」生成五套对比方案。
                    </p>
                  </div>
                )}
              </section>

              {/* 2. 第三项 GLB 三维预览 */}
              <section className={styles.cardSection}>
                <div className={styles.sectionHeaderRow}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <span>2. 三维 GLB 预览</span>
                      {activeOption && (
                        <span style={{ fontSize: 12, color: '#0284c7', fontWeight: 600 }}>
                          · {activeOption.title || activeOption.id}
                        </span>
                      )}
                    </h2>
                    <p className={styles.sectionSubtitle}>
                      鼠标左键旋转视角，滚轮缩放，右键平移；支持安全二进制 GLB 交互。
                    </p>
                  </div>

                  {activeOption && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        disabled={isOperating || Boolean(reqValidationError) || !paramValidation.valid}
                        onClick={handleRevise}
                        className={styles.btnSecondary}
                        title="结合当前表单中修改的参数生成新批次"
                      >
                        按当前参数生成修改版
                      </button>
                      <button
                        type="button"
                        disabled={!localPreviewReady || downloadingFile === `glb-${activeOption.id}`}
                        onClick={() => handleDownloadGlb(activeOption)}
                        className={styles.btnSecondary}
                      >
                        {downloadingFile === `glb-${activeOption.id}` ? '下载中...' : '下载 GLB'}
                      </button>
                      {!isSelectedConfirmed && (
                        <button
                          type="button"
                          disabled={isSelecting || isCadOperating}
                          onClick={() => handleSelect(activeOption.id)}
                          className={styles.btnAction}
                        >
                          {isCadOperating
                            ? `SolidWorks 建模中 (⏱️ ${formatElapsedTime(elapsedSeconds)})...`
                            : isSelecting
                            ? '正在提交选型...'
                            : '选择当前方案并导入 SolidWorks'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className={styles.previewViewportWrap}>
                  {batch && activeOption ? (
                    <EquipmentPreview
                      projectId={projectId}
                      batchId={batch.batchId}
                      previewReady={localPreviewReady}
                      previewSha256={activeOption.preview?.sha256}
                      fileName="preview.glb"
                      alternativeId={activeOption.id}
                      alternativeTitle={activeOption.title}
                    />
                  ) : (
                    <div style={{ height: 440, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                      等待方案生成后载入三维模型...
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* ---------------- 第二页：SolidWorks 建模状态与产物 ---------------- */}
          {activeTab === 'solidworks' && (
            <>
              {/* 模块 1: SolidWorks 建模状态及产物下载 */}
              <section id="section-solidworks" className={styles.cardSection}>
                <div className={styles.sectionHeaderRow}>
                  <div>
                    <h2 className={styles.sectionTitle}>SolidWorks 工业级装配体参数化建模</h2>
                    
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {cadZipReceipt && (
                      <button
                        type="button"
                        disabled={downloadingFile === 'cad-zip'}
                        onClick={handleDownloadCadZip}
                        className={styles.btnSecondary}
                      >
                        {downloadingFile === 'cad-zip' ? '下载中...' : '下载 SolidWorks CAD ZIP'}
                      </button>
                    )}
                    {isCadReady && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('ue')}
                        className={styles.btnAction}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <span>前往第 3 步：设备 UE 交互仿真</span>
                        <span>➔</span>
                      </button>
                    )}
                  </div>
                </div>

                {!(batch?.selection || currentOperation?.kind === 'select_cad') ? (
                  <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1', margin: '16px 0' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>⚙️</div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
                      暂无正在执行的选型建模操作
                    </h3>
                    <p style={{ fontSize: 13, color: '#64748b', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
                      请先在第 1 步【五方案设计】中选定一套方案并点击「选择当前方案并导入 SolidWorks」，确认后将自动在此启动工业级装配体参数化建模。
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('design')}
                      className={styles.btnAction}
                    >
                      前往第 1 步【五方案设计】选型 ➔
                    </button>
                  </div>
                ) : (
                  <>
                    {/* 模块 1: 五阶段横向进度条 (Stepper) */}
                    {(() => {
                      const stepInfo = getCadStepIndex(
                        currentOperation?.status,
                        currentOperation?.submissionState,
                        currentOperation?.cadGenerated,
                        isCadReady,
                        isArtifactUploadSkipped
                      );
                      const activeIdx = stepInfo.currentIndex;
                      const progressPct = isCadReady ? 100 : (activeIdx / (CAD_PIPELINE_STEPS.length - 1)) * 100;

                      return (
                        <div className={styles.stepperContainer}>
                          <div className={styles.stepLine}>
                            <div
                              className={styles.stepLineFill}
                              style={{
                                width: `${progressPct}%`,
                                background: stepInfo.isFailed
                                  ? '#ef4444'
                                  : stepInfo.isAttention
                                  ? '#f59e0b'
                                  : '#0284c7',
                              }}
                            />
                          </div>
                          {CAD_PIPELINE_STEPS.map((step, idx) => {
                            const isDone = idx < activeIdx || (idx === activeIdx && isCadReady);
                            const isCur = idx === activeIdx && !isCadReady;
                            let circleClass = styles.stepCircle;
                            if (isDone) circleClass = `${styles.stepCircle} ${styles.stepCircleCompleted}`;
                            else if (isCur) {
                              circleClass = stepInfo.isFailed
                                ? `${styles.stepCircle} ${styles.stepCircleFailed}`
                                : `${styles.stepCircle} ${styles.stepCircleActive}`;
                            }

                            return (
                              <div key={step.key} className={styles.stepItem}>
                                <div className={circleClass}>
                                  {isDone ? (
                                    '✓'
                                  ) : isCur && isCadOperating ? (
                                    <span className={styles.hudSpinner} style={{ width: 14, height: 14 }} />
                                  ) : (
                                    idx + 1
                                  )}
                                </div>
                                <span className={`${styles.stepTitle} ${isCur ? styles.stepTitleActive : ''}`}>
                                  {step.title}
                                </span>
                                <span className={styles.stepDesc}>{step.desc}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* 模块 2: 当前选型方案与工况参数卡 */}
                    <div className={styles.paramsCardGrid}>
                      <div className={styles.paramBox}>
                        <div className={styles.paramBoxHeader}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>⚙️</span>
                            <span>已选型设备方案</span>
                          </span>
                          <span style={{ fontSize: 11, background: '#e0f2fe', color: '#0284c7', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                            {selectedAltId ? selectedAltDisplayName : '未锁定'}
                          </span>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <strong style={{ fontSize: 13, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                            {selectedAlternative?.title || '等待选型'}
                          </strong>
                          <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, margin: 0 }}>
                            {selectedAlternative?.designRationale || selectedAlternative?.condition || '暂无机构描述'}
                          </p>
                        </div>
                        <div className={styles.paramRow}>
                          <span className={styles.paramLabel}>零部件清单数</span>
                          <span className={styles.paramValue} style={{ fontSize: 12, color: '#0f172a' }}>
                            {selectedAlternative?.componentCount ? `${selectedAlternative.componentCount} 个装配零件` : '计算中...'}
                          </span>
                        </div>
                        <div className={styles.paramRow}>
                          <span className={styles.paramLabel}>选型记录 ID</span>
                          <span className={styles.paramValue} style={{ fontSize: 11 }}>
                            {batch?.selection?.selectionId?.slice(0, 12) || batch?.selection?.operationId?.slice(0, 12) || currentOperation?.operationId?.slice(0, 12) || '—'}
                          </span>
                        </div>
                        <div className={styles.paramRow}>
                          <span className={styles.paramLabel}>SolidWorks 建模状态</span>
                          <span className={styles.paramValue} style={{ color: isCadReady ? '#15803d' : '#0284c7' }}>
                            {isCadReady ? '✓ 已完成建模' : isCadOperating ? '建模计算中...' : '等待触发'}
                          </span>
                        </div>
                      </div>

                      <div className={styles.paramBox}>
                        <div className={styles.paramBoxHeader}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>📐</span>
                            <span>下发建模工况与尺寸约束</span>
                          </span>
                          <span style={{ fontSize: 11, color: '#64748b' }}>7 项非标参数</span>
                        </div>
                        <div className={styles.paramRow}>
                          <span className={styles.paramLabel}>输送线体尺寸 (长 × 宽)</span>
                          <span className={styles.paramValue}>
                            {parameters.conveyor_length_mm} × {parameters.conveyor_width_mm} mm
                          </span>
                        </div>
                        <div className={styles.paramRow}>
                          <span className={styles.paramLabel}>工件外形规格 (长 × 宽 × 高)</span>
                          <span className={styles.paramValue}>
                            {parameters.workpiece_length_mm} × {parameters.workpiece_width_mm} × {parameters.workpiece_height_mm} mm
                          </span>
                        </div>
                        <div className={styles.paramRow}>
                          <span className={styles.paramLabel}>台面工作高度 / 护板厚度</span>
                          <span className={styles.paramValue}>
                            高度 {parameters.deck_height_mm} mm / 厚度 {parameters.deck_thickness_mm} mm
                          </span>
                        </div>
                        <div className={styles.paramRow}>
                          <span className={styles.paramLabel}>工程验证等级</span>
                          <span className={styles.paramValue} style={{ fontSize: 11, color: '#64748b' }}>
                            工业级参数化装配 (未下发产线制造)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 模块 3: 实时心跳与任务执行状态诊断 */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              background:
                                currentOpStatus?.tone === 'success'
                                  ? '#dcfce7'
                                  : currentOpStatus?.tone === 'error'
                                  ? '#fee2e2'
                                  : currentOpStatus?.tone === 'warning'
                                  ? '#fef3c7'
                                  : '#e0f2fe',
                              color:
                                currentOpStatus?.tone === 'success'
                                  ? '#15803d'
                                  : currentOpStatus?.tone === 'error'
                                  ? '#b91c1c'
                                  : currentOpStatus?.tone === 'warning'
                                  ? '#b45309'
                                  : '#0369a1',
                            }}
                          >
                            {currentOpStatus?.label || (isCadReady ? '建模已就绪' : '等待建模')}
                          </span>
                        </div>

                        {isOperating && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#0284c7' }}>
                              <span className={styles.hudSpinner} style={{ width: 11, height: 11 }} />
                              <span>Embodex 后端实时轮询中 (每 1.5s 刷新)</span>
                            </span>
                            <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#0f172a', background: '#ffffff', padding: '2px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}>
                              ⏱️ 耗时: {formatElapsedTime(elapsedSeconds)}
                            </span>
                          </div>
                        )}
                      </div>

                      <p style={{ fontSize: 12.5, color: '#334155', margin: '4px 0 10px' }}>
                        {currentOpStatus?.description || '已成功建立 SolidWorks 建模任务连接，可通过此页面持续追踪状态。'}
                      </p>

                      <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 16, flexWrap: 'wrap', borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                        <span>提交状态: {currentOperation?.submissionState || 'upstream_acknowledged'}</span>
                        <span>
                          CAD 实体生成: {currentOperation?.cadGenerated || isCadReady ? '已生成 (cad_succeeded)' : '计算中/未确认'}
                        </span>
                        <span>
                          ZIP 产物入库: {cadZipReceipt ? `CAD ZIP 就绪 (${cadZipReceipt.status})` : isArtifactUploadSkipped ? '就绪 (本地直通)' : isCadReady ? '就绪' : '待生成'}
                        </span>
                        {currentOperation?.createdAt && (
                          <span>任务创建: {formatEquipmentTimestamp(currentOperation.createdAt)}</span>
                        )}
                      </div>

                      {currentOperation?.error && currentOperation.error.code !== 'ARTIFACT_UPLOAD_UNCONFIRMED' && (
                        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fee2e2', borderRadius: 6, color: '#b91c1c', fontSize: 12 }}>
                          <span>
                            [{currentOperation.error.code}] {currentOperation.error.message}
                          </span>
                        </div>
                      )}

                      {isCadFailed && (
                        <div style={{
                          marginTop: 14,
                          padding: '12px 16px',
                          background: '#ffffff',
                          border: '1px solid #fecaca',
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          flexWrap: 'wrap',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16 }}>⚠️</span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>
                                SolidWorks 建模或特征求解未完成
                              </div>
                              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                                可能是草图参数极值或拉伸特征求解异常。您可以尝试重新发起建模，或放弃并更换为其他 4 个结构方案。
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                            <button
                              type="button"
                              disabled={isSelecting || isCadOperating}
                              onClick={handleRetrySelection}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '8px 14px',
                                background: '#0284c7',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: 6,
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: isSelecting || isCadOperating ? 'not-allowed' : 'pointer',
                                opacity: isSelecting || isCadOperating ? 0.6 : 1,
                                boxShadow: '0 1px 2px rgba(2, 132, 199, 0.2)',
                              }}
                            >
                              <span>🔄</span>
                              <span>重试当前【{selectedAltDisplayName}】建模</span>
                            </button>
                            <button
                              type="button"
                              disabled={isSelecting || isCadOperating}
                              onClick={handleCancelAndReselect}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '8px 14px',
                                background: '#f8fafc',
                                color: '#475569',
                                border: '1px solid #cbd5e1',
                                borderRadius: 6,
                                fontSize: 12.5,
                                fontWeight: 500,
                                cursor: isSelecting || isCadOperating ? 'not-allowed' : 'pointer',
                              }}
                            >
                              <span>↩️</span>
                              <span>放弃并改选其他方案</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 模块 4: 产物文件清单与校验状态表 (File Receipts) */}
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>📁</span>
                          <span>SolidWorks 产物文件清单与完整性校验</span>
                        </h3>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          Workspace 对象存储回执 · 仅 available 状态允许下载
                        </span>
                      </div>

                      <div className={styles.filesTableWrapper}>
                        <table className={styles.filesTable}>
                          <thead>
                            <tr>
                              <th>产物类型</th>
                              <th>文件名</th>
                              <th>文件大小</th>
                              <th>校验状态</th>
                              <th style={{ textAlign: 'right' }}>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayFiles.map((file, idx) => {
                              const kindInfo = getFileKindInfo(file.kind);
                              const statusBadge = getFileStatusBadge(file.status);
                              const isCadZip = file.kind === 'cad_zip';
                              const isAvail = file.status === 'available';

                              return (
                                <tr key={`${file.fileName}-${idx}`}>
                                  <td>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                                      <span>{kindInfo.icon}</span>
                                      <span>{kindInfo.label}</span>
                                    </span>
                                  </td>
                                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11.5 }}>
                                    {file.fileName}
                                  </td>
                                  <td>{formatFileSize(file.sizeBytes)}</td>
                                  <td>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        padding: '2px 8px',
                                        borderRadius: 4,
                                        background: statusBadge.bg,
                                        color: statusBadge.text,
                                        border: `1px solid ${statusBadge.border}`,
                                        fontWeight: 500,
                                      }}
                                    >
                                      {statusBadge.label}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    {isCadZip && isAvail ? (
                                      <button
                                        type="button"
                                        onClick={handleDownloadCadZip}
                                        disabled={downloadingFile === 'cad-zip'}
                                        className={styles.btnSecondary}
                                        style={{ padding: '3px 10px', fontSize: 11.5 }}
                                      >
                                        {downloadingFile === 'cad-zip' ? '下载中...' : '下载 ZIP'}
                                      </button>
                                    ) : (
                                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                                        {isAvail ? '已校验' : '等待生成'}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 模块 5: 建模完成引导卡：前往第 3 步 UE 仿真 */}
                    {isCadReady && (
                      <div style={{ padding: '14px 20px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#065f46' }}>
                          <span style={{ fontSize: 18 }}>🎉</span>
                          <div>
                            <strong>SolidWorks 工业级装配体已完成建模与产物校验！</strong>
                            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#047857' }}>
                              原生 CAD 实体零件与配合关系已生成完毕，现在您可以直接进入第 3 步进行高保真 UE 仿真交互。
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab('ue')}
                          className={styles.btnAction}
                          style={{ padding: '8px 18px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <span>前往第 3 步：设备 UE 交互仿真</span>
                          <span>➔</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}

          {/* ---------------- 第三页：设备 UE 交互仿真 ---------------- */}
          {activeTab === 'ue' && (
            <section style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>


              {!batch?.selection ? (
                /* 前置门禁 1：未选型 */
                <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #cbd5e1', margin: '16px 0' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>⚙️</div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
                    尚未完成方案选型与 SolidWorks 建模
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('design')}
                    className={styles.btnAction}
                  >
                    前往第 1 步【五方案设计】选型 ➔
                  </button>
                </div>
              ) : isCadOperating || !isCadReady ? (
                /* 前置门禁 2：已选型但 SolidWorks 建模尚未就绪 */
                <div style={{ padding: 48, textAlign: 'center', background: '#f0f9ff', borderRadius: 12, border: '1px solid #bae6fd', margin: '16px 0' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: '50%', background: '#e0f2fe', color: '#0284c7', marginBottom: 14 }}>
                    <span className={styles.hudSpinner} style={{ width: 22, height: 22, borderWidth: 3 }} />
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0369a1', marginBottom: 8 }}>
                    SolidWorks 工业级参数化建模进行中...
                  </h3>
                  <p style={{ fontSize: 13, color: '#475569', maxWidth: 540, margin: '0 auto 12px', lineHeight: 1.6 }}>
                    已选定【{selectedAltDisplayName}】（{selectedAlternative?.title || '已选方案'}）。后台正在执行 SolidWorks 参数化装配体生成，建模完成后即可装载至 UE 视口。
                  </p>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ffffff', padding: '4px 14px', borderRadius: 6, border: '1px solid #bae6fd', fontSize: 12, color: '#0369a1', fontWeight: 600, marginBottom: 20 }}>
                    <span>⏱️ 已耗时 {formatElapsedTime(elapsedSeconds)}</span>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('solidworks')}
                      className={styles.btnSecondary}
                    >
                      前往第 2 步查看 SolidWorks 进度 ➔
                    </button>
                  </div>
                </div>
              ) : (
                /* 前置门禁通过：直接展示全新示意图规范的 EquipmentUeViewer */
                <EquipmentUeViewer
                  projectId={projectId}
                  batchId={batch.batchId}
                  alternativeId={selectedAlternative?.id || selectedAltId || ''}
                  alternativeTitle={selectedAlternative?.title}
                  alternativeDisplayName={selectedAltDisplayName}
                  previewAvailable={Boolean(selectedAlternative?.preview?.status === 'ready' || cadZipReceipt)}
                  parameters={batch?.parameters || parameters}
                  alternative={selectedAlternative}
                />
              )}
            </section>
          )}

          {/* ---------------- 第四页：历史批次与持久操作恢复 ---------------- */}
          {activeTab === 'history' && (
            <section id="section-history" className={styles.cardSection}>
                <div className={styles.sectionHeaderRow}>
                  <div>
                    <h2 className={styles.sectionTitle}>历史批次与持久操作恢复</h2>
                    <p className={styles.sectionSubtitle}>
                      服务端批次及操作历史。即使本地缓存被清空或 upstream 丢失回执，也能在此找到并恢复 batchId 为 null 的已持久操作。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadHistories}
                    disabled={isHistoryLoading}
                    className={styles.btnSecondary}
                  >
                    {isHistoryLoading ? '刷新中...' : '刷新历史'}
                  </button>
                </div>

                {/* 批次历史表格 */}
                <h3 style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', margin: '12px 0 6px' }}>
                  批次历史 (Equipment Batches)
                </h3>
                {batchList.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className={styles.historyTable}>
                      <thead>
                        <tr>
                          <th>批次 ID</th>
                          <th>状态</th>
                          <th>需求摘要</th>
                          <th>创建时间</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchList.map((b) => (
                          <tr key={b.batchId}>
                            <td style={{ fontFamily: 'monospace' }}>{b.batchId.slice(0, 12)}...</td>
                            <td>
                              <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#f1f5f9' }}>
                                {getBatchStatusDisplay(b.status).label}
                              </span>
                            </td>
                            <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {b.requirement || '—'}
                            </td>
                            <td>{formatEquipmentTimestamp(b.createdAt)}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() => {
                                  router.replace(`/projects/${projectId}/equipment?batch=${b.batchId}`);
                                  void loadBatchById(b.batchId, b.status === 'generating');
                                }}
                                className={styles.btnSecondary}
                                style={{ padding: '2px 8px', fontSize: 11 }}
                              >
                                载入此批次
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {hasMoreBatches && (
                      <div style={{ marginTop: 10, textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={loadMoreBatches}
                          disabled={isLoadingMoreBatches}
                          className={styles.btnSecondary}
                          style={{ fontSize: 12, padding: '4px 14px' }}
                        >
                          {isLoadingMoreBatches ? '正在加载更早批次...' : '加载更多批次'}
                        </button>
                      </div>
                    )}
                    {batchHistoryError && (
                      <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                        {batchHistoryError}
                      </p>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: '#94a3b8' }}>暂无批次历史</p>
                )}

                {/* 已持久操作历史表格 */}
                <h3 style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', margin: '20px 0 6px' }}>
                  已持久操作历史 (包含未关联 batch 的未知提交)
                </h3>
                {operationList.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className={styles.historyTable}>
                      <thead>
                        <tr>
                          <th>Operation ID</th>
                          <th>类型</th>
                          <th>上游业务状态</th>
                          <th>提交生命周期</th>
                          <th>关联批次</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {operationList.map((op) => (
                          <tr key={op.operationId}>
                            <td style={{ fontFamily: 'monospace' }}>{op.operationId.slice(0, 12)}...</td>
                            <td>{op.kind}</td>
                            <td>
                              <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#f1f5f9' }}>
                                {getOperationStatusDisplay(op.status, op.submissionState, op.kind).label}
                              </span>
                            </td>
                            <td>{op.submissionState}</td>
                            <td>{op.batchId ? `${op.batchId.slice(0, 8)}...` : '<无 batchId (待恢复)>'}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() => startOperationPolling(op.operationId, false)}
                                className={styles.btnSecondary}
                                style={{ padding: '2px 8px', fontSize: 11 }}
                              >
                                监听/恢复此操作
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {hasMoreOperations && (
                      <div style={{ marginTop: 10, textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={loadMoreOperations}
                          disabled={isLoadingMoreOperations}
                          className={styles.btnSecondary}
                          style={{ fontSize: 12, padding: '4px 14px' }}
                        >
                          {isLoadingMoreOperations ? '正在加载更早操作...' : '加载更多操作记录'}
                        </button>
                      </div>
                    )}
                    {operationHistoryError && (
                      <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                        {operationHistoryError}
                      </p>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: '#94a3b8' }}>暂无操作记录</p>
                )}
              </section>
          )}
        </main>
      </div>
    </div>
  );
}
