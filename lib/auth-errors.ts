import type { ErrorResponse } from './api';

export interface NormalizedAuthError {
  code: string;
  message: string;
  requestId?: string;
  retryAfter?: string | null;
}

/**
 * 验证目标路径是否为安全、合法的站内相对路径，防止开放重定向攻击与认证页滞留。
 * 规则：
 * 1. 必须以 '/' 开头
 * 2. 不能以 '//' 或 '/\' 开头（防止协议相对 URL 或反斜杠绕过）
 * 3. 不能包含反斜杠 '\'
 * 4. 不能包含冒号协议（如 'http:'、'https:'、'javascript:'）
 * 5. 不能为认证页面（/login, /register），防止登录后重定向回登录/注册页造成反复刷新或滞留
 */
export function isValidNextUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return false;
  if (trimmed.includes('\\')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;

  // 提取纯 pathname 部分（去除 query 与 hash），禁止重定向到认证页面
  const pathname = trimmed.split('?')[0].split('#')[0];
  if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password') {
    return false;
  }

  return true;
}

/**
 * 将各类错误（API ErrorResponse、HTTP 状态码、网络异常等）统一解析并映射为规范文案。
 */
export function normalizeAuthError(err: unknown, status?: number, retryAfter?: string | null): NormalizedAuthError {
  // 1. 如果是 API 返回的已解析结构 ErrorResponse
  if (err && typeof err === 'object') {
    const maybeObj = err as Record<string, any>;
    const errorBody = maybeObj.error || maybeObj;
    const code = typeof errorBody.code === 'string' ? errorBody.code : '';
    const requestId = typeof errorBody.requestId === 'string' ? errorBody.requestId : undefined;

    switch (code) {
      case 'INVALID_CREDENTIALS':
        return {
          code: 'INVALID_CREDENTIALS',
          message: '账号或密码错误，请重新输入',
          requestId,
        };
      case 'EMAIL_ALREADY_EXISTS':
        return {
          code: 'EMAIL_ALREADY_EXISTS',
          message: '该邮箱已被注册，请使用其他邮箱或直接登录',
          requestId,
        };
      case 'PHONE_NUMBER_ALREADY_EXISTS':
        return {
          code: 'PHONE_NUMBER_ALREADY_EXISTS',
          message: '该手机号已被注册，请直接登录',
          requestId,
        };
      case 'INVALID_VERIFICATION_CODE':
        return {
          code: 'INVALID_VERIFICATION_CODE',
          message: '验证码错误或已失效，请重新获取并输入',
          requestId,
        };
      case 'SMS_PROVIDER_ERROR':
        return {
          code: 'SMS_PROVIDER_ERROR',
          message: '短信发送失败，请稍后重试',
          requestId,
        };
      case 'RECOVERY_DISABLED':
        return {
          code: 'RECOVERY_DISABLED',
          message: '找回密码服务暂不可用，请稍后重试',
          requestId,
        };
      case 'INVALID_RECOVERY_CODE':
        return {
          code: 'INVALID_RECOVERY_CODE',
          message: '验证码错误或已失效，请重新获取并输入',
          requestId,
        };
      case 'INVALID_RECOVERY_TICKET':
        return {
          code: 'INVALID_RECOVERY_TICKET',
          message: '重置凭据已失效，请重新获取验证码',
          requestId,
        };
      case 'SERVICE_UNAVAILABLE':
        return {
          code: 'SERVICE_UNAVAILABLE',
          message: '服务暂不可用，请稍后重试',
          requestId,
        };
      case 'AUTHENTICATION_REQUIRED':
        return {
          code: 'AUTHENTICATION_REQUIRED',
          message: '会话已过期，请重新登录',
          requestId,
        };
      case 'ORIGIN_NOT_ALLOWED':
        return {
          code: 'ORIGIN_NOT_ALLOWED',
          message: '请求来源受限，操作已被拦截',
          requestId,
        };
      case 'UNSUPPORTED_MEDIA_TYPE':
        return {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: '不支持的请求数据格式',
          requestId,
        };
      case 'RATE_LIMITED': {
        const retryMsg = retryAfter ? `，请在 ${retryAfter} 秒后再试` : '，请稍后再试';
        return {
          code: 'RATE_LIMITED',
          message: `请求过于频繁${retryMsg}`,
          requestId,
          retryAfter,
        };
      }
      case 'INVALID_REQUEST':
        return {
          code: 'INVALID_REQUEST',
          message: typeof errorBody.message === 'string' && errorBody.message
            ? errorBody.message
            : '输入内容格式不正确，请检查后重试',
          requestId,
        };
      case 'INTERNAL_ERROR':
        return {
          code: 'INTERNAL_ERROR',
          message: '服务暂不可用，请稍后重试',
          requestId,
        };
    }

    if (code) {
      return {
        code,
        message: typeof errorBody.message === 'string' && errorBody.message
          ? errorBody.message
          : '服务暂不可用，请稍后重试',
        requestId,
      };
    }
  }

  // 2. 根据 HTTP 状态码回退
  if (status === 401) {
    return {
      code: 'AUTHENTICATION_REQUIRED',
      message: '会话已失效，请重新登录',
    };
  }
  if (status === 403) {
    return {
      code: 'ORIGIN_NOT_ALLOWED',
      message: '请求来源受限，操作已被拦截',
    };
  }
  if (status === 409) {
    return {
      code: 'EMAIL_ALREADY_EXISTS',
      message: '该邮箱已被注册，请直接登录',
    };
  }
  if (status === 503) {
    return {
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用，请稍后重试',
    };
  }
  if (status === 415) {
    return {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: '不支持的请求数据格式',
    };
  }
  if (status === 429) {
    const retryMsg = retryAfter ? `，请在 ${retryAfter} 秒后再试` : '，请稍后再试';
    return {
      code: 'RATE_LIMITED',
      message: `请求过于频繁${retryMsg}`,
      retryAfter,
    };
  }
  if (status === 400) {
    return {
      code: 'INVALID_REQUEST',
      message: '请求参数不合法，请检查后重试',
    };
  }

  // 3. 网络异常与未知错误
  const isNetwork = err instanceof TypeError || (err instanceof Error && /network|fetch/i.test(err.message));
  if (isNetwork) {
    return {
      code: 'NETWORK_ERROR',
      message: '网络连接失败，请检查网络连接后重试',
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: '发生未知错误，请稍后重试',
  };
}
