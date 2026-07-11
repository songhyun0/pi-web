"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Dialog, Field, Input, Notice } from "@/components/ui";
import styles from "../ModelsConfig.module.css";
import { SecretInput } from "./Controls";
import type { ApiKeyProvider, OAuthLoginState, OAuthProvider } from "./types";

export function OAuthEditor({
  provider,
  onRefresh,
  onTransientDirtyChange,
}: {
  provider: OAuthProvider;
  onRefresh: () => void;
  onTransientDirtyChange: (dirty: boolean) => void;
}) {
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(timer);
    }
  }, [loginState.phase]);


  useEffect(() => {
    onTransientDirtyChange(isWorking || Boolean(inputValue.trim()) || disconnectOpen || loggingOut);
  }, [disconnectOpen, inputValue, isWorking, loggingOut, onTransientDirtyChange]);

  useEffect(() => () => {
    eventSourceRef.current?.close();
    onTransientDirtyChange(false);
  }, [onTransientDirtyChange]);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const eventSource = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = eventSource;
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type: string;
        url?: string;
        instructions?: string | null;
        token?: string;
        message?: string;
        placeholder?: string | null;
        userCode?: string;
        verificationUri?: string;
        intervalSeconds?: number | null;
        expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        if (!data.url || !data.token) {
          eventSource.close();
          setLoginState({ phase: "error", message: "The provider returned an incomplete sign-in request." });
          return;
        }
        setLoginState({ phase: "auth", url: data.url, instructions: data.instructions ?? null, token: data.token });
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        if (!data.userCode || !data.verificationUri) {
          eventSource.close();
          setLoginState({ phase: "error", message: "The provider returned an incomplete device-code request." });
          return;
        }
        setLoginState({
          phase: "device_code",
          userCode: data.userCode,
          verificationUri: data.verificationUri,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        if (!data.message || !data.token) {
          setLoginState({ phase: "error", message: "The provider returned an incomplete verification prompt." });
          return;
        }
        setLoginState({ phase: "prompt", message: data.message, placeholder: data.placeholder ?? null, token: data.token });
      } else if (data.type === "select_request") {
        if (!data.message || !data.token) {
          setLoginState({ phase: "error", message: "The provider returned an incomplete account selection." });
          return;
        }
        setLoginState({ phase: "select", message: data.message, options: data.options ?? [], token: data.token });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message ?? "Continuing…" });
      } else if (data.type === "success") {
        eventSource.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        eventSource.close();
        setLoginState({ phase: "error", message: data.message ?? "Authentication failed." });
      } else if (data.type === "cancelled") {
        eventSource.close();
        setLoginState({ phase: "idle" });
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      setLoginState((current) => current.phase === "success" ? current : { phase: "error", message: "Connection lost." });
    };
  }, [onRefresh, provider.id]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: "Verifying…" });
    try {
      const response = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: data.error ?? `Server error ${response.status}` });
        return;
      }
      setInputValue("");
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : "Network error" });
    }
  }, [provider.id]);

  const submitSelection = useCallback(async (token: string, code: string) => {
    setLoginState({ phase: "progress", message: "Continuing…" });
    try {
      const response = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: data.error ?? `Server error ${response.status}` });
      }
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : "Network error" });
    }
  }, [provider.id]);

  const cancelLogin = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setInputValue("");
    setLoginState({ phase: "idle" });
  };

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      const response = await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setLoginState({ phase: "idle" });
      setDisconnectOpen(false);
      onRefresh();
    } catch (error) {
      setDisconnectOpen(false);
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoggingOut(false);
    }
  }, [onRefresh, provider.id]);

  return (
    <>
      <div className={styles.editorStack}>
        <div className={styles.editorHeading}>
          <div>
            <Badge tone={provider.loggedIn ? "success" : "neutral"}>{provider.loggedIn ? "Connected" : "Not connected"}</Badge>
            <h2 className={styles.editorTitle}>{provider.name}</h2>
            <p className={styles.editorDescription}>Connect a subscription account through pi&apos;s provider authentication flow.</p>
          </div>
        </div>

        <section className={styles.formSection}>
          <div className={styles.formSectionHeader}>
            <div>
              <h3 className={styles.formSectionTitle}>Subscription</h3>
              <p className={styles.formSectionDescription}>
                {provider.loggedIn ? "This account is available to the model registry." : `Sign in to enable ${provider.name} models.`}
              </p>
            </div>
          </div>
          <div className={styles.formSectionBody}>
            {loginState.phase === "idle" && (
              <Notice title={provider.loggedIn ? "Account connected" : "Authentication required"}>
                {provider.loggedIn ? "You can re-authenticate or disconnect this account." : "A browser window opens to complete sign-in."}
              </Notice>
            )}
            {loginState.phase === "connecting" && <Notice title="Opening browser">Preparing the provider sign-in flow…</Notice>}
            {loginState.phase === "progress" && <Notice title="Authentication in progress">{loginState.message}</Notice>}
            {loginState.phase === "success" && <Notice tone="success" title="Connected">The provider account is ready.</Notice>}
            {loginState.phase === "error" && <Notice tone="danger" title="Authentication failed">{loginState.message}</Notice>}

            {loginState.phase === "select" && (
              <div className={styles.authStep}>
                <p className={styles.authCopy}>{loginState.message}</p>
                <div className={styles.choiceList}>
                  {loginState.options.map((option) => (
                    <Button key={option.id} onClick={() => void submitSelection(loginState.token, option.id)}>
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {(loginState.phase === "auth" || loginState.phase === "prompt") && (
              <div className={styles.authStep}>
                <p className={styles.authCopy}>
                  {loginState.phase === "auth"
                    ? loginState.instructions || "Complete sign-in in the browser, then paste the redirect URL from the address bar."
                    : loginState.message}
                </p>
                {loginState.phase === "auth" && (
                  <a className={styles.externalLink} href={loginState.url} target="_blank" rel="noopener noreferrer">
                    Open the login page again
                  </a>
                )}
                <Field label={loginState.phase === "auth" ? "Redirect URL" : "Verification value"}>
                  <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void submitCode(loginState.token, inputValue); }}
                    placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? "Enter value…")}
                    mono
                  />
                </Field>
                <div className={styles.inlineActions}>
                  <Button variant="primary" disabled={!inputValue.trim()} onClick={() => void submitCode(loginState.token, inputValue)}>Submit</Button>
                </div>
              </div>
            )}

            {loginState.phase === "device_code" && (
              <div className={styles.authStep}>
                <p className={styles.authCopy}>Open the verification page and enter this code:</p>
                <code className={styles.deviceCode}>{loginState.userCode}</code>
                <a className={styles.externalLink} href={loginState.verificationUri} target="_blank" rel="noopener noreferrer">
                  {loginState.verificationUri}
                </a>
                {loginState.expiresInSeconds && (
                  <p className={styles.helperCopy}>Expires in {Math.ceil(loginState.expiresInSeconds / 60)} minutes.</p>
                )}
              </div>
            )}

            <div className={styles.inlineActions}>
              {isWorking ? (
                <Button variant="secondary" onClick={cancelLogin}>Cancel sign-in</Button>
              ) : (
                <>
                  <Button variant="primary" onClick={handleLogin}>{provider.loggedIn ? "Re-authenticate" : "Sign in"}</Button>
                  {provider.loggedIn && <Button variant="danger" onClick={() => setDisconnectOpen(true)}>Disconnect</Button>}
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={`Disconnect ${provider.name}?`}
        description="Models using this subscription will stop working until you sign in again."
        variant="sheet"
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDisconnectOpen(false)}>Keep connected</Button>
            <Button variant="danger" loading={loggingOut} onClick={() => void handleLogout()}>Disconnect</Button>
          </>
        )}
      >
        <Notice tone="warning" title="Authentication will be removed">The provider configuration itself is not deleted.</Notice>
      </Dialog>
    </>
  );
}

