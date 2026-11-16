'use client';

import React, { useState, useEffect } from 'react';
import { UrdfKinematicsController } from './urdf/UrdfKinematicsController';
import { JointState } from './urdf/types';

interface KinematicsPanelProps {
  kinematics: UrdfKinematicsController | null;
}

export default function KinematicsPanel({ kinematics }: KinematicsPanelProps) {
  const [joints, setJoints] = useState<JointState[]>([]);

  useEffect(() => {
    if (!kinematics) return;

    const refresh = () => {
      setJoints(kinematics.getControllableJoints());
    };

    refresh();
    const unsubscribe = kinematics.onChange(() => {
      refresh();
    });

    return () => unsubscribe();
  }, [kinematics]);

  if (!kinematics || joints.length === 0) {
    return (
      <div style={{ padding: '20px', color: '#8aa3b8', fontSize: '13px', textAlign: 'center' }}>
        等待 URDF 运动学控制器就绪…
      </div>
    );
  }

  const radToDeg = (rad: number) => Math.round((rad * 180) / Math.PI);
  const degToRad = (deg: number) => (deg * Math.PI) / 180;

  const handleSliderChange = (name: string, isAngular: boolean, valNum: number) => {
    if (!kinematics) return;
    const value = isAngular ? degToRad(valNum) : valNum / 1000;
    kinematics.setJointValue(name, value);
  };

  // 预设位姿快捷驱动
  const applyPreset = (preset: 'zero' | 'neutral' | 'stretch' | 'stow') => {
    if (!kinematics) return;

    const values: Record<string, number> = {};
    joints.forEach((j) => {
      if (preset === 'zero') {
        values[j.name] = 0;
      } else if (preset === 'neutral') {
        const mid = (j.lower + j.upper) / 2;
        values[j.name] = Number.isFinite(mid) ? mid * 0.4 : 0;
      } else if (preset === 'stretch') {
        values[j.name] = j.upper * 0.6;
      } else if (preset === 'stow') {
        values[j.name] = j.lower * 0.75;
      }
    });

    kinematics.setJoints(values);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 预设位姿快捷操作 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#68859e', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          预设位姿
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => applyPreset('zero')} style={pillBtnStyle}>
            零位 (Home)
          </button>
          <button type="button" onClick={() => applyPreset('neutral')} style={pillBtnStyle}>
            中立位
          </button>
          <button type="button" onClick={() => applyPreset('stretch')} style={pillBtnStyle}>
            工作位
          </button>
          <button type="button" onClick={() => applyPreset('stow')} style={pillBtnStyle}>
            收纳位
          </button>
        </div>
      </div>

      {/* 动态关节滑块列表 (完全由 URDF 自适应生成) */}
      <div style={{ display: 'grid', gap: 12, maxHeight: '290px', overflowY: 'auto', paddingRight: '4px' }}>
        {joints.map((joint) => {
          const isAngular = joint.type === 'revolute' || joint.type === 'continuous';
          const currentDisplay = isAngular ? radToDeg(joint.value) : Math.round(joint.value * 1000);
          const minDisplay = Number.isFinite(joint.lower)
            ? isAngular
              ? radToDeg(joint.lower)
              : Math.round(joint.lower * 1000)
            : -180;
          const maxDisplay = Number.isFinite(joint.upper)
            ? isAngular
              ? radToDeg(joint.upper)
              : Math.round(joint.upper * 1000)
            : 180;
          const unit = isAngular ? '°' : 'mm';

          return (
            <div
              key={joint.name}
              style={{
                background: 'rgba(255, 255, 255, 0.75)',
                border: '1px solid #e1e9f0',
                borderRadius: 8,
                padding: '9px 12px',
                boxShadow: '0 1px 4px rgba(40, 70, 95, 0.03)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: '#324e68' }}>{joint.name}</span>
                  <span
                    style={{
                      fontSize: 9,
                      background: '#e8f1f8',
                      color: '#557e9f',
                      padding: '2px 5px',
                      borderRadius: 4,
                      letterSpacing: '0.4px',
                    }}
                  >
                    {joint.type}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#2b6294', fontFamily: 'monospace' }}>
                  {currentDisplay} {unit}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, color: '#97abc0', width: 34, textAlign: 'right', fontFamily: 'monospace' }}>
                  {minDisplay}
                </span>
                <input
                  type="range"
                  min={minDisplay}
                  max={maxDisplay}
                  step={isAngular ? 1 : 1}
                  value={currentDisplay}
                  onChange={(e) => handleSliderChange(joint.name, isAngular, Number(e.target.value))}
                  style={{
                    flex: 1,
                    accentColor: '#3d7bb0',
                    cursor: 'pointer',
                  }}
                />
                <span style={{ fontSize: 10, color: '#97abc0', width: 34, fontFamily: 'monospace' }}>
                  {maxDisplay}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const pillBtnStyle: React.CSSProperties = {
  background: '#eaf2f9',
  border: '1px solid #d3e3f0',
  color: '#496d8b',
  borderRadius: 5,
  fontSize: 10,
  padding: '4px 8px',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
};
