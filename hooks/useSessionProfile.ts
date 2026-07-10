"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProfileDefinition, ProfileRef } from "@/lib/profiles";
import type { CapabilitySnapshotV1, ProfileDiagnostic, SessionProfileResponse, ToolConflict } from "@/lib/session-profile-store";
import {
  REQUIRED_PROFILE_SWITCH_RUNNING_MESSAGE,
  profileDisplayName,
  readValidatedLastUsedProfileRef,
  summarizeProfileIssues,
  writeLastUsedProfileRef,
} from "@/lib/profile-ui-core";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string; diagnostics?: ProfileDiagnostic[] };
  if (!response.ok) {
    const error = new Error(body.error ?? `HTTP ${response.status}`) as Error & { status?: number; diagnostics?: ProfileDiagnostic[] };
    error.status = response.status;
    error.diagnostics = body.diagnostics;
    throw error;
  }
  return body;
}

export interface UseSessionProfileOptions {
  sessionId?: string | null;
  isNew: boolean;
  profiles: ProfileDefinition[];
  globalDefaultProfileRef?: ProfileRef | null;
  onAfterSwitch?: (sessionId: string) => Promise<void> | void;
}

export function useSessionProfile(options: UseSessionProfileOptions) {
  const { sessionId, isNew, profiles, globalDefaultProfileRef, onAfterSwitch } = options;
  const [explicitNewSessionProfileRef, setExplicitNewSessionProfileRef] = useState<ProfileRef | null>(null);
  const [response, setResponse] = useState<SessionProfileResponse | null>(null);
  const [createdSnapshot, setCreatedSnapshot] = useState<CapabilitySnapshotV1 | null>(null);
  const [materializedSessionId, setMaterializedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDiagnostics, setErrorDiagnostics] = useState<ProfileDiagnostic[]>([]);
  const requestEpochRef = useRef(0);

  useEffect(() => {
    if (!isNew || materializedSessionId || profiles.length === 0) return;
    const lastUsed = readValidatedLastUsedProfileRef(profiles);
    setExplicitNewSessionProfileRef(lastUsed);
  }, [isNew, materializedSessionId, profiles]);

  const targetSessionId = sessionId ?? materializedSessionId;

  const load = useCallback(async () => {
    const requestEpoch = ++requestEpochRef.current;
    if (!targetSessionId) {
      setResponse(null);
      return null;
    }
    setLoading(true);
    setError(null);
    setErrorDiagnostics([]);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}/profile`, { cache: "no-store" });
      const body = await readJson<SessionProfileResponse>(res);
      if (requestEpoch === requestEpochRef.current) {
        setResponse(body);
        if (body.state === "snapshot" && isNew) setCreatedSnapshot(body.snapshot);
      }
      return body;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (requestEpoch === requestEpochRef.current) {
        setError(message);
        setErrorDiagnostics((err as { diagnostics?: ProfileDiagnostic[] }).diagnostics ?? []);
      }
      throw err;
    } finally {
      if (requestEpoch === requestEpochRef.current) setLoading(false);
    }
  }, [isNew, targetSessionId]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);

  const selectNewSessionProfile = useCallback((profileRef: ProfileRef | null) => {
    setExplicitNewSessionProfileRef(profileRef);
    writeLastUsedProfileRef(profileRef);
    setCreatedSnapshot(null);
  }, []);

  const acceptCreatedSnapshot = useCallback((snapshot: CapabilitySnapshotV1, createdSessionId: string) => {
    setMaterializedSessionId(createdSessionId);
    setCreatedSnapshot(snapshot);
    setResponse({ state: "snapshot", snapshot, record: { sessionId: createdSessionId, updatedAt: snapshot.createdAt, recordRevision: 1 } });
  }, []);

  const applyProfile = useCallback(async (profileRef: ProfileRef) => {
    if (isNew && !materializedSessionId) {
      selectNewSessionProfile(profileRef);
      return null;
    }
    if (!targetSessionId) throw new Error("No active session is available for profile switching.");
    const previous = response;
    requestEpochRef.current += 1;
    setApplying(true);
    setError(null);
    setErrorDiagnostics([]);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileRef }),
      });
      const body = await readJson<SessionProfileResponse>(res);
      await onAfterSwitch?.(targetSessionId);
      const confirmed = await load().catch(() => body);
      const result = confirmed ?? body;
      setResponse(result);
      if (isNew && result.state === "snapshot") {
        setCreatedSnapshot(result.snapshot);
        setExplicitNewSessionProfileRef(result.snapshot.profileRef);
        writeLastUsedProfileRef(result.snapshot.profileRef);
      }
      return result;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = status === 409 ? REQUIRED_PROFILE_SWITCH_RUNNING_MESSAGE : err instanceof Error ? err.message : String(err);
      setError(message);
      setErrorDiagnostics((err as { diagnostics?: ProfileDiagnostic[] }).diagnostics ?? []);
      if (previous) setResponse(previous);
      throw new Error(message);
    } finally {
      setApplying(false);
    }
  }, [isNew, load, materializedSessionId, onAfterSwitch, response, selectNewSessionProfile, targetSessionId]);

  const clearExplicitNewSessionProfile = useCallback(() => selectNewSessionProfile(null), [selectNewSessionProfile]);

  const effectiveSnapshot = useMemo(() => {
    if (createdSnapshot) return createdSnapshot;
    return response?.state === "snapshot" ? response.snapshot : null;
  }, [createdSnapshot, response]);
  const legacyLabel = response?.state === "legacy" ? response.label : null;
  const issues = useMemo(() => summarizeProfileIssues(effectiveSnapshot), [effectiveSnapshot]);
  const diagnostics = useMemo(() => [...issues.diagnostics, ...errorDiagnostics], [errorDiagnostics, issues.diagnostics]);
  const displayName = useMemo(() => profileDisplayName({
    profileRef: explicitNewSessionProfileRef,
    profiles,
    globalDefaultProfileRef,
    snapshot: effectiveSnapshot,
    legacyLabel,
    newSession: isNew,
  }), [effectiveSnapshot, explicitNewSessionProfileRef, globalDefaultProfileRef, isNew, legacyLabel, profiles]);

  return {
    explicitNewSessionProfileRef,
    materializedSessionId,
    selectedProfileRef: isNew && !materializedSessionId ? explicitNewSessionProfileRef : effectiveSnapshot?.profileRef ?? null,
    effectiveSnapshot,
    legacyLabel,
    response,
    displayName,
    diagnostics,
    conflicts: issues.conflicts,
    issueSummary: issues,
    loading,
    applying,
    error,
    selectNewSessionProfile,
    clearExplicitNewSessionProfile,
    acceptCreatedSnapshot,
    applyProfile,
    load,
  } satisfies {
    explicitNewSessionProfileRef: ProfileRef | null;
    materializedSessionId: string | null;
    selectedProfileRef: ProfileRef | null;
    effectiveSnapshot: CapabilitySnapshotV1 | null;
    legacyLabel: string | null;
    response: SessionProfileResponse | null;
    displayName: string;
    diagnostics: ProfileDiagnostic[];
    conflicts: ToolConflict[];
    issueSummary: ReturnType<typeof summarizeProfileIssues>;
    loading: boolean;
    applying: boolean;
    error: string | null;
    selectNewSessionProfile: (profileRef: ProfileRef | null) => void;
    clearExplicitNewSessionProfile: () => void;
    acceptCreatedSnapshot: (snapshot: CapabilitySnapshotV1, sessionId: string) => void;
    applyProfile: (profileRef: ProfileRef) => Promise<SessionProfileResponse | null>;
    load: () => Promise<SessionProfileResponse | null>;
  };
}

export type UseSessionProfileState = ReturnType<typeof useSessionProfile>;
