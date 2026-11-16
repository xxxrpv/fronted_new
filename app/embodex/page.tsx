/**
 * 保留原非项目设计地址，并通过统一入口选择旧版或新版。
 * 旧模式继续展示原页面；Hub 模式提示用户先进入项目，以满足一项目一会话。
 * 本路由不创建临时项目，不传服务 Token，也不绕过项目权限校验。
 * 具体交互由入口和对应工作区组件负责，部署切换只来自后端 env。
 */
import React from 'react';
import EmbodexSchemeDesignPage from '../../components/embodex/EmbodexEntry';

export default function Page() {
  return <EmbodexSchemeDesignPage />;
}
