"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { APP_DISPLAY_NAME_MAX_LENGTH, type AppSettings, DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import { SAFE_AREA_MODAL_MAX_HEIGHT, SAFE_AREA_MODAL_MAX_WIDTH, SAFE_AREA_MODAL_PADDING } from "@/lib/safe-area";
import type { AgentProfileRef, AgentProfileScope, AgentProfilesResponse, StoredAgentProfile } from "@/lib/api-types";

type RuntimeSettingsScope = "global" | "project";
type RuntimeSettingApplies = "immediate" | "next-request" | "reload" | "new-session";

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
  onRuntimeSettingsChanged?: () => void;
}

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

function appliesText(applies: RuntimeSettingApplies): string {
  switch (applies) {
    case "immediate": return "applies immediately";
    case "next-request": return "next request";
    case "reload": return "/reload required";
    case "new-session": return "new session";
  }
}

function applyBadgeColor(applies: RuntimeSettingApplies): string {
  switch (applies) {
    case "immediate": return "var(--success)";
    case "next-request": return "var(--accent)";
    case "reload": return "var(--warning)";
    case "new-session": return "var(--text-muted)";
  }
}

function parseDraft(setting: RuntimeSettingValue, draft: string): unknown {
  if (setting.type === "boolean") return draft === "true";
  if (setting.type === "number") {
    const value = Number(draft);
    if (!Number.isFinite(value)) throw new Error(`${setting.label} must be a number`);
    if (setting.min !== undefined && value < setting.min) throw new Error(`${setting.label} must be >= ${setting.min}`);
    return value;
  }
  if (setting.allowedValues && !setting.allowedValues.includes(draft)) {
    throw new Error(`${setting.label} must be one of: ${setting.allowedValues.join(", ")}`);
  }
  return draft;
}

