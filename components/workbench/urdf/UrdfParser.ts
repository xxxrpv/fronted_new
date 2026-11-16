/**
 * 通用 URDF 解析器
 * 解析 URDF XML 文本为结构化的机器人连杆/关节树
 */

import {
  UrdfGeometry,
  UrdfJoint,
  UrdfJointLimit,
  UrdfJointType,
  UrdfLink,
  UrdfMaterial,
  UrdfOrigin,
  UrdfRobot,
  UrdfRotationRPY,
  UrdfVector3,
  UrdfVisual,
} from './types';

function parseFloats(str: string | null | undefined, count: number, fallback = 0): number[] {
  if (!str) return Array(count).fill(fallback);
  const parts = str.trim().split(/\s+/).map(Number);
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(Number.isFinite(parts[i]) ? parts[i] : fallback);
  }
  return result;
}

function parseVector3(str: string | null | undefined, fallback: UrdfVector3 = { x: 0, y: 0, z: 0 }): UrdfVector3 {
  const [x, y, z] = parseFloats(str, 3, 0);
  return { x, y, z };
}

function parseRPY(str: string | null | undefined): UrdfRotationRPY {
  const [r, p, y] = parseFloats(str, 3, 0);
  return { r, p, y };
}

function parseOrigin(el: Element | null): UrdfOrigin {
  if (!el) {
    return {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    };
  }
  return {
    xyz: parseVector3(el.getAttribute('xyz')),
    rpy: parseRPY(el.getAttribute('rpy')),
  };
}

function findDirectChildren(parent: Element, tagName: string): Element[] {
  const list: Element[] = [];
  const lowerTag = tagName.toLowerCase();
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.tagName.toLowerCase() === lowerTag) {
      list.push(child);
    }
  }
  if (list.length === 0) {
    try {
      const scopeList = parent.querySelectorAll(`:scope > ${tagName}`);
      if (scopeList.length > 0) return Array.from(scopeList);
    } catch {
      // ignore selector errors
    }
  }
  return list;
}

function findDirectChild(parent: Element, tagName: string): Element | null {
  const lowerTag = tagName.toLowerCase();
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.tagName.toLowerCase() === lowerTag) {
      return child;
    }
  }
  try {
    return parent.querySelector(`:scope > ${tagName}`);
  } catch {
    return null;
  }
}

