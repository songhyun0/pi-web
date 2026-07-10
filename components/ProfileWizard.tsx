"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PackageSource, ProfileDefinition, SkillRef, ToolPreset } from "@/lib/profiles";
import type { ProfilePreviewResult } from "@/lib/profile-preview";
import { reconcileHiddenSkillRefsForPlugins, updatePackageSkillVisibility } from "@/lib/profile-ui-core";

type Draft = {
  name: string;
  description: string;
  builtinPreset: ToolPreset;
  plugins: PackageSource[];
  hiddenSkillRefs: SkillRef[];
};

type Action =
  | { type: "name"; value: string }
  | { type: "description"; value: string }
  | { type: "preset"; value: ToolPreset }
  | { type: "plugins"; value: PackageSource[] }
  | { type: "hiddenSkillRefs"; value: SkillRef[] }
  | { type: "reset"; value: Draft };

function profileToDraft(profile?: ProfileDefinition | null): Draft {
  return {
    name: profile?.name ?? "New profile",
    description: profile?.description ?? "",
    builtinPreset: profile?.tools.builtinPreset ?? "default",
    plugins: profile?.plugins ?? [],
    hiddenSkillRefs: profile?.skills.disabledSkillRefs ?? [],
  };
}

function pluginSource(plugin: PackageSource): string {
  return typeof plugin === "string" ? plugin : plugin.source;
}


function reducer(state: Draft, action: Action): Draft {
  switch (action.type) {
    case "name": return { ...state, name: action.value };
    case "description": return { ...state, description: action.value };
    case "preset": return { ...state, builtinPreset: action.value };
    case "plugins": {
      const sources = action.value.map(pluginSource);
      return { ...state, plugins: action.value, hiddenSkillRefs: reconcileHiddenSkillRefsForPlugins(state.hiddenSkillRefs, sources) };
    }
    case "hiddenSkillRefs": return { ...state, hiddenSkillRefs: action.value };
    case "reset": return action.value;
  }
}

export function draftToProfileInput(draft: Draft) {
  return {
    name: draft.name,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    tools: { builtinPreset: draft.builtinPreset, pluginTools: "fromSelectedPlugins" as const },
    plugins: draft.plugins,
    skills: { mode: "pluginDefaultThenNarrow" as const, disabledSkillRefs: draft.hiddenSkillRefs },
  };
}

export interface ProfileWizardProps {
  cwd: string | null;
  profile?: ProfileDefinition | null;
  availablePlugins?: PackageSource[];
  inventorySkillRefs?: SkillRef[];
  onPreview: (draftProfile: unknown) => Promise<ProfilePreviewResult>;
  onSave: (draftProfile: unknown) => Promise<void>;
  onCancel: () => void;
}

