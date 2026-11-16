"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main style={{ padding: 48 }}>
      <h1>工作空间暂时无法显示</h1>
      <p>已保存的样例保留在当前浏览器。请重新载入。</p>
      <button onClick={reset}>重试</button>
      <a href="/v8">返回工作空间</a>
    </main>
  );
}