export function parseUrdfXml(xmlText: string): UrdfRobot {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`URDF XML 解析错误: ${parseError.textContent}`);
  }

  const robotEl = doc.querySelector('robot');
  if (!robotEl) {
    throw new Error('无效的 URDF 文件: 未找到 <robot> 根节点');
  }

  const robotName = robotEl.getAttribute('name') || 'unnamed_robot';
  const materials = new Map<string, UrdfMaterial>();
  const links = new Map<string, UrdfLink>();
  const joints = new Map<string, UrdfJoint>();

  // 1. 解析全局材质 <robot><material>
  findDirectChildren(robotEl, 'material').forEach((matEl) => {
    const name = matEl.getAttribute('name');
    if (!name) return;
    const colorEl = findDirectChild(matEl, 'color') || matEl.querySelector('color');
    let color: [number, number, number, number] | undefined;
    if (colorEl) {
      const rgba = parseFloats(colorEl.getAttribute('rgba'), 4, 1);
      color = [rgba[0], rgba[1], rgba[2], rgba[3]];
    }
    materials.set(name, { name, color });
  });

  // 2. 解析连杆 <robot><link>
  findDirectChildren(robotEl, 'link').forEach((linkEl) => {
    const name = linkEl.getAttribute('name');
    if (!name) return;

    const visuals: UrdfVisual[] = [];
    findDirectChildren(linkEl, 'visual').forEach((visEl) => {
      const origin = parseOrigin(findDirectChild(visEl, 'origin') || visEl.querySelector('origin'));
      const geomEl = findDirectChild(visEl, 'geometry') || visEl.querySelector('geometry');
      if (!geomEl) return;

      let geometry: UrdfGeometry = { type: 'box', size: { x: 0.1, y: 0.1, z: 0.1 } };

      const meshEl = findDirectChild(geomEl, 'mesh') || geomEl.querySelector('mesh');
      const boxEl = findDirectChild(geomEl, 'box') || geomEl.querySelector('box');
      const cylinderEl = findDirectChild(geomEl, 'cylinder') || geomEl.querySelector('cylinder');
      const sphereEl = findDirectChild(geomEl, 'sphere') || geomEl.querySelector('sphere');

      if (meshEl) {
        const filename = meshEl.getAttribute('filename') || '';
        const scaleStr = meshEl.getAttribute('scale');
        const scale = scaleStr ? parseVector3(scaleStr, { x: 1, y: 1, z: 1 }) : { x: 1, y: 1, z: 1 };
        geometry = { type: 'mesh', filename, scale };
      } else if (boxEl) {
        const sizeStr = boxEl.getAttribute('size');
        geometry = { type: 'box', size: parseVector3(sizeStr, { x: 0.1, y: 0.1, z: 0.1 }) };
      } else if (cylinderEl) {
        const radius = Number(cylinderEl.getAttribute('radius')) || 0.05;
        const length = Number(cylinderEl.getAttribute('length')) || 0.1;
        geometry = { type: 'cylinder', radius, length };
      } else if (sphereEl) {
        const radius = Number(sphereEl.getAttribute('radius')) || 0.05;
        geometry = { type: 'sphere', radius };
      }

      // 材质信息
      let material: UrdfMaterial | undefined;
      const matEl = findDirectChild(visEl, 'material') || visEl.querySelector('material');
      if (matEl) {
        const matName = matEl.getAttribute('name') || '';
        const colorEl = findDirectChild(matEl, 'color') || matEl.querySelector('color');
        let color: [number, number, number, number] | undefined;
        if (colorEl) {
          const rgba = parseFloats(colorEl.getAttribute('rgba'), 4, 1);
          color = [rgba[0], rgba[1], rgba[2], rgba[3]];
        } else if (matName && materials.has(matName)) {
          color = materials.get(matName)!.color;
        }
        material = { name: matName, color };
      }

      visuals.push({
        origin,
        geometry,
        material,
      });
    });

    links.set(name, {
      name,
      visuals,
    });
  });

  // 3. 解析关节 <robot><joint>
  const childLinkNames = new Set<string>();

  findDirectChildren(robotEl, 'joint').forEach((jointEl) => {
    const name = jointEl.getAttribute('name');
    const type = (jointEl.getAttribute('type') || 'fixed') as UrdfJointType;
    const parentEl = findDirectChild(jointEl, 'parent') || jointEl.querySelector('parent');
    const childEl = findDirectChild(jointEl, 'child') || jointEl.querySelector('child');

    if (!name || !parentEl || !childEl) return;

    const parent = parentEl.getAttribute('link') || '';
    const child = childEl.getAttribute('link') || '';
    childLinkNames.add(child);

    const origin = parseOrigin(findDirectChild(jointEl, 'origin') || jointEl.querySelector('origin'));

    const axisEl = findDirectChild(jointEl, 'axis') || jointEl.querySelector('axis');
    const axis = axisEl ? parseVector3(axisEl.getAttribute('xyz'), { x: 1, y: 0, z: 0 }) : { x: 1, y: 0, z: 0 };

    const limitEl = findDirectChild(jointEl, 'limit') || jointEl.querySelector('limit');
    let limit: UrdfJointLimit = {
      lower: -Math.PI,
      upper: Math.PI,
      effort: 10,
      velocity: 10,
    };
    if (limitEl) {
      const lower = limitEl.getAttribute('lower');
      const upper = limitEl.getAttribute('upper');
      const effort = limitEl.getAttribute('effort');
      const velocity = limitEl.getAttribute('velocity');
      limit = {
        lower: lower !== null ? Number(lower) : -Math.PI,
        upper: upper !== null ? Number(upper) : Math.PI,
        effort: effort !== null ? Number(effort) : 10,
        velocity: velocity !== null ? Number(velocity) : 10,
      };
    } else if (type === 'continuous') {
      limit = { lower: -Infinity, upper: Infinity };
    }

    joints.set(name, {
      name,
      type,
      parent,
      child,
      origin,
      axis,
      limit,
    });
  });

  // 4. 构建树形依赖与寻找 Root Link
  const childJoints = new Map<string, UrdfJoint[]>();
  const parentJoint = new Map<string, UrdfJoint>();

  joints.forEach((joint) => {
    if (!childJoints.has(joint.parent)) {
      childJoints.set(joint.parent, []);
    }
    childJoints.get(joint.parent)!.push(joint);
    parentJoint.set(joint.child, joint);
  });

  // root link 即所有 link 中从未作为 child 出现的 link
  let rootLinkName = '';
  for (const linkName of links.keys()) {
    if (!childLinkNames.has(linkName)) {
      rootLinkName = linkName;
      break;
    }
  }

  // 兜底：若没有找到或存在孤立节点，默认取第一个 link
  if (!rootLinkName && links.size > 0) {
    rootLinkName = links.keys().next().value || '';
  }

  return {
    name: robotName,
    materials,
    links,
    joints,
    rootLinkName,
    childJoints,
    parentJoint,
  };
}
