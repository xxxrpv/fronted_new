'use client';

import React, { useEffect, useRef } from 'react';
import styles from './project-dialog.module.css';

export function ProjectDialog({ titleId, busy, onClose, children }: {
  titleId: string; busy: boolean; onClose: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog && dialog.open) {
        dialog.close();
      }
      const fallback = document.querySelector<HTMLElement>('[aria-label="更多项目操作"], a[href="/projects/new"]');
      (previous?.isConnected ? previous : fallback)?.focus();
    };
  }, []);
  return <dialog ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) closeRef.current(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) closeRef.current(); }}>
    {children}
  </dialog>;
}
