'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth-context';
import { normalizeAuthError } from '../../../lib/auth-errors';
import {
  updateCurrentUser,
  sendPasswordChangeCode,
  changePassword,
  verifyPasswordForPhoneChange,
  sendPhoneChangeCode,
  confirmPhoneChange,
  listActiveSessions,
  revokeSession,
  revokeOtherSessions,
  type ActiveSessionItem,
} from '../../../lib/api';

const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/;

function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '未绑定';
  const digits = phone.startsWith('+86') ? phone.slice(3) : phone;
  if (digits.length === 11) {
    return `+86 ${digits.slice(0, 3)}****${digits.slice(7)}`;
  }
  return phone.length > 4 ? `${phone.slice(0, 3)}****` : phone;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '无';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return dateStr;
  }
}

export default function AccountSettingsPage() {
  const { user, subscription, refreshUser } = useAuth();

  // ---------------------------------------------------------------------------
  // 个人资料表单状态
  // ---------------------------------------------------------------------------
  const [displayName, setDisplayName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(null), 3000);
    return () => clearTimeout(t);
  }, [successMessage]);

  useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(false), 2000);
    return () => clearTimeout(t);
  }, [copiedId]);

  // 初始化用户数据
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setOrganizationName(user.organizationName || '');
    }
  }, [user?.displayName, user?.organizationName]);

  // 计算是否有修改 (Dirty Check)
  const isDirty = useMemo(() => {
    const originalName = user?.displayName || '';
    const originalOrg = user?.organizationName || '';
    const currentName = displayName.trim();
    const currentOrg = organizationName.trim();
    return currentName !== originalName || (currentOrg || '') !== originalOrg;
  }, [user, displayName, organizationName]);

  // 校验个人资料是否合法
  const validationError = useMemo(() => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      return '显示名称不能为空';
    }
    if (trimmedName.length > 80) {
      return '显示名称长度不能超过 80 个字符';
    }
    if (CONTROL_CHAR_REGEX.test(displayName)) {
      return '显示名称包含非法控制字符';
    }
    const trimmedOrg = organizationName.trim();
    if (trimmedOrg.length > 100) {
      return '所属机构长度不能超过 100 个字符';
    }
    if (CONTROL_CHAR_REGEX.test(organizationName)) {
      return '所属机构包含非法控制字符';
    }
    return null;
  }, [displayName, organizationName]);

  const canSave = isDirty && !validationError && !isSubmitting;

  // 提交资料修改
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedName = displayName.trim();
    const trimmedOrg = organizationName.trim();

    try {
      const res = await updateCurrentUser({
        body: {
          displayName: trimmedName,
          organizationName: trimmedOrg.length > 0 ? trimmedOrg : null,
        },
      });

      if (res.error) {
        const errorDetail =
          normalizeAuthError(res.error).message || '保存失败，请检查输入或重试';
        setErrorMessage(errorDetail);
        return;
      }

      await refreshUser();
      setSuccessMessage('个人资料更新成功');
    } catch (err: any) {
      setErrorMessage(err?.message || '网络异常，保存失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 复制用户 ID
  const handleCopyUserId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedId(true);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = user.id;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedId(true);
    }
  };

  // ---------------------------------------------------------------------------
  // 修改密码 Modal 状态与逻辑
  // ---------------------------------------------------------------------------
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pwdCode, setPwdCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdCountdown, setPwdCountdown] = useState(0);
  const [isSendingPwdCode, setIsSendingPwdCode] = useState(false);
  const [isSubmittingPwd, setIsSubmittingPwd] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  useEffect(() => {
    if (pwdCountdown <= 0) return;
    const timer = setInterval(() => {
      setPwdCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [pwdCountdown]);

  const openPasswordModal = () => {
    setPwdCode('');
    setNewPassword('');
    setConfirmPassword('');
    setPwdError(null);
    setShowPasswordModal(true);
  };

  const closePasswordModal = () => {
    if (isSubmittingPwd) return;
    setShowPasswordModal(false);
  };

  const handleSendPasswordCode = async () => {
    if (pwdCountdown > 0 || isSendingPwdCode) return;
    setIsSendingPwdCode(true);
    setPwdError(null);

    try {
      const res = await sendPasswordChangeCode();
      if (res.error) {
        const msg =
          normalizeAuthError(res.error).message ||
          '验证码发送失败，请稍后重试';
        setPwdError(msg);
      } else {
        setPwdCountdown(60);
      }
    } catch (err: any) {
      setPwdError(err?.message || '网络异常，验证码发送失败');
    } finally {
      setIsSendingPwdCode(false);
    }
  };

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);

    const trimmedCode = pwdCode.trim();
    if (!/^[0-9]{6}$/.test(trimmedCode)) {
      setPwdError('请输入 6 位数字验证码');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setPwdError('新密码长度须在 8–128 个字符之间');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致');
      return;
    }

    setIsSubmittingPwd(true);
    try {
      const res = await changePassword({
        body: {
          code: trimmedCode,
          newPassword,
        },
      });

      if (res.error) {
        const msg =
          normalizeAuthError(res.error).message ||
          '修改密码失败，请核对验证码后重试';
        setPwdError(msg);
        return;
      }

      setShowPasswordModal(false);
      setGlobalToast({
        type: 'success',
        message: '密码修改成功，其他设备会话已安全退出',
      });
      await refreshUser();
      loadSessions();
    } catch (err: any) {
      setPwdError(err?.message || '网络异常，密码修改失败');
    } finally {
      setIsSubmittingPwd(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 更换手机号 Modal 状态与逻辑 (分步流程)
  // ---------------------------------------------------------------------------
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneStep, setPhoneStep] = useState<1 | 2>(1);
  const [verifyPasswordVal, setVerifyPasswordVal] = useState('');
  const [phoneTicket, setPhoneTicket] = useState<string | null>(null);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCountdown, setPhoneCountdown] = useState(0);
  const [isVerifyingPwd, setIsVerifyingPwd] = useState(false);
  const [isSendingPhoneCode, setIsSendingPhoneCode] = useState(false);
  const [isSubmittingPhone, setIsSubmittingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    if (phoneCountdown <= 0) return;
    const timer = setInterval(() => {
      setPhoneCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [phoneCountdown]);

  const openPhoneModal = () => {
    setPhoneStep(1);
    setVerifyPasswordVal('');
    setPhoneTicket(null);
    setNewPhoneNumber('');
    setPhoneCode('');
    setPhoneError(null);
    setShowPhoneModal(true);
  };

  const closePhoneModal = () => {
    if (isSubmittingPhone || isVerifyingPwd) return;
    setShowPhoneModal(false);
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyPasswordVal) {
      setPhoneError('请输入当前账户登录密码');
      return;
    }

    setIsVerifyingPwd(true);
    setPhoneError(null);

    try {
      const res = await verifyPasswordForPhoneChange({
        body: { password: verifyPasswordVal },
      });

      if (res.error) {
        const msg =
          normalizeAuthError(res.error).message ||
          '密码验证失败，请确认密码正确';
        setPhoneError(msg);
        return;
      }

      if (res.data?.ticket) {
        setPhoneTicket(res.data.ticket);
        setPhoneStep(2);
      } else {
        setPhoneError('未能获取换绑授权凭据，请重试');
      }
    } catch (err: any) {
      setPhoneError(err?.message || '网络异常，验证失败');
    } finally {
      setIsVerifyingPwd(false);
    }
  };

  const handleSendNewPhoneCode = async () => {
    if (phoneCountdown > 0 || isSendingPhoneCode || !phoneTicket) return;
    setPhoneError(null);

    const raw = newPhoneNumber.trim();
    const normalizedPhone = raw.startsWith('+86') ? raw : `+86${raw}`;
    if (!/^\+861[3-9][0-9]{9}$/.test(normalizedPhone)) {
      setPhoneError('请输入有效的中国大陆手机号（11 位以 13–19 开头）');
      return;
    }
    if (normalizedPhone === user?.phoneNumber) {
      setPhoneError('新手机号不能与当前已绑定的手机号相同');
      return;
    }

    setIsSendingPhoneCode(true);
    try {
      const res = await sendPhoneChangeCode({
        body: {
          ticket: phoneTicket,
          newPhoneNumber: normalizedPhone,
        },
      });

      if (res.error) {
        const msg =
          normalizeAuthError(res.error).message ||
          '验证码发送失败，请稍后重试';
        setPhoneError(msg);
      } else {
        setPhoneCountdown(60);
      }
    } catch (err: any) {
      setPhoneError(err?.message || '网络异常，验证码发送失败');
    } finally {
      setIsSendingPhoneCode(false);
    }
  };

  const handleConfirmPhoneChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneTicket) {
      setPhoneError('授权已失效，请重新验证密码');
      setPhoneStep(1);
      return;
    }

    const raw = newPhoneNumber.trim();
    const normalizedPhone = raw.startsWith('+86') ? raw : `+86${raw}`;
    if (!/^\+861[3-9][0-9]{9}$/.test(normalizedPhone)) {
      setPhoneError('请输入有效的中国大陆手机号');
      return;
    }
    const trimmedCode = phoneCode.trim();
    if (!/^[0-9]{6}$/.test(trimmedCode)) {
      setPhoneError('请输入 6 位数字验证码');
      return;
    }

    setIsSubmittingPhone(true);
    setPhoneError(null);

    try {
      const res = await confirmPhoneChange({
        body: {
          ticket: phoneTicket,
          newPhoneNumber: normalizedPhone,
          code: trimmedCode,
        },
      });

      if (res.error) {
        const msg =
          normalizeAuthError(res.error).message ||
          '换绑失败，请核对验证码或重试';
        setPhoneError(msg);
        return;
      }

      await refreshUser();
      setShowPhoneModal(false);
      setGlobalToast({
        type: 'success',
        message: '手机号码更换成功，已同步更新',
      });
      loadSessions();
    } catch (err: any) {
      setPhoneError(err?.message || '网络异常，换绑失败');
    } finally {
      setIsSubmittingPhone(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 登录设备管理 (Active Sessions) 状态与逻辑
  // ---------------------------------------------------------------------------
  const [sessions, setSessions] = useState<ActiveSessionItem[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isRevokingOthers, setIsRevokingOthers] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'single' | 'others';
    sessionId?: string;
    deviceInfo?: string;
  } | null>(null);

  const [globalToast, setGlobalToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!globalToast) return;
    const t = setTimeout(() => setGlobalToast(null), 3500);
    return () => clearTimeout(t);
  }, [globalToast]);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    setSessionsError(null);
    try {
      const res = await listActiveSessions();
      if (res.error) {
        setSessionsError('加载活跃会话失败');
      } else if (res.data?.items) {
        setSessions(res.data.items);
      }
    } catch (err: any) {
      setSessionsError(err?.message || '网络连接异常');
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleRevokeSingle = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      const res = await revokeSession({ path: { sessionId } });
      if (res.error) {
        const msg =
          normalizeAuthError(res.error).message ||
          '下线失败，请重试';
        setGlobalToast({ type: 'error', message: msg });
      } else {
        setGlobalToast({ type: 'success', message: '指定设备会话已安全下线' });
        loadSessions();
      }
    } catch (err: any) {
      setGlobalToast({ type: 'error', message: err?.message || '网络异常' });
    } finally {
      setRevokingId(null);
      setConfirmDialog(null);
    }
  };

  const handleRevokeOthers = async () => {
    setIsRevokingOthers(true);
    try {
      const res = await revokeOtherSessions();
      if (res.error) {
        const msg =
          normalizeAuthError(res.error).message ||
          '操作失败，请重试';
        setGlobalToast({ type: 'error', message: msg });
      } else {
        const count = res.data?.revokedCount ?? 0;
        setGlobalToast({
          type: 'success',
          message: `已成功退出其他 ${count} 个设备的登录会话`,
        });
        loadSessions();
      }
    } catch (err: any) {
      setGlobalToast({ type: 'error', message: err?.message || '网络异常' });
    } finally {
      setIsRevokingOthers(false);
      setConfirmDialog(null);
    }
  };

  const hasOtherSessions = useMemo(
    () => sessions.some((s) => !s.isCurrent),
    [sessions],
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 80px' }}>
      {/* 全局 Toast 通知 */}
      {globalToast && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 8,
            background: globalToast.type === 'success' ? '#0f172a' : '#ef4444',
            color: '#ffffff',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.16)',
            fontSize: 13,
            fontWeight: 500,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {globalToast.type === 'success' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span>{globalToast.message}</span>
        </div>
      )}

      {/* 顶部面包屑与标题区 */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted, #64748b)', marginBottom: 10 }}>
          <Link href="/projects" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.15s' }}>
            控制台
          </Link>
          <span style={{ color: '#cbd5e1' }}>/</span>
          <span style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 500 }}>账户设置</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary, #0f172a)', margin: '0 0 6px 0', letterSpacing: '-0.025em' }}>
              账户设置
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted, #64748b)', margin: 0, lineHeight: 1.5 }}>
              管理您的个人资料、登录身份凭据、安全策略及当前服务订阅。
            </p>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '4px 12px',
              borderRadius: 20,
              fontSize: 12,
              color: '#475569',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
            <span>账户状态：正常</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 卡片 1: 个人资料 */}
        <section
          aria-labelledby="section-profile-title"
          style={{
            background: '#ffffff',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
            <h2 id="section-profile-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0' }}>
              个人资料
            </h2>
          
          </div>

          <form onSubmit={handleSave}>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
              {/* 头像与账户摘要 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '12px 16px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#0f172a',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 17,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {(() => {
                    const currentName = displayName.trim() || user?.displayName?.trim() || '';
                    const isCustom = currentName && !currentName.startsWith('用户_');
                    const initial = isCustom
                      ? currentName.slice(0, 1).toUpperCase()
                      : user?.email?.trim()
                        ? user.email.trim().slice(0, 1).toUpperCase()
                        : null;
                    if (initial) {
                      return <span>{initial}</span>;
                    }
                    return (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    );
                  })()}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                    {displayName.trim() || user?.displayName || '未命名用户'}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    头像基于您的显示名称自动渲染，将展示于顶部工具栏及团队协作场景中。
                  </div>
                </div>
              </div>

              {/* 显示名称 */}
              <div>
                <label
                  htmlFor="displayNameInput"
                  style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #0f172a)', marginBottom: 6 }}
                >
                  显示名称 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="displayNameInput"
                  type="text"
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例如：张三 / Alex Chen"
                  style={{
                    width: '100%',
                    maxWidth: 440,
                    padding: '8px 12px',
                    fontSize: 14,
                    color: 'var(--text-primary, #0f172a)',
                    background: '#ffffff',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    borderRadius: 6,
                    outline: 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#0f172a';
                    e.target.style.boxShadow = '0 0 0 1px #0f172a';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--border-color, #cbd5e1)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 5 }}>
                  必填，1–80 个字符，支持中文、英文及常用标点。
                </div>
              </div>

              {/* 所属机构 */}
              <div>
                <label
                  htmlFor="organizationNameInput"
                  style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #0f172a)', marginBottom: 6 }}
                >
                  所属机构或企业
                </label>
                <input
                  id="organizationNameInput"
                  type="text"
                  maxLength={100}
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder=""
                  style={{
                    width: '100%',
                    maxWidth: 440,
                    padding: '8px 12px',
                    fontSize: 14,
                    color: 'var(--text-primary, #0f172a)',
                    background: '#ffffff',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    borderRadius: 6,
                    outline: 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#0f172a';
                    e.target.style.boxShadow = '0 0 0 1px #0f172a';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--border-color, #cbd5e1)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 5 }}>
                  选填。清空后保存将重置为未填写。
                </div>
              </div>
            </div>

            {/* 卡片底部操作栏 */}
            <div
              style={{
                padding: '14px 24px',
                background: '#f8fafc',
                borderTop: '1px solid var(--border-color, #e2e8f0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                {successMessage && (
                  <div style={{ fontSize: 13, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{successMessage}</span>
                  </div>
                )}
                {errorMessage && (
                  <div style={{ fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{errorMessage}</span>
                  </div>
                )}
                {!successMessage && !errorMessage && validationError && isDirty && (
                  <div style={{ fontSize: 13, color: '#ea580c' }}>
                    {validationError}
                  </div>
                )}
                {!successMessage && !errorMessage && (!isDirty || !validationError) && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                    请填写真实规范的个人与团队信息。
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!canSave}
                style={{
                  padding: '7px 20px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: canSave ? '#0f172a' : '#94a3b8',
                  border: 'none',
                  borderRadius: 6,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isSubmitting ? (
                  <>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ animation: 'spin 1s linear infinite' }}
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span>保存中...</span>
                  </>
                ) : (
                  <span>保存更改</span>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* 卡片 2: 账户凭证与安全信息 */}
        <section
          aria-labelledby="section-credentials-title"
          style={{
            background: '#ffffff',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
            <h2 id="section-credentials-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0' }}>
              账户凭证与安全信息
            </h2>
            
          </div>

          <div style={{ padding: '4px 24px' }}>
            {/* 用户 ID */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                borderBottom: '1px solid #f1f5f9',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>用户 ID</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>全局唯一系统账号标识</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    background: '#f1f5f9',
                    padding: '4px 9px',
                    borderRadius: 4,
                    color: '#334155',
                  }}
                >
                  {user?.id || '—'}
                </code>
                <button
                  type="button"
                  onClick={handleCopyUserId}
                  title="复制用户 ID"
                  aria-label="复制用户 ID"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    fontSize: 12,
                    color: copiedId ? '#16a34a' : '#475569',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {copiedId ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                      <span>复制</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 登录密码 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                borderBottom: '1px solid #f1f5f9',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>登录密码</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>
                  用于账号登录与敏感安全操作的身份验证
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: '#64748b',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    padding: '2px 8px',
                    borderRadius: 4,
                    letterSpacing: '0.12em',
                  }}
                >
                  ••••••••
                </span>
                <button
                  type="button"
                  onClick={openPasswordModal}
                  style={{
                    padding: '5px 14px',
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: '#0f172a',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#94a3b8')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                >
                  修改密码
                </button>
              </div>
            </div>

            {/* 手机号码 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                borderBottom: '1px solid #f1f5f9',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>手机号码</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>用于短信验证码登录与账户安全确认</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: '#0f172a' }}>
                  {maskPhoneNumber(user?.phoneNumber)}
                </span>
                {user?.phoneVerified && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      color: '#15803d',
                      background: '#dcfce7',
                      padding: '2px 8px',
                      borderRadius: 9999,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    已验证
                  </span>
                )}
                <button
                  type="button"
                  onClick={openPhoneModal}
                  style={{
                    padding: '5px 14px',
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: '#0f172a',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#94a3b8')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                >
                  更换手机号
                </button>
              </div>
            </div>

            {/* 电子邮箱 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                borderBottom: '1px solid #f1f5f9',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>电子邮箱</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>用于系统通知与重要消息提醒</div>
              </div>
              <div>
                {user?.email ? (
                  <span style={{ fontSize: 13.5, color: '#0f172a' }}>{user.email}</span>
                ) : (
                  <span style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>未填写</span>
                )}
              </div>
            </div>

            {/* 注册时间 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>注册时间</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>初始账号创建记录</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
                {formatDate(user?.createdAt)}
              </div>
            </div>
          </div>
        </section>

        {/* 卡片 3: 登录设备管理 */}
        <section
          aria-labelledby="section-sessions-title"
          style={{
            background: '#ffffff',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-color, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h2 id="section-sessions-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0' }}>
                登录设备管理
              </h2>
              
            </div>

            {hasOtherSessions && (
              <button
                type="button"
                onClick={() => setConfirmDialog({ type: 'others' })}
                disabled={isRevokingOthers}
                style={{
                  padding: '6px 14px',
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: '#dc2626',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  cursor: isRevokingOthers ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'background 0.15s ease',
                }}
              >
                {isRevokingOthers ? (
                  <span>正在退出其他设备...</span>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>退出其他所有设备</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div style={{ padding: '6px 24px' }}>
            {isLoadingSessions && sessions.length === 0 ? (
              <div style={{ padding: '28px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                正在加载活跃会话...
              </div>
            ) : sessionsError ? (
              <div style={{ padding: '28px 0', textAlign: 'center', color: '#ef4444', fontSize: 13 }}>
                {sessionsError}，
                <button
                  type="button"
                  onClick={loadSessions}
                  style={{
                    color: '#2563eb',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  点击重试
                </button>
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: '28px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                暂无活跃会话记录
              </div>
            ) : (
              sessions.map((session, index) => {
                const isCurrent = session.isCurrent;
                const isRevoking = revokingId === session.id;
                const isMobile =
                  session.deviceInfo.includes('iOS') ||
                  session.deviceInfo.includes('Android');

                return (
                  <div
                    key={session.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '16px 0',
                      borderBottom:
                        index === sessions.length - 1 ? 'none' : '1px solid #f1f5f9',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          background: isCurrent ? '#f0fdf4' : '#f8fafc',
                          border: `1px solid ${isCurrent ? '#bbf7d0' : '#e2e8f0'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isCurrent ? '#16a34a' : '#64748b',
                          flexShrink: 0,
                        }}
                      >
                        {isMobile ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                            <path d="M12 18h.01" />
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="20" height="14" x="2" y="3" rx="2" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                        )}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                            {session.deviceInfo || '未知设备'}
                          </span>
                          {isCurrent && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 11,
                                fontWeight: 500,
                                color: '#16a34a',
                                background: '#dcfce7',
                                padding: '2px 8px',
                                borderRadius: 4,
                              }}
                            >
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
                              当前设备 (本机)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 3 }}>
                          登录 IP: {session.loginIp || '未知'} · 最近活动: {formatDate(session.lastSeenAt)}
                        </div>
                      </div>
                    </div>

                    <div>
                      {isCurrent ? (
                        <span style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 500 }}>
                          在线中
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDialog({
                              type: 'single',
                              sessionId: session.id,
                              deviceInfo: session.deviceInfo,
                            })
                          }
                          disabled={isRevoking}
                          style={{
                            padding: '5px 12px',
                            fontSize: 12,
                            fontWeight: 500,
                            color: '#dc2626',
                            background: '#ffffff',
                            border: '1px solid #fecaca',
                            borderRadius: 5,
                            cursor: isRevoking ? 'not-allowed' : 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#fef2f2';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#ffffff';
                          }}
                        >
                          {isRevoking ? '下线中...' : '退出'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 卡片 4: 订阅与服务套餐 */}
        <section
          aria-labelledby="section-subscription-title"
          style={{
            background: '#ffffff',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
            <h2 id="section-subscription-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0' }}>
              订阅与服务套餐
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', margin: 0 }}>
              当前账户在 EmboMiX 平台激活的服务配额及有效期。
            </p>
          </div>

          <div style={{ padding: '4px 24px' }}>
            {/* 当前套餐 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                borderBottom: '1px solid #f1f5f9',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>当前套餐</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>享有的仿真并发、算法训练及设备连接权益</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#0f172a',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    padding: '4px 12px',
                    borderRadius: 6,
                  }}
                >
                  {subscription?.plan?.name || subscription?.plan?.code || 'Free 免费套餐'}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: '#15803d',
                    background: '#dcfce7',
                    padding: '2px 8px',
                    borderRadius: 9999,
                  }}
                >
                  {subscription?.status === 'ACTIVE' ? '生效中' : subscription?.status || '生效中'}
                </span>
              </div>
            </div>

            {/* 生效开始时间 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                borderBottom: '1px solid #f1f5f9',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>生效开始时间</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>本期订阅起始核算周期</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
                {formatDate(subscription?.startedAt)}
              </div>
            </div>

            {/* 到期时间 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 0',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>到期时间</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>当前订阅有效期终止时间</div>
              </div>
              <div>
                {subscription?.endedAt ? (
                  <span style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
                    {formatDate(subscription.endedAt)}
                  </span>
                ) : (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#475569',
                      background: '#f1f5f9',
                      padding: '3px 10px',
                      borderRadius: 4,
                    }}
                  >
                    长期有效
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* 弹窗 1: 修改密码 Modal */}
      {/* --------------------------------------------------------------------- */}
      {showPasswordModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="passwordModalTitle"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePasswordModal();
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '20px 24px 16px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <h3 id="passwordModalTitle" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                修改密码
              </h3>
              <button
                type="button"
                onClick={closePasswordModal}
                disabled={isSubmittingPwd}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: isSubmittingPwd ? 'not-allowed' : 'pointer',
                  color: '#94a3b8',
                  padding: 4,
                  display: 'flex',
                  borderRadius: 4,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitPassword}>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10, background: '#f8fafc', padding: '8px 12px', borderRadius: 6 }}>
                    安全验证码将发送至绑定手机：
                    <strong style={{ color: '#0f172a' }}> {maskPhoneNumber(user?.phoneNumber)}</strong>
                  </div>

                  <label
                    htmlFor="pwdCodeInput"
                    style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#0f172a', marginBottom: 6 }}
                  >
                    短信验证码 <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="pwdCodeInput"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={pwdCode}
                      onChange={(e) => setPwdCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6 位数字验证码"
                      style={{
                        flex: 1,
                        padding: '9px 12px',
                        fontSize: 14,
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        outline: 'none',
                        letterSpacing: '0.1em',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSendPasswordCode}
                      disabled={pwdCountdown > 0 || isSendingPwdCode}
                      style={{
                        padding: '9px 16px',
                        fontSize: 13,
                        fontWeight: 500,
                        color: pwdCountdown > 0 ? '#94a3b8' : '#0f172a',
                        background: pwdCountdown > 0 ? '#f1f5f9' : '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        cursor: pwdCountdown > 0 || isSendingPwdCode ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isSendingPwdCode ? '发送中...' : pwdCountdown > 0 ? `${pwdCountdown}s 后重发` : '获取验证码'}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="newPasswordInput"
                    style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#0f172a', marginBottom: 6 }}
                  >
                    新密码 <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    id="newPasswordInput"
                    type="password"
                    maxLength={128}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="8–128 位字符"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      fontSize: 14,
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirmPasswordInput"
                    style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#0f172a', marginBottom: 6 }}
                  >
                    确认新密码 <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    id="confirmPasswordInput"
                    type="password"
                    maxLength={128}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入新密码"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      fontSize: 14,
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      outline: 'none',
                    }}
                  />
                </div>

                {pwdError && (
                  <div style={{ fontSize: 13, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6 }}>
                    {pwdError}
                  </div>
                )}

                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                  提示：密码修改成功后，当前设备仍将保持登录，其他设备上的会话将立即撤销以保障安全。
                </div>
              </div>

              <div
                style={{
                  padding: '14px 24px',
                  background: '#f8fafc',
                  borderTop: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={closePasswordModal}
                  disabled={isSubmittingPwd}
                  style={{
                    padding: '8px 18px',
                    fontSize: 13,
                    color: '#475569',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    cursor: isSubmittingPwd ? 'not-allowed' : 'pointer',
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPwd}
                  style={{
                    padding: '8px 20px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#ffffff',
                    background: isSubmittingPwd ? '#94a3b8' : '#0f172a',
                    border: 'none',
                    borderRadius: 6,
                    cursor: isSubmittingPwd ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmittingPwd ? '提交中...' : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* 弹窗 2: 更换手机号 Modal (分步流程) */}
      {/* --------------------------------------------------------------------- */}
      {showPhoneModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="phoneModalTitle"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePhoneModal();
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
            }}
          >
            {/* Modal 顶部 Header 与分步进度指示 */}
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 id="phoneModalTitle" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                  更换手机号
                </h3>
                <button
                  type="button"
                  onClick={closePhoneModal}
                  disabled={isSubmittingPhone || isVerifyingPwd}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: isSubmittingPhone || isVerifyingPwd ? 'not-allowed' : 'pointer',
                    color: '#94a3b8',
                    padding: 4,
                    display: 'flex',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Stepper 指示条 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: '#0f172a',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    1
                  </div>
                  <span style={{ fontSize: 12, fontWeight: phoneStep === 1 ? 600 : 400, color: phoneStep === 1 ? '#0f172a' : '#64748b' }}>
                    验证当前密码
                  </span>
                </div>
                <div style={{ flex: 1, height: 1, background: phoneStep === 2 ? '#0f172a' : '#e2e8f0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: phoneStep === 2 ? '#0f172a' : '#f1f5f9',
                      color: phoneStep === 2 ? '#ffffff' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    2
                  </div>
                  <span style={{ fontSize: 12, fontWeight: phoneStep === 2 ? 600 : 400, color: phoneStep === 2 ? '#0f172a' : '#64748b' }}>
                    绑定新手机号
                  </span>
                </div>
              </div>
            </div>

            {phoneStep === 1 ? (
              <form onSubmit={handleVerifyPassword}>
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, background: '#f8fafc', padding: '10px 14px', borderRadius: 6 }}>
                    为确保账户安全，更换手机号前请先输入当前账户的登录密码完成身份验证。
                  </div>

                  <div>
                    <label
                      htmlFor="currentPasswordInput"
                      style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#0f172a', marginBottom: 6 }}
                    >
                      当前账户密码 <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      id="currentPasswordInput"
                      type="password"
                      maxLength={128}
                      value={verifyPasswordVal}
                      onChange={(e) => setVerifyPasswordVal(e.target.value)}
                      placeholder="请输入当前登录密码"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        fontSize: 14,
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        outline: 'none',
                      }}
                      autoFocus
                    />
                  </div>

                  {phoneError && (
                    <div style={{ fontSize: 13, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6 }}>
                      {phoneError}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: '14px 24px',
                    background: '#f8fafc',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={closePhoneModal}
                    disabled={isVerifyingPwd}
                    style={{
                      padding: '8px 18px',
                      fontSize: 13,
                      color: '#475569',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      cursor: isVerifyingPwd ? 'not-allowed' : 'pointer',
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifyingPwd}
                    style={{
                      padding: '8px 20px',
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#ffffff',
                      background: isVerifyingPwd ? '#94a3b8' : '#0f172a',
                      border: 'none',
                      borderRadius: 6,
                      cursor: isVerifyingPwd ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isVerifyingPwd ? '验证中...' : '下一步'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmPhoneChange}>
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* 新手机号码 */}
                  <div>
                    <label
                      htmlFor="newPhoneInput"
                      style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#0f172a', marginBottom: 6 }}
                    >
                      新手机号码 <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span
                        style={{
                          padding: '9px 12px',
                          fontSize: 14,
                          color: '#475569',
                          background: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          borderRight: 'none',
                          borderRadius: '6px 0 0 6px',
                        }}
                      >
                        +86
                      </span>
                      <input
                        id="newPhoneInput"
                        type="tel"
                        maxLength={11}
                        value={newPhoneNumber}
                        onChange={(e) => setNewPhoneNumber(e.target.value.replace(/\D/g, ''))}
                        placeholder="11 位大陆手机号码"
                        style={{
                          flex: 1,
                          padding: '9px 12px',
                          fontSize: 14,
                          border: '1px solid #cbd5e1',
                          borderRadius: '0 6px 6px 0',
                          outline: 'none',
                        }}
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* 验证码 */}
                  <div>
                    <label
                      htmlFor="phoneChangeCodeInput"
                      style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#0f172a', marginBottom: 6 }}
                    >
                      新手机短信验证码 <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        id="phoneChangeCodeInput"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={phoneCode}
                        onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="6 位数字验证码"
                        style={{
                          flex: 1,
                          padding: '9px 12px',
                          fontSize: 14,
                          border: '1px solid #cbd5e1',
                          borderRadius: 6,
                          outline: 'none',
                          letterSpacing: '0.1em',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleSendNewPhoneCode}
                        disabled={phoneCountdown > 0 || isSendingPhoneCode}
                        style={{
                          padding: '9px 16px',
                          fontSize: 13,
                          fontWeight: 500,
                          color: phoneCountdown > 0 ? '#94a3b8' : '#0f172a',
                          background: phoneCountdown > 0 ? '#f1f5f9' : '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 6,
                          cursor: phoneCountdown > 0 || isSendingPhoneCode ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isSendingPhoneCode
                          ? '发送中...'
                          : phoneCountdown > 0
                          ? `${phoneCountdown}s 后重发`
                          : '获取验证码'}
                      </button>
                    </div>
                  </div>

                  {phoneError && (
                    <div style={{ fontSize: 13, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6 }}>
                      {phoneError}
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                    提示：更换成功后，原手机号将不再关联此账户，其他设备上的会话将安全注销。
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 24px',
                    background: '#f8fafc',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPhoneStep(1);
                      setPhoneError(null);
                    }}
                    disabled={isSubmittingPhone}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      fontSize: 13,
                      cursor: isSubmittingPhone ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ← 返回上一步
                  </button>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={closePhoneModal}
                      disabled={isSubmittingPhone}
                      style={{
                        padding: '8px 18px',
                        fontSize: 13,
                        color: '#475569',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        cursor: isSubmittingPhone ? 'not-allowed' : 'pointer',
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingPhone}
                      style={{
                        padding: '8px 20px',
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#ffffff',
                        background: isSubmittingPhone ? '#94a3b8' : '#0f172a',
                        border: 'none',
                        borderRadius: 6,
                        cursor: isSubmittingPhone ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isSubmittingPhone ? '确认更换中...' : '确认更换'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* 弹窗 3: 下线确认对话框 */}
      {/* --------------------------------------------------------------------- */}
      {confirmDialog && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDialog(null);
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 420,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              padding: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                  flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                {confirmDialog.type === 'others' ? '退出其他所有设备' : '退出指定设备'}
              </h3>
            </div>

            <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5, margin: '0 0 22px 0' }}>
              {confirmDialog.type === 'others'
                ? '确定要强制退出除当前设备外的所有活跃登录会话吗？其他设备上的未保存工作可能会中断。'
                : `确定要强制下线设备「${confirmDialog.deviceInfo || '未知设备'}」吗？该设备将需要重新登录。`}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                style={{
                  padding: '8px 18px',
                  fontSize: 13,
                  color: '#475569',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmDialog.type === 'others') {
                    handleRevokeOthers();
                  } else if (confirmDialog.sessionId) {
                    handleRevokeSingle(confirmDialog.sessionId);
                  }
                }}
                style={{
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                确定下线
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
