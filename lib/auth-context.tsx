'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getCurrentUser,
  logout as apiLogout,
  type CurrentUser,
  type CurrentSubscription,
  type CurrentAccountResponse,
} from './api';
import { normalizeAuthError, type NormalizedAuthError } from './auth-errors';
import { clearUserStoredConversation, revokeUserConversations } from './embodex/conversation-storage';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  subscription: CurrentSubscription | null;
  error: NormalizedAuthError | null;
  refreshUser: () => Promise<CurrentAccountResponse | null>;
  logout: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, checkSession = true }: { children: React.ReactNode; checkSession?: boolean }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [subscription, setSubscription] = useState<CurrentSubscription | null>(null);
  const [error, setError] = useState<NormalizedAuthError | null>(null);

  const userRef = useRef<CurrentUser | null>(null);
  const authRequest = useRef(0);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const refreshUser = useCallback(async (): Promise<CurrentAccountResponse | null> => {
    const request = ++authRequest.current;
    try {
      const res = await getCurrentUser({
        headers: {
          'Cache-Control': 'no-store',
        },
      });

      if (request !== authRequest.current) return null;
      if (res.data) {
        if (userRef.current?.id && userRef.current.id !== res.data.user.id) {
          revokeUserConversations(userRef.current.id);
          clearUserStoredConversation(userRef.current.id);
        }
        userRef.current = res.data.user;
        setUser(res.data.user);
        setSubscription(res.data.subscription);
        setStatus('authenticated');
        setError(null);
        return res.data;
      }

      // 处理未认证 401 响应
      const httpStatus = res.response?.status;
      if (httpStatus === 401) {
        const currentUserId = userRef.current?.id;
        if (currentUserId) { revokeUserConversations(currentUserId); clearUserStoredConversation(currentUserId); }
        userRef.current = null;
        setUser(null);
        setSubscription(null);
        setStatus('unauthenticated');
        setError(null);
        return null;
      }

      // 其他服务端错误不误判为登出
      const normErr = normalizeAuthError(res.error, httpStatus);
      setError(normErr);
      setStatus('error');
      return null;
    } catch (err: unknown) {
      if (request !== authRequest.current) return null;
      // 网络错误或其它未捕获异常
      const normErr = normalizeAuthError(err);
      setError(normErr);
      setStatus('error');
      return null;
    }
  }, []);

  const handleLogout = useCallback(async (): Promise<boolean> => {
    const request = ++authRequest.current;
    try {
      const res = await apiLogout();
      if (request !== authRequest.current) return false;
      const httpStatus = res.response?.status;

      // 204 或无 error 视为幂等注销成功
      if (httpStatus === 401 || httpStatus === 204 || (!res.error && httpStatus && httpStatus < 400)) {
        const currentUserId = userRef.current?.id;
        if (currentUserId) { revokeUserConversations(currentUserId); clearUserStoredConversation(currentUserId); }
        userRef.current = null;
        setUser(null);
        setSubscription(null);
        setStatus('unauthenticated');
        setError(null);
        return true;
      }

      // 失败时不得假装服务端 Session 已撤销
      const normErr = normalizeAuthError(res.error, httpStatus);
      setError(normErr);
      return false;
    } catch (err: unknown) {
      if (request !== authRequest.current) return false;
      const normErr = normalizeAuthError(err);
      setError(normErr);
      return false;
    }
  }, []);

  useEffect(() => {
    if (checkSession) refreshUser();
  }, [refreshUser, checkSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      subscription,
      error,
      refreshUser,
      logout: handleLogout,
    }),
    [status, user, subscription, error, refreshUser, handleLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
