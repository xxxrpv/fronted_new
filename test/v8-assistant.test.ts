import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  executeViewerCommand,
  planViewerCommand,
} from "../lib/v8/assistant-commands";
import type {
  ModelViewerController,
  ViewerCommandReceipt,
} from "../components/v8/ModelViewer";
function fixture() {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const record = (name: string, value?: unknown): ViewerCommandReceipt => {
    calls.push({ name, value });
    return { ok: true, message: `executed ${name}` };
  };
  const controller: ModelViewerController = {
    assetUrl: "/v8-assets/inspection-reference.glb",
    getParts: () => [
      { id: "camera", label: "巡检相机总成", offsetMax: 0.05 },
      { id: "FL", label: "左前腿 · 概念结构" },
      { id: "FR", label: "右前腿 · 概念结构" },
    ],
    setMode: (mode) => record("mode", mode),
    setSeparation: (level) => record("separation", level),
    focusPart: (q) => record("focus", q),
    resetView: () => record("reset"),
    setView: (view) => record("view", view),
    zoom: (factor) => record("zoom", factor),
    setPartOffset: (part, delta) =>
      Math.abs(delta[1]) > 0.05
        ? { ok: false, message: "超出真实开放范围。" }
        : record("offset", { part, delta }),
  };
  const send = (text: string) => {
    const plan = planViewerCommand(text);
    return plan.kind === "command"
      ? executeViewerCommand(controller, plan.command)
      : { ok: false, message: plan.message };
  };
  return { controller, calls, send };
}
describe("预览助手明确工具与安全边界", () => {
  test("百分比转换真实控制单位，不伪造新任务", () => {
    const f = fixture();
    f.send("拆解到 70%");
    assert.deepEqual(f.calls, [{ name: "separation", value: 0.7 }]);
  });
  test("超出拆解范围与未知拓扑修改不调用模型工具", () => {
    const f = fixture();
    assert.equal(f.send("拆解到 110%").ok, false);
    assert.equal(f.send("把机器人重新生成一条腿").ok, false);
    assert.equal(f.send("还原整机并生成CAD").ok, false);
    assert.equal(f.send("将巡检相机总成高度偏移设为25毫米").ok, false);
    assert.equal(f.calls.length, 0);
  });
  test("单位换算为米，精确指向声明支持的源部件", () => {
    const f = fixture();
    const result = f.send("将巡检相机总成抬高25毫米");
    assert.equal(result.ok, true);
    assert.deepEqual(f.calls, [
      { name: "offset", value: { part: "camera", delta: [0, 0.025, 0] } },
    ]);
  });
  test("歧义部件与无能力的原始部件不发生位移", () => {
    const f = fixture();
    assert.equal(f.send("将前腿抬高20毫米").ok, false);
    assert.equal(f.send("将左前腿抬高20毫米").ok, false);
    assert.equal(f.calls.length, 0);
  });
  test("超出真实部件范围保留控制器拒绝结果，不声称成功", () => {
    const f = fixture();
    const result = f.send("将巡检相机总成抬高20厘米");
    assert.equal(result.ok, false);
    assert.match(result.message, /真实开放范围/);
    assert.equal(f.calls.length, 0);
  });
  test("列出部件只读取真实目录；聚焦不会调用几何生成", () => {
    const f = fixture();
    assert.match(f.send("列出部件").message, /巡检相机总成/);
    assert.equal(f.calls.length, 0);
    f.send("聚焦左前腿");
    assert.deepEqual(f.calls, [{ name: "focus", value: "FL" }]);
  });
  test("查看方式与重置均只使用当前资产控制器", () => {
    const f = fixture();
    f.send("查看感知结构");
    f.send("俯视图");
    f.send("重置视角");
    assert.deepEqual(
      f.calls.map((c) => c.name),
      ["mode", "view", "reset"],
    );
    assert.deepEqual(f.calls[1].value, "top");
  });
});
