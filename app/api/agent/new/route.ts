import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, statSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { expandAgentProfileForNewSession, normalizeAgentProfileRef, resolveAgentProfile, validateAgentProfilesCwd, type AgentProfileSessionOptions } from "@/lib/agent-profiles";
import { startRpcSession } from "@/lib/rpc-manager";
import { getToolNamesForPreset } from "@/lib/tool-presets";

function sameToolSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const expected = new Set(b);
  return a.every((name) => expected.has(name));
}

function legacyProfileMetadata(toolNames: string[]): { profileRef: AgentProfileSessionOptions["profileRef"]; profileName: string } {
  if (toolNames.length === 0) return { profileRef: "builtin:no-tools", profileName: "Legacy no-tools" };
  if (sameToolSet(toolNames, getToolNamesForPreset("default"))) {
    return { profileRef: "builtin:default", profileName: "Legacy default" };
  }
  return { profileRef: "builtin:full", profileName: "Legacy full" };
}

// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }
    const realCwd = realpathSync.native(cwd);
    if (!statSync(realCwd).isDirectory()) {
      return NextResponse.json({ error: `Path is not a directory: ${realCwd}` }, { status: 400 });
    }

    // Creating a new session intentionally grants file access to its cwd; use
    // the real path for profile resolution and all subsequent session state.
    allowFileRoot(realCwd);
    const safeCwd = await validateAgentProfilesCwd(realCwd);

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const {
      provider: requestProvider,
      modelId: requestModelId,
      toolNames: requestToolNames,
      thinkingLevel: requestThinkingLevel,
      profileRef: rawProfileRef,
      includeExtensionTools: requestIncludeExtensionTools,
      ...promptCommand
    } = command as {
      provider?: string;
      modelId?: string;
      toolNames?: string[];
      thinkingLevel?: string;
      profileRef?: unknown;
      includeExtensionTools?: boolean;
      [key: string]: unknown;
    };

    const profileRef = rawProfileRef === undefined ? undefined : normalizeAgentProfileRef(rawProfileRef);
    if (rawProfileRef !== undefined && !profileRef) {
      return NextResponse.json({ error: "profileRef must be a valid profile reference" }, { status: 400 });
    }
    const hasRequestToolNames = Array.isArray(requestToolNames);
    const useLegacyToolRequest = rawProfileRef === undefined && hasRequestToolNames;
    const resolvedProfileOptions = useLegacyToolRequest
      ? undefined
      : expandAgentProfileForNewSession(safeCwd, resolveAgentProfile(safeCwd, profileRef));
    const legacyIncludeExtensionTools = useLegacyToolRequest
      ? typeof requestIncludeExtensionTools === "boolean"
        ? requestIncludeExtensionTools
        : requestToolNames.length > 0
      : undefined;
    const legacyProfile = useLegacyToolRequest ? legacyProfileMetadata(requestToolNames) : undefined;
    const legacyProfileOptions: AgentProfileSessionOptions | undefined = useLegacyToolRequest && legacyProfile ? {
      profileRef: legacyProfile.profileRef,
      profileName: legacyProfile.profileName,
      toolNames: requestToolNames,
      includeExtensionTools: Boolean(legacyIncludeExtensionTools),
      extensionToolMode: legacyIncludeExtensionTools ? "all" : "none",
      instructions: { mode: "default", files: [] },
      resources: { skillPaths: [], promptPaths: [], themePaths: [] },
    } : undefined;
    const profileOptions = legacyProfileOptions ?? resolvedProfileOptions;

    const hasRequestModelOverride = typeof requestProvider === "string" && typeof requestModelId === "string";
    const profileProvider = hasRequestModelOverride ? undefined : profileOptions?.provider;
    const profileModelId = hasRequestModelOverride ? undefined : profileOptions?.modelId;
    const toolNames = useLegacyToolRequest ? requestToolNames : profileOptions?.toolNames;
    const includeExtensionTools = useLegacyToolRequest ? legacyIncludeExtensionTools : profileOptions?.includeExtensionTools;
    const requestedThinkingLevel = typeof requestThinkingLevel === "string" ? requestThinkingLevel : undefined;
    const hasRequestThinkingOverride = requestedThinkingLevel !== undefined;
    const shouldApplyRequestThinkingLevel = requestedThinkingLevel !== undefined && requestedThinkingLevel !== "auto";
    const thinkingLevel = shouldApplyRequestThinkingLevel ? requestedThinkingLevel : profileOptions?.thinkingLevel;
    const launchProfileOptions: AgentProfileSessionOptions | undefined = profileOptions ? (() => {
      const profileBase: AgentProfileSessionOptions = { ...profileOptions };
      delete profileBase.provider;
      delete profileBase.modelId;
      delete profileBase.thinkingLevel;
      return {
        ...profileBase,
        toolNames: toolNames ?? profileOptions.toolNames,
        includeExtensionTools: includeExtensionTools ?? profileOptions.includeExtensionTools,
        extensionToolMode: (includeExtensionTools ?? profileOptions.includeExtensionTools) ? profileOptions.extensionToolMode : "none",
        ...(profileProvider && profileModelId ? { provider: profileProvider, modelId: profileModelId } : {}),
        ...(thinkingLevel && !hasRequestThinkingOverride ? { thinkingLevel: thinkingLevel as AgentProfileSessionOptions["thinkingLevel"] } : { thinkingLevel: undefined }),
      };
    })() : undefined;

    const tempKey = `__new__${randomUUID()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", safeCwd, toolNames, {
      includeExtensionTools,
      profile: launchProfileOptions,
      profileToolPolicySnapshot: useLegacyToolRequest,
      profileModelOverride: hasRequestModelOverride,
      profileThinkingOverride: hasRequestThinkingOverride,
    });

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    allowFileRoot(safeCwd);

    // Explicit new-session model selections keep the existing set_model behavior,
    // including normal session/default persistence. Profile-provided models were
    // already applied by startRpcSession without mutating global defaults.
    if (hasRequestModelOverride) {
      await session.send({ type: "set_model", provider: requestProvider, modelId: requestModelId });
    }

    // Explicit new-session thinking selections keep the existing persisted setting
    // behavior. Profile-provided thinking was already applied by startRpcSession.
    if (shouldApplyRequestThinkingLevel) {
      await session.send({ type: "set_thinking_level", level: requestedThinkingLevel });
    }

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({ success: true, sessionId: realSessionId, data: null });
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 500;
    return NextResponse.json({ error: message }, { status: Number.isFinite(statusCode) ? statusCode : 500 });
  }
}
