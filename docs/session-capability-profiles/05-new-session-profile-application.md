# New-session profile application

## Purpose

Apply a selected session capability profile during `/api/agent/new` creation so the returned session runtime and persisted capability snapshot match exactly.

This phase owns the new-session transaction only: resolving the requested/default profile, building or finalizing the snapshot, creating the profile-scoped runtime, applying the Phase 04 runtime tool-policy helper, validating runtime capabilities against the snapshot, persisting the snapshot under the real session id, exposing/registering the runtime, optionally starting the initial message after exposure, and returning the effective snapshot.

## Source requirements

- Design §6.1: server-side profile/default/snapshot files are authoritative; client localStorage may only suggest a visible new-session selection.
- Design §6.3: `/api/agent/new` accepts `profileRef`; omitted refs use the global default, explicitly invalid refs fail.
- Design §6.3: new-session creation must build a capability snapshot before exposure, persist it atomically under the real session id, then return `{ sessionId, profileSnapshot }`.
- Design §6.3: if persistence or exposure fails, destroy the new runtime and return an error.
- Design §6.3: `toolNames` becomes an implementation detail derived from the profile snapshot, not the primary client contract.
- Design §7: profile-scoped settings must affect package/resource loading before `createAgentSessionServices()` loads extensions/resources.
- Design §8: selected plugin tools may be active, may override selected built-ins, and runtime `get_tools`/UI metadata must expose provenance and conflicts consistently with preview.
- Design §13: capability-affecting profile resolution failures fail closed; unresolved selected packages with requested extensions or skills, and unknown plugin tool metadata for enabled extensions, block apply/session creation.
- Design §13: snapshot persistence failure must block session creation and must not leave a live returned session with capabilities differing from the saved snapshot.
- Design §14: tests must prove selected profile packages/tools are used, profile tool overrides are visible, and no live mismatched runtime is exposed.

## Implementation steps

1. Update `/api/agent/new` request handling to accept optional `profileRef` alongside the existing `cwd`, `type`, and `message?` fields.
2. Resolve the effective profile for the new session:
   - if `profileRef` is omitted, resolve the server-owned global default;
   - if the omitted/default path falls back due to missing default, include the warning from the resolver/snapshot diagnostics;
   - if an explicit `profileRef` is invalid, return an error before creating services;
   - if resolution reports capability-affecting errors such as unresolved selected packages with requested extensions or skills, or unknown plugin tool metadata for enabled extensions, return an error before creating services or exposing a session.
3. Build the capability snapshot for the target `cwd` using the phase 02 resolver and phase 03 snapshot contract.
4. Derive built-in tool selection from `snapshot.tools.requestedBuiltinTools`, but do not treat that list as the full runtime allow-list. Apply the full Phase 04 profile tool policy after extension binding so selected plugin tools, built-in-name overrides, provenance, and conflicts match the snapshot/preview.
5. Create profile-scoped services/runtime using the phase 04 settings manager path so `snapshot.plugins` is applied before package/resource loading.
6. Keep the newly created runtime unexposed until snapshot persistence succeeds and runtime capability validation passes.
7. After the runtime has loaded extensions/resources but before exposure, validate or finalize the effective capability state:
   - confirm loaded package/resource state is compatible with `snapshot.plugins` and diagnostics;
   - call the Phase 04 runtime tool-policy helper;
   - confirm runtime tools, including plugin tools and override/conflict metadata returned by `get_tools`, match the snapshot's effective tool policy and Phase 03 `ToolConflict` data;
   - fail closed if runtime capabilities diverge from the snapshot in a way that affects capabilities.
8. After obtaining the real `sessionId`, persist the snapshot through the phase 03 session snapshot store/API surface using its revision/CAS contract.
9. Expose/register the runtime only after the saved snapshot is durable and matches the runtime capabilities.
10. If `message?` was supplied, start the initial prompt only after the runtime is profile-scoped, the snapshot is durable, and the runtime is registered under the matching snapshot; do not start prompt execution or SSE exposure during the pre-persistence transaction.
11. Return the created `sessionId` and persisted `profileSnapshot` to the client.
12. On any failure after runtime creation but before successful exposure, run transaction cleanup before returning an error:
    - destroy/cleanup the unexposed runtime and services;
    - remove registry/start-lock entries created for this attempt;
    - delete or tombstone any session file created solely for the failed request when safe to do so;
    - remove any snapshot record written by this failed attempt through the Phase 03 rollback/delete helper;
    - ensure no returned or running session can later restore with a missing or mismatched profile snapshot.
13. Legacy-shaped callers that omit `profileRef` still use the server-owned global default profile. Client-provided `toolNames` may be accepted only as backward-compatible input during the transition, but it must not override the resolved profile snapshot for profile-backed creation.

