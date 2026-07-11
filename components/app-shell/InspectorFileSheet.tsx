"use client";

import { getFileIcon } from "../FileIcons";
import type { Tab } from "../TabBar";
import { Button, Dialog } from "../ui";
import styles from "./InspectorFileSheet.module.css";

interface Props {
  open: boolean;
  tabs: Tab[];
  activeTabId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function InspectorFileSheet({ open, tabs, activeTabId, onOpenChange, onSelect, onClose }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open files"
      description="Switch or close file previews without leaving the Inspector."
      variant="sheet"
      size="md"
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      {tabs.length === 0 ? (
        <div className={styles.empty}>Open a file from Explorer or a message link to add it here.</div>
      ) : (
        <ul className={styles.list}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <li key={tab.id} className={styles.row} data-active={active || undefined}>
                <button
                  type="button"
                  className={styles.select}
                  aria-current={active ? "true" : undefined}
                  onClick={() => { onSelect(tab.id); onOpenChange(false); }}
                  title={tab.filePath}
                >
                  <span className={styles.icon} aria-hidden="true">{getFileIcon(tab.label, 16)}</span>
                  <span className={styles.identity}>
                    <strong>{tab.label}</strong>
                    <span>{tab.filePath}</span>
                  </span>
                  {active && <span className={styles.current}>Current</span>}
                </button>
                <button type="button" className={styles.close} aria-label={`Close ${tab.label}`} onClick={() => onClose(tab.id)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="7" y1="7" x2="17" y2="17" /><line x1="17" y1="7" x2="7" y2="17" /></svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
