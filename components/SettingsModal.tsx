"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
} from "@/components/ui";
import { APP_DISPLAY_NAME_MAX_LENGTH, type AppSettings, DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import styles from "./SettingsModal.module.css";

type RuntimeSettingsScope = "global" | "project";
type RuntimeSettingApplies = "immediate" | "next-request" | "reload" | "new-session";
type SettingsTab = "runtime" | "app" | "integrations";

type RuntimeSettingValue = {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number" | "string";
  scopes: RuntimeSettingsScope[];
  defaultValue: unknown;
  allowedValues?: string[];
  min?: number;
  applies: RuntimeSettingApplies;
  globalValue: unknown;
  projectValue: unknown;
  effectiveValue: unknown;
  effectiveScope: RuntimeSettingsScope | "default";
  projectBlocked?: boolean;
};

type RuntimeSettingsResponse = {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  projectTrustSource: "none-required" | "saved" | "defaultProjectTrust" | "untrusted";
  scopes: {
    global: { path: string; writable: boolean };
    project: { path: string; writable: boolean; readable: boolean; blockedReason?: string };
  };
  settings: RuntimeSettingValue[];
  changed?: string[];
  reset?: string[];
};

interface Props {
  settings: AppSettings;
  cwd: string | null;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
  onOpenModels?: () => void;
  onOpenAuth?: () => void;
  onOpenScopedModels?: () => void;
  onOpenProjectTrust?: () => void;
}

type RuntimeGroupId = "session" | "context" | "reliability" | "security";
type RuntimeUndo = {
  key: string;
  settingKey: string;
  scope: RuntimeSettingsScope;
  reset: boolean;
  draft?: string;
};

const RUNTIME_GROUPS: Array<{ id: RuntimeGroupId; label: string }> = [
  { id: "session", label: "Session behavior" },
  { id: "context", label: "Context management" },
  { id: "reliability", label: "Reliability" },
  { id: "security", label: "Project security" },
];

function normalizeInput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatValue(value: unknown): string {
  if (value === undefined) return "unset";
  if (value === null) return "null";
  if (typeof value === "string") return value || "\"\"";
  return String(value);
}

function draftKey(settingKey: string, scope: RuntimeSettingsScope): string {
  return `${scope}:${settingKey}`;
}

function valueToDraft(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function settingDraftValue(setting: RuntimeSettingValue, scope: RuntimeSettingsScope): string {
  if (scope === "global") return valueToDraft(setting.globalValue ?? setting.defaultValue);
  return valueToDraft(setting.projectValue ?? setting.globalValue ?? setting.defaultValue);
}

function settingHasOverride(setting: RuntimeSettingValue, scope: RuntimeSettingsScope): boolean {
  return scope === "global" ? setting.globalValue !== undefined : setting.projectValue !== undefined;
}

function appliesText(applies: RuntimeSettingApplies): string {
  switch (applies) {
    case "immediate": return "Immediate";
    case "next-request": return "Next request";
    case "reload": return "Reload required";
    case "new-session": return "New session";
  }
}


function parseDraft(setting: RuntimeSettingValue, draft: string): unknown {
  if (setting.type === "boolean") return draft === "true";
  if (setting.type === "number") {
    const value = Number(draft);
    if (!Number.isFinite(value)) throw new Error(`${setting.label} must be a number.`);
    if (setting.min !== undefined && value < setting.min) throw new Error(`${setting.label} must be ${setting.min} or greater.`);
    return value;
  }
  if (setting.allowedValues && !setting.allowedValues.includes(draft)) {
    throw new Error(`${setting.label} must be one of: ${setting.allowedValues.join(", ")}.`);
  }
  return draft;
}

function canRestoreOverride(setting: RuntimeSettingValue, value: unknown): boolean {
  try {
    parseDraft(setting, valueToDraft(value));
    return true;
  } catch {
    return false;
  }
}

function runtimeGroup(setting: RuntimeSettingValue): RuntimeGroupId {
  if (setting.key.startsWith("compaction.")) return "context";
  if (setting.key.startsWith("retry.")) return "reliability";
  if (setting.key === "defaultProjectTrust") return "security";
  return "session";
}

function seedRuntimeDrafts(response: RuntimeSettingsResponse): Record<string, string> {
  const next: Record<string, string> = {};
  for (const setting of response.settings) {
    next[draftKey(setting.key, "global")] = settingDraftValue(setting, "global");
    if (setting.scopes.includes("project")) {
      next[draftKey(setting.key, "project")] = settingDraftValue(setting, "project");
    }
  }
  return next;
}

function mergeRuntimeDrafts(
  current: Record<string, string>,
  previous: RuntimeSettingsResponse,
  nextResponse: RuntimeSettingsResponse,
  changedKey: string,
): Record<string, string> {
  const merged = { ...current };
  const previousByKey = new Map(previous.settings.map((setting) => [setting.key, setting]));
  for (const setting of nextResponse.settings) {
    const oldSetting = previousByKey.get(setting.key);
    for (const scope of setting.scopes) {
      const key = draftKey(setting.key, scope);
      const oldBaseline = oldSetting?.scopes.includes(scope) ? settingDraftValue(oldSetting, scope) : undefined;
      if (key === changedKey || current[key] === undefined || current[key] === oldBaseline) {
        merged[key] = settingDraftValue(setting, scope);
      }
    }
  }
  return merged;
}

function RuntimeSettingEditor({
  setting,
  value,
  disabled,
  saving,
  dirty,
  hasOverride,
  onChange,
  onSave,
  onReset,
}: {
  setting: RuntimeSettingValue;
  value: string;
  disabled: boolean;
  saving: boolean;
  dirty: boolean;
  hasOverride: boolean;
  onChange: (value: string) => void;
  onSave: (value?: string) => void;
  onReset: () => void;
}) {
  if (setting.type === "boolean") {
    const checked = value === "true";
    return (
      <div className={styles.editor}>
        <div className={styles.switchRow}>
          <Switch
            className={styles.switchControl}
            checked={checked}
            disabled={disabled || saving}
            onCheckedChange={(next) => {
              const draft = String(next);
              onChange(draft);
              onSave(draft);
            }}
            label={checked ? "Enabled" : "Disabled"}
          />
          <Button
            variant="ghost"
            size="compact"
            disabled={disabled || saving || !hasOverride}
            onClick={onReset}
          >
            Reset
          </Button>
        </div>
      </div>
    );
  }

  const control = setting.allowedValues ? (
    <Select value={value} disabled={disabled || saving} onChange={(event) => onChange(event.target.value)}>
      {!setting.allowedValues.includes(value) && (
        <option value={value} disabled>{value ? `${value} (currently unavailable)` : "Unset (runtime default)"}</option>
      )}
      {setting.allowedValues.map((allowed) => <option key={allowed} value={allowed}>{allowed}</option>)}
    </Select>
  ) : (
    <Input
      type={setting.type === "number" ? "number" : "text"}
      min={setting.min}
      value={value}
      disabled={disabled || saving}
      mono={setting.type === "number"}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && dirty && !disabled && !saving) onSave();
      }}
    />
  );

  return (
    <div className={styles.editor}>
      <Field label="Value">{control}</Field>
      <div className={styles.controlActions}>
        <Button variant="ghost" size="compact" disabled={disabled || saving || !hasOverride} onClick={onReset}>
          Reset
        </Button>
        <Button variant="primary" size="compact" loading={saving} disabled={disabled || !dirty} onClick={() => onSave()}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function LoadingSettings() {
  return (
    <output className={styles.loadingGrid} aria-live="polite" aria-label="Loading runtime settings">
      {[0, 1, 2].map((item) => (
        <div className={styles.loadingCard} key={item}>
          <Skeleton width="42%" height={14} />
          <Skeleton width="78%" height={12} />
          <Skeleton width="100%" height={36} />
        </div>
      ))}
    </output>
  );
}

function TabLabel({ children, dirty = false }: { children: ReactNode; dirty?: boolean }) {
  return (
    <span className={styles.tabLabel}>
      <span>{children}</span>
      {dirty && <span className={styles.dirtyDot} aria-hidden="true" />}
    </span>
  );
}

export function SettingsModal({
  settings,
  cwd,
  onClose,
  onSaved,
  onOpenModels,
  onOpenAuth,
  onOpenScopedModels,
  onOpenProjectTrust,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>("runtime");
  const [scope, setScope] = useState<RuntimeSettingsScope>("global");
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [savingApp, setSavingApp] = useState(false);
  const [appMessage, setAppMessage] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSettingsResponse | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);
  const [runtimeFeedbackKey, setRuntimeFeedbackKey] = useState<string | null>(null);
  const [runtimeUndo, setRuntimeUndo] = useState<RuntimeUndo | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingRuntimeKey, setSavingRuntimeKey] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    setDisplayName(settings.displayName);
    setAppError(null);
  }, [settings.displayName]);

  const normalizedDisplayName = useMemo(() => normalizeInput(displayName), [displayName]);
  const validationError = useMemo(() => {
    if (!normalizedDisplayName) return "Display name cannot be empty.";
    if (normalizedDisplayName.length > APP_DISPLAY_NAME_MAX_LENGTH) {
      return `Use ${APP_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
    }
    return null;
  }, [normalizedDisplayName]);
  const appChanged = normalizedDisplayName !== settings.displayName;

  const loadRuntime = useCallback(async () => {
    setRuntimeFeedbackKey(null);
    setRuntimeUndo(null);
    if (!cwd) {
      setRuntime(null);
      setRuntimeLoading(false);
      setRuntimeError("Choose a project before editing runtime settings.");
      return;
    }
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const response = await fetch(`/api/runtime-settings?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const body = await response.json() as RuntimeSettingsResponse | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : `HTTP ${response.status}`);
      const next = body as RuntimeSettingsResponse;
      setRuntime(next);
      setDrafts(seedRuntimeDrafts(next));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadRuntime();
  }, [loadRuntime]);

  const runtimeDirty = useMemo(() => {
    if (!runtime) return false;
    return runtime.settings.some((setting) => setting.scopes.some((settingScope) => {
      const key = draftKey(setting.key, settingScope);
      return drafts[key] !== undefined && drafts[key] !== settingDraftValue(setting, settingScope);
    }));
  }, [drafts, runtime]);
  const hasUnsavedChanges = appChanged || runtimeDirty;

  const handleSaveApp = async () => {
    if (savingApp || validationError || !appChanged) return;
    setSavingApp(true);
    setAppError(null);
    setAppMessage(null);
    try {
      const response = await fetch("/api/app-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: normalizedDisplayName }),
      });
      const data = await response.json() as AppSettings | { error?: string };
      if (!response.ok) throw new Error("error" in data && data.error ? data.error : `HTTP ${response.status}`);
      onSaved(data as AppSettings);
      setAppMessage("Web app settings saved.");
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingApp(false);
    }
  };

  const patchRuntime = async (
    setting: RuntimeSettingValue,
    targetScope: RuntimeSettingsScope,
    reset = false,
    draftOverride?: string,
    recordUndo = true,
  ) => {
    if (!cwd || !runtime || savingRuntimeKey) return;
    const key = draftKey(setting.key, targetScope);
    const previousHadOverride = settingHasOverride(setting, targetScope);
    const previousValue = targetScope === "global" ? setting.globalValue : setting.projectValue;
    setSavingRuntimeKey(key);
    setRuntimeFeedbackKey(key);
    setRuntimeUndo(null);
    setRuntimeError(null);
    setRuntimeMessage(null);
    try {
      const path = targetScope === "global" ? runtime.scopes.global.path : runtime.scopes.project.path;
      const value = reset ? null : parseDraft(setting, draftOverride ?? drafts[key] ?? "");
      const response = await fetch("/api/runtime-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: targetScope, updates: { [setting.key]: value } }),
      });
      const body = await response.json() as RuntimeSettingsResponse | { error?: string };
      if (!response.ok) {
        throw new Error(`${path}: ${"error" in body && body.error ? body.error : `HTTP ${response.status}`}`);
      }
      const next = body as RuntimeSettingsResponse;
      setDrafts((current) => mergeRuntimeDrafts(current, runtime, next, key));
      setRuntime(next);
      if (recordUndo && (!previousHadOverride || canRestoreOverride(setting, previousValue))) {
        setRuntimeUndo({
          key,
          settingKey: setting.key,
          scope: targetScope,
          reset: !previousHadOverride,
          draft: previousHadOverride ? valueToDraft(previousValue) : undefined,
        });
      }
      setRuntimeMessage(recordUndo
        ? `${setting.label} ${reset ? "reset" : "saved"} for ${targetScope}. ${appliesText(setting.applies)}.`
        : `${setting.label} restored for ${targetScope}. ${appliesText(setting.applies)}.`);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRuntimeKey(null);
    }
  };

  const undoRuntimeChange = () => {
    if (!runtime || !runtimeUndo) return;
    const setting = runtime.settings.find((candidate) => candidate.key === runtimeUndo.settingKey);
    if (!setting) return;
    void patchRuntime(setting, runtimeUndo.scope, runtimeUndo.reset, runtimeUndo.draft, false);
  };

  const requestAction = useCallback((action: () => void) => {
    if (savingApp) return;
    if (hasUnsavedChanges) {
      setPendingAction(() => action);
      setDiscardOpen(true);
      return;
    }
    action();
  }, [hasUnsavedChanges, savingApp]);

  const requestClose = useCallback(() => {
    if (savingApp) return;
    requestAction(onClose);
  }, [onClose, requestAction, savingApp]);

  const closeDiscardDialog = useCallback(() => {
    setDiscardOpen(false);
    setPendingAction(null);
  }, []);

  const confirmDiscard = useCallback(() => {
    const action = pendingAction;
    setDiscardOpen(false);
    setPendingAction(null);
    if (action) action();
    else onClose();
  }, [onClose, pendingAction]);

  const visibleSettings = useMemo(() => {
    if (!runtime) return [];
    return runtime.settings.filter((setting) => setting.scopes.includes(scope));
  }, [runtime, scope]);

  const groupedSettings = useMemo(() => RUNTIME_GROUPS.map((group) => ({
    ...group,
    settings: visibleSettings.filter((setting) => runtimeGroup(setting) === group.id),
  })).filter((group) => group.settings.length > 0), [visibleSettings]);

  const projectBlocked = Boolean(runtime && scope === "project" && (
    !runtime.scopes.project.readable || !runtime.scopes.project.writable || !runtime.projectTrusted
  ));
  const selectedScopePath = runtime ? runtime.scopes[scope].path : cwd ?? "No active project";
  const selectedScopeWritable = runtime ? runtime.scopes[scope].writable : false;

  const tabOptions = [
    { value: "runtime", label: <TabLabel dirty={runtimeDirty}>Runtime</TabLabel>, ariaLabel: runtimeDirty ? "Runtime, unsaved changes" : "Runtime", disabled: savingApp && tab !== "runtime" },
    { value: "app", label: <TabLabel dirty={appChanged}>Web app</TabLabel>, ariaLabel: appChanged ? "Web app, unsaved changes" : "Web app", disabled: savingApp && tab !== "app" },
    { value: "integrations", label: <TabLabel>Integrations</TabLabel>, disabled: savingApp && tab !== "integrations" },
  ];

  const integrationItems: Array<{ title: string; description: string; action?: () => void }> = [
    { title: "Models", description: "Configure providers, model metadata, and API formats.", action: onOpenModels },
    { title: "Scoped models", description: "Manage the model set available while cycling within a session.", action: onOpenScopedModels },
    { title: "Provider authentication", description: "Connect subscriptions and manage provider API keys.", action: onOpenAuth },
    { title: "Project trust", description: "Review local resources and decide whether this project may load them.", action: onOpenProjectTrust },
  ];

  return (
    <>
      <Dialog
        open
        onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}
        title="Settings"
        description={<code>{cwd ?? "No active project"}</code>}
        variant="adaptive"
        size="lg"
        dismissible={!savingApp}
        bodyClassName={styles.body}
      >
        <div className={styles.workspace}>
          <div className={styles.stickyControls}>
          <div className={styles.navigation}>
            <SegmentedControl
              value={tab}
              options={tabOptions}
              onValueChange={(next) => setTab(next as SettingsTab)}
              label="Settings section"
              fullWidth
            />
          </div>
          {tab === "runtime" && (
            <div className={styles.scopeToolbar}>
              <SegmentedControl
                value={scope}
                options={[
                  { value: "global", label: "Global" },
                  { value: "project", label: "Project", disabled: !cwd },
                ]}
                onValueChange={(next) => {
                  setScope(next as RuntimeSettingsScope);
                  setRuntimeMessage(null);
                  setRuntimeError(null);
                  setRuntimeFeedbackKey(null);
                  setRuntimeUndo(null);
                }}
                label="Runtime settings scope"
                fullWidth
              />
              <code className={styles.scopePath} title={selectedScopePath}>{selectedScopePath}</code>
            </div>
          )}
        </div>

        <div className={styles.content}>
          {tab === "runtime" && (
            runtimeLoading ? (
                <LoadingSettings />
              ) : runtimeError && !runtime ? (
                <Notice
                  tone="danger"
                  title="Runtime settings could not be loaded"
                  actions={<Button size="compact" onClick={() => void loadRuntime()}>Retry</Button>}
                >
                  {runtimeError}
                </Notice>
              ) : runtime ? (
                <>
                  <div className={styles.summary}>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Active scope</span>
                      <span className={styles.summaryValue}><code>{scope}</code></span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Write access</span>
                      <span className={styles.summaryValue}>{selectedScopeWritable ? "Available" : "Blocked"}</span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Project trust</span>
                      <span className={styles.summaryValue}>
                        {runtime.projectTrusted ? "Trusted" : "Not trusted"} · <code>{runtime.projectTrustSource}</code>
                      </span>
                    </div>
                  </div>

                  {projectBlocked && (
                    <Notice
                      tone="warning"
                      title="Project settings are locked"
                      actions={onOpenProjectTrust ? (
                        <Button size="compact" onClick={() => requestAction(onOpenProjectTrust)}>Open trust</Button>
                      ) : undefined}
                    >
                      {runtime.scopes.project.blockedReason ?? "Trust this project before editing project-local settings."}
                    </Notice>
                  )}
                  {runtimeError && !runtimeFeedbackKey && <Notice tone="danger" title="Runtime settings error">{runtimeError}</Notice>}

                  {groupedSettings.length > 0 ? (
                    <div className={styles.runtimeGroups}>
                      {groupedSettings.map((group) => (
                        <section className={styles.settingsGroup} key={group.id}>
                          <div className={styles.groupHeading}>
                            <h3 className={styles.groupTitle}>{group.label}</h3>
                            <span className={styles.groupCount}>
                              {group.settings.length} {group.settings.length === 1 ? "setting" : "settings"}
                            </span>
                          </div>
                          <div className={styles.settingsGrid}>
                            {group.settings.map((setting) => {
                              const key = draftKey(setting.key, scope);
                              const value = drafts[key] ?? settingDraftValue(setting, scope);
                              const dirty = value !== settingDraftValue(setting, scope);
                              const hasOverride = settingHasOverride(setting, scope);
                              const saving = savingRuntimeKey === key;
                              const anotherSettingSaving = savingRuntimeKey !== null && !saving;
                              const disabled = projectBlocked || !selectedScopeWritable || anotherSettingSaving;
                              return (
                                <article className={styles.settingCard} key={setting.key}>
                                  <div className={styles.cardHeader}>
                                    <div className={styles.cardCopy}>
                                      <div className={styles.cardTitle}>{setting.label}</div>
                                      <div className={styles.cardDescription}>{setting.description}</div>
                                      <code className={styles.settingKey}>{setting.key}</code>
                                    </div>
                                    <div className={styles.cardBadges}>
                                      <span>{hasOverride ? "Override" : scope === "project" ? "Inherited" : "Default"}</span>
                                      <span aria-hidden="true">·</span>
                                      <span>{appliesText(setting.applies)}</span>
                                    </div>
                                  </div>
                                  <div className={styles.metaGrid}>
                                    <div className={styles.metaItem}>
                                      <span className={styles.metaLabel}>Effective</span>
                                      <span className={`${styles.metaValue} ${styles.metaValueStrong}`} title={formatValue(setting.effectiveValue)}>
                                        {formatValue(setting.effectiveValue)}
                                      </span>
                                    </div>
                                    <div className={styles.metaItem}>
                                      <span className={styles.metaLabel}>Source</span>
                                      <span className={styles.metaValue}>{setting.effectiveScope}</span>
                                    </div>
                                    <div className={styles.metaItem}>
                                      <span className={styles.metaLabel}>Default</span>
                                      <span className={styles.metaValue} title={formatValue(setting.defaultValue)}>{formatValue(setting.defaultValue)}</span>
                                    </div>
                                  </div>
                                  <RuntimeSettingEditor
                                    setting={setting}
                                    value={value}
                                    disabled={disabled || Boolean(setting.projectBlocked && scope === "project")}
                                    saving={saving}
                                    dirty={dirty}
                                    hasOverride={hasOverride}
                                    onChange={(next) => {
                                      setDrafts((current) => ({ ...current, [key]: next }));
                                      setRuntimeMessage(null);
                                      setRuntimeError(null);
                                      setRuntimeFeedbackKey(null);
                                      setRuntimeUndo(null);
                                    }}
                                    onSave={(next) => void patchRuntime(setting, scope, false, next)}
                                    onReset={() => void patchRuntime(setting, scope, true)}
                                  />
                                  {runtimeFeedbackKey === key && runtimeMessage && (
                                    <Notice
                                      tone="success"
                                      title="Setting updated"
                                      actions={runtimeUndo?.key === key ? (
                                        <Button size="compact" onClick={undoRuntimeChange}>Undo</Button>
                                      ) : undefined}
                                    >
                                      {runtimeMessage}
                                    </Notice>
                                  )}
                                  {runtimeFeedbackKey === key && runtimeError && (
                                    <Notice tone="danger" title="Setting was not updated">{runtimeError}</Notice>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No settings in this scope" description="Switch scope to view the available runtime settings." />
                  )}
                </>
              ) : null
          )}

          {tab === "app" && (
            <section className={styles.appPanel}>
              <div className={styles.sectionIntro}>
                <h3 className={styles.sectionTitle}>Web app display</h3>
                <p className={styles.sectionDescription}>
                  Customize the name shown in the sidebar, new-session screen, browser title, and installed PWA.
                </p>
                <code className={styles.filePath}>~/.pi/agent/web-settings.json</code>
              </div>
              {appMessage && <Notice tone="success" title="Settings saved">{appMessage}</Notice>}
              {appError && <Notice tone="danger" title="Settings were not saved">{appError}</Notice>}
              <Field
                label="App display name"
                error={validationError}
                hint={(
                  <span className={styles.fieldHint}>
                    <span>Used across pi-web chrome.</span>
                    <span>{normalizedDisplayName.length}/{APP_DISPLAY_NAME_MAX_LENGTH}</span>
                  </span>
                )}
              >
                <Input
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setAppError(null);
                    setAppMessage(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void handleSaveApp();
                  }}
                  maxLength={APP_DISPLAY_NAME_MAX_LENGTH * 2}
                  autoComplete="off"
                />
              </Field>
              <div className={styles.controlActions}>
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={displayName === DEFAULT_APP_SETTINGS.displayName || savingApp}
                  onClick={() => {
                    setDisplayName(DEFAULT_APP_SETTINGS.displayName);
                    setAppError(null);
                    setAppMessage(null);
                  }}
                >
                  Reset
                </Button>
                <Button
                  variant="primary"
                  size="compact"
                  loading={savingApp}
                  disabled={Boolean(validationError) || !appChanged}
                  onClick={() => void handleSaveApp()}
                >
                  Apply
                </Button>
              </div>
            </section>
          )}

          {tab === "integrations" && (
            <section className={styles.appPanel}>
              <div className={styles.sectionIntro}>
                <h3 className={styles.sectionTitle}>Focused configuration</h3>
                <p className={styles.sectionDescription}>
                  Open each focused editor without combining unrelated settings into one oversized form.
                </p>
              </div>
              <div className={styles.integrationGrid}>
                {integrationItems.map((item) => (
                  <button
                    className={styles.integrationCard}
                    type="button"
                    key={item.title}
                    disabled={!item.action}
                    onClick={() => { if (item.action) requestAction(item.action); }}
                  >
                    <span>
                      <span className={styles.integrationTitle}>{item.title}</span>
                      <span className={styles.integrationDescription}>{item.description}</span>
                    </span>
                    <svg className={styles.integrationArrow} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="13 6 19 12 13 18" />
                    </svg>
                  </button>
                ))}
              </div>
            </section>
          )}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={discardOpen}
        onOpenChange={(nextOpen) => { if (!nextOpen) closeDiscardDialog(); }}
        title="Discard unsaved changes?"
        description="Your edited values have not been saved."
        variant="sheet"
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={closeDiscardDialog}>Keep editing</Button>
            <Button variant="danger" onClick={confirmDiscard}>Discard changes</Button>
          </>
        )}
      >
        <Notice tone="warning" title="Unsaved settings">
          {appChanged && runtimeDirty
            ? "The web app and runtime sections both contain unsaved changes."
            : appChanged
              ? "The web app section contains an unsaved display name."
              : "One or more runtime settings contain unapplied values."}
        </Notice>
      </Dialog>
    </>
  );
}
