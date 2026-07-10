# Session Capability Profiles Design

Status: design draft
Scope: pi-web session-scoped profiles for tools, plugins/packages, and skills

## 1. Goal

Add pi-web profiles that switch a session's execution capabilities as one coherent snapshot:

- built-in tool preset and selected active tools
- selected Pi plugin/package set
- skill visibility/narrowing for the selected plugin set

A profile is not a theme, prompt-template, or general settings bundle. It is a capability snapshot used to create or reload an agent session.

## 2. Non-goals

- Do not reintroduce the rolled-back prompt/theme/resource-bundle profile model.
- Do not mutate `~/.pi/agent/settings.json` when selecting a session profile.
- Do not implement profiles as a plugin-only feature; package selection must happen before package/resource loading.
- Do not maintain a long-term fork of `@earendil-works/pi-coding-agent` unless the pi-web overlay approach proves impossible.
- Do not add project-specific default profile behavior in v1. The schema should leave room for it later.

## 3. Key decisions

- v1 has one global default profile.
- The data model should be flexible enough to add project default overrides later.
- Profile plugin sets are stored with Pi's existing `PackageSource` shape:
  - string source, e.g. `"npm:pi-web-access"`
  - object source, e.g. `{ "source": "npm:pkg", "skills": ["+skills/foo/SKILL.md"], "prompts": [], "themes": [] }`
- Plugin behavior is "plugin default, then narrow": enabling a plugin loads its default resources first; the skill step narrows skill visibility/resources afterward.
- Selected plugin tools may override built-in tools. The UI must make override/provenance visible.
- New sessions apply the selected profile immediately.
- Existing sessions can switch profile only when idle. Running-session switches are rejected with `409 Conflict`; users retry after current work finishes.

## 4. Terminology

### Profile definition

Editable saved configuration, e.g. "Coding Full" or "StyleSeed Review".

### Profile ref

Stable identifier used by UI/API. User profile IDs are stored as the full ref string, not a separate raw UUID.

- `profile:<uuid>` for user profiles
- `builtin:<name>` for generated/built-in options if needed

### Capability snapshot

Current effective session capability state derived from a profile definition at a point in time. A session should store this snapshot for future restores, not just the mutable profile ref.

### Effective profile

What the current session is actually using. For new unsaved sessions this may be a selected profile ref; after session creation it becomes a persisted capability snapshot.

## 5. Data model

### PackageSource

Use Pi's package filter shape as-is:

```ts
type PackageSource =
  | string
  | {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };
```

Important PackageSource semantics from Pi:

- omitted resource key means load all resources of that type
- `[]` means load none of that resource type
- filter entries narrow package manifest resources
- `+path` force-includes an exact package-relative path
- `-path` force-excludes an exact package-relative path
- `!pattern` excludes matches

V1 profiles are not prompt/theme bundles. Profile definitions may accept string package sources for authoring convenience, but the effective PackageSource passed to Pi must normalize selected packages to object form with `prompts: []` and `themes: []` unless a future design explicitly includes those resource kinds.

### Profiles file

Store pi-web profile definitions outside Pi's global `settings.json`, for example:

```ts
interface ProfilesFileV1 {
  version: 1;
  defaults: {
    globalProfileRef: ProfileRef;
  };
  profiles: ProfileDefinition[];
}
```

Recommended path:

```txt
~/.pi/agent/web-profiles.json
```

Rationale:

- `settings.json` remains owned by Pi core/global settings.
- pi-web can evolve profile schema independently.
- Future project defaults should be added in a later schema version; v1 reads and writes only `globalProfileRef`.

### Profile definition

```ts
type ToolPreset = "none" | "default" | "full";

type ProfileRef = `profile:${string}` | `builtin:${string}`;

interface ProfileDefinition {
  id: ProfileRef; // full "profile:<uuid>" value for user profiles
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;

  tools: {
    builtinPreset: ToolPreset;
    // v1 default: selected plugin extensions may register tools.
    // Keep this explicit so a future UI can add plugin-tool narrowing.
    pluginTools: "fromSelectedPlugins";
  };

  plugins: PackageSource[];

  skills: {
    // v1 UX: plugin default, then narrow.
    // Package-scoped skill narrowing should be encoded into PackageSource.skills
    // whenever possible. This field records UI intent and handles any final
    // post-load allowlist/exclusion needed for local or ambiguous skills.
    mode: "pluginDefaultThenNarrow";
    disabledSkillRefs?: SkillRef[];
  };
}

interface SkillRef {
  source: string;
  scope?: "user" | "project" | "package" | "temporary" | string;
  path: string;
  name?: string;
}
```

Notes:

