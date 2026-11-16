import type { EmbodexConversationMessage } from '../api/generated/types.gen';

export interface StoredIntent {
  threadId: string;
  confirmationId: string;
  idempotencyKey: string;
  submissionState: 'IDLE' | 'SUBMITTING' | 'ACCEPTED' | 'UNKNOWN';
  taskId: string | null;
}

export interface StoredConversation {
  version: 1;
  userId: string;
  projectId: string;
  threadId: string;
  messageEpoch: number;
  messages: EmbodexConversationMessage[];
  intent: StoredIntent | null;
  updatedAt: number;
}

const STORAGE_PREFIX = 'embodix_conv_v1_';

export function getStorageKey(userId: string, projectId: string): string {
  return `${STORAGE_PREFIX}${userId}_${projectId}`;
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).sessionStorage) {
      return (globalThis as any).sessionStorage;
    }
  } catch {
    return null;
  }
  return null;
}

// Client-only session writers register a synchronous revocation before auth clears caches.
const writers = new Map<string, Set<() => void>>();
export function registerConversationWriter(userId: string, revoke: () => void): () => void {
  const callbacks = writers.get(userId) || new Set<() => void>();
  callbacks.add(revoke);
  writers.set(userId, callbacks);
  return () => { callbacks.delete(revoke); if (!callbacks.size) writers.delete(userId); };
}
export function revokeUserConversations(userId: string): void {
  const callbacks = writers.get(userId);
  writers.delete(userId);
  for (const revoke of callbacks || []) revoke();
}

export interface LoadStoredConversationResult {
  data: StoredConversation | null;
  corrupted: boolean;
  unavailable?: boolean;
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const record = (v: any): boolean => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number, min = 0): v is string => typeof v === 'string' && [...v].length >= min && [...v].length <= max;
const keys = (v: object, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
function validMessages(messages: any): boolean {
  if (!Array.isArray(messages) || messages.length > 200) return false;
  const ids = new Set<string>(), calls = new Set<string>();
  for (const msg of messages) {
    if (!record(msg) || !str(msg.id, 128, 1) || ids.has(msg.id)) return false;
    ids.add(msg.id);
    if (msg.role === 'user') {
      if (!keys(msg, ['id','role','content','name']) || !str(msg.content,16000,1) || (msg.name !== undefined && !str(msg.name,128,1))) return false;
    } else if (msg.role === 'assistant') {
      if (!keys(msg,['id','role','content','name','toolCalls']) || (msg.content != null && !str(msg.content,1048576)) || (msg.name != null && !str(msg.name,128))) return false;
      if (msg.toolCalls != null) {
        if (!Array.isArray(msg.toolCalls) || msg.toolCalls.length > 32) return false;
        for (const call of msg.toolCalls) {
          if (!record(call) || !keys(call,['id','type','function']) || !str(call.id,128,1) || calls.has(call.id) || call.type !== 'function' || !record(call.function) || !keys(call.function,['name','arguments']) || !str(call.function.name,256,1) || !str(call.function.arguments,1048576)) return false;
          calls.add(call.id);
        }
      }
    } else if (msg.role === 'tool') {
      if (!keys(msg,['id','role','toolCallId','content']) || !str(msg.toolCallId,128,1) || !calls.has(msg.toolCallId) || !str(msg.content,1048576)) return false;
    } else return false;
  }
  return true;
}
function validIntent(intent: any, threadId: string): boolean {
  return intent === null || (record(intent) && keys(intent,['threadId','confirmationId','idempotencyKey','submissionState','taskId']) && intent.threadId === threadId && uuid(intent.confirmationId) && uuid(intent.idempotencyKey) && ['IDLE','SUBMITTING','ACCEPTED','UNKNOWN'].includes(intent.submissionState) && (intent.taskId === null || uuid(intent.taskId)) && (intent.submissionState === 'ACCEPTED' ? uuid(intent.taskId) : intent.taskId === null));
}
export function loadStoredConversationWithStatus(userId: string, projectId: string): LoadStoredConversationResult {
  const storage = getSessionStorage();
  if (!storage) return { data: null, corrupted: false, unavailable: true };
  let raw: string | null;
  try { raw = storage.getItem(getStorageKey(userId,projectId)); }
  catch { return { data: null, corrupted: false, unavailable: true }; }
  if (!raw) return { data: null, corrupted: false };
  try {
    const p = JSON.parse(raw);
    if (!record(p) || !keys(p,['version','userId','projectId','threadId','messageEpoch','messages','intent','updatedAt']) || p.version !== 1 || p.userId !== userId || p.projectId !== projectId || !uuid(p.threadId) || !Number.isSafeInteger(p.messageEpoch) || p.messageEpoch < 0 || !validMessages(p.messages) || !validIntent(p.intent,p.threadId) || !Number.isSafeInteger(p.updatedAt) || p.updatedAt < 0) return { data: null, corrupted: true };
    return { data: p, corrupted: false };
  } catch { return { data: null, corrupted: true }; }
}

export function loadStoredConversation(userId: string, projectId: string): StoredConversation | null {
  return loadStoredConversationWithStatus(userId, projectId).data;
}

export function saveStoredConversation(
  userId: string,
  projectId: string,
  data: StoredConversation,
): boolean {
  const storage = getSessionStorage();
  if (!storage || !userId || !projectId) {
    return false;
  }
  try {
    const key = getStorageKey(userId, projectId);
    storage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function updateStoredIntent(
  userId: string,
  projectId: string,
  updater: (prev: StoredIntent | null) => StoredIntent | null,
): boolean {
  const current = loadStoredConversation(userId, projectId);
  if (!current) return false;
  current.intent = updater(current.intent);
  current.updatedAt = Date.now();
  return saveStoredConversation(userId, projectId, current);
}

export function clearUserStoredConversation(userId: string, projectId?: string): void {
  const storage = getSessionStorage();
  if (!storage || !userId) return;
  try {
    if (projectId) {
      storage.removeItem(getStorageKey(userId, projectId));
      return;
    }
    // Clear only keys matching this user, never clear the entire sessionStorage
    const userPrefix = `${STORAGE_PREFIX}${userId}_`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(userPrefix)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      storage.removeItem(k);
    }
  } catch {
    // Ignore storage errors during cleanup
  }
}
