import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('移动端适配规格与资源验证 (Mobile Responsive Spec)', () => {
  test('1. 视频素材文件与命名规范验证', () => {
    const verticalVideoPath = resolve(baseDir, 'public/White9x16.mp4');
    const oldVideoPath = resolve(baseDir, 'public/White16x9.mp4');
    const desktopVideoPath = resolve(baseDir, 'public/LoginVideo_1.mp4');
    const posterPath = resolve(baseDir, 'public/login-video-poster.png');

    assert.ok(existsSync(verticalVideoPath), '规范化命名的 9:16 竖版视频 White9x16.mp4 必须存在');
    assert.ok(!existsSync(oldVideoPath), '原有命名错误的 White16x9.mp4 必须已被重命名');
    assert.ok(existsSync(desktopVideoPath), '电脑端横版视频 LoginVideo_1.mp4 必须保留');
    assert.ok(existsSync(posterPath), '视频降级封面海报图 login-video-poster.png 必须存在');
  });

  test('2. 首页 (app/page.tsx) 移动端响应式与视频按需加载逻辑验证', () => {
    const homeCode = readFileSync(resolve(baseDir, 'app/page.tsx'), 'utf8');

    // 检查断点与视频源
    assert.ok(homeCode.includes('(max-width: 768px)'), '首页必须使用 768px 断点区分手机端与电脑端');
    assert.ok(homeCode.includes('/White9x16.mp4'), '手机端必须选定 9:16 竖版视频 /White9x16.mp4');
    assert.ok(homeCode.includes('/LoginVideo_1.mp4'), '电脑端必须选定 16:9 横版视频 /LoginVideo_1.mp4');

    // 检查非当前设备避免重复下载机制
    assert.ok(homeCode.includes('setVideoSrc'), '必须通过状态精准按需单向挂载当前设备所需视频，避免双重下载');

    // 检查无障碍与纯净白底防黑屏闪烁机制
    assert.ok(homeCode.includes('prefers-reduced-motion'), '必须尊重系统减少动态效果无障碍偏好');
    assert.ok(homeCode.includes('videoLoaded'), '必须通过首帧载入状态控制透明度，防止未解码黑屏');
    assert.ok(homeCode.includes('onError'), '必须提供视频加载异常状态捕获');
    assert.ok(homeCode.includes('playsInline'), '必须支持移动端行内播放，防止全屏抢占');
  });

  test('3. 登录页 (app/login/page.tsx) 移动端上下布局架构验证', () => {
    const loginCode = readFileSync(resolve(baseDir, 'app/login/page.tsx'), 'utf8');

    assert.ok(loginCode.includes('className="auth-page-root"'), '登录页根容器必须采用统一响应式类名');
    assert.ok(loginCode.includes('className="auth-page-container"'), '登录页主布局必须支持响应式上下分栏');
    assert.ok(loginCode.includes('className="auth-media-panel"'), '媒体面板必须解耦以便移动端设为顶部小窗');
    assert.ok(loginCode.includes('className="auth-form-panel"'), '表单面板必须解耦支持自适应撑满与自然垂直滚动');
  });

  test('4. 注册页 (app/register/page.tsx) 移动端单列自适应与防遮挡验证', () => {
    const registerCode = readFileSync(resolve(baseDir, 'app/register/page.tsx'), 'utf8');

    assert.ok(registerCode.includes('className="auth-page-root"'), '注册页根容器必须采用统一响应式类名');
    assert.ok(registerCode.includes('className="auth-grid-two-cols"'), '注册页密码与扩展信息必须使用响应式网格');
    assert.ok(registerCode.includes('className="auth-media-panel"'), '媒体面板在移动端转为顶部小窗');
  });

  test('5. 顶栏导航 (components/AppShell.tsx) 移动端入口保留、进入按钮防换行与全站抽屉验证', () => {
    const shellCode = readFileSync(resolve(baseDir, 'components/AppShell.tsx'), 'utf8');

    assert.ok(shellCode.includes('landing-mobile-menu-toggle'), '首页顶栏必须提供移动端折叠抽屉切换按钮');
    assert.ok(shellCode.includes('landing-mobile-drawer'), '首页必须提供包含产品、资源、订阅、关于我们的移动端全站导航抽屉');
    assert.ok(shellCode.includes('btn-landing-auth'), '手机端顶栏必须常驻保留登录与注册操作入口');
    assert.ok(shellCode.includes('landing-auth-text-mobile'), '移动端进入平台按钮必须解耦为简练文本，防止超长昵称撑高变形');
    assert.ok(shellCode.includes('landing-auth-text-desktop'), '桌面端进入平台保留完整用户信息展示');
  });

  test('6. 样式表 (app/globals.css) 媒体查询规则完整性与按钮防换行验证', () => {
    const cssCode = readFileSync(resolve(baseDir, 'app/globals.css'), 'utf8');

    // 移动端核心规则
    assert.ok(cssCode.includes('@media (max-width: 768px)'), '样式表必须包含 768px 移动端专用媒体查询');
    assert.ok(cssCode.includes('.auth-grid-two-cols'), '必须包含双列改单列的网格样式规则');
    assert.ok(cssCode.includes('overflow-y: auto'), '移动端认证容器必须允许自然纵向滚动，防止键盘遮挡');
    assert.ok(cssCode.includes('justify-content: flex-start'), '移动端容器必须重置为 flex-start 排列，避免 space-between 造成视频与表单间大片空白');
    assert.ok(cssCode.includes('.home-video-hero-section'), '首页首屏视频区域必须有对应的响应式规则');
    assert.ok(cssCode.includes('.landing-auth-text-mobile'), '必须包含移动端精简按钮文本显隐控制');
  });

  test('7. 首页「产品」下拉菜单 (Mega Menu) 规格与纯静态展示规则验证', () => {
    const shellCode = readFileSync(resolve(baseDir, 'components/AppShell.tsx'), 'utf8');
    const cssCode = readFileSync(resolve(baseDir, 'app/globals.css'), 'utf8');

    // 1. 顶部简介文案
    assert.ok(
      shellCode.includes('覆盖设计、仿真、训练与部署的具身智能研发平台'),
      '产品下拉菜单顶部必须展示具身智能研发平台简介文案'
    );

    // 2. 6 大功能模块完整性与文案核验
    const modules = [
      { name: 'Embodex', desc: 'AI 驱动的机器人设计与建模' },
      { name: '非标自动化', desc: '设备方案生成与 CAD 建模' },
      { name: 'Simcore', desc: '机器人仿真、训练与评测' },
      { name: '算法管理', desc: '算法资产与模型版本管理' },
      { name: 'Deplox', desc: '应用构建、发布与设备部署' },
      { name: '需求管理', desc: '研发需求定义与流程规划' },
    ];

    for (const mod of modules) {
      assert.ok(shellCode.includes(mod.name), `产品菜单必须包含模块：${mod.name}`);
      assert.ok(shellCode.includes(mod.desc), `产品菜单必须包含功能描述：${mod.desc}`);
    }

    // 3. 静态展示原则：无 Link 或 a 标签包装
    assert.ok(
      shellCode.includes('landing-product-item') && !shellCode.includes('<Link href="/projects">Embodex</Link>'),
      '模块条目必须使用普通容器静态展示，不得绑定跳转链接'
    );

    // 4. 电脑端双栏排布与手机端单列排布规则
    assert.ok(cssCode.includes('.landing-product-mega-menu'), '必须包含电脑端 Mega Menu 样式');
    assert.ok(cssCode.includes('grid-template-columns: 1fr 1fr'), '电脑端必须双列排布');
    assert.ok(cssCode.includes('.landing-mobile-accordion-wrapper'), '手机端必须包含折叠手风琴样式');
    assert.ok(cssCode.includes('.landing-mobile-product-card'), '手机端必须包含单列模块卡片展示');
  });
});
