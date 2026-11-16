export type FeedbackTopic = '使用体验' | '问题反馈/Bug' | '功能建议' | '其他';

export type FeedbackRating = 1 | 2 | 3 | 4;

export interface SubmitFeedbackPayload {
  topic?: FeedbackTopic;
  rating: FeedbackRating;
  message?: string;
  sourceUrl?: string;
}

export interface SubmitFeedbackResult {
  success: boolean;
  error?: {
    code?: string;
    message?: string;
  };
}

export async function submitFeedback(
  payload: SubmitFeedbackPayload,
  signal?: AbortSignal,
): Promise<SubmitFeedbackResult> {
  try {
    const res = await fetch('/api/v1/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      let errJson: any = null;
      try {
        errJson = await res.json();
      } catch {
        // ignore json parse error
      }
      const message =
        errJson?.error?.message ||
        errJson?.message ||
        (res.status === 429 ? '提交反馈过于频繁，请稍后再试' : '发送失败，请稍后重试');
      const code = errJson?.error?.code || (res.status === 429 ? 'RATE_LIMITED' : 'ERROR');
      return { success: false, error: { code, message } };
    }

    return { success: true };
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      return { success: false, error: { code: 'ABORTED', message: '已取消' } };
    }
    return {
      success: false,
      error: { code: 'NETWORK_ERROR', message: '网络异常，请检查连接后重试' },
    };
  }
}
