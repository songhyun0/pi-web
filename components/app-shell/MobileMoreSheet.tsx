import type { ReactNode } from "react";
import { Dialog } from "@/components/ui";
import styles from "./MobileMoreSheet.module.css";

export interface MobileMoreActions {
  newSession: () => void;
  exportSession: () => void;
  branches: () => void;
  systemPrompt: () => void;
  models: () => void;
  skills: () => void;
  plugins: () => void;
  settings: () => void;
  projectTrust: () => void;
  hotkeys: () => void;
  theme: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: MobileMoreActions;
  hasWorkspace: boolean;
  hasSession: boolean;
  isDark: boolean;
}

interface ActionItem {
  id: keyof MobileMoreActions;
  label: string;
  description: string;
  icon: ReactNode;
  disabled?: boolean;
}

function icon(path: ReactNode) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

function ActionButton({ item, onClick }: { item: ActionItem; onClick: () => void }) {
  return (
    <button type="button" className={styles.action} disabled={item.disabled} onClick={onClick}>
      <span className={styles.icon}>{item.icon}</span>
      <span className={styles.copy}>
        <span className={styles.label}>{item.label}</span>
        <span className={styles.description}>{item.description}</span>
      </span>
    </button>
  );
}

export function MobileMoreSheet({ open, onOpenChange, actions, hasWorkspace, hasSession, isDark }: Props) {
  const workspaceItems: ActionItem[] = [
    {
      id: "newSession",
      label: "New session",
      description: hasWorkspace ? "Start in the current project" : "Choose a project first",
      disabled: !hasWorkspace,
      icon: icon(<><path d="M12 5v14" /><path d="M5 12h14" /></>),
    },
    {
      id: "exportSession",
      label: "Export",
      description: hasSession ? "Download session HTML" : "Available after the session is saved",
      disabled: !hasSession,
      icon: icon(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
    },
    {
      id: "branches",
      label: "Session tree",
      description: "Navigate branches and labels",
      disabled: !hasSession,
      icon: icon(<><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>),
    },
    {
      id: "systemPrompt",
      label: "System prompt",
      description: "Inspect active runtime instructions",
      disabled: !hasWorkspace,
      icon: icon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /></>),
    },
  ];

  const configurationItems: ActionItem[] = [
    { id: "models", label: "Models", description: "Providers and authentication", icon: icon(<><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /></>) },
    { id: "skills", label: "Skills", description: "Loaded and installable skills", disabled: !hasWorkspace, icon: icon(<><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>) },
    { id: "plugins", label: "Plugins", description: "Packages and runtime resources", disabled: !hasWorkspace, icon: icon(<><path d="M9 7V2" /><path d="M15 7V2" /><path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" /><path d="M12 19v3" /></>) },
    { id: "settings", label: "Settings", description: "Runtime and app preferences", icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 5 8.6a1.7 1.7 0 0 0-.34-1.88L4.6 6.66l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.34.7.6 1 .3.3.7.44 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" /></>) },
    { id: "projectTrust", label: "Project trust", description: "Review local-code policy", disabled: !hasWorkspace, icon: icon(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>) },
    { id: "hotkeys", label: "Keyboard shortcuts", description: "Browse registered actions", icon: icon(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h5" /></>) },
    { id: "theme", label: isDark ? "Light theme" : "Dark theme", description: "Switch the workspace appearance", icon: isDark ? icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>) : icon(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />) },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Workspace actions"
      description="Secondary navigation and configuration"
      variant="sheet"
      size="md"
      bodyClassName={styles.body}
    >
      <div className={styles.content}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Current workspace</h3>
            <p>Session actions stay scoped to the active project.</p>
          </div>
          <div className={styles.grid}>
            {workspaceItems.map((item) => <ActionButton key={item.id} item={item} onClick={actions[item.id]} />)}
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Configure</h3>
            <p>Open a focused configuration surface.</p>
          </div>
          <div className={styles.list}>
            {configurationItems.map((item) => <ActionButton key={item.id} item={item} onClick={actions[item.id]} />)}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
