export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  size?: string;
  path: string;
  children?: FileTreeNode[];
}

export interface RunDeclaration {
  entrypoint: string;
  runtime: string;
  framework: string;
  pythonVersion: string;
  rosDistro: string;
  memoryLimit: string;
  gpuRequirement: string;
  declaredDevices: Array<{
    role: string;
    description: string;
    required: boolean;
    defaultPath?: string;
  }>;
  subscribedTopics: string[];
  publishedTopics: string[];
}

export interface AlgorithmPackageMock {
  id: string;
  originalName: string;
  size: string;
  sha256: string;
  createdAt: string;
  status: 'UPLOADED' | 'PARSED' | 'VALIDATED';
  fileTree: FileTreeNode[];
  declaration: RunDeclaration;
}

export interface ModelAssetMock {
  id: string;
  name: string;
  format: 'TensorRT' | 'ONNX' | 'SafeTensors' | 'PyTorch';
  backbone: string;
  size: string;
  inputShape: string;
  targetChip: string;
  updatedAt: string;
}

export interface MachineTemplateMock {
  id: string;
  name: string;
  code: string;
  arch: 'arm64' | 'x86_64';
  category: '双臂协作' | '四足机器' | '轮式移动 (AGV)' | '通用边缘计算';
  recommendedRuntime: string;
  description: string;
  slots: Array<{
    role: string;
    label: string;
    required: boolean;
    sampleDevice: string;
  }>;
}

export interface RobotHostMock {
  id: string;
  name: string;
  category: 'edge' | 'autodl';
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
  ip: string;
  port: number;
  user: string;
  ctlVersion: string;
  os: string;
  arch: string;
  gpu: string;
  lastHeartbeat: string;
  probe?: {
    cpuModel: string;
    cores: number;
    memTotal: string;
    gpuModel: string;
    cudaVersion: string;
    kernel: string;
    detectedDevices: Array<{
      path: string;
      roleCandidate: string;
      deviceType: string;
      vendor: string;
    }>;
  };
}

export interface ValidationItemMock {
  id: string;
  stage: 1 | 2;
  ruleCode: string;
  title: string;
  severity: 'PASS' | 'WARNING' | 'ERROR';
  description: string;
  detail?: string;
}

export interface ReleaseMock {
  id: string;
  tag: string;
  imageRef: string;
  digest: string;
  size: string;
  buildDuration: string;
  reused: boolean;
  createdAt: string;
  packageId: string;
  robotId: string;
}

export interface DeploymentStepExecution {
  key: string;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  duration?: string;
  detail?: string;
}

export interface DeploymentTaskMock {
  id: string;
  status: 'IDLE' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SAFETY_BLOCKED' | 'CANCELLED';
  packageId: string;
  robotId: string;
  releaseId: string;
  templateId: string;
  startedAt?: string;
  steps: DeploymentStepExecution[];
  logs: string[];
  metrics: {
    cpuPercent: number;
    gpuPercent: number;
    memPercent: number;
    fps: number;
    latencyMs: number;
    temperatureC: number;
  };
}

