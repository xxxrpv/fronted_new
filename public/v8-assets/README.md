# Embodex V8 运行素材

当前模板使用 `go2-high-fidelity`、`inspection-reference`、`mobile-reference`。对应的许可证、署名、来源摘要和衍生说明保留在同目录，不适用统一的原创/CC0 声明。完整来源与使用位置见 [素材说明](../../docs/ASSETS.md)。

`quadruped`、`compact`、`tripod`、`conveyor` 四组 GLB/SVG 由 `scripts/generate-v8-assets.mjs` 生成，属于 CC0-1.0 结构示意资产，保留用于示例概念及旧项目兼容。

GLB 保留组件层级、材质及拆解元数据。拆解使用真实节点变换，可还原；它不等同于制造 BOM 或工程验证。

Q4/C2 保存支持的相机组参数后，会导出与保存参数对应的配置 GLB。旋转、拆解及报告内临时调整不覆盖来源模型或历史文件。

这些素材用于本地前端预览，不是已经由真实 Agent/SolidWorks 生成、验证或部署的结果。启动项目不需要重新生成素材。
