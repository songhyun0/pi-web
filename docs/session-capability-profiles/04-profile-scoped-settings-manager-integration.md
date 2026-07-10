# Profile-scoped settings manager integration

## Purpose

Implement the profile-scoped settings overlay that makes a session capability snapshot determine resource capability loading before `createAgentSessionServices()` loads extensions, skills, prompts, and themes.

This phase owns the reusable settings/resource-loading integration layer and the reusable runtime tool-policy helper, including the minimum `get_tools` metadata contract used by preview, snapshots, and UI display. It does not own new-session selection, snapshot persistence, idle switching, rollback, or UI behavior.

## Source requirements

- Design §7: replace the current `createAgentSessionServices({ cwd, agentDir })` start point with a profile-aware settings manager and `resourceLoaderOptions.skillsOverride` path.
- Design §7.1: do not rely on temporary `applyOverrides()` only; `ResourceLoader.reload()` calls `settingsManager.reload()`, so profile overlays must be reapplied on every load/reload.
- Design §7.2: read base global/project settings normally for non-profile settings, but replace resource capability settings from the snapshot.
- Design §7.2: local `extensions`/`skills` load only when explicitly represented by the profile design.
- Design §7.2: never write overlay changes to Pi `settings.json`; preserve project trust semantics.
- Design §7.3: use the right boundary for each capability type: packages in settings manager, package skill narrowing in `PackageSource.skills`, final skill cleanup in `skillsOverride`, tool policy after extension registration.
- Design §8.3: tool policy must be applied after creating the agent session, after extension binding, after reload, and after late extension tool registration when the core exposes a hook. `get_tools` must expose tool name, active state, provenance, selected provider, and conflict/override marker when known.
- Design §5: use Pi `PackageSource` shape exactly and normalize v1 profile packages so effective package objects disable prompts/themes with `prompts: []` and `themes: []`.
- Covers invariants: I2, I3, I4, I5, I7, I8.
- Must not violate: I1, I6, I9, I10, I11, I12.

## Implementation steps

1. Add a profile-scoped settings manager factory.
   - Add `createProfileScopedSettingsManager({ cwd, agentDir, snapshot })` near the existing runtime/session service startup code.
   - Wrap or adapt the existing Pi settings manager instead of replacing unrelated settings behavior.
   - Ensure normal settings such as model, thinking, retry, compaction, npm command, and auth-related config still come from base global/project settings.
   - Override all profile-owned resource capability settings from the provided snapshot instead of merging them with base resource settings.

2. Suppress base resource capability leakage.
   - Replace `packages` with `normalizeProfilePackages(snapshot.plugins)`.
   - Clear or suppress base `extensions`, standalone/local `skills`, `prompts`, and `themes` unless the profile schema explicitly represents that resource capability.
   - In v1, profiles are not prompt/theme bundles, so prompt/theme resources must not be loaded from either selected packages or base settings.
   - In v1, there is no general standalone local extension/skill selection field; therefore global/project base extensions and standalone skills must not leak into the profile-scoped runtime.
   - Do not implicitly append globally installed packages, project packages, or project resource settings to the snapshot-selected package set.

3. Reapply overlay on every settings load/reload.
   - Ensure both initial settings reads and `settingsManager.reload()` return resource settings derived from the same immutable snapshot.
   - Do not depend on one-time transient overrides that can be cleared by reload.
   - Add a targeted guard/test for `ResourceLoader.reload()` preserving profile resource capability settings.

4. Normalize profile packages for runtime loading.
   - Implement `normalizeProfilePackages(snapshot.plugins)` using the canonical `PackageSource` validation from phase 01.
   - Preserve string/object `PackageSource` semantics, but for v1 effective runtime loading ensure selected packages are object-normalized with `prompts: []` and `themes: []` unless a future design explicitly enables those resource kinds.
   - Preserve `extensions` and `skills` filters exactly, including omitted keys vs `[]` semantics.
   - Do not implicitly append globally installed packages or project packages.

