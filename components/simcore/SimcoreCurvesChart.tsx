'use client';

import React from 'react';
import type { SanitizedCurvePoint, SanitizedCurveSeries } from '../../lib/simcore/training-result';

interface SimcoreCurvesChartProps {
  curves?: Record<string, SanitizedCurveSeries>;
}

interface MergedCurveSeries {
  key: string;
  title: string;
  label: string;
  points: SanitizedCurvePoint[];
}

function mergeCurves(curves?: Record<string, SanitizedCurveSeries>): MergedCurveSeries[] {
  if (!curves) return [];

  // Group by (title || key) and label
  const grouped = new Map<string, { key: string; title: string; label: string; points: SanitizedCurvePoint[] }>();

  for (const [key, series] of Object.entries(curves)) {
    if (!series) continue;
    const title = series.title || key;
    const label = series.label || '';
    const groupKey = `${title}::${label}`;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        key,
        title,
        label,
        points: [...(series.points || [])],
      });
    } else {
      const existing = grouped.get(groupKey)!;
      existing.points.push(...(series.points || []));
    }
  }

  // Deduplicate and sort points for each series by step
  const result: MergedCurveSeries[] = [];
  for (const [, item] of grouped.entries()) {
    const stepMap = new Map<number, SanitizedCurvePoint>();
    const withoutStep: SanitizedCurvePoint[] = [];

    for (const pt of item.points) {
      if (typeof pt.step === 'number' && Number.isFinite(pt.step)) {
        stepMap.set(pt.step, pt);
      } else {
        withoutStep.push(pt);
      }
    }

    const sortedStepPoints = Array.from(stepMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, pt]) => pt);

    const mergedPoints = [...sortedStepPoints, ...withoutStep];

    result.push({
      key: item.key,
      title: item.title,
      label: item.label,
      points: mergedPoints,
    });
  }

  return result;
}

export default function SimcoreCurvesChart({ curves }: SimcoreCurvesChartProps) {
  const seriesList = mergeCurves(curves);

  if (seriesList.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px dashed #cbd5e1',
          color: '#64748b',
          fontSize: 13,
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="1.5"
          style={{ margin: '0 auto 8px', display: 'block' }}
        >
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
        <span>暂无可归属的训练曲线</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {seriesList.map((series) => {
        const points = series.points || [];
        const validPoints = points.filter(
          (p) => typeof p.value === 'number' && !Number.isNaN(p.value),
        );

        if (validPoints.length === 0) {
          return (
            <div
              key={series.key}
              style={{
                padding: '16px',
                background: '#f8fafc',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                fontSize: 12,
                color: '#64748b',
              }}
            >
              <strong>{series.title || series.key}</strong>: 数据点为空
            </div>
          );
        }

        const values = validPoints.map((p) => p.value as number);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const isFlat = maxVal === minVal;
        const range = isFlat ? 1 : maxVal - minVal;

        // Map points to SVG coordinates (width 400, height 100)
        const svgPoints = validPoints.map((pt, idx) => {
          const x = validPoints.length === 1 ? 200 : (idx / (validPoints.length - 1)) * 380 + 10;
          const y = isFlat ? 50 : 90 - (((pt.value as number) - minVal) / range) * 80;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });

        const polylinePoints = svgPoints.join(' ');
        const lastPoint = validPoints[validPoints.length - 1];

        return (
          <div
            key={series.key}
            style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              padding: '14px 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 8,
              }}
            >
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                  {series.title || series.key}
                </span>
                {series.label && (
                  <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
                    ({series.label})
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#0284c7' }}>
                最新值: {lastPoint?.value?.toFixed(4) ?? 'N/A'}{' '}
                {lastPoint?.step !== undefined ? `(step ${lastPoint.step})` : ''}
              </span>
            </div>

            <div
              style={{
                height: 110,
                background: '#f8fafc',
                borderRadius: 6,
                padding: '10px 8px',
                border: '1px solid #e2e8f0',
                position: 'relative',
              }}
            >
              <svg
                width="100%"
                height="90"
                viewBox="0 0 400 100"
                preserveAspectRatio="none"
              >
                {/* Horizontal gridlines */}
                <line x1="10" y1="10" x2="390" y2="10" stroke="#e2e8f0" strokeDasharray="3 3" />
                <line x1="10" y1="50" x2="390" y2="50" stroke="#e2e8f0" strokeDasharray="3 3" />
                <line x1="10" y1="90" x2="390" y2="90" stroke="#e2e8f0" strokeDasharray="3 3" />

                {validPoints.length === 1 ? (
                  <circle
                    cx={200}
                    cy={parseFloat(svgPoints[0].split(',')[1])}
                    r={4}
                    fill="#0284c7"
                  />
                ) : (
                  <polyline
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polylinePoints}
                  />
                )}
              </svg>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: '#94a3b8',
                marginTop: 4,
              }}
            >
              <span>Min: {minVal.toFixed(4)}</span>
              <span>数据点数: {validPoints.length}</span>
              <span>Max: {maxVal.toFixed(4)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
