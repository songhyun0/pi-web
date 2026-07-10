"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProfileDefinition, ProfileRef, ProfilesFileV1 } from "@/lib/profiles";
import type { ProfilePreviewRequest, ProfilePreviewResult } from "@/lib/profile-preview";

type ProfileListResponse = {
  version: 1;
  defaults: ProfilesFileV1["defaults"];
  profiles: ProfileDefinition[];
  builtinProfiles: ProfileDefinition[];
  warnings: string[];
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function useProfiles(refreshKey = 0) {
  const [profiles, setProfiles] = useState<ProfileDefinition[]>([]);
  const [builtinProfiles, setBuiltinProfiles] = useState<ProfileDefinition[]>([]);
  const [globalDefaultProfileRef, setGlobalDefaultProfileRef] = useState<ProfileRef | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestEpochRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestEpoch = ++requestEpochRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/profiles", { cache: "no-store" });
      const body = await readJson<ProfileListResponse>(response);
      if (requestEpoch !== requestEpochRef.current) return body;
      setProfiles(body.profiles ?? []);
      setBuiltinProfiles(body.builtinProfiles ?? []);
      setGlobalDefaultProfileRef(body.defaults.globalProfileRef);
      if (body.warnings?.length) setWarnings((current) => [...new Set([...current, ...body.warnings])]);
      return body;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (requestEpoch === requestEpochRef.current) setError(message);
      throw err;
    } finally {
      if (requestEpoch === requestEpochRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshKey;
    void refresh().catch(() => undefined);
  }, [refresh, refreshKey]);

  const allProfiles = useMemo(() => [...builtinProfiles, ...profiles], [builtinProfiles, profiles]);
  const getProfile = useCallback((profileRef: ProfileRef | null | undefined) => (
    profileRef ? allProfiles.find((profile) => profile.id === profileRef) ?? null : null
  ), [allProfiles]);

  const createProfile = useCallback(async (draft: unknown) => {
    requestEpochRef.current += 1;
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const created = await readJson<ProfileDefinition & { warnings?: string[] }>(response);
    if (created.warnings?.length) setWarnings((current) => [...new Set([...current, ...created.warnings!])]);
    await refresh();
    const { warnings: _warnings, ...profile } = created;
    return profile as ProfileDefinition;
  }, [refresh]);

  const updateProfile = useCallback(async (profileRef: ProfileRef, patch: unknown) => {
    requestEpochRef.current += 1;
    const response = await fetch(`/api/profiles/${encodeURIComponent(profileRef)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = await readJson<ProfileDefinition & { warnings?: string[] }>(response);
    if (updated.warnings?.length) setWarnings((current) => [...new Set([...current, ...updated.warnings!])]);
    await refresh();
    const { warnings: _warnings, ...profile } = updated;
    return profile as ProfileDefinition;
  }, [refresh]);

  const deleteProfile = useCallback(async (profileRef: ProfileRef, replacementGlobalProfileRef?: ProfileRef) => {
    requestEpochRef.current += 1;
    const response = await fetch(`/api/profiles/${encodeURIComponent(profileRef)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replacementGlobalProfileRef ? { replacementGlobalProfileRef } : {}),
    });
    const body = await readJson<ProfileListResponse>(response);
    setProfiles(body.profiles ?? []);
    setBuiltinProfiles(body.builtinProfiles ?? []);
    setGlobalDefaultProfileRef(body.defaults.globalProfileRef);
    if (body.warnings?.length) setWarnings((current) => [...new Set([...current, ...body.warnings])]);
    return body;
  }, []);

  const setGlobalDefaultProfile = useCallback(async (profileRef: ProfileRef) => {
    requestEpochRef.current += 1;
    const response = await fetch("/api/profiles/default", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ globalProfileRef: profileRef }),
    });
    const body = await readJson<ProfileListResponse>(response);
    setProfiles(body.profiles ?? []);
    setBuiltinProfiles(body.builtinProfiles ?? []);
    setGlobalDefaultProfileRef(body.defaults.globalProfileRef);
    if (body.warnings?.length) setWarnings((current) => [...new Set([...current, ...body.warnings])]);
    return body;
  }, []);

  const previewProfile = useCallback(async (request: ProfilePreviewRequest) => {
    const response = await fetch("/api/profiles/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return readJson<ProfilePreviewResult>(response);
  }, []);

  return {
    profiles,
    builtinProfiles,
    allProfiles,
    globalDefaultProfileRef,
    warnings,
    loading,
    error,
    refresh,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    setGlobalDefaultProfile,
    previewProfile,
  };
}

export type UseProfilesState = ReturnType<typeof useProfiles>;
