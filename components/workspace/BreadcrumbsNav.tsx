import React from 'react';
import type { WorkspaceDirectory } from '../../lib/workspace/workspace-types';
import { workspaceStyles as styles } from './workspace-styles';

interface BreadcrumbsNavProps {
  breadcrumbs: WorkspaceDirectory[];
  currentDirectory: WorkspaceDirectory | null;
  onNavigate: (targetDirectoryId: string | undefined) => void;
  disabled?: boolean;
}

export const BreadcrumbsNav: React.FC<BreadcrumbsNavProps> = ({
  breadcrumbs,
  currentDirectory,
  onNavigate,
  disabled = false,
}) => {
  // If no breadcrumbs are provided yet
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return (
      <nav aria-label="目录层级导航" style={styles.breadcrumbsContainer}>
        <span style={styles.breadcrumbCurrent}>
          {currentDirectory?.name || '根目录 (Root)'}
        </span>
      </nav>
    );
  }

  return (
    <nav aria-label="目录层级导航" style={styles.breadcrumbsContainer}>
      {breadcrumbs.map((crumb, idx) => {
        const isLast = idx === breadcrumbs.length - 1;
        const isRoot = idx === 0;

        return (
          <span key={crumb.id || `crumb-${idx}`} style={styles.breadcrumbItem}>
            {idx > 0 && <span style={styles.breadcrumbSep} aria-hidden="true">/</span>}
            {isLast ? (
              <span style={styles.breadcrumbCurrent} aria-current="location">
                {crumb.name}
              </span>
            ) : (
              <button
                type="button"
                style={styles.breadcrumbBtn}
                onClick={() => onNavigate(isRoot ? undefined : crumb.id)}
                disabled={disabled}
                aria-label={`返回至 ${crumb.name}`}
              >
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
};
