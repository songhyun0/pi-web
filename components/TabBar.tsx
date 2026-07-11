"use client";

import { getFileIcon } from "./FileIcons";
import styles from "./TabBar.module.css";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  return (
    <div className={styles.root} role="tablist" aria-label="Open file previews">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={styles.tab}
            data-active={active || undefined}
          >
            <button
              type="button"
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={styles.select}
              title={tab.filePath}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className={styles.icon}>{getFileIcon(tab.label, 13)}</span>
              <span className={styles.label}>{tab.label}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.label}`}
              title={`Close ${tab.label}`}
              className={styles.close}
              onClick={() => onCloseTab(tab.id)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
