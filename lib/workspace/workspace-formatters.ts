/**
 * Format bytes into human-readable string with units and raw byte count.
 * Gracefully handles null/undefined and negative numbers (e.g., overquota remaining).
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return '-';
  }
  if (bytes === 0) {
    return '0 B';
  }

  const isNegative = bytes < 0;
  const abs = Math.abs(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let unitIndex = 0;
  let val = abs;

  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }

  const sign = isNegative ? '-' : '';
  const formattedVal = unitIndex === 0 ? val.toString() : val.toFixed(2);
  const rawBytesStr = bytes.toLocaleString('en-US');

  return `${sign}${formattedVal} ${units[unitIndex]} (${rawBytesStr} 字节)`;
}

/**
 * Format an RFC3339 timestamp string into human-readable date and time (UTC+8 / Asia/Shanghai).
 * Does not append timezone suffix.
 */
export function formatDateTime(
  isoString: string | null | undefined,
  options?: { utc?: boolean }
): string {
  if (!isoString) {
    return '-';
  }
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return isoString;
  }

  if (options?.utc) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');

    return `${y}-${m}-${d} ${hh}:${mm}:${ss} UTC`;
  }

  // Convert to East-8 (UTC+8)
  const utc8Date = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const y = utc8Date.getUTCFullYear();
  const m = String(utc8Date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc8Date.getUTCDate()).padStart(2, '0');
  const hh = String(utc8Date.getUTCHours()).padStart(2, '0');
  const mm = String(utc8Date.getUTCMinutes()).padStart(2, '0');
  const ss = String(utc8Date.getUTCSeconds()).padStart(2, '0');

  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export function formatDateTimeUtc(isoString: string | null | undefined): string {
  return formatDateTime(isoString, { utc: true });
}

/**
 * Translate measurement string to user-friendly Chinese label.
 */
export function formatMeasurement(measurement: string | undefined): string {
  if (!measurement) return '-';
  if (measurement === 'cloud_verified_assets') {
    return '云端已校验资产 (cloud_verified_assets)';
  }
  if (measurement === 'registered_artifacts') {
    return '已登记产物 (registered_artifacts)';
  }
  return measurement;
}

const MODEL_FILE_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_final_model\.zip$/;

/**
 * Check if a workspace entry strictly adheres to the training model artifact naming convention.
 */
export function isModelTrainingEntry(entry: { kind?: string; name?: string } | null | undefined): boolean {
  if (!entry || entry.kind !== 'file' || typeof entry.name !== 'string') {
    return false;
  }
  return MODEL_FILE_REGEX.test(entry.name);
}

/**
 * Translate platform TaskStatus into a human-readable Chinese label.
 */
export function formatTaskStatus(status: string | null | undefined): string {
  if (!status) return '未提供';
  const mapping: Record<string, string> = {
    PENDING: '等待中',
    QUEUED: '排队中',
    RUNNING: '运行中',
    CANCEL_REQUESTED: '取消请求中',
    SUCCEEDED: '已成功',
    FAILED: '已失败',
    CANCELED: '已取消',
    TIMEOUT: '已超时',
  };
  return mapping[status] || `未知状态 (${status})`;
}
