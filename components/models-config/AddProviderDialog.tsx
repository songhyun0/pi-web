"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, EmptyState, Input } from "@/components/ui";
import styles from "../ModelsConfig.module.css";
import { ProviderIcon } from "./ProviderIcon";
import type { ApiKeyProvider, OAuthProvider } from "./types";

export function AddProviderDialog({
  open,
  oauthProviders,
  apiKeyProviders,
  onSelectOAuth,
  onSelectApiKey,
  onAddCustom,
  onClose,
}: {
  open: boolean;
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  const query = search.trim().toLowerCase();
  const availableOAuth = oauthProviders.filter((provider) => (
    !provider.loggedIn && (!query || provider.name.toLowerCase().includes(query) || provider.id.toLowerCase().includes(query))
  ));
  const availableApiKey = apiKeyProviders.filter((provider) => (
    !provider.configured && (!query || provider.displayName.toLowerCase().includes(query) || provider.id.toLowerCase().includes(query))
  ));
  const showCustom = !query || "custom openai anthropic compatible endpoint".includes(query);
  const hasResults = showCustom || availableOAuth.length > 0 || availableApiKey.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title="Add provider"
      description="Connect a managed provider or define a custom compatible endpoint."
      variant="adaptive"
      size="lg"
      initialFocusRef={inputRef}
      bodyClassName={styles.pickerBody}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className={styles.pickerSearch}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <Input
          ref={inputRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search providers…"
          aria-label="Search providers"
        />
      </div>

      {hasResults ? (
        <div className={styles.pickerGroups}>
          {showCustom && (
            <section className={styles.pickerGroup}>
              <h3 className={styles.pickerGroupTitle}>Custom endpoint</h3>
              <button
                type="button"
                className={styles.providerCard}
                onClick={() => { onAddCustom(); onClose(); }}
              >
                <span className={styles.customProviderMark} aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
                <span className={styles.providerCardCopy}>
                  <strong>OpenAI / Anthropic compatible</strong>
                  <span>Configure a custom base URL, protocol, and key source.</span>
                </span>
                <span className={styles.providerCardArrow} aria-hidden="true">→</span>
              </button>
            </section>
          )}

          {availableOAuth.length > 0 && (
            <section className={styles.pickerGroup}>
              <h3 className={styles.pickerGroupTitle}>Subscriptions</h3>
              <div className={styles.providerCardGrid}>
                {availableOAuth.map((provider) => (
                  <button
                    type="button"
                    className={styles.providerCard}
                    key={provider.id}
                    onClick={() => { onSelectOAuth(provider.id); onClose(); }}
                  >
                    <ProviderIcon id={provider.id} size="md" />
                    <span className={styles.providerCardCopy}>
                      <strong>{provider.name}</strong>
                      <span>Browser sign-in</span>
                    </span>
                    <span className={styles.providerCardArrow} aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {availableApiKey.length > 0 && (
            <section className={styles.pickerGroup}>
              <h3 className={styles.pickerGroupTitle}>API key providers</h3>
              <div className={styles.providerCardGrid}>
                {availableApiKey.map((provider) => (
                  <button
                    type="button"
                    className={styles.providerCard}
                    key={provider.id}
                    onClick={() => { onSelectApiKey(provider.id); onClose(); }}
                  >
                    <ProviderIcon id={provider.id} size="md" />
                    <span className={styles.providerCardCopy}>
                      <strong>{provider.displayName}</strong>
                      <span>{provider.modelCount} model{provider.modelCount === 1 ? "" : "s"}</span>
                    </span>
                    <span className={styles.providerCardArrow} aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <EmptyState title="No providers found" description="Try a broader provider name or add a custom endpoint." />
      )}
    </Dialog>
  );
}
