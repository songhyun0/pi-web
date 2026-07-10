# End-to-end validation and local pi-web smoke test

## Purpose

- Prove the full session capability profiles implementation satisfies the design before the feature is considered complete.
- Collect concrete, traceable evidence across schema/store/API, preview, snapshot persistence, runtime integration, new/existing session flows, UI behavior, migration/legacy compatibility, and regression checks.
- Verify the implementation does not drift into UI-only filtering, prompt/theme/resource-bundle profiles, project defaults, or Pi `settings.json` mutation.

## Source requirements

- Source design sections: 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16.
- Phase 10 owns validation evidence and local smoke checks only; it does not redefine schemas, persistence semantics, runtime services, or UI behavior.
- Covers invariants: I1, I2, I3, I4, I5, I6, I7, I8, I9, I10, I11, I12.
- Must not violate: all invariants, especially I3, I4, I10, and I12.
- Evidence must be from fresh execution or linked prior artifacts that are still applicable, such as command output, test names, API responses, file paths/hashes, screenshots/log excerpts, or manual run notes with timestamps. Assertion-only notes are not sufficient.

## Implementation steps

1. Create or update the final validation report artifact, for example `docs/session-capability-profiles/validation-report.md`, with:
   - each required validation item from source section 14
   - pass/fail status
   - concrete evidence links or excerpts
   - source section and invariant mapping
   - owning phase/doc reference for each failure
2. Prepare validation isolation for checks that touch `~/.pi/agent` state:
   - prefer a temporary `agentDir`/`HOME` where tests support it
   - otherwise record before/after hashes or backups for `~/.pi/agent/settings.json`
   - use the evidence to prove preview/apply does not mutate Pi global settings
3. Execute or link traceable evidence for profile file/store behavior:
   - missing file and missing directory handling
   - unknown key preservation
   - profile CRUD validation for names, refs, PackageSource shape, and default refs
   - Phase 03 snapshot store revision/CAS behavior and rollback helpers
4. Execute or link traceable evidence for preview and fail-closed error handling:
   - package resolution
   - skill narrowing
   - tool conflict/provenance diagnostics using a deterministic plugin that overrides a built-in tool
   - unknown plugin tool metadata blocking apply/create when enabled extensions could register tools
   - no global settings mutation
   - invalid explicit profile refs block and ask for another profile
   - missing global default uses a built-in safe fallback with a warning
   - unresolved selected packages with extension or skill filters block apply/session creation while remaining saveable as draft/preview warnings where applicable
   - server-side apply/preview errors are surfaced to the UI
5. Execute or link traceable evidence for session runtime behavior:
   - `/api/agent/new` applies selected profile packages and tools
   - existing session restore uses the persisted snapshot, not the mutable profile definition
   - idle session profile switch persists the new snapshot and applies it
   - running session profile switch returns `409` with no partial mutation
   - session creation/apply never returns a live runtime whose capabilities differ from the saved snapshot
6. Execute or link traceable evidence for profile-scoped resource loading:
   - package selection is applied before `createAgentSessionServices()` loads resources
   - at least one runtime-level fixture, test, or instrumentation proves excluded packages/extensions are absent from the loaded runtime, not merely hidden after load
   - `settingsManager.reload()` preserves profile-scoped packages
   - full runtime tool policy is reapplied after reload and known extension-binding points
   - late extension registration hook reapplication is tested if the core exposes such a hook; if no hook exists, document the limitation and prove known reload/binding paths are covered
   - plugin tool override is visible in preview, persisted snapshot, runtime `get_tools`, and UI
   - `get_tools` includes tool name, active state, provenance, selected provider for collisions, and conflict/override marker
   - PackageSource skill filters are stored correctly
   - v1 package normalization disables prompts/themes with `prompts: []` and `themes: []`
7. Execute or link traceable evidence for migration and compatibility:
   - initial migration reads global-scope package settings only
   - first-run bootstrap is shared across profile-resolution paths and is concurrency-safe
   - legacy sessions without snapshots load in compatibility mode
   - explicitly switched legacy sessions persist normal snapshots
8. Execute or link UI evidence:
   - switching is disabled while running
   - server-side apply/preview errors are surfaced
   - global default can be set only through the server-backed API path
   - profile warnings/conflicts are visible where specified by prior UI phases
9. Run project validation commands from the design and capture output:
   - `./node_modules/.bin/tsc --noEmit`
   - `npm run lint`
   - `node --test lib/*.test.mjs`
   - `git diff --check`
   - `git diff --cached --check`
