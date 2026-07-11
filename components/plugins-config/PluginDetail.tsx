"use client";

import { useEffect, useRef } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Notice,
  SegmentedControl,
  Switch,
} from "@/components/ui";
import type { PluginDiagnostic, PluginPackageInfo } from "@/lib/api-types";
import styles from "../PluginsConfig.module.css";
import {
  installLocation,
  type PluginAction,
  type PluginScope,
  packageKey,
  resourceSummary,
  shortenPath,
  statusTone,
  versionSummary,
} from "./helpers";

const RESOURCE_GROUPS = [
  ["extension", "Extensions"],
  ["skill", "Skills"],
  ["prompt", "Prompts"],
  ["theme", "Themes"],
] as const;

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const groups = RESOURCE_GROUPS
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <EmptyState
        title={pkg.disabled ? "Package disabled" : "No resolved resources"}
        description={pkg.disabled
          ? "Enable this package to load its configured resources."
          : "The package is installed but no enabled resources were discovered."}
      />
    );
  }

  return (
    <div className={styles.resourceGroups}>
      {groups.map((group) => (
        <section className={styles.resourceGroup} key={group.kind}>
          <div className={styles.resourceGroupHeader}>
            <h4>{group.label}</h4>
            <Badge tone="neutral">{group.resources.length}</Badge>
          </div>
          <div className={styles.resourceList}>
            {group.resources.map((resource) => (
              <div className={styles.resourceRow} key={`${resource.kind}:${resource.path}`}>
                <span className={styles.resourceKind} aria-hidden="true">{resource.kind.slice(0, 1).toUpperCase()}</span>
                <span className={styles.resourceCopy}>
                  <code className={styles.resourceName} title={resource.path}>{resource.name}</code>
                  <code className={styles.resourcePath} title={resource.path}>{resource.relativePath}</code>
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: PluginDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  const hasError = diagnostics.some((diagnostic) => diagnostic.type === "error");
  return (
    <Notice tone={hasError ? "danger" : "warning"} title={`${diagnostics.length} package diagnostic${diagnostics.length === 1 ? "" : "s"}`}>
      <ul className={styles.diagnosticList}>
        {diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.type}:${diagnostic.source ?? "global"}:${diagnostic.path ?? ""}:${diagnostic.message}`}>{diagnostic.message}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  diagnostics,
  sessionId,
  canUndo,
  onAction,
  onUndo,
  onReloadSession,
  onRequestRemove,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  diagnostics: PluginDiagnostic[];
  sessionId: string | null;
  canUndo: boolean;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onUndo: () => void;
  onReloadSession: () => void;
  onRequestRemove: () => void;
}) {
  const key = packageKey(pkg);
  const packageBusy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;
  const statusDescription = pkg.status === "loaded"
    ? "Resources are available to new or reloaded sessions."
    : pkg.status === "installed"
      ? "The package is installed but has no currently loaded resources."
      : pkg.status === "disabled"
        ? "All package resource filters are disabled."
        : "The configured package path could not be found.";

  return (
    <div className={styles.editorStack}>
      <div className={styles.editorHeading}>
        <div>
          <div className={styles.badgeRow}>
            <Badge tone={pkg.scope === "project" ? "accent" : "neutral"}>{pkg.scope}</Badge>
            <Badge tone={statusTone(pkg.status)}>{pkg.status}</Badge>
            {pkg.filtered && !pkg.disabled && <Badge tone="warning">Filtered</Badge>}
          </div>
          <h2 className={styles.editorTitle}>{pkg.packageName ?? pkg.source}</h2>
          <p className={styles.editorDescription}><code>{pkg.source}</code></p>
        </div>
        <div className={styles.headingActions}>
          <Button
            loading={busyKey === `update:${key}`}
            disabled={packageBusy || reloadBusy}
            onClick={() => onAction("update", pkg)}
          >
            Update package
          </Button>
          <Button variant="danger" disabled={packageBusy || reloadBusy} onClick={onRequestRemove}>Remove</Button>
        </div>
      </div>

      {actionMessage && (
        <Notice
          tone="success"
          title="Package action complete"
          actions={canUndo ? <Button size="compact" onClick={onUndo}>Undo</Button> : undefined}
        >
          {actionMessage}
        </Notice>
      )}
      {actionError && <Notice tone="danger" title="Package action failed">{actionError}</Notice>}
      <Diagnostics diagnostics={diagnostics} />

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Runtime state</h3>
            <p className={styles.formSectionDescription}>{statusDescription}</p>
          </div>
        </div>
        <div className={styles.formSectionBody}>
          <Switch
            checked={enabled}
            disabled={packageBusy || reloadBusy}
            onCheckedChange={(checked) => onAction(checked ? "enable" : "disable", pkg)}
            label={enabled ? "Package enabled" : "Package disabled"}
            description={packageBusy ? "Saving package state…" : "Changes are saved immediately and can be undone."}
          />
          <div className={styles.inlineActions}>
            <Button
              loading={reloadBusy}
              disabled={!sessionId || packageBusy}
              title={sessionId ? "Reload current session" : "Open a session to reload"}
              onClick={onReloadSession}
            >
              Reload current session
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Package metadata</h3>
            <p className={styles.formSectionDescription}>Configured source and resolved installation details.</p>
          </div>
        </div>
        <dl className={styles.metadataGrid}>
          <div><dt>Version</dt><dd><code>{versionSummary(pkg)}</code></dd></div>
          <div><dt>Resources</dt><dd>{resourceSummary(pkg)}</dd></div>
          <div><dt>Package name</dt><dd><code>{pkg.packageName ?? "Unknown"}</code></dd></div>
          <div><dt>Installed path</dt><dd className={!pkg.installedPath ? styles.missingValue : undefined}><code>{pkg.installedPath ? shortenPath(pkg.installedPath) : "Not found"}</code></dd></div>
          <div><dt>Project cwd</dt><dd><code>{shortenPath(cwd)}</code></dd></div>
          <div><dt>Configured source</dt><dd><code>{pkg.source}</code></dd></div>
        </dl>
      </section>

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Resolved resources</h3>
            <p className={styles.formSectionDescription}>Extensions, skills, prompts, and themes exposed by this package.</p>
          </div>
        </div>
        <ResourceList pkg={pkg} />
      </section>
    </div>
  );
}

export function AddPluginPanel({
  cwd,
  source,
  scope,
  busy,
  actionError,
  actionMessage,
  onSourceChange,
  onScopeChange,
  onInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  busy: boolean;
  actionError: string | null;
  actionMessage: string | null;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const examples = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className={styles.editorStack}>
      <div className={styles.editorHeading}>
        <div>
          <Badge tone="accent">New package</Badge>
          <h2 className={styles.editorTitle}>Add plugin</h2>
          <p className={styles.editorDescription}>Install an npm package, git repository, or local plugin directory.</p>
        </div>
      </div>

      {actionMessage && <Notice tone="success" title="Package installed">{actionMessage}</Notice>}
      {actionError && <Notice tone="danger" title="Package was not installed">{actionError}</Notice>}

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Installation</h3>
            <p className={styles.formSectionDescription}>Choose where the package is configured, then provide its source.</p>
          </div>
        </div>
        <div className={styles.formSectionBody}>
          <SegmentedControl
            value={scope}
            options={[
              { value: "global", label: "Global" },
              { value: "project", label: "Project" },
            ]}
            onValueChange={(next) => onScopeChange(next as PluginScope)}
            label="Plugin installation scope"
            fullWidth
          />
          <div className={styles.installPath}>
            <span>Installation target</span>
            <code>{installLocation(scope, cwd)}</code>
          </div>
          <Field label="Package source" hint="npm:, git:, and absolute local paths are supported.">
            <Input
              ref={inputRef}
              value={source}
              onChange={(event) => onSourceChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && source.trim() && !busy) onInstall(); }}
              placeholder="npm:@scope/package"
              mono
            />
          </Field>
          <div className={styles.inlineActions}>
            <Button variant="primary" loading={busy} disabled={!source.trim()} onClick={onInstall}>Install plugin</Button>
          </div>
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Source examples</h3>
            <p className={styles.formSectionDescription}>Select an example to populate the source field.</p>
          </div>
        </div>
        <div className={styles.exampleList}>
          {examples.map((example) => (
            <button type="button" className={styles.exampleButton} key={example} onClick={() => onSourceChange(example)}>
              <code>{example}</code>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
