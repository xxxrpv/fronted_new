/**
 * 稳定幂等键管理 (Task-036 R2 修订版)
 * 
 * 约束：
 * 1. 同一用户动作使用稳定客户端幂等键并冻结正文；连点/重试沿用，不在每次重渲染生成新键。
 * 2. 未知响应或网络失败保留原键及冻结正文，供重试或服务端操作恢复；禁止直接清键重新生成。
 * 3. 幂等命名空间按 userId、projectId 及动作类型严格多维隔离。
 * 4. 支持多未决正文指纹映射表（A -> B -> A 保留原键，不被覆盖）。
 * 5. 取消单方面 1 小时自动失效，未决状态稳定持久，仅在终态确认或显式清理时失效。
 * 6. 幂等键必须满足 ^[A-Za-z0-9_-]{1,128}$。
 */

function generateRandomSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Math.random().toString(36).substring(2, 18);
}

export function createStableIdempotencyKey(action: 'batch' | 'select' | 'revision'): string {
  const ts = Date.now().toString(36);
  const rand = generateRandomSuffix();
  const key = `eq_${action}_${ts}_${rand}`;
  // 确保字符安全与长度限制（<= 128）
  return key.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

export interface StoredActionKey {
  key: string;
  fingerprint: string;
  operationId?: string;
  createdAt: number;
}

// 内存中缓存：存储结构为 scopedKey -> Record<fingerprint, StoredActionKey>
const memoryKeyStore = new Map<string, Record<string, StoredActionKey>>();

let globalActiveUserId = 'anon';

/**
 * 设置当前全局活跃用户 ID，用于平台用户登录/切换时隔离幂等空间
 */
export function setCurrentEquipmentUserId(userId: string | null | undefined): void {
  globalActiveUserId = userId && userId.trim() ? userId.trim() : 'anon';
}

/**
 * 获取当前全局活跃用户 ID
 */
export function getCurrentEquipmentUserId(): string {
  return globalActiveUserId;
}

function resolveUserId(userId?: string): string {
  return userId && userId.trim() ? userId.trim() : globalActiveUserId;
}

function getScopedCacheKey(userId: string, projectId: string, actionType: string): string {
  return `${userId}:${projectId}:${actionType}`;
}

function getStorageKey(userId: string, projectId: string, actionType: string): string {
  return `embodix:equipment:idem:${userId}:${projectId}:${actionType}`;
}

/**
 * 简易正文指纹计算
 */
export function computeActionFingerprint(payload: unknown): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(Date.now());
  }
}

/**
 * 读取指定作用域下的全部未决动作映射表
 */
function readScopedRecords(userId: string, projectId: string, actionType: string): Record<string, StoredActionKey> {
  const scopedKey = getScopedCacheKey(userId, projectId, actionType);
  const memRecords = memoryKeyStore.get(scopedKey);
  if (memRecords) {
    return memRecords;
  }

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const stored = window.sessionStorage.getItem(getStorageKey(userId, projectId, actionType));
      if (stored) {
        const parsed = JSON.parse(stored);
        // 兼容旧版单条记录数据格式 { key, fingerprint, ... }
        if (parsed && typeof parsed === 'object') {
          if ('fingerprint' in parsed && 'key' in parsed) {
            const single = parsed as StoredActionKey;
            const map: Record<string, StoredActionKey> = { [single.fingerprint]: single };
            memoryKeyStore.set(scopedKey, map);
            return map;
          } else {
            const map = parsed as Record<string, StoredActionKey>;
            memoryKeyStore.set(scopedKey, map);
            return map;
          }
        }
      }
    } catch {
      // 容错降级
    }
  }

  const emptyMap: Record<string, StoredActionKey> = {};
  memoryKeyStore.set(scopedKey, emptyMap);
  return emptyMap;
}

/**
 * 保存指定作用域下的未决动作映射表
 */
function saveScopedRecords(
  userId: string,
  projectId: string,
  actionType: string,
  records: Record<string, StoredActionKey>
): void {
  const scopedKey = getScopedCacheKey(userId, projectId, actionType);
  memoryKeyStore.set(scopedKey, records);

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(
        getStorageKey(userId, projectId, actionType),
        JSON.stringify(records)
      );
    } catch {
      // 存储满或受限无害忽略
    }
  }
}

/**
 * 获取或分配一个稳定的幂等键
 * 
 * 规则：
 * - 多指纹隔离：若指纹未变，继续使用现有未决键；用户在 A 和 B 之间切换修改时，A 的原键保留不被覆盖。
 * - 用户与项目双重隔离：不同 userId 或 projectId 相互完全隔离，不产生互扰。
 * - 无单方面 1 小时失效，终态前稳定保留。
 */
