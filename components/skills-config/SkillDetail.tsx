"use client";

import { Badge, Button, Notice, Switch } from "@/components/ui";
import type { SkillDiagnostic, SkillInfo } from "@/lib/api-types";
import styles from "../SkillsConfig.module.css";
import {
  displaySkillPath,
  shortenPath,
  sourceGroup,
  sourceKind,
  sourceSummary,
} from "./helpers";

function SkillDiagnostics({ diagnostics }: { diagnostics: SkillDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  const hasError = diagnostics.some((diagnostic) => diagnostic.type === "error");
  return (
    <Notice
      tone={hasError ? "danger" : "warning"}
      title={`${diagnostics.length} skill diagnostic${diagnostics.length === 1 ? "" : "s"}`}
    >
      <ul className={styles.diagnosticList}>
        {diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.type}:${diagnostic.path ?? "global"}:${diagnostic.message}`}>{diagnostic.message}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function SkillDetail({
  skill,
  cwd,
  toggling,
  actionError,
  actionMessage,
  canUndo,
  diagnostics,
  onToggle,
  onUndo,
}: {
  skill: SkillInfo;
  cwd: string;
  toggling: boolean;
  actionError: string | null;
  actionMessage: string | null;
  canUndo: boolean;
  diagnostics: SkillDiagnostic[];
  onToggle: (skill: SkillInfo) => void;
  onUndo: () => void;
}) {
  const enabled = !skill.disableModelInvocation;
  const group = sourceGroup(skill);

  return (
    <div className={styles.editorStack}>
      <div className={styles.editorHeading}>
        <div>
          <div className={styles.badgeRow}>
            <Badge tone={group === "project" ? "accent" : "neutral"}>{group}</Badge>
            <Badge tone="neutral">{enabled ? "Prompt enabled" : "Manual only"}</Badge>
            {skill.sourceInfo?.origin === "package" && <Badge tone="neutral">Package</Badge>}
          </div>
          <h2 className={styles.editorTitle}>{skill.name}</h2>
          <p className={styles.editorDescription}>{skill.description || "No description provided by this skill."}</p>
        </div>
      </div>

      {actionMessage && (
        <Notice
          tone="success"
          title="Skill setting updated"
          actions={canUndo ? <Button size="compact" onClick={onUndo}>Undo</Button> : undefined}
        >
          {actionMessage}
        </Notice>
      )}
      {actionError && <Notice tone="danger" title="Skill setting was not saved">{actionError}</Notice>}
      <SkillDiagnostics diagnostics={diagnostics} />

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Model availability</h3>
            <p className={styles.formSectionDescription}>
              Control whether the model sees this skill in its system prompt.
            </p>
          </div>
        </div>
        <div className={styles.formSectionBody}>
          <Switch
            checked={enabled}
            disabled={toggling}
            onCheckedChange={() => onToggle(skill)}
            label={enabled ? "Included in model prompt" : "Hidden from model prompt"}
            description={toggling
              ? "Saving skill availability…"
              : enabled
                ? "The model can discover and invoke this skill automatically."
                : "The skill remains available through its explicit slash command."}
          />
          <div className={styles.commandHint}>
            <span>Manual invocation</span>
            <code>/skill:{skill.name}</code>
          </div>
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Skill metadata</h3>
            <p className={styles.formSectionDescription}>Resolved source and filesystem location reported by pi.</p>
          </div>
        </div>
        <dl className={styles.metadataGrid}>
          <div><dt>Source type</dt><dd>{sourceKind(skill)}</dd></div>
          <div><dt>Scope</dt><dd><code>{skill.sourceInfo?.scope ?? group}</code></dd></div>
          <div><dt>Source</dt><dd><code>{skill.sourceInfo?.source ?? sourceSummary(skill)}</code></dd></div>
          <div><dt>Origin</dt><dd><code>{skill.sourceInfo?.origin ?? "top-level"}</code></dd></div>
          <div><dt>Skill directory</dt><dd><code>{shortenPath(skill.baseDir)}</code></dd></div>
          <div><dt>Manifest</dt><dd><code>{displaySkillPath(skill, cwd)}</code></dd></div>
        </dl>
      </section>

      <Notice tone="neutral" title="Frontmatter setting">
        This switch changes only <code>disable-model-invocation</code> in the skill&apos;s <code>SKILL.md</code>; all other formatting is preserved.
      </Notice>
    </div>
  );
}
