'use client';

// Presentation copied from Embodex headless-chat; platform-only context replaces
// its CopilotKit/workspace/history/quota/script/latest side effects.
import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  EmbodexConversationSession,
  initialConversationState,
  type ModelImportEvent,
  type ConversationState,
} from '../../../lib/embodex/conversation';
import type * as SdkGen from '../../../lib/api/generated/sdk.gen';
import type * as ConvStorage from '../../../lib/embodex/conversation-storage';

type StoredIntent = ConvStorage.StoredIntent;
type StoredConversation = ConvStorage.StoredConversation;

let sdkModule: typeof SdkGen | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sdkModule = require('../../../lib/api/generated/sdk.gen');
} catch {}

let storageModule: typeof ConvStorage | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  storageModule = require('../../../lib/embodex/conversation-storage');
} catch {}

import { ChatHeader } from './chat-header';
import { ChatInput } from './chat-input';
import { MessageList } from './message-list';
import { FloatingChatPanel } from './floating-panel';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string | null;
  generativeUI?: () => ReactNode;
}

export interface HeadlessChatContextType {
  messages: ChatMessage[];
  isLoading: boolean;
  canSend: boolean;
  sendMessage: (message: { id: string; role: 'user'; content: string }, onAccepted?: () => void) => void;
  stopGeneration: () => void;
  clearHistory: () => Promise<void>;
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  isMinimized: boolean;
  setIsMinimized: (value: boolean) => void;
  uploadedImages: File[];
  setUploadedImages: (images: File[]) => void;
  isDockVisible: boolean;
  setIsDockVisible: (value: boolean) => void;
  navigate: (view: 'parts' | 'ue') => void;
}

const HeadlessChatContext = createContext<HeadlessChatContextType | null>(null);

export function useHeadlessChat() {
  const context = useContext(HeadlessChatContext);
  if (!context) throw new Error('useHeadlessChat must be used within HeadlessChatPanel');
  return context;
}

