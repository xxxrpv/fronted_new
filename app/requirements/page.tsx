"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getProject } from "../../lib/api";
import type { Project } from "../../lib/api/generated/types.gen";
import { useAuth } from "../../lib/auth-context";

/** Real-route gateway. Requirement versions are never synthesized from project metadata. */
export default function RequirementAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const auth = useAuth();
  const projectId =
    typeof params?.projectId === "string" ? params.projectId : undefined;
  const [loadedProject, setProject] = useState<Project | null>(null);
  const [loadedAccountId, setLoadedAccountId] = useState<string | undefined>();
  const project =
    loadedProject?.id === projectId && loadedAccountId === auth.user?.id
      ? loadedProject
      : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    status?: number;
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setProject(null);
    setError(null);
    if (!projectId || auth.status !== "authenticated") {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }
    setLoading(true);
    void getProject({
      path: { projectId },
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((result) => {
        if (!active) return;
        if (
          result.data &&
          result.data.id === projectId &&
          ["EMBODIED_AI", "AUTOMATION"].includes(result.data.projectType)
        ) {
          setProject(result.data);
          setLoadedAccountId(auth.user?.id);
          return;
        }
        const status = result.response?.status;
        setError({
          status,
          message:
            status === 401
              ? "会话已失效，请重新登录后继续。"
              : status === 403
                ? "当前账户没有访问这个项目的权限。"
                : status === 404
                  ? "项目不存在，或对当前账户不可见。"
                  : status && status >= 500
                    ? "项目服务暂时不可用，请稍后重试。"
                    : "未能核实项目资料与类型，请重新加载。",
        });
      })
      .catch(() => {
        if (active) setError({ message: "网络连接失败，请检查连接后重试。" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, auth.status, auth.user?.id, retry]);

  const returnPath = projectId
    ? `/projects/${encodeURIComponent(projectId)}/requirements`
    : "/requirements";
  const panelStyle = {
    background: "#fff",
    border: "1px solid #dce8f1",
    borderRadius: 16,
    padding: "clamp(22px, 4vw, 36px)",
  };
  const textStyle = { color: "#64748b", fontSize: 14, lineHeight: 1.8 };
  const linkStyle = {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 42,
    padding: "10px 16px",
    borderRadius: 8,
    textDecoration: "none",
  };

  return (
    <main
      style={{
        width: "100%",
        maxWidth: 920,
        margin: "0 auto",
        padding: "clamp(20px, 4vw, 48px)",
      }}
    >
      <nav
        aria-label="面包屑"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          fontSize: 13,
          color: "#71879a",
          marginBottom: 28,
        }}
      >
        <Link href="/projects">项目</Link>
        <span aria-hidden="true">/</span>
        <span>需求复核</span>
      </nav>
      <header style={{ marginBottom: 26 }}>
        <span style={{ fontSize: 12, color: "#2477e0", letterSpacing: 1.5 }}>
          EMBODEX · REQUIREMENTS
        </span>
        <h1
          style={{
            fontSize: "clamp(24px, 4vw, 32px)",
            color: "#11263a",
            margin: "10px 0",
          }}
        >
          需求复核
        </h1>
        <p style={textStyle}>
          从当前项目出发，核实需求的来源、版本与后续设计路径。
        </p>
      </header>

      {auth.status === "loading" || loading ? (
        <section style={panelStyle} role="status">
          <p style={textStyle}>正在核实当前会话与项目资料…</p>
        </section>
      ) : auth.status === "error" ? (
        <section style={panelStyle} role="alert">
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>认证服务暂不可用</h2>
          <p style={textStyle}>
            暂时无法核实会话，请重试。已有项目内容不会被替换为样例。
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 20 }}
            onClick={() => void auth.refreshUser()}
          >
            重试会话检查
          </button>
        </section>
      ) : auth.status === "unauthenticated" ? (
        <section style={panelStyle}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>请先登录</h2>
          <p style={textStyle}>登录后会返回当前需求页面。</p>
          <Link
            href={`/login?next=${encodeURIComponent(returnPath)}`}
            style={{
              ...linkStyle,
              color: "#fff",
              background: "#2477e0",
              marginTop: 20,
            }}
          >
            登录并继续
          </Link>
        </section>
      ) : !projectId ? (
        <section style={panelStyle}>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>先选择一个项目</h2>
          <p style={textStyle}>
            需求应归属于具体项目。请从项目列表选择已有项目，或进入 Embodex
            设计入口。
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 24,
            }}
          >
            <Link
              href="/projects"
              style={{ ...linkStyle, color: "#fff", background: "#2477e0" }}
            >
              打开项目列表
            </Link>
            <Link
              href="/design"
              style={{
                ...linkStyle,
                color: "#2477e0",
                border: "1px solid #dce8f1",
              }}
            >
              Embodex 设计入口
            </Link>
          </div>
        </section>
      ) : error ? (
        <section style={panelStyle} role="alert">
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>无法打开项目需求</h2>
          <p style={textStyle}>{error.message}</p>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 24,
            }}
          >
            {error.status === 401 ? (
              <button
                className="btn btn-primary"
                onClick={() =>
                  void auth
                    .refreshUser()
                    .then(() =>
                      router.replace(
                        `/login?next=${encodeURIComponent(returnPath)}`,
                      ),
                    )
                }
              >
                重新登录
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => setRetry((value) => value + 1)}
              >
                重新加载
              </button>
            )}
            <Link href="/projects" style={linkStyle}>
              返回项目列表
            </Link>
          </div>
        </section>
      ) : project ? (
        <>
          <section
            style={{ ...panelStyle, marginBottom: 20 }}
            aria-label="已核实的项目资料"
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "start",
                flexWrap: "wrap",
                gap: 14,
              }}
            >
              <div>
                <p style={{ ...textStyle, fontSize: 12 }}>
                  当前项目 · 平台资料
                </p>
                <h2 style={{ fontSize: 22, color: "#11263a", margin: "6px 0" }}>
                  {project.name}
                </h2>
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: "#2477e0",
                  background: "#eef5ff",
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
              >
                {project.projectType === "EMBODIED_AI"
                  ? "具身智能项目"
                  : "非标自动化项目"}
              </span>
            </div>
            {project.description && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 13, color: "#11263a", marginBottom: 6 }}>
                  项目简介
                </h3>
                <p
                  style={{
                    ...textStyle,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {project.description}
                </p>
                <small style={{ color: "#71879a" }}>
                  来自项目资料，尚不是已确认的需求版本。
                </small>
              </div>
            )}
          </section>
          <section
            style={panelStyle}
            aria-labelledby="requirements-service-status"
          >
            <span
              style={{
                display: "inline-block",
                color: "#9a660c",
                background: "#fff7e6",
                fontSize: 12,
                padding: "5px 9px",
                borderRadius: 5,
                marginBottom: 16,
              }}
            >
              需求服务待接入
            </span>
            <h2
              id="requirements-service-status"
              style={{ fontSize: 20, color: "#11263a", marginBottom: 12 }}
            >
              尚无可核实的需求版本
            </h2>
            <p style={textStyle}>
              需求保存、附件解析和版本历史服务尚未接通。当前无法可靠地保存或确认需求，请进入
              Embodex 设计入口查看接入状态，或继续当前项目已有的设计功能。
            </p>
            <p style={{ ...textStyle, marginTop: 12 }}>
              项目类型与设计路线分别管理。进入设计仍以当前项目的服务端权限和支持能力为准。
            </p>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 26,
              }}
            >
              <Link
                href={`/design/projects/${encodeURIComponent(project.id)}/requirements`}
                style={{ ...linkStyle, color: "#fff", background: "#2477e0" }}
              >
                打开 Embodex 设计入口
              </Link>
              <Link
                href={`/projects/${encodeURIComponent(project.id)}/${project.projectType === "EMBODIED_AI" ? "embodex" : "equipment"}`}
                style={{
                  ...linkStyle,
                  color: "#2477e0",
                  border: "1px solid #dce8f1",
                }}
              >
                {project.projectType === "EMBODIED_AI"
                  ? "继续现有方案设计"
                  : "打开设备方案工作区"}
              </Link>
              <Link
                href={`/projects/${encodeURIComponent(project.id)}`}
                style={{ ...linkStyle, color: "#64748b" }}
              >
                项目概览
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
