'use client';

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { normalizeAuthError } from '../../lib/auth-errors';
import {
  sendPasswordRecoveryCode,
  verifyPasswordRecoveryCode,
  resetPasswordRecovery,
} from '../../lib/api/generated/sdk.gen';

const MAINLAND_PHONE_REGEX = /^\+861[3-9][0-9]{9}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function normalizeAccountInput(raw: string): { valid: boolean; normalized: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: '请输入手机号或注册邮箱' };
  }
  const phoneNormalized = trimmed.startsWith('+86') ? trimmed : `+86${trimmed}`;
  if (MAINLAND_PHONE_REGEX.test(phoneNormalized)) {
    return { valid: true, normalized: phoneNormalized };
  }
  if (EMAIL_REGEX.test(trimmed)) {
    return { valid: true, normalized: trimmed.toLowerCase() };
  }
  return { valid: false, normalized: '', error: '请输入有效的中国大陆手机号或邮箱地址' };
}

interface SliderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  disabled?: boolean;
}

function SliderCaptchaModal({ isOpen, onClose, onSuccess, disabled }: SliderModalProps) {
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const currentProgressRef = useRef(0);
  currentProgressRef.current = progress;

  // 每次打开重置状态
  useEffect(() => {
    if (isOpen) {
      setProgress(0);
      setIsDragging(false);
      setIsSuccess(false);
    }
  }, [isOpen]);

  const completeChallenge = useCallback(() => {
    setIsSuccess(true);
    setProgress(100);
    setTimeout(() => {
      onSuccess();
    }, 320);
  }, [onSuccess]);

  // 拖动逻辑
  const handleStart = (clientX: number) => {
    if (disabled || isSuccess) return;
    setIsDragging(true);
    startXRef.current = clientX;
  };

  const handleMove = useCallback(
    (clientX: number) => {
      if (!isDragging || disabled || isSuccess || !trackRef.current) return;
      const trackWidth = trackRef.current.clientWidth - 48; // 减去滑块宽度
      if (trackWidth <= 0) return;
      const deltaX = clientX - startXRef.current;
      const pct = Math.min(100, Math.max(0, (deltaX / trackWidth) * 100));
      setProgress(pct);
      if (pct >= 95) {
        setIsDragging(false);
        completeChallenge();
      }
    },
    [isDragging, disabled, isSuccess, completeChallenge],
  );

  const handleEnd = useCallback(() => {
    if (!isDragging || isSuccess) return;
    setIsDragging(false);
    if (currentProgressRef.current < 95) {
      setProgress(0);
    }
  }, [isDragging, isSuccess]);

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) handleMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => handleEnd();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isDragging, handleMove, handleEnd]);

  // 键盘无障碍支持
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || isSuccess) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.min(100, progress + 25);
      setProgress(next);
      if (next >= 100) completeChallenge();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setProgress(Math.max(0, progress - 25));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setProgress(0);
    } else if (e.key === 'End' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      completeChallenge();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="slider-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !disabled && !isSuccess) {
          onClose();
        }
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 20,
          width: '100%',
          maxWidth: 380,
          boxShadow: '0 20px 45px -10px rgba(15, 23, 42, 0.25)',
          padding: '24px 24px 28px',
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 id="slider-modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
            安全验证
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={disabled || isSuccess}
            aria-label="关闭验证"
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              lineHeight: 1,
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: '0 0 20px 0', fontSize: 13, color: '#64748b' }}>
          请按住滑块，拖动到最右侧完成安全验证
        </p>

        {/* 滑块轨道 */}
        <div
          ref={trackRef}
          style={{
            position: 'relative',
            height: 48,
            borderRadius: 9999,
            background: isSuccess ? '#dcfce7' : '#f1f5f9',
            border: `1px solid ${isSuccess ? '#86efac' : '#e2e8f0'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            overflow: 'hidden',
            transition: 'background 0.2s, border-color 0.2s',
          }}
        >
          {/* 进度填充 */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${progress}%`,
              background: isSuccess ? '#22c55e' : 'linear-gradient(90deg, #0284c7, #38bdf8)',
              borderRadius: 9999,
              transition: isDragging ? 'none' : 'width 0.2s ease-out',
            }}
          />

          {/* 轨道文案 */}
          <span
            style={{
              position: 'relative',
              zIndex: 2,
              fontSize: 13,
              color: isSuccess ? '#15803d' : '#64748b',
              fontWeight: 500,
              opacity: isSuccess ? 1 : Math.max(0, 1 - progress / 60),
              pointerEvents: 'none',
            }}
          >
            {isSuccess ? '验证通过' : '向右滑动滑块验证'}
          </span>

          {/* 可拖动手柄 */}
          <div
            role="slider"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label="拖动滑块完成安全验证"
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => handleStart(e.clientX)}
            onTouchStart={(e) => {
              if (e.touches.length > 0) handleStart(e.touches[0].clientX);
            }}
            style={{
              position: 'absolute',
              left: `calc(${progress}% - ${progress * 0.44}px)`,
              width: 44,
              height: 44,
              top: 1,
              borderRadius: 9999,
              background: '#ffffff',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isSuccess ? 'default' : 'grab',
              zIndex: 3,
              outline: 'none',
              transition: isDragging ? 'none' : 'left 0.2s ease-out',
            }}
          >
            {isSuccess ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordVisibilityToggle({
  show,
  onToggle,
}: {
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="auth-pwd-eye-btn"
      style={{ top: 14, right: 14 }}
      onClick={onToggle}
      title={show ? '隐藏密码' : '显示密码'}
      aria-label={show ? '隐藏密码' : '显示密码'}
    >
      {show ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}

type RecoveryStep = 'account' | 'verify' | 'reset';

function ForgotPasswordContent() {
  const router = useRouter();
  const { refreshUser } = useAuth();

  const [step, setStep] = useState<RecoveryStep>('account');
  const [account, setAccount] = useState('');
  const [normalizedAccount, setNormalizedAccount] = useState('');
  const [isSliderOpen, setIsSliderOpen] = useState(false);
  const [code, setCode] = useState('');
  const [resetTicket, setResetTicket] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [countdown, setCountdown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const accountInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 保证视频静音与自动播放
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // 步骤 1：提交账号并触发滑块
  const handleAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const check = normalizeAccountInput(account);
    if (!check.valid) {
      setFormError(check.error || '请输入有效的手机号或注册邮箱');
      showToast('⚠️ 输入格式不符合要求');
      accountInputRef.current?.focus();
      return;
    }
    setFormError(null);
    setNormalizedAccount(check.normalized);
    setIsSliderOpen(true);
  };

  // 步骤 2：滑块完成回调，真正调用发码接口
  const handleSliderSuccess = async () => {
    setIsSliderOpen(false);
    setIsLoading(true);
    setFormError(null);

    try {
      const res = await sendPasswordRecoveryCode({
        body: { account: normalizedAccount },
      });

      if (res.data) {
        showToast('✓ 若账号可找回，验证码将发送到绑定手机号，请查收短信');
        // 严格遵循后端返回的 retryAfter 设置倒计时
        const interval = typeof res.data.retryAfter === 'number' ? res.data.retryAfter : 60;
        setCountdown(interval);
        setStep('verify');
        setIsLoading(false);
        setTimeout(() => codeInputRef.current?.focus(), 100);
        return;
      }

      const retryAfter = res.response?.headers?.get('Retry-After');
      const normErr = normalizeAuthError(res.error, res.response?.status, retryAfter);
      const displayMsg = normErr.requestId ? `${normErr.message} (排查编号: ${normErr.requestId})` : normErr.message;
      setFormError(displayMsg);
      showToast(displayMsg);
      setIsLoading(false);
    } catch (err: unknown) {
      const normErr = normalizeAuthError(err);
      setFormError(normErr.message);
      showToast(normErr.message);
      setIsLoading(false);
    }
  };

  // 重新获取验证码
  const handleResendCode = () => {
    if (countdown > 0 || isLoading) return;
    setIsSliderOpen(true);
  };

  // 步骤 3：验证短信验证码
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const trimmedCode = code.trim();
    if (!/^[0-9]{6}$/.test(trimmedCode)) {
      setFormError('请输入 6 位数字验证码');
      showToast('⚠️ 请输入 6 位数字验证码');
      codeInputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setFormError(null);

    try {
      const res = await verifyPasswordRecoveryCode({
        body: {
          account: normalizedAccount,
          code: trimmedCode,
        },
      });

      if (res.data?.resetTicket) {
        setResetTicket(res.data.resetTicket);
        setStep('reset');
        setIsLoading(false);
        showToast('✓ 身份验证成功，请设置新密码');
        setTimeout(() => newPasswordRef.current?.focus(), 100);
        return;
      }

      const normErr = normalizeAuthError(res.error, res.response?.status);
      const displayMsg = normErr.requestId ? `${normErr.message} (排查编号: ${normErr.requestId})` : normErr.message;
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

  // 步骤 4：重置密码提交
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (newPassword.length < 8 || newPassword.length > 128) {
      setFormError('密码长度须在 8–128 位之间');
      showToast('⚠️ 密码长度不符合要求');
      newPasswordRef.current?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('两次输入的密码不一致，请重新输入');
      showToast('⚠️ 两次输入的密码不一致');
      return;
    }

    setIsLoading(true);
    setFormError(null);

    try {
      const res = await resetPasswordRecovery({
        body: {
          resetTicket,
          newPassword,
        },
      });

      if (res.data?.success) {
        showToast('✓ 密码重置成功，请使用新密码登录');
        // 服务端已通过 Set-Cookie 清理 HttpOnly 会话，前端刷新本地认证上下文
        await refreshUser().catch(() => {});
        router.replace('/login?reset=success');
        return;
      }

      const normErr = normalizeAuthError(res.error, res.response?.status);
      const displayMsg = normErr.requestId ? `${normErr.message} (排查编号: ${normErr.requestId})` : normErr.message;
      setFormError(displayMsg);
      showToast(displayMsg);
      setIsLoading(false);
    } catch (err: unknown) {
      const normErr = normalizeAuthError(err);
      setFormError(normErr.message);
      showToast(normErr.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page-root">
      {/* 消息提示气泡 */}
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

      {/* 滑块安全验证弹窗 */}
      <SliderCaptchaModal
        isOpen={isSliderOpen}
        disabled={isLoading}
        onClose={() => setIsSliderOpen(false)}
        onSuccess={handleSliderSuccess}
      />

      {/* 主布局容器 */}
      <div className="auth-page-container">
        {/* 左侧媒体画幅 */}
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

        {/* 右侧表单交互面板 */}
        <div className="auth-form-panel">
          <div className="auth-form-inner-center">
            <div className="auth-form-card">
              {/* 步骤指示条 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  marginBottom: 20,
                  fontSize: 12,
                  color: '#94a3b8',
                }}
              >
                <span style={{ color: step === 'account' ? '#0284c7' : '#0f172a', fontWeight: step === 'account' ? 600 : 500 }}>
                  1. 输入账号
                </span>
                <span>›</span>
                <span style={{ color: step === 'verify' ? '#0284c7' : step === 'reset' ? '#0f172a' : '#94a3b8', fontWeight: step === 'verify' ? 600 : 500 }}>
                  2. 短信验证
                </span>
                <span>›</span>
                <span style={{ color: step === 'reset' ? '#0284c7' : '#94a3b8', fontWeight: step === 'reset' ? 600 : 500 }}>
                  3. 重置密码
                </span>
              </div>

              {/* 语义化表单错误 */}
              {formError && (
                <div
                  id="recovery-form-error"
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

              {/* ===================== 阶段 1：输入账号 ===================== */}
              {step === 'account' && (
                <div>
                  <h1 className="auth-heading" style={{ marginBottom: 6, fontSize: 24 }}>
                    找回密码
                  </h1>
                  <p className="auth-subheading" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
                    请输入您注册时使用的手机号码或电子邮箱
                  </p>

                  <form onSubmit={handleAccountSubmit} noValidate>
                    <div className="auth-field" style={{ marginBottom: 16 }}>
                      <input
                        ref={accountInputRef}
                        type="text"
                        className="auth-input-pill"
                        style={{ height: 48 }}
                        placeholder="请输入手机号或邮箱"
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                        autoComplete="username"
                        disabled={isLoading}
                        required
                        aria-label="手机号或注册邮箱"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'recovery-form-error' : undefined}
                      />
                    </div>

                    <button
                      type="submit"
                      className="auth-btn-primary"
                      style={{ height: 48 }}
                      disabled={isLoading}
                    >
                      {isLoading ? '正在处理...' : '下一步'}
                    </button>
                  </form>
                </div>
              )}

              {/* ===================== 阶段 2：输入短信验证码 ===================== */}
              {step === 'verify' && (
                <div>
                  <h1 className="auth-heading" style={{ marginBottom: 6, fontSize: 24 }}>
                    验证身份
                  </h1>
                  <p className="auth-subheading" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
                    若账号可找回，短信验证码已发送至绑定手机号，请查收
                  </p>

                  <form onSubmit={handleVerifyCode} noValidate>
                    <div className="auth-field" style={{ marginBottom: 16 }}>
                      <div className="auth-code-input-wrap">
                        <input
                          ref={codeInputRef}
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          className="auth-input-pill"
                          style={{ height: 48 }}
                          placeholder="请输入 6 位短信验证码"
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                          disabled={isLoading}
                          required
                          aria-label="短信验证码"
                          aria-invalid={Boolean(formError)}
                          aria-describedby={formError ? 'recovery-form-error' : undefined}
                        />
                        <button
                          type="button"
                          className="auth-send-code-btn"
                          style={{ height: 48, minWidth: 126 }}
                          disabled={countdown > 0 || isLoading}
                          onClick={handleResendCode}
                        >
                          {countdown > 0 ? `${countdown}s 后重发` : '重新获取'}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="auth-btn-primary"
                      style={{ height: 48 }}
                      disabled={isLoading}
                    >
                      {isLoading ? '验证中...' : '验证并继续'}
                    </button>
                  </form>
                </div>
              )}

              {/* ===================== 阶段 3：设置新密码 ===================== */}
              {step === 'reset' && (
                <div>
                  <h1 className="auth-heading" style={{ marginBottom: 6, fontSize: 24 }}>
                    重置登录密码
                  </h1>
                  <p className="auth-subheading" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
                    请设置新的登录密码（长度 8–128 位）
                  </p>

                  <form onSubmit={handleResetPassword} noValidate>
                    <div className="auth-field" style={{ marginBottom: 14, position: 'relative' }}>
                      <input
                        ref={newPasswordRef}
                        type={showNewPassword ? 'text' : 'password'}
                        className="auth-input-pill"
                        style={{ height: 48, paddingRight: 40 }}
                        placeholder="请输入新密码（8–128位）"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={isLoading}
                        required
                        aria-label="新登录密码"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'recovery-form-error' : undefined}
                      />
                      <PasswordVisibilityToggle
                        show={showNewPassword}
                        onToggle={() => setShowNewPassword(!showNewPassword)}
                      />
                    </div>

                    <div className="auth-field" style={{ marginBottom: 16, position: 'relative' }}>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        className="auth-input-pill"
                        style={{ height: 48, paddingRight: 40 }}
                        placeholder="请再次确认新密码"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={isLoading}
                        required
                        aria-label="确认新密码"
                        aria-invalid={Boolean(formError)}
                        aria-describedby={formError ? 'recovery-form-error' : undefined}
                      />
                      <PasswordVisibilityToggle
                        show={showConfirmPassword}
                        onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                      />
                    </div>

                    <button
                      type="submit"
                      className="auth-btn-primary"
                      style={{ height: 48 }}
                      disabled={isLoading}
                    >
                      {isLoading ? '正在提交...' : '确认重置密码'}
                    </button>
                  </form>
                </div>
              )}

              {/* 返回登录入口 */}
              <div className="auth-sublinks-bar" style={{ marginTop: 20 }}>
                <Link href="/login" className="auth-link">
                  记起密码？返回登录
                </Link>
              </div>
            </div>
          </div>

          {/* 底部版权声明 */}
          <div className="auth-footer-info" style={{ paddingBottom: 8 }}>
            <div>© EmboMiX 版权所有</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', width: '100vw', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中...</div>
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
