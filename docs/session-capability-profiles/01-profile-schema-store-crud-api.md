# Profile schema, store, and CRUD API

## Purpose

Define the v1 profile definition schema, pi-web-owned profile store, validation rules, and `/api/profiles` CRUD/default surface. This phase creates the server-side source of truth for editable profile definitions and the single global default profile ref, without creating session snapshots or changing runtime/session behavior.

This phase owns profile-definition types only. `CapabilitySnapshotV1`, `ToolConflict`, `ProfileDiagnostic`, snapshot store records, and snapshot write tokens are owned by Phase 03.

## Source requirements

- Design sections: 1, 2, 3, 4, 5, 6.1, 6.2, 10.3, 10.4, 13, 14.
- Covers invariants: I1, I2, I3, I5, I6.
- Must not violate: I4, I7, I8, I9, I10, I11, I12.
- Phase-owned scope:
  - `ProfilesFileV1` with `version`, `defaults.globalProfileRef`, and `profiles`.
  - `ProfileRef` as full ref strings: `profile:<uuid>` or `builtin:<name>`.
  - `ToolPreset`, `PackageSource`, `SkillRef`, and `ProfileDefinition` for tools, plugins, and skill narrowing intent.
  - Pi `PackageSource` shape exactly: string or `{ source, extensions?, skills?, prompts?, themes? }`.
  - Profile definitions stored outside Pi `settings.json`, recommended at `~/.pi/agent/web-profiles.json`.
  - Server-side files are authoritative; client/localStorage is not.
  - `/api/profiles` CRUD for profile definitions and global default metadata/update.
- Boundary: package normalization helpers may be introduced here, but runtime package/resource loading, preview resolution, snapshot-specific types, and snapshot persistence are later phases.
- Missing-file boundary: the raw store may expose a non-persisted initialized view before migration/bootstrap exists. The final shared bootstrap behavior that writes a real first-run default profile belongs to Phase 09 and supersedes the pre-bootstrap fallback for final API/resolver paths.

## Implementation steps

1. Add shared v1 profile types and validators.
   - Define `ToolPreset = "none" | "default" | "full"`.
   - Define `ProfileRef`, `PackageSource`, `ProfileDefinition`, `SkillRef`, and `ProfilesFileV1` matching the design.
   - Validate `ProfileDefinition.id` stores the full ref string, not a raw UUID.
   - Validate user-created profile ids are unique `profile:<uuid>` refs and cannot collide with generated/read-only `builtin:<name>` refs.
   - Validate profile names as non-empty trimmed strings; reject duplicate saved profile names only if the UI/API requires name uniqueness elsewhere, but do not allow empty or whitespace-only names.
   - Validate `tools.pluginTools` is exactly `"fromSelectedPlugins"`.
   - Validate `skills.mode` is exactly `"pluginDefaultThenNarrow"`.
   - Reject profile-level prompt/theme/resource-bundle fields. Do not reject valid Pi-shaped `PackageSource.prompts` or `PackageSource.themes` keys inside package specs.
2. Implement the profile file store.
   - Read/write `~/.pi/agent/web-profiles.json` as pi-web-owned data.
   - Handle a missing directory/file in the raw store by returning a non-persisted initialized view, using an allowed built-in fallback ref such as `builtin:default` as the temporary `defaults.globalProfileRef` until Phase 09 bootstrap/migration creates a real user-editable default profile.
   - Do not write a placeholder profile file merely because the raw store file is absent; avoid blocking later migration from current global-scope package settings.
   - Once Phase 09 is implemented, public API/resolver paths should call the shared bootstrap resolver rather than relying on this raw missing-file fallback as final behavior.
   - Preserve unknown top-level keys and unknown profile-object keys on read-modify-write, while still rejecting unsupported fields in incoming API request bodies.
   - Serialize store mutations in-process and write atomically with temp-file plus rename, or an equivalent atomic write strategy.
   - For every mutation, validate the complete next `ProfilesFileV1` before writing so `defaults.globalProfileRef` never points at a missing or disallowed ref.
   - Never read or write Pi `settings.json` as part of profile selection, CRUD, or default updates.
3. Implement global default handling.
   - Store only `defaults.globalProfileRef` in v1.
   - Add an explicit server write path, for example `PATCH /api/profiles/default` with body `{ "globalProfileRef": "profile:<uuid>" }`, to update the global default.
   - Validate default refs point to an existing saved profile or an allowed generated built-in ref.
   - Apply default changes through the same serialized atomic store mutation path as profile CRUD.
   - Do not add project default fields or resolution behavior in v1.
4. Implement `/api/profiles` CRUD.
   - `GET /api/profiles`: return saved profile definitions, any generated/built-in entries, and the global default ref. Before Phase 09 it may use the raw fallback view; after Phase 09 it should use shared bootstrap/default resolution so first-run APIs see the real bootstrapped profile file.
   - `POST /api/profiles`: create a user profile with a generated `profile:<uuid>` id and timestamps; clients must not supply raw UUID ids or built-in refs.
   - `PATCH /api/profiles/:id`: update editable fields and `updatedAt`; reject invalid refs/shapes and attempts to edit generated/read-only built-in entries.
   - `PATCH /api/profiles/default`: update only `defaults.globalProfileRef` after validation.
   - `DELETE /api/profiles/:id`: remove user profiles only. If the profile is the active global default, either reject the delete or accept an explicit validated replacement ref in the same request and commit delete+replacement atomically; do not leave a dangling default.
   - Keep built-in refs read-only if generated entries are exposed.
