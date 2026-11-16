'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getProjectById } from '../lib/demo-data';
import { useAuth } from '../lib/auth-context';
import { clearUserEquipmentIdempotency } from '../lib/equipment/idempotency';
import { evaluateRouteGuard } from '../lib/auth-guard';
import ProjectWorkflowHeader from './embodex/WorkflowHeaderEntry';
import FeedbackWidget from './feedback/FeedbackWidget';

interface AppShellProps {
  children: React.ReactNode;
}

const PRODUCT_MODULES = [
  {
    name: 'Embodex',
    desc: 'AI 驱动的机器人设计与建模',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="8" height="8" x="2" y="2" rx="2" />
        <path d="M14 2c1.1 0 2 .9 2 2v4a2 2 0 0 1-2 2H6" />
        <path d="M6 14v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4" />
        <line x1="12" x2="12" y1="6" y2="14" />
      </svg>
    ),
  },
  {
    name: '非标自动化',
    desc: '设备方案生成与 CAD 建模',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 16-4 4-4-4" />
        <path d="M17 20V4" />
        <path d="m3 8 4-4 4 4" />
        <path d="M7 4v16" />
      </svg>
    ),
  },
  {
    name: 'Simcore',
    desc: '机器人仿真、训练与评测',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" x2="12" y1="22" y2="12" />
      </svg>
    ),
  },
  {
    name: '算法管理',
    desc: '算法资产与模型版本管理',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="19" r="2" />
        <line x1="10" x2="6.5" y1="10.5" y2="6.5" />
        <line x1="14" x2="17.5" y1="10.5" y2="6.5" />
        <line x1="10" x2="6.5" y1="13.5" y2="17.5" />
        <line x1="14" x2="17.5" y1="13.5" y2="17.5" />
      </svg>
    ),
  },
  {
    name: 'Deplox',
    desc: '应用构建、发布与设备部署',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    ),
  },
  {
    name: '需求管理',
    desc: '研发需求定义与流程规划',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect width="8" height="4" x="8" y="2" rx="1" />
        <path d="M9 14h6" />
        <path d="M9 18h6" />
        <path d="M9 10h6" />
      </svg>
    ),
  },
];

function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '';
  const digits = phone.startsWith('+86') ? phone.slice(3) : phone;
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  }
  return phone.length > 4 ? `${phone.slice(0, 3)}****` : phone;
}

