import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ProjectWorkflowHeader 5阶段流水线导航栏', () => {
  const renderHeader = (props: any = {}, pathname = '/projects/p1/embodex') => {
    const filename = path.resolve(__dirname, '../components/ProjectWorkflowHeader.tsx');
    const module = { exports: {} as any };
    const componentRequire = (id: string) => {
      if (id === 'next/link') return { __esModule: true, default: (linkProps: any) => React.createElement('a', linkProps) };
      if (id === 'next/navigation') return { usePathname: () => pathname, useParams: () => ({ projectId: 'p1' }) };
      if (id === '../lib/demo-data') return { getProjectById: () => ({ name: '测试机械臂项目' }), getProjects: () => [{ id: 'proj-1', name: '双臂协作装配机械臂控制系统' }, { id: 'proj-2', name: '轮式双足机器人导航系统' }] };
      if (id === 'next/dynamic') return () => () => React.createElement('span', null, 'Badge');
      if (id === '../lib/api' || id.endsWith('/lib/api')) return { getProject: () => Promise.resolve({ data: null }), listProjects: () => Promise.resolve({ data: { items: [{ id: 'proj-1', name: '双臂协作装配机械臂控制系统' }, { id: 'proj-2', name: '轮式双足机器人导航系统' }] } }) };
      return require(id);
    };
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    new Function('require', 'module', 'exports', compiled.outputText)(componentRequire, module, module.exports);
    return {
      html: renderToStaticMarkup(React.createElement(module.exports.default, props)),
      WORKFLOW_STAGES: module.exports.WORKFLOW_STAGES,
    };
  };

  test('WORKFLOW_STAGES 配置删除需求输入，按顺序提供 5 个阶段', () => {
    const { WORKFLOW_STAGES } = renderHeader();
    assert.equal(WORKFLOW_STAGES.length, 5);
    assert.equal(WORKFLOW_STAGES[0].name, 'Embodex・方案设计');
    assert.equal(WORKFLOW_STAGES[0].key, 'embodex');
    assert.equal(WORKFLOW_STAGES[1].name, 'Lexis・自动编程');
    assert.equal(WORKFLOW_STAGES[1].key, 'coding');
    assert.equal(WORKFLOW_STAGES[2].name, 'Simcore・仿真训练');
    assert.equal(WORKFLOW_STAGES[2].key, 'simcore');
    assert.equal(WORKFLOW_STAGES[3].name, 'Embokit・算法管理');
    assert.equal(WORKFLOW_STAGES[3].key, 'algorithms');
    assert.equal(WORKFLOW_STAGES[4].name, 'Deplox・真机部署');
    assert.equal(WORKFLOW_STAGES[4].key, 'deployment');

    // 绝对不存在“需求输入”
    assert.equal(WORKFLOW_STAGES.some((s: any) => s.name.includes('需求输入')), false);
  });

  test('渲染 HTML 包含全部 5 个阶段，不含需求输入', () => {
    const { html } = renderHeader({}, '/projects/p1/embodex');
    assert.match(html, /Embodex・方案设计/);
    assert.match(html, /Lexis・自动编程/);
    assert.match(html, /Simcore・仿真训练/);
    assert.match(html, /Embokit・算法管理/);
    assert.match(html, /Deplox・真机部署/);
    assert.doesNotMatch(html, /需求输入/);
  });

  test('点击第二项 Lexis・自动编程 绑定暂未开放', () => {
    const { html } = renderHeader({}, '/projects/p1/embodex');
    // Lexis 渲染为带有暂未开放提示的交互按钮/元素
    assert.match(html, /href="#lexis"/);
    assert.match(html, /暂未开放/);
  });

  test('统一活跃标签为 ACTIVE', () => {
    const { html: simcoreHtml } = renderHeader({}, '/projects/p1/simcore');
    assert.match(simcoreHtml, /<span class="tasks2-run-tag">ACTIVE<\/span>/);
    assert.doesNotMatch(simcoreHtml, /当前页面|RUNNING|PROD/);
  });

  test('Simcore 导航栏统一显示项目名，绝不显示 Project · ID，右侧移除方案设计和 ···', () => {
    const { html } = renderHeader({}, '/projects/18e2a686-88d7-4160-a9eb-cf8059d7a4d7/simcore');
    assert.doesNotMatch(html, /Project · 18e2a686/);
    assert.match(html, /双臂协作装配机械臂控制系统/);
    // 右侧导航栏操作区移除方案设计与···
    const rightActionsMatch = html.match(/<div class="task-topbar-right"[^>]*>([\s\S]*?)<\/header>/);
    const rightHtml = rightActionsMatch ? rightActionsMatch[1] : '';
    assert.doesNotMatch(rightHtml, /方案设计/);
    assert.doesNotMatch(rightHtml, /···/);
  });

  test('Deplox 导航栏右侧移除方案设计和进入 Studio', () => {
    const { html } = renderHeader({}, '/projects/p1/deploy');
    const rightActionsMatch = html.match(/<div class="task-topbar-right"[^>]*>([\s\S]*?)<\/header>/);
    const rightHtml = rightActionsMatch ? rightActionsMatch[1] : '';
    assert.doesNotMatch(rightHtml, /方案设计/);
    assert.doesNotMatch(rightHtml, /进入 Studio/);
  });

  test('Embokit 导航栏右侧移除仿真训练', () => {
    const { html } = renderHeader({}, '/projects/p1/algorithms');
    const rightActionsMatch = html.match(/<div class="task-topbar-right"[^>]*>([\s\S]*?)<\/header>/);
    const rightHtml = rightActionsMatch ? rightActionsMatch[1] : '';
    assert.doesNotMatch(rightHtml, /仿真训练/);
  });

  test('项目选择器包含下拉菜单功能：仅展示项目名、无ID、无新建项目、非标项目跳转/equipment、底部跳转/projects', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../components/ProjectWorkflowHeader.tsx'), 'utf8');
    assert.match(src, /task-project-selector/);
    assert.match(src, /task-project-dropdown/);
    assert.match(src, /task-project-dropdown-all-btn/);
    assert.match(src, /href="\/projects"/);
    // 确保没有“新建项目”入口
    assert.doesNotMatch(src, /新建项目/);
    // 下拉列表跳转：非标项目跳转 /equipment，其他跳转详情页
    assert.match(src, /isAutomationProject/);
    assert.match(src, /\/projects\/\$\{proj\.id\}\/equipment/);
    assert.match(src, /\/projects\/\$\{proj\.id\}/);
  });
});