// 预置算法包示例
export const MOCK_ALGORITHM_PACKAGES: AlgorithmPackageMock[] = [
  {
    id: 'pkg-act6-arm-dual-v2',
    originalName: 'act6_dual_arm_teleop_v2.4.zip',
    size: '142.8 MB',
    sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    createdAt: '2026-10-23 10:15:32',
    status: 'PARSED',
    declaration: {
      entrypoint: 'python3 -m teleop.dual_arm_server --config config/deploy_real.yaml',
      runtime: 'nvcr.io/nvidia/pytorch:24.03-py3-ros2',
      framework: 'PyTorch + ROS2 Humble',
      pythonVersion: '3.10.12',
      rosDistro: 'Humble Hawksbill',
      memoryLimit: '16 GB',
      gpuRequirement: 'NVIDIA CUDA >= 12.2 (显存 >= 8GB)',
      declaredDevices: [
        { role: 'arm', description: '双臂协作主从串口控制器', required: true, defaultPath: '/dev/ttyUSB0' },
        { role: 'up', description: '工作台俯视 RGB-D 深度相机', required: true, defaultPath: '/dev/video0' },
        { role: 'wrist', description: '机械臂末端腕部微距手眼相机', required: false, defaultPath: '/dev/video2' },
      ],
      subscribedTopics: ['/robot/joint_states', '/camera/top/image_raw', '/camera/wrist/image_raw'],
      publishedTopics: ['/robot/joint_commands', '/robot/gripper_action', '/teleop/status'],
    },
    fileTree: [
      {
        name: 'teleop',
        type: 'directory',
        path: '/teleop',
        children: [
          { name: '__init__.py', type: 'file', size: '128 B', path: '/teleop/__init__.py' },
          { name: 'dual_arm_server.py', type: 'file', size: '14.2 KB', path: '/teleop/dual_arm_server.py' },
          { name: 'policy_runner.py', type: 'file', size: '8.6 KB', path: '/teleop/policy_runner.py' },
          { name: 'device_io.py', type: 'file', size: '6.4 KB', path: '/teleop/device_io.py' },
        ],
      },
      {
        name: 'config',
        type: 'directory',
        path: '/config',
        children: [
          { name: 'deploy_real.yaml', type: 'file', size: '2.1 KB', path: '/config/deploy_real.yaml' },
          { name: 'hardware_mapping.yaml', type: 'file', size: '1.4 KB', path: '/config/hardware_mapping.yaml' },
        ],
      },
      {
        name: 'weights',
        type: 'directory',
        path: '/weights',
        children: [
          { name: 'act_policy_epoch120.pt', type: 'file', size: '118.5 MB', path: '/weights/act_policy_epoch120.pt' },
        ],
      },
      { name: 'deployment.yaml', type: 'file', size: '1.2 KB', path: '/deployment.yaml' },
      { name: 'requirements.txt', type: 'file', size: '640 B', path: '/requirements.txt' },
      { name: 'Dockerfile', type: 'file', size: '1.8 KB', path: '/Dockerfile' },
    ],
  },
  {
    id: 'pkg-agv-slam-nav',
    originalName: 'agv_lidar_slam_navigation_v1.zip',
    size: '88.3 MB',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    createdAt: '2026-10-22 17:40:11',
    status: 'PARSED',
    declaration: {
      entrypoint: 'ros2 launch agv_navigation bringup_robot.launch.py',
      runtime: 'osrf/ros:humble-desktop-full',
      framework: 'Nav2 + Cartographer SLAM',
      pythonVersion: '3.10.8',
      rosDistro: 'Humble',
      memoryLimit: '8 GB',
      gpuRequirement: '不强求，可纯 CPU 运行',
      declaredDevices: [
        { role: 'lidar', description: '360° 单线/多线激光雷达', required: true, defaultPath: '/dev/ttyUSB0' },
        { role: 'chassis_can', description: '底盘 CAN 通信总线控制器', required: true, defaultPath: 'can0' },
      ],
      subscribedTopics: ['/scan', '/odom', '/initialpose', '/goal_pose'],
      publishedTopics: ['/cmd_vel', '/map', '/tf'],
    },
    fileTree: [
      {
        name: 'src',
        type: 'directory',
        path: '/src',
        children: [
          { name: 'navigation_node.py', type: 'file', size: '9.8 KB', path: '/src/navigation_node.py' },
          { name: 'chassis_driver.cpp', type: 'file', size: '18.1 KB', path: '/src/chassis_driver.cpp' },
        ],
      },
      { name: 'deployment.yaml', type: 'file', size: '960 B', path: '/deployment.yaml' },
      { name: 'package.xml', type: 'file', size: '1.4 KB', path: '/package.xml' },
    ],
  },
];

// 预置模型资产
export const MOCK_MODEL_ASSETS: ModelAssetMock[] = [
  {
    id: 'asset-trt-act6-dual',
    name: 'ACT6_DualArm_Diffusion_FP16.engine',
    format: 'TensorRT',
    backbone: 'Diffusion Policy (ResNet-18 Tokenizer)',
    size: '86.4 MB',
    inputShape: '[1, 2, 3, 224, 224] + [1, 14]',
    targetChip: 'NVIDIA Jetson AGX Orin 64GB',
    updatedAt: '2026-10-22 19:20',
  },
  {
    id: 'asset-onnx-pick-place',
    name: 'Precision_Assembly_Policy_v3.onnx',
    format: 'ONNX',
    backbone: 'ACT Transformer (Action Chunking 100 steps)',
    size: '142.1 MB',
    inputShape: '[1, 3, 480, 640] + [1, 7]',
    targetChip: 'Generic CUDA / TensorRT Engine',
    updatedAt: '2026-10-21 14:05',
  },
  {
    id: 'asset-safetensors-foundation',
    name: 'embodied_vla_7b_lora_grasp.safetensors',
    format: 'SafeTensors',
    backbone: 'OpenVLA 7B LoRA fine-tuned',
    size: '420.0 MB',
    inputShape: 'Text + [1, 3, 384, 384]',
    targetChip: 'NVIDIA RTX 4090 / A100',
    updatedAt: '2026-10-20 09:30',
  },
];

