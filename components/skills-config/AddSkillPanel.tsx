"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, Field, Input, Notice, SegmentedControl, Skeleton } from "@/components/ui";
import type { SkillSearchResult } from "@/lib/api-types";
import styles from "../SkillsConfig.module.css";
import { shortenPath, splitSearchPackage } from "./helpers";

type InstallScope = "global" | "project";

export function AddSkillPanel({
  cwd,
  onInstalled,
  onInstallStateChange,
}: {
  cwd: string;
  onInstalled: () => void;
  onInstallStateChange: (installing: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installedPackages, setInstalledPackages] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<InstallScope>("global");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const search = useCallback(async () => {
    const value = query.trim();
    if (!value || searching || installing) return;
    setSearching(true);
    setHasSearched(true);
    setSearchedQuery(value);
    setSearchError(null);
    setInstallError(null);
    setInstallMessage(null);
    setResults([]);
    try {
      const response = await fetch("/api/skills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
      });
      const next = await response.json() as { results?: SkillSearchResult[]; error?: string };
      if (!response.ok || next.error) throw new Error(next.error ?? `HTTP ${response.status}`);
      setResults(next.results ?? []);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }, [installing, query, searching]);

  const install = useCallback(async (pkg: string) => {
    if (installing) return;
    setInstalling(pkg);
    onInstallStateChange(true);
    setInstallError(null);
    setInstallMessage(null);
    try {
      const response = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: pkg, scope, cwd }),
      });
      const next = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || next.error || !next.success) throw new Error(next.error ?? `HTTP ${response.status}`);
      setInstalledPackages((current) => new Set(current).add(pkg));
      setInstallMessage(`${pkg} was installed for the ${scope} scope.`);
      onInstalled();
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(null);
      onInstallStateChange(false);
    }
  }, [cwd, installing, onInstalled, onInstallStateChange, scope]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void search();
  };

  const installPath = scope === "global"
    ? "~/.pi/agent/skills/"
    : `${shortenPath(cwd)}/.pi/agent/skills/`;

  return (
    <div className={styles.editorStack}>
      <div className={styles.editorHeading}>
        <div>
          <Badge tone="accent">skills.sh</Badge>
          <h2 className={styles.editorTitle}>Add skill</h2>
          <p className={styles.editorDescription}>Search the public skill registry and install a skill for your user or this project.</p>
        </div>
      </div>

      {installMessage && <Notice tone="success" title="Skill installed">{installMessage}</Notice>}
      {installError && <Notice tone="danger" title="Skill was not installed">{installError}</Notice>}
      {searchError && <Notice tone="danger" title="Search failed">{searchError}</Notice>}

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Registry search</h3>
            <p className={styles.formSectionDescription}>Choose the installation scope before selecting a result.</p>
          </div>
        </div>
        <div className={styles.formSectionBody}>
          <SegmentedControl
            value={scope}
            options={[
              { value: "global", label: "Global", disabled: Boolean(installing) },
              { value: "project", label: "Project", disabled: Boolean(installing) },
            ]}
            onValueChange={(next) => setScope(next as InstallScope)}
            label="Skill installation scope"
            fullWidth
          />
          <div className={styles.installPath}>
            <span>Installation target</span>
            <code>{installPath}</code>
          </div>
          <form className={styles.searchForm} onSubmit={submitSearch}>
            <Field label="Search skills.sh" hint="Try a framework, workflow, or capability such as testing or deploy.">
              <Input
                ref={inputRef}
                value={query}
                disabled={Boolean(installing)}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="react, testing, deploy"
              />
            </Field>
            <Button variant="primary" type="submit" loading={searching} disabled={!query.trim() || Boolean(installing)}>Search</Button>
          </form>
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.formSectionHeader}>
          <div>
            <h3 className={styles.formSectionTitle}>Search results</h3>
            <p className={styles.formSectionDescription}>
              {searchError
                ? "Search request failed."
                : hasSearched && !searching
                  ? `${results.length} result${results.length === 1 ? "" : "s"}`
                  : "Results from skills.sh appear here."}
            </p>
          </div>
        </div>

        {searching ? (
          <output className={styles.resultSkeletons} aria-live="polite" aria-label="Searching skills">
            {[0, 1, 2].map((item) => <Skeleton key={item} width={item === 1 ? "82%" : "100%"} height={64} />)}
          </output>
        ) : searchError ? (
          <EmptyState title="Search unavailable" description="Review the error above, then try the search again." />
        ) : results.length > 0 ? (
          <div className={styles.resultList}>
            {results.map((result) => {
              const parsed = splitSearchPackage(result.package);
              const isInstalled = installedPackages.has(result.package);
              const isInstalling = installing === result.package;
              return (
                <article className={styles.resultCard} key={result.package}>
                  <div className={styles.resultCopy}>
                    <div className={styles.resultTitleRow}>
                      <strong>{parsed.skill}</strong>
                      {isInstalled && <Badge tone="success">Installed</Badge>}
                    </div>
                    <code>{parsed.repository}</code>
                    <div className={styles.resultMeta}>
                      {result.installs && <span>{result.installs}</span>}
                      {result.url && (
                        <a href={result.url} target="_blank" rel="noreferrer">View on skills.sh ↗</a>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={isInstalled ? "secondary" : "primary"}
                    loading={isInstalling}
                    disabled={isInstalled || Boolean(installing)}
                    onClick={() => void install(result.package)}
                  >
                    {isInstalled ? "Installed" : "Install"}
                  </Button>
                </article>
              );
            })}
          </div>
        ) : hasSearched ? (
          <EmptyState
            title="No skills found"
            description={`No registry results matched “${searchedQuery}”. Try a broader search term.`}
          />
        ) : (
          <EmptyState
            title="Discover reusable agent skills"
            description="Search skills.sh for maintained workflows, domain guidance, and integrations."
            action={<a className={styles.registryLink} href="https://skills.sh" target="_blank" rel="noreferrer">Browse skills.sh ↗</a>}
          />
        )}
      </section>
    </div>
  );
}