5. Wire service creation to accept the scoped manager.
   - Update the service startup path in `lib/rpc-manager.ts` so profile-aware callers can pass:
     - `settingsManager: createProfileScopedSettingsManager(...)`
     - `resourceLoaderOptions: { skillsOverride: createProfileSkillsOverride(snapshot) }`
   - Ensure the scoped settings manager is installed before any package/resource loader or extension binding is created.
   - Keep this phase limited to integration plumbing and helper behavior; phase 05 decides new-session application order and transactionality, and phase 06 decides existing-session restore/switch behavior.

6. Add skills override boundary.
   - Implement `createProfileSkillsOverride(snapshot)` only as final post-resolution deny/cleanup behavior for hidden or disabled skill refs that cannot be represented cleanly by package filters, such as local, ambiguous, or otherwise unrepresentable skills.
   - Treat `PackageSource.skills` as authoritative for package skill narrowing.
   - Do not implement a broad `visibleSkillRefs` allowlist that freezes package default skills at preview time or suppresses newly resolved plugin-default skills.
   - If a package skill is both included by package filters and hidden by snapshot skill state, hidden wins at cleanup time; diagnostics for that conflict are produced by resolver/preview phases, not redefined here.

7. Implement the runtime tool-policy helper and metadata contract.
   - Add a shared helper, for example `applyProfileToolPolicy({ sessionOrServices, snapshot, phase })`, that is callable after extension binding and after resource/settings reload.
   - Derive selected built-in tool activation from `snapshot.tools.requestedBuiltinTools` and selected plugin tools from the tools registered by selected plugin extensions.
   - Do not implement plugin disabling by filtering tools after load; disabled plugins must already be absent before resource loading.
   - Resolve name collisions according to runtime behavior and produce metadata consistent with Phase 03 `ToolConflict`:
     - tool name;
     - active state;
     - provenance: `builtin`, `plugin`, or `unknown` where genuinely unavailable;
     - selected provider: `builtin` or `plugin` when a collision exists;
     - plugin source/path when known;
     - override/conflict marker and message.
   - Ensure `get_tools` returns or can be adapted to return this minimum metadata for UI consumption.
   - Reapply policy immediately after creating the agent session, after extension binding, after any explicit resource/settings reload, and after late extension tool registration if Pi exposes a hook. If no late-registration hook exists, document that limitation and cover all known binding/reload points with regression tests.
   - Treat required conflict metadata missing for an actual override as a runtime validation failure for phases 05/06, not something the UI should guess.

## Acceptance criteria

- A capability snapshot can be supplied to runtime service creation and determines resource capability settings before extensions/resources load.
- Profile-scoped settings replace or suppress base `packages`, `extensions`, standalone/local `skills`, `prompts`, and `themes` unless those capabilities are explicitly represented by the profile design.
- Reloading the resource loader or settings manager does not clear, widen, or merge the profile resource capability set with base resource settings.
- Applying a profile overlay never writes to `~/.pi/agent/settings.json`.
- Non-profile settings continue to resolve through normal global/project settings and trust behavior.
- V1 runtime package normalization disables prompts/themes while preserving extension and skill filters.
- Disabled plugins are absent from the profile-scoped package set before resource loading; no post-load filtering is used to simulate plugin disablement.
- Package skill narrowing remains encoded through `PackageSource.skills` where possible; `skillsOverride` is only final hidden/disabled cleanup for unrepresentable/local/ambiguous skills.
- The service creation path installs the profile-scoped settings manager before package/resource loading or extension binding begins.
- The runtime tool-policy helper is applied after extension binding, after reload, and after late registration when supported.
- `get_tools` exposes enough metadata for UI display: tool name, active state, built-in/plugin provenance, selected provider for collisions, and override/conflict marker.
- The phase does not create, persist, switch, or roll back session snapshots.

## Tests/validation

