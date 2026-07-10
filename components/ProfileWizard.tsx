"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ProfilePreviewResult } from "@/lib/profile-preview";
import { reconcileHiddenSkillRefsForPlugins, updatePackageSkillVisibility } from "@/lib/profile-ui-core";
import { INCOMPLETE_TOOL_METADATA_MESSAGE, type PackageSource, type ProfileDefinition, type SkillRef, type ToolPreset } from "@/lib/profiles";

const ERROR_COLOR = "#ef4444";
const WARNING_COLOR = "#f59e0b";

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

const PRESET_OPTIONS: { value: ToolPreset; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "Plugin tools only" },
  { value: "default", label: "Standard", hint: "Read, edit, and shell" },
  { value: "full", label: "Full", hint: "Adds search and listing" },
];

function profileToDraft(profile?: ProfileDefinition | null): Draft {
  return {
    name: profile?.name ?? "",
    description: profile?.description ?? "",
    builtinPreset: profile?.tools.builtinPreset ?? "default",
    plugins: profile?.plugins ?? [],
    hiddenSkillRefs: profile?.skills.disabledSkillRefs ?? [],
  };
}

function pluginSource(plugin: PackageSource): string {
  return typeof plugin === "string" ? plugin : plugin.source;
}

function pluginLabel(source: string): string {
  if (source.startsWith("npm:")) return source.slice(4);
  const parts = source.replace(/\/$/, "").split("/");
  return source.startsWith("~") ? source : parts[parts.length - 1] || source;
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
  const [preview, setPreview] = useState<ProfilePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const removedPluginsRef = useRef(new Map<string, PackageSource>());

  useEffect(() => {
    removedPluginsRef.current.clear();
    dispatch({ type: "reset", value: profileToDraft(profile) });
    setPreview(null);
    setPreviewError(null);
  }, [profile]);

  const input = useMemo(() => draftToProfileInput(draft), [draft]);
  const previewInput = useMemo(() => draftToProfileInput({
    name: "Profile preview",
    description: "",
    builtinPreset: draft.builtinPreset,
    plugins: draft.plugins,
    hiddenSkillRefs: draft.hiddenSkillRefs,
  }), [draft.builtinPreset, draft.hiddenSkillRefs, draft.plugins]);
  const selectedSources = useMemo(() => new Set(draft.plugins.map(pluginSource)), [draft.plugins]);
  const previewSkillRefs = useMemo(() => {
    const byKey = new Map<string, SkillRef>();
    const candidates = [
      ...inventorySkillRefs,
      ...(preview?.skills.visibleSkillRefs ?? []),
      ...(preview?.skills.hiddenSkillRefs ?? []),
    ];
    for (const skill of candidates) {
      if (skill.scope === "package" && !selectedSources.has(skill.source)) continue;
      byKey.set(`${skill.source}\0${skill.path}`, skill);
    }
    return [...byKey.values()];
  }, [inventorySkillRefs, preview, selectedSources]);
  const visibleSkillKeys = useMemo(() => new Set(
    (preview?.skills.visibleSkillRefs ?? []).map((skill) => `${skill.source}\0${skill.path}`),
  ), [preview]);
  const hiddenSkillKeys = useMemo(() => new Set(
    draft.hiddenSkillRefs.map((skill) => `${skill.source}\0${skill.path}`),
  ), [draft.hiddenSkillRefs]);

  useEffect(() => {
    if (!cwd) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    const timeout = window.setTimeout(() => {
      onPreview(previewInput)
        .then((result) => { if (!cancelled) setPreview(result); })
        .catch((error) => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error)); })
        .finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [cwd, onPreview, previewInput]);

  const togglePlugin = (plugin: PackageSource, checked: boolean) => {
    const source = pluginSource(plugin);
    let next: PackageSource[];
    if (checked) {
      next = [...draft.plugins, removedPluginsRef.current.get(source) ?? plugin];
      removedPluginsRef.current.delete(source);
    } else {
      const selected = draft.plugins.find((item) => pluginSource(item) === source);
      if (selected) removedPluginsRef.current.set(source, selected);
      next = draft.plugins.filter((item) => pluginSource(item) !== source);
    }
    dispatch({ type: "plugins", value: next });
  };

  const toggleSkill = (skill: SkillRef, visible: boolean) => {
    if (!preview) return;
    if (skill.scope !== "package") {
      const nextHidden = visible
        ? draft.hiddenSkillRefs.filter((ref) => !(ref.source === skill.source && ref.path === skill.path))
        : [...draft.hiddenSkillRefs.filter((ref) => !(ref.source === skill.source && ref.path === skill.path)), skill];
      dispatch({ type: "hiddenSkillRefs", value: nextHidden });
      setPreview((current) => {
        if (!current) return current;
        const key = `${skill.source}\0${skill.path}`;
        const visibleKeys = new Set(current.skills.visibleSkillRefs.map((ref) => `${ref.source}\0${ref.path}`));
        if (visible) visibleKeys.add(key);
        else visibleKeys.delete(key);
        return {
          ...current,
          skills: {
            ...current.skills,
            visibleSkillRefs: previewSkillRefs.filter((ref) => visibleKeys.has(`${ref.source}\0${ref.path}`)),
            hiddenSkillRefs: previewSkillRefs.filter((ref) => !visibleKeys.has(`${ref.source}\0${ref.path}`)),
          },
        };
      });
      return;
    }

    const update = updatePackageSkillVisibility(
      draft.plugins,
      previewSkillRefs,
      preview.skills.visibleSkillRefs,
      skill,
      visible,
    );
    dispatch({ type: "plugins", value: update.plugins });
    dispatch({
      type: "hiddenSkillRefs",
      value: draft.hiddenSkillRefs.filter((ref) => !(ref.source === skill.source && ref.path === skill.path)),
    });
    setPreview((current) => {
      if (!current) return current;
      const currentVisible = new Set(current.skills.visibleSkillRefs.map((ref) => `${ref.source}\0${ref.path}`));
      const isVisible = (ref: SkillRef) => ref.source === skill.source
        ? update.visiblePaths.has(ref.path)
        : currentVisible.has(`${ref.source}\0${ref.path}`);
      return {
        ...current,
        skills: {
          ...current.skills,
          visibleSkillRefs: previewSkillRefs.filter(isVisible),
          hiddenSkillRefs: previewSkillRefs.filter((ref) => !isVisible(ref)),
        },
      };
    });
  };

  const visibleDiagnostics = (preview?.diagnostics ?? []).filter((diagnostic) => (
    diagnostic.type !== "info" && diagnostic.message !== INCOMPLETE_TOOL_METADATA_MESSAGE
  ));
  const errorDiagnostics = visibleDiagnostics.filter((diagnostic) => diagnostic.type === "error");
  const issueCount = visibleDiagnostics.length + (preview?.tools.conflicts.length ?? 0);
  const enabledSkillCount = preview
    ? preview.skills.visibleSkillRefs.length
    : previewSkillRefs.filter((skill) => !hiddenSkillKeys.has(`${skill.source}\0${skill.path}`)).length;

  const sectionStyle = {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-panel)",
    padding: 12,
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 5 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>Name</span>
          <input
            value={draft.name}
            placeholder="Profile name"
            onChange={(event) => dispatch({ type: "name", value: event.target.value })}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", fontSize: 13, outline: "none" }}
          />
        </label>
        <label style={{ display: "grid", gap: 5 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>Description <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>(optional)</span></span>
          <textarea
            value={draft.description}
            placeholder="When to use this profile"
            onChange={(event) => dispatch({ type: "description", value: event.target.value })}
            style={{ width: "100%", minHeight: 58, resize: "vertical", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", fontSize: 13, lineHeight: 1.4, outline: "none" }}
          />
        </label>
      </section>

      <section style={sectionStyle}>
        <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 650, marginBottom: 8 }}>Built-in tools</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
          {PRESET_OPTIONS.map((option) => {
            const active = draft.builtinPreset === option.value;
            return (
              <button
                key={option.value}
                type="button"
                title={option.hint}
                aria-pressed={active}
                onClick={() => dispatch({ type: "preset", value: option.value })}
                style={{
                  minWidth: 0,
                  padding: "8px 6px",
                  border: `1px solid ${active ? "color-mix(in srgb, var(--accent) 55%, var(--border))" : "var(--border)"}`,
                  borderRadius: 7,
                  background: active ? "var(--bg-selected)" : "var(--bg)",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: active ? 650 : 500,
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <details style={sectionStyle}>
        <summary style={{ cursor: "pointer", color: "var(--text)", fontSize: 12, fontWeight: 650 }}>
          Plugins <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>· {selectedSources.size} selected</span>
        </summary>
        <div style={{ maxHeight: 230, overflow: "auto", display: "grid", gap: 1, marginTop: 9, paddingRight: 2 }}>
          {availablePlugins.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No plugins found.</div>
          ) : availablePlugins.map((plugin) => {
            const source = pluginSource(plugin);
            const checked = selectedSources.has(source);
            return (
              <label key={source} title={source} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "6px 4px", color: checked ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
                <input type="checkbox" checked={checked} onChange={(event) => togglePlugin(plugin, event.target.checked)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pluginLabel(source)}</span>
              </label>
            );
          })}
        </div>
      </details>

      {previewSkillRefs.length > 0 && (
        <details style={sectionStyle}>
          <summary style={{ cursor: "pointer", color: "var(--text)", fontSize: 12, fontWeight: 650 }}>
            Skills <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>· {enabledSkillCount} of {previewSkillRefs.length} on</span>
          </summary>
          <div style={{ maxHeight: 230, overflow: "auto", display: "grid", gap: 1, marginTop: 9, paddingRight: 2 }}>
            {previewSkillRefs.map((skill) => {
              const key = `${skill.source}\0${skill.path}`;
              const fallbackVisible = !hiddenSkillKeys.has(key);
              const checked = preview ? visibleSkillKeys.has(key) && fallbackVisible : fallbackVisible;
              return (
                <label key={key} title={`${skill.source} · ${skill.path}`} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "6px 4px", color: checked ? "var(--text)" : "var(--text-muted)", cursor: preview ? "pointer" : "default", fontSize: 12 }}>
                  <input type="checkbox" checked={checked} disabled={!preview} onChange={(event) => toggleSkill(skill, event.target.checked)} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.name ?? skill.path}</span>
                </label>
              );
            })}
          </div>
        </details>
      )}

      {!cwd && <div style={{ color: WARNING_COLOR, fontSize: 12 }}>Open a project to check plugins and skills.</div>}
      {previewError && <div role="alert" style={{ border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "8px 10px", background: "rgba(239,68,68,0.07)", color: ERROR_COLOR, fontSize: 12 }}>{previewError}</div>}
      {preview && !preview.safeToApply && (
        <div role="alert" style={{ border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "8px 10px", background: "rgba(239,68,68,0.07)", color: ERROR_COLOR, fontSize: 12 }}>
          <div style={{ fontWeight: 650 }}>This profile cannot be applied.</div>
          {errorDiagnostics.map((diagnostic) => <div key={`${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} style={{ marginTop: 4 }}>{diagnostic.message}</div>)}
        </div>
      )}
      {preview?.safeToApply && issueCount > 0 && (
        <details style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>
          <summary style={{ cursor: "pointer" }}>{issueCount} profile note{issueCount === 1 ? "" : "s"}</summary>
          <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
            {visibleDiagnostics.map((diagnostic) => <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} style={{ color: diagnostic.type === "error" ? ERROR_COLOR : "var(--text-muted)" }}>{diagnostic.message}</div>)}
            {preview.tools.conflicts.map((conflict) => <div key={`${conflict.name}:${conflict.pluginSource ?? "builtin"}`}><code>{conflict.name}</code> uses {conflict.pluginSource ?? conflict.selectedProvider}</div>)}
          </div>
        </details>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <span style={{ flex: 1, color: "var(--text-dim)", fontSize: 11 }}>{previewLoading ? "Checking profile…" : ""}</span>
        <button type="button" onClick={onCancel} style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>Cancel</button>
        <button
          type="button"
          disabled={saving || !draft.name.trim()}
          onClick={async () => {
            setSaving(true);
            try { await onSave(input); } finally { setSaving(false); }
          }}
          style={{ padding: "6px 14px", border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent)", color: "white", cursor: saving || !draft.name.trim() ? "default" : "pointer", fontSize: 12, fontWeight: 600, opacity: saving || !draft.name.trim() ? 0.55 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
