'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { login, loginWithSms, sendSmsCode } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { normalizeAuthError, isValidNextUrl } from '../../lib/auth-errors';

type TabMode = 'account' | 'phone';

const MAINLAND_PHONE_REGEX = /^\+861[3-9][0-9]{9}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function normalizeMainlandPhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+86')) {
    return trimmed;
  }
  return `+86${trimmed}`;
}

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, refreshUser } = useAuth();

  const [tabMode, setTabMode] = useState<TabMode>('phone');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const sendInFlight = useRef(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // 账号密码模式输入框与焦点
  const accountInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  // 短信验证码模式输入框与焦点
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rawPhone, setRawPhone] = useState('');
  const [code, setCode] = useState('');

  const currentPhone = normalizeMainlandPhone(rawPhone.trim());
  const currentPhoneRef = useRef(currentPhone);
  currentPhoneRef.current = currentPhone;
  const countdown = Math.max(0, Math.ceil(((cooldowns[currentPhone] ?? 0) - now) / 1000));
  const isCurrentPhoneInCooldown = countdown > 0;

  // 站内安全目标路径
  const rawNext = searchParams.get('next');
  const targetUrl = isValidNextUrl(rawNext) ? rawNext! : '/projects';

  // 已登录用户自动进入平台
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(targetUrl);
    }
  }, [status, targetUrl, router]);

  // 找回密码重置成功后的提示
  useEffect(() => {
    if (searchParams.get('reset') === 'success') {
      showToast('✓ 密码重置成功，请使用新密码登录');
    }
  }, [searchParams]);

  // 确保背景视频严格静音与自动播放
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 3000);
  };

  // 验证码倒计时处理
  useEffect(() => {
    if (!Object.values(cooldowns).some((until) => until > Date.now())) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldowns]);

  // 短信登录模式：发送验证码
  const handleSendCode = async () => {
    if (sendInFlight.current) return;
    const trimmed = rawPhone.trim();
    if (!trimmed) {
      setFormError('请输入手机号码');
      showToast('⚠️ 请输入手机号码');
      phoneInputRef.current?.focus();
      return;
    }

    const normalizedPhone = normalizeMainlandPhone(trimmed);
    if (!MAINLAND_PHONE_REGEX.test(normalizedPhone)) {
      setFormError('请输入有效的中国大陆手机号（11位数字，如 13800000000）');
      showToast('⚠️ 手机号格式不符合要求');
      phoneInputRef.current?.focus();
      return;
    }

    if ((cooldowns[normalizedPhone] ?? 0) > Date.now()) {
      return;
    }

    sendInFlight.current = true;
    setIsSendingCode(true);
    setFormError(null);

    try {
      const res = await sendSmsCode({
        body: {
          phoneNumber: normalizedPhone,
          purpose: 'LOGIN',
        },
      });

      if (res.data?.accepted) {
        const retryAfter = res.data.retryAfter || 60;
        const acceptedAt = Date.now();
        setCooldowns((previous) => ({ ...previous, [normalizedPhone]: acceptedAt + retryAfter * 1000 }));
        setNow(acceptedAt);
        const currentNorm = currentPhoneRef.current;
        if (currentNorm === normalizedPhone) {
          showToast('✓ 验证码已发送，请查收短信');
          codeInputRef.current?.focus();
        }
      } else {
        if (currentPhoneRef.current !== normalizedPhone) return;
        const retryAfter = res.response?.headers?.get('Retry-After');
        const normErr = normalizeAuthError(res.error, res.response?.status, retryAfter);
        const displayMsg = normErr.requestId
          ? `${normErr.message} (排查编号: ${normErr.requestId})`
          : normErr.message;
        setFormError(displayMsg);
        showToast(displayMsg);
      }
    } catch (err: unknown) {
      if (currentPhoneRef.current !== normalizedPhone) return;
      const normErr = normalizeAuthError(err);
      setFormError(normErr.message);
      showToast(normErr.message);
    } finally {
      sendInFlight.current = false;
      setIsSendingCode(false);
    }
  };

  // 账号密码登录
  const handleAccountLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const trimmedAccount = account.trim();
    if (!trimmedAccount) {
      setFormError('请输入手机号或邮箱');
      showToast('⚠️ 请输入手机号或邮箱');
      accountInputRef.current?.focus();
      return;
    }
    if (!password) {
      setFormError('请输入登录密码');
      showToast('⚠️ 请输入登录密码');
      passwordInputRef.current?.focus();
      return;
    }

    // 格式化手机号或邮箱
    let normalizedAccount = trimmedAccount;
    if (/^1[3-9][0-9]{9}$/.test(trimmedAccount)) {
      normalizedAccount = `+86${trimmedAccount}`;
    } else if (trimmedAccount.includes('@')) {
      normalizedAccount = trimmedAccount.toLowerCase();
    }

    setIsLoading(true);
    setFormError(null);

    try {
      // 密码绝不 trim、不改变大小写、不记录日志
      const res = await login({
        body: {
          account: normalizedAccount,
          password,
        },
      });

      if (res.data) {
        showToast('✓ 登录成功，正在进入平台...');
        const userProfile = await refreshUser();
        if (userProfile) {
          router.replace(targetUrl);
          return;
        }
        setIsLoading(false);
        const failMsg = '登录凭证已签发，但同步用户信息失败，请重试或刷新页面';
        setFormError(failMsg);
        showToast(`⚠️ ${failMsg}`);
        passwordInputRef.current?.focus();
        return;
      }

      const retryAfter = res.response?.headers?.get('Retry-After');
      const normErr = normalizeAuthError(res.error, res.response?.status, retryAfter);
      const displayMsg = normErr.requestId
        ? `${normErr.message} (排查编号: ${normErr.requestId})`
        : normErr.message;

      setFormError(displayMsg);
      showToast(displayMsg);
      setIsLoading(false);
      passwordInputRef.current?.focus();
    } catch (err: unknown) {
      const normErr = normalizeAuthError(err);
      setFormError(normErr.message);
      showToast(normErr.message);
      setIsLoading(false);
      passwordInputRef.current?.focus();
    }
  };

  // 短信验证码登录
  const handleSmsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const trimmedPhone = rawPhone.trim();
    if (!trimmedPhone) {
      setFormError('请输入手机号码');
      showToast('⚠️ 请输入手机号码');
      phoneInputRef.current?.focus();
      return;
    }

    const normalizedPhone = normalizeMainlandPhone(trimmedPhone);
    if (!MAINLAND_PHONE_REGEX.test(normalizedPhone)) {
      setFormError('请输入有效的中国大陆手机号（11位数字，如 13800000000）');
      showToast('⚠️ 手机号格式不符合要求');
      phoneInputRef.current?.focus();
      return;
    }

    const trimmedCode = code.trim();
    if (!trimmedCode || !/^[0-9]{6}$/.test(trimmedCode)) {
      setFormError('请输入6位数字短信验证码');
      showToast('⚠️ 请输入6位数字短信验证码');
      codeInputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setFormError(null);

    try {
      const res = await loginWithSms({
        body: {
          phoneNumber: normalizedPhone,
          code: trimmedCode,
        },
      });

      if (res.data) {
        showToast('✓ 登录成功，正在进入平台...');
        const userProfile = await refreshUser();
        if (userProfile) {
          router.replace(targetUrl);
          return;
        }
        setIsLoading(false);
        const failMsg = '登录凭证已签发，但同步用户信息失败，请重试或刷新页面';
        setFormError(failMsg);
        showToast(`⚠️ ${failMsg}`);
        codeInputRef.current?.focus();
        return;
      }

      const retryAfter = res.response?.headers?.get('Retry-After');
      const normErr = normalizeAuthError(res.error, res.response?.status, retryAfter);
      const displayMsg = normErr.requestId
        ? `${normErr.message} (排查编号: ${normErr.requestId})`
        : normErr.message;

      setFormError(displayMsg);
      showToast(displayMsg);
      setIsLoading(false);
      codeInputRef.current?.focus();
    } catch (err: unknown) {
      const normErr = normalizeAuthError(err);
      setFormError(normErr.message);
      showToast(normErr.message);
      setIsLoading(false);
      codeInputRef.current?.focus();
    }
  };

  return (
    <div className="auth-page-root">
      {/* 提示条 */}
      {toastMsg && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#090d16',
            color: '#38bdf8',
            padding: '10px 22px',
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 12px 30px rgba(0,0,0,0.28)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: '1px solid rgba(56, 189, 248, 0.25)',
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* 主布局容器：电脑端左右分栏 / 手机端上下布局 */}
      <div className="auth-page-container">
        {/* ===================== 视频媒体区 (电脑端大画幅左侧 / 手机端顶部紧凑横幅) ===================== */}
        <div className="auth-media-panel">
          <video
            ref={videoRef}
            src="/login-video.mp4"
            poster="/login-video-poster.png"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* ===================== 登录操作区 ===================== */}
        <div className="auth-form-panel">
          {/* 表单居中容器 */}
          <div className="auth-form-inner-center">
            {/* 表单区域：精准控制统一宽度 */}
            <div className="auth-form-card">
              <div>
                <h1 className="auth-heading">欢迎使用 EmboMiX AI平台</h1>
              <p className="auth-subheading">请选择登录方式进入开发者中心</p>

              {/* 登录方式切换 Segment */}
              <div className="auth-tab-segment" role="tablist" aria-label="登录方式切换">
                <button
                  id="tab-phone"
                  type="button"
                  role="tab"
                  aria-selected={tabMode === 'phone'}
                  aria-controls="panel-phone"
                  className={`auth-tab-btn ${tabMode === 'phone' ? 'active' : ''}`}
                  onClick={() => {
                    setTabMode('phone');
                    setFormError(null);
                  }}
                >
                  短信登录
                </button>
                <button
                  id="tab-account"
                  type="button"
                  role="tab"
                  aria-selected={tabMode === 'account'}
                  aria-controls="panel-account"
                  className={`auth-tab-btn ${tabMode === 'account' ? 'active' : ''}`}
                  onClick={() => {
                    setTabMode('account');
                    setFormError(null);
                  }}
                >
                  密码登录
                </button>
              </div>

              {/* 语义化表单错误展示 */}
              {formError && (
                <div
                  id="login-form-error"
                  role="alert"
                  aria-live="assertive"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#dc2626',
                    fontSize: 12,
                    marginBottom: 16,
                  }}
                >
                  {formError}
                </div>
              )}

              {/* 短信登录表单 */}
              {tabMode === 'phone' && (
                <form id="panel-phone" role="tabpanel" aria-labelledby="tab-phone" onSubmit={handleSmsLogin} noValidate>
                  <div className="auth-field">
                    <div className="auth-input-phone-wrap" style={{ height: 48 }}>
                      <span className="auth-phone-prefix">+86</span>
                      <input
                        ref={phoneInputRef}
                        type="tel"
                        className="auth-phone-input"
                        placeholder="请输入手机号"
                        value={rawPhone}
                        onChange={(e) => setRawPhone(e.target.value)}
                        autoComplete="tel"
                        disabled={isLoading || isSendingCode}
                        required
                        aria-label="手机号码"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'login-form-error' : undefined}
                      />
                    </div>
                  </div>

                  <div className="auth-field">
                    <div className="auth-code-input-wrap">
                      <input
                        ref={codeInputRef}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        className="auth-input-pill"
                        style={{ height: 48 }}
                        placeholder="请输入验证码"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                        disabled={isLoading}
                        required
                        aria-label="短信验证码"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'login-form-error' : undefined}
                      />
                      <button
                        type="button"
                        className="auth-send-code-btn"
                        style={{
                          height: 48,
                          padding: '0 20px',
                          color: isCurrentPhoneInCooldown || isSendingCode || isLoading ? '#94a3b8' : '#0284c7',
                        }}
                        disabled={isCurrentPhoneInCooldown || isSendingCode || isLoading}
                        onClick={handleSendCode}
                      >
                        {isCurrentPhoneInCooldown ? `${countdown}s 后重新获取` : isSendingCode ? '发送中...' : '获取验证码'}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="auth-btn-primary"
                    style={{ height: 48, fontSize: 15, marginTop: 14 }}
                    disabled={isLoading}
                  >
                    {isLoading ? '登录中...' : '登录'}
                  </button>
                </form>
              )}

              {/* 账号密码表单 */}
              {tabMode === 'account' && (
                <form id="panel-account" role="tabpanel" aria-labelledby="tab-account" onSubmit={handleAccountLogin} noValidate>
                  <div className="auth-field">
                    <input
                      ref={accountInputRef}
                      type="text"
                      name="account"
                      className="auth-input-pill"
                      style={{ height: 48 }}
                      placeholder="请输入手机号码或邮箱"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      autoComplete="username"
                      disabled={isLoading}
                      required
                      aria-label="手机号码或邮箱"
                      aria-invalid={Boolean(formError)}
                      aria-describedby={formError ? 'login-form-error' : undefined}
                    />
                  </div>

                  <div className="auth-field" style={{ position: 'relative' }}>
                    <input
                      ref={passwordInputRef}
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      className="auth-input-pill"
                      style={{ height: 48, paddingRight: 48 }}
                      placeholder="请输入登录密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      disabled={isLoading}
                      required
                      aria-label="登录密码"
                      aria-invalid={Boolean(formError)}
                      aria-describedby={formError ? 'login-form-error' : undefined}
                    />
                    <button
                      type="button"
                      className="auth-pwd-eye-btn"
                      style={{ top: 14 }}
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? '隐藏密码' : '显示密码'}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" y1="2" x2="22" y2="22" />
                        </svg>
                      )}
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="auth-btn-primary"
                    style={{ height: 48, fontSize: 15, marginTop: 14 }}
                    disabled={isLoading}
                  >
                    {isLoading ? '登录中...' : '登录'}
                  </button>
                </form>
              )}

              {/* 忘记密码与注册入口 */}
              <div className="auth-sublinks-bar">
                <Link href="/forgot-password" className="auth-link">
                  忘记密码
                </Link>
                <span>·</span>
                <Link href="/register" className="auth-link auth-link-highlight">
                  注册账号
                </Link>
              </div>
            </div>
          </div>
        </div>

          {/* 底部备案声明 */}
          <div className="auth-footer-info" style={{ paddingBottom: 8 }}>
            <div>© EmboMiX 版权所有</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', width: '100vw', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中...</div>
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
