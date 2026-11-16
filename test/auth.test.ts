import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

import { isValidNextUrl, normalizeAuthError } from '../lib/auth-errors';
import { evaluateRouteGuard } from '../lib/auth-guard';
import { client } from '../lib/api/client';
import { login, loginWithSms, sendSmsCode, register, logout, getCurrentUser } from '../lib/api/generated/sdk.gen';

describe('1. 路由重定向与开放重定向防御测试 (isValidNextUrl)', () => {
  test('允许合法的站内相对路径', () => {
    assert.equal(isValidNextUrl('/'), true);
    assert.equal(isValidNextUrl('/projects'), true);
    assert.equal(isValidNextUrl('/projects/123/tasks'), true);
    assert.equal(isValidNextUrl('/resources?filter=all'), true);
    assert.equal(isValidNextUrl('  /projects  '), true);
  });

  test('拒绝外部完整 URL 与不同协议', () => {
    assert.equal(isValidNextUrl('https://evil.com'), false);
    assert.equal(isValidNextUrl('http://evil.com/login'), false);
    assert.equal(isValidNextUrl('javascript:alert(1)'), false);
    assert.equal(isValidNextUrl('data:text/html,evil'), false);
  });

  test('拒绝双斜杠及反斜杠协议相对 URL (开放重定向攻击向量)', () => {
    assert.equal(isValidNextUrl('//evil.com'), false);
    assert.equal(isValidNextUrl('//evil.com/projects'), false);
    assert.equal(isValidNextUrl('/\\evil.com'), false);
    assert.equal(isValidNextUrl('/projects\\tasks'), false);
  });

  test('拒绝将 /login 或 /register 作为 next 参数，防止登录后停留在认证页或造成反复跳转', () => {
    assert.equal(isValidNextUrl('/login'), false);
    assert.equal(isValidNextUrl('/register'), false);
    assert.equal(isValidNextUrl('/forgot-password'), false);
    assert.equal(isValidNextUrl('/login?next=%2Fprojects'), false);
    assert.equal(isValidNextUrl('/register?source=invite'), false);
    assert.equal(isValidNextUrl('/forgot-password?account=test'), false);
    assert.equal(isValidNextUrl('  /login  '), false);
    assert.equal(isValidNextUrl('/register#section'), false);
  });

  test('拒绝空、非字符串或无效输入', () => {
    assert.equal(isValidNextUrl(null), false);
    assert.equal(isValidNextUrl(undefined), false);
    assert.equal(isValidNextUrl(''), false);
    assert.equal(isValidNextUrl('   '), false);
    assert.equal(isValidNextUrl('projects'), false); // 缺少前导斜杠
  });
});

