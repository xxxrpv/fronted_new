/**
 * 通用 URDF 数据结构与运动学类型定义
 * 独立于具体机器人模型，支持任意标准 URDF XML
 */

export interface UrdfVector3 {
  x: number;
  y: number;
  z: number;
}

export interface UrdfRotationRPY {
  r: number; // roll (围绕 X 轴)
  p: number; // pitch (围绕 Y 轴)
  y: number; // yaw (围绕 Z 轴)
}

export interface UrdfOrigin {
  xyz: UrdfVector3;
  rpy: UrdfRotationRPY;
}

export type UrdfGeometryType = 'mesh' | 'box' | 'cylinder' | 'sphere';

export interface UrdfGeometry {
  type: UrdfGeometryType;
  filename?: string;
  scale?: UrdfVector3;
  size?: UrdfVector3;
  radius?: number;
  length?: number;
}

export interface UrdfMaterial {
  name: string;
  color?: [number, number, number, number]; // [r, g, b, a]
}

export interface UrdfVisual {
  name?: string;
  origin: UrdfOrigin;
  geometry: UrdfGeometry;
  material?: UrdfMaterial;
}

export type UrdfJointType =
  | 'revolute'
  | 'continuous'
  | 'prismatic'
  | 'fixed'
  | 'floating'
  | 'planar';

export interface UrdfJointLimit {
  lower: number;
  upper: number;
  effort?: number;
  velocity?: number;
}

export interface UrdfJoint {
  name: string;
  type: UrdfJointType;
  parent: string;
  child: string;
  origin: UrdfOrigin;
  axis: UrdfVector3;
  limit: UrdfJointLimit;
}

export interface UrdfLink {
  name: string;
  visuals: UrdfVisual[];
}

export interface UrdfRobot {
  name: string;
  materials: Map<string, UrdfMaterial>;
  links: Map<string, UrdfLink>;
  joints: Map<string, UrdfJoint>;
  rootLinkName: string;
  /** 每个 Link 作为 parent 的所有子 Joint */
  childJoints: Map<string, UrdfJoint[]>;
  /** 每个 Link 作为 child 的父 Joint (除 root 外有且仅有一个) */
  parentJoint: Map<string, UrdfJoint>;
}

export interface JointState {
  name: string;
  type: UrdfJointType;
  value: number; // 弧度 (revolute/continuous) 或 米 (prismatic)
  lower: number;
  upper: number;
  axis: UrdfVector3;
  parentLink: string;
  childLink: string;
}