// 预置机型模板
export const MOCK_MACHINE_TEMPLATES: MachineTemplateMock[] = [
  {
    id: 'tpl-act6-standard',
    name: 'ACT6 标准机型 · 双臂协作机器人',
    code: 'ACT6-Standard-v1.3',
    arch: 'arm64',
    category: '双臂协作',
    recommendedRuntime: 'JetPack 5.1.2 / CUDA 11.4 / ROS2 Humble',
    description: '适用于 6 自由度双臂协作桌面装配场景，配备手眼相机与主从机械臂硬件串口',
    slots: [
      { role: 'arm', label: '机械臂串口总线 (arm)', required: true, sampleDevice: '/dev/ttyUSB0 (FTDI UART)' },
      { role: 'up', label: '上方固定俯视相机 (up)', required: true, sampleDevice: '/dev/video0 (UVC Camera 4K)' },
      { role: 'wrist', label: '手腕末端观测相机 (wrist)', required: false, sampleDevice: '/dev/video2 (DepthCam Mini)' },
    ],
  },
  {
    id: 'tpl-agv-standard',
    name: 'AGV 轮式自主移动底盘',
    code: 'AGV-Chassis-v2.0',
    arch: 'arm64',
    category: '轮式移动 (AGV)',
    recommendedRuntime: 'Ubuntu 22.04 LTS / ROS2 Humble / CANopen',
    description: '适用于仓储搬运与室内巡检导航底盘，具备 CANopen 通讯与激光雷达直通接口',
    slots: [
      { role: 'chassis_can', label: '底盘 CAN 通信端口 (can)', required: true, sampleDevice: 'can0 (SocketCAN)' },
      { role: 'lidar', label: '主测距激光雷达 (lidar)', required: true, sampleDevice: '/dev/ttyUSB0 (USB Serial)' },
    ],
  },
  {
    id: 'tpl-quadruped-v1',
    name: '四足仿生机器狗 · 边缘载控机型',
    code: 'Quadruped-Edge-v1.0',
    arch: 'arm64',
    category: '四足机器',
    recommendedRuntime: 'JetPack 6.0 / ROS2 Iron / Realtime-Kernel',
    description: '高频低延迟足式动力学控制机型，要求 500Hz 实时内核支持',
    slots: [
      { role: 'body_imu', label: '高精度机身 IMU (imu)', required: true, sampleDevice: '/dev/i2c-1' },
      { role: 'motor_bus', label: '12 轴关节电机总线 (motor)', required: true, sampleDevice: '/dev/ttyTHS0' },
    ],
  },
  {
    id: 'tpl-jetson-generic',
    name: '通用边缘计算节点 · Jetson Orin 64GB',
    code: 'Jetson-Orin-Generic',
    arch: 'arm64',
    category: '通用边缘计算',
    recommendedRuntime: 'Ubuntu 22.04 / L4T 35.4.1 / Docker 24.0',
    description: '标准 Jetson 算力卡箱，支持多种机器人主控通过 USB/以太网即插即用接入',
    slots: [
      { role: 'camera_main', label: '主传感器视频接口', required: true, sampleDevice: '/dev/video0' },
      { role: 'comm_serial', label: '通讯控制串口', required: true, sampleDevice: '/dev/ttyUSB0' },
    ],
  },
];

