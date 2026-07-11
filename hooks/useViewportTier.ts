"use client";

import { useSyncExternalStore } from "react";

export const PHONE_MAX_WIDTH = 640;
export const COMPACT_MAX_WIDTH = 1024;

export type ViewportTier = "phone" | "compact" | "desktop";

const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const phone = window.matchMedia(PHONE_QUERY);
  const compact = window.matchMedia(COMPACT_QUERY);
  phone.addEventListener("change", listener);
  compact.addEventListener("change", listener);
  return () => {
    phone.removeEventListener("change", listener);
    compact.removeEventListener("change", listener);
  };
}

function getSnapshot(): ViewportTier {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  if (window.matchMedia(PHONE_QUERY).matches) return "phone";
  if (window.matchMedia(COMPACT_QUERY).matches) return "compact";
  return "desktop";
}

function getServerSnapshot(): ViewportTier {
  return "desktop";
}

export function useViewportTier(): ViewportTier {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
