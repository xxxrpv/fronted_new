/**
 * EmbodiX 平台本地演示数据集中维护源
 *
 * 说明：
 * 1. 本文件为 Task-003 前端展示专用固定 fixture。
 * 2. 所有数据仅供静态演示，未连接真实后端 API、数据库、认证系统或 Linkor。
 * 3. 本文件中的字段和结构不构成正式 API Contract 承诺。
 */

export interface ResourceItem {
  id: string;
  name: string;
  type: 'Robot' | 'Algorithm';
  version: string;
  sourceModule: string;
  description: string;
  tags: string[];
  metadata: Record<string, string>;
  relatedProjectIds: string[];
  updatedAt: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  status: string;
  robotIds: string[];
  algorithmIds: string[];
  stats: {
    scenarios: number;
    collectedData: string;
    targetSuccessRate: string;
  };
  highlights: string;
  activityLog: {
    id: string;
    date: string;
    action: string;
    operator: string;
  }[];
}

export interface OverviewStats {
  totalProjects: number;
  totalRobots: number;
  totalAlgorithms: number;
  totalValidations: number;
  platformVersion: string;
  lastUpdated: string;
}

export const DEMO_RESOURCES: ResourceItem[] = [
  {
    id: 'res-robot-g1',
    name: 'Unitree G1 仿人双足机器人',
    type: 'Robot',
    version: 'v1.2.0',
    sourceModule: 'embodix-robotics-core',
    description: '23 自由度全尺寸仿人双足本体，配备高功率密度力控关节伺服与双手 7 自由度触觉灵巧手，适配室内平整与复杂地形行走及全身协调控制。',
    tags: ['双足仿人', '高自由度', 'ROS2', '力控伺服'],
    metadata: {
      '机构形态': '全尺寸仿人双足机器人',
      '全身自由度 (DOF)': '23 自由度 (腿部 12 + 腰部 1 + 双臂 10) + 双手 14 自由度',
      '单臂末端有效负载': '3.0 kg (全行程有效工作空间)',
      '传感器配置': '双目深度视觉、头部 3D LiDAR、足底六维压力阵列、全身 IMU',
      '控制总线接口': 'EtherCAT / CAN-FD 高速低延迟总线',
      '操作系统支持': 'Ubuntu 22.04 LTS (PREEMPT_RT 实时内核) + ROS2 Humble',
      '供电与续航': '48V 15Ah 锂动力电池包，标准工况连续运行 2.0 小时',
    },
    relatedProjectIds: ['proj-humanoid-navigation', 'proj-openvla-benchmark'],
    updatedAt: '2026-09-08',
  },
  {
    id: 'res-robot-aloha',
    name: 'Mobile ALOHA 双臂移动协作平台',
    type: 'Robot',
    version: 'v2.1.0',
    sourceModule: 'embodix-robotics-core',
    description: '基于全向轮式移动底盘与双 ViperX 300 协作臂的移动操作机器人，支持全身遥操作示教与高精度双臂桌面协同操作。',
    tags: ['双臂协作', '全向移动', '遥操作', '桌面试验'],
    metadata: {
      '机构形态': '全向轮移动底盘 + 双 6-DOF 协作机械臂',
      '全身自由度 (DOF)': '移动底盘 3-DOF + 双臂 12-DOF + 双平行夹爪 2-DOF',
      '单臂末端有效负载': '1.5 kg (全伸展范围 750g)',
      '视觉相机配置': '4 路高清 RealSense 相机 (双腕部 + 顶部全局俯视 + 底盘前视)',
      '采样刷新率': '视觉流 30 FPS / 关节绝对编码器 50 Hz 同步采样',
      '控制总线接口': 'USB 3.0 工业集线器 + 独立 CAN 控制器',
      '操作系统支持': 'Ubuntu 22.04 LTS + ROS2 Humble',
    },
    relatedProjectIds: ['proj-aloha-sorter', 'proj-openvla-benchmark'],
    updatedAt: '2026-09-09',
  },
  {
    id: 'res-robot-ur5e',
    name: 'Universal Robots UR5e 协作机械臂',
    type: 'Robot',
    version: 'v1.0.4',
    sourceModule: 'embodix-robotics-core',
    description: '工业级 6 自由度协作机械臂，出厂内置高精度末端六维力/力矩传感器，专用于精密装配、工件表面轮廓跟踪及力位混合控制实验。',
    tags: ['工业协作臂', '六维力控', '高精度', '接触富集'],
    metadata: {
      '机构形态': '6 自由度串联协作工业臂',
      '全身自由度 (DOF)': '6 旋转关节 (全关节 ±360° 连续旋转)',
      '末端负载能力': '5.0 kg',
      '重复定位精度': '±0.03 mm (ISO 9283 标准)',
      '工作半径': '850 mm',
      '力传感器规格': '集成末端 F/T 传感器 (力精度 3.5N，力矩精度 0.20Nm)',
      '控制总线接口': 'TCP/IP RTDE 实时数据交换协议 (500 Hz 刷新率)',
    },
    relatedProjectIds: ['proj-ur5e-assembly'],
    updatedAt: '2026-09-05',
  },
  {
    id: 'res-algo-act',
    name: 'ACT (Action Chunking with Transformers)',
    type: 'Algorithm',
    version: 'v1.3.2',
    sourceModule: 'embodix-algo-zoo',
    description: '基于条件变分自编码器 (CVAE) 与 Transformer 架构的端到端模仿学习算法，引入动作分块机制预测连续轨迹段，显著抑制复合误差与动作抖动。',
    tags: ['模仿学习', 'Transformers', '动作分块', '端到端控制'],
    metadata: {
      '算法骨干': 'Conditional VAE + Encoder-Decoder Transformer',
      '输入模态': '多视角 RGB 图像 (3×224×224) + 关节位置反馈 (14维)',
      '动作输出格式': '未来关节目标角轨迹序列 (Chunk Size = 50 步，50Hz 周期更新)',
      '推理延迟': '14.2 ms (NVIDIA GeForce RTX 4090 / TensorRT FP16)',
      '训练数据依赖': 'ALOHA 遥操作示教轨迹集 (推荐 50 组以上成功专家轨迹)',
      '运行环境依赖': 'PyTorch 2.3+, HuggingFace Transformers, CUDA 12.1',
    },
    relatedProjectIds: ['proj-aloha-sorter'],
    updatedAt: '2026-09-07',
  },
  {
    id: 'res-algo-diffusion-policy',
    name: 'Diffusion Policy 具身扩散操作策略',
    type: 'Algorithm',
    version: 'v2.0.0',
    sourceModule: 'embodix-algo-zoo',
    description: '将机械臂操作技能建模为条件去噪扩散生成过程，天然支持多模态动作分布建模与力位混合约束，具备出色的抗外部扰动恢复能力。',
    tags: ['扩散模型', '多模态策略', '力控交互', '高鲁棒性'],
    metadata: {
      '算法骨干': 'DDPM / DDIM 去噪扩散概率模型 + 1D 降采样时间卷积 (Temporal CNN)',
      '输入模态': 'RGB-D 深度视觉点云特征 + 末端六维接触力时序 + 历史关节轨迹',
      '动作输出格式': '未来 16 步空间末端力位速度混合控制指令',
      '推理延迟': '22.8 ms (DDIM 16 步快速去噪采样，RTX 4090)',
      '训练数据依赖': '包含扰动接触与失败恢复标签的多模态操作示范库',
      '运行环境依赖': 'PyTorch 2.4+, Diffusers, Linkor-Adapter-Bridge',
    },
    relatedProjectIds: ['proj-ur5e-assembly'],
    updatedAt: '2026-09-08',
  },
  {
    id: 'res-algo-openvla',
    name: 'OpenVLA 具身视觉语言动作大模型',
    type: 'Algorithm',
    version: 'v1.0.1',
    sourceModule: 'embodix-algo-zoo',
    description: '7B 参数开源通用视觉-语言-动作 (VLA) 基础模型，无缝理解自然语言任务指令与复杂视觉观测，直接自回归生成机器人末端动作 Token。',
    tags: ['VLA基础模型', '自然语言引导', '跨机型泛化', 'Zero-shot'],
    metadata: {
      '算法骨干': 'Llama-2 7B 语言骨干 + SigLIP 视觉感知编码器 + 离散动作量化器',
      '输入模态': '自由形式自然语言 Prompt + 单目/双目当前视觉帧 (384×384)',
      '动作输出格式': '7-DOF 末端笛卡尔位姿变化量 + 夹爪离散状态 Token',
      '推理延迟': '85 ms (bfloat16 精度，NVIDIA A100 80GB)',
      '训练基准': 'Open X-Embodiment 包含 22 种不同机型的跨实体具身通用数据集',
      '运行环境依赖': 'PyTorch 2.3+, FlashAttention-2, vLLM-Engine',
    },
    relatedProjectIds: ['proj-humanoid-navigation', 'proj-openvla-benchmark'],
    updatedAt: '2026-09-10',
  },
];