function SettingControl({ setting, scope, value, disabled, onChange, onSave, onReset, saving }: {
  setting: RuntimeSettingValue;
  scope: RuntimeSettingsScope;
  value: string;
  disabled?: boolean;
  saving?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const inputStyle = { border: "1px solid var(--border)", borderRadius: 6, background: disabled ? "var(--bg-hover)" : "var(--bg)", color: disabled ? "var(--text-dim)" : "var(--text)", padding: "6px 8px", fontSize: 12, minWidth: 130 };
  let input;
  if (setting.type === "boolean") {
    input = (
      <select value={value || "false"} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  } else if (setting.allowedValues) {
    input = (
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {setting.allowedValues.map((allowed) => <option key={allowed} value={allowed}>{allowed}</option>)}
      </select>
    );
  } else {
    input = (
      <input type={setting.type === "number" ? "number" : "text"} min={setting.min} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={inputStyle} />
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ width: 54, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{scope}</span>
      {input}
      <button type="button" disabled={disabled || saving} onClick={onSave} style={{ border: "1px solid var(--accent)", background: disabled ? "var(--bg-hover)" : "var(--accent)", color: disabled ? "var(--text-dim)" : "white", borderRadius: 6, padding: "6px 9px", fontSize: 12, cursor: disabled || saving ? "default" : "pointer" }}>{saving ? "Saving…" : "Save"}</button>
      <button type="button" disabled={disabled || saving} onClick={onReset} style={{ border: "1px solid var(--border)", background: "var(--bg)", color: disabled ? "var(--text-dim)" : "var(--text-muted)", borderRadius: 6, padding: "6px 9px", fontSize: 12, cursor: disabled || saving ? "default" : "pointer" }}>Reset</button>
    </div>
  );
}
function profileToDraft(profile: { id: string; name: string; description?: string; model?: unknown; thinkingLevel?: unknown; tools?: unknown; instructions?: unknown; resources?: unknown }): string {
  return JSON.stringify({
    id: profile.id,
    name: profile.name,
    description: profile.description ?? "",
    model: profile.model ?? null,
    thinkingLevel: profile.thinkingLevel ?? "auto",
    tools: profile.tools ?? { mode: "preset", preset: "full", includeExtensionTools: true },
    instructions: profile.instructions ?? { mode: "default" },
    resources: profile.resources ?? {},
  }, null, 2);
}

function newProfileDraft(id: string, name: string): string {
  return profileToDraft({
    id,
    name,
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "full", includeExtensionTools: true },
    instructions: { mode: "default" },
    resources: {},
  });
}

export function SettingsModal({ settings, cwd, onClose, onSaved, onOpenModels, onOpenAuth, onOpenScopedModels, onOpenProjectTrust, onRuntimeSettingsChanged }: Props) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<"runtime" | "profiles" | "app" | "integrations">("runtime");
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [savingApp, setSavingApp] = useState(false);
  const [appMessage, setAppMessage] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSettingsResponse | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingRuntimeKey, setSavingRuntimeKey] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<AgentProfilesResponse | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [profilesMessage, setProfilesMessage] = useState<string | null>(null);
  const [profileScope, setProfileScope] = useState<AgentProfileScope>("global");
  const [profileDraft, setProfileDraft] = useState("");
  const [selectedProfileRef, setSelectedProfileRef] = useState<AgentProfileRef | null>(null);
  const selectedProfile = useMemo(() => profiles?.profiles.find((profile) => profile.ref === selectedProfileRef) ?? null, [profiles, selectedProfileRef]);
  const selectedProfileReadonly = selectedProfile?.readonly === true;
  const profileSaveDisabled = selectedProfileReadonly || (profileScope === "project" && profiles?.scopes.project.writable === false);

  useEffect(() => {
    setDisplayName(settings.displayName);
    setAppError(null);
    setAppMessage(null);
  }, [settings.displayName]);

  const normalizedDisplayName = useMemo(() => normalizeInput(displayName), [displayName]);
  const validationError = useMemo(() => {
    if (!normalizedDisplayName) return "Display name cannot be empty.";
    if (normalizedDisplayName.length > APP_DISPLAY_NAME_MAX_LENGTH) {
      return `Display name must be ${APP_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
    }
    return null;
  }, [normalizedDisplayName]);
  const appChanged = normalizedDisplayName !== settings.displayName;

  const seedDrafts = useCallback((response: RuntimeSettingsResponse) => {
    const next: Record<string, string> = {};
    for (const setting of response.settings) {
      next[draftKey(setting.key, "global")] = valueToDraft(setting.globalValue ?? setting.defaultValue);
      if (setting.scopes.includes("project")) next[draftKey(setting.key, "project")] = valueToDraft(setting.projectValue ?? setting.globalValue ?? setting.defaultValue);
    }
    setDrafts(next);
  }, []);

  const loadRuntime = useCallback(async () => {
    if (!cwd) {
      setRuntime(null);
      setRuntimeError("No active project cwd is available.");
      return;
    }
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const res = await fetch(`/api/runtime-settings?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const body = await res.json() as RuntimeSettingsResponse | { error?: string };
      if (!res.ok) throw new Error("error" in body && body.error ? body.error : `HTTP ${res.status}`);
      setRuntime(body as RuntimeSettingsResponse);
      seedDrafts(body as RuntimeSettingsResponse);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeLoading(false);
    }
  }, [cwd, seedDrafts]);
  const loadProfiles = useCallback(async () => {
    if (!cwd) {
      setProfiles(null);
      setProfilesError("No active project cwd is available.");
      return;
    }
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      const res = await fetch(`/api/profiles?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const body = await res.json() as AgentProfilesResponse | { error?: string };
      if (!res.ok) throw new Error("error" in body && body.error ? body.error : `HTTP ${res.status}`);
      const next = body as AgentProfilesResponse;
      setProfiles(next);
      const firstEditable = next.profiles.find((profile) => !profile.readonly) ?? next.profiles[0];
      if (firstEditable) {
        setSelectedProfileRef(firstEditable.ref);
        setProfileScope(firstEditable.source === "project" ? "project" : "global");
        setProfileDraft(profileToDraft(firstEditable));
      }
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : String(error));
    } finally {
      setProfilesLoading(false);
    }
  }, [cwd]);


  useEffect(() => {
    void loadRuntime();
    void loadProfiles();
  }, [loadRuntime, loadProfiles]);

  const saveProfileDraft = async () => {
    if (!cwd || profileSaveDisabled) return;
    setProfilesError(null);
    setProfilesMessage(null);
    try {
      const profile = JSON.parse(profileDraft) as StoredAgentProfile;
      const res = await fetch("/api/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "upsert", scope: profileScope, profile }),
      });
      const body = await res.json() as AgentProfilesResponse | { error?: string };
      if (!res.ok) throw new Error("error" in body && body.error ? body.error : `HTTP ${res.status}`);
      setProfiles(body as AgentProfilesResponse);
      window.dispatchEvent(new CustomEvent("pi-web-profiles-changed", { detail: { cwd } }));
      setSelectedProfileRef(`${profileScope}:${profile.id}` as AgentProfileRef);
      setProfilesMessage(`Saved ${profileScope} profile ${profile.name}.`);
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : String(error));
    }
  };

  const duplicateProfileDraft = async () => {
    if (!cwd) return;
    if (profileScope === "project" && !profiles?.scopes.project.writable) {
      setProfilesError("Project profiles cannot be changed until the project is trusted.");
      return;
    }
    setProfilesError(null);
    setProfilesMessage(null);
    try {
      const profile = JSON.parse(profileDraft) as StoredAgentProfile;
      const copy = {
        ...profile,
        id: `${profile.id}-copy-${Date.now()}`,
        name: `${profile.name} copy`,
        createdAt: undefined,
        updatedAt: undefined,
      } as StoredAgentProfile;
      const res = await fetch("/api/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "upsert", scope: profileScope, profile: copy }),
      });
      const body = await res.json() as AgentProfilesResponse | { error?: string };
      if (!res.ok) throw new Error("error" in body && body.error ? body.error : `HTTP ${res.status}`);
      setProfiles(body as AgentProfilesResponse);
      window.dispatchEvent(new CustomEvent("pi-web-profiles-changed", { detail: { cwd } }));
      setSelectedProfileRef(`${profileScope}:${copy.id}` as AgentProfileRef);
      setProfileDraft(profileToDraft(copy));
      setProfilesMessage(`Duplicated ${profileScope} profile ${copy.name}.`);
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : String(error));
    }
  };

  const mutateProfileRef = async (action: "delete" | "set-default" | "clear-default", ref?: AgentProfileRef, scopeOverride?: AgentProfileScope) => {
    if (!cwd) return;
    const [refScope, ...idParts] = ref?.split(":") ?? [];
    const mutationScope = scopeOverride ?? (action === "delete" && (refScope === "global" || refScope === "project") ? refScope : profileScope);
    const id = idParts.join(":");
    setProfilesError(null);
    setProfilesMessage(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action, scope: mutationScope, ref, id }),
      });
      const body = await res.json() as AgentProfilesResponse | { error?: string };
      if (!res.ok) throw new Error("error" in body && body.error ? body.error : `HTTP ${res.status}`);
      setProfiles(body as AgentProfilesResponse);
      window.dispatchEvent(new CustomEvent("pi-web-profiles-changed", { detail: { cwd } }));
      if (action === "delete") setSelectedProfileRef(null);
      setProfilesMessage(action === "delete" ? "Deleted profile." : "Updated profile default.");
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveApp = async () => {
    if (savingApp) return;
    if (validationError) {
      setAppError(validationError);
      return;
    }
    setSavingApp(true);
    setAppError(null);
    setAppMessage(null);
    try {
      const res = await fetch("/api/app-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: normalizedDisplayName }),
      });
      const data = await res.json() as AppSettings | { error?: string };
      if (!res.ok) throw new Error("error" in data && data.error ? data.error : `HTTP ${res.status}`);
      onSaved(data as AppSettings);
      setAppMessage("Saved web app settings.");
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingApp(false);
    }
  };

  const patchRuntime = async (setting: RuntimeSettingValue, scope: RuntimeSettingsScope, reset = false) => {
    if (!cwd || !runtime) return;
    const key = draftKey(setting.key, scope);
    setSavingRuntimeKey(key);
    setRuntimeError(null);
    setRuntimeMessage(null);
    try {
      const path = scope === "global" ? runtime.scopes.global.path : runtime.scopes.project.path;
      const value = reset ? null : parseDraft(setting, drafts[key] ?? "");
      const res = await fetch("/api/runtime-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope, updates: { [setting.key]: value } }),
      });
      const body = await res.json() as RuntimeSettingsResponse | { error?: string };
      if (!res.ok) throw new Error(`${path}: ${"error" in body && body.error ? body.error : `HTTP ${res.status}`}`);
      setRuntime(body as RuntimeSettingsResponse);
      seedDrafts(body as RuntimeSettingsResponse);
      setRuntimeMessage(`${setting.label} ${reset ? "reset" : "saved"} in ${scope} settings (${path}). ${appliesText(setting.applies)}.`);
      onRuntimeSettingsChanged?.();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRuntimeKey(null);
    }
  };

  const renderTabButton = (id: typeof tab, label: string) => (
    <button type="button" onClick={() => setTab(id)} style={{ border: "none", borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent", background: tab === id ? "var(--bg-selected)" : "transparent", color: tab === id ? "var(--text)" : "var(--text-muted)", padding: "10px 12px", cursor: "pointer", fontSize: 13 }}>{label}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: SAFE_AREA_MODAL_PADDING, boxSizing: "border-box" }}>
      <button type="button" aria-label="Close settings" onClick={onClose} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: "none", background: "transparent", cursor: "default" }} />
      <div style={{ position: "relative", width: isMobile ? "100%" : 900, maxWidth: isMobile ? "100%" : SAFE_AREA_MODAL_MAX_WIDTH, maxHeight: SAFE_AREA_MODAL_MAX_HEIGHT, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Settings</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cwd ?? "No active cwd"}</code>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {renderTabButton("runtime", "Runtime")}
          {renderTabButton("profiles", "Profiles")}
          {renderTabButton("app", "Web app")}
          {renderTabButton("integrations", "Models/Auth")}
        </div>

        <div style={{ padding: 18, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {tab === "runtime" && (
            <>
              {runtimeLoading ? <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading runtime settings…</div> : runtimeError ? <div style={{ color: "#f87171", fontSize: 13 }}>{runtimeError}</div> : runtime && (
                <>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
                    <div>Global: <code>{runtime.scopes.global.path}</code></div>
                    <div>Project: <code>{runtime.scopes.project.path}</code> · {runtime.projectTrusted ? "trusted" : runtime.scopes.project.blockedReason}</div>
                    <div>Trust source: <code>{runtime.projectTrustSource}</code></div>
                  </div>
                  {runtimeMessage && <div style={{ color: "var(--success)", fontSize: 12 }}>{runtimeMessage}</div>}
                  {runtime.settings.map((setting) => {
                    const globalKey = draftKey(setting.key, "global");
                    const projectKey = draftKey(setting.key, "project");
                    return (
                      <section key={setting.key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "var(--bg-panel)", display: "grid", gap: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: "var(--text)", fontWeight: 650, fontSize: 13 }}>{setting.label}</div>
                            <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45 }}>{setting.description}</div>
                            <code style={{ color: "var(--text-dim)", fontSize: 11 }}>{setting.key}</code>
                          </div>
                          <span style={{ border: `1px solid ${applyBadgeColor(setting.applies)}`, color: applyBadgeColor(setting.applies), borderRadius: 999, padding: "2px 7px", fontSize: 10, whiteSpace: "nowrap" }}>{appliesText(setting.applies)}</span>
                        </div>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--text-muted)", fontSize: 12 }}>
                          <span>effective: <strong style={{ color: "var(--text)" }}>{formatValue(setting.effectiveValue)}</strong></span>
                          <span>source: <code>{setting.effectiveScope}</code></span>
                          <span>default: <code>{formatValue(setting.defaultValue)}</code></span>
                        </div>
                        <SettingControl setting={setting} scope="global" value={drafts[globalKey] ?? ""} saving={savingRuntimeKey === globalKey} onChange={(value) => setDrafts((current) => ({ ...current, [globalKey]: value }))} onSave={() => void patchRuntime(setting, "global")} onReset={() => void patchRuntime(setting, "global", true)} />
                        {setting.scopes.includes("project") && (
                          <SettingControl setting={setting} scope="project" value={drafts[projectKey] ?? ""} disabled={setting.projectBlocked || !runtime.scopes.project.writable} saving={savingRuntimeKey === projectKey} onChange={(value) => setDrafts((current) => ({ ...current, [projectKey]: value }))} onSave={() => void patchRuntime(setting, "project")} onReset={() => void patchRuntime(setting, "project", true)} />
                        )}
                      </section>
                    );
                  })}
                </>
              )}
            </>
          )}

          {tab === "profiles" && (
            <section style={{ display: "grid", gap: 12 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
                <div>Global: <code>{profiles?.scopes.global.path ?? "~/.pi/agent/settings.json"}</code></div>
                <div>Project: <code>{profiles?.scopes.project.path ?? "./.pi/settings.json"}</code> · {profiles?.scopes.project.writable ? "writable" : profiles?.scopes.project.blockedReason ?? (profiles?.projectTrusted ? "not writable" : "not trusted")}</div>
                <div>JSON editor supports model, thinkingLevel, tools, instructions.files, and resources.skillPaths/promptPaths/themePaths (including StyleSeed skill paths).</div>
              </div>
              {profilesLoading ? <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading profiles…</div> : !profiles ? (profilesError ? <div style={{ color: "#f87171", fontSize: 13 }}>{profilesError}</div> : null) : (
                <>
                  {profilesError && <div style={{ color: "#f87171", fontSize: 12 }}>{profilesError}</div>}
                  {profilesMessage && <div style={{ color: "var(--success)", fontSize: 12 }}>{profilesMessage}</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                    <span>Defaults:</span>
                    <code>global {profiles.globalDefaultProfileRef ?? "unset"}</code>
                    {profiles.globalDefaultProfileRef && <button type="button" onClick={() => void mutateProfileRef("clear-default", undefined, "global")} style={{ padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer" }}>Clear global</button>}
                    <code>project {profiles.projectDefaultProfileRef ?? "unset"}</code>
                    {profiles.projectDefaultProfileRef && <button type="button" onClick={() => void mutateProfileRef("clear-default", undefined, "project")} style={{ padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer" }}>Clear project</button>}
                    <code>effective {profiles.effectiveDefaultProfileRef}</code>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "220px 1fr", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {profiles.profiles.map((profile) => (
                        <button key={profile.ref} type="button" onClick={() => {
                          setSelectedProfileRef(profile.ref);
                          setProfileScope(profile.source === "project" ? "project" : "global");
                          setProfileDraft(profileToDraft(profile));
                        }} style={{ textAlign: "left", padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 6, background: selectedProfileRef === profile.ref ? "var(--bg-selected)" : "none", color: "var(--text)", cursor: "pointer" }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{profile.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{profile.ref}{profile.readonly ? " · built-in" : ""}</div>
                        </button>
                      ))}
                      <button type="button" onClick={() => { setProfileScope("global"); setSelectedProfileRef(null); setProfileDraft(newProfileDraft(`profile-${Date.now()}`, "New profile")); }} style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--accent)", cursor: "pointer" }}>New global profile</button>
                      <button type="button" disabled={!profiles.scopes.project.writable} onClick={() => { setProfileScope("project"); setSelectedProfileRef(null); setProfileDraft(newProfileDraft(`project-profile-${Date.now()}`, "New project profile")); }} style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: profiles.scopes.project.writable ? "var(--accent)" : "var(--text-dim)", cursor: profiles.scopes.project.writable ? "pointer" : "default" }}>New project profile</button>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--text-muted)" }}>
                        Scope
                        <select value={profileScope} onChange={(event) => setProfileScope(event.target.value as AgentProfileScope)} style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px" }}>
                          <option value="global">Global</option>
                          <option value="project" disabled={!profiles.scopes.project.writable}>Project</option>
                        </select>
                      </label>
                      <textarea value={profileDraft} readOnly={selectedProfileReadonly} onChange={(event) => setProfileDraft(event.target.value)} spellCheck={false} style={{ minHeight: 280, fontFamily: "var(--font-mono)", fontSize: 12, background: selectedProfileReadonly ? "var(--bg-hover)" : "var(--bg)", color: selectedProfileReadonly ? "var(--text-muted)" : "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 10 }} />
                      {selectedProfileReadonly && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Built-in profiles are read-only. Use Duplicate to create an editable profile.</div>}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button type="button" disabled={profileSaveDisabled} onClick={() => void saveProfileDraft()} style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: profileSaveDisabled ? "var(--bg-hover)" : "var(--accent)", color: profileSaveDisabled ? "var(--text-dim)" : "white", cursor: profileSaveDisabled ? "default" : "pointer" }}>Save profile</button>
                        {selectedProfileRef && <button type="button" disabled={profileScope === "project" && !profiles.scopes.project.writable} onClick={() => void duplicateProfileDraft()} style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: profileScope === "project" && !profiles.scopes.project.writable ? "var(--text-dim)" : "var(--text)", cursor: profileScope === "project" && !profiles.scopes.project.writable ? "default" : "pointer" }}>Duplicate</button>}
                        {selectedProfileRef && !selectedProfileRef.startsWith("builtin:") && <button type="button" onClick={() => void mutateProfileRef("delete", selectedProfileRef)} style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "#f87171", cursor: "pointer" }}>Delete</button>}
                        {selectedProfileRef && <button type="button" onClick={() => void mutateProfileRef("set-default", selectedProfileRef)} style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text)", cursor: "pointer" }}>Set as {profileScope} default</button>}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
          {tab === "app" && (
            <section style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Web app display</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Customize the display name shown in the sidebar, new-session welcome screen, and browser title.</div>
                <code style={{ fontSize: 11, color: "var(--text-dim)" }}>~/.pi/agent/web-settings.json</code>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>App display name</span>
                <input value={displayName} onChange={(e) => { setDisplayName(e.target.value); setAppError(null); setAppMessage(null); }} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSaveApp(); if (e.key === "Escape") onClose(); }} maxLength={APP_DISPLAY_NAME_MAX_LENGTH * 2} style={{ padding: "8px 10px", background: "var(--bg-panel)", border: `1px solid ${appError || validationError ? "#f87171" : "var(--border)"}`, borderRadius: 6, color: "var(--text)", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" }} />
              </label>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 11, color: validationError ? "#f87171" : "var(--text-dim)" }}>{validationError ?? `${normalizedDisplayName.length}/${APP_DISPLAY_NAME_MAX_LENGTH} characters`}</span>
                <button type="button" onClick={() => { setDisplayName(DEFAULT_APP_SETTINGS.displayName); setAppError(null); setAppMessage(null); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, padding: 0 }}>Reset to default</button>
              </div>
              {appMessage && <div style={{ color: "var(--success)", fontSize: 12 }}>{appMessage}</div>}
              {appError && <div style={{ color: "#f87171", fontSize: 12 }}>{appError}</div>}
            </section>
          )}

          {tab === "integrations" && (
            <section style={{ display: "grid", gap: 10 }}>
              <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Model selection, provider authentication, scoped model cycling, and project trust remain separate focused flows.</div>
              <button type="button" onClick={onOpenModels} style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--text)", padding: 12, cursor: "pointer" }}>Models</button>
              <button type="button" onClick={onOpenScopedModels} style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--text)", padding: 12, cursor: "pointer" }}>Scoped models</button>
              <button type="button" onClick={onOpenAuth} style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--text)", padding: 12, cursor: "pointer" }}>Provider auth</button>
              <button type="button" onClick={onOpenProjectTrust} style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--text)", padding: 12, cursor: "pointer" }}>Project trust</button>
            </section>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {tab === "runtime" && runtimeError && <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{runtimeError}</span>}
          {tab === "app" && <button type="button" onClick={handleSaveApp} disabled={savingApp || Boolean(validationError) || !appChanged} style={{ padding: "6px 14px", background: appChanged && !validationError ? "var(--accent)" : "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6, color: appChanged && !validationError ? "white" : "var(--text-muted)", cursor: savingApp || validationError || !appChanged ? "default" : "pointer", fontSize: 13, opacity: savingApp ? 0.7 : 1 }}>{savingApp ? "Saving…" : "Save app settings"}</button>}
          <button type="button" onClick={onClose} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>Close</button>
        </div>
      </div>
    </div>
  );
}
