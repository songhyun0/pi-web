"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge, cx } from "@/components/ui";
import type { RuntimeToolMetadata } from "@/lib/profile-runtime";
import type { ProfileDefinition, ProfileRef } from "@/lib/profiles";
import type { CapabilitySnapshotV1, ProfileDiagnostic, ToolConflict } from "@/lib/session-profile-store";
import styles from "./ProfileSelector.module.css";

function presetLabel(preset: CapabilitySnapshotV1["tools"]["builtinPreset"]): string {
  if (preset === "none") return "No built-ins";
  if (preset === "full") return "Full tools";
  return "Standard tools";
}

function issueLabel(diagnostics: ProfileDiagnostic[], conflicts: ToolConflict[]): string | null {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.type === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.type === "warning").length;
  const parts: string[] = [];
  if (errorCount) parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  if (conflicts.length) parts.push(`${conflicts.length} tool override${conflicts.length === 1 ? "" : "s"}`);
  if (warningCount) parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

function profileErrorAnnouncement(error: string | null | undefined, diagnostics: ProfileDiagnostic[]): string | null {
  const directError = error?.trim();
  const messages = [
    directError,
    ...diagnostics
      .filter((diagnostic) => diagnostic.type === "error")
      .map((diagnostic) => diagnostic.message.trim()),
  ].filter((message): message is string => Boolean(message));
  const uniqueMessages = [...new Set(messages)];
  return uniqueMessages.length ? `Profile error: ${uniqueMessages.join(" ")}` : null;
}

function Checkmark({ visible }: { visible: boolean }) {
  return visible ? (
    <svg className={styles.checkmark} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="1.5 6 4.5 9 10.5 2.5" />
    </svg>
  ) : <span className={styles.checkmark} aria-hidden="true" />;
}

export interface ProfileSelectorProps {
  profiles: ProfileDefinition[];
  globalDefaultProfileRef?: ProfileRef | null;
  mode: "new" | "existing";
  selectedProfileRef?: ProfileRef | null;
  displayName: string;
  effectiveSnapshot?: CapabilitySnapshotV1 | null;
  diagnostics?: ProfileDiagnostic[];
  conflicts?: ToolConflict[];
  setupWarnings?: string[];
  runtimeTools?: RuntimeToolMetadata[];
  disabled?: boolean;
  applying?: boolean;
  error?: string | null;
  onSelectProfile: (profileRef: ProfileRef | null) => void | Promise<void>;
  onOpenManager: () => void;
  quickControls?: boolean;
  onBeforeOpenManager?: () => void;
}

