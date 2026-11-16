import { isValidNextUrl } from './auth-errors';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface RouteGuardDecision {
  /** 当前路径是否为无需登录即可访问的公开路由 */
  isPublic: boolean;
  /** 是否需要触发页面重定向 */
  shouldRedirect: boolean;
  /** 重定向的目标路径（若无需重定向则为 null） */
  redirectUrl: string | null;
  /** 当前应渲染的视图层级类型 */
  viewType: 'public' | 'auth_page' | 'loading' | 'unauthenticated' | 'error' | 'protected_content';
}

/**
 * 判断指定路径是否属于公开路由（首页及独立认证页）。
 */
export function isPublicRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/' || pathname === '/login' || pathname === '/register' || pathname === '/forgot-password' || pathname === '/example';
}

/**
 * 全局统一的路由访问守卫决策函数（Single Source of Truth）。
 * 供 AppShell 页面守卫与自动化测试套件共享，确保四态行为与测试断言严格一致。
 *
 * 规则：
 * 1. 公开路由：
 *    - /forgot-password：
 *      - 找回密码公开页，无论何种认证状态均不重定向至工作区，方便重新认证与找回测试；
 *    - /login 与 /register：
 *      - 若已认证（status === 'authenticated'），自动重定向至合法 next 路径或默认 /projects；
 *      - 若未认证/加载中/异常，渲染独立认证页（auth_page），不触发未登录重定向。
 *    - /：公开 Landing Page，任何状态均可访问，根据状态展示不同入口。
 * 2. 受保护路由（/projects/**, /requirements/**, /embodex/**, /simcore/**, /resources/**, /new 等）：
 *    - loading：渲染骨架/校验中状态，绝不提前暴露工作区内容，防止画面闪烁；
 *    - unauthenticated：重定向至 /login?next=${encodeURIComponent(pathname)}，渲染跳转提示；
 *    - error：渲染服务不可用/重试卡片，不误重定向至登录页；
 *    - authenticated：确认有效会话后，方可渲染受保护内容（protected_content）。
 */
export function evaluateRouteGuard(
  pathname: string | null | undefined,
  status: AuthStatus,
  nextQueryParam?: string | null,
): RouteGuardDecision {
  const currentPath = pathname || '/';
  const isAuthPage = currentPath === '/login' || currentPath === '/register';
  const isForgotPassword = currentPath === '/forgot-password';
  const isHomePage = currentPath === '/';

  // 1. 找回密码页面 (/forgot-password)
  // 公开路由，若已有登录态访问不自动跳转 workspace（方便重新认证与测试），不影响 /login 与 /register 的已登录跳转
  if (isForgotPassword) {
    return {
      isPublic: true,
      shouldRedirect: false,
      redirectUrl: null,
      viewType: 'auth_page',
    };
  }

  // 2. 认证页面 (/login, /register)
  if (isAuthPage) {
    if (status === 'authenticated') {
      const targetUrl = isValidNextUrl(nextQueryParam) ? nextQueryParam! : '/projects';
      return {
        isPublic: true,
        shouldRedirect: true,
        redirectUrl: targetUrl,
        viewType: 'auth_page',
      };
    }
    return {
      isPublic: true,
      shouldRedirect: false,
      redirectUrl: null,
      viewType: 'auth_page',
    };
  }

  // 2. 首页 (/) 与独立 3D 工作台演示页 (/example)
  if (isHomePage || currentPath === '/example') {
    return {
      isPublic: true,
      shouldRedirect: false,
      redirectUrl: null,
      viewType: 'public',
    };
  }

  // 3. 受保护页面 (包含所有 /projects/**, /tasks, /requirements/** 等工作区与资源页)
  if (status === 'loading') {
    return {
      isPublic: false,
      shouldRedirect: false,
      redirectUrl: null,
      viewType: 'loading',
    };
  }

  if (status === 'unauthenticated') {
    return {
      isPublic: false,
      shouldRedirect: true,
      redirectUrl: `/login?next=${encodeURIComponent(currentPath)}`,
      viewType: 'unauthenticated',
    };
  }

  if (status === 'error') {
    return {
      isPublic: false,
      shouldRedirect: false,
      redirectUrl: null,
      viewType: 'error',
    };
  }

  // status === 'authenticated'
  return {
    isPublic: false,
    shouldRedirect: false,
    redirectUrl: null,
    viewType: 'protected_content',
  };
}