export function ApiKeyEditor({
  provider,
  onRefresh,
  onTransientDirtyChange,
}: {
  provider: ApiKeyProvider;
  onRefresh: () => void;
  onTransientDirtyChange: (dirty: boolean) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);


  useEffect(() => {
    onTransientDirtyChange(Boolean(apiKey.trim()) || saving || removing || removeOpen);
  }, [apiKey, onTransientDirtyChange, removeOpen, removing, saving]);

  useEffect(() => () => onTransientDirtyChange(false), [onTransientDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setApiKey("");
      setSaved(true);
      onRefresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [apiKey, onRefresh, provider.id, saving]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setRemoveOpen(false);
      setSaved(false);
      onRefresh();
    } catch (removeError) {
      setRemoveOpen(false);
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setRemoving(false);
    }
  }, [onRefresh, provider.id]);

  return (
    <>
      <div className={styles.editorStack}>
        <div className={styles.editorHeading}>
          <div>
            <Badge tone={provider.configured ? "success" : "neutral"}>{provider.configured ? "Configured" : "Not configured"}</Badge>
            <h2 className={styles.editorTitle}>{provider.displayName}</h2>
            <p className={styles.editorDescription}>
              {provider.configured
                ? "Replace or remove the API key stored by pi."
                : `Add a key to enable ${provider.modelCount} model${provider.modelCount === 1 ? "" : "s"}.`}
            </p>
          </div>
        </div>

        <section className={styles.formSection}>
          <div className={styles.formSectionHeader}>
            <div>
              <h3 className={styles.formSectionTitle}>API key</h3>
              <p className={styles.formSectionDescription}>The raw value is never returned by the status API.</p>
            </div>
          </div>
          <div className={styles.formSectionBody}>
            {saved && <Notice tone="success" title="API key saved">The provider is ready for model requests.</Notice>}
            {error && <Notice tone="danger" title="API key was not updated">{error}</Notice>}
            <Field label={provider.configured ? "Replacement API key" : "API key"}>
              <SecretInput
                value={apiKey}
                onChange={(value) => { setApiKey(value); setSaved(false); setError(null); }}
                onKeyDown={(event) => { if (event.key === "Enter" && apiKey.trim()) void handleSave(); }}
                placeholder={provider.configured ? "Enter a new key…" : "sk-…"}
                disabled={saving}
              />
            </Field>
            <div className={styles.inlineActions}>
              <Button variant="primary" loading={saving} disabled={!apiKey.trim()} onClick={() => void handleSave()}>Save key</Button>
              {provider.configured && (
                <Button variant="danger" onClick={() => setRemoveOpen(true)}>Disconnect API key</Button>
              )}
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${provider.displayName} API key?`}
        description="Models using this provider will stop working until another key source is configured."
        variant="sheet"
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setRemoveOpen(false)}>Keep key</Button>
            <Button variant="danger" loading={removing} onClick={() => void handleRemove()}>Remove key</Button>
          </>
        )}
      >
        <Notice tone="warning" title="Stored authentication will be deleted">This does not remove built-in model metadata.</Notice>
      </Dialog>
    </>
  );
}
