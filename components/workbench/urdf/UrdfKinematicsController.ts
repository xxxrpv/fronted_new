/**
 * 通用机器人正向运动学控制器
 * 完全基于 URDF 拓扑结构、关节类型与限位工作，不硬编码具体机器人
 * 包含通用预设姿态与步态发生器 (针对四足/多关节机器人)
 */

import { JointState, UrdfJoint, UrdfRobot } from './types';

export type JointChangeCallback = (jointName: string, value: number) => void;

export class UrdfKinematicsController {
  private robot: UrdfRobot;
  private jointValues: Map<string, number> = new Map();
  private listeners: Set<JointChangeCallback> = new Set();

  constructor(robot: UrdfRobot) {
    this.robot = robot;
    this.initializeDefaultValues();
  }

  /**
   * 初始化所有关节角度/位移为默认值
   * 若关节包含 calf / thigh，自适应提供四足机器狗的标准站立初姿
   */
  private initializeDefaultValues() {
    this.jointValues.clear();
    this.robot.joints.forEach((joint) => {
      if (joint.type === 'fixed') return;

      const lower = joint.limit.lower;
      const upper = joint.limit.upper;
      let initialVal = 0;

      // 针对四足腿部关节自适应站立初姿
      const name = joint.name.toLowerCase();
      if (name.includes('calf')) {
        initialVal = -1.8; // 小腿弯曲角
      } else if (name.includes('thigh')) {
        initialVal = 0.85; // 大腿前倾角
      } else if (name.includes('hip')) {
        initialVal = 0; // 髋关节侧摆角
      }

      if (Number.isFinite(lower) && Number.isFinite(upper)) {
        if (initialVal < lower || initialVal > upper) {
          initialVal = (lower + upper) / 2;
        }
      } else if (Number.isFinite(lower) && initialVal < lower) {
        initialVal = lower;
      } else if (Number.isFinite(upper) && initialVal > upper) {
        initialVal = upper;
      }

      this.jointValues.set(joint.name, initialVal);
    });
  }

  public getControllableJoints(): JointState[] {
    const list: JointState[] = [];
    this.robot.joints.forEach((joint) => {
      if (joint.type === 'fixed') return;
      list.push({
        name: joint.name,
        type: joint.type,
        value: this.jointValues.get(joint.name) ?? 0,
        lower: joint.limit.lower,
        upper: joint.limit.upper,
        axis: joint.axis,
        parentLink: joint.parent,
        childLink: joint.child,
      });
    });
    return list;
  }

  public getJointValue(jointName: string): number {
    return this.jointValues.get(jointName) ?? 0;
  }

  public setJointValue(jointName: string, value: number, notify = true): number {
    const joint = this.robot.joints.get(jointName);
    if (!joint || joint.type === 'fixed') return 0;

    let clamped = value;
    if (Number.isFinite(joint.limit.lower)) {
      clamped = Math.max(joint.limit.lower, clamped);
    }
    if (Number.isFinite(joint.limit.upper)) {
      clamped = Math.min(joint.limit.upper, clamped);
    }

    this.jointValues.set(jointName, clamped);

    if (notify) {
      this.listeners.forEach((cb) => cb(jointName, clamped));
    }

    return clamped;
  }

  public setJoints(values: Record<string, number>) {
    Object.entries(values).forEach(([name, val]) => {
      this.setJointValue(name, val, false);
    });
    this.listeners.forEach((cb) => cb('*', 0));
  }

  public resetToStand() {
    this.initializeDefaultValues();
    this.listeners.forEach((cb) => cb('*', 0));
  }

  public setPose(pose: 'stand' | 'lie' | 'crouch' | 'stretch') {
    const values: Record<string, number> = {};
    this.robot.joints.forEach((joint) => {
      if (joint.type === 'fixed') return;
      const n = joint.name.toLowerCase();
      if (pose === 'stand') {
        if (n.includes('calf')) values[joint.name] = -1.8;
        else if (n.includes('thigh')) values[joint.name] = 0.85;
        else values[joint.name] = 0;
      } else if (pose === 'lie') {
        if (n.includes('calf')) values[joint.name] = -2.6;
        else if (n.includes('thigh')) values[joint.name] = 1.9;
        else values[joint.name] = 0;
      } else if (pose === 'crouch') {
        if (n.includes('calf')) values[joint.name] = -2.3;
        else if (n.includes('thigh')) values[joint.name] = 1.35;
        else values[joint.name] = 0;
      } else if (pose === 'stretch') {
        if (n.includes('calf')) values[joint.name] = -1.1;
        else if (n.includes('thigh')) values[joint.name] = 0.4;
        else values[joint.name] = 0;
      }
    });
    this.setJoints(values);
  }

  /**
   * 对角小跑 (Trot Gait) 实时步态波形发生器
   */
  public updateTrotGait(timeSec: number, freq = 2.0) {
    const omega = 2 * Math.PI * freq;
    const phase1 = Math.sin(omega * timeSec);
    const phase2 = Math.sin(omega * timeSec + Math.PI);

    const values: Record<string, number> = {};

    this.robot.joints.forEach((joint) => {
      if (joint.type === 'fixed') return;
      const n = joint.name.toUpperCase();
      // 对角足对 1: FR (右前) 与 RL (左后)
      // 对角足对 2: FL (左前) 与 RR (右后)
      const isDiag1 = n.startsWith('FR') || n.startsWith('RL');
      const wave = isDiag1 ? phase1 : phase2;

      if (n.includes('THIGH')) {
        values[joint.name] = 0.85 + wave * 0.28;
      } else if (n.includes('CALF')) {
        values[joint.name] = -1.8 - Math.max(0, wave) * 0.45;
      } else if (n.includes('HIP')) {
        values[joint.name] = 0;
      }
    });

    this.setJoints(values);
  }

  public onChange(callback: JointChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public getAllJointValues(): Record<string, number> {
    const result: Record<string, number> = {};
    this.jointValues.forEach((val, name) => {
      result[name] = val;
    });
    return result;
  }
}
