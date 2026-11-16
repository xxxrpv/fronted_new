'use client';

import React, { useState } from 'react';
import { UrdfThreeModel } from './urdf/UrdfThreeModel';

interface ExplodedPanelProps {
  model: UrdfThreeModel | null;
}

export default function ExplodedPanel({ model }: ExplodedPanelProps) {
  const [explodeVal, setExplodeVal] = useState<number>(0);

  const handleSliderChange = (val: number) => {
    setExplodeVal(val);
    if (model) {
      model.setExplode(val / 100);
    }
  };

  const handleAnimateTo = (target: number) => {
    const start = explodeVal;
    const duration = 300;
    const startTime = performance.now();

    const step = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(1, elapsed / duration);
      const current = start + (target - start) * progress;
      setExplodeVal(Math.round(current));
      if (model) {
        model.setExplode(current / 100);
      }
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: '#7791a8' }}>
        通用爆炸图拆解：基于 URDF 拓扑父子层级与关节原点方向，沿空间展开各装配连杆与零部件，直观展示内部舵机支架、法兰盘与紧固关系。
      </p>

      <div
        style={{
          background: 'rgba(255, 255, 255, 0.75)',
          border: '1px solid #e1e9f0',
          borderRadius: 10,
          padding: '16px',
          boxShadow: '0 2px 6px rgba(40, 70, 95, 0.04)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#33506c' }}>拆解展开度</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#2b6294', fontFamily: 'monospace' }}>
            {explodeVal}%
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={explodeVal}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          style={{
            width: '100%',
            accentColor: '#3d7bb0',
            cursor: 'pointer',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 10 }}>
          <button
            type="button"
            onClick={() => handleAnimateTo(0)}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid #d2e2ef',
              background: '#f1f6fa',
              color: '#496d8b',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            完全复位 (0%)
          </button>
          <button
            type="button"
            onClick={() => handleAnimateTo(50)}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid #d2e2ef',
              background: '#f1f6fa',
              color: '#496d8b',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            半展开 (50%)
          </button>
          <button
            type="button"
            onClick={() => handleAnimateTo(100)}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid #b7d1e8',
              background: 'linear-gradient(135deg, #e4effb, #d5e5f5)',
              color: '#24537e',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            完全展开 (100%)
          </button>
        </div>
      </div>
    </div>
  );
}