// 预置机器人与主机列表
export const MOCK_ROBOT_HOSTS: RobotHostMock[] = [
  {
    id: 'robot-act6-07',
    name: 'ACT6-07 (实验室 2 号台)',
    category: 'edge',
    status: 'ONLINE',
    ip: '192.168.1.107',
    port: 22,
    user: 'deployx',
    ctlVersion: 'v1.8.4',
    os: 'Ubuntu 22.04.4 LTS',
    arch: 'aarch64',
    gpu: 'NVIDIA Orin (275 TOPS)',
    lastHeartbeat: '3 秒前',
    probe: {
      cpuModel: '12-core ARM Cortex-A78AE @ 2.2GHz',
      cores: 12,
      memTotal: '62.4 GB',
      gpuModel: 'NVIDIA Orin 2048-core Ampere GPU',
      cudaVersion: '12.2 (Driver 535.104)',
      kernel: '5.10.120-tegra (Real-time Preempt RT)',
      detectedDevices: [
        { path: '/dev/ttyUSB0', roleCandidate: 'arm', deviceType: 'FTDI USB-Serial Hub', vendor: 'Future Technology Devices' },
        { path: '/dev/video0', roleCandidate: 'up', deviceType: 'Intel RealSense D435i RGB', vendor: 'Intel Corp.' },
        { path: '/dev/video1', roleCandidate: 'up_depth', deviceType: 'Intel RealSense D435i Depth', vendor: 'Intel Corp.' },
        { path: '/dev/video2', roleCandidate: 'wrist', deviceType: 'USB Micro Eye-in-Hand Cam', vendor: 'Sony IMX335' },
      ],
    },
  },
  {
    id: 'robot-act6-03',
    name: 'ACT6-03 (工装测试台)',
    category: 'edge',
    status: 'ONLINE',
    ip: '192.168.1.103',
    port: 22,
    user: 'deployx',
    ctlVersion: 'v1.8.2',
    os: 'Ubuntu 22.04.3 LTS',
    arch: 'aarch64',
    gpu: 'NVIDIA Orin NX 16GB',
    lastHeartbeat: '10 秒前',
    probe: {
      cpuModel: '8-core ARM Cortex-A78AE',
      cores: 8,
      memTotal: '15.6 GB',
      gpuModel: 'NVIDIA Orin NX 100 TOPS',
      cudaVersion: '11.8',
      kernel: '5.10.104-tegra',
      detectedDevices: [
        { path: '/dev/ttyUSB0', roleCandidate: 'arm', deviceType: 'CP2102 USB to UART', vendor: 'Silicon Labs' },
        { path: '/dev/video0', roleCandidate: 'up', deviceType: 'Logitech Brio 4K', vendor: 'Logitech Inc.' },
      ],
    },
  },
  {
    id: 'robot-agv-01',
    name: 'AGV-Transporter-01',
    category: 'edge',
    status: 'BUSY',
    ip: '192.168.1.140',
    port: 22,
    user: 'agv_admin',
    ctlVersion: 'v1.7.9',
    os: 'Ubuntu 20.04 LTS',
    arch: 'x86_64',
    gpu: 'Intel UHD Graphics 630',
    lastHeartbeat: '12 秒前',
    probe: {
      cpuModel: 'Intel Core i7-10700TE @ 2.0GHz',
      cores: 8,
      memTotal: '31.8 GB',
      gpuModel: 'Intel Integrated',
      cudaVersion: 'None',
      kernel: '5.15.0-89-generic',
      detectedDevices: [
        { path: 'can0', roleCandidate: 'chassis_can', deviceType: 'Peak CAN-USB Adapter', vendor: 'PEAK-System' },
        { path: '/dev/ttyUSB0', roleCandidate: 'lidar', deviceType: 'Slamtec RPLIDAR S2', vendor: 'Slamtec' },
      ],
    },
  },
  {
    id: 'host-autodl-cloud-01',
    name: 'AutoDL 算力主机 · RTX 4090 (北京A区)',
    category: 'autodl',
    status: 'ONLINE',
    ip: 'connect.beijing-a.autodl.com',
    port: 39221,
    user: 'root',
    ctlVersion: 'v1.8.4',
    os: 'Ubuntu 22.04 LTS',
    arch: 'x86_64',
    gpu: 'NVIDIA GeForce RTX 4090 24GB',
    lastHeartbeat: '1 秒前',
    probe: {
      cpuModel: 'Intel Xeon Platinum 8352V @ 2.1GHz (16 vCPU)',
      cores: 16,
      memTotal: '90 GB',
      gpuModel: 'NVIDIA RTX 4090 (24GB VRAM)',
      cudaVersion: '12.4 (Driver 550.54)',
      kernel: '5.15.0-107-generic',
      detectedDevices: [],
    },
  },
];

