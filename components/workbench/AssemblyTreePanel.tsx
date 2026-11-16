'use client';

import React from 'react';
import { UrdfRobot } from './urdf/types';
import { UrdfThreeModel } from './urdf/UrdfThreeModel';

interface AssemblyTreePanelProps {
  robot: UrdfRobot | null;
  model: UrdfThreeModel | null;
  selectedLinkName?: string;
}

export default function AssemblyTreePanel({ robot, model, selectedLinkName }: AssemblyTreePanelProps) {
  if (!robot) {
    return (
      <div style={{ padding: '20px', color: '#8aa3b8', fontSize: '13px', textAlign: 'center' }}>
        等待机器人拓扑树就绪…
      </div>
    );
  }

  const handleSelectLink = (linkName: string) => {
    if (model) {
      model.selectLinkByName(linkName);
    }
  };

  const renderLinkNode = (linkName: string, depth = 0) => {
    const link = robot.links.get(linkName);
    const parentJoint = robot.parentJoint.get(linkName);
    const childJoints = robot.childJoints.get(linkName) || [];
    const isSelected = selectedLinkName === linkName;

    return (
      <div key={linkName} style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          onClick={() => handleSelectLink(linkName)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            paddingLeft: 8 + depth * 18,
            borderRadius: 6,
            background: isSelected ? 'linear-gradient(135deg, #e3eef9, #d3e5f6)' : 'transparent',
            border: isSelected ? '1px solid #b8d4ed' : '1px solid transparent',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          title={`点击在 3D 视图中高亮选中连杆 ${linkName}`}
        >
          {/* 节点图标 */}
          <span style={{ fontSize: 11, color: isSelected ? '#255a8a' : '#8da5b8' }}>
            {childJoints.length > 0 ? '├─' : '└─'}
          </span>
          <span style={{ fontWeight: 600, fontSize: 12, color: isSelected ? '#1d4d7a' : '#334f68' }}>
            {linkName}
          </span>
          {parentJoint && (
            <span
              style={{
                fontSize: 9,
                background: '#edf3f9',
                color: '#658cae',
                padding: '1px 5px',
                borderRadius: 3,
                marginLeft: 'auto',
                fontFamily: 'monospace',
              }}
            >
              {parentJoint.type} ({parentJoint.name})
            </span>
          )}
          {link && link.visuals.length > 0 && (
            <span style={{ fontSize: 9, color: '#97abc0' }}>
              ({link.visuals.length} mesh)
            </span>
          )}
        </div>

        {/* 递归子关节所连的子 Link */}
        {childJoints.map((j) => renderLinkNode(j.child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#68859e', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          机构拓扑树 (Link & Joint Hierarchy)
        </span>
        <span style={{ fontSize: 10, color: '#93a7ba' }}>
          共 {robot.links.size} 个连杆 / {robot.joints.size} 个关节
        </span>
      </div>

      <div
        style={{
          background: 'rgba(255, 255, 255, 0.75)',
          border: '1px solid #e1e9f0',
          borderRadius: 8,
          padding: '8px',
          maxHeight: '280px',
          overflowY: 'auto',
          boxShadow: '0 1px 4px rgba(40, 70, 95, 0.03)',
        }}
      >
        {renderLinkNode(robot.rootLinkName, 0)}
      </div>
    </div>
  );
}
