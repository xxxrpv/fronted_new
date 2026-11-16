'use client';

import React, { useRef, useState } from 'react';
import styles from '../deploy.module.css';
import type {
  DeployxPackageResource,
  DeployxModelAssetResource,
} from '../../../lib/api';

interface StepUploadPackageProps {
  packages?: DeployxPackageResource[];
  models?: DeployxModelAssetResource[];
  selectedPackageId: string | null;
  selectedModelAssetId: string | null;
  onSelectPackage: (pkgId: string) => void;
  onModelAssetChange: (assetId: string | null) => void;
  readOnly?: boolean;
  canUploadPackage?: boolean;
  canUploadModel?: boolean;
  onUploadPackage?: (file: File) => void;
  onUploadModel?: (file: File) => void;
  uploadStatus?: string | null;
  onCancelUpload?: () => void;
  isUploading?: boolean;
}

export default function StepUploadPackage({
  packages = [],
  models = [],
  selectedPackageId,
  selectedModelAssetId,
  onSelectPackage,
  onModelAssetChange,
  readOnly = false,
  canUploadPackage = false,
  canUploadModel = false,
  onUploadPackage,
  onUploadModel,
  uploadStatus = null,
  onCancelUpload,
  isUploading = false,
}: StepUploadPackageProps) {
  const pkgInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [localFileError, setLocalFileError] = useState<string | null>(null);

  const handlePackageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setLocalFileError('请选择 .zip 格式的算法包文件');
      return;
    }
    if (onUploadPackage) {
      onUploadPackage(file);
    }
  };

  const handleModelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.tar$/i.test(file.name)) {
      setLocalFileError('请选择 .tar 格式的模型资产文件');
      return;
    }
    if (onUploadModel) {
      onUploadModel(file);
    }
  };

  return (
    <div className={styles.stepGridTwoCol}>
      {/* 算法包选择与上传区域 */}
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className={styles.cardTitle}>算法包选择</div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: '#eff6ff',
                  color: '#0284c7',
                  border: '1px solid #bfdbfe',
                }}
              >
                必需
              </span>
            </div>
            <div className={styles.cardDesc}>
              选择经过验证并授权绑定的仿真算法包（.tar.gz / .zip 格式）。
            </div>
          </div>
        </div>

        <div className={styles.cardBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 上传区域 */}
          <div
            className={`${styles.uploadDropzone} ${
              canUploadPackage && !readOnly && !isUploading
                ? styles.uploadDropzoneInteractive
                : styles.uploadDropzoneDisabled
            }`}
            onClick={() => {
              if (canUploadPackage && !readOnly && !isUploading) {
                pkgInputRef.current?.click();
              }
            }}
          >
            <input
              ref={pkgInputRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={handlePackageFileChange}
              disabled={!canUploadPackage || readOnly || isUploading}
            />
            {/* 现代算法包图标 */}
            <div
              className={styles.uploadIconBadge}
              style={{
                background: '#eff6ff',
                border: '1px solid #dbeafe',
                color: '#0070f3',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                <path d="m3.3 7 8.7 5 8.7-5" />
                <path d="M12 22V12" />
              </svg>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
              拖拽或选择新算法包文件
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              支持 .zip 格式流式上传（受控专属目录暂存）
            </div>

            {/* 上传状态与取消传输 */}
            {uploadStatus ? (
              <div
                role="status"
                aria-live="polite"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: '#0284c7',
                  marginTop: 10,
                  padding: '4px 10px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 6,
                }}
              >
                <span>{uploadStatus}</span>
                {isUploading && onCancelUpload && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelUpload();
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#dc2626',
                      fontSize: 12,
                      cursor: 'pointer',
                      fontWeight: 500,
                      textDecoration: 'underline',
                      padding: 0,
                    }}
                  >
                    取消传输
                  </button>
                )}
              </div>
            ) : (
              <div role="status" aria-live="polite" style={{ display: 'none' }} />
            )}

            {localFileError && (
              <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>
                {localFileError}
              </div>
            )}

            <div>
              <button
                type="button"
                disabled={!canUploadPackage || readOnly || isUploading}
                className={`${styles.btnSecondary} ${styles.btnSm}`}
                style={{
                  marginTop: 12,
                  opacity: canUploadPackage && !readOnly ? 1 : 0.6,
                  cursor: canUploadPackage && !readOnly ? 'pointer' : 'not-allowed',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canUploadPackage && !readOnly && !isUploading) {
                    pkgInputRef.current?.click();
                  }
                }}
              >
                {isUploading ? '传输中...' : canUploadPackage ? '选择算法包 (.zip)' : '未开放'}
              </button>
            </div>
          </div>

          {/* 已授权算法包列表 */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>已授权算法包列表</span>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>共 {packages.length} 项</span>
            </div>
            {packages.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8', padding: '16px 0', textAlign: 'center', background: '#f8fafc', borderRadius: 6, border: '1px dashed #e2e8f0' }}>
                暂无已授权算法包
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {packages.map((pkg) => {
                  const isSelected = pkg.id === selectedPackageId;
                  return (
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={isSelected}
                      key={pkg.id}
                      onClick={() => !readOnly && onSelectPackage(pkg.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: isSelected ? '2px solid #0070f3' : '1px solid #e2e8f0',
                        background: isSelected ? '#f0f7ff' : '#ffffff',
                        cursor: readOnly ? 'default' : 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        textAlign: 'left',
                        font: 'inherit',
                        width: '100%',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                          {pkg.originalName}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          大小: {(pkg.sizeBytes / 1024 / 1024).toFixed(2)} MB · 状态: {pkg.status}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: isSelected ? '#0070f3' : '#f1f5f9',
                          color: isSelected ? '#ffffff' : '#64748b',
                        }}
                      >
                        {isSelected ? '已选中' : '选择'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 模型资产选择与上传区域 */}
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className={styles.cardTitle}>独立模型资产（可选）</div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: '#f8fafc',
                  color: '#64748b',
                  border: '1px solid #e2e8f0',
                }}
              >
                可选
              </span>
            </div>
            <div className={styles.cardDesc}>
              附加预训练权重（.tar 格式）以支持具身决策策略。
            </div>
          </div>
        </div>

        <div className={styles.cardBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 上传区域 */}
          <div
            className={`${styles.uploadDropzone} ${
              canUploadModel && !readOnly && !isUploading
                ? styles.uploadDropzoneInteractive
                : styles.uploadDropzoneDisabled
            }`}
            onClick={() => {
              if (canUploadModel && !readOnly && !isUploading) {
                modelInputRef.current?.click();
              }
            }}
          >
            <input
              ref={modelInputRef}
              type="file"
              accept=".tar"
              style={{ display: 'none' }}
              onChange={handleModelFileChange}
              disabled={!canUploadModel || readOnly || isUploading}
            />
            {/* 现代模型资产芯片图标 */}
            <div
              className={styles.uploadIconBadge}
              style={{
                background: '#f5f3ff',
                border: '1px solid #ede9fe',
                color: '#7c3aed',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect width="16" height="16" x="4" y="4" rx="2" />
                <rect width="6" height="6" x="9" y="9" rx="1" />
                <path d="M15 2v2" />
                <path d="M15 20v2" />
                <path d="M2 15h2" />
                <path d="M2 9h2" />
                <path d="M20 15h2" />
                <path d="M20 9h2" />
                <path d="M9 2v2" />
                <path d="M9 20v2" />
              </svg>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
              上传独立模型资产 (.tar)
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              支持 .tar 权重模型文件，与算法包独立组合
            </div>
            <div>
              <button
                type="button"
                disabled={!canUploadModel || readOnly || isUploading}
                className={`${styles.btnSecondary} ${styles.btnSm}`}
                style={{
                  marginTop: 12,
                  opacity: canUploadModel && !readOnly ? 1 : 0.6,
                  cursor: canUploadModel && !readOnly ? 'pointer' : 'not-allowed',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canUploadModel && !readOnly && !isUploading) {
                    modelInputRef.current?.click();
                  }
                }}
              >
                {canUploadModel ? '选择模型 (.tar)' : '未开放'}
              </button>
            </div>
          </div>

          {/* 已授权模型资产列表 */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>已授权模型资产</span>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>共 {models.length} 项</span>
            </div>
            {models.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8', padding: '16px 0', textAlign: 'center', background: '#f8fafc', borderRadius: 6, border: '1px dashed #e2e8f0' }}>
                暂无绑定的模型资产（可选）
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  disabled={readOnly}
                  aria-pressed={selectedModelAssetId === null}
                  onClick={() => !readOnly && onModelAssetChange(null)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: selectedModelAssetId === null ? '2px solid #0070f3' : '1px solid #e2e8f0',
                    background: selectedModelAssetId === null ? '#f0f7ff' : '#ffffff',
                    cursor: readOnly ? 'default' : 'pointer',
                    fontSize: 12,
                    color: selectedModelAssetId === null ? '#0070f3' : '#64748b',
                    fontWeight: selectedModelAssetId === null ? 600 : 400,
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>不附加独立模型权重</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: selectedModelAssetId === null ? '#0070f3' : '#f1f5f9',
                      color: selectedModelAssetId === null ? '#ffffff' : '#64748b',
                    }}
                  >
                    {selectedModelAssetId === null ? '已选择' : '选择'}
                  </span>
                </button>
                {models.map((m) => {
                  const isSelected = m.id === selectedModelAssetId;
                  return (
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={isSelected}
                      key={m.id}
                      onClick={() => !readOnly && onModelAssetChange(m.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: isSelected ? '2px solid #0070f3' : '1px solid #e2e8f0',
                        background: isSelected ? '#f0f7ff' : '#ffffff',
                        cursor: readOnly ? 'default' : 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                          {m.displayName || m.id}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 }}>
                          {m.sha256 ? `SHA: ${m.sha256.slice(0, 16)}...` : `来源: ${m.authorizationSource}`}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: isSelected ? '#0070f3' : '#f1f5f9',
                          color: isSelected ? '#ffffff' : '#64748b',
                        }}
                      >
                        {isSelected ? '已选中' : '选择'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