// 预置两阶段校验项
export const MOCK_VALIDATION_ITEMS: ValidationItemMock[] = [
  {
    id: 'val-01',
    stage: 1,
    ruleCode: 'RULE-SEC-01',
    title: '静态安全与危险指令扫描',
    severity: 'PASS',
    description: '未检测到危险的破坏性系统调用（如 rm -rf /、mkfs、dd 等无限制磁盘写入）。',
  },
  {
    id: 'val-02',
    stage: 1,
    ruleCode: 'RULE-PKG-02',
    title: '算法包描述规范校验 (deployment.yaml)',
    severity: 'PASS',
    description: '已包含声明 entrypoint、所需依赖清单及运行环境变量规范。',
  },
  {
    id: 'val-03',
    stage: 1,
    ruleCode: 'RULE-DEP-03',
    title: 'Python 与 ROS2 依赖冲突分析',
    severity: 'PASS',
    description: '所有 Python 包均存在于官方 PyPI / ROS2 Humble 镜像索引，版本约束无锁死冲突。',
  },
  {
    id: 'val-04',
    stage: 1,
    ruleCode: 'RULE-RES-04',
    title: '算法包静态显存与体积预估',
    severity: 'WARNING',
    description: '模型权重 (118.5 MB) 运行时显存峰值约需 3.2 GB，建议目标机显存不少于 8 GB。',
    detail: '若在 Orin NX 8GB 运行，需注意系统其余进程显存占用，避免触发 OOM Killer。',
  },
  {
    id: 'val-05',
    stage: 2,
    ruleCode: 'RULE-HW-01',
    title: 'CPU 体系结构与指令集兼容性',
    severity: 'PASS',
    description: '目标机器人架构 (aarch64 ARMv8.2-A) 与算法包二进制目标完全一致。',
  },
  {
    id: 'val-06',
    stage: 2,
    ruleCode: 'RULE-HW-02',
    title: '硬件外设槽位映射契约核对',
    severity: 'PASS',
    description: '机械臂串口 (/dev/ttyUSB0) 与上方视场相机 (/dev/video0) 均成功与物理探针匹配。',
  },
  {
    id: 'val-07',
    stage: 2,
    ruleCode: 'RULE-RT-03',
    title: '低延迟控制循环内核要求预检',
    severity: 'PASS',
    description: '检测到 Real-time PREEMPT_RT 实时内核补丁已激活，支持 500Hz 高频控制时延。',
  },
];

// 预置构建与部署日志
export const MOCK_BUILD_LOGS = [
  '[00:00:01] 收到 Release 构建请求，目标架构: linux/arm64...',
  '[00:00:02] 分析构建指纹: pkg-hash=9f86d081884c, tpl-hash=act6-v1.3',
  '[00:00:03] 命中基础镜像层缓存: nvcr.io/nvidia/pytorch:24.03-py3-ros2 (Layer 1-8 CACHED)',
  '[00:00:05] [Step 1/5] 挂载沙箱算法包与配置...',
  '[00:00:08] [Step 2/5] 校验 Python 3.10 环境与 ROS2 Humble 节点拓扑...',
  '[00:00:12] [Step 3/5] 正在编译硬件加速算子: compiling custom_fused_attention.cu (NVCC 12.2)...',
  '[00:00:19] [Step 4/5] 导出 TensorRT FP16 优化引擎文件至 release 运行时目录...',
  '[00:00:23] [Step 5/5] 生成生产镜像: ghcr.io/embodix/robot-runtime:release-v2.4.1-act6',
  '[00:00:24] 正在计算镜像 SHA-256 签名与安全 SBOM 证明...',
  '[00:00:25] ✓ 构建完成！镜像 SHA256: 7a82c1630d892d77d7f7e91216a7f0524cb51b2e2d098e604',
];

export const MOCK_DEPLOY_LOGS = [
  '[00:00:01] [PREFLIGHT] 连接目标机器人 ACT6-07 (192.168.1.107:22 via deployx-ctl)...',
  '[00:00:02] [PREFLIGHT] 机器人状态健康，当前占用: 空闲 (无并发部署任务)',
  '[00:00:03] [PULLING] 拉取 Release 镜像: ghcr.io/embodix/robot-runtime:release-v2.4.1-act6...',
  '[00:00:06] [PULLING] 局域网高速镜像同步 (142 MB / 85 MB/s) 完成',
  '[00:00:08] [STARTING] 创建隔离容器: container-id=emb-act6-teleop-v241...',
  '[00:00:10] [DEVICE_SWITCH] 直通挂载设备端口: /dev/ttyUSB0 (arm), /dev/video0 (up), /dev/video2 (wrist)...',
  '[00:00:12] [STARTING] 启动入口进程: python3 -m teleop.dual_arm_server...',
  '[00:00:14] [ACTIVATION] 初始化 ROS2 节点 /dual_arm_teleop_node...',
  '[00:00:15] [ACTIVATION] 订阅相机流 /camera/top/image_raw (FPS: 30, 分辨率: 1920x1080)',
  '[00:00:17] [HEALTH_CHECK] 执行双臂主从心跳握手探针... 响应时延: 1.8 ms',
  '[00:00:18] [HEALTH_CHECK] 深度模型推理耗时: 6.4 ms / frame (FPS: 60 动力学闭环就绪)',
  '[00:00:19] ✓ 部署任务成功进入 SUCCEEDED 终态，真机就绪！',
];
