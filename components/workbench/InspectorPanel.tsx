'use client';

import React from 'react';
import { PartSelectedInfo } from './urdf/UrdfThreeModel';
import { UrdfRobot } from './urdf/types';

interface InspectorPanelProps {
  selectedPart: PartSelectedInfo | null;
  robot: UrdfRobot | null;
  onClearSelection: () => void;
  endEffectorPos?: { x: number; y: number; z: number };
}

export default function InspectorPanel({
  selectedPart,
  robot,
  onClearSelection,
  endEffectorPos,
}: InspectorPanelProps) {
  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '320px',
        flexShrink: 0,
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid #dfe7ef',
        padding: '20px',
        overflowY: 'auto',
      }}
    >
      {/* 检视器头部 */}
      <div style={{ borderBottom: '1px solid #e7eff6', paddingBottom: 14, marginBottom: 16 }}>
        <span
          style={{
            display: 'block',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: '#8ba6be',
            marginBottom: 4,
          }}
        >
          {selectedPart ? 'PART INSPECTION / 01' : 'ROBOT SPECIFICATION'}
        </span>
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: '#2d4b66',
            letterSpacing: '-0.3px',
          }}
        >
          {selectedPart ? selectedPart.partName : robot?.name || '机器人概要'}
        </h3>
      </div>

      {selectedPart ? (
        /* 选中具体零件时展示详细几何与运动学连接数据 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 所属连杆 */}
          <div style={cardStyle}>
            <span style={labelStyle}>所属连杆 (Link)</span>
            <strong style={valueStyle}>{selectedPart.linkName}</strong>
          </div>

          {/* 关联关节 */}
          {selectedPart.jointName ? (
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={labelStyle}>驱动关节 (Joint)</span>
                <span style={badgeStyle}>{selectedPart.jointType}</span>
              </div>
              <strong style={valueStyle}>{selectedPart.jointName}</strong>
              {selectedPart.jointLimits && (
                <div style={{ fontSize: 11, color: '#688cae', marginTop: 4 }}>
                  限位范围: {Math.round((selectedPart.jointLimits.lower * 180) / Math.PI)}° ~{' '}
                  {Math.round((selectedPart.jointLimits.upper * 180) / Math.PI)}°
                </div>
              )}
              {selectedPart.jointAxis && (
                <div style={{ fontSize: 10, color: '#97abc0', marginTop: 2, fontFamily: 'monospace' }}>
                  旋转轴 Axis: [{selectedPart.jointAxis.x}, {selectedPart.jointAxis.y}, {selectedPart.jointAxis.z}]
                </div>
              )}
            </div>
          ) : (
            <div style={cardStyle}>
              <span style={labelStyle}>驱动关节</span>
              <span style={{ fontSize: 11, color: '#8fa5b8' }}>基座根节点 (无上级关节)</span>
            </div>
          )}

          {/* 几何外包络 */}
          {selectedPart.dimensions && (
            <div style={cardStyle}>
              <span style={labelStyle}>外形尺寸包络 (L × W × H)</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 6 }}>
                <div style={subMetricStyle}>
                  <small style={{ fontSize: 9, color: '#8fa2b4' }}>X 长</small>
                  <strong style={{ fontSize: 13, color: '#2b5a84' }}>{selectedPart.dimensions.x}</strong>
                  <span style={{ fontSize: 8, color: '#a0b3c4' }}>mm</span>
                </div>
                <div style={subMetricStyle}>
                  <small style={{ fontSize: 9, color: '#8fa2b4' }}>Y 宽</small>
                  <strong style={{ fontSize: 13, color: '#2b5a84' }}>{selectedPart.dimensions.y}</strong>
                  <span style={{ fontSize: 8, color: '#a0b3c4' }}>mm</span>
                </div>
                <div style={subMetricStyle}>
                  <small style={{ fontSize: 9, color: '#8fa2b4' }}>Z 高</small>
                  <strong style={{ fontSize: 13, color: '#2b5a84' }}>{selectedPart.dimensions.z}</strong>
                  <span style={{ fontSize: 8, color: '#a0b3c4' }}>mm</span>
                </div>
              </div>
            </div>
          )}

          {/* 网格源文件 */}
          {selectedPart.meshFile && (
            <div style={cardStyle}>
              <span style={labelStyle}>网格源文件 (Mesh)</span>
              <span
                style={{
                  fontSize: 11,
                  color: '#496d8b',
                  wordBreak: 'break-all',
                  fontFamily: 'monospace',
                }}
              >
                {selectedPart.meshFile}
              </span>
            </div>
          )}

          {/* 取消选中按钮 */}
          <button
            type="button"
            onClick={onClearSelection}
            style={{
              marginTop: 10,
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid #d0dfea',
              background: '#f4f8fb',
              color: '#557692',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            清除选中 / 返回整机
          </button>
        </div>
      ) : (
        /* 未选中零件时展示整机运动学指标 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={cardStyle}>
            <span style={labelStyle}>机器人模型</span>
            <strong style={valueStyle}>{robot?.name || '未知机器人'}</strong>
          </div>

          <div style={cardStyle}>
            <span style={labelStyle}>根基座 (Root Link)</span>
            <strong style={valueStyle}>{robot?.rootLinkName || '无'}</strong>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={cardStyle}>
              <span style={labelStyle}>连杆总数</span>
              <strong style={{ ...valueStyle, fontSize: 18 }}>{robot?.links.size || 0}</strong>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>主动自由度 (DOF)</span>
              <strong style={{ ...valueStyle, fontSize: 18, color: '#2574b5' }}>
                {Array.from(robot?.joints.values() || []).filter((j) => j.type !== 'fixed').length}
              </strong>
            </div>
          </div>

          {endEffectorPos && (
            <div style={cardStyle}>
              <span style={labelStyle}>末端当前坐标 (TCP X / Y / Z)</span>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#2b5a84', fontFamily: 'monospace' }}>
                  X: {endEffectorPos.x}
                </span>
                <span style={{ fontSize: 11, color: '#2b5a84', fontFamily: 'monospace' }}>
                  Y: {endEffectorPos.y}
                </span>
                <span style={{ fontSize: 11, color: '#2b5a84', fontFamily: 'monospace' }}>
                  Z: {endEffectorPos.z}
                </span>
                <span style={{ fontSize: 10, color: '#97abc0' }}>mm</span>
              </div>
            </div>
          )}

          <div
            style={{
              padding: '12px',
              borderRadius: 8,
              background: '#edf4fa',
              border: '1px solid #d7e6f3',
              fontSize: 11,
              lineHeight: 1.6,
              color: '#5e82a0',
            }}
          >
            💡 提示：在视口中点击任意零件，或展开底部“机构拓扑树”，可立即查看对应几何尺寸、驱动关节与限位属性。
          </div>
        </div>
      )}
    </aside>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e1e9f1',
  borderRadius: 8,
  padding: '11px 13px',
  boxShadow: '0 1px 3px rgba(35, 65, 90, 0.03)',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#88a3ba',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const valueStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#2a4a68',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  background: '#e6f0f8',
  color: '#477ea8',
  padding: '2px 5px',
  borderRadius: 4,
  fontWeight: 600,
};

const subMetricStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  background: '#f5f8fb',
  padding: '6px 4px',
  borderRadius: 6,
};
