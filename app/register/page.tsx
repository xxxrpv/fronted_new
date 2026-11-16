'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { register, sendSmsCode } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { normalizeAuthError, isValidNextUrl } from '../../lib/auth-errors';

const MAINLAND_PHONE_REGEX = /^\+861[3-9][0-9]{9}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function normalizeMainlandPhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+86')) {
    return trimmed;
  }
  return `+86${trimmed}`;
}

function RegisterFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, refreshUser } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const sendInFlight = useRef(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // 输入框焦点管理
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const agreeCheckRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 表单状态严格对应 Task-026 OpenAPI RegisterRequest
  const [rawPhone, setRawPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [organizationName, setOrganizationName] = useState('');

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

  // 倒计时计时器
  useEffect(() => {
    if (!Object.values(cooldowns).some((until) => until > Date.now())) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldowns]);

  // 发送短信验证码
  const handleSendCode = async () => {
    if (sendInFlight.current) return;
    const trimmed = rawPhone.trim();
    if (!trimmed) {
      setFormError('请输入手机号码');
      showToast('⚠️ 请输入手机号码');
      phoneRef.current?.focus();
      return;
    }

    const normalizedPhone = normalizeMainlandPhone(trimmed);
    if (!MAINLAND_PHONE_REGEX.test(normalizedPhone)) {
      setFormError('请输入有效的中国大陆手机号（11位数字，如 13800000000）');
      showToast('⚠️ 手机号格式不符合要求');
      phoneRef.current?.focus();
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
          purpose: 'REGISTER',
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
          codeRef.current?.focus();
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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!agreeTerms) {
      setFormError('请阅读并勾选同意《服务协议》与《隐私政策》');
      showToast('⚠️ 请阅读并勾选同意《服务协议》与《隐私政策》');
      agreeCheckRef.current?.focus();
      return;
    }

    const trimmedPhone = rawPhone.trim();
    if (!trimmedPhone) {
      setFormError('请输入手机号码');
      showToast('⚠️ 请输入手机号码');
      phoneRef.current?.focus();
      return;
    }

    const normalizedPhone = normalizeMainlandPhone(trimmedPhone);
    if (!MAINLAND_PHONE_REGEX.test(normalizedPhone)) {
      setFormError('请输入有效的中国大陆手机号（11位数字，如 13800000000）');
      showToast('⚠️ 手机号格式不符合要求');
      phoneRef.current?.focus();
      return;
    }

    const trimmedCode = code.trim();
    if (!trimmedCode || !/^[0-9]{6}$/.test(trimmedCode)) {
      setFormError('请输入6位数字短信验证码');
      showToast('⚠️ 请输入6位数字短信验证码');
      codeRef.current?.focus();
      return;
    }

    if (!password || password.length < 8) {
      setFormError('登录密码长度不能少于8位');
      showToast('⚠️ 登录密码不能少于8位');
      passwordRef.current?.focus();
      return;
    }
    if (password.length > 128) {
      setFormError('登录密码长度不能超过128位');
      showToast('⚠️ 登录密码长度不能超过128位');
      passwordRef.current?.focus();
      return;
    }

    if (password !== confirmPassword) {
      setFormError('两次输入的密码不一致，请重新输入');
      showToast('⚠️ 两次输入的密码不一致');
      confirmPasswordRef.current?.focus();
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      setFormError('邮箱格式不正确，请检查后重新输入');
      showToast('⚠️ 邮箱格式不正确');
      emailRef.current?.focus();
      return;
    }

    const trimmedOrg = organizationName.trim();
    if (trimmedOrg.length > 15) {
      setFormError('机构名称长度不能超过15个字符');
      showToast('⚠️ 机构名称长度不能超过15个字符');
      return;
    }

    setIsLoading(true);
    setFormError(null);

    try {
      const res = await register({
        body: {
          phoneNumber: normalizedPhone,
          code: trimmedCode,
          password,
          email: trimmedEmail || undefined,
          organizationName: trimmedOrg || undefined,
        },
      });

      if (res.data) {
        showToast('🎉 注册成功！正在进入平台...');
        const userProfile = await refreshUser();
        if (userProfile) {
          router.replace(targetUrl);
          return;
        }
        setIsLoading(false);
        const failMsg = '账号注册成功，但自动同步会话失败，请切换至登录页手动登录';
        setFormError(failMsg);
        showToast(`⚠️ ${failMsg}`);
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

      if (normErr.code === 'PHONE_NUMBER_ALREADY_EXISTS') {
        phoneRef.current?.focus();
      } else if (normErr.code === 'INVALID_VERIFICATION_CODE') {
        codeRef.current?.focus();
      } else if (normErr.code === 'EMAIL_ALREADY_EXISTS') {
        emailRef.current?.focus();
      }
    } catch (err: unknown) {
      const normErr = normalizeAuthError(err);
      setFormError(normErr.message);
      showToast(normErr.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page-root">
      {/* 消息提示 */}
      {toastMsg && (
        <div
          role="status"
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

      {/* 主布局容器：电脑端左右分栏 / 手机端上下流式布局 */}
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

        {/* ===================== 右侧：注册操作区 ===================== */}
        <div className="auth-form-panel">
          {/* 表单垂直居中容器 */}
          <div className="auth-form-inner-center">
            {/* 表单区域：精准控制统一宽度 */}
            <div className="auth-form-card">
              <div>
                <h1 className="auth-heading" style={{ marginBottom: 6, fontSize: 24 }}>
                  欢迎注册 EmboMiX AI平台
                </h1>
                <p className="auth-subheading" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
                  创建账号，开启具身智能研发之旅
                </p>

                {/* 语义化表单错误展示 */}
                {formError && (
                  <div
                    id="register-form-error"
                    role="alert"
                    aria-live="assertive"
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      color: '#dc2626',
                      fontSize: 12,
                      marginBottom: 14,
                    }}
                  >
                    {formError}
                  </div>
                )}

                <form onSubmit={handleRegister} noValidate>
                  {/* 第 1 行：手机号码 */}
                  <div className="auth-field" style={{ marginBottom: 13 }}>
                    <div className="auth-input-phone-wrap" style={{ height: 48 }}>
                      <span className="auth-phone-prefix">+86</span>
                      <input
                        ref={phoneRef}
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
                        aria-describedby={formError ? 'register-form-error' : undefined}
                      />
                    </div>
                  </div>

                  {/* 第 2 行：验证码 */}
                  <div className="auth-field" style={{ marginBottom: 13 }}>
                    <div className="auth-code-input-wrap">
                      <input
                        ref={codeRef}
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
                        aria-describedby={formError ? 'register-form-error' : undefined}
                      />
                      <button
                        type="button"
                        className="auth-send-code-btn"
                        style={{ height: 48, minWidth: 126 }}
                        disabled={isCurrentPhoneInCooldown || isSendingCode || isLoading}
                        onClick={handleSendCode}
                      >
                        {isCurrentPhoneInCooldown ? `${countdown}s 后重新获取` : isSendingCode ? '发送中...' : '获取验证码'}
                      </button>
                    </div>
                  </div>

                  {/* 第 3 行：登录密码 + 确认密码 (电脑端双列 / 手机端单列) */}
                  <div className="auth-grid-two-cols">
                    <div className="auth-field" style={{ marginBottom: 0, position: 'relative' }}>
                      <input
                        ref={passwordRef}
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        className="auth-input-pill"
                        style={{ height: 48, paddingRight: 40 }}
                        placeholder="请输入密码"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={isLoading}
                        required
                        aria-label="登录密码"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'register-form-error' : undefined}
                      />
                      <button
                        type="button"
                        className="auth-pwd-eye-btn"
                        style={{ top: 14, right: 14 }}
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

                    <div className="auth-field" style={{ marginBottom: 0, position: 'relative' }}>
                      <input
                        ref={confirmPasswordRef}
                        type={showConfirmPassword ? 'text' : 'password'}
                        name="confirmPassword"
                        className="auth-input-pill"
                        style={{ height: 48, paddingRight: 40 }}
                        placeholder="请再次输入密码"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={isLoading}
                        required
                        aria-label="确认密码"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'register-form-error' : undefined}
                      />
                      <button
                        type="button"
                        className="auth-pwd-eye-btn"
                        style={{ top: 14, right: 14 }}
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        title={showConfirmPassword ? '隐藏密码' : '显示密码'}
                        aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
                      >
                        {showConfirmPassword ? (
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
                  </div>

                  {/* 第 4 行：电子邮箱 (选填) + 机构名称 (选填) (电脑端双列 / 手机端单列) */}
                  <div className="auth-grid-two-cols">
                    <div className="auth-field" style={{ marginBottom: 0 }}>
                      <input
                        ref={emailRef}
                        type="email"
                        name="email"
                        className="auth-input-pill"
                        style={{ height: 48 }}
                        placeholder="电子邮箱 (选填)"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        disabled={isLoading}
                        aria-label="电子邮箱"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'register-form-error' : undefined}
                      />
                    </div>

                    <div className="auth-field" style={{ marginBottom: 0 }}>
                      <input
                        type="text"
                        name="organizationName"
                        className="auth-input-pill"
                        style={{ height: 48 }}
                        placeholder="企业 / 机构名称 (选填)"
                        value={organizationName}
                        onChange={(e) => setOrganizationName(e.target.value)}
                        maxLength={15}
                        disabled={isLoading}
                        aria-label="机构名称"
                      />
                    </div>
                  </div>

                  {/* 协议勾选 */}
                  <div className="auth-agreement-row" style={{ marginTop: 2, marginBottom: 14 }}>
                    <input
                      ref={agreeCheckRef}
                      type="checkbox"
                      id="agreeCheck"
                      className="auth-agreement-checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      disabled={isLoading}
                      aria-invalid={Boolean(formError && !agreeTerms)}
                      aria-describedby={formError ? 'register-form-error' : undefined}
                    />
                    <label htmlFor="agreeCheck">
                      我已阅读并同意
                      <a
                        href="#terms"
                        className="auth-agreement-link"
                        onClick={(e) => {
                          e.preventDefault();
                          showToast('已查阅《平台服务协议》');
                        }}
                      >
                        《服务协议》
                      </a>
                      与
                      <a
                        href="#privacy"
                        className="auth-agreement-link"
                        onClick={(e) => {
                          e.preventDefault();
                          showToast('已查阅《隐私权政策》');
                        }}
                      >
                        《隐私政策》
                      </a>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="auth-btn-primary"
                    style={{ height: 48, fontSize: 15, fontWeight: 600 }}
                    disabled={isLoading}
                  >
                    {isLoading ? '正在注册并开通...' : '同意协议并注册'}
                  </button>
                </form>

                {/* 切换回登录 */}
                <div className="auth-sublinks-bar" style={{ marginTop: 16 }}>
                  <span>已有账号？</span>
                  <Link href="/login" className="auth-link auth-link-highlight">
                    直接登录
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* 底部备案声明 */}
          <div className="auth-footer-info" style={{ paddingBottom: 8, textAlign: 'center' }}>
            <div>© EmboMiX 版权所有</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', width: '100vw', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中...</div>
        </div>
      }
    >
      <RegisterFormContent />
    </Suspense>
  );
}