5. Define the package normalization boundary for later phases.
   - Accept authoring-time string package sources.
   - Provide a helper contract for effective v1 package specs that converts selected packages to object form with `prompts: []` and `themes: []`.
   - Preserve Pi `PackageSource` validation semantics in stored profile definitions: omitted key means load all resources of that type, `[]` means load none, and `+`, `-`, and `!` entries keep Pi semantics.
   - For effective v1 runtime specs, deliberately override prompts/themes to `[]` during normalization without mutating the saved profile definition.
   - Do not resolve packages, discover skills, apply settings overlays, define runtime `get_tools` metadata, or persist session snapshots in this phase.
6. Add closed-failure validation responses.
   - Invalid explicit profile refs, malformed `PackageSource` values, duplicate ids, empty names, or attempts to mutate read-only built-ins return validation errors.
   - Missing global default is represented for later fallback/setup warning behavior, not silently expanded into project defaults.

## Acceptance criteria

- Profile definitions can be created, listed, updated, deleted, and selected as the global default through `/api/profiles` without touching `~/.pi/agent/settings.json`.
- The persisted file uses `version: 1`, `defaults.globalProfileRef`, and an array of `ProfileDefinition` entries.
- The raw store's missing-file path is non-persisted and does not create a placeholder file that would preempt Phase 09 migration; the final API/resolver first-run write behavior is owned by Phase 09.
- User profile IDs are stored and returned as full `profile:<uuid>` refs.
- The store serializes mutations, atomically writes complete validated files, preserves unknown top-level/profile-object keys, and never leaves a dangling default ref.
- `PackageSource` validation accepts exactly the Pi shape from the design, including optional package-level `prompts` and `themes`, and rejects unrelated top-level prompt/theme/resource-bundle profile fields.
- v1 profile packages can be normalized for later effective use with `prompts: []` and `themes: []` without mutating saved profile definitions.
- Project default profile behavior is absent from the v1 store/API.
- Server file state is the only authoritative profile/default source.
- Snapshot-specific shapes are not duplicated here; Phase 03 owns `CapabilitySnapshotV1`, `ToolConflict`, and `ProfileDiagnostic`.

## Tests/validation

- Unit tests for profile file read/write:
  - missing file and missing directory initialize safely in the raw store without persisting a placeholder file;
  - unknown top-level keys and unknown profile-object keys survive read-modify-write;
  - invalid JSON/schema failures are reported clearly;
  - serialized concurrent mutations do not lose updates;
  - temp-file/rename or equivalent atomic write path is used for mutations.
- Unit tests for validators:
  - valid `profile:<uuid>` and `builtin:<name>` refs;
  - invalid raw UUID profile ids;
  - duplicate profile ids/refs are rejected;
  - empty or whitespace-only profile names are rejected;
  - generated/read-only built-in refs cannot be created, edited, or deleted through user-profile CRUD;
  - valid string and object `PackageSource` values, including optional `prompts` and `themes` keys;
  - omitted versus empty resource keys;
  - rejection of top-level/general prompt, theme, or resource-bundle profile behavior.
- API tests for `/api/profiles`:
  - create/update/delete/list profiles;
  - update `defaults.globalProfileRef` through the explicit server endpoint;
  - default profile ref validation against saved profiles and allowed built-in refs;
  - deleting the active default rejects or atomically applies an explicit validated replacement;
  - read-only handling for generated/built-in entries if exposed;
  - no writes to Pi `settings.json`.
- Phase 09 must add final bootstrap tests proving `/api/profiles` and all profile-resolution callers create/use the real default profile on first run.
- Project validation commands when this phase is implemented:
  - `./node_modules/.bin/tsc --noEmit`
  - `npm run lint`
  - `node --test lib/*.test.mjs`
  - `git diff --check`

## Drift guardrails

- Do not add prompt, theme, or resource-bundle profile behavior; only normalize v1 effective packages so prompts/themes are disabled for runtime use.
- Do not reject Pi-shaped package-level `prompts`/`themes` keys in stored `PackageSource` values.
- Do not mutate Pi global/project settings during CRUD or default selection.
- Do not persist an absent-profile-file raw fallback as a migration substitute; Phase 09 owns bootstrap from current global-scope package settings.
- Do not implement preview diagnostics, package resolution, skill discovery, snapshot-specific schema, session snapshot persistence, runtime creation, or session switching here.
- Do not make globally installed or project packages implicitly active unless they are represented in a profile definition.
- Do not add project default profile fields or trust semantics in v1.
- Treat `disabledSkillRefs` only as stored UI intent/fallback metadata; package-skill narrowing behavior is implemented by later resolver phases.

## Dependencies

- Prior phases: none.
- Handoffs:
  - Phase 03 owns canonical session snapshot, diagnostic, tool-conflict, snapshot store, and write-token types.
  - Phase 02 consumes validated profile definitions and normalization helpers for preview resolution/diagnostics, plus Phase 03 snapshot contracts for preview output.
  - Phase 04 owns profile-scoped settings/resource-loading integration and runtime tool-policy metadata.
  - Phase 09 owns initial bootstrap/migration from current global-scope package settings and legacy session compatibility verification.