## Acceptance criteria

- `/api/agent/new` can create a session from an explicit valid `profileRef` and returns the persisted `profileSnapshot`.
- Omitting `profileRef` uses the server-owned global default, not client localStorage or client `toolNames`.
- An explicitly invalid `profileRef` fails before any runtime is exposed.
- Missing global default uses the designed safe fallback path with diagnostics, not silent arbitrary settings.
- Unresolved selected packages/resources that affect requested extensions or skills, and unknown plugin tool metadata for enabled extensions, block new-session creation before service creation/exposure.
- Runtime service creation uses the profile-scoped settings manager before resource loading.
- The saved session snapshot and returned runtime capabilities are the same effective profile state.
- Selected plugin tools are active according to the profile, and built-in-name overrides/conflicts are reflected consistently in snapshot/preview and runtime `get_tools` metadata.
- `toolNames` is no longer the authoritative client contract for profile-backed new sessions.
- Snapshot persistence, exposure, or runtime validation failure blocks the response and cleans up unexposed runtime/session/snapshot artifacts created by the failed attempt.
- A request with `message?` does not execute the initial prompt until the profile-scoped runtime is registered with a durable matching snapshot.
- No profile application writes to Pi `settings.json`.

## Tests/validation

- Add route/API tests for `/api/agent/new` with:
  - explicit valid `profileRef`;
  - omitted `profileRef` using global default;
  - explicitly invalid `profileRef` returning an error before service exposure;
  - missing global default producing the designed fallback diagnostic;
  - unresolved selected package/resource with requested extensions or skills blocking creation before service exposure;
  - unknown plugin tool metadata for enabled extensions blocking creation.
- Add transaction tests proving persistence, validation, or exposure failure prevents a returned live session and triggers cleanup of runtime registry/start-lock entries, session artifacts created by the failed request, and any failed-attempt snapshot record.
- Add capability tests proving selected profile packages and derived built-in tools are reflected in the created session.
- Add new-session plugin tool tests using the deterministic override fixture: a selected plugin tool appears in runtime `get_tools`, and a selected plugin tool that overrides a built-in name reports the same provenance/conflict state as the snapshot/preview.
- Add regression coverage that client-provided `toolNames` cannot override the resolved profile snapshot for profile-backed creation.
- Add `message?` path coverage proving the initial prompt starts only after snapshot persistence and runtime registration, and never runs after a failed profile transaction.
- Validate resource-loading order with a test or spy showing package selection is in the settings manager before `createAgentSessionServices()` loads resources.
- Add runtime-vs-snapshot validation coverage for capability divergence after service/resource loading.
- Run project validation gates when implemented:
  - `./node_modules/.bin/tsc --noEmit`
  - `npm run lint`
  - `node --test lib/*.test.mjs`
  - `git diff --check`
  - `git diff --cached --check`

## Drift guardrails

- Covers invariants: I1, I2, I3, I4, I5, I6, I8, I10.
- Must not violate invariants: I7, I9, I11, I12.
- Do not define new profile schema, snapshot schema, or PackageSource semantics here; reference phases 01 and 03.
- Do not persist snapshots before the real session id is known, except through the phase 03 transaction mechanism.
- Do not expose/register a runtime, start SSE-visible work, or execute an initial `message?` until the snapshot is durable and validated against the runtime.
- Do not leave failed-attempt artifacts that can later restore as a successful profile-backed or legacy session.
- Do not persist profile overlays into `~/.pi/agent/settings.json`.
- Do not add prompt/theme/resource-bundle behavior; v1 package normalization remains owned by earlier resolver/settings phases.
- Do not collapse full tool policy into `requestedBuiltinTools`; plugin tools and override/conflict metadata must remain visible and enforced.
- Do not implement existing-session restore, switch, or rollback behavior here; that belongs to phase 06.
- Do not move UI default ownership to the client; server default resolution remains authoritative.

## Dependencies

- Phase 01: profile schema/store/API, validation, global default profile ref, and PackageSource shape.
- Phase 02: preview/resolver logic capable of building effective capabilities and diagnostics from a profile for a `cwd`, including fail-closed diagnostics for capability-affecting unresolved packages/resources and unknown plugin tool metadata.
- Phase 03: session snapshot type contract, persistence API/store, revision tokens, and transaction-safe write/cleanup semantics.
- Phase 04: profile-scoped settings manager integration that applies package/resource settings before service creation and provides the runtime tool-policy helper and `get_tools` metadata contract.
- Phase 07: UI sends a visible selected `profileRef` for new sessions when explicitly chosen and displays the returned snapshot after creation.
