# Profile preview resolver

## Purpose

Plan the phase 2 preview resolver that turns a saved profile ref or unsaved draft profile plus `cwd` into an effective capability preview, without mutating Pi settings, installing/updating packages, registering live tools, or persisting session snapshots.

The resolver is the diagnostic/read-only bridge between profile definitions and later runtime application phases: it should show selected packages, narrowed skills, requested/active tool intent, provenance, conflicts, unknown metadata, and blocking errors early enough for users and later APIs to make safe decisions.

## Source requirements

- Design §6.2: `POST /api/profiles/preview` accepts either a saved `profileRef` or an unsaved draft profile and returns an effective capability preview for the current `cwd`.
- Design §5, §7.2: use Pi `PackageSource` shape exactly; normalize v1 effective package specs to object form with `prompts: []` and `themes: []`, including string package inputs, while preserving omitted-vs-empty semantics for `extensions` and `skills`.
- Design §8: preview built-in tools from the selected preset, include selected plugin tools when resolvable from enabled extensions, and mark plugin/built-in override conflicts with provenance.
- Design §9: model skill policy as “plugin default, then narrow”; use `PackageSource.skills` for package skills where possible and `disabledSkillRefs` only as the post-resolution fallback intent.
- Design §13: unresolved selected packages produce diagnostics; if the package requests extensions or skills, preview should indicate that apply/session creation must be blocked, while draft saving can still warn.
- Design §14: preview API must resolve packages, skills, tool conflicts, and diagnostics without mutating global settings.
- Consumes Phase 03 canonical `CapabilitySnapshotV1`, `ToolConflict`, and `ProfileDiagnostic` contracts; preview may omit real `snapshotId`/persistence-only fields but must keep field meanings aligned.
- Covers invariants: I1, I2, I3, I5, I7, I8.
- Must not violate: I4, I6, I9, I10, I11, I12.

## Implementation steps

1. Add a read-only resolver entry point for `POST /api/profiles/preview`.
   - Accept either a saved `profileRef` or a draft profile payload, plus `cwd`.
   - Resolve saved refs through the phase 1 profile store/API contract and phase 9 bootstrap/default path when present.
   - Treat invalid explicit refs as errors, not silent default fallback.

2. Normalize profile package inputs for preview only.
   - Validate string and object `PackageSource` inputs using the exact Pi shape.
   - For v1 effective preview output, convert every selected package spec to object form and set `prompts: []` and `themes: []`, including specs authored as strings.
   - Preserve `extensions` and `skills` semantics exactly: omitted means load all of that resource type, `[]` means load none, and filters narrow package manifest resources.
   - Do not mutate the saved draft/profile definition while producing the normalized effective package list.

3. Resolve package/resource metadata without side effects.
   - Use Pi package/resource metadata loading in a read-only mode or an equivalent preview helper that uses the same selected package set the runtime will receive before resource loading.
   - Do not write settings, persist overlays, install packages, update packages, mutate package configuration, or register extension tools into a live/global runtime.
   - Use deterministic isolated discovery for extension tool metadata where possible, such as a disposable registry/process that cannot publish tools to active sessions.
   - If plugin tool metadata cannot be determined for a selected package whose effective `extensions` request could load tools, return an `unknown` tool-metadata diagnostic and mark the preview `safeToApply: false`. Draft saving may still be allowed only if the server distinguishes save-only warnings from apply/create blockers.
   - Do not silently omit unknown possible plugin tools or conflicts.
   - Do not rely on post-load filtering to pretend disabled plugins are absent; absent plugins must be absent from the preview package set.

4. Build the tool preview.
   - Map `builtinPreset` to requested built-in tool names using the design’s existing presets.
   - Discover plugin tools only from selected packages whose effective `extensions` filter enables the relevant extension resources.
   - Treat string package inputs and omitted `extensions` as extension resources requested; treat `extensions: []` as no plugin extension tools; apply extension filters when narrowing tool discovery.
   - Detect name collisions between selected built-ins and selected plugin tools.
   - Emit tool provenance and conflict metadata using Phase 03 `ToolConflict` and aligning with the Phase 04 runtime `get_tools` metadata contract.
   - For deterministic tests and final validation, include a fixture plugin that registers a tool overriding a built-in name so the same conflict can be checked in preview, persisted snapshot, runtime `get_tools`, and UI.

5. Build the skill preview.
   - Discover default package skills for selected plugins.
   - Apply package-level `PackageSource.skills` narrowing as authoritative for package skills.
   - Treat string package inputs and omitted `skills` as skill resources requested; treat `skills: []` as no package skills; apply skill filters when narrowing visibility.
   - Apply `disabledSkillRefs` as a fallback hidden-skill intent only for local, ambiguous, or otherwise unrepresentable skills.
   - If both package filters and `disabledSkillRefs` mention the same skill, mark hidden as winning and emit a diagnostic.

6. Produce diagnostics and blocking status for later apply flows.
   - Use `ProfileDiagnostic` severities from the Phase 03 snapshot contract.
   - Include unresolved selected packages as diagnostics.
   - Mark previews as unsafe to apply/create when an unresolved package requests extensions or skills. String package sources and object sources with omitted `extensions` or `skills` count as requesting those resources; only explicit `extensions: []` and `skills: []` avoid that tools/skills blocking path.
   - Mark previews with unresolved or unknown plugin tool metadata as unsafe to apply/create when extensions are requested, because conflicts cannot be ruled out.
   - Keep diagnostics generation here; persistence and runtime transaction decisions remain in phases 03, 05, and 06.