10. Perform a local pi-web smoke test using the project-approved development entrypoint only:
   - start the local pi-web app with `npm run dev` or the equivalent approved local command
   - create a new session with an explicit profile and confirm the returned snapshot is shown
   - load an existing session and confirm the saved snapshot is restored
   - switch an idle existing session to a different profile and confirm the new snapshot is persisted and runtime state, including `get_tools`, reflects it
   - attempt a running-session profile switch and confirm the `409` path is visible with no partial mutation
   - stop the local process cleanly after evidence is captured
11. Record failures with owning phase/doc references instead of expanding this document with new design. Required validation failures are blockers for completing this phase and the feature until resolved or explicitly re-scoped by the source design.

## Acceptance criteria

- Every minimum validation item from source design section 14 has passing evidence before this phase is marked complete.
- Any failing required item is recorded with concrete evidence and owning phase/doc reference, and blocks completion until fixed or formally re-scoped.
- Project validation commands complete successfully.
- Local smoke evidence demonstrates new-session apply, existing-session restore, idle-session switch, and running-switch rejection.
- No evidence shows mutation of `~/.pi/agent/settings.json` caused by selecting, previewing, or applying a profile.
- No evidence shows a returned live runtime with capabilities different from its persisted snapshot.
- No prompt/theme/resource-bundle profile behavior is introduced; v1 profile packages normalize prompts/themes off.
- Legacy sessions without snapshots remain compatible until explicitly switched.
- The final validation report maps evidence and failures to source design sections and invariants.

## Tests/validation

Required test/evidence matrix:

| Area | Required evidence | Invariants |
| --- | --- | --- |
| Profile files | Read/write preserves unknown keys and handles missing file/dir | I3, I6 |
| Profile CRUD API | Validates names, refs, PackageSource shape, default refs, and server-backed global default updates | I5, I6 |
| Snapshot store | Revision/CAS behavior, same-session write conflict detection, and rollback restore/delete helpers | I10, I12 |
| Preview API | Resolves packages, skills, tool conflicts, diagnostics, unknown-tool metadata, and fail-closed error cases without mutating global settings | I2, I3, I7, I8 |
| New session | `/api/agent/new` creates sessions with selected profile packages and tools | I1, I4, I10 |
| Existing restore | Restores from persisted snapshot, not latest profile definition | I10, I12 |
| Profile switch | Rejects running sessions and applies idle switches transactionally | I9, I10 |
| Resource loading | Runtime-level evidence proves profile package selection happens before resource loading and excluded packages/extensions are absent | I3, I4 |
| Resource reload | Preserves profile-scoped packages after `settingsManager.reload()` | I3, I4 |
| Runtime tool policy reload | Reapplies active tool policy and `get_tools` metadata after reload/known extension-binding points | I8 |
| Tool conflicts | Deterministic plugin override is visible in preview, persisted snapshot, runtime `get_tools`, and UI | I8 |
| Skill narrowing | Stores PackageSource filters correctly; hidden wins when fallback denylist conflicts | I5, I7 |
| Package normalization | Disables prompts/themes in v1 | I2 |
| Migration | Reads global-scope package settings only | I11 |
| Legacy compatibility | Old sessions without snapshots continue to load | I12 |
| UI | Disables switching while running, shows server-side errors, and uses server-backed global default updates only | I6, I9 |
| Regression commands | Typecheck, lint, node tests, and diff checks pass | all |
| Local smoke | End-to-end profile creation/apply/restore/idle-switch/running-reject behavior works locally | all |

## Drift guardrails

- Do not add validation for prompt, theme, or resource-bundle profile behavior except to prove it is absent.
- Do not add project default profile validation in v1; only confirm the schema remains limited to the global default.
- Do not accept plugin-only post-load filtering as proof that package selection is correct.
- Do not accept preview-only behavior as proof of runtime behavior; runtime `get_tools`, resource-loading evidence, reload evidence, and session restore evidence are required.
- Do not accept a current profile ref as restore evidence; saved capability snapshot evidence is required.
- Do not treat successful UI display as sufficient if server files, APIs, and runtime state are not verified.
- Do not run production deployment or `next build` for this phase; use the project-approved local development entrypoint.
- Keep failures assigned to the owning phase rather than duplicating implementation details here.

## Dependencies

- Phase 1 profile schema/store/API completed.
- Phase 2 preview resolver completed.
- Phase 3 session snapshot store/API completed.
- Phase 4 profile-scoped settings integration and runtime tool-policy helper completed.
- Phase 5 new-session application completed.
- Phase 6 existing-session restore/switch/rollback completed.
- Phase 7 UI selector and manager completed.
- Phase 8 conflict/diagnostic display completed.
- Phase 9 migration/legacy behavior completed.