- `plugins` is the complete selected plugin/package set for the profile. Do not implicitly append all globally installed packages.
- Global/project package settings are a catalog and installation source, not automatically active in a profile unless represented in `plugins`.
- Initial migration should create a default profile from current global-scope package settings to preserve existing global behavior without promoting project packages.

### Capability snapshot

```ts
interface CapabilitySnapshotV1 {
  version: 1;
  snapshotId: string;
  createdAt: string;

  profileRef: ProfileRef;
  profileName: string;

  cwd: string;
  projectRoot?: string;

  tools: {
    builtinPreset: ToolPreset;
    requestedBuiltinTools: string[];
    activeToolNames: string[];
    conflicts: ToolConflict[];
  };

  plugins: PackageSource[];

  skills: {
    mode: "pluginDefaultThenNarrow";
    visibleSkillRefs: SkillRef[];
    hiddenSkillRefs: SkillRef[];
  };

  diagnostics: ProfileDiagnostic[];
}

interface ToolConflict {
  name: string;
  builtinSelected: boolean;
  selectedProvider: "builtin" | "plugin";
  pluginSource?: string;
  message: string;
}

interface ProfileDiagnostic {
  type: "info" | "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}
```

In v1, `plugins` is the immutable selected `PackageSource` spec/filter set for the session. Package artifacts are resolved at service creation time and are not version-locked by this snapshot.

Persist snapshots separately from profile definitions, keyed by session id and/or session file path:

```txt
~/.pi/agent/web-session-profiles.json
```

A session should show and restore its current effective saved snapshot even if the profile definition changes later. On an idle profile switch, v1 replaces that current effective snapshot; it does not keep per-turn historical profile epochs.

## 6. Server architecture

### 6.1 Source of truth

Server-side files are the source of truth for:

- saved profile definitions
- global default profile ref
- session capability snapshots

Client localStorage may only cache the last selected profile ref for new sessions as a convenience. It must not be authoritative.

### 6.2 APIs

Recommended endpoints:

```txt
GET    /api/profiles
POST   /api/profiles
PATCH  /api/profiles/:id
DELETE /api/profiles/:id
POST   /api/profiles/preview
GET    /api/sessions/:id/profile
POST   /api/sessions/:id/profile
```

`GET /api/profiles` returns profile definitions, built-in/generated entries, and the global default.

`POST /api/profiles/preview` accepts either a saved `profileRef` or an unsaved draft profile and returns an effective capability preview for the current `cwd`.

`POST /api/sessions/:id/profile` applies a profile to an existing idle session. It must return `409` if the session is running.

### 6.3 New session creation

Change `/api/agent/new` to accept profile input:

```json
{
  "cwd": "/repo",
  "type": "ensure_session",
  "profileRef": "profile:abc"
}
```

Server flow:

1. resolve `profileRef`; if omitted, use the global default fallback, and if explicitly invalid, return an error
2. build a capability snapshot for `cwd`
3. create profile-scoped services/runtime without exposing it as the active session
4. atomically persist the snapshot under the real session id
5. expose/register the runtime and return `{ sessionId, profileSnapshot }`
6. if persistence or exposure fails, destroy the new runtime and return an error

`toolNames` should become an implementation detail derived from the profile snapshot, not the primary client contract.

### 6.4 Existing session restore

When `/api/agent/[id]` starts an RPC session for an existing session:

1. load the saved capability snapshot for `id`
2. if missing, use a legacy/global fallback snapshot for compatibility
3. create services using that snapshot
4. expose the effective profile/snapshot in `get_state` or a dedicated profile endpoint

### 6.5 Existing session profile switch

For an idle existing session:

1. verify session exists
2. verify `AgentSessionWrapper.isRunning()` is false
3. resolve target profile and build new snapshot
4. create the new profile-scoped runtime or reload plan without replacing the current active wrapper yet
5. atomically persist the new snapshot and swap runtime state; if any step fails, keep the previous runtime/snapshot
6. remount/reconcile UI state

For a running session:

- return `409 Conflict`
- UI should show "Wait for the current response to finish before switching profiles."

## 7. Profile-scoped settings integration

The profile must affect package/resource loading before `createAgentSessionServices()` loads extensions and skills.

Current start point in `lib/rpc-manager.ts`:

```ts
const services = await createAgentSessionServices({ cwd, agentDir });
```

Target shape:

```ts
const settingsManager = createProfileScopedSettingsManager({
  cwd,
  agentDir,
  snapshot,
});

const services = await createAgentSessionServices({
  cwd,
  agentDir,
  settingsManager,
  resourceLoaderOptions: {
    skillsOverride: createProfileSkillsOverride(snapshot),
  },
});
```

