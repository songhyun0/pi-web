"use client";

import { Badge, Button, EmptyState, Notice } from "@/components/ui";
import type { ProfileDefinition } from "@/lib/profiles";
import styles from "../ProfileManagerModal.module.css";
import {
  formatProfileDate,
  packageLabel,
  packageSource,
  presetDescription,
  presetLabel,
} from "./helpers";

export function ProfileDetail({
  profile,
  isDefault,
  busy,
  onSetDefault,
  onEdit,
  onDelete,
}: {
  profile: ProfileDefinition;
  isDefault: boolean;
  busy: boolean;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const editable = profile.id.startsWith("profile:");
  const hiddenSkills = profile.skills.disabledSkillRefs ?? [];

  return (
    <div className={styles.editorStack}>
      <div className={styles.editorHeading}>
        <div>
          <div className={styles.badgeRow}>
            <Badge tone={editable ? "neutral" : "accent"}>{editable ? "Saved profile" : "Built-in"}</Badge>
            {isDefault && <Badge tone="accent">Global default</Badge>}
          </div>
          <h2 className={styles.editorTitle}>{profile.name}</h2>
          <p className={styles.editorDescription}>{profile.description || "No description provided for this profile."}</p>
        </div>
        <div className={styles.headingActions}>
          {!isDefault && <Button variant="primary" disabled={busy} onClick={onSetDefault}>Make default</Button>}
          {editable && <Button disabled={busy} onClick={onEdit}>Edit</Button>}
          {editable && <Button variant="danger" disabled={busy} onClick={onDelete}>Delete</Button>}
        </div>
      </div>

      {isDefault && (
        <Notice tone="accent" title="Server-owned global default">
          New sessions without an explicit profile selection use this profile.
        </Notice>
      )}

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Capability summary</h3>
            <p className={styles.formSectionDescription}>Saved capability inputs. Effective runtime details are resolved by the server preview.</p>
          </div>
        </div>
        <div className={styles.capabilityGrid}>
          <div><span>Built-in tools</span><strong>{presetLabel(profile.tools.builtinPreset)}</strong><small>{presetDescription(profile.tools.builtinPreset)}</small></div>
          <div><span>Plugins</span><strong>{profile.plugins.length}</strong><small>Selected package sources</small></div>
          <div><span>Hidden skills</span><strong>{hiddenSkills.length}</strong><small>Explicitly narrowed skill refs</small></div>
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Selected plugins</h3>
            <p className={styles.formSectionDescription}>Packages that may contribute extensions and skills to this profile.</p>
          </div>
          <Badge tone="neutral">{profile.plugins.length}</Badge>
        </div>
        {profile.plugins.length > 0 ? (
          <div className={styles.compactList}>
            {profile.plugins.map((plugin) => {
              const source = packageSource(plugin);
              return (
                <div className={styles.compactRow} key={source}>
                  <strong>{packageLabel(source)}</strong>
                  <code title={source}>{source}</code>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No selected plugins" description="This profile relies only on its built-in tool preset and standalone skills." />
        )}
      </section>

      {hiddenSkills.length > 0 && (
        <section className={styles.formSection}>
          <div className={styles.formSectionHeader}>
            <div>
              <h3 className={styles.formSectionTitle}>Hidden skills</h3>
              <p className={styles.formSectionDescription}>Skill references explicitly removed from the effective profile.</p>
            </div>
            <Badge tone="neutral">{hiddenSkills.length}</Badge>
          </div>
          <div className={styles.compactList}>
            {hiddenSkills.map((skill) => (
              <div className={styles.compactRow} key={`${skill.source}:${skill.path}`}>
                <strong>{skill.name ?? skill.path}</strong>
                <code title={`${skill.source} · ${skill.path}`}>{skill.source} · {skill.path}</code>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Profile metadata</h3>
            <p className={styles.formSectionDescription}>Stable identity and saved timestamps.</p>
          </div>
        </div>
        <dl className={styles.metadataGrid}>
          <div><dt>Profile ref</dt><dd><code>{profile.id}</code></dd></div>
          <div><dt>Type</dt><dd>{editable ? "Saved" : "Built-in"}</dd></div>
          <div><dt>Created</dt><dd>{formatProfileDate(profile.createdAt)}</dd></div>
          <div><dt>Updated</dt><dd>{formatProfileDate(profile.updatedAt)}</dd></div>
        </dl>
      </section>
    </div>
  );
}
