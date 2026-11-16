"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import CinematicArtwork from "./CinematicArtwork";
import {
  authenticatePreviewAccount,
  normalizePreviewPhone,
  validPreviewPhone,
  PREVIEW_SMS_CODE,
  savePreviewAccount,
  previewSmsAccount,
} from "../../lib/v8/preview-auth";

type Mode = "account" | "sms" | "register" | "reset";
export default function PreviewSignIn({
  onSignIn,
  onContinue,
}: {
  onSignIn: (account?: string) => void;
  onContinue?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("account");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [policy, setPolicy] = useState<"terms" | "privacy" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [challenge, setChallenge] = useState<{
    phone: string;
    mode: Mode;
    expires: number;
    resend: number;
  } | null>(null);
  const busyRef = useRef(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const policyRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!challenge) return;
    const update = () =>
      setCooldown(
        Math.max(0, Math.ceil((challenge.resend - Date.now()) / 1000)),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  useEffect(() => {
    if (policy) policyRef.current?.showModal();
    else policyRef.current?.close();
  }, [policy]);
  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setCode("");
    setPassword("");
    setConfirm("");
    setShowPassword(false);
    requestAnimationFrame(() => firstRef.current?.focus());
  }
  function sendCode() {
    const normalized = normalizePreviewPhone(phone);
    if (!validPreviewPhone(normalized)) {
      setError("请输入 11 位手机号。");
      firstRef.current?.focus();
      return;
    }
    if (
      challenge?.phone === normalized &&
      challenge.mode === mode &&
      cooldown > 0
    )
      return;
    setChallenge({
      phone: normalized,
      mode,
      expires: Date.now() + 300000,
      resend: Date.now() + 60000,
    });
    setError("");
    setNotice(`本地验证码：${PREVIEW_SMS_CODE}`);
  }
  function verifyCode() {
    if (
      !challenge ||
      challenge.phone !== normalizePreviewPhone(phone) ||
      challenge.mode !== mode
    )
      throw new Error("请先获取当前手机号的验证码。");
    if (challenge.expires < Date.now())
      throw new Error("验证码已过期，请重新获取。");
    if (code !== PREVIEW_SMS_CODE) throw new Error("验证码不正确。");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "account") {
        const identity = await authenticatePreviewAccount(
          localStorage,
          account,
          password,
        );
        onSignIn(identity);
      } else {
        verifyCode();
        if (mode === "sms") onSignIn(previewSmsAccount(localStorage, phone));
        else {
          if (password !== confirm) throw new Error("两次输入的密码不一致。");
          if (mode === "register" && !agreed)
            throw new Error("请先阅读并同意服务协议与隐私政策。");
          const identity = await savePreviewAccount(
            localStorage,
            {
              phone,
              ...(mode === "register"
                ? { email: email.trim(), organization: organization.trim() }
                : {}),
            },
            password,
            mode === "reset",
          );
          setChallenge(null);
          setCode("");
          if (mode === "register") onSignIn(identity);
          else {
            changeMode("account");
            setAccount(identity);
            setNotice("密码已更新，请重新登录。");
          }
        }
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "操作未完成，请重试。",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const isLogin = mode === "account" || mode === "sms";
  const passwordField = (confirmation = false) => (
    <div className="mx-password-field">
      <input
        id={confirmation ? "mx-confirm" : "mx-password"}
        name={confirmation ? "confirmPassword" : "password"}
        type={showPassword ? "text" : "password"}
        autoComplete={mode === "account" ? "current-password" : "new-password"}
        value={confirmation ? confirm : password}
        onChange={(e) => {
          if (confirmation) setConfirm(e.target.value);
          else setPassword(e.target.value);
          setError("");
        }}
        placeholder={
          confirmation
            ? "再次输入密码"
            : mode === "account"
              ? "输入密码"
              : "设置 8–128 位密码"
        }
        required
        maxLength={128}
        disabled={busy}
        aria-invalid={Boolean(error)}
      />
      {!confirmation && (
        <button
          type="button"
          aria-label={showPassword ? "隐藏密码" : "显示密码"}
          aria-pressed={showPassword}
          onClick={() => setShowPassword(!showPassword)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {showPassword && <path d="m3 3 18 18" />}
          </svg>
        </button>
      )}
    </div>
  );
  const codeCooldown =
    challenge?.phone === normalizePreviewPhone(phone) && challenge.mode === mode
      ? cooldown
      : 0;
  return (
    <div className="mx-login">
      <header className="mx-login-header">
        <a className="mx-brand" href="/v8" aria-label="EmboMiX 工作空间">
          EmboMiX
        </a>
        {onContinue ? (
          <button
            className="mx-login-resume"
            type="button"
            onClick={onContinue}
          >
            返回工作空间 <span aria-hidden="true">↗</span>
          </button>
        ) : (
          <span className="mx-preview-label">本地预览</span>
        )}
      </header>
      <main className="mx-login-main">
        <section className="mx-login-media" aria-label="机器人全流程动态演示">
          <CinematicArtwork journey priority />
        </section>
        <section
          className={`mx-login-panel ${mode === "register" ? "mx-register-panel" : ""}`}
        >
          {!isLogin && (
            <button
              className="mx-auth-back"
              type="button"
              onClick={() => changeMode("account")}
            >
              ← 返回登录
            </button>
          )}
          <h2>
            {isLogin
              ? "登录工作空间"
              : mode === "register"
                ? "创建账户"
                : "找回密码"}
          </h2>
          {isLogin && (
            <div className="mx-auth-tabs" role="tablist" aria-label="登录方式">
              <button
                type="button"
                role="tab"
                id="mx-tab-sms"
                aria-selected={mode === "sms"}
                aria-controls="mx-auth-form"
                onClick={() => changeMode("sms")}
              >
                短信登录
              </button>
              <button
                type="button"
                role="tab"
                id="mx-tab-account"
                aria-selected={mode === "account"}
                aria-controls="mx-auth-form"
                onClick={() => changeMode("account")}
              >
                密码登录
              </button>
            </div>
          )}
          <form
            id="mx-auth-form"
            className="mx-login-form"
            onSubmit={submit}
            aria-label={
              isLogin ? "登录" : mode === "register" ? "注册账户" : "找回密码"
            }
          >
            {mode === "account" ? (
              <>
                <label htmlFor="mx-account">账户</label>
                <input
                  id="mx-account"
                  ref={firstRef}
                  name="username"
                  autoComplete="username"
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setError("");
                  }}
                  placeholder="手机号、邮箱或示例账户"
                  required
                  disabled={busy}
                  aria-invalid={Boolean(error)}
                />
                <label htmlFor="mx-password">密码</label>
                {passwordField()}
              </>
            ) : (
              <>
                <label htmlFor="mx-phone">手机号码</label>
                <div className="mx-phone-field">
                  <span>+86</span>
                  <input
                    id="mx-phone"
                    ref={firstRef}
                    type="tel"
                    autoComplete="tel-national"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setCode("");
                      setNotice("");
                      setError("");
                    }}
                    placeholder="输入手机号"
                    required
                    disabled={busy}
                    maxLength={16}
                  />
                </div>
                <label htmlFor="mx-code">短信验证码</label>
                <div className="mx-code-field">
                  <input
                    id="mx-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="6 位验证码"
                    maxLength={6}
                    required
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={busy || codeCooldown > 0}
                  >
                    {codeCooldown ? `${codeCooldown}s` : "获取验证码"}
                  </button>
                </div>
                {!isLogin && (
                  <>
                    <label htmlFor="mx-password">
                      {mode === "reset" ? "新密码" : "密码"}
                    </label>
                    {passwordField()}
                    <label htmlFor="mx-confirm">确认密码</label>
                    {passwordField(true)}
                  </>
                )}
                {mode === "register" && (
                  <>
                    <details className="mx-register-extra">
                      <summary>企业与联系信息（选填）</summary>
                      <input
                        aria-label="电子邮箱"
                        type="email"
                        placeholder="电子邮箱"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      <input
                        aria-label="机构名称"
                        placeholder="企业 / 机构名称"
                        value={organization}
                        maxLength={80}
                        onChange={(e) => setOrganization(e.target.value)}
                      />
                    </details>
                    <div className="mx-agreement">
                      <input
                        id="mx-agreed"
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                      />
                      <label htmlFor="mx-agreed">我已阅读并同意</label>
                      <button type="button" onClick={() => setPolicy("terms")}>
                        服务协议
                      </button>
                      <span>与</span>
                      <button
                        type="button"
                        onClick={() => setPolicy("privacy")}
                      >
                        隐私政策
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {notice && (
              <p className="mx-auth-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p id="mx-login-error" className="mx-login-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="mx-primary mx-login-submit"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "请稍候…"
                : mode === "register"
                  ? "注册并进入"
                  : mode === "reset"
                    ? "更新密码"
                    : "进入工作空间"}
              <span aria-hidden="true">→</span>
            </button>
            <p className="mx-login-hint">
              {mode === "account" ? (
                <>
                  示例账户 <b>123</b>
                  <span>·</span>密码 <b>123</b>
                </>
              ) : (
                "本地预览 · 账户与验证码仅在当前浏览器生效"
              )}
            </p>
          </form>
          {isLogin && (
            <div className="mx-auth-links">
              <button type="button" onClick={() => changeMode("reset")}>
                忘记密码
              </button>
              <button
                type="button"
                onClick={() => changeMode("register")}
                aria-label="注册账户"
              >
                注册账户 <span>↗</span>
              </button>
            </div>
          )}
        </section>
      </main>
      <footer className="mx-login-footer">© EmboMiX</footer>
      <dialog
        ref={policyRef}
        className="mx-policy-dialog"
        onCancel={() => setPolicy(null)}
      >
        <button
          aria-label="关闭协议"
          type="button"
          onClick={() => setPolicy(null)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
        <h3>{policy === "terms" ? "预览服务说明" : "预览隐私说明"}</h3>
        <p>
          {policy === "terms"
            ? "此版本用于本地功能体验，不提供真实短信、CAD 或仿真执行服务。示例工程结果用于交互演示。"
            : "注册信息和加盐密码摘要保存在当前浏览器。手机号、邮箱、验证码不会发送到服务端；清除站点数据将删除本地账户。"}
        </p>
        <button
          className="mx-primary"
          type="button"
          onClick={() => setPolicy(null)}
        >
          已了解
        </button>
      </dialog>
    </div>
  );
}
