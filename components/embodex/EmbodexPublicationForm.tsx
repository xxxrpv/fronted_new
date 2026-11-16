'use client';

import React, { useState } from 'react';
import styles from './EmbodexPublicationForm.module.css';

export interface EmbodexPublicationFormProps {
  projectId?: string;
  submitting?: boolean;
  disabled?: boolean;
  error?: string | null;
  onSubmit: (payload: { requirement: string; templateId: string | null }) => void;
}

export default function EmbodexPublicationForm({
  projectId,
  submitting = false,
  disabled = false,
  error = null,
  onSubmit,
}: EmbodexPublicationFormProps) {
  const [requirement, setRequirement] = useState('');
  const [templateChoice, setTemplateChoice] = useState<'so101_v1' | 'custom' | 'null'>('so101_v1');
  const [customTemplateId, setCustomTemplateId] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const trimmedRequirement = requirement.trim();
  const reqLen = [...trimmedRequirement].length;
  const isReqValid = reqLen >= 3 && reqLen <= 4000;

  const isCustomValid =
    templateChoice !== 'custom' ||
    (customTemplateId.length >= 1 &&
      customTemplateId.length <= 128 &&
      /^[a-z][a-z0-9_]*$/.test(customTemplateId));

  const canSubmit = !disabled && !submitting && !!projectId && isReqValid && isCustomValid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!projectId) {
      setLocalError('非项目或未登录上下文无法提交正式设计任务。');
      return;
    }

    if (!isReqValid) {
      setLocalError('用途备注需为去除首尾空白后的 3～4000 个字符。');
      return;
    }

    let templateId: string | null = null;
    if (templateChoice === 'so101_v1') {
      templateId = 'so101_v1';
    } else if (templateChoice === 'custom') {
      if (!isCustomValid) {
        setLocalError('模板标识需为 1～128 个以小写字母开头的合法标识符（^[a-z][a-z0-9_]*$）。');
        return;
      }
      templateId = customTemplateId;
    } else if (templateChoice === 'null') {
      templateId = null;
    }

    onSubmit({ requirement: trimmedRequirement, templateId });
  };

  const displayError = localError || error;

  return (
    <form className={styles.formContainer} aria-label="正式机器人设计任务配置" onSubmit={handleSubmit}>
      <div className={styles.title}>发起正式平台机器人设计任务</div>

      <div className={styles.fieldGroup}>
        <label htmlFor="embodex-publication-requirement" className={styles.label}>
          设计需求与用途备注（必填，3～4000 字符）
        </label>
        <textarea
          id="embodex-publication-requirement"
          name="requirement"
          className={styles.textarea}
          value={requirement}
          onChange={(e) => {
            setRequirement(e.target.value);
            if (localError) setLocalError(null);
          }}
          disabled={disabled || submitting}
          placeholder="例如：设计六自由度机械臂或移动底盘的物理结构与控制参数..."
          rows={3}
          required
        />
        <div className={styles.helperText}>
          当前字符数：{reqLen} / 4000 {reqLen > 0 && !isReqValid ? '（字符数需在 3 至 4000 之间）' : ''}
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className={styles.label}>基线模板选择</legend>
          <div className={styles.radioGroup}>
            <label className={styles.radioOption}>
              <input
                type="radio"
                name="templateChoice"
                value="so101_v1"
                checked={templateChoice === 'so101_v1'}
                onChange={() => {
                  setTemplateChoice('so101_v1');
                  if (localError) setLocalError(null);
                }}
                disabled={disabled || submitting}
              />
              <span>SO-101 官方基线模板 (so101_v1)</span>
            </label>

            <label className={styles.radioOption}>
              <input
                type="radio"
                name="templateChoice"
                value="custom"
                checked={templateChoice === 'custom'}
                onChange={() => {
                  setTemplateChoice('custom');
                  if (localError) setLocalError(null);
                }}
                disabled={disabled || submitting}
              />
              <span>指定其他基线模板 ID</span>
            </label>

            {templateChoice === 'custom' && (
              <div style={{ marginLeft: 24, marginTop: 4 }}>
                <label htmlFor="embodex-custom-template-id" className={styles.helperText} style={{ display: 'block', marginBottom: 4 }}>
                  输入模板标识（1～128 个以小写字母开头的字符，仅小写字母、数字和下划线）：
                </label>
                <input
                  id="embodex-custom-template-id"
                  name="customTemplateId"
                  type="text"
                  className={styles.textInput}
                  value={customTemplateId}
                  onChange={(e) => {
                    setCustomTemplateId(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                  disabled={disabled || submitting}
                  placeholder="mock_template_a"
                  maxLength={128}
                  pattern="^[a-z][a-z0-9_]*$"
                />
              </div>
            )}

            <label className={styles.radioOption}>
              <input
                type="radio"
                name="templateChoice"
                value="null"
                checked={templateChoice === 'null'}
                onChange={() => {
                  setTemplateChoice('null');
                  if (localError) setLocalError(null);
                }}
                disabled={disabled || submitting}
              />
              <span>未指定基线模板（通用机器人 / 自动选型，显式 null）</span>
            </label>
          </div>
        </fieldset>
      </div>

      {displayError && (
        <div role="alert" className={styles.errorAlert}>
          {displayError}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="submit"
          className="embodex-agent-action-btn"
          disabled={!canSubmit}
        >
          {submitting ? '正在提交平台生成任务…' : '提交正式平台设计任务'}
        </button>
      </div>
    </form>
  );
}
