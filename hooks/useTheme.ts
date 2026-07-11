"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

const THEME_STORAGE_KEY = "pi-theme";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const THEME_CHANGE_EVENT = "pi-theme-change";
const listeners = new Set<() => void>();
let detachExternalListeners: (() => void) | null = null;

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

function resolvedTheme(): Theme {
  return readStoredTheme() ?? systemTheme();
}

function applyDocumentTheme(theme: Theme): boolean {
  if (typeof document === "undefined") return false;
  const current = document.documentElement.classList.contains("dark") ? "dark" : "light";
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  document.documentElement.dataset.theme = theme;
  return current !== theme;
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore unavailable storage (private mode, denied access, or quota errors).
  }
}

function clearStoredTheme(): void {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

function syncResolvedTheme(): void {
  applyDocumentTheme(resolvedTheme());
  notify();
}

function attachExternalThemeListeners(): () => void {
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  const handleMediaChange = () => {
    if (readStoredTheme() === null) syncResolvedTheme();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) syncResolvedTheme();
  };
  const handleThemeChange = (event: Event) => {
    const requested = (event as CustomEvent<unknown>).detail;
    if (requested === "light" || requested === "dark") {
      applyDocumentTheme(requested);
    } else {
      applyDocumentTheme(resolvedTheme());
    }
    notify();
  };

  media.addEventListener("change", handleMediaChange);
  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);

  return () => {
    media.removeEventListener("change", handleMediaChange);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined" && !detachExternalListeners) {
    detachExternalListeners = attachExternalThemeListeners();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detachExternalListeners) {
      detachExternalListeners();
      detachExternalListeners = null;
    }
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function getPreferenceSnapshot(): ThemePreference {
  return readStoredTheme() ?? "system";
}

function getPreferenceServerSnapshot(): ThemePreference {
  return "system";
}

function runThemeTransition(update: () => void): void {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition !== "function" || reduceMotion) {
    update();
    return;
  }
  try {
    document.startViewTransition(update).finished.catch(() => {});
  } catch {
    update();
  }
}

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const preference = useSyncExternalStore(subscribe, getPreferenceSnapshot, getPreferenceServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    runThemeTransition(() => {
      persistTheme(next);
      applyDocumentTheme(next);
      notify();
    });
  }, []);

  const useSystemTheme = useCallback(() => {
    runThemeTransition(() => {
      clearStoredTheme();
      applyDocumentTheme(systemTheme());
      notify();
    });
  }, []);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    void origin;
    setTheme(getSnapshot() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return {
    theme,
    preference,
    isDark: theme === "dark",
    setTheme,
    toggleTheme,
    useSystemTheme,
  };
}
