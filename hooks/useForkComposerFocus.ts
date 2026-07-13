"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";

export interface ForkComposerHandle {
  focus: () => void;
  insertIfEmpty: (text: string) => void;
}

interface PendingForkFocus {
  sessionId: string;
  selectedText?: string;
}

export function useForkComposerFocus(
  composerRef: RefObject<ForkComposerHandle | null>,
  activeSessionId: string | null,
): (sessionId: string, selectedText?: string) => void {
  const pendingRef = useRef<PendingForkFocus | null>(null);

  const queueFocus = useCallback((sessionId: string, selectedText?: string) => {
    pendingRef.current = { sessionId, selectedText };
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    const composer = composerRef.current;
    if (!pending || pending.sessionId !== activeSessionId || !composer) return;

    if (pending.selectedText) composer.insertIfEmpty(pending.selectedText);
    composer.focus();
    pendingRef.current = null;
  }, [activeSessionId, composerRef]);

  return queueFocus;
}