### 7.1 Do not rely on temporary `applyOverrides()` only

`ResourceLoader.reload()` calls `settingsManager.reload()`. If profile settings are only transient overrides, reload can clear them. The profile-aware manager must reapply the snapshot every time settings are loaded/reloaded.

### 7.2 Profile-scoped settings manager behavior

The manager should:

- read global/project base settings normally for non-profile settings such as model, thinking, retry, compaction, npm command, auth-related config, etc.
- replace resource capability settings with the profile snapshot:
  - `packages = normalizeProfilePackages(snapshot.plugins)`, with v1 `prompts: []` and `themes: []` applied
  - local `extensions`/`skills` only when explicitly represented by the profile design
- keep project trust semantics intact
- never write profile overlay changes into Pi's `settings.json`
- preserve unknown settings keys when profile files are written

### 7.3 Resource filtering boundaries

Use the right mechanism for each boundary:

- Plugin/package selection: `PackageSource[]` in the profile-scoped settings manager.
- Plugin skill narrowing: encode into `PackageSource.skills` where possible.
- Final skill visibility cleanup: `resourceLoaderOptions.skillsOverride` if a loaded skill must be hidden after package resolution.
- Tool active set: apply after extensions register tools, using the profile tool policy.

Do not use post-load skill/tool filtering to pretend a plugin is disabled. Disabled plugins must be absent from the profile-scoped package set before resource loading.

## 8. Tool policy

### 8.1 Built-in tools

Use existing presets:

```ts
none    -> []
default -> ["read", "bash", "edit", "write"]
full    -> ["bash", "read", "edit", "write", "grep", "find", "ls"]
```

### 8.2 Plugin tools

In v1, selected plugin extensions may register tools. Those tools are active by default for the profile unless the plugin's `PackageSource` disables extensions.

If a selected plugin registers a tool with the same name as a selected built-in tool:

- the plugin implementation may override the built-in implementation
- the effective tools preview must mark the conflict
- the runtime should reflect the same conflict behavior shown in the UI

### 8.3 Enforcement points

Tool policy must be applied:

- immediately after creating the agent session
- after extension binding completes
- after reload
- after any late extension tool registration if the core exposes a hook; otherwise reapply after known extension binding/reload points and test for regressions

`get_tools` should return enough metadata for the UI to display:

- tool name
- active state
- built-in vs plugin provenance when known
- override/conflict marker

## 9. Skill policy

v1 UX:

1. user selects plugins
2. pi-web discovers the plugin default skills
3. user can turn individual skills off
4. pi-web stores the narrowed result using package filters where possible

Recommended encoding:

- no narrowing: keep the package source as a string or object with `skills` omitted
- some skills enabled: convert to object form and set `skills` to exact package-relative includes such as `+skills/foo/SKILL.md`
- all skills disabled for that plugin: set `skills: []`

Example:

```json
{
  "source": "npm:example-skills",
  "skills": ["+skills/review/SKILL.md", "+skills/audit/SKILL.md"]
}
```

If a skill cannot be represented cleanly as a package filter, persist a `disabledSkillRefs` entry and enforce it in `skillsOverride`.

For package skills, `PackageSource.skills` is the authoritative narrowing mechanism. `disabledSkillRefs` is a post-resolution denylist fallback for local, ambiguous, or otherwise unrepresentable skills. If both mention the same skill, hidden wins and preview should emit a diagnostic.

## 10. UI state management

### 10.1 Ownership

Keep existing pi-web state ownership patterns:

- `AppShell` owns selected session/project and modal open/close state only.
- `useAgentSession` owns active session runtime state.
- Add a profile-specific hook near `useAgentSession`, rather than adding global state management.
- `ChatInput` owns only dropdown open/close presentation state.
- Profile manager/wizard owns local draft state until save.

No Redux/Zustand-style global store is needed.

### 10.2 Hooks/components

Recommended additions:

```txt
hooks/useProfiles.ts
hooks/useSessionProfile.ts
components/ProfileSelector.tsx
components/ProfileManagerModal.tsx
components/ProfileWizard.tsx
```

`useProfiles`:

- loads profile definitions and defaults from `/api/profiles`
- saves profile CRUD changes
- exposes `globalDefaultProfileRef`

`useSessionProfile`:

- resolves initial profile for new sessions
- loads effective snapshot for existing sessions
- applies profile changes through server APIs
- exposes loading/applying/error/conflict state

`ProfileSelector`:

- appears near existing model/tool/thinking controls in `ChatInput`
- displays current profile name
- disables switching while `agentRunning` is true
- shows conflicts/diagnostics indicator if the effective snapshot has warnings

`ProfileManagerModal` / `ProfileWizard`:

