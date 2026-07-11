"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Dialog, EmptyState, Input, Notice, SegmentedControl, Skeleton } from "@/components/ui";
import { buildWebKeybindings, type WebKeybinding } from "@/lib/web-keybindings";
import styles from "./HotkeysModal.module.css";
import {
  bindingMatches,
  groupKeybindings,
  type HotkeyFilter,
  hotkeyScopeLabel,
  hotkeySourceLabel,
  hotkeyStats,
  hotkeyStatusLabel,
  hotkeyStatusTone,
  shortenHotkeyPath,
  splitKeySequence,
} from "./hotkeys/helpers";

interface KeybindingsResponse {
  path?: string;
  keybindings?: WebKeybinding[];
  error?: string;
}

function withOccurrenceIds<T>(values: T[], label: (value: T) => string): Array<{ id: string; value: T; first: boolean }> {
  const counts = new Map<string, number>();
  return values.map((value, index) => {
    const base = label(value);
    const occurrence = counts.get(base) ?? 0;
    counts.set(base, occurrence + 1);
    return { id: `${base}:${occurrence}`, value, first: index === 0 };
  });
}

function KeySequence({ combo }: { combo: string }) {
  const sequence = withOccurrenceIds(splitKeySequence(combo), (chord) => chord.join("+"));
  return (
    <span className={styles.keySequence}>
      {sequence.map(({ id: chordId, value: chord, first: firstChord }) => (
        <span className={styles.chord} key={chordId}>
          {!firstChord && <span className={styles.thenLabel}>then</span>}
          {withOccurrenceIds(chord, (key) => key).map(({ id: keyId, value: key, first: firstKey }) => (
            <span className={styles.keyPart} key={keyId}>
              {!firstKey && <span aria-hidden="true">+</span>}
              <kbd>{key}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function ShortcutCard({ binding }: { binding: WebKeybinding }) {
  return (
    <article className={styles.shortcutCard} data-status={binding.status}>
      <div className={styles.shortcutIdentity}>
        <h4>{binding.label}</h4>
        <p>{binding.description}</p>
        <code>{binding.action}</code>
      </div>
      <div className={styles.shortcutKeys}>
        {binding.keys.length > 0 ? binding.keys.map((combo, index) => (
          <span className={styles.keyAlternative} key={combo}>
            {index > 0 && <span className={styles.orLabel}>or</span>}
            <KeySequence combo={combo} />
          </span>
        )) : <span className={styles.unboundLabel}>No key assigned</span>}
      </div>
      <div className={styles.shortcutMeta}>
        <Badge tone={binding.source === "default" ? "neutral" : "accent"}>{hotkeySourceLabel(binding)}</Badge>
        <Badge tone={hotkeyStatusTone(binding.status)}>{hotkeyStatusLabel(binding.status)}</Badge>
      </div>
      {binding.conflict && <p className={styles.conflictCopy}>{binding.conflict}</p>}
    </article>
  );
}

export function HotkeysModal({ onClose }: { onClose: () => void }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<KeybindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HotkeyFilter>("all");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setData((current) => current ? { ...current, error: undefined } : current);
    try {
      const response = await fetch("/api/keybindings", { cache: "no-store", signal });
      const body = await response.json().catch(() => ({})) as KeybindingsResponse;
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setData(body);
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setData({
        error: loadError instanceof Error ? loadError.message : String(loadError),
        keybindings: buildWebKeybindings(),
      });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const keybindings = useMemo(() => data?.keybindings ?? buildWebKeybindings(), [data]);
  const stats = useMemo(() => hotkeyStats(keybindings), [keybindings]);
  const filtered = useMemo(() => keybindings.filter((binding) => bindingMatches(binding, query, filter)), [filter, keybindings, query]);
  const groups = useMemo(() => groupKeybindings(filtered), [filtered]);
  const issueCount = stats.conflicts + stats.unbound;
  const footerStatus = loading
    ? "Refreshing shortcuts…"
    : data?.error
      ? "Showing built-in defaults"
      : `${filtered.length} of ${keybindings.length} shortcuts`;

  const filterOptions = [
    { value: "all", label: `All ${keybindings.length}` },
    { value: "custom", label: `Custom ${stats.custom}` },
    { value: "issues", label: `Issues ${issueCount}` },
  ];

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title="Keyboard shortcuts"
      description={data?.path ? <code>{shortenHotkeyPath(data.path)}</code> : "Web keybinding registry"}
      variant="adaptive"
      size="xl"
      bodyClassName={styles.dialogBody}
      initialFocusRef={searchRef}
      footer={
        <div className={styles.footer}>
          <span className={styles.footerStatus} aria-live="polite">{footerStatus}</span>
          <Button loading={loading} disabled={loading} onClick={() => void load()}>Refresh</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className={styles.workspace} aria-busy={loading || undefined}>
        {loading && !data ? (
          <div className={styles.loadingState}>
            <div className={styles.summarySkeletons}>
              {[0, 1, 2, 3].map((item) => <Skeleton key={item} height={76} width="100%" />)}
            </div>
            <Skeleton height={44} width="100%" />
            {[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} height={82} width={item % 2 ? "92%" : "100%"} />)}
          </div>
        ) : (
          <div className={styles.content}>
            {loading && <div className={styles.refreshingBar}><Skeleton height={4} width="100%" /></div>}
            {data?.error && (
              <Notice tone="warning" title="Custom shortcuts could not be loaded" actions={<Button size="compact" onClick={() => void load()}>Retry</Button>}>
                Showing built-in defaults. {data.error}
              </Notice>
            )}

            <section className={styles.summary} aria-label="Shortcut summary">
              <div><span>Total</span><strong>{keybindings.length}</strong><small>Registered web actions</small></div>
              <div><span>Active</span><strong>{stats.active}</strong><small>Ready to use</small></div>
              <div><span>Customized</span><strong>{stats.custom}</strong><small>User or extension source</small></div>
              <div data-warning={issueCount > 0 || undefined}><span>Issues</span><strong>{issueCount}</strong><small>Conflicts or unbound</small></div>
            </section>

            <section className={styles.registrySource}>
              <div>
                <span>Registry source</span>
                <code title={data?.path}>{data?.path ? shortenHotkeyPath(data.path) : "Built-in pi-web defaults"}</code>
              </div>
              <p>Customize shortcuts in the keybinding file, then refresh this view. Browser-reserved combinations remain visible as conflicts.</p>
            </section>

            <div className={styles.toolbar}>
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search actions, keys, or scopes"
                aria-label="Search keyboard shortcuts"
              />
              <SegmentedControl
                value={filter}
                options={filterOptions}
                onValueChange={(value) => setFilter(value as HotkeyFilter)}
                label="Shortcut filter"
                fullWidth
              />
            </div>

            {keybindings.length === 0 ? (
              <EmptyState title="No shortcuts registered" description="The web keybinding registry did not return any actions." />
            ) : groups.length === 0 ? (
              <EmptyState
                title="No matching shortcuts"
                description={query.trim() ? `Nothing matched “${query.trim()}”.` : "No shortcuts match the selected filter."}
                action={<Button size="compact" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button>}
              />
            ) : (
              <div className={styles.groupList}>
                {groups.map((group) => (
                  <section className={styles.shortcutGroup} key={group.scope}>
                    <div className={styles.groupHeader}>
                      <div><h3>{hotkeyScopeLabel(group.scope)}</h3><p>{group.bindings.length} shortcut{group.bindings.length === 1 ? "" : "s"}</p></div>
                      <Badge tone="neutral">{group.scope}</Badge>
                    </div>
                    <div className={styles.shortcutList}>
                      {group.bindings.map((binding) => <ShortcutCard binding={binding} key={binding.action} />)}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
