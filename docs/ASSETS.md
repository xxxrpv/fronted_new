# 当前素材与复用边界

更新：2026-11-16。当前运行素材在 `public/`，不依赖 `output/` 或测试截图。许可证、署名和来源摘要随交付保留。

| 资源                                             | 使用位置                     | 来源与限制                                                                                                                                 |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `v8-assets/go2-high-fidelity.*`                  | Go2 模板、原始结构概念与历史 | Unitree / MuJoCo Menagerie，固定来源提交 `71f066ad0be9cd271f7ed58c030243ef157af9f4`；保留 BSD-3-Clause 许可证、署名、来源记录              |
| `v8-assets/inspection-reference.*`               | Q4 模板与巡检概念            | 用户提供官网的衍生四足网格和概念附件；对应 `inspection-LICENSE.txt`、`inspection-ATTRIBUTION.md`、provenance 与 DERIVATION                 |
| `v8-assets/mobile-reference.*`                   | C2 模板与移动概念            | 用户提供的原创 AMR 概念源；对应 `mobile-source-NOTICE.txt`、署名与 provenance，不改标为第三方厂商 CAD                                      |
| `quadruped/compact/tripod/conveyor.glb` 与 SVG   | 旧项目兼容及示例概念         | 本项目生成的结构示意模型，CC0-1.0；保留历史可读性，不作为精细原厂工程模型                                                                  |
| `v8-assets/catalog/*`                            | 模板与概念网格卡片           | 从对应源模型生成的透明封面与概念图，来源见 `catalog/provenance.json`                                                                       |
| `official-*.png`                                 | 官网方案图文卡片与历史兼容   | 用户提供/生成的概念说明图；当前任务图使用当前模型示意，不能用其他案例的场景证明项目能力                                                    |
| `cinematic/industrial-arm.glb`、`mobile-amr.glb` | 登录和模块卡片实时三维演示   | 本项目程序化示例，生成脚本随源码保留；不代表已部署实机或已运行仿真                                                                         |
| `cinematic/studio_small_09_1k.hdr`               | 模型材质照明                 | Poly Haven，Sergej Majboroda，Studio Small 09，CC0；[来源](https://polyhaven.com/a/studio_small_09)，[许可](https://polyhaven.com/license) |
| `cinematic/simulation-*.webp`                    | 保留的仿真场景组件           | 生成的示意图片，不是测量或仿真结果；Simcore 当前不开放                                                                                     |
| `lib/v8/official/*`                              | HTML 七章阅读器              | 用户提供官网的文档作用域运行时和样式，来源文件摘要见 `provenance.json`；项目内容适配在 `official-report.ts`                                |

保留的 GLB 包含组件层级、材质和拆解元数据；部件详情展示实际来源节点。可视化几何一致性不等于制造公差、动力学验证或完整 BOM。

Q4/C2 保存配置时可改变明确支持的相机组位置，并导出对应 GLB。旋转、拆解与报告内临时参数查看不会覆盖源模型或历史工程文件。

启动与构建无需重新生成素材。`scripts/convert-*`、`build-go2-model.mjs`、`sync-official-report.mjs` 等是维护工具，部分需要原始官网/模型来源目录；交付包已包含运行所需产物，正常体验不要先运行这些转换脚本。

历史生成原稿、旧银色工作空间图片及未引用的旧宣传图已从活动工程清理。原始参考工程与第三方许可证不在清理范围内。
