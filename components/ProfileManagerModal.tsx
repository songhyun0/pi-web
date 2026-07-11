"use client";

import { type ReactNode, type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, cx, Dialog, EmptyState, Notice, Skeleton } from "@/components/ui";
import type { UseProfilesState } from "@/hooks/useProfiles";
import { useViewportTier } from "@/hooks/useViewportTier";
import type { PluginDiagnostic, PluginsResponse } from "@/lib/api-types";
import type { ProfilePreviewResult } from "@/lib/profile-preview";
import type { PackageSource, ProfileDefinition, ProfileRef, SkillRef } from "@/lib/profiles";
import styles from "./ProfileManagerModal.module.css";
import { ProfileWizard } from "./ProfileWizard";
import { profileSummary, shortenPath } from "./profile-manager/helpers";
import { ProfileDetail } from "./profile-manager/ProfileDetail";

function ProfileInventory({
  profiles,
  globalDefaultProfileRef,
  loading,
  error,
  setupWarnings,
  inventoryDiagnostics,
  selected,
  creating,
  onSelect,
  onCreate,
  onRetry,
  initialFocusRef,
}: {
  profiles: ProfileDefinition[];
  globalDefaultProfileRef: ProfileRef | null;
  loading: boolean;
  error: string | null;
  setupWarnings: ReactNode[];
  inventoryDiagnostics: PluginDiagnostic[];
  selected: ProfileRef | null;
  creating: boolean;
  onSelect: (profile: ProfileDefinition) => void;
  onCreate: () => void;
  onRetry: () => void;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const groups = [
    { label: "Saved", profiles: profiles.filter((profile) => profile.id.startsWith("profile:")) },
    { label: "Built-in", profiles: profiles.filter((profile) => !profile.id.startsWith("profile:")) },
  ].filter((group) => group.profiles.length > 0);
  const diagnosticErrors = inventoryDiagnostics.some((diagnostic) => diagnostic.type === "error");

  return (
    <aside className={styles.navigation} aria-label="Profile inventory">
      <div className={styles.navigationHeader}>
        <h2 className={styles.navigationTitle}>Capability profiles</h2>
        <p className={styles.navigationDescription}>Server-owned definitions for built-in tools, plugin packages, and skill visibility.</p>
      </div>
      <div className={styles.inventoryScroll}>
        {error && <Notice tone="danger" title="Profiles could not be loaded" actions={<Button size="compact" onClick={onRetry}>Retry</Button>}>{error}</Notice>}
        {setupWarnings.length > 0 && (
          <Notice tone="warning" title="Profile setup notice"><ul className={styles.noticeList}>{setupWarnings}</ul></Notice>
        )}
        {inventoryDiagnostics.length > 0 && (
          <Notice
            tone={diagnosticErrors ? "danger" : "warning"}
            title={`${inventoryDiagnostics.length} plugin inventory issue${inventoryDiagnostics.length === 1 ? "" : "s"}`}
          >
            <ul className={styles.noticeList}>
              {inventoryDiagnostics.map((diagnostic) => (
                <li key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`}>
                  <span>{diagnostic.message}</span>
                  {(diagnostic.source || diagnostic.path) && <code>{[diagnostic.source, diagnostic.path].filter(Boolean).join(" · ")}</code>}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {loading && profiles.length === 0 ? (
          <output className={styles.loadingList} aria-live="polite" aria-label="Loading profiles">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} height={54} width={item % 2 ? "78%" : "100%"} />)}
          </output>
        ) : groups.length > 0 ? (
          groups.map((group) => (
            <section className={styles.navSection} key={group.label}>
              <h3 className={styles.navSectionHeading}><span>{group.label}</span><span>{group.profiles.length}</span></h3>
              {group.profiles.map((profile) => {
                const active = !creating && selected === profile.id;
                const isDefault = globalDefaultProfileRef === profile.id;
                return (
                  <button
                    type="button"
                    className={cx(styles.profileRow, active && styles.profileRowSelected)}
                    aria-current={active ? "page" : undefined}
                    key={profile.id}
                    onClick={() => onSelect(profile)}
                  >
                    <span className={styles.profileRowTop}>
                      <strong>{profile.name}</strong>
                      {isDefault && <Badge tone="accent">default</Badge>}
                    </span>
                    <span>{profile.description || profileSummary(profile)}</span>
                    {profile.description && <code>{profileSummary(profile)}</code>}
                  </button>
                );
              })}
            </section>
          ))
        ) : !error ? (
          <div className={styles.inventoryEmpty}>
            <EmptyState title="No profiles available" description="Create a saved capability profile to get started." />
          </div>
        ) : null}
      </div>
      <div className={styles.navigationFooter}>
        <Button
          ref={initialFocusRef}
          className={cx(styles.addButton, creating && styles.addButtonSelected)}
          aria-pressed={creating}
          onClick={onCreate}
        >
          + New profile
        </Button>
      </div>
    </aside>
  );
}

export interface ProfileManagerModalProps {
  cwd: string | null;
  profilesState: UseProfilesState;
  onClose: () => void;
}

export function ProfileManagerModal({ cwd, profilesState, onClose }: ProfileManagerModalProps) {
  const viewport = useViewportTier();
  const isPhone = viewport === "phone";
  const markerId = useId();
  const historyMarker = `pi-profiles-${markerId}`;
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const detailHistoryActiveRef = useRef(false);
  const editorHistoryActiveRef = useRef(false);
  const wizardDirtyRef = useRef(false);
  const [selected, setSelected] = useState<ProfileRef | null>(null);
  const [editing, setEditing] = useState<ProfileDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [wizardDirty, setWizardDirty] = useState(false);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [undoDefaultRef, setUndoDefaultRef] = useState<ProfileRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogPlugins, setCatalogPlugins] = useState<PackageSource[]>([]);
  const [catalogSkillRefs, setCatalogSkillRefs] = useState<SkillRef[]>([]);
  const [inventoryDiagnostics, setInventoryDiagnostics] = useState<PluginDiagnostic[]>([]);
  const [deleteIntent, setDeleteIntent] = useState<ProfileDefinition | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => { wizardDirtyRef.current = wizardDirty; }, [wizardDirty]);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setCatalogPlugins([]);
      setCatalogSkillRefs([]);
      setInventoryDiagnostics([]);
      setCatalogError(null);
      setCatalogLoading(false);
      return;
    }
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const response = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({})) as PluginsResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
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
    } catch (fetchError) {
      if ((fetchError as Error).name === "AbortError") return;
      setCatalogPlugins([]);
      setCatalogSkillRefs([]);
      setInventoryDiagnostics([]);
      setCatalogError(`Could not load plugins: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
    } finally {
      if (!signal?.aborted) setCatalogLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalog(controller.signal);
    return () => controller.abort();
  }, [loadCatalog]);

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
      if (leftDefault !== rightDefault) return rightDefault - leftDefault;
      if (left.id.startsWith("profile:") !== right.id.startsWith("profile:")) return left.id.startsWith("profile:") ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
  ), [profilesState.builtinProfiles, profilesState.globalDefaultProfileRef, profilesState.profiles]);
  const selectedProfile = profileList.find((profile) => profile.id === selected) ?? null;
  const busy = wizardBusy || actionBusy !== null;
  const visibleError = error ?? profilesState.error;
  const setupWarningItems = profilesState.warnings.map((warning) => <li key={warning}>{warning}</li>);

  useEffect(() => {
    if (!isPhone && !selected && !creating && profileList[0]) setSelected(profileList[0].id);
  }, [creating, isPhone, profileList, selected]);

  useEffect(() => {
    if (selected && !profileList.some((profile) => profile.id === selected)) {
      setSelected(isPhone ? null : (profileList[0]?.id ?? null));
      setEditing(null);
    }
  }, [isPhone, profileList, selected]);

  useEffect(() => {
    if (isPhone) return;
    const historySteps = Number(editorHistoryActiveRef.current) + Number(detailHistoryActiveRef.current);
    editorHistoryActiveRef.current = false;
    detailHistoryActiveRef.current = false;
    if (historySteps > 0) window.history.go(-historySteps);
  }, [isPhone]);

  useEffect(() => {
    if (!isPhone) return;
    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.piProfilesEditor === historyMarker) return;
      if (editorHistoryActiveRef.current) {
        if (wizardDirtyRef.current) {
          window.history.pushState({ ...event.state, piProfilesDetail: historyMarker, piProfilesEditor: historyMarker }, "");
          pendingActionRef.current = () => window.history.back();
          setDiscardOpen(true);
          return;
        }
        editorHistoryActiveRef.current = false;
        setEditing(null);
        setWizardDirty(false);
        return;
      }
      if (event.state?.piProfilesDetail === historyMarker) return;
      if (detailHistoryActiveRef.current) {
        if (wizardDirtyRef.current) {
          window.history.pushState({ ...event.state, piProfilesDetail: historyMarker }, "");
          pendingActionRef.current = () => window.history.back();
          setDiscardOpen(true);
          return;
        }
        detailHistoryActiveRef.current = false;
        setSelected(null);
        setCreating(false);
        setEditing(null);
        setWizardDirty(false);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [historyMarker, isPhone]);

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
    setUndoDefaultRef(null);
  };

  const queueDiscard = (action: () => void) => {
    pendingActionRef.current = action;
    setDiscardOpen(true);
  };

  const requestAction = (action: () => void) => {
    if (busy) return;
    if (wizardDirtyRef.current) queueDiscard(action);
    else action();
  };

  const pushDetailHistory = () => {
    if (!isPhone || detailHistoryActiveRef.current) return;
    window.history.pushState({ ...window.history.state, piProfilesDetail: historyMarker }, "");
    detailHistoryActiveRef.current = true;
  };

  useEffect(() => {
    if (!isPhone || detailHistoryActiveRef.current || (!selected && !creating && !editing)) return;
    window.history.pushState({ ...window.history.state, piProfilesDetail: historyMarker }, "");
    detailHistoryActiveRef.current = true;
    if (editing) {
      window.history.pushState({ ...window.history.state, piProfilesDetail: historyMarker, piProfilesEditor: historyMarker }, "");
      editorHistoryActiveRef.current = true;
    }
  }, [creating, editing, historyMarker, isPhone, selected]);
  const startSelecting = (profile: ProfileDefinition) => {
    requestAction(() => {
      clearFeedback();
      setCreating(false);
      setEditing(null);
      setWizardDirty(false);
      setSelected(profile.id);
      pushDetailHistory();
    });
  };

  const startCreating = () => {
    requestAction(() => {
      clearFeedback();
      setDeleteIntent(null);
      setSelected(null);
      setEditing(null);
      setCreating(true);
      setWizardDirty(false);
      pushDetailHistory();
    });
  };

  const startEditing = (profile: ProfileDefinition) => {
    clearFeedback();
    setDeleteIntent(null);
    setCreating(false);
    setSelected(profile.id);
    setEditing(profile);
    setWizardDirty(false);
    if (isPhone && detailHistoryActiveRef.current && !editorHistoryActiveRef.current) {
      window.history.pushState({ ...window.history.state, piProfilesDetail: historyMarker, piProfilesEditor: historyMarker }, "");
      editorHistoryActiveRef.current = true;
    }
  };

  const cancelEditorNow = () => {
    wizardDirtyRef.current = false;
    setWizardDirty(false);
    clearFeedback();
    if (isPhone && editorHistoryActiveRef.current) window.history.back();
    else setEditing(null);
  };

  const leaveDetailNow = () => {
    wizardDirtyRef.current = false;
    setWizardDirty(false);
    clearFeedback();
    if (isPhone && detailHistoryActiveRef.current) window.history.back();
    else {
      setCreating(false);
      setEditing(null);
      setSelected(isPhone ? null : (profileList[0]?.id ?? null));
    }
  };

  const requestBack = () => requestAction(editing ? cancelEditorNow : leaveDetailNow);

  const closeNow = () => {
    const historySteps = Number(editorHistoryActiveRef.current) + Number(detailHistoryActiveRef.current);
    editorHistoryActiveRef.current = false;
    detailHistoryActiveRef.current = false;
    if (historySteps > 0) window.history.go(-historySteps);
    onClose();
  };

  const requestClose = () => requestAction(closeNow);

  const previewProfile = profilesState.previewProfile;
  const handlePreview = useCallback(async (draftProfile: unknown): Promise<ProfilePreviewResult> => {
    if (!cwd) throw new Error("Choose a project before checking this profile.");
    return previewProfile({ cwd, draftProfile });
  }, [cwd, previewProfile]);

  const handleSave = async (draftProfile: unknown) => {
    clearFeedback();
    setActionBusy("save");
    try {
      const saved = editing
        ? await profilesState.updateProfile(editing.id, draftProfile)
        : await profilesState.createProfile(draftProfile);
      wizardDirtyRef.current = false;
      setWizardDirty(false);
      setCreating(false);
      setEditing(null);
      setSelected(saved.id);
      setMessage(editing ? "Profile changes saved." : "Profile created.");
      if (isPhone && editorHistoryActiveRef.current) window.history.back();
    } catch (saveError) {
      const nextError = saveError instanceof Error ? saveError : new Error(String(saveError));
      throw nextError;
    } finally {
      setActionBusy(null);
    }
  };

  const handleSetDefault = async (profileRef: ProfileRef) => {
    const previousDefault = profilesState.globalDefaultProfileRef;
    clearFeedback();
    setActionBusy("default");
    try {
      await profilesState.setGlobalDefaultProfile(profileRef);
      setUndoDefaultRef(previousDefault && previousDefault !== profileRef ? previousDefault : null);
      setMessage("Global default updated.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setActionBusy(null);
    }
  };

  const handleUndoDefault = async () => {
    if (!undoDefaultRef) return;
    setError(null);
    setMessage(null);
    setActionBusy("default");
    try {
      await profilesState.setGlobalDefaultProfile(undoDefaultRef);
      setUndoDefaultRef(null);
      setMessage("Previous global default restored.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setActionBusy(null);
    }
  };

  const handleDelete = async (profile: ProfileDefinition) => {
    clearFeedback();
    setActionBusy("delete");
    try {
      const replacement = profilesState.globalDefaultProfileRef === profile.id
        ? profilesState.builtinProfiles[0]?.id as ProfileRef | undefined
        : undefined;
      await profilesState.deleteProfile(profile.id, replacement);
      setDeleteIntent(null);
      if (selected === profile.id) {
        if (isPhone && detailHistoryActiveRef.current) window.history.back();
        else setSelected(profileList.find((candidate) => candidate.id !== profile.id)?.id ?? null);
      }
      setMessage("Profile deleted.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setActionBusy(null);
    }
  };

  const handleRefresh = async () => {
    clearFeedback();
    setActionBusy("refresh");
    try {
      await Promise.all([profilesState.refresh(), loadCatalog()]);
      setMessage("Profiles refreshed.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setActionBusy(null);
    }
  };

  const confirmDiscard = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    wizardDirtyRef.current = false;
    setWizardDirty(false);
    setDiscardOpen(false);
    action?.();
  };

  const cancelDiscard = () => {
    pendingActionRef.current = null;
    setDiscardOpen(false);
  };

  const inventoryVisible = !isPhone || (!selected && !creating && !editing);
  const detailVisible = !isPhone || Boolean(selected || creating || editing);
  const detailTitle = creating ? "New profile" : editing ? `Edit ${editing.name}` : selectedProfile?.name ?? "Profile details";
  const status = actionBusy === "refresh"
    ? "Refreshing profile data…"
    : actionBusy === "delete"
      ? "Deleting profile…"
      : actionBusy === "default"
        ? "Updating global default…"
        : wizardBusy || actionBusy === "save"
          ? "Saving profile…"
          : message ?? `${profileList.length} profile${profileList.length === 1 ? "" : "s"}`;
  return (
    <>
      <Dialog
        open
        title="Profiles"
        description={cwd ? shortenPath(cwd) : "Choose a project to resolve effective capabilities."}
        onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}
        variant="adaptive"
        size="xl"
        className={styles.dialog}
        bodyClassName={styles.dialogBody}
        initialFocusRef={initialFocusRef}
        dismissible={!busy && !discardOpen && !deleteIntent}
        footer={
          <div className={styles.footerContent}>
            <span className={styles.footerStatus} aria-live="polite">{status}</span>
            <Button loading={actionBusy === "refresh"} disabled={busy || profilesState.loading} onClick={() => void handleRefresh()}>Refresh</Button>
            <Button variant="primary" disabled={busy} onClick={requestClose}>Close</Button>
          </div>
        }
      >
        <div className={styles.workspace} data-mobile-detail={isPhone && detailVisible ? "true" : undefined}>
          {inventoryVisible && (
            <ProfileInventory
              profiles={profileList}
              globalDefaultProfileRef={profilesState.globalDefaultProfileRef}
              loading={profilesState.loading}
              error={profilesState.error}
              setupWarnings={setupWarningItems}
              inventoryDiagnostics={inventoryDiagnostics}
              selected={selected}
              creating={creating}
              onSelect={startSelecting}
              onCreate={startCreating}
              onRetry={() => void handleRefresh()}
              initialFocusRef={initialFocusRef}
            />
          )}

          {detailVisible && (
            <main className={styles.detail} aria-label={detailTitle}>
              {isPhone && (
                <div className={styles.mobileDetailHeader}>
                  <Button size="compact" disabled={busy} onClick={requestBack}>← Back</Button>
                  <div><strong>{detailTitle}</strong><span>{editing ? "Editor" : creating ? "New definition" : "Profile details"}</span></div>
                </div>
              )}
              <div className={styles.detailScroll}>
                {message && (
                  <Notice
                    tone="success"
                    title="Profiles updated"
                    actions={undoDefaultRef ? <Button size="compact" disabled={busy} onClick={() => void handleUndoDefault()}>Undo</Button> : undefined}
                  >
                    {message}
                  </Notice>
                )}
                {visibleError && <Notice tone="danger" title={error ? "Profile action failed" : "Profiles could not be loaded"}>{visibleError}</Notice>}
                {catalogError && <Notice tone="warning" title="Plugin catalog unavailable">{catalogError}</Notice>}
                {catalogLoading && (creating || editing) && (
                  <div className={styles.catalogStatus}><Skeleton height={4} width="100%" /><span>Refreshing plugin and skill inventory…</span></div>
                )}

                {(creating || editing) ? (
                  <ProfileWizard
                    cwd={cwd}
                    profile={editing}
                    availablePlugins={availablePlugins}
                    inventorySkillRefs={catalogSkillRefs}
                    onPreview={handlePreview}
                    onSave={handleSave}
                    onCancel={requestBack}
                    onDirtyChange={setWizardDirty}
                    onBusyChange={setWizardBusy}
                  />
                ) : selectedProfile ? (
                  <ProfileDetail
                    profile={selectedProfile}
                    isDefault={profilesState.globalDefaultProfileRef === selectedProfile.id}
                    busy={busy}
                    onSetDefault={() => void handleSetDefault(selectedProfile.id)}
                    onEdit={() => startEditing(selectedProfile)}
                    onDelete={() => setDeleteIntent(selectedProfile)}
                  />
                ) : (
                  <div className={styles.detailEmpty}>
                    <EmptyState title="Select a profile" description="Choose a definition from the inventory or create a new one." />
                  </div>
                )}
              </div>
            </main>
          )}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteIntent)}
        title="Delete profile?"
        description="This removes the saved definition. Existing session snapshots are not rewritten."
        onOpenChange={(nextOpen) => { if (!nextOpen && !busy) setDeleteIntent(null); }}
        size="sm"
        dismissible={!busy}
        footer={
          <>
            <Button disabled={busy} onClick={() => setDeleteIntent(null)}>Cancel</Button>
            <Button variant="danger" loading={actionBusy === "delete"} onClick={() => { if (deleteIntent) void handleDelete(deleteIntent); }}>Delete profile</Button>
          </>
        }
      >
        <div className={styles.confirmationContent}>
          <Notice tone="danger" title={deleteIntent?.name ?? "Saved profile"}>
            This action cannot be undone from this screen.
          </Notice>
          {deleteIntent && profilesState.globalDefaultProfileRef === deleteIntent.id && (
            <Notice tone="warning" title="Global default replacement">
              The first available built-in profile will become the global default.
            </Notice>
          )}
          {error && <Notice tone="danger" title="Delete failed">{error}</Notice>}
        </div>
      </Dialog>

      <Dialog
        open={discardOpen}
        title="Discard unsaved changes?"
        description="This profile draft has changes that have not been saved."
        onOpenChange={(nextOpen) => { if (!nextOpen) cancelDiscard(); }}
        size="sm"
        footer={
          <>
            <Button onClick={cancelDiscard}>Keep editing</Button>
            <Button variant="danger" onClick={confirmDiscard}>Discard changes</Button>
          </>
        }
      >
        <p className={styles.confirmationCopy}>Your saved profile remains unchanged. Only the current draft will be discarded.</p>
      </Dialog>
    </>
  );
}