7. Return a concrete snapshot-like preview result.
   - Include `profileRef` when available, profile name, `cwd`, normalized effective `plugins`, tool preview data, visible/hidden skills, diagnostics, and an explicit `safeToApply`/blocking flag.
   - Tool preview data should include requested built-in tools, active/resolved tool names when known, plugin tool provenance when known, conflicts, and unknown/incomplete markers when metadata cannot be resolved safely.
   - Align field meanings with `CapabilitySnapshotV1`, but do not assign or persist a real session `snapshotId`.
   - Do not write `~/.pi/agent/web-session-profiles.json` or mutate any live session wrapper.

8. Share normalization/resolution logic with later runtime phases where practical.
   - Put PackageSource normalization and request/blocking classification in reusable helpers, or add conformance tests that keep preview behavior aligned with the profile-scoped settings manager in phase 04.
   - Keep the resolver read-only; runtime creation, transactionality, and session snapshot persistence remain owned by later phases.

## Acceptance criteria

- `POST /api/profiles/preview` returns an effective preview for a valid saved profile ref and for a valid unsaved draft profile.
- Preview never mutates `~/.pi/agent/settings.json`, profile definition files, session snapshot files, package installation/configuration state, or live session runtime state.
- Preview package output uses only selected profile packages; it does not implicitly append globally or project-installed packages.
- Effective v1 package output normalizes all selected packages, including string inputs, to object form with `prompts: []` and `themes: []` so prompt/theme/resource-bundle profile behavior is not exposed.
- Omitted resource keys and empty resource arrays keep their distinct Pi semantics, especially for `extensions` and `skills`.
- Tool output honors `PackageSource.extensions`: omitted/string means extensions are requested, `extensions: []` suppresses plugin tools, and extension filters narrow plugin tool discovery.
- Skill output reflects plugin default skills narrowed by `PackageSource.skills`, with `disabledSkillRefs` only as fallback denylist intent.
- Tool output identifies selected built-in tools, selected plugin tools where safely resolvable, plugin/built-in name conflicts with provenance, and unknown/incomplete plugin tool metadata when conflicts cannot be ruled out.
- Unknown plugin tool metadata for enabled extensions blocks apply/create (`safeToApply: false`) rather than implying no conflicts.
- Missing or unresolved selected packages surface diagnostics; previews that would be unsafe to apply/create are clearly marked as blocking for later phases.
- Invalid explicit `profileRef` requests fail closed rather than falling back silently.

## Tests/validation

- API tests for saved-ref preview and draft-profile preview.
- PackageSource validation tests for string source, object source, invalid shape, omitted resource keys, and empty resource arrays.
- Normalization tests proving v1 effective package preview converts string packages to object form with `prompts: []` and `themes: []` without changing the stored draft/profile definition.
- `PackageSource.extensions` tests for omitted/string, `extensions: []`, and extension filter forms, including disabled extensions suppressing plugin tool preview/conflicts.
- Read-only tests proving preview does not write Pi `settings.json`, profile definition files, session snapshot files, package installation/configuration state, or runtime session state.
- Missing-package diagnostics tests, including unresolved string packages and object packages with omitted `extensions` or `skills` being marked unsafe to apply/create.
- Tool conflict tests using a deterministic fixture plugin that registers a tool with the same name as a selected built-in tool; assert Phase 03 `ToolConflict` data matches the Phase 04 runtime metadata contract.
- Unknown-tool-metadata tests where enabled extension metadata cannot be safely resolved; assert `safeToApply: false` and a blocking diagnostic.
- Skill narrowing tests for no narrowing, some skills enabled via `+skills/.../SKILL.md`, all skills disabled with `skills: []`, and hidden-wins conflict with `disabledSkillRefs`.
- Run applicable project validation after implementation: `./node_modules/.bin/tsc --noEmit`, `npm run lint`, `node --test lib/*.test.mjs`, and `git diff --check`.

## Drift guardrails

- Do not add prompt, theme, or general resource-bundle profile preview behavior.
- Do not mutate Pi `settings.json` or use preview as a temporary settings overlay.
- Do not install/update packages or register extension tools into a live/global runtime during preview.
- Do not persist session snapshots; phase 03 owns snapshot storage/API surface.
- Do not create, expose, reload, or swap agent runtimes; phases 04–06 own runtime integration and application.
- Do not implement project default profile behavior; v1 has only one global default.
- Do not treat global/project package settings as automatically active in a profile.
- Do not use post-load skill/tool filtering as the primary mechanism for disabling plugins.
- Do not silently omit unresolved plugin tool metadata in a way that implies there are no possible plugin tools or conflicts.
- Do not define final runtime `get_tools` behavior here; phase 04 owns runtime metadata/enforcement and phase 08 owns polish/display.

## Dependencies

- Depends on phase 01 for canonical profile schema, profile store, validation helpers, and profile CRUD/default contracts.
- Depends on phase 03 for canonical `CapabilitySnapshotV1`, `ToolConflict`, `ProfileDiagnostic`, and snapshot-like preview field meanings.
- Provides diagnostics and effective preview data consumed by phases 05, 06, 07, and 08.
- Must align with phase 04 profile-scoped settings integration and runtime tool metadata so preview package/skill/tool resolution matches runtime resource loading behavior.