- local reducer state for draft editing
- wizard order:
  1. profile creation
  2. base tool preset
  3. plugin on/off
  4. skill on/off narrowing
  5. effective preview

### 10.3 New session default behavior

When creating a new session:

1. initial server-side default = global default profile ref
2. the UI may show a validated last-used profile as an explicit visible selection, but if no explicit `profileRef` is sent the server uses the global default
3. once the session is created, server returns and persists the actual snapshot

The global default remains server-owned.

### 10.4 Future project defaults

v1 does not read or write project default profile refs. Keep the persisted schema limited to `globalProfileRef` so project key/trust semantics are not decided prematurely.

A later schema version can add project defaults with a defined key, likely using `projectRoot`. Future resolution order can become:

1. explicit new-session selection
2. project default for `projectRoot`
3. global default
4. built-in fallback

## 11. Frontend data flow

### New session

```txt
AppShell
  -> ChatWindow
    -> useAgentSession
      -> useSessionProfile selects default/current profile
      -> /api/agent/new { cwd, profileRef }
      <- { sessionId, profileSnapshot }
      -> ChatInput shows effective profile
```

### Existing session

```txt
AppShell selects session
  -> ChatWindow remounts via sessionKey
    -> useSessionProfile loads /api/sessions/:id/profile
    -> ChatInput shows saved snapshot/profile
```

### Switch existing idle session

```txt
ChatInput/ProfileSelector onChange
  -> useSessionProfile.applyProfile(profileRef)
  -> POST /api/sessions/:id/profile
  -> server rejects if running, otherwise recreates/reloads scoped runtime
  <- new snapshot
  -> ChatWindow refresh/remount if needed
```

## 12. Migration and compatibility

### Initial profile bootstrap

On first run after feature introduction:

1. read current global-scope package settings only
2. create a user-editable default profile, e.g. `Coding Full`
3. set `defaults.globalProfileRef` to that profile
4. use `full` built-in tool preset to match current pi-web fallback unless user has another saved default from prior UI state

This preserves current behavior while moving future profile switching into pi-web-owned profile files.

### Existing sessions without snapshots

For old sessions:

- show profile as `Legacy / current settings`
- restore using current global/project settings unless the user explicitly switches to a saved profile
- once switched, persist a normal snapshot

## 13. Error handling

Profile resolution should fail closed when it affects capabilities:

- missing selected profile: if no explicit ref was sent, fall back to global default with a warning; if an explicit ref is invalid, block and ask the user to choose another profile
- missing global default: use built-in safe fallback and show setup warning
- unresolved selected package: if its requested filters include extensions (and therefore possible tools) or skills, include a diagnostic and block apply/session creation; allow saving drafts but warn in preview
- running session switch: return `409`, no partial state mutation
- snapshot persistence failure: block session creation/apply and do not leave a live returned session with capabilities that differ from the saved snapshot

## 14. Validation plan

Minimum tests before implementation is considered complete:

- profile file read/write preserves unknown keys and handles missing file/dir
- profile CRUD API validates names, refs, PackageSource shape, and default profile refs
- preview API resolves packages, skills, tool conflicts, and diagnostics without mutating global settings
- `/api/agent/new` creates sessions with selected profile packages and tools
- existing session restore uses persisted snapshot, not the latest mutable profile definition
- profile switch rejects running sessions
- profile switch applies to idle sessions and persists the new snapshot
- profile create/apply never exposes a live runtime whose capabilities differ from its saved snapshot
- resource reload preserves profile-scoped packages after `settingsManager.reload()`
- plugin tool override is visible in preview and runtime `get_tools`
- skill narrowing stores PackageSource filters correctly
- profile package normalization disables prompts/themes in v1
- legacy sessions without snapshots continue to load
- UI disables switching while running and shows server-side errors

Run existing project validation too:

```bash
./node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/*.test.mjs
git diff --check
git diff --cached --check
```

## 15. Suggested implementation phases

1. Profile schema/store/API with tests.
2. Preview resolver for profile definitions and draft profiles.
3. Session snapshot store and API surface.
4. Profile-scoped settings manager integration in `rpc-manager.ts`.
5. New-session profile application.
6. Existing-session idle profile switch/reload.
7. UI selector and profile manager wizard.
8. Conflict/diagnostic display and polish.
9. Migration/legacy behavior.
10. End-to-end validation and local deployment smoke test.

## 16. Primary design risk

The main risk is accidentally treating profiles as a UI-only filter. That would not isolate plugin package loading or extension side effects.

The required invariant is:

> A session's selected profile must determine the package/resource set before `createAgentSessionServices()` loads extensions, skills, prompts, and themes.

Everything else in the design follows from that invariant.