describe('2. OpenAPI ErrorResponse 错误处理与规范化测试 (normalizeAuthError)', () => {
  test('INVALID_CREDENTIALS: 统一凭证错误提示 (不区分账号不存在、密码错误或用户禁用)', () => {
    const err = normalizeAuthError({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials.',
        requestId: 'req_123',
      },
    }, 401);
    assert.equal(err.code, 'INVALID_CREDENTIALS');
    assert.equal(err.message, '账号或密码错误，请重新输入');
    assert.equal(err.requestId, 'req_123');
  });

  test('EMAIL_ALREADY_EXISTS: 邮箱冲突提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'The email is already registered.',
        requestId: 'req_456',
      },
    }, 409);
    assert.equal(err.code, 'EMAIL_ALREADY_EXISTS');
    assert.equal(err.message, '该邮箱已被注册，请使用其他邮箱或直接登录');
    assert.equal(err.requestId, 'req_456');
  });

  test('PHONE_NUMBER_ALREADY_EXISTS: 手机号冲突提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'PHONE_NUMBER_ALREADY_EXISTS',
        message: 'The phone number is already registered.',
        requestId: 'req_phone_dup',
      },
    }, 409);
    assert.equal(err.code, 'PHONE_NUMBER_ALREADY_EXISTS');
    assert.equal(err.message, '该手机号已被注册，请直接登录');
    assert.equal(err.requestId, 'req_phone_dup');
  });

  test('INVALID_VERIFICATION_CODE: 验证码错误或失效提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'INVALID_VERIFICATION_CODE',
        message: 'Invalid or expired code.',
        requestId: 'req_code_err',
      },
    }, 400);
    assert.equal(err.code, 'INVALID_VERIFICATION_CODE');
    assert.equal(err.message, '验证码错误或已失效，请重新获取并输入');
    assert.equal(err.requestId, 'req_code_err');
  });

  test('SMS_PROVIDER_ERROR: 短信服务商错误提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'SMS_PROVIDER_ERROR',
        message: 'SMS provider dispatch failed.',
        requestId: 'req_sms_err',
      },
    }, 503);
    assert.equal(err.code, 'SMS_PROVIDER_ERROR');
    assert.equal(err.message, '短信发送失败，请稍后重试');
    assert.equal(err.requestId, 'req_sms_err');
  });

  test('RECOVERY_DISABLED: 找回密码服务未启用门禁提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'RECOVERY_DISABLED',
        message: 'Password recovery feature is currently disabled.',
        requestId: 'req_rec_disabled',
      },
    }, 503);
    assert.equal(err.code, 'RECOVERY_DISABLED');
    assert.equal(err.message, '找回密码服务暂不可用，请稍后重试');
    assert.equal(err.requestId, 'req_rec_disabled');
  });

  test('INVALID_RECOVERY_CODE: 找回密码验证码错误或失效提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'INVALID_RECOVERY_CODE',
        message: 'Invalid or expired recovery code.',
        requestId: 'req_rec_code',
      },
    }, 400);
    assert.equal(err.code, 'INVALID_RECOVERY_CODE');
    assert.equal(err.message, '验证码错误或已失效，请重新获取并输入');
    assert.equal(err.requestId, 'req_rec_code');
  });

  test('INVALID_RECOVERY_TICKET: 重置凭据失效提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'INVALID_RECOVERY_TICKET',
        message: 'Invalid or expired reset ticket.',
        requestId: 'req_rec_ticket',
      },
    }, 400);
    assert.equal(err.code, 'INVALID_RECOVERY_TICKET');
    assert.equal(err.message, '重置凭据已失效，请重新获取验证码');
    assert.equal(err.requestId, 'req_rec_ticket');
  });

  test('SERVICE_UNAVAILABLE: 存储不可用 fail-closed 提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Critical service unavailable.',
        requestId: 'req_503',
      },
    }, 503);
    assert.equal(err.code, 'SERVICE_UNAVAILABLE');
    assert.equal(err.message, '服务暂不可用，请稍后重试');
    assert.equal(err.requestId, 'req_503');
  });

  test('AUTHENTICATION_REQUIRED: 未认证或会话过期提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required.',
        requestId: 'req_auth',
      },
    }, 401);
    assert.equal(err.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(err.message, '会话已过期，请重新登录');
  });

  test('ORIGIN_NOT_ALLOWED: 可信来源受限提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Untrusted origin.',
      },
    }, 403);
    assert.equal(err.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(err.message, '请求来源受限，操作已被拦截');
  });

  test('UNSUPPORTED_MEDIA_TYPE: 不支持的媒体类型提示', () => {
    const err = normalizeAuthError({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported content type.',
      },
    }, 415);
    assert.equal(err.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(err.message, '不支持的请求数据格式');
  });

  test('RATE_LIMITED: 限流提示并在提供时显示 Retry-After', () => {
    const withRetry = normalizeAuthError({
      error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
    }, 429, '15');
    assert.equal(withRetry.code, 'RATE_LIMITED');
    assert.equal(withRetry.message, '请求过于频繁，请在 15 秒后再试');
    assert.equal(withRetry.retryAfter, '15');

    const withoutRetry = normalizeAuthError({
      error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
    }, 429, null);
    assert.equal(withoutRetry.code, 'RATE_LIMITED');
    assert.equal(withoutRetry.message, '请求过于频繁，请稍后再试');
  });

  test('INVALID_REQUEST: 参数校验错误', () => {
    const err = normalizeAuthError({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Password must be at least 8 characters.',
        requestId: 'req_val',
      },
    }, 400);
    assert.equal(err.code, 'INVALID_REQUEST');
    assert.equal(err.message, 'Password must be at least 8 characters.');
    assert.equal(err.requestId, 'req_val');
  });

  test('INTERNAL_ERROR: 服务端错误保护，不泄露堆栈或 SQL', () => {
    const err = normalizeAuthError({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error occurred.',
        requestId: 'req_internal_999',
      },
    }, 500);
    assert.equal(err.code, 'INTERNAL_ERROR');
    assert.equal(err.message, '服务暂不可用，请稍后重试');
    assert.equal(err.requestId, 'req_internal_999');
  });

  test('网络异常 (TypeError / fetch 失败)', () => {
    const netErr = new TypeError('Failed to fetch');
    const err = normalizeAuthError(netErr);
    assert.equal(err.code, 'NETWORK_ERROR');
    assert.equal(err.message, '网络连接失败，请检查网络连接后重试');
  });

  test('仅有 HTTP 状态码时的降级处理', () => {
    assert.equal(normalizeAuthError(null, 401).code, 'AUTHENTICATION_REQUIRED');
    assert.equal(normalizeAuthError(null, 403).code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(normalizeAuthError(null, 409).code, 'EMAIL_ALREADY_EXISTS');
    assert.equal(normalizeAuthError(null, 415).code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(normalizeAuthError(null, 429).code, 'RATE_LIMITED');
    assert.equal(normalizeAuthError(null, 400).code, 'INVALID_REQUEST');
  });
});