function getAvatarInitial(displayName?: string | null, email?: string | null): string | null {
  const trimmed = displayName?.trim();
  if (trimmed && !trimmed.startsWith('用户_')) {
    return trimmed.slice(0, 1).toUpperCase();
  }
  if (email?.trim()) {
    return email.trim().slice(0, 1).toUpperCase();
  }
  return null;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, subscription, error, refreshUser, logout } = useAuth();
  const avatarInitial = getAvatarInitial(user?.displayName, user?.email);
  const previousEquipmentUser = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'authenticated' && status !== 'unauthenticated') return;
    const nextUser = status === 'authenticated' ? user?.id ?? null : null;
    if (previousEquipmentUser.current && previousEquipmentUser.current !== nextUser) {
      clearUserEquipmentIdempotency(previousEquipmentUser.current);
    }
    previousEquipmentUser.current = nextUser;
  }, [status, user?.id]);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [landingMobileOpen, setLandingMobileOpen] = useState(false);
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [mobileProductExpanded, setMobileProductExpanded] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [topbarMenuOpen, setTopbarMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const topbarMenuRef = useRef<HTMLDivElement>(null);
  const productMenuRef = useRef<HTMLDivElement>(null);
  const productMenuTimerRef = useRef<NodeJS.Timeout | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [sidebarPushDismissed, setSidebarPushDismissed] = useState(false);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleProductMouseEnter = () => {
    if (productMenuTimerRef.current) {
      clearTimeout(productMenuTimerRef.current);
      productMenuTimerRef.current = null;
    }
    setProductMenuOpen(true);
  };

  const handleProductMouseLeave = () => {
    if (productMenuTimerRef.current) {
      clearTimeout(productMenuTimerRef.current);
    }
    productMenuTimerRef.current = setTimeout(() => {
      setProductMenuOpen(false);
      productMenuTimerRef.current = null;
    }, 180);
  };

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (productMenuTimerRef.current) clearTimeout(productMenuTimerRef.current);
    };
  }, []);

  // 统一路由访问守卫决策
  const guard = evaluateRouteGuard(pathname, status);

  // 6 阶段流水线项目工作区 (需求输入 → 方案设计 → 编程 → Simcore 仿真训练 → 算法管理)
  const isWorkflowPage =
    pathname === '/requirements' ||
    pathname.startsWith('/requirements/') ||
    pathname === '/embodex' ||
    pathname.startsWith('/embodex/') ||
    pathname === '/simcore' ||
    pathname.startsWith('/simcore/') ||
    pathname === '/algorithms' ||
    pathname.startsWith('/algorithms/') ||
    pathname === '/deploy' ||
    pathname.startsWith('/deploy/') ||
    (pathname.startsWith('/projects/') && (
      pathname.includes('/requirements') ||
      pathname.includes('/embodex') ||
      pathname.includes('/simcore') ||
      pathname.includes('/algorithms') ||
      pathname.includes('/deploy')
    ));

  const isNewProjectPage =
    pathname === '/new' ||
    pathname === '/projects/new';

  const isEquipmentPage =
    pathname.startsWith('/projects/') && pathname.includes('/equipment');

  const isProjectDetail =
    pathname.startsWith('/projects/') &&
    pathname !== '/projects' &&
    pathname !== '/projects/new' &&
    !pathname.includes('/requirements') &&
    !pathname.includes('/embodex') &&
    !pathname.includes('/simcore') &&
    !pathname.includes('/algorithms') &&
    !pathname.includes('/deploy') &&
    !pathname.includes('/equipment');

  // 左下角用户菜单全局提供账户设置入口与意见反馈入口
  const showFeedbackEntry = true;
  const showAccountSettingsEntry = true;

  const projectIdFromPath = isProjectDetail ? pathname.split('/')[2] : null;
  const projectObj = projectIdFromPath ? getProjectById(projectIdFromPath) : null;
  const topbarTitle = projectObj
    ? projectObj.name
    : pathname.startsWith('/workspace')
      ? '工作空间'
      : pathname.startsWith('/resources')
        ? '资源中心'
        : pathname.startsWith('/account')
          ? '账户设置'
          : '项目管理';

  // 路由跳转时自动关闭移动端菜单、产品下拉菜单、用户菜单、顶部模块切换菜单及反馈窗口
  useEffect(() => {
    setMobileNavOpen(false);
    setLandingMobileOpen(false);
    setProductMenuOpen(false);
    setMobileProductExpanded(false);
    setUserMenuOpen(false);
    setTopbarMenuOpen(false);
    setFeedbackOpen(false);
  }, [pathname]);

  // 点击外部区域自动关闭顶部模块下拉菜单与首页产品 Mega 菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (topbarMenuRef.current && !topbarMenuRef.current.contains(target)) {
        setTopbarMenuOpen(false);
      }
      if (productMenuRef.current && !productMenuRef.current.contains(target)) {
        setProductMenuOpen(false);
      }
    };
    if (topbarMenuOpen || productMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [topbarMenuOpen, productMenuOpen]);

  // 点击外部空白区域自动关闭侧栏用户菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(target) &&
        userMenuTriggerRef.current &&
        !userMenuTriggerRef.current.contains(target)
      ) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  // 全局统一受保护路由重定向与已登录跳转守卫
  useEffect(() => {
    if (guard.shouldRedirect && guard.redirectUrl) {
      router.replace(guard.redirectUrl);
    }
  }, [guard.shouldRedirect, guard.redirectUrl, router]);

  // 监听 Escape 键关闭侧栏用户菜单、顶部模块下拉菜单及产品 Mega 菜单
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (userMenuOpen) setUserMenuOpen(false);
        if (topbarMenuOpen) setTopbarMenuOpen(false);
        if (productMenuOpen) setProductMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [userMenuOpen, topbarMenuOpen, productMenuOpen]);

  const handleLogoutClick = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError(null);
    const success = await logout();
    setIsLoggingOut(false);
    if (success) {
      setUserMenuOpen(false);
      router.replace('/login');
    } else {
      setLogoutError('退出登录失败，请重试');
    }
  };

  // 1. 登录与注册独立页面渲染 (参照阿里通义千问AI平台风格)
  // 独立免外壳页面白名单 (登录/注册/3D交互设计工作台)
  if (pathname === '/login' || pathname === '/register' || pathname === '/example') {
    return <>{children}</>;
  }

  if (guard.viewType === 'auth_page') {
    return <main className="auth-root-wrapper">{children}</main>;
  }

  // 2. 首页独立渲染 Landing Page 顶栏 (参照 屏幕截图 2026-09-11 005826.png)
  if (guard.viewType === 'public') {
    return (
      <div className="landing-layout">
        <header className="landing-nav">
          <div className="landing-nav-left">
            <Link href="/" className="landing-brand">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12,2 22,21 2,21" />
              </svg>
              <span className="landing-brand-text">EmboMiX</span>
            </Link>
            <nav className="landing-menu" aria-label="官网导航">
              {/* 电脑端「产品」Mega Menu 双栏下拉菜单入口 */}
              <div
                ref={productMenuRef}
                className="landing-product-dropdown-container"
                onMouseEnter={handleProductMouseEnter}
                onMouseLeave={handleProductMouseLeave}
              >
                <button
                  type="button"
                  className={`landing-menu-item landing-product-trigger ${productMenuOpen ? 'open' : ''}`}
                  onClick={() => setProductMenuOpen(!productMenuOpen)}
                  aria-expanded={productMenuOpen}
                  aria-haspopup="true"
                >
                  <span>产品</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`landing-product-arrow ${productMenuOpen ? 'open' : ''}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {/* 电脑端 Mega Menu 双栏下拉菜单 (纯静态展示，不跳转) */}
                {productMenuOpen && (
                  <div
                    className="landing-product-mega-menu"
                    role="region"
                    aria-label="产品模块一览"
                    onMouseEnter={handleProductMouseEnter}
                    onMouseLeave={handleProductMouseLeave}
                  >
                    <div className="landing-product-menu-header">
                      覆盖设计、仿真、训练与部署的具身智能研发平台
                    </div>
                    <div className="landing-product-menu-grid">
                      {PRODUCT_MODULES.map((module) => (
                        <div key={module.name} className="landing-product-item">
                          <div className="landing-product-icon-wrap" aria-hidden="true">
                            {module.icon}
                          </div>
                          <div className="landing-product-text-wrap">
                            <div className="landing-product-item-title">{module.name}</div>
                            <div className="landing-product-item-desc">{module.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Link href="/resources" className="landing-menu-item">
                资源
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </Link>
              <Link href="/projects" className="landing-menu-item">订阅</Link>
              <a href="https://embomind.com.cn/" target="_blank" rel="noopener noreferrer" className="landing-menu-item">关于我们</a>
            </nav>
          </div>

          <div className="landing-nav-right">
            {status === 'authenticated' ? (
              <Link
                href="/projects"
                className="btn-landing-solid btn-landing-auth landing-auth-enter-btn"
                title={`进入平台 (${user?.displayName || '控制台'})`}
              >
                <span className="landing-auth-text-mobile">进入平台</span>
                <span className="landing-auth-text-desktop">进入平台 ({user?.displayName || '控制台'})</span>
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-landing-ghost btn-landing-auth">
                  登录
                </Link>
                <Link href="/register" className="btn-landing-solid btn-landing-auth">
                  注册
                </Link>
              </>
            )}

            {/* 手机端导航抽屉展开/收起切换按钮 */}
            <button
              type="button"
              className="landing-mobile-menu-toggle"
              aria-label={landingMobileOpen ? '关闭导航菜单' : '打开导航菜单'}
              aria-expanded={landingMobileOpen}
              onClick={() => setLandingMobileOpen(!landingMobileOpen)}
            >
              {landingMobileOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* 手机端导航下拉抽屉与遮罩 */}
        {landingMobileOpen && (
          <>
            <div
              className="landing-mobile-drawer-backdrop"
              onClick={() => setLandingMobileOpen(false)}
              aria-hidden="true"
            />
            <nav className="landing-mobile-drawer" aria-label="移动端全站导航">
              <div className="landing-mobile-drawer-inner">
                {status === 'authenticated' && (
                  <div className="landing-mobile-drawer-user-info">
                    <span className="landing-mobile-user-name" title={user?.displayName || undefined}>
                      {user?.displayName || '已登录开发者'}
                    </span>
                    <span className="landing-mobile-user-status">已认证</span>
                  </div>
                )}
                {/* 手机端「产品」折叠模块菜单 (单列展开，纯展示不跳转) */}
                <div className="landing-mobile-accordion-wrapper">
                  <button
                    type="button"
                    className={`landing-mobile-drawer-item landing-mobile-accordion-trigger ${mobileProductExpanded ? 'expanded' : ''}`}
                    onClick={() => setMobileProductExpanded(!mobileProductExpanded)}
                    aria-expanded={mobileProductExpanded}
                  >
                    <span>产品</span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{
                        transform: mobileProductExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                      }}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>

                  {mobileProductExpanded && (
                    <div className="landing-mobile-product-list" role="region" aria-label="移动端产品模块">
                      <div className="landing-mobile-product-intro">
                        覆盖设计、仿真、训练与部署的具身智能研发平台
                      </div>
                      <div className="landing-mobile-product-grid">
                        {PRODUCT_MODULES.map((module) => (
                          <div key={module.name} className="landing-mobile-product-card">
                            <div className="landing-mobile-product-icon" aria-hidden="true">
                              {module.icon}
                            </div>
                            <div className="landing-mobile-product-text">
                              <div className="landing-mobile-product-name">{module.name}</div>
                              <div className="landing-mobile-product-desc">{module.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <Link
                  href="/resources"
                  className="landing-mobile-drawer-item"
                  onClick={() => setLandingMobileOpen(false)}
                >
                  <span>资源中心</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
                <Link
                  href="/projects"
                  className="landing-mobile-drawer-item"
                  onClick={() => setLandingMobileOpen(false)}
                >
                  <span>方案与订阅</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
                <a
                  href="https://embomind.com.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing-mobile-drawer-item"
                  onClick={() => setLandingMobileOpen(false)}
                >
                  <span>关于我们</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" x2="21" y1="14" y2="3" />
                  </svg>
                </a>
              </div>
            </nav>
          </>
        )}

        <main>{children}</main>
      </div>
    );
  }

  // 3. 受保护页面在 loading 时避免闪烁内容或登录页
  if (guard.viewType === 'loading') {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app, #f8fafc)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="auth-brand-badge" style={{ margin: '0 auto 16px', display: 'inline-flex', color: '#0f172a' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="12,2 22,21 2,21" />
            </svg>
            <span style={{ marginLeft: 8, fontWeight: 600 }}>EmboMiX</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>正在校验账户状态...</div>
        </div>
      </div>
    );
  }

  // 4. 受保护页面在未登录跳转中
  if (guard.viewType === 'unauthenticated') {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app, #f8fafc)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>正在跳转至登录页面...</div>
        </div>
      </div>
    );
  }

  // 5. 受保护页面在服务异常或网络断开时不误判为已退出，展示可重试的错误提示
  if (guard.viewType === 'error') {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app, #f8fafc)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 24, background: '#ffffff', borderRadius: 12, border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: '#0f172a' }}>
            {error?.message || '无法连接至平台服务'}
          </div>
          {error?.requestId && (
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>排查编号: {error.requestId}</div>
          )}
          <button
            type="button"
            className="auth-btn-primary"
            onClick={() => refreshUser()}
            style={{ padding: '8px 24px', borderRadius: 9999, border: 'none', background: '#0f172a', color: '#ffffff', cursor: 'pointer' }}
          >
            重新尝试
          </button>
        </div>
      </div>
    );
  }

  // 6. 受保护页面确认已登录（status === 'authenticated'）
  // 6.1 统一解耦项目工作区：顶层 Layout 常驻固定 Tasks2 风格 6 阶段 Workflow Stepper
  if (isWorkflowPage) {
    return (
      <div className="project-workspace-shell" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app, #f8fafc)' }}>
        <ProjectWorkflowHeader />
        <main className="project-workspace-main" style={{ flex: 1, minHeight: 0 }}>
          {children}
        </main>
      </div>
    );
  }

  // 6.2 新建项目独立全屏页面
  if (isNewProjectPage) {
    return <main className="task-page-root">{children}</main>;
  }

  // 6.3 非标自动化设备工作台独立布局（全宽三维工作区，享有统一受保护认证守卫）
  if (isEquipmentPage) {
    return (
      <div className="equipment-workspace-shell" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app, #f8fafc)' }}>
        <main className="equipment-workspace-main" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>
      </div>
    );
  }



  // 顶部全局下拉导航项 (项目管理 / 工作空间 / 资源中心，底部为首页)
  const topbarNavItems = [
    {
      href: '/projects',
      label: '项目管理',
      active: pathname === '/projects' || (pathname.startsWith('/projects/') && !pathname.startsWith('/workspace') && !pathname.startsWith('/resources')),
    },
    {
      href: '/workspace',
      label: '工作空间',
      active: pathname.startsWith('/workspace'),
    },
    {
      href: '/resources',
      label: '资源中心',
      active: pathname.startsWith('/resources'),
    },
  ];

  // Dashboard 导航项 (参照 屏幕截图 2026-09-11 011906.png)
  const navItems = [
    {
      href: '/projects',
      label: '项目管理',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      ),
      active: pathname.startsWith('/projects'),
    },
    {
      href: '/workspace',
      label: '工作空间',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
      ),
      active: pathname.startsWith('/workspace'),
    },
    {
      href: '/resources',
      label: '资源中心',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7.5 4.27 9 5.15" />
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      ),
      active: pathname.startsWith('/resources'),
    },
    {
      href: '#deployments',
      label: '部署管理',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      ),
      active: false,
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        showToast('暂未开放');
      },
    },
  ];

  const sidebarSecondaryItems = [

    { label: '运行日志', hasSub: true },
    { label: '数据分析', hasSub: false },
    { label: '性能分析', hasSub: false },
    { label: '可观测性', hasSub: true },
    { divider: true },
    { label: '环境变量', hasSub: false },
    { label: '集成', hasSub: false },
    { label: '存储', hasSub: false },
    { label: 'Agent', hasSub: true },
  ];

  return (
    <div className="layout-root">
      {/* 提示通知 */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#ffffff',
            padding: '8px 18px',
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            zIndex: 99999,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            backdropFilter: 'blur(8px)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{toastMsg}</span>
        </div>
      )}
      {/* 移动端遮罩 */}
      {mobileNavOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 侧边导航栏 (参照 屏幕截图 2026-09-11 011906.png 设计) */}
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        {/* 顶部团队/工作区选择器 */}
        <div className="sidebar-header">
          <Link href="/" className="workspace-switcher" title="返回首页">
            <div className="workspace-avatar">
              <span className="logo-symbol">X</span>
            </div>
            <div className="workspace-info">
              <span className="workspace-name">EmboMiX</span>
              <span className="workspace-badge">{subscription?.plan?.name || subscription?.plan?.code || 'Free'}</span>
            </div>
            <div className="workspace-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m7 15 5 5 5-5" />
                <path d="m7 9 5-5 5 5" />
              </svg>
            </div>
          </Link>
        </div>

        {/* 快速检索框 (Find F) */}
        <div style={{ padding: '12px 14px 4px' }}>
          <div className="sidebar-find-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>搜索</span>
            <span className="sidebar-find-badge">F</span>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="sidebar-nav" aria-label="主要导航" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <ul className="nav-list">
            {isProjectDetail ? (
              <>
                <li key="project-overview">
                  <Link
                    href={`/projects/${projectIdFromPath}`}
                    className="nav-link nav-link-active"
                    aria-current="page"
                  >
                    <span className="nav-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="12,2 22,21 2,21" />
                      </svg>
                    </span>
                    <span className="nav-text">总览</span>
                  </Link>
                </li>
                {sidebarSecondaryItems.map((item, idx) => {
                  if (item.divider) {
                    return <li key={`div-${idx}`} className="sidebar-nav-divider" />;
                  }
                  return (
                    <li key={item.label}>
                      <div className="nav-link nav-link-disabled" title="规划中功能">
                        <span className="nav-text">{item.label}</span>
                        {item.hasSub && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        )}
                      </div>
                    </li>
                  );
                })}
              </>
            ) : (
              <>
                {navItems.map((item) => (
                  <li key={item.label}>
                    {'onClick' in item && item.onClick ? (
                      <a
                        href={item.href}
                        onClick={item.onClick}
                        className={`nav-link ${item.active ? 'nav-link-active' : ''}`}
                        role="button"
                        style={{ cursor: 'pointer' }}
                      >
                        <span className="nav-icon">{item.icon}</span>
                        <span className="nav-text">{item.label}</span>
                      </a>
                    ) : (
                      <Link
                      href={item.href}
                      className={`nav-link ${item.active ? 'nav-link-active' : ''}`}
                      aria-current={item.active ? 'page' : undefined}
                    >
                      <span className="nav-icon">{item.icon}</span>
                      <span className="nav-text">{item.label}</span>
                      </Link>
                    )}
                  </li>
                ))}

                {sidebarSecondaryItems.map((item, idx) => {
                  if (item.divider) {
                    return <li key={`div-${idx}`} className="sidebar-nav-divider" />;
                  }
                  return (
                    <li key={item.label}>
                      <div className="nav-link nav-link-disabled" title="规划中功能">
                        <span className="nav-text">{item.label}</span>
                        {item.hasSub && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        )}
                      </div>
                    </li>
                  );
                })}
              </>
            )}
          </ul>
        </nav>

        {/* 侧栏底部通知提示卡片 (参照 overview.png) */}
        {!sidebarPushDismissed && (
          <div className="sidebar-push-card" style={{ flexShrink: 0 }}>
            <div className="sidebar-push-header">
              <span className="sidebar-push-title">快速开始</span>
              <button
                type="button"
                className="sidebar-push-close"
                aria-label="关闭提示"
                onClick={() => setSidebarPushDismissed(true)}
              >
                ✕
              </button>
            </div>
            <p className="sidebar-push-desc">创建你的第一个项目，体验机器人构建、仿真与模型评估。</p>
            <Link
              href="/projects/new"
              className="sidebar-push-btn"
              style={{
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
              }}
            >
              新建项目
            </Link>
          </div>
        )}

        {/* 侧栏底部用户账户栏 (对齐设计规范并接入真实认证状态与无障碍菜单) */}
        <div className="sidebar-footer" style={{ flexShrink: 0, borderTop: '1px solid var(--border-color)', padding: '12px 14px', position: 'relative' }}>
          {userMenuOpen && (
            <div
              id="user-account-menu"
              ref={userMenuRef}
              role="menu"
              aria-labelledby="user-account-menu-trigger"
              className="user-account-dropdown"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 8,
                width: 256,
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.1), 0 4px 12px -2px rgba(0, 0, 0, 0.05)',
                padding: '8px',
                zIndex: 1000,
              }}
            >
              {/* 头部个人资料卡片 (含头像、昵称、邮箱与套餐 Badge) */}
              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                {/* 方案 A 头像 (未改名显示白色 User 剪影，已改名显示首字大写) */}
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: 14,
                    flexShrink: 0,
                    boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
                  }}
                >
                  {avatarInitial ? (
                    <span>{avatarInitial}</span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  )}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111827',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: '18px',
                      }}
                      title={user?.displayName || '未命名用户'}
                    >
                      {user?.displayName || '未命名用户'}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#2563eb',
                        background: '#eff6ff',
                        padding: '1px 5px',
                        borderRadius: 4,
                        border: '1px solid #dbeafe',
                        flexShrink: 0,
                      }}
                    >
                      {subscription?.plan?.name || subscription?.plan?.code || 'Free'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#6b7280',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 2,
                      lineHeight: '16px',
                    }}
                    title={user?.email || undefined}
                  >
                    {user?.email || maskPhoneNumber(user?.phoneNumber) || '无账号信息'}
                  </div>
                </div>
              </div>

              {/* 菜单项列表 (左对齐文字，右对齐图标) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {showAccountSettingsEntry && (
                  <Link
                    href="/account/settings"
                    role="menuitem"
                    id="user-account-settings-menu-item"
                    className="user-menu-item"
                    onClick={() => setUserMenuOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 450,
                      color: '#171717',
                      textDecoration: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span>账户设置</span>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: '#666666', flexShrink: 0 }}
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </Link>
                )}

                {showFeedbackEntry && (
                  <button
                    type="button"
                    role="menuitem"
                    id="user-feedback-menu-item"
                    className="user-menu-item"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setFeedbackOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 450,
                      color: '#171717',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span>意见反馈</span>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: '#666666', flexShrink: 0 }}
                    >
                      <path d="M21.5 11.5A10 10 0 1 1 12.5 2" />
                      <path d="M8 14.5a4 4 0 0 0 8 0" />
                      <circle cx="8.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
                      <circle cx="15.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
                      <line x1="16" y1="5" x2="22" y2="5" />
                      <line x1="19" y1="2" x2="19" y2="8" />
                    </svg>
                  </button>
                )}

                {/* 细分割线：区分个人偏好与全局导航 */}
                <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />

                <Link
                  href="/"
                  role="menuitem"
                  id="user-home-menu-item"
                  className="user-menu-item"
                  onClick={() => setUserMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 450,
                    color: '#171717',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span>返回首页</span>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: '#666666', flexShrink: 0 }}
                  >
                    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </Link>

                {/* 细分割线：区分全局导航与登出操作 */}
                <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />

                <button
                  type="button"
                  role="menuitem"
                  className="user-menu-item user-menu-item-danger"
                  onClick={handleLogoutClick}
                  disabled={isLoggingOut}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 450,
                    background: 'transparent',
                    border: 'none',
                    cursor: isLoggingOut ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span>{isLoggingOut ? '正在退出...' : '退出登录'}</span>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              </div>

              {logoutError && (
                <div role="alert" style={{ fontSize: 11, color: '#ef4444', padding: '4px 10px' }}>
                  {logoutError}
                </div>
              )}
            </div>
          )}

          <div className="user-profile-row">
            <div className="user-avatar-identicon">
              <div className="identicon-grid" />
            </div>
            <div className="user-info">
              <span className="user-name" title={user?.email || undefined}>
                {user?.displayName || user?.email || '用户'}
              </span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, color: 'var(--text-muted)' }}>
              <button
                id="user-account-menu-trigger"
                ref={userMenuTriggerRef}
                type="button"
                className="btn-icon-subtle"
                title="账户设置与退出"
                aria-label="账户设置与退出"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-controls="user-account-menu"
                onClick={() => setUserMenuOpen((prev) => !prev)}
              >
                ⋯
              </button>
              <button type="button" className="btn-icon-subtle" title="通知" aria-label="查看通知">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* 主工作区 */}
      <div className="main-wrapper">
        {/* 顶部全局状态栏 (参照 屏幕截图 2026-09-11 011906.png) */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              aria-label={mobileNavOpen ? '关闭菜单' : '展开菜单'}
              aria-expanded={mobileNavOpen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" x2="20" y1="12" y2="12" />
                <line x1="4" x2="20" y1="6" y2="6" />
                <line x1="4" x2="20" y1="18" y2="18" />
              </svg>
            </button>

            <div ref={topbarMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                id="topbar-module-menu-trigger"
                className={`topbar-project-dropdown ${topbarMenuOpen ? 'open' : ''}`}
                title="切换系统模块"
                aria-label="切换系统模块"
                aria-haspopup="menu"
                aria-expanded={topbarMenuOpen}
                aria-controls="topbar-module-menu"
                onClick={() => setTopbarMenuOpen((prev) => !prev)}
              >
                {projectObj && (
                  <span className="topbar-project-icon" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect width="18" height="18" x="3" y="3" rx="4" />
                    </svg>
                  </span>
                )}
                <span className="topbar-project-title">
                  {topbarTitle}
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: '#71717a', flexShrink: 0 }}
                  aria-hidden="true"
                >
                  <path d="m7 15 5 5 5-5" />
                  <path d="m7 9 5-5 5 5" />
                </svg>
              </button>

              {topbarMenuOpen && (
                <div
                  id="topbar-module-menu"
                  role="menu"
                  aria-labelledby="topbar-module-menu-trigger"
                  className="topbar-dropdown-menu"
                >
                  <div className="topbar-dropdown-list">
                    {topbarNavItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        className={`topbar-dropdown-item ${item.active ? 'active' : ''}`}
                        onClick={() => setTopbarMenuOpen(false)}
                      >
                        <span>{item.label}</span>
                        {item.active && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ color: '#18181b', flexShrink: 0 }}
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </Link>
                    ))}

                    <div className="topbar-dropdown-divider" role="separator" />

                    <Link
                      href="/"
                      role="menuitem"
                      className="topbar-dropdown-home"
                      onClick={() => setTopbarMenuOpen(false)}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: 'inherit', flexShrink: 0 }}
                        aria-hidden="true"
                      >
                        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                      <span>首页</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="topbar-center">
            <span className="topbar-center-tab">
              {pathname.startsWith('/account') ? '账户设置' : '总览'}
            </span>
          </div>

          <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="topbar-agent-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
              <span>Agent</span>
            </div>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: '#16a34a',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
              title={user?.displayName?.trim() || user?.email?.trim() || maskPhoneNumber(user?.phoneNumber) || '用户'}
            >
              {avatarInitial ? (
                <span>{avatarInitial}</span>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </div>
          </div>
        </header>

        {/* 页面实际内容挂载点 */}
        <main className="main-content">{children}</main>
      </div>

      {/* Vercel 风格轻量反馈弹层 (仅限项目总览与项目详情页触发) */}
      <FeedbackWidget
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        sourceUrl={pathname}
      />
    </div>
  );
}
