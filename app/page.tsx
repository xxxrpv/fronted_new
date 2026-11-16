import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="home-container" style={{ width: '100%', overflowX: 'hidden' }}>
      <div className="landing-page home-landing-second-page">
        {/* 顶部公告条 */}
        <div className="landing-announcement">
          <Link href="/projects" className="announcement-link">
            <span>EmboMiX v1.0 现已支持 SO-101 机械臂及非标自动化设备自动化评测</span>
            <span className="announcement-action">
              立即体验
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </Link>
        </div>

        {/* Hero 核心区域: 左文案/按钮、中光晕黑三角、右三行特性 */}
        <section className="landing-hero" aria-labelledby="landing-hero-heading">
          {/* 左侧文字与按钮 */}
          <div className="hero-left">
            {/* 上方浅灰色小标题 */}
            <div className="hero-left-eyebrow">
              EMBODIED AI INFRASTRUCTURE
            </div>

            <h1
              id="landing-hero-heading"
              className="landing-hero-title"
            >
              <span>具身智能</span>
              <span>基础设施</span>
            </h1>

            <div className="hero-cta-group">
              <Link href="/projects" className="btn-hero-primary">
                开始构建
              </Link>
              <Link href="/resources" className="btn-hero-secondary">
                探索资源
              </Link>
            </div>
          </div>

          {/* 中间发光光晕与标志性黑色三棱镜/三角 */}
          <div className="hero-center" aria-hidden="true">
            <div className="hero-glow-halo" style={{ transform: 'scale(0.95)' }} />
            <div className="hero-triangle-symbol" style={{ transform: 'scale(0.95)' }}>
              <svg width="170" height="150" viewBox="0 0 170 150" fill="none">
                <polygon points="85,8 165,145 5,145" fill="#000000" />
              </svg>
            </div>
          </div>

          {/* 右侧三行标语 */}
          <div className="hero-right">
            <p className="hero-feature-line">
              面向机器人与智能模型
            </p>
            <p className="hero-feature-line hero-feature-line-muted">
              构建 · 仿真 · 训练 · 评估
            </p>
            <p className="hero-feature-line hero-feature-line-muted">
              连接具身智能研发的关键环节
            </p>
          </div>
        </section>
      </div>

    </div>
  );
}
