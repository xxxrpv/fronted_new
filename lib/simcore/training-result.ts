/**
 * Strict parser and types for Simcore training results on EmbodiX Platform.
 *
 * Simcore terminal Result data adheres to Task-005 sanitized shape:
 * - Public Contract: Result.data = JsonObject
 * - finalStatus strictly in ('finished', 'stopped', 'rejected')
 * - runName: non-empty string
 * - finished/stopped: externalJobId is mandatory
 * - rejected: failure with non-empty code and message is mandatory
 * - returnCode: integer or null
 * - artifactCorrelation: strictly strategy='run-name-prefix', confidence='weak'
 * - metrics: strictly numeric values only
 * - artifacts: must be clean basenames without path separators (/ or \). Path-bearing
 *   names are REJECTED (dropped) to expose backend leaks rather than silently fixing them.
 */

export type SimcoreFinalStatus = 'finished' | 'stopped' | 'rejected';

export interface SanitizedCurvePoint {
  step?: number;
  value?: number;
}

export interface SanitizedCurveSeries {
  title: string;
  label: string;
  points: SanitizedCurvePoint[];
}

export interface SanitizedArtifactItem {
  name: string;
  kind?: string;
  size?: number;
}

export interface ArtifactCorrelation {
  strategy: 'run-name-prefix';
  confidence: 'weak';
}

export interface FailureInfo {
  code: string;
  message: string;
}

export interface SanitizedTrainingResultData {
  finalStatus: SimcoreFinalStatus;
  runName: string;
  externalJobId?: string;
  returnCode?: number | null;
  failure?: FailureInfo;
  artifacts?: SanitizedArtifactItem[];
  curves?: Record<string, SanitizedCurveSeries>;
  artifactCorrelation?: ArtifactCorrelation;
  metrics?: Record<string, number>;
  assemblyPending?: boolean;
}

const FORBIDDEN_KEY_PATTERN =
  /path|cwd|command|script|stdout|stderr|roots|engineRoot|trainingRoot|logTail|errorTail|playerUrl|debug/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks if a filename is a strict basename without any path separators or drive indicators.
 */
function isValidCleanBasename(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  // Reject Unix slash, Windows backslash, colon (drive letter), or null bytes
  if (/[/\\:\0]/.test(name)) return false;
  // Reject path traversal relative references
  if (name === '.' || name === '..') return false;
  return true;
}

/**
 * Parses and strictly validates raw Result.data from Simcore training.
 * Returns null if data violates frozen contract semantics.
 */