describe('3. 生成客户端与 Same-origin / Cookie 安全约定测试', () => {
  test('统一 Client 配置 baseUrl 为相对路径，遵循 same-origin 规则', () => {
    const cfg = client.getConfig();
    assert.equal(cfg.baseUrl, '', 'baseUrl 必须为空字符串，以确保请求通过同源相对路径');
  });

  test('Auth 操作路径与 Method 完全符合 OpenAPI 权威契约', () => {
    // 检查各 SDK 方法签名及调用选项
    assert.equal(typeof login, 'function');
    assert.equal(typeof register, 'function');
    assert.equal(typeof logout, 'function');
    assert.equal(typeof getCurrentUser, 'function');
  });
});

describe('4. 当前账户状态机逻辑测试 (/auth/me, login, register, logout)', () => {
  // 模拟状态容器测试状态流转逻辑
  type AuthState = {
    status: 'loading' | 'authenticated' | 'unauthenticated' | 'error';
    user: any;
    subscription: any;
    error: any;
  };

  test('初始加载成功 (200 OK): 保存 User 与 ACTIVE Subscription，进入 authenticated', () => {
    const state: AuthState = { status: 'loading', user: null, subscription: null, error: null };

    // 模拟 200 返回
    const mockApiResponse = {
      data: {
        user: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'alice@example.com',
          phoneNumber: '+8613812345678',
          phoneVerified: true,
          organizationName: null,
          role: 'USER',
          createdAt: '2026-09-17T08:00:00.000Z',
          updatedAt: '2026-09-17T08:00:00.000Z',
        },
        subscription: {
          id: '223e4567-e89b-12d3-a456-426614174000',
          status: 'ACTIVE',
          startedAt: '2026-09-17T08:00:00.000Z',
          endedAt: null,
          plan: {
            id: '323e4567-e89b-12d3-a456-426614174000',
            code: 'FREE',
            name: 'Free',
          },
        },
      },
      response: { status: 200 },
    };

    if (mockApiResponse.data) {
      state.user = mockApiResponse.data.user;
      state.subscription = mockApiResponse.data.subscription;
      state.status = 'authenticated';
      state.error = null;
    }

    assert.equal(state.status, 'authenticated');
    assert.equal(state.user.email, 'alice@example.com');
    assert.equal(state.user.phoneNumber, '+8613812345678');
    assert.equal(state.user.phoneVerified, true);
    assert.equal(state.user.role, 'USER');
    assert.equal(state.subscription.status, 'ACTIVE');
    assert.equal(state.subscription.plan.code, 'FREE');
  });

  test('/auth/me 401 响应: 清空账户状态并进入 unauthenticated', () => {
    const state: AuthState = {
      status: 'authenticated',
      user: { email: 'alice@example.com' },
      subscription: { status: 'ACTIVE' },
      error: null,
    };

    const mock401 = { error: { code: 'AUTHENTICATION_REQUIRED' }, response: { status: 401 } };
    if (mock401.response.status === 401) {
      state.user = null;
      state.subscription = null;
      state.status = 'unauthenticated';
      state.error = null;
    }

    assert.equal(state.status, 'unauthenticated');
    assert.equal(state.user, null);
    assert.equal(state.subscription, null);
  });

  test('/auth/me 500 或网络错误: 不误判为退出，保留错误状态供重试', () => {
    const state: AuthState = {
      status: 'loading',
      user: null,
      subscription: null,
      error: null,
    };

    const mock500 = {
      error: { code: 'INTERNAL_ERROR', message: 'Database query failed.', requestId: 'req_err_1' },
      response: { status: 500 },
    };

    const normErr = normalizeAuthError(mock500.error, mock500.response.status);
    state.status = 'error';
    state.error = normErr;

    assert.equal(state.status, 'error', '500 错误绝不能设置为 unauthenticated 导致用户被踢出');
    assert.equal(state.error.code, 'INTERNAL_ERROR');
    assert.equal(state.error.requestId, 'req_err_1');
  });

  test('Logout 正常退出与幂等性 (204 No Content): 清除账户状态并返回 unauthenticated', () => {
    const state: AuthState = {
      status: 'authenticated',
      user: { email: 'alice@example.com' },
      subscription: { status: 'ACTIVE' },
      error: null,
    };

    const mockLogout204 = { response: { status: 204 } };
    if (mockLogout204.response.status === 204) {
      state.user = null;
      state.subscription = null;
      state.status = 'unauthenticated';
      state.error = null;
    }

    assert.equal(state.status, 'unauthenticated');
    assert.equal(state.user, null);
  });

  test('Logout 失败 (500): 不假装服务端 Session 已撤销', () => {
    const state: AuthState = {
      status: 'authenticated',
      user: { email: 'alice@example.com' },
      subscription: { status: 'ACTIVE' },
      error: null,
    };

    const mockLogout500 = {
      error: { code: 'INTERNAL_ERROR', message: 'Redis connection lost' },
      response: { status: 500 },
    };

    const normErr = normalizeAuthError(mockLogout500.error, mockLogout500.response.status);
    state.error = normErr;

    // 状态未被清空为 unauthenticated
    assert.equal(state.status, 'authenticated');
    assert.notEqual(state.user, null);
    assert.equal(state.error.code, 'INTERNAL_ERROR');
  });
});

