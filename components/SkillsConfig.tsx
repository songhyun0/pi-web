"use client";

import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge, Button, cx, Dialog, EmptyState, Input, Notice, Skeleton } from "@/components/ui";
import { useViewportTier } from "@/hooks/useViewportTier";
import type { SkillDiagnostic, SkillInfo, SkillsResponse } from "@/lib/api-types";
import styles from "./SkillsConfig.module.css";
import { AddSkillPanel } from "./skills-config/AddSkillPanel";
import {
  diagnosticMatchesSkill,
  type SkillSourceGroup,
  shortenPath,
  sourceGroup,
  sourceSummary,
} from "./skills-config/helpers";
import { SkillDetail } from "./skills-config/SkillDetail";

interface UndoSetting {
  filePath: string;
  disableModelInvocation: boolean;
}

function InventorySkeleton() {
  return (
    <output className={styles.loadingList} aria-live="polite" aria-label="Loading skills">
      {[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} width={item % 2 ? "76%" : "94%"} height={48} />)}
    </output>
  );
}

function SkillInventory({
  loading,
  error,
  skills,
  diagnostics,
  selected,
  addMode,
  filter,
  onFilterChange,
  onSelect,
  onAdd,
  onRetry,
  initialFocusRef,
}: {
  loading: boolean;
  error: string | null;
  skills: SkillInfo[];
  diagnostics: SkillDiagnostic[];
  selected: string | null;
  addMode: boolean;
  filter: string;
  onFilterChange: (value: string) => void;
  onSelect: (filePath: string) => void;
  onAdd: () => void;
  onRetry: () => void;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleSkills = normalizedFilter
    ? skills.filter((skill) => [skill.name, skill.description, skill.filePath, sourceSummary(skill)]
      .some((value) => value.toLowerCase().includes(normalizedFilter)))
    : skills;
  const groups = (["project", "global", "path"] as SkillSourceGroup[])
    .map((group) => ({ group, skills: visibleSkills.filter((skill) => sourceGroup(skill) === group) }))
    .filter((entry) => entry.skills.length > 0);
  const hasDiagnosticError = diagnostics.some((diagnostic) => diagnostic.type === "error");

  return (
    <aside className={styles.navigation} aria-label="Loaded skill inventory">
      <div className={styles.navigationHeader}>
        <h2 className={styles.navigationTitle}>Skill inventory</h2>
        <p className={styles.navigationDescription}>Skills resolved from project, global, package, and explicit paths.</p>
        <Input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Filter loaded skills"
          aria-label="Filter loaded skills"
        />
      </div>
      <div className={styles.inventoryScroll}>
        {loading ? (
          <InventorySkeleton />
        ) : error ? (
          <Notice tone="danger" title="Skills could not be loaded" actions={<Button size="compact" onClick={onRetry}>Retry</Button>}>
            {error}
          </Notice>
        ) : (
          <>
            {diagnostics.length > 0 && (
              <Notice tone={hasDiagnosticError ? "danger" : "warning"} title={`${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`}>
                {diagnostics[0]?.message}
              </Notice>
            )}
            {groups.map(({ group, skills: groupSkills }) => (
              <section className={styles.navSection} key={group}>
                <h3 className={styles.navSectionHeading}><span>{group}</span><span>{groupSkills.length}</span></h3>
                {groupSkills.map((skill) => {
                  const active = !addMode && selected === skill.filePath;
                  return (
                    <button
                      type="button"
                      className={cx(styles.skillRow, active && styles.skillRowSelected)}
                      aria-current={active ? "page" : undefined}
                      key={skill.filePath}
                      onClick={() => onSelect(skill.filePath)}
                    >
                      <span className={styles.skillRowTop}>
                        <code className={styles.skillName}>{skill.name}</code>
                        {skill.disableModelInvocation && <Badge tone="neutral">manual</Badge>}
                      </span>
                      <span className={styles.skillDescription}>{skill.description || "No description provided"}</span>
                      <code className={styles.skillSource}>{sourceSummary(skill)}</code>
                    </button>
                  );
                })}
              </section>
            ))}
            {skills.length === 0 && (
              <div className={styles.inventoryEmpty}>
                <EmptyState title="No skills loaded" description="Install a skill or add a skill path to pi settings." />
              </div>
            )}
            {skills.length > 0 && visibleSkills.length === 0 && (
              <div className={styles.inventoryEmpty}>
                <EmptyState
                  title="No matching skills"
                  description={`Nothing matched “${filter.trim()}”.`}
                  action={<Button size="compact" onClick={() => onFilterChange("")}>Clear filter</Button>}
                />
              </div>
            )}
          </>
        )}
      </div>
      <div className={styles.navigationFooter}>
        <Button
          ref={initialFocusRef}
          className={cx(styles.addButton, addMode && styles.addButtonSelected)}
          aria-pressed={addMode}
          onClick={onAdd}
        >
          + Add skill
        </Button>
      </div>
    </aside>
  );
}

export function SkillsConfig({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const viewportTier = useViewportTier();
  const isPhone = viewportTier === "phone";
  const historyMarker = `pi-skills-${useId()}`;
  const detailHistoryActiveRef = useRef(false);
  const inventoryFocusRef = useRef<HTMLButtonElement>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [diagnostics, setDiagnostics] = useState<SkillDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [installBusy, setInstallBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [undoSetting, setUndoSetting] = useState<UndoSetting | null>(null);

  const selectedSkill = skills.find((skill) => skill.filePath === selected) ?? null;
  const detailOpen = addMode || Boolean(selectedSkill);
  const busy = installBusy || toggling.size > 0;

  const clearFeedback = useCallback(() => {
    setActionError(null);
    setActionMessage(null);
    setUndoSetting(null);
  }, []);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const next = await response.json() as SkillsResponse & { error?: string };
      if (!response.ok || next.error) throw new Error(next.error ?? `HTTP ${response.status}`);
      const nextSkills = next.skills ?? [];
      setSkills(nextSkills);
      setDiagnostics(next.diagnostics ?? []);
      setSelected((current) => current && nextSkills.some((skill) => skill.filePath === current) ? current : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (loading || isPhone || selected || addMode) return;
    if (skills[0]) setSelected(skills[0].filePath);
    else setAddMode(true);
  }, [addMode, isPhone, loading, selected, skills]);

  const selectNow = useCallback((filePath: string) => {
    if (isPhone) {
      const state = { ...(window.history.state ?? {}), piSkillsDetail: historyMarker };
      if (detailHistoryActiveRef.current) window.history.replaceState(state, "", window.location.href);
      else window.history.pushState(state, "", window.location.href);
      detailHistoryActiveRef.current = true;
    }
    setSelected(filePath);
    setAddMode(false);
    clearFeedback();
  }, [clearFeedback, historyMarker, isPhone]);

  const openAddNow = useCallback(() => {
    if (isPhone) {
      const state = { ...(window.history.state ?? {}), piSkillsDetail: historyMarker };
      if (detailHistoryActiveRef.current) window.history.replaceState(state, "", window.location.href);
      else window.history.pushState(state, "", window.location.href);
      detailHistoryActiveRef.current = true;
    }
    setSelected(null);
    setAddMode(true);
    clearFeedback();
  }, [clearFeedback, historyMarker, isPhone]);

  const returnToInventory = useCallback(() => {
    clearFeedback();
    if (isPhone && detailHistoryActiveRef.current && window.history.state?.piSkillsDetail === historyMarker) {
      window.history.back();
      return;
    }
    detailHistoryActiveRef.current = false;
    setSelected(null);
    setAddMode(false);
  }, [clearFeedback, historyMarker, isPhone]);

  const finishClose = useCallback(() => {
    if (detailHistoryActiveRef.current && window.history.state?.piSkillsDetail === historyMarker) {
      detailHistoryActiveRef.current = false;
      window.history.back();
    }
    onClose();
  }, [historyMarker, onClose]);

  const requestSelection = useCallback((filePath: string) => {
    if (busy || (!addMode && selected === filePath)) return;
    selectNow(filePath);
  }, [addMode, busy, selectNow, selected]);

  const requestAdd = useCallback(() => {
    if (busy || addMode) return;
    openAddNow();
  }, [addMode, busy, openAddNow]);

  const requestBack = useCallback(() => {
    if (!busy) returnToInventory();
  }, [busy, returnToInventory]);

  const requestClose = useCallback(() => {
    if (!busy) finishClose();
  }, [busy, finishClose]);

  useEffect(() => {
    if (!isPhone) {
      if (detailHistoryActiveRef.current && window.history.state?.piSkillsDetail === historyMarker) {
        detailHistoryActiveRef.current = false;
        window.history.back();
      }
      return;
    }
    const handlePopState = (event: PopStateEvent) => {
      if (!detailHistoryActiveRef.current || event.state?.piSkillsDetail === historyMarker) return;
      if (installBusy || toggling.size > 0) {
        window.history.pushState({ ...(event.state ?? {}), piSkillsDetail: historyMarker }, "", window.location.href);
        detailHistoryActiveRef.current = true;
        return;
      }
      detailHistoryActiveRef.current = false;
      setSelected(null);
      setAddMode(false);
      clearFeedback();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clearFeedback, historyMarker, installBusy, isPhone, toggling.size]);

  const setSkillAvailability = useCallback(async (
    skill: SkillInfo,
    disableModelInvocation: boolean,
    recordUndo = true,
  ): Promise<boolean> => {
    setToggling((current) => new Set(current).add(skill.filePath));
    setActionError(null);
    setActionMessage(null);
    setUndoSetting(null);
    try {
      const response = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: skill.filePath, disableModelInvocation }),
      });
      const next = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || next.error || !next.success) throw new Error(next.error ?? `HTTP ${response.status}`);
      setSkills((current) => current.map((candidate) => candidate.filePath === skill.filePath
        ? { ...candidate, disableModelInvocation }
        : candidate));
      setActionMessage(recordUndo
        ? disableModelInvocation
          ? "Skill hidden from the model prompt. Manual invocation remains available."
          : "Skill included in the model prompt."
        : "Previous model availability restored.");
      if (recordUndo) {
        setUndoSetting({ filePath: skill.filePath, disableModelInvocation: skill.disableModelInvocation });
      }
      return true;
    } catch (saveFailure) {
      setActionError(saveFailure instanceof Error ? saveFailure.message : String(saveFailure));
      return false;
    } finally {
      setToggling((current) => {
        const next = new Set(current);
        next.delete(skill.filePath);
        return next;
      });
    }
  }, []);

  const toggleSkill = useCallback((skill: SkillInfo) => {
    void setSkillAvailability(skill, !skill.disableModelInvocation);
  }, [setSkillAvailability]);

  const undoLastSetting = useCallback(() => {
    if (!undoSetting) return;
    const skill = skills.find((candidate) => candidate.filePath === undoSetting.filePath);
    if (skill) void setSkillAvailability(skill, undoSetting.disableModelInvocation, false);
  }, [setSkillAvailability, skills, undoSetting]);

  const selectedDiagnostics = selectedSkill
    ? diagnostics.filter((diagnostic) => diagnosticMatchesSkill(diagnostic, selectedSkill))
    : [];
  const diagnosticErrors = diagnostics.some((diagnostic) => diagnostic.type === "error");
  const promptEnabledCount = skills.filter((skill) => !skill.disableModelInvocation).length;
  const manualOnlyCount = skills.length - promptEnabledCount;
  const detailTitle = addMode ? "Add skill" : selectedSkill?.name ?? "Skill details";

  let detailContent: ReactNode = null;
  if (addMode) {
    detailContent = (
      <AddSkillPanel
        cwd={cwd}
        onInstalled={() => void loadSkills()}
        onInstallStateChange={setInstallBusy}
      />
    );
  } else if (selectedSkill) {
    detailContent = (
      <SkillDetail
        key={selectedSkill.filePath}
        skill={selectedSkill}
        cwd={cwd}
        toggling={toggling.has(selectedSkill.filePath)}
        actionError={actionError}
        actionMessage={actionMessage}
        canUndo={undoSetting?.filePath === selectedSkill.filePath}
        diagnostics={selectedDiagnostics}
        onToggle={toggleSkill}
        onUndo={undoLastSetting}
      />
    );
  }

  const footer = (
    <div className={styles.footer}>
      <div className={styles.footerStatus} aria-live="polite">
        <Badge tone={error || actionError ? "danger" : busy ? "accent" : actionMessage ? "success" : diagnosticErrors ? "danger" : diagnostics.length ? "warning" : "neutral"}>
          {error || actionError ? "Error" : busy ? "Working" : actionMessage ? "Updated" : diagnosticErrors ? "Diagnostics" : diagnostics.length ? "Warnings" : "Current"}
        </Badge>
        <span className={styles.footerStatusText}>
          {error ?? actionError ?? actionMessage ?? (diagnostics.length
            ? `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`
            : `${skills.length} skills · ${promptEnabledCount} prompt-enabled · ${manualOnlyCount} manual only`)}
        </span>
      </div>
      <Button
        disabled={loading || busy}
        onClick={() => { clearFeedback(); void loadSkills(); }}
      >
        Refresh
      </Button>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}
      title="Skills"
      description={<code>{shortenPath(cwd)}</code>}
      variant="adaptive"
      size="xl"
      dismissible={!busy}
      initialFocusRef={inventoryFocusRef}
      bodyClassName={styles.dialogBody}
      footer={footer}
    >
      <div className={styles.workspace} data-detail={detailOpen}>
        <SkillInventory
          loading={loading}
          error={error}
          skills={skills}
          diagnostics={diagnostics}
          selected={selected}
          addMode={addMode}
          filter={filter}
          onFilterChange={setFilter}
          onSelect={requestSelection}
          onAdd={requestAdd}
          onRetry={() => void loadSkills()}
          initialFocusRef={inventoryFocusRef}
        />
        <main className={styles.detailPanel}>
          {isPhone && detailOpen && (
            <div className={styles.mobileDetailHeader}>
              <Button variant="ghost" size="touch" className={styles.mobileBackButton} disabled={busy} onClick={requestBack}>
                <span aria-hidden="true">←</span> Back
              </Button>
              <strong title={detailTitle}>{detailTitle}</strong>
            </div>
          )}
          <div className={styles.detailScroll}>
            {detailContent ?? (
              loading ? (
                <div className={styles.detailLoading}>
                  <Skeleton width="36%" height={24} />
                  <Skeleton width="100%" height={190} />
                  <Skeleton width="100%" height={220} />
                </div>
              ) : (
                <div className={styles.detailEmpty}>
                  <EmptyState title="Select a skill" description="Choose a loaded skill to inspect its source and model availability." />
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </Dialog>
  );
}