export const DEMO_PROJECTS: ProjectItem[] = [
  {
    id: 'proj-embodix-01',
    name: '双臂协作装配机械臂控制系统',
    description: '具身智能通用协同与评测平台基线工程，评测双臂协作避障抓取轨迹规划算法在动态障碍物扰动场景下的成功率与稳定性。',
    updatedAt: '2026-09-11',
    status: '进行中',
    robotIds: ['res-robot-aloha', 'res-robot-ur5e'],
    algorithmIds: ['res-algo-act', 'res-algo-diffusion-policy'],
    stats: {
      scenarios: 5,
      collectedData: '210 GB',
      targetSuccessRate: '96%',
    },
    highlights: '已完成 500 轮动态障碍扰动协同仿真评测，轨迹误差保持在 0.42mm 以内，逆运动学求解收敛耗时 3ms。',
    activityLog: [
      { id: 'act-e1', date: '2026-09-11 01:20', action: '启动双臂抓取轨迹规划仿真任务，评测在障碍物动态扰动下的避障成功率', operator: 'Auto-Runner' },
      { id: 'act-e2', date: '2026-09-10 18:00', action: '接入深色调交互式 Studio 仿真视口与实时遥测探针', operator: 'Studio-Agent' },
    ],
  },
  {
    id: 'proj-aloha-sorter',
    name: 'Mobile ALOHA 桌面精密分拣与收纳项目',
    description: '验证 Mobile ALOHA 双臂移动系统在多类杂乱文具与工具摆放场景下，通过 ACT 算法实现高鲁棒性识别抓取、分类堆叠与抽屉拉开收纳全流程。',
    updatedAt: '2026-09-10',
    status: '进行中',
    robotIds: ['res-robot-aloha'],
    algorithmIds: ['res-algo-act'],
    stats: {
      scenarios: 4,
      collectedData: '128 GB',
      targetSuccessRate: '95%',
    },
    highlights: '已完成 200 组桌面物体分拣闭环真机评测，复杂遮挡场景抓取成功率达 93.5%，平均单循环收纳耗时 12.4 秒。',
    activityLog: [
      { id: 'act-1', date: '2026-09-10 16:40', action: '执行第 4 批次闭环桌面收纳真机自动化评测', operator: 'Auto-Runner' },
      { id: 'act-2', date: '2026-09-09 11:20', action: '关联算法 ACT 升级至 v1.3.2 (动作平滑度优化)', operator: 'Algorithm-Team' },
      { id: 'act-3', date: '2026-09-07 14:15', action: '导入真实示教数据集 aloha_desk_sorted_v2 (128GB)', operator: 'Data-Curator' },
      { id: 'act-4', date: '2026-09-05 09:30', action: '初始化项目基线与评测场景定义', operator: 'Admin' },
    ],
  },
  {
    id: 'proj-humanoid-navigation',
    name: 'Unitree G1 室内多模态导航与避障验证',
    description: '在典型实验室长廊与堆叠杂物混合环境中，系统评测 Unitree G1 仿人双足机器人在自然语言指令引导下的自主路径规划、步态平衡保持与动态避障。',
    updatedAt: '2026-09-09',
    status: '进行中',
    robotIds: ['res-robot-g1'],
    algorithmIds: ['res-algo-openvla'],
    stats: {
      scenarios: 6,
      collectedData: '340 GB',
      targetSuccessRate: '90%',
    },
    highlights: '已完成 18 组复杂障碍路段长距离双足行走测试，面对行人突然穿行等突变环境跌倒率低于 1.8%。',
    activityLog: [
      { id: 'act-5', date: '2026-09-09 17:05', action: '完成长廊动态障碍物穿越评测 30 轮验证', operator: 'Nav-Group' },
      { id: 'act-6', date: '2026-09-08 15:30', action: '配置 Unitree G1 步态控制器实时安全阻尼参数', operator: 'Robot-Core' },
      { id: 'act-7', date: '2026-09-06 10:00', action: '接入 OpenVLA 具身视觉大模型语言指令解析器', operator: 'Algorithm-Team' },
    ],
  },
  {
    id: 'proj-ur5e-assembly',
    name: 'UR5e 柔性装配与力控插拔评测',
    description: '依托 UR5e 协作臂集成末端高频六维力矩传感器，评估 Diffusion Policy 算法在面对毫米级公差装配销孔时的自适应搜索、对中与精密接触力控表现。',
    updatedAt: '2026-09-08',
    status: '已完成评测',
    robotIds: ['res-robot-ur5e'],
    algorithmIds: ['res-algo-diffusion-policy'],
    stats: {
      scenarios: 3,
      collectedData: '85 GB',
      targetSuccessRate: '98%',
    },
    highlights: '成功验证 0.05mm 间隙销轴精密装配，最大接触冲击力被稳定限制在 8.0N 安全阈值以内，零结构磨损。',
    activityLog: [
      { id: 'act-8', date: '2026-09-08 18:20', action: '生成柔性力控装配专项评测基线汇总报告', operator: 'QA-Lead' },
      { id: 'act-9', date: '2026-09-07 14:00', action: '完成极限公差 0.05mm 轴孔插拔 500 次耐久评测', operator: 'Auto-Runner' },
      { id: 'act-10', date: '2026-09-04 09:10', action: '配置六维力传感器高频滤波采样与安全急停链路', operator: 'HW-Engineer' },
    ],
  },
  {
    id: 'proj-openvla-benchmark',
    name: '具身 VLA 大模型跨实体泛化评测平台',
    description: '构建跨 Mobile ALOHA 轮臂移动平台与 Unitree G1 仿人双足机器人的跨机型统一评测基准，全面验证通用基础动作模型在异构动力学与异构感知配置下的泛化能力。',
    updatedAt: '2026-09-06',
    status: '设计中',
    robotIds: ['res-robot-aloha', 'res-robot-g1'],
    algorithmIds: ['res-algo-openvla'],
    stats: {
      scenarios: 8,
      collectedData: '512 GB',
      targetSuccessRate: '88%',
    },
    highlights: '已完成统一动作空间映射定义协议与跨机型传感器时间戳对齐标准，初步支持同一自然语言任务在多机型间的并行派发。',
    activityLog: [
      { id: 'act-11', date: '2026-09-06 16:10', action: '发布跨机型统一动作映射协议 v0.1-Draft', operator: 'Arch-Team' },
      { id: 'act-12', date: '2026-09-03 11:45', action: '导入多机型泛化测试基准任务集 (50 组跨域指令)', operator: 'Bench-Group' },
    ],
  },
];

export const DEMO_OVERVIEW_STATS: OverviewStats = {
  totalProjects: 5,
  totalRobots: 3,
  totalAlgorithms: 3,
  totalValidations: 12,
  platformVersion: 'v1.0.0',
  lastUpdated: '2026-09-11',
};

// 工具函数
export function getProjects(): ProjectItem[] {
  return DEMO_PROJECTS;
}

export function getProjectById(id: string): ProjectItem | undefined {
  return DEMO_PROJECTS.find((p) => p.id === id);
}

export function getResources(): ResourceItem[] {
  return DEMO_RESOURCES;
}

export function getResourceById(id: string): ResourceItem | undefined {
  return DEMO_RESOURCES.find((r) => r.id === id);
}

export function getResourcesByIds(ids: string[]): ResourceItem[] {
  return DEMO_RESOURCES.filter((r) => ids.includes(r.id));
}

export function getProjectsByIds(ids: string[]): ProjectItem[] {
  return DEMO_PROJECTS.filter((p) => ids.includes(p.id));
}

export function getOverviewStats(): OverviewStats {
  return DEMO_OVERVIEW_STATS;
}
