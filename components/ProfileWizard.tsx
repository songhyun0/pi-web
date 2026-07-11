"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Badge, Button, EmptyState, Field, Input, Notice, Skeleton, Switch, Textarea } from "@/components/ui";
import type { ProfilePreviewResult } from "@/lib/profile-preview";
import { reconcileHiddenSkillRefsForPlugins, updatePackageSkillVisibility } from "@/lib/profile-ui-core";
import {
  INCOMPLETE_TOOL_METADATA_MESSAGE,
  type PackageSource,
  type ProfileDefinition,
  type SkillRef,
  type ToolPreset,
} from "@/lib/profiles";
import styles from "./ProfileManagerModal.module.css";
import { packageLabel, packageSource, presetDescription } from "./profile-manager/helpers";

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

const STEP_LABELS = ["Profile", "Tools", "Plugins", "Skills", "Preview"] as const;
const PRESET_OPTIONS: Array<{ value: ToolPreset; label: string; hint: string }> = [
  { value: "none", label: "None", hint: "Use only tools supplied by selected plugins." },
  { value: "default", label: "Standard", hint: "Read, edit, write, and shell tools for routine work." },
  { value: "full", label: "Full", hint: "Standard tools plus project search and file listing." },
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

function reducer(state: Draft, action: Action): Draft {
  switch (action.type) {
    case "name": return { ...state, name: action.value };
    case "description": return { ...state, description: action.value };
    case "preset": return { ...state, builtinPreset: action.value };
    case "plugins": {
      const sources = action.value.map(packageSource);
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

function draftSignature(draft: Draft): string {
  return JSON.stringify(draftToProfileInput(draft));
}

export interface ProfileWizardProps {
  cwd: string | null;
  profile?: ProfileDefinition | null;
  availablePlugins?: PackageSource[];
  inventorySkillRefs?: SkillRef[];
  onPreview: (draftProfile: unknown) => Promise<ProfilePreviewResult>;
  onSave: (draftProfile: unknown) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ProfileWizard({
  cwd,
  profile,
  availablePlugins = [],
  inventorySkillRefs = [],
  onPreview,
  onSave,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: ProfileWizardProps) {
  const [draft, dispatch] = useReducer(reducer, profileToDraft(profile));
  const [step, setStep] = useState(0);
  const [nameTouched, setNameTouched] = useState(false);
  const [pluginFilter, setPluginFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [preview, setPreview] = useState<ProfilePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const removedPluginsRef = useRef(new Map<string, PackageSource>());
  const initialSignatureRef = useRef(draftSignature(profileToDraft(profile)));

  useEffect(() => {
    const nextDraft = profileToDraft(profile);
    removedPluginsRef.current.clear();
    initialSignatureRef.current = draftSignature(nextDraft);
    dispatch({ type: "reset", value: nextDraft });
    setStep(0);
    setNameTouched(false);
    setPluginFilter("");
    setSkillFilter("");
    setPreview(null);
    setPreviewError(null);
    setSaveError(null);
  }, [profile]);

  const input = useMemo(() => draftToProfileInput(draft), [draft]);
  const dirty = useMemo(() => draftSignature(draft) !== initialSignatureRef.current, [draft]);
  const previewInput = useMemo(() => draftToProfileInput({
    name: "Profile preview",
    description: "",
    builtinPreset: draft.builtinPreset,
    plugins: draft.plugins,
    hiddenSkillRefs: draft.hiddenSkillRefs,
  }), [draft.builtinPreset, draft.hiddenSkillRefs, draft.plugins]);
  const selectedSources = useMemo(() => new Set(draft.plugins.map(packageSource)), [draft.plugins]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(saving); }, [onBusyChange, saving]);

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
    const source = packageSource(plugin);
    let next: PackageSource[];
    if (checked) {
      next = [...draft.plugins, removedPluginsRef.current.get(source) ?? plugin];
      removedPluginsRef.current.delete(source);
    } else {
      const selected = draft.plugins.find((item) => packageSource(item) === source);
      if (selected) removedPluginsRef.current.set(source, selected);
      next = draft.plugins.filter((item) => packageSource(item) !== source);
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
  const filteredPlugins = availablePlugins.filter((plugin) => {
    const source = packageSource(plugin);
    const value = pluginFilter.trim().toLowerCase();
    return !value || source.toLowerCase().includes(value) || packageLabel(source).toLowerCase().includes(value);
  });
  const filteredSkills = previewSkillRefs.filter((skill) => {
    const value = skillFilter.trim().toLowerCase();
    return !value || [skill.name ?? "", skill.source, skill.path].some((item) => item.toLowerCase().includes(value));
  });

  const save = async () => {
    if (saving || !draft.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(input);
      onDirtyChange?.(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    if (step === 0) {
      return (
        <section className={styles.wizardStep}>
          <div className={styles.stepHeading}>
            <Badge tone="accent">Step 1</Badge>
            <div><h3>Profile identity</h3><p>Name the profile and explain when it should be selected.</p></div>
          </div>
          <div className={styles.formSection}>
            <Field label="Name" error={nameTouched && !draft.name.trim() ? "A profile name is required before continuing." : undefined}>
              <Input
                required
                value={draft.name}
                placeholder="Profile name"
                onBlur={() => setNameTouched(true)}
                onChange={(event) => dispatch({ type: "name", value: event.target.value })}
              />
            </Field>
            <Field label="Description" optional hint="Describe the workload or safety boundary this profile is designed for.">
              <Textarea
                value={draft.description}
                placeholder="When to use this profile"
                onChange={(event) => dispatch({ type: "description", value: event.target.value })}
              />
            </Field>
          </div>
        </section>
      );
    }

    if (step === 1) {
      return (
        <section className={styles.wizardStep}>
          <div className={styles.stepHeading}>
            <Badge tone="accent">Step 2</Badge>
            <div><h3>Built-in tools</h3><p>Choose the server-defined built-in tool baseline.</p></div>
          </div>
          <div className={styles.choiceGrid}>
            {PRESET_OPTIONS.map((option) => {
              const active = draft.builtinPreset === option.value;
              return (
                <button
                  type="button"
                  className={styles.choiceCard}
                  data-selected={active || undefined}
                  aria-pressed={active}
                  key={option.value}
                  onClick={() => dispatch({ type: "preset", value: option.value })}
                >
                  <span className={styles.choiceCardTop}><strong>{option.label}</strong>{active && <Badge tone="accent">Selected</Badge>}</span>
                  <span>{option.hint}</span>
                  <small>{presetDescription(option.value)}</small>
                </button>
              );
            })}
          </div>
        </section>
      );
    }

    if (step === 2) {
      return (
        <section className={styles.wizardStep}>
          <div className={styles.stepHeading}>
            <Badge tone="accent">Step 3</Badge>
            <div><h3>Plugin packages</h3><p>Select packages that may contribute extensions and skills.</p></div>
          </div>
          <div className={styles.stepToolbar}>
            <Input
              value={pluginFilter}
              onChange={(event) => setPluginFilter(event.target.value)}
              placeholder="Filter plugins"
              aria-label="Filter profile plugins"
            />
            <Badge tone="neutral">{selectedSources.size} selected</Badge>
          </div>
          {availablePlugins.length === 0 ? (
            <EmptyState title="No plugins available" description="No configured plugin package sources were found for this profile." />
          ) : filteredPlugins.length === 0 ? (
            <EmptyState
              title="No matching plugins"
              description={`Nothing matched “${pluginFilter.trim()}”.`}
              action={<Button size="compact" onClick={() => setPluginFilter("")}>Clear filter</Button>}
            />
          ) : (
            <div className={styles.toggleList}>
              {filteredPlugins.map((plugin) => {
                const source = packageSource(plugin);
                const checked = selectedSources.has(source);
                return (
                  <Switch
                    key={source}
                    checked={checked}
                    onCheckedChange={(next) => togglePlugin(plugin, next)}
                    label={packageLabel(source)}
                    description={source}
                  />
                );
              })}
            </div>
          )}
        </section>
      );
    }

    if (step === 3) {
      return (
        <section className={styles.wizardStep}>
          <div className={styles.stepHeading}>
            <Badge tone="accent">Step 4</Badge>
            <div><h3>Skill visibility</h3><p>Narrow the skills contributed by selected packages and standalone sources.</p></div>
          </div>
          {!cwd && <Notice tone="warning" title="Project required">Choose a project before resolving effective skills.</Notice>}
          {previewError && <Notice tone="danger" title="Skill preview failed">{previewError}</Notice>}
          <div className={styles.stepToolbar}>
            <Input
              value={skillFilter}
              onChange={(event) => setSkillFilter(event.target.value)}
              placeholder="Filter skills"
              aria-label="Filter profile skills"
            />
            <Badge tone="neutral">{enabledSkillCount} of {previewSkillRefs.length} on</Badge>
          </div>
          {previewLoading && previewSkillRefs.length === 0 ? (
            <div className={styles.stepSkeletons}>
              {[0, 1, 2].map((item) => <Skeleton key={item} height={52} width={item === 1 ? "84%" : "100%"} />)}
            </div>
          ) : previewSkillRefs.length === 0 ? (
            <EmptyState title="No skills resolved" description="Selected packages and standalone sources did not expose configurable skills." />
          ) : filteredSkills.length === 0 ? (
            <EmptyState
              title="No matching skills"
              description={`Nothing matched “${skillFilter.trim()}”.`}
              action={<Button size="compact" onClick={() => setSkillFilter("")}>Clear filter</Button>}
            />
          ) : (
            <div className={styles.toggleList}>
              {filteredSkills.map((skill) => {
                const key = `${skill.source}\0${skill.path}`;
                const fallbackVisible = !hiddenSkillKeys.has(key);
                const checked = preview ? visibleSkillKeys.has(key) && fallbackVisible : fallbackVisible;
                return (
                  <Switch
                    key={key}
                    checked={checked}
                    disabled={!preview}
                    onCheckedChange={(next) => toggleSkill(skill, next)}
                    label={skill.name ?? skill.path}
                    description={`${skill.source} · ${skill.path}`}
                  />
                );
              })}
            </div>
          )}
        </section>
      );
    }

    return (
      <section className={styles.wizardStep}>
        <div className={styles.stepHeading}>
          <Badge tone="accent">Step 5</Badge>
          <div><h3>Effective preview</h3><p>Review the server-resolved capabilities before saving the definition.</p></div>
        </div>
        {!cwd && <Notice tone="warning" title="Project required">Choose a project to produce an effective preview.</Notice>}
        {previewLoading && !preview ? (
          <div className={styles.previewSkeletons}>
            <Skeleton height={80} width="100%" />
            <Skeleton height={132} width="100%" />
          </div>
        ) : previewError ? (
          <Notice tone="danger" title="Preview failed">{previewError}</Notice>
        ) : preview ? (
          <>
            <Notice
              tone={preview.safeToApply ? (issueCount ? "warning" : "success") : "danger"}
              title={preview.safeToApply ? (issueCount ? "Preview has notes" : "Ready to apply") : "Cannot be applied"}
            >
              {preview.safeToApply
                ? issueCount
                  ? `${issueCount} diagnostic or tool override note${issueCount === 1 ? "" : "s"} should be reviewed.`
                  : "The server resolved this capability profile without blocking issues."
                : "The definition may still be saved, but sessions cannot use it until the blocking issues are fixed."}
            </Notice>
            <div className={styles.previewStats}>
              <div><span>Built-in tools</span><strong>{preview.tools.requestedBuiltinTools.length}</strong></div>
              <div><span>Plugin tools</span><strong>{preview.tools.pluginTools.length}</strong></div>
              <div><span>Plugins</span><strong>{preview.plugins.length}</strong></div>
              <div><span>Visible skills</span><strong>{preview.skills.visibleSkillRefs.length}</strong></div>
            </div>
            {preview.tools.conflicts.length > 0 && (
              <section className={styles.previewSection}>
                <div className={styles.previewSectionHeader}><h4>Tool overrides</h4><Badge tone="warning">{preview.tools.conflicts.length}</Badge></div>
                <div className={styles.previewRows}>
                  {preview.tools.conflicts.map((conflict) => (
                    <div key={`${conflict.name}:${conflict.pluginSource ?? "builtin"}`}>
                      <code>{conflict.name}</code>
                      <span>{conflict.message}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {visibleDiagnostics.length > 0 && (
              <section className={styles.previewSection}>
                <div className={styles.previewSectionHeader}><h4>Diagnostics</h4><Badge tone={errorDiagnostics.length ? "danger" : "warning"}>{visibleDiagnostics.length}</Badge></div>
                <div className={styles.previewRows}>
                  {visibleDiagnostics.map((diagnostic) => (
                    <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`}>
                      <strong>{diagnostic.type}</strong>
                      <span>{diagnostic.message}</span>
                      {(diagnostic.source || diagnostic.path) && <code>{[diagnostic.source, diagnostic.path].filter(Boolean).join(" · ")}</code>}
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section className={styles.previewSection}>
              <div className={styles.previewSectionHeader}><h4>Selected packages</h4><Badge tone="neutral">{preview.plugins.length}</Badge></div>
              {preview.plugins.length > 0 ? (
                <div className={styles.previewRows}>
                  {preview.plugins.map((plugin) => (
                    <div key={plugin.source}><strong>{packageLabel(plugin.source)}</strong><code>{plugin.source}</code></div>
                  ))}
                </div>
              ) : <p className={styles.previewEmptyCopy}>No selected plugin packages.</p>}
            </section>
          </>
        ) : (
          <EmptyState title="Preview unavailable" description="Capability details will appear after the server resolves this draft." />
        )}
      </section>
    );
  };

  return (
    <div className={styles.wizard}>
      <nav className={styles.stepper} aria-label="Profile editor steps">
        {STEP_LABELS.map((label, index) => (
          <button
            type="button"
            key={label}
            className={styles.stepButton}
            data-active={step === index || undefined}
            data-complete={step > index || undefined}
            aria-current={step === index ? "step" : undefined}
            disabled={saving || (index > 0 && !draft.name.trim())}
            onClick={() => setStep(index)}
          >
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </button>
        ))}
      </nav>

      {saveError && <Notice tone="danger" title="Profile was not saved">{saveError}</Notice>}
      <div className={styles.wizardBody}>{renderStep()}</div>

      <div className={styles.wizardFooter}>
        <span className={styles.wizardStatus} aria-live="polite">
          {saving ? "Saving profile…" : previewLoading ? "Checking effective capabilities…" : dirty ? "Unsaved changes" : "No unsaved changes"}
        </span>
        <Button disabled={saving} onClick={onCancel}>Cancel</Button>
        {step > 0 && <Button disabled={saving} onClick={() => setStep((current) => Math.max(0, current - 1))}>Back</Button>}
        {step < STEP_LABELS.length - 1 ? (
          <Button variant="primary" disabled={!draft.name.trim() || saving} onClick={() => setStep((current) => Math.min(STEP_LABELS.length - 1, current + 1))}>Next</Button>
        ) : (
          <Button variant="primary" loading={saving} disabled={!draft.name.trim() || previewLoading} onClick={() => void save()}>Save profile</Button>
        )}
      </div>
    </div>
  );
}
