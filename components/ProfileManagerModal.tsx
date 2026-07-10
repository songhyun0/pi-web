"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { UseProfilesState } from "@/hooks/useProfiles";
import type { PluginDiagnostic, PluginsResponse } from "@/lib/api-types";
import type { ProfilePreviewResult } from "@/lib/profile-preview";
import type { PackageSource, ProfileDefinition, ProfileRef, SkillRef, ToolPreset } from "@/lib/profiles";
import { SAFE_AREA_MODAL_MAX_HEIGHT, SAFE_AREA_MODAL_MAX_WIDTH, SAFE_AREA_MODAL_PADDING } from "@/lib/safe-area";
import { ProfileWizard } from "./ProfileWizard";

const ERROR_COLOR = "#ef4444";
const WARNING_COLOR = "#f59e0b";
const SUCCESS_COLOR = "#22c55e";

function shortenPath(value: string): string {
  return value.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function presetLabel(preset: ToolPreset): string {
  if (preset === "none") return "No built-ins";
  if (preset === "full") return "Full tools";
  return "Standard tools";
}

function profileSummary(profile: ProfileDefinition): string {
  const parts = [
    presetLabel(profile.tools.builtinPreset),
    `${profile.plugins.length} plugin${profile.plugins.length === 1 ? "" : "s"}`,
  ];
  const hiddenSkills = profile.skills.disabledSkillRefs?.length ?? 0;
  if (hiddenSkills) parts.push(`${hiddenSkills} skill${hiddenSkills === 1 ? "" : "s"} off`);
  return parts.join(" · ");
}

function actionButtonStyle(options: { danger?: boolean; primary?: boolean; disabled?: boolean } = {}) {
  const { danger, primary, disabled } = options;
  return {
    padding: "6px 10px",
    border: primary ? "1px solid var(--accent)" : "1px solid var(--border)",
    borderRadius: 6,
    background: primary ? "var(--accent)" : danger ? "rgba(239,68,68,0.08)" : "transparent",
    color: primary ? "white" : danger ? ERROR_COLOR : "var(--text-muted)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontSize: 12,
    whiteSpace: "nowrap" as const,
  };
}

function noticeStyle(color: string) {
  return {
    border: `1px solid color-mix(in srgb, ${color} 34%, var(--border))`,
    borderRadius: 8,
    padding: "8px 10px",
    background: `color-mix(in srgb, ${color} 7%, transparent)`,
    color,
    fontSize: 12,
    lineHeight: 1.4,
  };
}

export interface ProfileManagerModalProps {
  cwd: string | null;
  profilesState: UseProfilesState;
  onClose: () => void;
}

export function ProfileManagerModal({ cwd, profilesState, onClose }: ProfileManagerModalProps) {
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState<ProfileDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [catalogPlugins, setCatalogPlugins] = useState<PackageSource[]>([]);
  const [catalogSkillRefs, setCatalogSkillRefs] = useState<SkillRef[]>([]);
  const [inventoryDiagnostics, setInventoryDiagnostics] = useState<PluginDiagnostic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProfileRef | null>(null);

  useEffect(() => {
    if (!cwd) {
      setCatalogPlugins([]);
      setCatalogSkillRefs([]);
      setInventoryDiagnostics([]);
      return;
    }
    setError(null);
    const controller = new AbortController();
    fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as PluginsResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body;
      })
      .then((body) => {
        setCatalogPlugins((body.packages ?? []).map((plugin) => plugin.packageSource));
        setInventoryDiagnostics(body.diagnostics ?? []);
        const seenSkills = new Set<string>();
        setCatalogSkillRefs((body.packages ?? []).flatMap((plugin) => (plugin.resources ?? [])
          .filter((resource) => resource.kind === "skill")
          .map((resource): SkillRef => ({
            source: plugin.source,
            scope: "package",
            path: resource.relativePath,
            name: resource.name,
          }))
          .filter((skill) => {
            const key = `${skill.source}\0${skill.path}`;
            if (seenSkills.has(key)) return false;
            seenSkills.add(key);
            return true;
          })));
      })
      .catch((fetchError) => {
        if ((fetchError as Error).name === "AbortError") return;
        setCatalogPlugins([]);
        setCatalogSkillRefs([]);
        setInventoryDiagnostics([]);
        setError(`Could not load plugins: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      });
    return () => controller.abort();
  }, [cwd]);

  const availablePlugins = useMemo<PackageSource[]>(() => {
    const seen = new Set<string>();
    const output: PackageSource[] = [];
    const orderedProfiles = editing
      ? [editing, ...profilesState.profiles.filter((profile) => profile.id !== editing.id)]
      : profilesState.profiles;
    for (const profile of orderedProfiles) {
      for (const plugin of profile.plugins) {
        const source = typeof plugin === "string" ? plugin : plugin.source;
        if (seen.has(source)) continue;
        seen.add(source);
        output.push(plugin);
      }
    }
    for (const plugin of catalogPlugins) {
      const source = typeof plugin === "string" ? plugin : plugin.source;
      if (seen.has(source)) continue;
      seen.add(source);
      output.push(plugin);
    }
    return output;
  }, [catalogPlugins, editing, profilesState.profiles]);

  const profileList = useMemo(() => (
    [...profilesState.builtinProfiles, ...profilesState.profiles].sort((left, right) => {
      const leftDefault = left.id === profilesState.globalDefaultProfileRef ? 1 : 0;
      const rightDefault = right.id === profilesState.globalDefaultProfileRef ? 1 : 0;
      return rightDefault - leftDefault;
    })
  ), [profilesState.builtinProfiles, profilesState.globalDefaultProfileRef, profilesState.profiles]);

  const previewProfile = profilesState.previewProfile;
  const handlePreview = useCallback(async (draftProfile: unknown): Promise<ProfilePreviewResult> => {
    if (!cwd) throw new Error("Choose a project before checking this profile.");
    return previewProfile({ cwd, draftProfile });
  }, [cwd, previewProfile]);

  const handleSave = async (draftProfile: unknown) => {
    setError(null);
    setMessage(null);
    try {
      if (editing) await profilesState.updateProfile(editing.id, draftProfile);
      else await profilesState.createProfile(draftProfile);
      setCreating(false);
      setEditing(null);
      setMessage("Profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const handleSetDefault = async (profileRef: ProfileRef) => {
    setError(null);
    setMessage(null);
    try {
      await profilesState.setGlobalDefaultProfile(profileRef);
      setMessage("Default profile updated.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const handleDelete = async (profileRef: ProfileRef) => {
    setError(null);
    setMessage(null);
    try {
      const replacement = profilesState.globalDefaultProfileRef === profileRef
        ? profilesState.builtinProfiles[0]?.id as ProfileRef | undefined
        : undefined;
      await profilesState.deleteProfile(profileRef, replacement);
      setConfirmDelete(null);
      setMessage("Profile deleted.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const startCreating = () => {
    setMessage(null);
    setError(null);
    setConfirmDelete(null);
    setEditing(null);
    setCreating(true);
  };

  const startEditing = (profile: ProfileDefinition) => {
    setMessage(null);
    setError(null);
    setConfirmDelete(null);
    setCreating(false);
    setEditing(profile);
  };

  const title = creating ? "New profile" : editing ? "Edit profile" : "Profiles";
  const visibleError = error ?? profilesState.error;

  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: SAFE_AREA_MODAL_PADDING, boxSizing: "border-box" }}>
      <button type="button" aria-label="Close profiles" onClick={onClose} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: "none", background: "transparent", cursor: "default" }} />
      <div style={{ position: "relative", width: isMobile ? "100%" : 720, maxWidth: isMobile ? "100%" : SAFE_AREA_MODAL_MAX_WIDTH, maxHeight: SAFE_AREA_MODAL_MAX_HEIGHT, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
            {cwd && <code title={cwd} style={{ display: "block", marginTop: 2, color: "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortenPath(cwd)}</code>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        <div style={{ padding: isMobile ? 12 : 16, overflow: "auto", display: "grid", gap: 12 }}>
          {message && <div style={noticeStyle(SUCCESS_COLOR)}>{message}</div>}
          {visibleError && <div role="alert" style={noticeStyle(ERROR_COLOR)}>{visibleError}</div>}
          {!creating && !editing && profilesState.warnings.length > 0 && (
            <details style={{ ...noticeStyle(WARNING_COLOR), color: "var(--text-muted)" }}>
              <summary style={{ cursor: "pointer", color: WARNING_COLOR }}>Profile setup notice</summary>
              <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                {profilesState.warnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            </details>
          )}
          {!creating && !editing && inventoryDiagnostics.length > 0 && (
            <details style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>
              <summary style={{ cursor: "pointer" }}>{inventoryDiagnostics.length} plugin inventory issue{inventoryDiagnostics.length === 1 ? "" : "s"}</summary>
              <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
                {inventoryDiagnostics.map((diagnostic) => (
                  <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} style={{ color: diagnostic.type === "error" ? ERROR_COLOR : "var(--text-muted)" }}>
                    {diagnostic.message}{diagnostic.source ? <code style={{ display: "block", marginTop: 2, color: "var(--text-dim)", fontSize: 10 }}>{diagnostic.source}</code> : null}
                  </div>
                ))}
              </div>
            </details>
          )}

          {(creating || editing) ? (
            <ProfileWizard
              cwd={cwd}
              profile={editing}
              availablePlugins={availablePlugins}
              inventorySkillRefs={catalogSkillRefs}
              onPreview={handlePreview}
              onSave={handleSave}
              onCancel={() => { setCreating(false); setEditing(null); setError(null); }}
            />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{profileList.length} profile{profileList.length === 1 ? "" : "s"}</span>
                <button type="button" onClick={startCreating} style={actionButtonStyle({ primary: true })}>+ New profile</button>
              </div>

              {profilesState.loading && profileList.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading profiles…</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {profileList.map((profile) => {
                    const editable = profile.id.startsWith("profile:");
                    const isDefault = profilesState.globalDefaultProfileRef === profile.id;
                    const deleting = confirmDelete === profile.id;
                    return (
                      <section key={profile.id} style={{ border: `1px solid ${isDefault ? "color-mix(in srgb, var(--accent) 42%, var(--border))" : "var(--border)"}`, borderRadius: 9, padding: "11px 12px", background: "var(--bg-panel)", display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                              <span style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.name}</span>
                              {isDefault && <span style={{ flexShrink: 0, borderRadius: 999, padding: "1px 6px", background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", fontSize: 10 }}>Default</span>}
                              {!editable && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>Built-in</span>}
                            </div>
                            {profile.description && <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.35 }}>{profile.description}</div>}
                            <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 11 }}>{profileSummary(profile)}</div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: isMobile ? "flex-start" : "flex-end", gap: 5, flexWrap: "wrap", flexShrink: 0 }}>
                            {deleting ? (
                              <>
                                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Delete?</span>
                                <button type="button" onClick={() => setConfirmDelete(null)} style={actionButtonStyle()}>Cancel</button>
                                <button type="button" onClick={() => void handleDelete(profile.id)} style={actionButtonStyle({ danger: true })}>Delete</button>
                              </>
                            ) : (
                              <>
                                {!isDefault && <button type="button" onClick={() => void handleSetDefault(profile.id as ProfileRef)} style={actionButtonStyle()}>Make default</button>}
                                {editable && <button type="button" onClick={() => startEditing(profile)} style={actionButtonStyle()}>Edit</button>}
                                {editable && <button type="button" onClick={() => setConfirmDelete(profile.id)} style={actionButtonStyle({ danger: true })}>Delete</button>}
                              </>
                            )}
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