export function parseSimcoreTrainingResult(
  data: unknown,
): SanitizedTrainingResultData | null {
  if (!isRecord(data)) {
    return null;
  }

  // 1. Validate finalStatus
  const rawStatus = data.finalStatus;
  if (
    rawStatus !== 'finished' &&
    rawStatus !== 'stopped' &&
    rawStatus !== 'rejected'
  ) {
    return null;
  }
  const finalStatus: SimcoreFinalStatus = rawStatus;

  // 2. Validate runName (must be non-empty)
  if (typeof data.runName !== 'string' || data.runName.trim().length === 0) {
    return null;
  }
  const runName = data.runName.trim();

  // 3. Conditional requirements based on finalStatus
  let externalJobId: string | undefined = undefined;
  if (finalStatus === 'finished' || finalStatus === 'stopped') {
    if (typeof data.externalJobId !== 'string' || data.externalJobId.trim().length === 0) {
      // finished/stopped must have externalJobId
      return null;
    }
    externalJobId = data.externalJobId.trim();
  }

  let failure: FailureInfo | undefined = undefined;
  if (finalStatus === 'rejected') {
    if (!isRecord(data.failure)) {
      return null;
    }
    const code = typeof data.failure.code === 'string' ? data.failure.code.trim() : '';
    const message = typeof data.failure.message === 'string' ? data.failure.message.trim() : '';
    if (!code || !message) {
      return null;
    }
    failure = { code, message };
  } else if (isRecord(data.failure)) {
    // Optional failure for finished/stopped if present
    const code = typeof data.failure.code === 'string' ? data.failure.code.trim() : '';
    const message = typeof data.failure.message === 'string' ? data.failure.message.trim() : '';
    if (code && message) {
      failure = { code, message };
    }
  }

  const result: SanitizedTrainingResultData = {
    finalStatus,
    runName,
  };
  if (isRecord(data.assembly) && Array.isArray(data.assembly.diagnostics)) {
    result.assemblyPending = data.assembly.diagnostics.includes('ARTIFACT_ASSEMBLY_PENDING');
  }

  if (externalJobId) {
    result.externalJobId = externalJobId;
  }
  if (failure) {
    result.failure = failure;
  }

  // 4. Validate returnCode (optional, integer | null)
  if (data.returnCode === null) {
    result.returnCode = null;
  } else if (
    typeof data.returnCode === 'number' &&
    Number.isInteger(data.returnCode)
  ) {
    result.returnCode = data.returnCode;
  }

  // 5. Validate artifacts (Strict check: reject path-bearing names, do NOT silently fix)
  if (Array.isArray(data.artifacts)) {
    const cleanedArtifacts: SanitizedArtifactItem[] = [];
    for (const item of data.artifacts) {
      if (!isRecord(item)) continue;
      const rawName = String(item.name || item.filename || item.basename || '').trim();

      // If the backend leaked a path, REJECT the item so tests and integration gate catch it!
      if (!isValidCleanBasename(rawName)) {
        continue;
      }

      const safeItem: SanitizedArtifactItem = {
        name: rawName,
      };

      if (typeof item.kind === 'string' && item.kind.trim().length > 0) {
        safeItem.kind = item.kind.trim();
      }
      if (typeof item.size === 'number' && !Number.isNaN(item.size) && item.size >= 0) {
        safeItem.size = item.size;
      }
      cleanedArtifacts.push(safeItem);
    }
    if (cleanedArtifacts.length > 0) {
      result.artifacts = cleanedArtifacts;
    }
  }

  // 6. Validate curves (strict series structure, exclude forbidden keys)
  if (isRecord(data.curves)) {
    const cleanedCurves: Record<string, SanitizedCurveSeries> = {};

    for (const [curveName, curveVal] of Object.entries(data.curves)) {
      if (
        FORBIDDEN_KEY_PATTERN.test(curveName) ||
        curveName.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(curveName) ||
        curveName.startsWith('\\\\')
      ) {
        continue;
      }

      if (!isRecord(curveVal)) continue;

      if (
        typeof curveVal.title !== 'string' ||
        typeof curveVal.label !== 'string' ||
        !Array.isArray(curveVal.points)
      ) {
        continue;
      }

      const points: SanitizedCurvePoint[] = [];
      for (const pt of curveVal.points) {
        if (!isRecord(pt)) continue;
        const safePoint: SanitizedCurvePoint = {};
        if (typeof pt.step === 'number' && !Number.isNaN(pt.step)) {
          safePoint.step = pt.step;
        }
        if (typeof pt.value === 'number' && !Number.isNaN(pt.value)) {
          safePoint.value = pt.value;
        }
        points.push(safePoint);
      }

      cleanedCurves[curveName] = {
        title: curveVal.title,
        label: curveVal.label,
        points,
      };
    }

    if (Object.keys(cleanedCurves).length > 0) {
      result.curves = cleanedCurves;
    }
  }

  // 7. Validate artifactCorrelation (strict allowed strategy and confidence)
  if (isRecord(data.artifactCorrelation)) {
    if (
      data.artifactCorrelation.strategy === 'run-name-prefix' &&
      data.artifactCorrelation.confidence === 'weak'
    ) {
      result.artifactCorrelation = {
        strategy: 'run-name-prefix',
        confidence: 'weak',
      };
    }
  }

  // 8. Validate metrics (strictly numeric values only)
  if (isRecord(data.metrics)) {
    const metrics: Record<string, number> = {};
    for (const [k, v] of Object.entries(data.metrics)) {
      if (FORBIDDEN_KEY_PATTERN.test(k)) continue;
      if (typeof v === 'number' && !Number.isNaN(v)) {
        metrics[k] = v;
      }
    }
    if (Object.keys(metrics).length > 0) {
      result.metrics = metrics;
    }
  }

  return result;
}