- Unit test `normalizeProfilePackages()`:
  - string package source becomes effective object form with `prompts: []` and `themes: []`.
  - object package source preserves `extensions` and `skills` filters.
  - omitted resource keys are not confused with `[]`, except v1 prompt/theme suppression.
  - invalid `PackageSource` values are rejected by shared validation.
- Unit/integration test profile-scoped settings manager:
  - base non-resource settings still load normally.
  - profile `packages` replace base package settings.
  - base global/project `extensions`, standalone/local `skills`, `prompts`, and `themes` are cleared or suppressed unless explicitly represented by the profile schema.
  - project trust behavior is unchanged.
  - no writes are made to Pi `settings.json` during overlay creation, load, or reload.
- Ordering regression test:
  - create services with a profile snapshot.
  - assert the profile-scoped settings manager is installed before package/resource loader construction and before extension binding.
  - repeat the assertion for reload paths where applicable.
- Reload regression test:
  - create services with a profile snapshot.
  - trigger settings/resource reload.
  - assert the effective package set and suppressed base resource settings remain the snapshot-derived profile resource capability set.
  - assert runtime tool policy and `get_tools` provenance/conflict metadata are reapplied after reload, not only at initial creation.
- Resource boundary test:
  - absent plugin is not loaded and cannot register extension side effects.
  - base standalone/local resources do not load unless explicitly represented by the profile schema.
  - package skill narrowing uses `PackageSource.skills` rather than only post-load hiding.
- Skills override test:
  - hidden or disabled fallback refs are removed after resolution.
  - package-default skills are not frozen or broadly allowlisted from stale `visibleSkillRefs`.
  - when a hidden fallback ref also matches an included skill, hidden wins.
- Runtime tool-policy tests:
  - selected built-in preset controls built-in tool activation.
  - selected plugin tools from enabled extensions are active.
  - `extensions: []` prevents plugin tools because the extension is not loaded.
  - a deterministic test plugin overriding a built-in tool produces matching conflict/provenance metadata in runtime `get_tools`.
  - metadata remains correct after explicit reload.
  - late extension registration hook, if present, triggers policy reapplication; if absent, known binding/reload coverage is documented.
- Run project validation after implementation:
  - `./node_modules/.bin/tsc --noEmit`
  - `npm run lint`
  - `node --test lib/*.test.mjs`
  - `git diff --check`

## Drift guardrails

- Do not add prompt/theme/resource-bundle profile behavior; v1 must suppress prompts/themes in normalized profile packages and base resource settings.
- Do not mutate Pi `settings.json` or use it as the profile selection store.
- Do not implement project default profile behavior in this phase.
- Do not let global/project base resource settings leak into profile-scoped runtimes merely because non-resource settings still come from base settings.
- Do not use plugin-only post-load filtering as the primary implementation.
- Do not use post-load skill/tool filtering to simulate disabled plugins; disabled plugins must be absent before resource loading.
- Do not implement `skillsOverride` as a broad visible-skill allowlist for package skills.
- Do not redefine profile, snapshot, `PackageSource`, diagnostic, or UI schemas here; reference phases 01–03 and 07–08.
- Do not expose a live runtime before snapshot persistence; that transaction belongs to phases 05 and 06.
- Do not restore from a mutable profile ref; callers must provide a saved snapshot.
- Do not leave runtime tool-policy enforcement to UI display phases.

## Dependencies

- Phase 01: canonical profile schema/types, `PackageSource` validation, profile file store, and v1 normalization contracts.
- Phase 02: preview resolver behavior and expected preview/runtime parity for tool/skill conflict metadata.
- Phase 03: session snapshot type/store/API contracts that supply immutable `CapabilitySnapshotV1`, `ToolConflict`, and `ProfileDiagnostic` values.
- Hands off to phase 05 for new-session transactional application using the scoped manager and runtime tool-policy helper.
- Hands off to phase 06 for existing-session restore, idle switch, rollback, reload serialization, and calls to the runtime tool-policy helper.
- Hands off to phases 07–08 for UI presentation of diagnostics/conflicts.
