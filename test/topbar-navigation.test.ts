import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

describe('10. 顶部全局导航栏模块切换下拉菜单规格与路由逻辑测试', () => {
  function computeTopbarState(pathname: string, projectName?: string | null) {
    const topbarTitle = projectName
      ? projectName
      : pathname.startsWith('/workspace')
        ? '工作空间'
        : pathname.startsWith('/resources')
          ? '资源中心'
          : '项目管理';

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

    const bottomItem = {
      href: '/',
      label: '首页',
    };

    return { topbarTitle, topbarNavItems, bottomItem };
  }

  test('在 /projects 页面：默认顶栏标题为“项目管理”，下拉菜单首项激活', () => {
    const state = computeTopbarState('/projects');
    assert.equal(state.topbarTitle, '项目管理');
    assert.equal(state.topbarNavItems[0].label, '项目管理');
    assert.equal(state.topbarNavItems[0].href, '/projects');
    assert.equal(state.topbarNavItems[0].active, true);
    assert.equal(state.topbarNavItems[1].active, false);
    assert.equal(state.topbarNavItems[2].active, false);
    assert.equal(state.bottomItem.label, '首页');
    assert.equal(state.bottomItem.href, '/');
  });

  test('在 /workspace 页面：默认顶栏标题为“工作空间”，第二项激活', () => {
    const state = computeTopbarState('/workspace');
    assert.equal(state.topbarTitle, '工作空间');
    assert.equal(state.topbarNavItems[1].label, '工作空间');
    assert.equal(state.topbarNavItems[1].href, '/workspace');
    assert.equal(state.topbarNavItems[1].active, true);
    assert.equal(state.topbarNavItems[0].active, false);
  });

  test('在 /resources 页面：默认顶栏标题为“资源中心”，第三项激活', () => {
    const state = computeTopbarState('/resources');
    assert.equal(state.topbarTitle, '资源中心');
    assert.equal(state.topbarNavItems[2].label, '资源中心');
    assert.equal(state.topbarNavItems[2].href, '/resources');
    assert.equal(state.topbarNavItems[2].active, true);
    assert.equal(state.topbarNavItems[0].active, false);
  });

  test('在具体项目详情页时：展示项目名，下拉仍支持切换四大模块且底部为首页', () => {
    const state = computeTopbarState('/projects/p-101', '双臂巡检机器人');
    assert.equal(state.topbarTitle, '双臂巡检机器人');
    assert.equal(state.topbarNavItems[0].active, true);
    assert.equal(state.bottomItem.label, '首页');
    assert.equal(state.bottomItem.href, '/');
  });
});