export default function HeadlessChatPanel({
  userId,
  projectId,
  navigate = () => {},
  onModelImport,
  onPublishCreated,
}: {
  userId: string;
  projectId: string;
  navigate?: (view: 'parts' | 'ue') => void;
  onModelImport?: (event: ModelImportEvent) => void;
  onPublishCreated?: (taskId: string) => void;
}) {
  const [state, setState] = useState(() => initialConversationState(userId, projectId));
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [isDockVisible, setIsDockVisible] = useState(false);
  const [generation, setGeneration] = useState(0);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [activeIntent, setActiveIntent] = useState<StoredIntent | null>(null);

  const importCallback = useRef(onModelImport);
  importCallback.current = onModelImport;

  const session = useRef<EmbodexConversationSession | null>(null);
  const isPublishingRef = useRef(false);
  const activeIntentRef = useRef<StoredIntent | null>(null);
  const mountedRef = useRef(true);
  const ownerRef = useRef({ userId, projectId });
  ownerRef.current = { userId, projectId };

  const updateIntent = (nextIntent: StoredIntent | null) => {
    activeIntentRef.current = nextIntent;
    setActiveIntent(nextIntent);
  };

  const checkPlatformAuth = async (): Promise<'authenticated' | 'unauthenticated' | 'unknown'> => {
    try {
      if (!sdkModule?.getCurrentUser) return 'unknown';
      const res = await sdkModule.getCurrentUser({ headers: { 'Cache-Control': 'no-store' } });
      if (res?.data?.user) {
        if (userId && res.data.user.id !== userId) return 'unauthenticated';
        return 'authenticated';
      }
      if (res?.response?.status === 401) return 'unauthenticated';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const authRevokedRef = useRef(false);

  const ensureActiveSession = () => {
    if (!mountedRef.current || !userId || !projectId || recoveryBlockedRef.current || authRevokedRef.current) return null;
    if (session.current && session.current.writable && session.current.userId === userId && session.current.projectId === projectId) {
      return session.current;
    }
    if (session.current && !session.current.writable) {
      return null;
    }
    const loaded = storageModule?.loadStoredConversationWithStatus?.(userId, projectId);
    const restored = makeSession(loaded?.data);
    session.current = restored;
    setState(restored.state);
    setPublishNotice(null);
    return restored;
  };


  const recoveryBlockedRef = useRef(false);
  const persist = (target: EmbodexConversationSession, intent = activeIntentRef.current) => {
    if (!mountedRef.current || !target.writable || session.current !== target || ownerRef.current.userId !== target.userId || ownerRef.current.projectId !== target.projectId) return false;
    const ok = storageModule?.saveStoredConversation?.(target.userId, target.projectId, {
      version: 1, userId: target.userId, projectId: target.projectId,
      threadId: target.threadId, messageEpoch: target.state.epoch,
      messages: target.state.messages, intent, updatedAt: Date.now(),
    }) === true;
    if (!ok) setPublishNotice('本地存储不可用，无法安全保存会话或发布意图；请恢复存储后重试。');
    return ok;
  };
  const makeSession = (stored?: StoredConversation | null) => {
    const next = new EmbodexConversationSession(userId, projectId, nextState => {
      if (!mountedRef.current || session.current !== next || ownerRef.current.userId !== next.userId || ownerRef.current.projectId !== next.projectId) return;
      if (!next.writable) {
        authRevokedRef.current = true;
        updateIntent(null);
        isPublishingRef.current = false;
        setIsPublishing(false);
        setPublishNotice('登录已失效，请重新登录后继续。');
        setState(nextState);
        return;
      }
      setState(nextState);
      persist(next);
    }, undefined, event => {
      if (mountedRef.current && session.current === next && next.writable && ownerRef.current.userId === next.userId && ownerRef.current.projectId === next.projectId) importCallback.current?.(event);
    }, { initialThreadId: stored?.threadId, initialMessages: stored?.messages, initialEpoch: stored?.messageEpoch, verifyAuth: checkPlatformAuth });
    return next;
  };
  const revokeAuthentication = (target: EmbodexConversationSession) => {
    authRevokedRef.current = true;
    if (!target.writable || session.current !== target) return;
    storageModule?.revokeUserConversations?.(target.userId);
    target.dispose();
    storageModule?.clearUserStoredConversation?.(target.userId);
    isPublishingRef.current = false;
    setIsPublishing(false);
    setPublishNotice('登录已失效，请重新登录后继续。');
  };

  useEffect(() => {
    mountedRef.current = true;
    authRevokedRef.current = false;
    isPublishingRef.current = false;
    setIsPublishing(false);
    setPublishNotice(null);
    if (!userId || !projectId) {
      setState(initialConversationState(userId, projectId));
      return () => { mountedRef.current = false; session.current?.dispose(); session.current = null; };
    }
    const loaded = storageModule?.loadStoredConversationWithStatus?.(userId, projectId);
    const stored = loaded?.data;
    recoveryBlockedRef.current = !!loaded?.corrupted;
    if (loaded?.corrupted) setPublishNotice('会话缓存损坏，无法恢复原上下文；请明确点击「新会话」后继续。');
    else if (!loaded || loaded.unavailable) setPublishNotice('本地存储不可用，无法恢复或安全保存会话；正式发布已受存储检查保护。');
    const recoveredIntent = stored?.intent?.submissionState === 'SUBMITTING'
      ? { ...stored.intent, submissionState: 'UNKNOWN' as const } : stored?.intent || null;
    updateIntent(recoveredIntent);
    const currentSession = makeSession(stored);
    session.current = currentSession;
    setState(currentSession.state);
    if (recoveredIntent?.taskId) onPublishCreated?.(recoveredIntent.taskId);
    const checkEpoch = currentSession.state.epoch;
    void (async () => {
      try {
        if (!sdkModule?.getProjectEmbodexCurrentConfirmation || recoveryBlockedRef.current) return;
        const res = await sdkModule.getProjectEmbodexCurrentConfirmation({
          path: { projectId }, query: { threadId: currentSession.threadId },
          headers: { 'Cache-Control': 'no-store' },
        });
        if (!mountedRef.current || session.current !== currentSession || !currentSession.writable || ownerRef.current.userId !== currentSession.userId || ownerRef.current.projectId !== currentSession.projectId) return;
        if (res.response?.status === 401) {
          const authStatus = await checkPlatformAuth();
          if (!mountedRef.current || session.current !== currentSession || ownerRef.current.userId !== currentSession.userId || ownerRef.current.projectId !== currentSession.projectId) return;
          if (authStatus === 'unauthenticated') {
            revokeAuthentication(currentSession);
          } else {
            if (currentSession.state.epoch === checkEpoch) currentSession.setConfirmation('NONE', null, checkEpoch);
            
          }
          return;
        }
        if (currentSession.state.epoch !== checkEpoch) return;
        if (res.data?.status === 'READY' && res.data.confirmationId) currentSession.setConfirmation('READY', res.data.confirmationId, checkEpoch);
      } catch { /* A transport failure does not authorize a confirmation. */ }
    })();
    return () => {
      mountedRef.current = false;
      currentSession.dispose();
      const current = session.current;
      if (current?.userId === userId && current.projectId === projectId) {
        current.dispose();
        session.current = null;
      }
    };
  }, [userId, projectId]);

  const owned = state.userId === userId && state.projectId === projectId;
  const currentState = owned ? state : initialConversationState(userId, projectId);

  const messages: ChatMessage[] = currentState.messages.map(message => {
    if (message.role === 'tool') {
      return {
        id: message.id,
        role: 'assistant',
        generativeUI: () => (
          <div className="chat-tool-feedback">
            <strong>工具反馈</strong>
            <pre>{message.content}</pre>
          </div>
        ),
      };
    }
    const calls = message.role === 'assistant' ? message.toolCalls : undefined;
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      ...(calls?.length
        ? {
            generativeUI: () => (
              <div className="chat-tool-feedback">
                {calls.map(call => (
                  <p key={call.id}>
                    <strong>{call.function.name}</strong> ·{' '}
                    {currentState.tools.find(tool => tool.id === call.id)?.status || '调用记录'}
                  </p>
                ))}
              </div>
            ),
          }
        : {}),
    };
  });

  const clearHistory = async () => {
    if (!mountedRef.current || ownerRef.current.userId !== userId || ownerRef.current.projectId !== projectId || !session.current?.writable) return;
    session.current.dispose();
    session.current = null;
    isPublishingRef.current = false;
    setIsPublishing(false);
    updateIntent(null);
    setPublishNotice(null);
    recoveryBlockedRef.current = false;
    if (userId && projectId && mountedRef.current) {
      storageModule?.clearUserStoredConversation?.(userId, projectId);
      const next = makeSession();
      session.current = next;
      setState(next.state);
      persist(next);
    } else setState(initialConversationState(userId, projectId));
    setGeneration(value => value + 1);
    setUploadedImages([]);
  };

  const doPublish = async (targetThreadId: string, targetConfirmationId: string, targetIdempotencyKey: string) => {
    const target = session.current;
    if (!target || !target.writable || recoveryBlockedRef.current || target.userId !== userId || target.projectId !== projectId || target.threadId !== targetThreadId) {
      isPublishingRef.current = false;
      setIsPublishing(false);
      return;
    }
    const ownerValid = () => mountedRef.current && session.current === target && target.writable && target.userId === ownerRef.current.userId && target.projectId === ownerRef.current.projectId;
    const intentValid = () => ownerValid() && activeIntentRef.current?.threadId === targetThreadId && activeIntentRef.current?.confirmationId === targetConfirmationId && activeIntentRef.current?.idempotencyKey === targetIdempotencyKey;
    const submittedEpoch = target.state.epoch;
    const intent: StoredIntent = { threadId: targetThreadId, confirmationId: targetConfirmationId, idempotencyKey: targetIdempotencyKey, submissionState: 'SUBMITTING', taskId: null };
    setPublishNotice(null);
    updateIntent(intent);
    if (!persist(target, intent)) {
      isPublishingRef.current = false;
      setIsPublishing(false);
      return;
    }
    try {
      if (!sdkModule?.createProjectEmbodexPublication) throw new Error('SDK unavailable');
      const res = await sdkModule.createProjectEmbodexPublication({
        path: { projectId: target.projectId },
        body: { threadId: targetThreadId, confirmationId: targetConfirmationId },
        headers: { 'Idempotency-Key': targetIdempotencyKey },
      });
      if (!ownerValid()) return;
      if (res.response?.status === 401) {
        const authStatus = await checkPlatformAuth();
        if (!ownerValid()) return;
        if (authStatus === 'unauthenticated') {
          revokeAuthentication(target);
          return;
        }
        if (!intentValid()) return;
        updateIntent({ ...intent, submissionState: 'UNKNOWN' });
        persist(target);
        setPublishNotice(authStatus === 'authenticated'
          ? '发布服务授权响应异常，已保留提交标识，可点击重试原提交。'
          : '提交结果未确认，已保留提交标识，可点击重试或刷新页面。');
        return;
      }
      if (!intentValid()) return;
      if (res.data?.taskId) {
        updateIntent({ ...intent, submissionState: 'ACCEPTED', taskId: res.data.taskId });
        persist(target);
        if (target.state.epoch === submittedEpoch && target.state.confirmation.confirmationId === targetConfirmationId) target.setConfirmation('NONE', null, submittedEpoch);
        setPublishNotice('发布任务已受理，正在处理构建与位置登记。');
        onPublishCreated?.(res.data.taskId);
      } else {
        const errCode = (res.error as any)?.error?.code || (res.error as any)?.code;
        updateIntent({ ...intent, submissionState: errCode === 'CONFIRMATION_NOT_READY' ? 'IDLE' : 'UNKNOWN' });
        persist(target);
        if (errCode === 'CONFIRMATION_NOT_READY') {
          if (target.state.epoch === submittedEpoch && target.state.confirmation.confirmationId === targetConfirmationId) target.setConfirmation('INVALIDATED', null, submittedEpoch);
          setPublishNotice('构建确认已失效或已被抢占；原提交标识已保留，可安全核对原提交。');
        } else setPublishNotice('发布请求未确认，原提交标识已保留，可安全重试原提交。');
      }
    } catch {
      if (!intentValid()) return;
      updateIntent({ ...intent, submissionState: 'UNKNOWN' });
      persist(target);
      setPublishNotice('提交结果未确认，已保留提交标识，可点击重试或刷新页面。');
    } finally {
      if (intentValid()) {
        isPublishingRef.current = false;
        setIsPublishing(false);
      }
    }
  };

  const handleConfirmPublish = async () => {
    if (isPublishingRef.current || !session.current?.writable || recoveryBlockedRef.current || !userId || !projectId) return;
    const live = session.current.state;
    const confirmationId = live.confirmation.confirmationId;
    if (!confirmationId || live.confirmation.status !== 'READY' || live.busy || !['idle','finished'].includes(live.outcome)) return;
    if (activeIntentRef.current && ['SUBMITTING','UNKNOWN'].includes(activeIntentRef.current.submissionState) && activeIntentRef.current.confirmationId !== confirmationId) return;
    if (activeIntentRef.current?.confirmationId === confirmationId && activeIntentRef.current.taskId) { onPublishCreated?.(activeIntentRef.current.taskId); return; }

    isPublishingRef.current = true;
    setIsPublishing(true);

    const threadId = session.current.threadId;
    const idempotencyKey =
      activeIntentRef.current?.confirmationId === confirmationId &&
      activeIntentRef.current?.threadId === threadId &&
      activeIntentRef.current?.idempotencyKey
        ? activeIntentRef.current.idempotencyKey
        : crypto.randomUUID();

    await doPublish(threadId, confirmationId, idempotencyKey);
  };

  const handleRetryUnknown = async () => {
    if (isPublishingRef.current || !session.current?.writable || recoveryBlockedRef.current || !userId || !projectId) return;
    const currentIntent = activeIntentRef.current;
    if (!currentIntent || !['UNKNOWN', 'SUBMITTING'].includes(currentIntent.submissionState) || currentIntent.threadId !== session.current.threadId) {
      return;
    }
    if (currentIntent.taskId) {
      onPublishCreated?.(currentIntent.taskId);
      return;
    }
    isPublishingRef.current = true;
    setIsPublishing(true);
    await doPublish(currentIntent.threadId, currentIntent.confirmationId, currentIntent.idempotencyKey);
  };

  const context: HeadlessChatContextType = {
    messages,
    isLoading: currentState.busy,
    canSend: !!userId && !!projectId && !recoveryBlockedRef.current && !authRevokedRef.current && !!session.current?.writable,
    sendMessage: (message, onAccepted) => {
      if (authRevokedRef.current) return;
      const current = ensureActiveSession();
      if (!current || !current.writable || recoveryBlockedRef.current || current.userId !== userId || current.projectId !== projectId) return;
      void current.send(message.content, () => {
        if (mountedRef.current && current.writable && session.current === current) onAccepted?.();
      });
    },
    stopGeneration: () => session.current?.stop(),
    clearHistory,
    isOpen,
    setIsOpen,
    isMinimized,
    setIsMinimized,
    uploadedImages,
    setUploadedImages,
    isDockVisible,
    setIsDockVisible,
    navigate,
  };

  const canShowConfirm =
    currentState.confirmation?.status === 'READY' &&
    !!currentState.confirmation?.confirmationId &&
    !currentState.busy &&
    (currentState.outcome === 'finished' || currentState.outcome === 'idle') &&
    !!session.current?.writable &&
    !(activeIntent && ['SUBMITTING','UNKNOWN'].includes(activeIntent.submissionState) && activeIntent.confirmationId !== currentState.confirmation.confirmationId) &&
    !(activeIntent?.taskId && activeIntent.confirmationId === currentState.confirmation.confirmationId);

  const canRetryUnknown =
    !isPublishing &&
    !currentState.busy &&
    !!session.current &&
    !!session.current?.writable &&
    !!activeIntent && ['UNKNOWN','SUBMITTING'].includes(activeIntent.submissionState) &&
    activeIntent?.threadId === session.current.threadId;

  return (
    <div className="chat-shell">
      <HeadlessChatContext.Provider value={context}>
        {!isOpen ? (
          <button onClick={() => setIsOpen(true)} className="chat-reopen" aria-label="Open chat">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        ) : (
          <FloatingChatPanel>
            <ChatHeader />
            {!isMinimized && (
              <>
                <MessageList
                  welcomeMessage={"Hi, I'm Simplaix Agent. I'm here to help you with your project."}
                />
                {canShowConfirm && (
                  <div className="chat-confirmation-card p-3 mx-4 my-2 border rounded-md bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      模型验证已通过，可发起正式发布。
                    </p>
                    <button
                      type="button"
                      disabled={isPublishing}
                      onClick={handleConfirmPublish}
                      className="mt-2 px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {isPublishing ? '正在提交发布…' : '确认构建'}
                    </button>
                  </div>
                )}
                {canRetryUnknown && (
                  <div className="chat-confirmation-card p-3 mx-4 my-2 border rounded-md bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      上一提交结果未确认，已保留原提交标识。
                    </p>
                    <button
                      type="button"
                      disabled={isPublishing}
                      onClick={handleRetryUnknown}
                      className="mt-2 px-3 py-1.5 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {isPublishing ? '正在重试提交…' : '安全重试原提交'}
                    </button>
                  </div>
                )}
                {publishNotice && (
                  <p className="chat-notice text-xs text-neutral-600 dark:text-neutral-300 px-4" role="status">
                    {publishNotice}
                  </p>
                )}
                {currentState.notice && (
                  <p className="chat-notice" role="status">
                    {currentState.notice}
                  </p>
                )}
                {!userId || !projectId ? (
                  <p className="chat-notice" role="status">
                    {!projectId ? '选择项目后开始对话。' : '请登录后发送消息。'}
                  </p>
                ) : null}
                <ChatInput key={generation} />
              </>
            )}
          </FloatingChatPanel>
        )}
      </HeadlessChatContext.Provider>
    </div>
  );
}
