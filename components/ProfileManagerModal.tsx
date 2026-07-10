"use client";

import { useEffect, useMemo, useState } from "react";
import type { PackageSource, ProfileDefinition, ProfileRef, SkillRef } from "@/lib/profiles";
import type { ProfilePreviewResult } from "@/lib/profile-preview";
import type { PluginDiagnostic, PluginsResponse } from "@/lib/api-types";
import type { UseProfilesState } from "@/hooks/useProfiles";
import { ProfileWizard } from "./ProfileWizard";

export interface ProfileManagerModalProps {
  cwd: string | null;
  profilesState: UseProfilesState;
  onClose: () => void;
}

export function ProfileManagerModal({ cwd, profilesState, onClose }: ProfileManagerModalProps) {
  const [editing, setEditing] = useState<ProfileDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [catalogPlugins, setCatalogPlugins] = useState<PackageSource[]>([]);
  const [catalogSkillRefs, setCatalogSkillRefs] = useState<SkillRef[]>([]);
  const [inventoryDiagnostics, setInventoryDiagnostics] = useState<PluginDiagnostic[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        setError(`Failed to load plugin inventory: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      });
    return () => controller.abort();
  }, [cwd]);
  const availablePlugins = useMemo<PackageSource[]>(() => {
    const seen = new Set<string>();
    const out: PackageSource[] = [];
    const orderedProfiles = editing
      ? [editing, ...profilesState.profiles.filter((profile) => profile.id !== editing.id)]
      : profilesState.profiles;
    for (const profile of orderedProfiles) {
      for (const plugin of profile.plugins) {
        const source = typeof plugin === "string" ? plugin : plugin.source;
        if (seen.has(source)) continue;
        seen.add(source);
        out.push(plugin);
      }
    }
    for (const plugin of catalogPlugins) {
      const source = typeof plugin === "string" ? plugin : plugin.source;
      if (seen.has(source)) continue;
      seen.add(source);
      out.push(plugin);
    }
    return out;
  }, [catalogPlugins, editing, profilesState.profiles]);

  const handlePreview = async (draftProfile: unknown): Promise<ProfilePreviewResult> => {
    if (!cwd) throw new Error("Choose a project before previewing a profile.");
    return profilesState.previewProfile({ cwd, draftProfile });
  };

  const handleSave = async (draftProfile: unknown) => {
    setError(null);
    setMessage(null);
    try {
      if (editing) await profilesState.updateProfile(editing.id, draftProfile);
      else await profilesState.createProfile(draftProfile);
      setCreating(false);
      setEditing(null);
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetDefault = async (profileRef: ProfileRef) => {
    setError(null);
    setMessage(null);
    try {
      await profilesState.setGlobalDefaultProfile(profileRef);
      setMessage("Global default updated.");
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
      setMessage("Profile deleted.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.36)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(860px, calc(100vw - 32px))", maxHeight: "min(760px, calc(100vh - 32px))", overflow: "auto", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 48px rgba(0,0,0,0.28)", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Session capability profiles</h2>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Tools, selected packages/plugins, and skills only. Defaults are server-owned.</div>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        {profilesState.warnings.length > 0 && <div style={{ color: "var(--warning)", marginBottom: 8 }}>
          {profilesState.warnings.map((warning) => <div key={warning}>Profile setup: {warning}</div>)}
        </div>}
        {message && <div style={{ color: "var(--success)", marginBottom: 8 }}>{message}</div>}
        {(error || profilesState.error) && <div style={{ color: "var(--danger)", marginBottom: 8 }}>{error ?? profilesState.error}</div>}
        {inventoryDiagnostics.length > 0 && <div style={{ marginBottom: 8 }}>
          {inventoryDiagnostics.map((diagnostic) => (
            <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} style={{ color: diagnostic.type === "error" ? "var(--danger)" : "var(--warning)" }}>
              Plugin inventory {diagnostic.type}: {diagnostic.message}{diagnostic.source ? ` (${diagnostic.source})` : ""}
            </div>
          ))}
        </div>}

        {(creating || editing) ? (
          <ProfileWizard
            cwd={cwd}
            profile={editing}
            availablePlugins={availablePlugins}
            inventorySkillRefs={catalogSkillRefs}
            onPreview={handlePreview}
            onSave={handleSave}
            onCancel={() => { setCreating(false); setEditing(null); }}
          />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Profiles</strong>
              <button type="button" onClick={() => setCreating(true)}>Create profile</button>
            </div>
            {[...profilesState.builtinProfiles, ...profilesState.profiles].map((profile) => {
              const editable = profile.id.startsWith("profile:");
              const isDefault = profilesState.globalDefaultProfileRef === profile.id;
              return (
                <div key={profile.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{profile.name} {isDefault && <span style={{ color: "var(--accent)", fontSize: 12 }}>(global default)</span>}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{profile.id}</div>
                      {profile.description && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{profile.description}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <button type="button" disabled={isDefault} onClick={() => void handleSetDefault(profile.id as ProfileRef)}>Set default</button>
                      {editable && <button type="button" onClick={() => setEditing(profile)}>Edit</button>}
                      {editable && <button type="button" onClick={() => void handleDelete(profile.id)}>Delete</button>}
                    </div>
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Preset: {profile.tools.builtinPreset} · Packages: {profile.plugins.length} · Hidden skills: {profile.skills.disabledSkillRefs?.length ?? 0}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