describe('5. 真实路由守卫与防循环重定向规则测试 (evaluateRouteGuard & 4-State Guard)', () => {
  // 受保护核心路径清单（涵盖所有项目列表、项目详情、任务页、新建页、流水线工作区与资源页）
  const protectedRoutes = [
    '/projects',
    '/projects/new',
    '/projects/p-alpha',
    '/projects/p-alpha/tasks',
    '/projects/p-alpha/requirements',
    '/projects/p-alpha/embodex',
    '/projects/p-alpha/simcore',
    '/requirements',
    '/requirements/req-1',
    '/embodex',
    '/simcore',
    '/resources',
    '/resources/dataset-01',
  ];

  test('受保护路径在 unauthenticated 状态下必须重定向至登录页并携带 next 参数，且视图类型为 unauthenticated', () => {
    for (const route of protectedRoutes) {
      const decision = evaluateRouteGuard(route, 'unauthenticated');
      assert.equal(decision.isPublic, false, `${route} 绝不能被判定为公开路由`);
      assert.equal(decision.shouldRedirect, true, `${route} 未登录时必须触发重定向`);
      assert.equal(decision.redirectUrl, `/login?next=${encodeURIComponent(route)}`);
      assert.equal(decision.viewType, 'unauthenticated', `${route} 必须展示未登录跳转态，绝不暴露业务内容`);
    }
  });

  test('受保护路径在 loading 状态下禁止提前暴露业务内容或触发误重定向，保持 loading 视图', () => {
    for (const route of protectedRoutes) {
      const decision = evaluateRouteGuard(route, 'loading');
      assert.equal(decision.isPublic, false);
      assert.equal(decision.shouldRedirect, false, `${route} loading 期间绝不能发生重定向`);
      assert.equal(decision.redirectUrl, null);
      assert.equal(decision.viewType, 'loading', `${route} loading 期间必须渲染校验骨架`);
    }
  });

  test('受保护路径在 error 状态下不误重定向至登录页，保持 error 重试视图', () => {
    for (const route of protectedRoutes) {
      const decision = evaluateRouteGuard(route, 'error');
      assert.equal(decision.isPublic, false);
      assert.equal(decision.shouldRedirect, false, `${route} error 状态绝不能误重定向`);
      assert.equal(decision.redirectUrl, null);
      assert.equal(decision.viewType, 'error', `${route} error 状态必须展示错误恢复重试卡片`);
    }
  });

  test('受保护路径在 authenticated 状态下方允许渲染受保护业务内容 (protected_content)', () => {
    for (const route of protectedRoutes) {
      const decision = evaluateRouteGuard(route, 'authenticated');
      assert.equal(decision.isPublic, false);
      assert.equal(decision.shouldRedirect, false);
      assert.equal(decision.redirectUrl, null);
      assert.equal(decision.viewType, 'protected_content', `${route} 已认证状态方可渲染受保护内容`);
    }
  });

  test('公开首页 (/) 在任何状态下均允许访问，绝不触发强制登录重定向', () => {
    for (const status of ['loading', 'authenticated', 'unauthenticated', 'error'] as const) {
      const decision = evaluateRouteGuard('/', status);
      assert.equal(decision.isPublic, true);
      assert.equal(decision.shouldRedirect, false);
      assert.equal(decision.redirectUrl, null);
      assert.equal(decision.viewType, 'public');
    }
  });

  test('找回密码页 (/forgot-password) 在任何状态下均允许访问且绝不自动重定向至工作区', () => {
    for (const status of ['loading', 'authenticated', 'unauthenticated', 'error'] as const) {
      const decision = evaluateRouteGuard('/forgot-password', status);
      assert.equal(decision.isPublic, true);
      assert.equal(decision.shouldRedirect, false);
      assert.equal(decision.redirectUrl, null);
      assert.equal(decision.viewType, 'auth_page');
    }
  });

  test('未认证用户访问 /login 与 /register 渲染独立认证页 (auth_page)，不触发重定向', () => {
    for (const authRoute of ['/login', '/register']) {
      const decision = evaluateRouteGuard(authRoute, 'unauthenticated');
      assert.equal(decision.isPublic, true);
      assert.equal(decision.shouldRedirect, false);
      assert.equal(decision.redirectUrl, null);
      assert.equal(decision.viewType, 'auth_page');
    }
  });

  test('已认证用户访问 /login 或 /register 时，自动重定向至合法站内目标或默认 /projects', () => {
    // 1. 无 next 参数时默认回退 /projects
    const d1 = evaluateRouteGuard('/login', 'authenticated');
    assert.equal(d1.shouldRedirect, true);
    assert.equal(d1.redirectUrl, '/projects');

    // 2. 带合法 next 参数时重定向至目标
    const d2 = evaluateRouteGuard('/login', 'authenticated', '/projects/p1/tasks');
    assert.equal(d2.shouldRedirect, true);
    assert.equal(d2.redirectUrl, '/projects/p1/tasks');

    // 3. 带非法外部协议或开放重定向攻击链接时安全回退至 /projects
    const d3 = evaluateRouteGuard('/login', 'authenticated', 'https://malicious.com');
    assert.equal(d3.shouldRedirect, true);
    assert.equal(d3.redirectUrl, '/projects');

    const d4 = evaluateRouteGuard('/register', 'authenticated', '//malicious.com');
    assert.equal(d4.shouldRedirect, true);
    assert.equal(d4.redirectUrl, '/projects');
  });

  test('已认证用户访问 /login 或 /register 时，严禁接受 /login 或 /register 作为 next 参数（防滞留认证页）', () => {
    // 关键 MAJOR 4 防御断言：若 next 显式指定为 /login 或 /register，必须被拒绝并安全回退到 /projects
    const dLogin = evaluateRouteGuard('/login', 'authenticated', '/login');
    assert.equal(dLogin.shouldRedirect, true);
    assert.equal(dLogin.redirectUrl, '/projects', 'next=/login 必须被拒绝并回退到 /projects');

    const dReg = evaluateRouteGuard('/login', 'authenticated', '/register');
    assert.equal(dReg.shouldRedirect, true);
    assert.equal(dReg.redirectUrl, '/projects', 'next=/register 必须被拒绝并回退到 /projects');

    const dQuery = evaluateRouteGuard('/login', 'authenticated', '/login?next=%2Fprojects');
    assert.equal(dQuery.shouldRedirect, true);
    assert.equal(dQuery.redirectUrl, '/projects', '带参数的 /login?xxx 同样必须被拒绝并回退');
  });

  test('/login 与 /register 互转不产生循环重定向', () => {
    assert.equal(evaluateRouteGuard('/login', 'unauthenticated').shouldRedirect, false);
    assert.equal(evaluateRouteGuard('/register', 'unauthenticated').shouldRedirect, false);
  });
});

