import type {
  EpisodeRewardItem,
  EvaluationArtifactItem,
  SimcoreEvaluationResultData,
} from '../api/generated/types.gen';

export interface SanitizedEvaluationResultData {
  finalStatus: 'finished' | 'stopped' | 'rejected';
  runName: string | null;
  externalJobId: string | null;
  returnCode: number | null;
  successRate: number | null;
  episodes: number | null;
  averageCumulativeReward: number | null;
  episodeRewards: EpisodeRewardItem[];
  failure?: {
    code: string;
    message: string;
  } | null;
  assembly: {
    complete: boolean;
    retryExhausted: boolean;
    attempts: number;
    diagnostics: string[];
    verifiedArtifactIds: string[];
  };
  executionProof: {
    nodeId: string;
    platformTaskId: string;
    requestId: string;
    jobId: string | null;
    instanceId: string | null;
    state: string;
    exitConfirmed: boolean;
  };
  artifacts: EvaluationArtifactItem[];
}

const FORBIDDEN_KEY_PATTERN =
  /path|cwd|command|script|stdout|stderr|roots|engineRoot|trainingRoot|logTail|errorTail|playerUrl|debug/i;

export function parseSanitizedEvaluationResult(raw: unknown): SanitizedEvaluationResultData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Check forbidden keys in root
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      return null;
    }
  }

  const finalStatus = obj.finalStatus;
  if (finalStatus !== 'finished' && finalStatus !== 'stopped' && finalStatus !== 'rejected') {
    return null;
  }

  // Parse successRate, preserving real 0.0
  let successRate: number | null = null;
  if (typeof obj.successRate === 'number' && Number.isFinite(obj.successRate)) {
    successRate = obj.successRate;
  }

  // Parse episodes
  let episodes: number | null = null;
  if (typeof obj.episodes === 'number' && Number.isInteger(obj.episodes) && obj.episodes >= 0) {
    episodes = obj.episodes;
  }

  // Parse averageCumulativeReward, preserving real 0.0
  let averageCumulativeReward: number | null = null;
  if (typeof obj.averageCumulativeReward === 'number' && Number.isFinite(obj.averageCumulativeReward)) {
    averageCumulativeReward = obj.averageCumulativeReward;
  }

  // Parse episodeRewards array
  const episodeRewards: EpisodeRewardItem[] = [];
  if (Array.isArray(obj.episodeRewards)) {
    for (const item of obj.episodeRewards) {
      if (item && typeof item === 'object') {
        const ep = item.episode;
        const reward = item.cumulativeReward;
        const steps = item.steps;
        const success = item.success;
        if (
          typeof ep === 'number' &&
          typeof reward === 'number' &&
          Number.isFinite(reward) &&
          typeof steps === 'number' &&
          typeof success === 'boolean'
        ) {
          episodeRewards.push({
            episode: ep,
            cumulativeReward: reward,
            steps,
            success,
          });
        }
      }
    }
  }

  // Parse assembly info
  const rawAssembly = (obj.assembly && typeof obj.assembly === 'object' ? obj.assembly : {}) as Record<string, unknown>;
  const complete = rawAssembly.complete === true;
  const retryExhausted = rawAssembly.retryExhausted === true;
  const attempts = typeof rawAssembly.attempts === 'number' ? rawAssembly.attempts : 0;
  const diagnostics = Array.isArray(rawAssembly.diagnostics)
    ? rawAssembly.diagnostics.filter((d): d is string => typeof d === 'string')
    : [];
  const verifiedArtifactIds = Array.isArray(rawAssembly.verifiedArtifactIds)
    ? rawAssembly.verifiedArtifactIds.filter((id): id is string => typeof id === 'string')
    : [];

  // Parse execution proof
  const rawProof = (obj.executionProof && typeof obj.executionProof === 'object' ? obj.executionProof : {}) as Record<string, unknown>;
  const executionProof = {
    nodeId: typeof rawProof.nodeId === 'string' ? rawProof.nodeId : '',
    platformTaskId: typeof rawProof.platformTaskId === 'string' ? rawProof.platformTaskId : '',
    requestId: typeof rawProof.requestId === 'string' ? rawProof.requestId : '',
    jobId: typeof rawProof.jobId === 'string' ? rawProof.jobId : null,
    instanceId: typeof rawProof.instanceId === 'string' ? rawProof.instanceId : null,
    state: typeof rawProof.state === 'string' ? rawProof.state : '',
    exitConfirmed: rawProof.exitConfirmed === true,
  };

  // Parse failure info
  let failure: { code: string; message: string } | null = null;
  if (obj.failure && typeof obj.failure === 'object') {
    const f = obj.failure as Record<string, unknown>;
    if (typeof f.code === 'string' && typeof f.message === 'string') {
      failure = { code: f.code, message: f.message };
    }
  }

  // Parse artifacts
  const artifacts: EvaluationArtifactItem[] = [];
  if (Array.isArray(obj.artifacts)) {
    for (const art of obj.artifacts) {
      if (art && typeof art === 'object') {
        const artifactId = art.artifactId;
        const name = art.name;
        const kind = art.kind;
        const sizeBytes = art.sizeBytes;
        const sha256 = art.sha256;
        const downloadAvailable = art.downloadAvailable === true;

        if (
          typeof artifactId === 'string' &&
          typeof name === 'string' &&
          (name === 'summary.json' || name === 'evaluation_steps.csv' || name === 'config_snapshot.json') &&
          typeof kind === 'string' &&
          typeof sizeBytes === 'number' &&
          typeof sha256 === 'string'
        ) {
          artifacts.push({
            artifactId,
            name,
            kind: kind as 'metrics' | 'file',
            sizeBytes,
            sha256,
            downloadAvailable,
          });
        }
      }
    }
  }

  return {
    finalStatus,
    runName: typeof obj.runName === 'string' ? obj.runName : null,
    externalJobId: typeof obj.externalJobId === 'string' ? obj.externalJobId : null,
    returnCode: typeof obj.returnCode === 'number' ? obj.returnCode : null,
    successRate,
    episodes,
    averageCumulativeReward,
    episodeRewards,
    failure,
    assembly: {
      complete,
      retryExhausted,
      attempts,
      diagnostics,
      verifiedArtifactIds,
    },
    executionProof,
    artifacts,
  };
}
