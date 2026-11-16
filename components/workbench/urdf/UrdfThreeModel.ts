/**
 * 通用 Three.js URDF 渲染与三维交互控制器
 * - 纯通用架构：根据解析出的 Link/Joint 树状层次动态构建 Three.js Object3D 拓扑
 * - 结合 STLLoader 加载高精度 STL 几何源
 * - 挂载工业任务配件 (热像、RGB、边缘计算、保护框、外罩等)
 * - 动态投影三维空间尺寸标注 (728 mm, 486 mm, 324 mm)
 * - 动态锚定三维浮动零件标签 (热像模块、RGB 模块、边缘计算)
 * - 支持传感器视场 (FOV Cone)、通用装配爆炸图拆解与射线拾取高亮
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { UrdfOrigin, UrdfRobot, UrdfVector3, UrdfVisual } from './types';
import { UrdfKinematicsController } from './UrdfKinematicsController';

export interface PartSelectedInfo {
  linkName: string;
  partName: string;
  category?: string;
  meshFile?: string;
  jointName?: string;
  jointType?: string;
  jointLimits?: { lower: number; upper: number };
  jointAxis?: UrdfVector3;
  dimensions?: { x: number; y: number; z: number };
  materialName?: string;
  materialColor?: string;
  description?: string;
}

export interface ModelLoadProgress {
  total: number;
  loaded: number;
  percent: number;
  currentFile: string;
}

export interface DimensionLineProjection {
  id: 'length' | 'width' | 'height';
  label: string;
  value: number;
  color: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  labelX: number;
  labelY: number;
  visible: boolean;
}

export interface PinnedLabelProjection {
  id: string;
  title: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface ExplodeUnitConfig {
  unitId: string;
  linkName: string;
  parentLink: string;
  category: string;
  stage: 1 | 2;
  offset: THREE.Vector3;
}

export interface ExplodeUnitDiagnostic {
  unitId: string;
  linkName: string;
  parentLink: string;
  category: string;
  stage: 1 | 2;
  initialWorldPosition: { x: number; y: number; z: number };
  explodeOffset: { x: number; y: number; z: number };
  finalWorldPosition: { x: number; y: number; z: number };
}

export class UrdfThreeModel {
  public rootGroup: THREE.Group;
  public robot: UrdfRobot;
  public kinematics: UrdfKinematicsController;

  private linkGroups: Map<string, THREE.Group> = new Map();
  private jointAnchors: Map<string, THREE.Group> = new Map();
  private jointPivots: Map<string, THREE.Group> = new Map();
  private initialWorldPositions: Map<string, THREE.Vector3> = new Map();
  private explodeConfigs: Map<string, ExplodeUnitConfig> = new Map();

  private meshes: THREE.Mesh[] = [];
  private selectedMesh: THREE.Mesh | null = null;
  private originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();

  // 任务附件与传感器标记锚点
  private attachmentAnchors: Map<string, THREE.Object3D> = new Map();
  private sensorGroup: THREE.Group = new THREE.Group();

  private stlLoader = new STLLoader();
  private meshBaseUrl: string;
  private onSelectCallback?: (info: PartSelectedInfo | null) => void;
  private explodeFactor = 0;

  constructor(
    robot: UrdfRobot,
    kinematics: UrdfKinematicsController,
    meshBaseUrl = '/models/a1/',
    onSelect?: (info: PartSelectedInfo | null) => void,
  ) {
    this.robot = robot;
    this.kinematics = kinematics;
    this.meshBaseUrl = meshBaseUrl.endsWith('/') ? meshBaseUrl : `${meshBaseUrl}/`;
    this.onSelectCallback = onSelect;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = `robot_${robot.name}`;

    // 适配 ROS URDF (Z-up) 到 Three.js (Y-up)，单一本初坐标转换
    this.rootGroup.rotation.x = -Math.PI / 2;
    // 站立姿态下四足最低点在 URDF 中为 -0.2762m，抬升 0.2762m 保证四足精确平稳站立在地面 (Y=0)
    this.rootGroup.position.y = 0.2762;

    this.buildHierarchy();
    this.bindKinematics();
    this.initExplodeConfigs();
    this.buildSensorCones();
    this.captureInitialWorldPositions();
  }

  private applyOrigin(obj: THREE.Object3D, origin: UrdfOrigin) {
    obj.position.set(origin.xyz.x, origin.xyz.y, origin.xyz.z);
    obj.rotation.set(origin.rpy.r, origin.rpy.p, origin.rpy.y, 'XYZ');
  }

  private initExplodeConfigs() {
    this.explodeConfigs.clear();

    const configs: ExplodeUnitConfig[] = [
      // 一级拆解: 四条腿根部总成相对机身水平外扩 (URDF Z=0，保证在 Three.js 中完全水平外扩，绝无竖直起飞漂移)
      { unitId: 'unit_FR_hip', linkName: 'FR_hip', parentLink: 'trunk', category: '右前腿根部总成', stage: 1, offset: new THREE.Vector3(0.025, -0.075, 0.0) },
      { unitId: 'unit_FL_hip', linkName: 'FL_hip', parentLink: 'trunk', category: '左前腿根部总成', stage: 1, offset: new THREE.Vector3(0.025, 0.075, 0.0) },
      { unitId: 'unit_RR_hip', linkName: 'RR_hip', parentLink: 'trunk', category: '右后腿根部总成', stage: 1, offset: new THREE.Vector3(-0.025, -0.075, 0.0) },
      { unitId: 'unit_RL_hip', linkName: 'RL_hip', parentLink: 'trunk', category: '左后腿根部总成', stage: 1, offset: new THREE.Vector3(-0.025, 0.075, 0.0) },

      // 二级拆解: 大腿摆臂沿髋关节伺服电机法兰横向抽离 (URDF Y 轴)
      { unitId: 'unit_FR_thigh', linkName: 'FR_thigh', parentLink: 'FR_hip', category: '右前大腿总成', stage: 2, offset: new THREE.Vector3(0.0, -0.055, 0.0) },
      { unitId: 'unit_FL_thigh', linkName: 'FL_thigh', parentLink: 'FL_hip', category: '左前大腿总成', stage: 2, offset: new THREE.Vector3(0.0, 0.055, 0.0) },
      { unitId: 'unit_RR_thigh', linkName: 'RR_thigh', parentLink: 'RR_hip', category: '右后大腿总成', stage: 2, offset: new THREE.Vector3(0.0, -0.055, 0.0) },
      { unitId: 'unit_RL_thigh', linkName: 'RL_thigh', parentLink: 'RL_hip', category: '左后大腿总成', stage: 2, offset: new THREE.Vector3(0.0, 0.055, 0.0) },

      // 二级拆解: 小腿连杆沿膝关节转轴横向抽离 (URDF Y 轴)
      { unitId: 'unit_FR_calf', linkName: 'FR_calf', parentLink: 'FR_thigh', category: '右前小腿连杆', stage: 2, offset: new THREE.Vector3(0.0, -0.025, 0.0) },
      { unitId: 'unit_FL_calf', linkName: 'FL_calf', parentLink: 'FL_thigh', category: '左前小腿连杆', stage: 2, offset: new THREE.Vector3(0.0, 0.025, 0.0) },
      { unitId: 'unit_RR_calf', linkName: 'RR_calf', parentLink: 'RR_thigh', category: '右后小腿连杆', stage: 2, offset: new THREE.Vector3(0.0, -0.025, 0.0) },
      { unitId: 'unit_RL_calf', linkName: 'RL_calf', parentLink: 'RL_thigh', category: '左后小腿连杆', stage: 2, offset: new THREE.Vector3(0.0, 0.025, 0.0) },

      // 二级拆解: 橡胶足垫沿小腿连杆端头微抽拔出 (URDF -Z 轴)
      { unitId: 'unit_FR_foot', linkName: 'FR_foot', parentLink: 'FR_calf', category: '右前减震足端', stage: 2, offset: new THREE.Vector3(0.0, 0.0, -0.030) },
      { unitId: 'unit_FL_foot', linkName: 'FL_foot', parentLink: 'FL_calf', category: '左前减震足端', stage: 2, offset: new THREE.Vector3(0.0, 0.0, -0.030) },
      { unitId: 'unit_RR_foot', linkName: 'RR_foot', parentLink: 'RR_calf', category: '右后减震足端', stage: 2, offset: new THREE.Vector3(0.0, 0.0, -0.030) },
      { unitId: 'unit_RL_foot', linkName: 'RL_foot', parentLink: 'RL_calf', category: '左后减震足端', stage: 2, offset: new THREE.Vector3(0.0, 0.0, -0.030) },
    ];

    configs.forEach((c) => this.explodeConfigs.set(c.linkName, c));
  }

  public captureInitialWorldPositions() {
    this.rootGroup.updateMatrixWorld(true);
    this.initialWorldPositions.clear();
    this.linkGroups.forEach((group, linkName) => {
      const wp = new THREE.Vector3();
      group.getWorldPosition(wp);
      this.initialWorldPositions.set(linkName, wp);
    });
  }

  private buildHierarchy() {
    this.linkGroups.clear();
    this.jointAnchors.clear();
    this.jointPivots.clear();

    const rootLink = this.robot.links.get(this.robot.rootLinkName);
    if (!rootLink) return;

    const rootLinkGroup = new THREE.Group();
    rootLinkGroup.name = `link_${rootLink.name}`;
    this.rootGroup.add(rootLinkGroup);
    this.linkGroups.set(rootLink.name, rootLinkGroup);

    this.buildChildTree(rootLink.name, 0);
  }

  private buildChildTree(parentLinkName: string, depth: number) {
    const parentGroup = this.linkGroups.get(parentLinkName);
    if (!parentGroup) return;

    const childJoints = this.robot.childJoints.get(parentLinkName) || [];

    childJoints.forEach((joint) => {
      const jointAnchor = new THREE.Group();
      jointAnchor.name = `joint_anchor_${joint.name}`;
      this.applyOrigin(jointAnchor, joint.origin);
      parentGroup.add(jointAnchor);
      this.jointAnchors.set(joint.name, jointAnchor);

      const jointPivot = new THREE.Group();
      jointPivot.name = `joint_pivot_${joint.name}`;
      jointAnchor.add(jointPivot);
      this.jointPivots.set(joint.name, jointPivot);

      const childLink = this.robot.links.get(joint.child);
      if (childLink) {
        const childGroup = new THREE.Group();
        childGroup.name = `link_${childLink.name}`;
        jointPivot.add(childGroup);
        this.linkGroups.set(childLink.name, childGroup);

        this.buildChildTree(childLink.name, depth + 1);
      }
    });
  }

  private bindKinematics() {
    this.kinematics.onChange((jointName, value) => {
      if (jointName === '*') {
        this.robot.joints.forEach((j) => {
          if (j.type !== 'fixed') {
            this.updateJointTransform(j.name, this.kinematics.getJointValue(j.name));
          }
        });
      } else {
        this.updateJointTransform(jointName, value);
      }
    });

    this.robot.joints.forEach((j) => {
      if (j.type !== 'fixed') {
        this.updateJointTransform(j.name, this.kinematics.getJointValue(j.name));
      }
    });
  }

  private updateJointTransform(jointName: string, value: number) {
    const pivot = this.jointPivots.get(jointName);
    const joint = this.robot.joints.get(jointName);
    if (!pivot || !joint) return;

    const axis = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z).normalize();
    if (joint.type === 'revolute' || joint.type === 'continuous') {
      pivot.quaternion.setFromAxisAngle(axis, value);
    } else if (joint.type === 'prismatic') {
      pivot.position.copy(axis).multiplyScalar(value);
    }
  }

  private getReadablePartName(linkName: string): string {
    const map: Record<string, string> = {
      base: '基座坐标原点 (Base)',
      trunk: '机身主躯干总成 (Trunk)',
      imu_link: 'IMU 姿态惯导单元 (IMU Link)',
      FR_hip: '右前侧摆髋关节 (FR Hip)',
      FR_thigh_shoulder: '右前大腿法兰 (FR Thigh Shoulder)',
      FR_thigh: '右前大腿摆臂 (FR Thigh)',
      FR_calf: '右前小腿连杆 (FR Calf)',
      FR_foot: '右前减震足端 (FR Foot)',
      FL_hip: '左前侧摆髋关节 (FL Hip)',
      FL_thigh_shoulder: '左前大腿法兰 (FL Thigh Shoulder)',
      FL_thigh: '左前大腿摆臂 (FL Thigh)',
      FL_calf: '左前小腿连杆 (FL Calf)',
      FL_foot: '左前减震足端 (FL Foot)',
      RR_hip: '右后侧摆髋关节 (RR Hip)',
      RR_thigh_shoulder: '右后大腿法兰 (RR Thigh Shoulder)',
      RR_thigh: '右后大腿摆臂 (RR Thigh)',
      RR_calf: '右后小腿连杆 (RR Calf)',
      RR_foot: '右后减震足端 (RR Foot)',
      RL_hip: '左后侧摆髋关节 (RL Hip)',
      RL_thigh_shoulder: '左后大腿法兰 (RL Thigh Shoulder)',
      RL_thigh: '左后大腿摆臂 (RL Thigh)',
      RL_calf: '左后小腿连杆 (RL Calf)',
      RL_foot: '左后减震足端 (RL Foot)',
    };
    return map[linkName] || linkName;
  }

  private getPartCategory(linkName: string): string {
    if (linkName === 'trunk' || linkName === 'base' || linkName === 'imu_link') return '主躯干总成';
    if (linkName.startsWith('FR')) return '右前腿总成';
    if (linkName.startsWith('FL')) return '左前腿总成';
    if (linkName.startsWith('RR')) return '右后腿总成';
    if (linkName.startsWith('RL')) return '左后腿总成';
    return '四足总成';
  }

  private getPartDescription(linkName: string): string {
    if (linkName === 'trunk') return '一体化高强度工程机身，集成控制器、动力电池与机载传感器';
    if (linkName.endsWith('_hip')) return '准直驱无刷力控侧摆伺服关节，峰值扭矩 33.5 N·m';
    if (linkName.endsWith('_thigh')) return '高刚性航空轻量化铝合金大腿摆臂，驱动纵向大范围机动';
    if (linkName.endsWith('_calf')) return '耐磨减震四连杆小腿，吸收地面反冲力并保持稳定步态';
    if (linkName.endsWith('_foot')) return '高弹性耐磨硅胶减震足端，内置足底接触力检测传感';
    return 'Unitree A1 工业级高机动四足机器人结构部件';
  }

  /**
   * 构建 3D 传感器视场视锥 (FOV Cones)
   */
  private buildSensorCones() {
    this.sensorGroup.name = 'sensor_fov_group';
    this.sensorGroup.visible = false;
    this.rootGroup.add(this.sensorGroup);

    // 前向感知视锥 (前向青色半透明线框，挂在机身前方 +X 处)
    const coneGeo = new THREE.ConeGeometry(0.32, 0.75, 4, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x4fa8d8,
      transparent: true,
      opacity: 0.15,
      wireframe: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fovCone = new THREE.Mesh(coneGeo, coneMat);
    fovCone.rotation.z = -Math.PI / 2;
    fovCone.position.set(0.65, 0, 0.02);
    this.sensorGroup.add(fovCone);
  }

  public setSensorFovVisible(visible: boolean) {
    this.sensorGroup.visible = visible;
  }

  private registerMesh(mesh: THREE.Mesh, linkName: string) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (!mesh.userData.linkName) mesh.userData.linkName = linkName;
    if (!mesh.userData.geometryBounds && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      mesh.userData.geometryBounds = mesh.geometry.boundingBox;
    }
    this.originalMaterials.set(mesh, mesh.material);
    this.meshes.push(mesh);
  }

  public async loadMeshes(onProgress?: (progress: ModelLoadProgress) => void): Promise<void> {
    const visualTasks: { linkName: string; visual: UrdfVisual; index: number }[] = [];

    this.robot.links.forEach((link) => {
      link.visuals.forEach((visual, index) => {
        visualTasks.push({ linkName: link.name, visual, index });
      });
    });

    const total = visualTasks.length;
    let loaded = 0;

    for (const task of visualTasks) {
      const { linkName, visual, index } = task;
      const linkGroup = this.linkGroups.get(linkName);
      if (!linkGroup) continue;

      const visContainer = new THREE.Group();
      visContainer.name = `visual_${linkName}_${index}`;
      this.applyOrigin(visContainer, visual.origin);
      linkGroup.add(visContainer);

      const filename = visual.geometry.filename || '';
      if (onProgress) {
        onProgress({
          total,
          loaded,
          percent: total > 0 ? Math.round((loaded / total) * 100) : 100,
          currentFile: filename || `part_${index}`,
        });
      }

      try {
        if (visual.geometry.type === 'mesh' && filename) {
          const cleanPath = filename.replace(/^package:\/\/[^/]+\//, '');
          const fullUrl = `${this.meshBaseUrl}${cleanPath}`;
          const geometry = await this.loadStlAsync(fullUrl);

          if (visual.geometry.scale) {
            geometry.scale(visual.geometry.scale.x, visual.geometry.scale.y, visual.geometry.scale.z);
          }
          geometry.computeVertexNormals();
          geometry.computeBoundingBox();

          const material = this.createVisualMaterial(visual);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData = {
            linkName,
            partName: this.getReadablePartName(linkName),
            category: this.getPartCategory(linkName),
            meshFile: cleanPath,
            materialName: visual.material?.name || 'default',
            geometryBounds: geometry.boundingBox,
            description: this.getPartDescription(linkName),
          };

          this.registerMesh(mesh, linkName);
          visContainer.add(mesh);
        }
      } catch (err) {
        console.warn(`[UrdfThreeModel] 加载 STL 失败 (${filename}):`, err);
      }

      loaded++;
      if (onProgress) {
        onProgress({
          total,
          loaded,
          percent: total > 0 ? Math.round((loaded / total) * 100) : 100,
          currentFile: filename,
        });
      }
    }

    // 网格加载完毕后记录全量部件初始世界坐标
    this.captureInitialWorldPositions();
  }

  private loadStlAsync(url: string): Promise<THREE.BufferGeometry> {
    return new Promise((resolve, reject) => {
      this.stlLoader.load(
        url,
        (geom) => resolve(geom),
        undefined,
        (err) => reject(err),
      );
    });
  }

  private createVisualMaterial(visual: UrdfVisual): THREE.MeshStandardMaterial {
    let color: THREE.Color;
    let metalness = 0.35;
    let roughness = 0.38;

    if (visual.material?.color) {
      const [r, g, b] = visual.material.color;
      color = new THREE.Color(r, g, b);
    } else {
      const matName = visual.material?.name?.toLowerCase() || '';
      if (matName.includes('orange')) {
        color = new THREE.Color(1.0, 0.423529411765, 0.0392156862745);
      } else if (matName.includes('black')) {
        color = new THREE.Color(0.12, 0.12, 0.14);
      } else if (matName.includes('grey') || matName.includes('gray')) {
        color = new THREE.Color(0.2, 0.2, 0.2);
      } else if (matName.includes('silver')) {
        color = new THREE.Color(0.913725490196, 0.913725490196, 0.847058823529);
      } else if (matName.includes('red')) {
        color = new THREE.Color(0.8, 0.0, 0.0);
      } else {
        color = new THREE.Color(0xd0dce6);
      }
    }

    const matName = visual.material?.name?.toLowerCase() || '';
    if (matName.includes('black') || matName.includes('grey')) {
      metalness = 0.55;
      roughness = 0.35;
    } else if (matName.includes('silver')) {
      metalness = 0.8;
      roughness = 0.25;
    } else if (matName.includes('orange')) {
      metalness = 0.25;
      roughness = 0.35;
    }

    return new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      envMapIntensity: 0.9,
    });
  }

  public setExplode(factor: number) {
    this.explodeFactor = Math.max(0, Math.min(1, factor));

    // 两级分层拆解展开权重：
    // 一级拆解: 0% ~ 50% 将四腿总成整体向机身外侧水平拉开 (50% ~ 100% 保持完全拉开)
    const w1 = Math.min(1, this.explodeFactor / 0.5);
    // 二级拆解: 30% ~ 100% 逐级展开大腿、小腿、足垫内部装配构件 (0% ~ 30% 为 0)
    const w2 = Math.max(0, Math.min(1, (this.explodeFactor - 0.3) / 0.7));

    this.linkGroups.forEach((group, linkName) => {
      // 机身主躯干 trunk 与 base 作为绝对固定锚点，不参与任何平移
      if (linkName === this.robot.rootLinkName || linkName === 'trunk' || linkName === 'base') {
        group.position.set(0, 0, 0);
        return;
      }

      const cfg = this.explodeConfigs.get(linkName);
      if (!cfg) {
        group.position.set(0, 0, 0);
        return;
      }

      const weight = cfg.stage === 1 ? w1 : w2;
      group.position.set(
        cfg.offset.x * weight,
        cfg.offset.y * weight,
        cfg.offset.z * weight
      );
    });

    this.rootGroup.updateMatrixWorld(true);
  }

  public getExplode(): number {
    return this.explodeFactor;
  }

  public getExplodeDiagnostics(): ExplodeUnitDiagnostic[] {
    this.rootGroup.updateMatrixWorld(true);
    const result: ExplodeUnitDiagnostic[] = [];

    // 固定锚点 trunk
    const trunkGroup = this.linkGroups.get('trunk');
    const trunkInit = this.initialWorldPositions.get('trunk') || (trunkGroup ? trunkGroup.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3());
    const trunkCurr = trunkGroup ? trunkGroup.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    result.push({
      unitId: 'unit_trunk',
      linkName: 'trunk',
      parentLink: 'base',
      category: '机身主躯干总成 (固定锚点)',
      stage: 1,
      initialWorldPosition: {
        x: Math.round(trunkInit.x * 1000) / 1000,
        y: Math.round(trunkInit.y * 1000) / 1000,
        z: Math.round(trunkInit.z * 1000) / 1000,
      },
      explodeOffset: { x: 0, y: 0, z: 0 },
      finalWorldPosition: {
        x: Math.round(trunkCurr.x * 1000) / 1000,
        y: Math.round(trunkCurr.y * 1000) / 1000,
        z: Math.round(trunkCurr.z * 1000) / 1000,
      },
    });

    this.explodeConfigs.forEach((cfg, linkName) => {
      const group = this.linkGroups.get(linkName);
      if (!group) return;
      const init = this.initialWorldPositions.get(linkName) || group.getWorldPosition(new THREE.Vector3());
      const curr = group.getWorldPosition(new THREE.Vector3());
      result.push({
        unitId: cfg.unitId,
        linkName: cfg.linkName,
        parentLink: cfg.parentLink,
        category: cfg.category,
        stage: cfg.stage,
        initialWorldPosition: {
          x: Math.round(init.x * 1000) / 1000,
          y: Math.round(init.y * 1000) / 1000,
          z: Math.round(init.z * 1000) / 1000,
        },
        explodeOffset: {
          x: Math.round(cfg.offset.x * 1000) / 1000,
          y: Math.round(cfg.offset.y * 1000) / 1000,
          z: Math.round(cfg.offset.z * 1000) / 1000,
        },
        finalWorldPosition: {
          x: Math.round(curr.x * 1000) / 1000,
          y: Math.round(curr.y * 1000) / 1000,
          z: Math.round(curr.z * 1000) / 1000,
        },
      });
    });

    return result;
  }

  public raycast(raycaster: THREE.Raycaster): PartSelectedInfo | null {
    if (this.meshes.length === 0) return null;

    const intersects = raycaster.intersectObjects(this.meshes, false);
    if (intersects.length === 0) {
      this.clearSelection();
      return null;
    }

    const hit = intersects[0];
    const mesh = hit.object as THREE.Mesh;
    return this.selectMesh(mesh);
  }

  public selectLinkByName(name: string): PartSelectedInfo | null {
    const targetMesh = this.meshes.find(
      (m) => m.userData.linkName === name || m.userData.partName === name,
    );
    if (targetMesh) {
      return this.selectMesh(targetMesh);
    }
    this.clearSelection();
    return null;
  }

  private selectMesh(mesh: THREE.Mesh): PartSelectedInfo {
    this.clearSelection();
    this.selectedMesh = mesh;

    mesh.material = new THREE.MeshStandardMaterial({
      color: 0x4f9ee8,
      metalness: 0.5,
      roughness: 0.25,
      emissive: 0x225c94,
      emissiveIntensity: 0.5,
    });

    const { linkName, partName, category, meshFile, materialName, geometryBounds, description } = mesh.userData;
    const parentJoint = this.robot.parentJoint.get(linkName);

    let dimensions: { x: number; y: number; z: number } | undefined;
    if (geometryBounds) {
      const size = new THREE.Vector3();
      geometryBounds.getSize(size);
      dimensions = {
        x: Math.round(size.x * 1000 * 10) / 10,
        y: Math.round(size.y * 1000 * 10) / 10,
        z: Math.round(size.z * 1000 * 10) / 10,
      };
    }

    const info: PartSelectedInfo = {
      linkName,
      partName: partName || linkName,
      category,
      meshFile,
      jointName: parentJoint?.name,
      jointType: parentJoint?.type,
      jointLimits: parentJoint ? { lower: parentJoint.limit.lower, upper: parentJoint.limit.upper } : undefined,
      jointAxis: parentJoint?.axis,
      dimensions,
      materialName,
      materialColor: (mesh.material as THREE.MeshStandardMaterial).color?.getHexString(),
      description,
    };

    if (this.onSelectCallback) {
      this.onSelectCallback(info);
    }

    return info;
  }

  public clearSelection() {
    if (this.selectedMesh) {
      const orig = this.originalMaterials.get(this.selectedMesh);
      if (orig) {
        this.selectedMesh.material = orig;
      }
      this.selectedMesh = null;
    }
    if (this.onSelectCallback) {
      this.onSelectCallback(null);
    }
  }

  public setWireframe(enabled: boolean) {
    this.meshes.forEach((mesh) => {
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => ((m as THREE.MeshStandardMaterial).wireframe = enabled));
      } else if (mat) {
        (mat as THREE.MeshStandardMaterial).wireframe = enabled;
      }
    });
  }

  /**
   * 计算机体在屏幕上的 3D 尺寸标注线投影 (根据真实几何体包络动态计算)
   */
  public projectDimensions(
    camera: THREE.Camera,
    viewWidth: number,
    viewHeight: number,
  ): DimensionLineProjection[] {
    this.rootGroup.updateMatrixWorld(true);

    const projectPoint = (vec: THREE.Vector3) => {
      const p = vec.clone().project(camera);
      return {
        x: (p.x * 0.5 + 0.5) * viewWidth,
        y: (-0.5 * p.y + 0.5) * viewHeight,
        visible: p.z > -1 && p.z < 1,
      };
    };

    // 仅基于真实机器人物理 Mesh 计算外廓尺寸包络，排除辅助线框
    const totalBox = new THREE.Box3();
    this.meshes.forEach((m) => {
      totalBox.expandByObject(m);
    });

    const size = new THREE.Vector3();
    totalBox.getSize(size);

    const lengthMm = Math.round(size.x * 1000);
    const heightMm = Math.round(size.y * 1000);
    const widthMm = Math.round(size.z * 1000);

    // 1. 长度标注线 (沿 X 方向，在地面靠外侧 +Z 处，红褐色)
    const pLengthA = new THREE.Vector3(totalBox.max.x, 0.005, totalBox.max.z + 0.08);
    const pLengthB = new THREE.Vector3(totalBox.min.x, 0.005, totalBox.max.z + 0.08);

    // 2. 宽度标注线 (沿 Z 方向，在地面靠外侧 -X 处，墨绿色)
    const pWidthA = new THREE.Vector3(totalBox.min.x - 0.08, 0.005, totalBox.max.z);
    const pWidthB = new THREE.Vector3(totalBox.min.x - 0.08, 0.005, totalBox.min.z);

    // 3. 高度标注线 (沿 Y 垂直方向，从地面贴至机身顶部，钢青色)
    const pHeightA = new THREE.Vector3(totalBox.min.x - 0.08, 0.005, totalBox.max.z);
    const pHeightB = new THREE.Vector3(totalBox.min.x - 0.08, totalBox.max.y, totalBox.max.z);

    const sLengthA = projectPoint(pLengthA);
    const sLengthB = projectPoint(pLengthB);

    const sWidthA = projectPoint(pWidthA);
    const sWidthB = projectPoint(pWidthB);

    const sHeightA = projectPoint(pHeightA);
    const sHeightB = projectPoint(pHeightB);

    return [
      {
        id: 'length',
        label: `${lengthMm} mm`,
        value: lengthMm,
        color: '#b07b76',
        startX: sLengthA.x,
        startY: sLengthA.y,
        endX: sLengthB.x,
        endY: sLengthB.y,
        labelX: (sLengthA.x + sLengthB.x) / 2,
        labelY: (sLengthA.y + sLengthB.y) / 2 + 16,
        visible: sLengthA.visible && sLengthB.visible,
      },
      {
        id: 'width',
        label: `${widthMm} mm`,
        value: widthMm,
        color: '#6e9b8c',
        startX: sWidthA.x,
        startY: sWidthA.y,
        endX: sWidthB.x,
        endY: sWidthB.y,
        labelX: (sWidthA.x + sWidthB.x) / 2 + 16,
        labelY: (sWidthA.y + sWidthB.y) / 2,
        visible: sWidthA.visible && sWidthB.visible,
      },
      {
        id: 'height',
        label: `${heightMm} mm`,
        value: heightMm,
        color: '#7195bb',
        startX: sHeightA.x,
        startY: sHeightA.y,
        endX: sHeightB.x,
        endY: sHeightB.y,
        labelX: (sHeightA.x + sHeightB.x) / 2 + 18,
        labelY: (sHeightA.y + sHeightB.y) / 2,
        visible: sHeightA.visible && sHeightB.visible,
      },
    ];
  }

  /**
   * 计算机体关键部件在屏幕上的 3D 锚定浮动标签 (错落排列防止重叠)
   */
  public projectPinnedLabels(
    camera: THREE.Camera,
    viewWidth: number,
    viewHeight: number,
  ): PinnedLabelProjection[] {
    const labels: PinnedLabelProjection[] = [];

    const projectLink = (id: string, title: string, yOffset = -24) => {
      const obj = this.linkGroups.get(id);
      if (!obj) return;
      obj.updateWorldMatrix(true, false);
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      const p = worldPos.project(camera);
      if (p.z > -1 && p.z < 1) {
        labels.push({
          id,
          title,
          x: (p.x * 0.5 + 0.5) * viewWidth,
          y: (-0.5 * p.y + 0.5) * viewHeight + yOffset,
          visible: true,
        });
      }
    };

    projectLink('trunk', '主躯干 (Trunk)', -32);
    projectLink('FR_hip', '右前髋关节 (FR Hip)', 26);
    projectLink('RR_hip', '右后髋关节 (RR Hip)', -22);

    return labels;
  }

  public getEndEffectorWorldPosition(): THREE.Vector3 {
    const leafGroup = this.linkGroups.get('FR_foot') || this.rootGroup;
    const pos = new THREE.Vector3();
    leafGroup.getWorldPosition(pos);
    return pos;
  }

  public dispose() {
    this.meshes.forEach((mesh) => {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material?.dispose();
      }
    });
    this.meshes = [];
    this.originalMaterials.clear();
  }
}