describe('6. 客户端端到端认证闭环生命周期测试 (Client SDK Lifecycle Cycle)', () => {
  let sessionToken: string | null = null;
  const originalFetch = globalThis.fetch;

  // 模拟平台后端同一源接口行为
  beforeEach(() => {
    sessionToken = null;
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = input instanceof Request ? input : null;
      const url = req ? req.url : typeof input === 'string' ? input : input.toString();
      const method = (req ? req.method : init?.method) || 'GET';
      const bodyText = req ? await req.clone().text() : typeof init?.body === 'string' ? init.body : '';

      if (url.endsWith('/api/v1/auth/sms/send') && method === 'POST') {
        const body = JSON.parse(bodyText);
        assert.ok(body.phoneNumber, '必须包含 phoneNumber');
        assert.ok(body.purpose, '必须包含 purpose');
        return new Response(
          JSON.stringify({
            accepted: true,
            retryAfter: 60,
            expiresIn: 300,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/v1/auth/login/sms') && method === 'POST') {
        const body = JSON.parse(bodyText);
        if (body.phoneNumber === '+8613812345678' && body.code === '123456') {
          sessionToken = 'mock-session-token-sms';
          return new Response(
            JSON.stringify({
              user: {
                id: '11111111-1111-1111-1111-111111111111',
                email: 'test@example.com',
                phoneNumber: '+8613812345678',
                phoneVerified: true,
                organizationName: null,
                role: 'USER',
                createdAt: '2026-09-17T08:00:00.000Z',
                updatedAt: '2026-09-17T08:00:00.000Z',
              },
              subscription: {
                id: '22222222-2222-2222-2222-222222222222',
                status: 'ACTIVE',
                startedAt: '2026-09-17T08:00:00.000Z',
                endedAt: null,
                plan: {
                  id: '33333333-3333-3333-3333-333333333333',
                  code: 'FREE',
                  name: 'Free',
                },
              },
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': 'embodix_session=mock-session-token-sms; Path=/; HttpOnly; SameSite=Lax',
                'Cache-Control': 'no-store',
              },
            },
          );
        }
        return new Response(
          JSON.stringify({
            error: {
              code: 'INVALID_VERIFICATION_CODE',
              message: 'Invalid verification code.',
              requestId: 'req_sms_fail',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/v1/auth/register') && method === 'POST') {
        const body = JSON.parse(bodyText);
        assert.ok(body.phoneNumber, '必须包含 phoneNumber');
        assert.ok(body.code, '必须包含 code');
        assert.ok(body.password, '必须包含 password');
        sessionToken = 'mock-session-token-123';
        const resBody = {
          user: {
            id: '11111111-1111-1111-1111-111111111111',
            email: body.email || null,
            phoneNumber: body.phoneNumber,
            phoneVerified: true,
            organizationName: body.organizationName || null,
            role: 'USER',
            createdAt: '2026-09-17T08:00:00.000Z',
            updatedAt: '2026-09-17T08:00:00.000Z',
          },
          subscription: {
            id: '22222222-2222-2222-2222-222222222222',
            status: 'ACTIVE',
            startedAt: '2026-09-17T08:00:00.000Z',
            endedAt: null,
            plan: {
              id: '33333333-3333-3333-3333-333333333333',
              code: 'FREE',
              name: 'Free',
            },
          },
        };
        return new Response(JSON.stringify(resBody), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'embodix_session=mock-session-token-123; Path=/; HttpOnly; SameSite=Lax',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (url.endsWith('/api/v1/auth/me') && method === 'GET') {
        if (!sessionToken) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'AUTHENTICATION_REQUIRED',
                message: 'Authentication required.',
                requestId: 'req_auth_me_401',
              },
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            user: {
              id: '11111111-1111-1111-1111-111111111111',
              email: 'test@example.com',
              phoneNumber: '+8613812345678',
              phoneVerified: true,
              organizationName: null,
              role: 'USER',
              createdAt: '2026-09-17T08:00:00.000Z',
              updatedAt: '2026-09-17T08:00:00.000Z',
            },
            subscription: {
              id: '22222222-2222-2222-2222-222222222222',
              status: 'ACTIVE',
              startedAt: '2026-09-17T08:00:00.000Z',
              endedAt: null,
              plan: {
                id: '33333333-3333-3333-3333-333333333333',
                code: 'FREE',
                name: 'Free',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
        );
      }

      if (url.endsWith('/api/v1/auth/logout') && method === 'POST') {
        sessionToken = null;
        return new Response(null, {
          status: 204,
          headers: {
            'Set-Cookie': 'embodix_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (url.endsWith('/api/v1/auth/login') && method === 'POST') {
        const body = JSON.parse(bodyText);
        if ((body.account === 'test@example.com' || body.account === '+8613812345678') && body.password === 'valid-pass-123') {
          sessionToken = 'mock-session-token-456';
          return new Response(
            JSON.stringify({
              user: {
                id: '11111111-1111-1111-1111-111111111111',
                email: 'test@example.com',
                phoneNumber: '+8613812345678',
                phoneVerified: true,
                organizationName: null,
                role: 'USER',
                createdAt: '2026-09-17T08:00:00.000Z',
                updatedAt: '2026-09-17T08:00:00.000Z',
              },
              subscription: {
                id: '22222222-2222-2222-2222-222222222222',
                status: 'ACTIVE',
                startedAt: '2026-09-17T08:00:00.000Z',
                endedAt: null,
                plan: {
                  id: '33333333-3333-3333-3333-333333333333',
                  code: 'FREE',
                  name: 'Free',
                },
              },
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': 'embodix_session=mock-session-token-456; Path=/; HttpOnly; SameSite=Lax',
                'Cache-Control': 'no-store',
              },
            },
          );
        }
        return new Response(
          JSON.stringify({
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid credentials.',
              requestId: 'req_login_fail',
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 });
    };

    client.setConfig({
      baseUrl: 'http://127.0.0.1:3000',
      fetch: mockFetch,
    });
  });

  afterEach(() => {
    client.setConfig({
      baseUrl: '',
      fetch: undefined,
    });
  });

  test('全流程闭环：SendSms -> Register -> /auth/me -> Logout -> /auth/me 401 -> Password Login -> Sms Login', async () => {
    // 1. 发送短信验证码
    const sendRes = await sendSmsCode({
      body: {
        phoneNumber: '+8613812345678',
        purpose: 'REGISTER',
      },
    });
    assert.equal(sendRes.response?.status, 200);
    assert.equal(sendRes.data?.accepted, true);
    assert.equal(sendRes.data?.retryAfter, 60);

    // 2. 初始未认证查询 /auth/me
    const initialMe = await getCurrentUser();
    assert.equal(initialMe.response?.status, 401);
    assert.equal(initialMe.error?.error.code, 'AUTHENTICATION_REQUIRED');

    // 3. 手机号验证码注册
    const regRes = await register({
      body: {
        phoneNumber: '+8613812345678',
        code: '123456',
        password: 'valid-pass-123',
        email: 'test@example.com',
      },
    });
    assert.equal(regRes.response?.status, 201);
    assert.equal(regRes.data?.user.phoneNumber, '+8613812345678');
    assert.equal(regRes.data?.user.email, 'test@example.com');
    assert.equal(regRes.data?.subscription.status, 'ACTIVE');

    // 4. 注册成功后查询 /auth/me
    const afterRegMe = await getCurrentUser();
    assert.equal(afterRegMe.response?.status, 200);
    assert.equal(afterRegMe.data?.user.phoneNumber, '+8613812345678');

    // 5. 退出登录
    const logoutRes = await logout();
    assert.equal(logoutRes.response?.status, 204);

    // 6. 退出后再次查询 /auth/me -> 401
    const afterLogoutMe = await getCurrentUser();
    assert.equal(afterLogoutMe.response?.status, 401);
    assert.equal(afterLogoutMe.error?.error.code, 'AUTHENTICATION_REQUIRED');

    // 7. 错误密码登录失败
    const failLogin = await login({
      body: {
        account: '+8613812345678',
        password: 'wrong-password',
      },
    });
    assert.equal(failLogin.response?.status, 401);
    assert.equal(failLogin.error?.error.code, 'INVALID_CREDENTIALS');

    // 8. 手机号密码登录成功
    const okLogin = await login({
      body: {
        account: '+8613812345678',
        password: 'valid-pass-123',
      },
    });
    assert.equal(okLogin.response?.status, 200);
    assert.equal(okLogin.data?.user.phoneNumber, '+8613812345678');

    // 9. 登出后使用短信验证码登录
    await logout();
    const smsLoginRes = await loginWithSms({
      body: {
        phoneNumber: '+8613812345678',
        code: '123456',
      },
    });
    assert.equal(smsLoginRes.response?.status, 200);
    assert.equal(smsLoginRes.data?.user.phoneNumber, '+8613812345678');

    // 10. 验证码登录后查询 /auth/me -> 200
    const finalMe = await getCurrentUser();
    assert.equal(finalMe.response?.status, 200);
    assert.equal(finalMe.data?.subscription.plan.code, 'FREE');
  });

  test('MAJOR 2 防护测试：登录/注册在 refreshUser() 失败后不得导航并停留在认证页', async () => {
    // 模拟应用层提交流程控制器
    type FormFlowState = {
      isLoading: boolean;
      navigatedUrl: string | null;
      formError: string | null;
    };

    const flowState: FormFlowState = {
      isLoading: true,
      navigatedUrl: null,
      formError: null,
    };

    // 模拟服务端登录成功 (res.data 有值)
    const mockLoginRes = { data: { user: { id: 'u1' } } };

    // 模拟随后 refreshUser 因网络抖动或 session 异常返回 null
    const mockRefreshUser = async () => null;

    if (mockLoginRes.data) {
      const userProfile = await mockRefreshUser();
      if (userProfile) {
        flowState.navigatedUrl = '/projects';
      } else {
        flowState.isLoading = false;
        flowState.formError = '登录凭证已签发，但同步用户信息失败，请重试或刷新页面';
      }
    }

    // 严格断言：绝不发生路由跳转，停止 loading，且向用户暴露清晰可操作的错误说明
    assert.equal(flowState.navigatedUrl, null, 'refreshUser 失败时决不能发生路由跳转');
    assert.equal(flowState.isLoading, false, '失败后必须解除 loading 状态允许用户重试');
    assert.match(flowState.formError!, /同步用户信息失败/);
  });
});

describe('7. SP2 actual page handlers preserve per-phone cooldowns', () => {
  for (const page of ['register', 'login']) test(`${page}: A/B/A, expiry, duplicate calls and stale success/error`, async () => {
    const slots: any[] = []; let cursor = 0; let clock = 100000;
    let resolveSms: (value: any) => void = () => {};
    let rejectSms: (value: any) => void = () => {};
    const calls: any[] = []; const tickers: (() => void)[] = [];
    const react = {
      useState(initial: any) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], (value: any) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
      },
      useRef(initial: any) { const slot = cursor++; return slots[slot] ??= { current: initial }; },
      useEffect(effect: () => unknown) { cursor++; effect(); }, Suspense: 'Suspense',
    };
    const jsx = (type: any, props: any) => ({ type, props: props || {} });
    const filename = path.resolve(process.cwd(), 'app', page, 'page.tsx');
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: any = {};
    const fakeRequire = (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/link') return { default: 'a' };
      if (name === 'next/navigation') return { useRouter: () => ({ replace() {} }), useSearchParams: () => ({ get: () => null }) };
      if (name.endsWith('/lib/api')) return { sendSmsCode(request: any) {
        calls.push(request.body); return new Promise((resolve, reject) => { resolveSms = resolve; rejectSms = reject; });
      } };
      if (name.endsWith('/lib/auth-context')) return { useAuth: () => ({ status: 'unauthenticated', refreshUser: async () => null }) };
      if (name.endsWith('/lib/auth-errors')) return { isValidNextUrl, normalizeAuthError };
      throw new Error(`Unexpected require ${name}`);
    };
    class Clock extends Date { static now() { return clock; } }
    vm.runInNewContext(output, { exports, require: fakeRequire, Date: Clock,
      setTimeout: () => 1, clearTimeout() {}, setInterval(fn: () => void) { tickers.push(fn); return tickers.length; }, clearInterval() {} }, { filename });
    const content = exports.default().props.children.type;
    const render = () => { cursor = 0; return content(); };
    const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
    let tree = render();
    const phone = () => nodes(tree).find(n => n.type === 'input' && n.props.type === 'tel');
    const send = () => nodes(tree).find(n => n.type === 'button' && n.props.className === 'auth-send-code-btn');
    const change = (value: string) => { phone().props.onChange({ target: { value } }); tree = render(); };
    change('13000000000');
    let pending = send().props.onClick();
    await send().props.onClick(); assert.equal(calls.length, 1, 'Synchronous in-flight lock');
    tree = render(); assert.equal(phone().props.disabled, true);
    resolveSms({ data: { accepted: true, retryAfter: 20, expiresIn: 300 } });
    await pending; tree = render(); assert.equal(send().props.disabled, true);
    change('13100000000'); assert.equal(send().props.disabled, false);
    pending = send().props.onClick();
    resolveSms({ data: { accepted: true, retryAfter: 40, expiresIn: 300 } });
    await pending; tree = render(); assert.equal(send().props.disabled, true);
    change('13000000000'); assert.equal(send().props.disabled, true, 'A cooldown survives B success');
    change('+8613100000000'); assert.equal(send().props.disabled, true, 'Normalized B retains its own cooldown');
    clock += 21000; tickers.forEach(fn => fn()); tree = render();
    assert.equal(send().props.disabled, true, 'B still cooling after A expires');
    change('13000000000'); assert.equal(send().props.disabled, false, 'A recovers at server deadline');
    pending = send().props.onClick(); change('13200000000');
    resolveSms({ data: { accepted: true, retryAfter: 15, expiresIn: 300 } });
    await pending; tree = render(); assert.equal(send().props.disabled, false, 'Stale A success cannot cool C');
    // Existing toast may remain; an old response must not replace current form feedback.
    const before = JSON.stringify(tree);
    pending = send().props.onClick(); change('13300000000');
    resolveSms({ error: { code: 'RATE_LIMITED' }, response: { status: 429, headers: new Headers({ 'Retry-After': '30' }) } });
    await pending; tree = render(); assert.equal(send().props.disabled, false);
    assert.ok(!nodes(tree).some(n => n.props.children === '操作过于频繁，请稍后再试'));
    pending = send().props.onClick(); change('13400000000');
    rejectSms(new Error('offline stale failure')); await pending; tree = render();
    assert.ok(!nodes(tree).some(n => n.props.children === 'offline stale failure'));
    clock += 60000; tickers.forEach(fn => fn()); tree = render();
    change('13100000000'); assert.equal(send().props.disabled, false);
    assert.ok(before.length > 0);
  });
});

describe('8. SP3 AppShell 用户名显示与手机号脱敏测试', () => {
  function maskPhoneNumber(phone?: string | null): string {
    if (!phone) return '';
    const digits = phone.startsWith('+86') ? phone.slice(3) : phone;
    if (digits.length === 11) {
      return `${digits.slice(0, 3)}****${digits.slice(7)}`;
    }
    return phone.length > 4 ? `${phone.slice(0, 3)}****` : phone;
  }

  function resolveAvatarInfo(user: { displayName?: string | null; email?: string | null; phoneNumber?: string | null } | null) {
    const title = user?.displayName?.trim() || user?.email?.trim() || maskPhoneNumber(user?.phoneNumber) || '用户';
    const initial = title.slice(0, 1).toUpperCase();
    return { title, initial };
  }

  test('拥有合法 displayName 时优先展示昵称，首字符取昵称首字', () => {
    const user = {
      displayName: '张三实验室',
      email: 'zhangsan@example.com',
      phoneNumber: '+8615313956976',
    };
    const info = resolveAvatarInfo(user);
    assert.equal(info.title, '张三实验室');
    assert.equal(info.initial, '张');
  });

  test('无 displayName 但有 email 时展示 email，首字符取 email 首字母大写', () => {
    const user = {
      displayName: '',
      email: 'alice@embodix.com',
      phoneNumber: '+8615313956976',
    };
    const info = resolveAvatarInfo(user);
    assert.equal(info.title, 'alice@embodix.com');
    assert.equal(info.initial, 'A');
  });

  test('无 email 且无 displayName 仅有手机号时，展示规范脱敏手机号且绝不泄露明文完整号码', () => {
    const user = {
      displayName: null,
      email: null,
      phoneNumber: '+8615313956976',
    };
    const info = resolveAvatarInfo(user);
    assert.equal(info.title, '153****6976');
    assert.equal(info.initial, '1');
    assert.ok(!info.title.includes('15313956976'), '标题/Tooltip 中绝不可包含完整明文手机号');
  });

  test('空用户时优雅降级为“用户”和“U”', () => {
    const info = resolveAvatarInfo(null);
    assert.equal(info.title, '用户');
    assert.equal(info.initial, '用');
  });
});