export function getOrCreateActionIdempotencyKey(
  projectId: string,
  actionType: 'batch' | 'select' | 'revision',
  payload: unknown,
  userId?: string
): { key: string; isReplay: boolean; operationId?: string } {
  const uid = resolveUserId(userId);
  const fingerprint = computeActionFingerprint(payload);
  const records = readScopedRecords(uid, projectId, actionType);

  const existingRecord = records[fingerprint];
  if (existingRecord) {
    return {
      key: existingRecord.key,
      isReplay: true,
      operationId: existingRecord.operationId,
    };
  }

  const newKey = createStableIdempotencyKey(actionType);
  const record: StoredActionKey = {
    key: newKey,
    fingerprint,
    createdAt: Date.now(),
  };

  records[fingerprint] = record;
  saveScopedRecords(uid, projectId, actionType, records);

  return { key: newKey, isReplay: false };
}

/**
 * 获取指定动作的持久记录
 */
export function getStoredAction(
  projectId: string,
  actionType: 'batch' | 'select' | 'revision',
  fingerprint?: string,
  userId?: string
): StoredActionKey | undefined {
  const uid = resolveUserId(userId);
  const records = readScopedRecords(uid, projectId, actionType);
  if (fingerprint) {
    return records[fingerprint];
  }
  // 若未指定指纹，返回最近更新的一条
  const all = Object.values(records);
  if (all.length === 0) return undefined;
  return all.sort((a, b) => b.createdAt - a.createdAt)[0];
}

/**
 * 绑定 operationId 到当前动作未决记录
 */
export function recordOperationForAction(
  projectId: string,
  actionType: 'batch' | 'select' | 'revision',
  operationId: string,
  fingerprint?: string,
  userId?: string
): void {
  const uid = resolveUserId(userId);
  const records = readScopedRecords(uid, projectId, actionType);
  
  if (fingerprint && records[fingerprint]) {
    records[fingerprint].operationId = operationId;
    saveScopedRecords(uid, projectId, actionType, records);
    return;
  }

  // 若未传指纹，绑定到最新的一条记录上
  const all = Object.values(records);
  if (all.length > 0) {
    const latest = all.sort((a, b) => b.createdAt - a.createdAt)[0];
    latest.operationId = operationId;
    saveScopedRecords(uid, projectId, actionType, records);
  }
}

/**
 * 清除已明确成功结束的动作幂等键缓存（成功完成后重置，以便用户后续发起新动作）
 */
export function clearActionIdempotencyKey(
  projectId: string,
  actionType: 'batch' | 'select' | 'revision',
  fingerprint?: string,
  userId?: string
): void {
  const uid = resolveUserId(userId);
  const scopedKey = getScopedCacheKey(uid, projectId, actionType);

  if (!fingerprint) {
    // 未指定指纹时，清除该动作类型下的全部映射
    memoryKeyStore.delete(scopedKey);
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem(getStorageKey(uid, projectId, actionType));
      } catch {
        // noop
      }
    }
    return;
  }

  const records = readScopedRecords(uid, projectId, actionType);
  if (records[fingerprint]) {
    delete records[fingerprint];
    saveScopedRecords(uid, projectId, actionType, records);
  }
}

/**
 * 清理指定用户的设备幂等数据（例如登出或切换账号时使用）
 */
export function clearUserEquipmentIdempotency(userId?: string): void {
  const uid = resolveUserId(userId);
  for (const key of Array.from(memoryKeyStore.keys())) {
    if (key.startsWith(`${uid}:`)) {
      memoryKeyStore.delete(key);
    }
  }

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const prefix = `embodix:equipment:idem:${uid}:`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith(prefix)) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        window.sessionStorage.removeItem(k);
      }
    } catch {
      // noop
    }
  }
}

/**
 * 登出或全局重置时清理全部设备幂等辅助数据
 */
export function clearAllEquipmentIdempotency(): void {
  memoryKeyStore.clear();
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith('embodix:equipment:idem:')) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        window.sessionStorage.removeItem(k);
      }
    } catch {
      // noop
    }
  }
}

/** 只清除与已确认终态 operation 对应的动作。 */
export function clearActionForOperation(projectId: string, operationId: string, userId: string): void {
  for (const action of ['batch', 'revision', 'select'] as const) {
    const records = readScopedRecords(userId, projectId, action);
    for (const [fingerprint, record] of Object.entries(records)) {
      if (record.operationId === operationId) clearActionIdempotencyKey(projectId, action, fingerprint, userId);
    }
  }
}