export function ProfileSelector({
  profiles,
  globalDefaultProfileRef,
  mode,
  selectedProfileRef,
  displayName,
  effectiveSnapshot,
  diagnostics = effectiveSnapshot?.diagnostics ?? [],
  conflicts = effectiveSnapshot?.tools.conflicts ?? [],
  setupWarnings = [],
  runtimeTools = [],
  disabled,
  applying,
  error,
  onSelectProfile,
  onOpenManager,
  quickControls = false,
  onBeforeOpenManager,
}: ProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const [menuShift, setMenuShift] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const disableSelect = Boolean(disabled || applying);
  const selectedProfileMissing = Boolean(selectedProfileRef && !profiles.some((profile) => profile.id === selectedProfileRef));
  const globalDefault = profiles.find((profile) => profile.id === globalDefaultProfileRef);
  const summary = issueLabel(diagnostics, conflicts);
  const hasError = Boolean(error || diagnostics.some((diagnostic) => diagnostic.type === "error"));
  const activeErrorAnnouncement = profileErrorAnnouncement(error, diagnostics);
  const issueTone = hasError ? "danger" : summary || setupWarnings.length ? "warning" : null;
  const activeToolCount = runtimeTools.length
    ? runtimeTools.filter((tool) => tool.active).length
    : effectiveSnapshot?.tools.activeToolNames.length ?? 0;
  const capabilitySummary = useMemo(() => {
    if (!effectiveSnapshot) return null;
    return [
      presetLabel(effectiveSnapshot.tools.builtinPreset),
      `${activeToolCount} tool${activeToolCount === 1 ? "" : "s"}`,
      `${effectiveSnapshot.plugins.length} plugin${effectiveSnapshot.plugins.length === 1 ? "" : "s"}`,
    ].join(" · ");
  }, [activeToolCount, effectiveSnapshot]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = Math.min(window.innerWidth <= 640 ? 320 : 340, window.innerWidth - 24);
      const viewportLeft = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12));
      setMenuShift(viewportLeft - rect.left);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open]);

  const menuStyle = { "--profile-menu-shift": `${menuShift}px` } as CSSProperties;
  const focusMenuEdge = (edge: "first" | "last") => {
    window.requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)');
      if (!items?.length) return;
      items[edge === "first" ? 0 : items.length - 1]?.focus();
    });
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true);
    focusMenuEdge(event.key === "ArrowDown" ? "first" : "last");
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const selectProfile = (profileRef: ProfileRef | null) => {
    if (disableSelect) return;
    setOpen(false);
    triggerRef.current?.focus();
    void onSelectProfile(profileRef);
  };

  const openManager = () => {
    setOpen(false);
    onBeforeOpenManager?.();
    if (onBeforeOpenManager) window.requestAnimationFrame(onOpenManager);
    else onOpenManager();
  };

  const currentUnavailable = mode === "existing" && !selectedProfileRef;

  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-quick-controls={quickControls || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        data-open={open || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={applying || undefined}
        title={[displayName, summary, disableSelect ? "Profile switching is unavailable right now" : ""].filter(Boolean).join(" · ")}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className={styles.triggerIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 17 8 4 8-4" />
        </svg>
        <span className={styles.triggerLabel}>{applying ? "Applying…" : displayName}</span>
        {issueTone && <span className={styles.issueDot} data-tone={issueTone} aria-hidden="true" />}
        <svg className={styles.chevron} data-open={open || undefined} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="m2 3.5 3 3 3-3" />
        </svg>
      </button>

      {activeErrorAnnouncement && (
        <span className={styles.errorAlert} role="alert" aria-atomic="true">
          {activeErrorAnnouncement}
        </span>
      )}

      {open && (
        <div ref={menuRef} role="menu" aria-label="Profiles" className={styles.menu} style={menuStyle} onKeyDown={handleMenuKeyDown}>
          <header className={styles.menuHeader}>
            <span className={styles.menuEyebrow}>Session capability</span>
            <div className={styles.menuTitleRow}><strong>Profile</strong>{disableSelect && <Badge tone="neutral">locked</Badge>}</div>
            <p>{capabilitySummary ?? "Choose the tool, plugin, and skill boundary for this session."}</p>
          </header>

          <div className={styles.optionList}>
            {mode === "new" && (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!selectedProfileRef}
                disabled={disableSelect}
                className={cx(styles.option, !selectedProfileRef && styles.optionActive)}
                onClick={() => selectProfile(null)}
              >
                <Checkmark visible={!selectedProfileRef} />
                <span className={styles.optionCopy}>
                  <strong>{quickControls ? "Use global default" : "Global default"}</strong>
                  <span>{quickControls ? (globalDefault ? `Currently ${globalDefault.name}` : "Resolved when the session starts") : (globalDefault?.name ?? "Resolved by the server")}</span>
                </span>
                <Badge tone="neutral">{quickControls ? "inherited" : "automatic"}</Badge>
              </button>
            )}

            {currentUnavailable && (
              <div className={cx(styles.option, styles.optionActive, styles.optionUnavailable)}>
                <Checkmark visible />
                <span className={styles.optionCopy}><strong>{displayName}</strong><span>Current session snapshot</span></span>
              </div>
            )}

            {selectedProfileMissing && selectedProfileRef && (
              <div className={cx(styles.option, styles.optionActive, styles.optionUnavailable)}>
                <Checkmark visible />
                <span className={styles.optionCopy}><strong>{displayName}</strong><span>Saved definition is unavailable</span></span>
                <Badge tone="warning">missing</Badge>
              </div>
            )}

            {profiles.map((profile) => {
              const active = selectedProfileRef === profile.id;
              const isDefault = globalDefaultProfileRef === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={disableSelect}
                  className={cx(styles.option, active && styles.optionActive)}
                  onClick={() => selectProfile(profile.id)}
                >
                  <Checkmark visible={active} />
                  <span className={styles.optionCopy}>
                    <strong>{profile.name}</strong>
                    <span>{quickControls && isDefault ? "Pin instead of inheriting the global default" : quickControls ? presetLabel(profile.tools.builtinPreset) : (profile.description || presetLabel(profile.tools.builtinPreset))}</span>
                  </span>
                  {isDefault && <Badge tone="accent">{quickControls ? "global" : "default"}</Badge>}
                </button>
              );
            })}
          </div>

          {(summary || error || setupWarnings.length > 0) && (
            <details className={styles.issues} data-tone={hasError ? "danger" : "warning"}>
              <summary>{error ? "Profile error" : summary ?? "Profile setup"}</summary>
              <div className={styles.issueList}>
                {error && <div data-tone="danger">{error}</div>}
                {conflicts.map((conflict) => <div key={`${conflict.name}:${conflict.pluginSource ?? "builtin"}`}><code>{conflict.name}</code> uses {conflict.pluginSource ?? conflict.selectedProvider}</div>)}
                {diagnostics.filter((diagnostic) => diagnostic.type !== "info").map((diagnostic) => (
                  <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} data-tone={diagnostic.type === "error" ? "danger" : undefined}>{diagnostic.message}</div>
                ))}
                {setupWarnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            </details>
          )}

          <button type="button" role="menuitem" className={styles.manageButton} onClick={openManager}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.36.72.66 1 .3.28.68.42 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.76.6Z" />
            </svg>
            <span><strong>Manage profiles</strong><small>Create, edit, and choose the global default</small></span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </div>
  );
}
