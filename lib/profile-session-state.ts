export const PROFILE_STATE_CUSTOM_TYPE = "pi-web-profile-state";

type ProfileStateEntryShape = {
  type?: unknown;
  customType?: unknown;
  parentId?: string | null;
  data?: unknown;
};

type SessionEntryLookup = {
  getEntry(id: string): ProfileStateEntryShape | null | undefined;
};

export function isProfileStateEntry(entry: ProfileStateEntryShape | null | undefined): entry is ProfileStateEntryShape & { type: "custom"; customType: typeof PROFILE_STATE_CUSTOM_TYPE } {
  return entry?.type === "custom" && entry.customType === PROFILE_STATE_CUSTOM_TYPE;
}

export function stripProfileStateNodes<T extends { entry: ProfileStateEntryShape; children: T[] }>(nodes: T[]): T[] {
  const result: T[] = [];
  const stack = [...nodes].reverse().map((node) => ({ node, target: result }));
  while (stack.length > 0) {
    const { node, target } = stack.pop()!;
    if (isProfileStateEntry(node.entry)) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], target });
      continue;
    }
    const clone = { ...node, children: [] } as T;
    target.push(clone);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], target: clone.children });
  }
  return result;
}

export function visibleProfileLeafId(sm: SessionEntryLookup, leafId: string | null): string | null {
  let current = leafId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const entry = sm.getEntry(current);
    if (!isProfileStateEntry(entry)) return current;
    current = entry.parentId ?? null;
  }
  return current;
}
