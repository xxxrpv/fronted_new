'use client';

import React from 'react';
import styles from '../deploy.module.css';
import type {
  DeployxPackageResource,
  DeployxPackageManifestResponse,
} from '../../../lib/api';

interface StepUnpackAnalysisProps {
  packageDetail: DeployxPackageResource | null;
  packageManifest: DeployxPackageManifestResponse | null;
  canUnpack?: boolean;
  onUnpack?: () => void;
  isLoading?: boolean;
}

export default function StepUnpackAnalysis({
  packageDetail,
  packageManifest,
  canUnpack = false,
  onUnpack,
  isLoading = false,
}: StepUnpackAnalysisProps) {
  const dependenciesList = packageManifest?.dependencies
    ? Object.entries(packageManifest.dependencies).map(([k, v]) => `${k}@${v}`)
    : [];

  const controlInterfaceStr = packageManifest?.controlInterface
    ? typeof packageManifest.controlInterface === 'string'
      ? packageManifest.controlInterface
      : JSON.stringify(packageManifest.controlInterface)
    : '暂无';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {/* 左侧：文件树与结构摘要 */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className={styles.cardTitle}>解包状态与包详情</div>
            <div className={styles.cardDesc}>隔离目录中安全解包元数据，不执行未授权脚本。</div>
          </div>
          {canUnpack && onUnpack ? (
            <button
              type="button"
              disabled={isLoading}
              onClick={onUnpack}
              className={`${styles.btnSecondary} ${styles.btnSm}`}
            >
              {isLoading ? '解包中…' : '触发解包'}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className={`${styles.btnSecondary} ${styles.btnSm}`}
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            >
              未开放
            </button>
          )}
        </div>
        <div className={styles.cardBody} style={{ maxHeight: 460, overflowY: 'auto' }}>
          {packageDetail ? (
            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                {packageDetail.originalName}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                包大小: {(packageDetail.sizeBytes / (1024 * 1024)).toFixed(2)} MB
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                SHA256: {packageDetail.sha256}
              </div>
              <div style={{ fontSize: 12, color: packageDetail.status === 'UNPACKED' ? '#16a34a' : '#d97706', marginTop: 4 }}>
                解包状态: {packageDetail.status === 'UNPACKED' ? '已解包完成' : packageDetail.status}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                文件树与解包目录：仅服务端沙箱隔离解包，当前用户通道不直接暴露完整源码树。
              </div>
            </div>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              暂无算法包解包详情
            </div>
          )}
        </div>
      </div>

      {/* 右侧：解析识别结果 */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>解析识别结果 (Manifest)</div>
          <div className={styles.cardDesc}>上游解包分析器解析产物</div>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {packageManifest ? (
            <>
              {/* 执行入口指令 */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a' }}>入口执行命令 (Entrypoint)</div>
                <div
                  style={{
                    marginTop: 4,
                    padding: '8px 10px',
                    background: '#09090b',
                    color: '#f4f4f5',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    borderRadius: 4,
                  }}
                >
                  $ {packageManifest.entry || '暂无入口命令'}
                </div>
              </div>

              {/* 结构摘要属性列表 */}
              <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 12 }}>
                <dt style={{ color: '#71717a' }}>基底运行时</dt>
                <dd style={{ fontFamily: 'monospace', color: '#0f172a' }}>{packageManifest.runtime || '暂无'}</dd>

                <dt style={{ color: '#71717a' }}>控制接口</dt>
                <dd style={{ fontFamily: 'monospace', color: '#0f172a' }}>{controlInterfaceStr}</dd>

                <dt style={{ color: '#71717a' }}>依赖包</dt>
                <dd style={{ color: '#0f172a' }}>
                  {dependenciesList.length > 0 ? dependenciesList.join(', ') : '无额外外部依赖'}
                </dd>
              </dl>
            </>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              暂无 Manifest 解析数据
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