export function ProfileWizard({ cwd, profile, availablePlugins = [], inventorySkillRefs = [], onPreview, onSave, onCancel }: ProfileWizardProps) {
  const [draft, dispatch] = useReducer(reducer, profileToDraft(profile));
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<ProfilePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const removedPluginsRef = useRef(new Map<string, PackageSource>());

  useEffect(() => {
    removedPluginsRef.current.clear();
    dispatch({ type: "reset", value: profileToDraft(profile) });
  }, [profile]);

  const input = useMemo(() => draftToProfileInput(draft), [draft]);
  const selectedSources = useMemo(() => new Set(draft.plugins.map(pluginSource)), [draft.plugins]);
  const previewSkillRefs = useMemo(() => {
    const byKey = new Map<string, SkillRef>();
    for (const skill of [
      ...inventorySkillRefs.filter((candidate) => selectedSources.has(candidate.source)),
      ...(preview?.skills.visibleSkillRefs ?? []),
      ...(preview?.skills.hiddenSkillRefs ?? []),
    ]) {
      byKey.set(`${skill.source}\0${skill.path}`, skill);
    }
    return [...byKey.values()];
  }, [inventorySkillRefs, preview, selectedSources]);
  const visibleSkillKeys = useMemo(() => new Set(
    (preview?.skills.visibleSkillRefs ?? []).map((skill) => `${skill.source}\0${skill.path}`),
  ), [preview]);

  useEffect(() => {
    if ((step !== 3 && step !== 4) || !cwd) return;
    let cancelled = false;
    setPreviewError(null);
    onPreview(input)
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((error) => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [cwd, input, onPreview, step]);

  const steps = ["Profile creation", "Base tool preset", "Plugin on/off", "Skill on/off narrowing", "Effective preview"];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {steps.map((label, index) => <button key={label} type="button" onClick={() => setStep(index)} style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "4px 8px", background: step === index ? "var(--bg-selected)" : "var(--bg)", color: step === index ? "var(--text)" : "var(--text-muted)", fontSize: 12 }}>{index + 1}. {label}</button>)}
      </div>

      {step === 0 && <div style={{ display: "grid", gap: 8 }}>
        <label>Name <input value={draft.name} onChange={(e) => dispatch({ type: "name", value: e.target.value })} style={{ width: "100%" }} /></label>
        <label>Description <textarea value={draft.description} onChange={(e) => dispatch({ type: "description", value: e.target.value })} style={{ width: "100%", minHeight: 70 }} /></label>
      </div>}

      {step === 1 && <div style={{ display: "flex", gap: 8 }}>
        {(["none", "default", "full"] as ToolPreset[]).map((preset) => <button key={preset} type="button" onClick={() => dispatch({ type: "preset", value: preset })} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: draft.builtinPreset === preset ? "var(--bg-selected)" : "var(--bg)" }}>{preset}</button>)}
      </div>}

      {step === 2 && <div style={{ display: "grid", gap: 6 }}>
        {availablePlugins.length === 0 && <div style={{ color: "var(--text-muted)" }}>No plugin inventory is loaded yet. You can still save with the current selected packages.</div>}
        {availablePlugins.map((plugin) => {
          const source = pluginSource(plugin);
          const checked = selectedSources.has(source);
          return <label key={source} style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={checked} onChange={(event) => {
            let next: PackageSource[];
            if (event.target.checked) {
              next = [...draft.plugins, removedPluginsRef.current.get(source) ?? plugin];
              removedPluginsRef.current.delete(source);
            } else {
              const selected = draft.plugins.find((item) => pluginSource(item) === source);
              if (selected) removedPluginsRef.current.set(source, selected);
              next = draft.plugins.filter((item) => pluginSource(item) !== source);
            }
            dispatch({ type: "plugins", value: next });
            setPreview(null);
          }} />{source}</label>;
        })}
      </div>}

      {step === 3 && <div style={{ display: "grid", gap: 8 }}>
        {!cwd && <div style={{ color: "var(--warning)" }}>Choose a project before loading skill narrowing.</div>}
        {previewError && <div style={{ color: "var(--danger)" }}>{previewError}</div>}
        {previewSkillRefs.length ? previewSkillRefs.map((skill) => {
          const fallbackHidden = draft.hiddenSkillRefs.some((ref) => ref.source === skill.source && ref.path === skill.path);
          const checked = visibleSkillKeys.has(`${skill.source}\0${skill.path}`) && !fallbackHidden;
          return (
            <label key={`${skill.source}:${skill.path}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={checked} onChange={(event) => {
                if (!preview) return;
                const update = updatePackageSkillVisibility(
                  draft.plugins,
                  previewSkillRefs,
                  preview.skills.visibleSkillRefs,
                  skill,
                  event.target.checked,
                );
                dispatch({ type: "plugins", value: update.plugins });
                dispatch({
                  type: "hiddenSkillRefs",
                  value: draft.hiddenSkillRefs.filter((ref) => !(ref.source === skill.source && ref.path === skill.path)),
                });
                setPreview((current) => {
                  if (!current) return current;
                  const allRefs = previewSkillRefs;
                  const currentVisible = new Set(current.skills.visibleSkillRefs.map((ref) => `${ref.source}\0${ref.path}`));
                  const isVisible = (ref: SkillRef) => ref.source === skill.source
                    ? update.visiblePaths.has(ref.path)
                    : currentVisible.has(`${ref.source}\0${ref.path}`);
                  return {
                    ...current,
                    skills: {
                      ...current.skills,
                      visibleSkillRefs: allRefs.filter(isVisible),
                      hiddenSkillRefs: allRefs.filter((ref) => !isVisible(ref)),
                    },
                  };
                });
              }} />
              <span>{skill.name ?? skill.path}</span>
              <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{skill.source}</span>
            </label>
          );
        }) : <div style={{ color: "var(--text-muted)" }}>No visible package skills were returned by the server preview.</div>}
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Skill toggles update authoritative PackageSource.skills filters. Hidden skill refs remain fallback cleanup only.</div>
      </div>}

      {step === 4 && <div style={{ display: "grid", gap: 8 }}>
        {!cwd && <div style={{ color: "var(--warning)" }}>Choose a project before previewing package capabilities.</div>}
        {previewError && <div style={{ color: "var(--danger)" }}>{previewError}</div>}
        {preview && <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
          <div>Safe to apply: {preview.safeToApply ? "yes" : "no"}</div>
          <div>Active tools: {preview.tools.activeToolNames?.join(", ") ?? "metadata incomplete"}</div>
          <div>Diagnostics: {preview.diagnostics.length}</div>
          <div>Conflicts: {preview.tools.conflicts.length}</div>
          {preview.diagnostics.map((diagnostic) => (
            <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} style={{ marginTop: 5, color: diagnostic.type === "error" ? "var(--danger)" : diagnostic.type === "warning" ? "var(--warning)" : "var(--text-muted)" }}>
              {diagnostic.type.toUpperCase()}: {diagnostic.message}
            </div>
          ))}
          {preview.tools.conflicts.map((conflict) => (
            <div key={`${conflict.name}:${conflict.pluginSource ?? "builtin"}:${conflict.message}`} style={{ marginTop: 5, color: "var(--warning)" }}>
              CONFLICT {conflict.name}: {conflict.message}
            </div>
          ))}
        </div>}
      </div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
        <button type="button" disabled={step === steps.length - 1} onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}>Next</button>
        <button type="button" disabled={saving || !draft.name.trim()} onClick={async () => { setSaving(true); try { await onSave(input); } finally { setSaving(false); } }}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
