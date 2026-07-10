# Existing-session restore and idle profile switch

## Purpose

Plan the existing-session runtime path for session capability profiles:

- Restore `/api/agent/[id]` sessions from the persisted capability snapshot for that session.
- Allow profile switches only for idle existing sessions.
- Reject running-session switches with `409 Conflict` and no partial mutation.
- Swap/reload runtime state transactionally so the live runtime never differs from the saved snapshot.
- Reapply runtime tool policy on restore, switch, and existing-session reload paths.
- Trigger frontend remount/reconcile expectations after a successful switch without defining UI polish.

## Source requirements

Design sections:

- §6.4 Existing session restore
- §6.5 Existing session profile switch
- §7 Profile-scoped settings integration
- §8 Tool policy
- §10.2 Hooks/components: `useSessionProfile`
- §11 Frontend data flow: Existing session and switch existing idle session
- §12 Migration and compatibility: existing sessions without snapshots
- §13 Error handling
- §14 Validation plan

Invariant coverage:

- Covers: I1, I3, I4, I8, I9, I10, I12
- Must not violate: I2, I5, I6, I7

Phase ownership:

- This phase owns restore-from-snapshot behavior for existing sessions and idle-only switch/reload semantics.
- This phase consumes the snapshot store/API shape and CAS/write-token contract from phase 03.
- This phase consumes profile-scoped service/settings creation and runtime tool-policy helper from phase 04.
- This phase does not own new-session creation; that is phase 05.
- This phase does not own diagnostic display polish; that is phase 08.
- This phase does not own migration/bootstrap behavior except using the legacy compatibility fallback required during restore.

## Implementation steps

1. Restore existing sessions from saved snapshot.
   - In `/api/agent/[id]` startup flow, load the saved capability snapshot for the session id before creating the runtime.
   - If a valid snapshot exists, pass it into the phase-04 profile-scoped service/settings creation path.
   - After extension binding, call the Phase 04 runtime tool-policy helper and expose `get_tools` metadata aligned with the saved snapshot.
   - Expose the effective saved snapshot through `get_state` and/or the dedicated session profile endpoint specified by prior phases.
   - Ensure restore uses the saved snapshot, not the current mutable profile definition.
   - Fail closed if a persisted snapshot exists but is corrupt, cannot be parsed, cannot be resolved into profile-scoped services, or cannot safely create the runtime. Do not silently fall back to broader global/project settings in that case.

2. Add legacy compatibility for sessions without snapshots.
   - If no saved snapshot exists, use the design's legacy/current global+project settings compatibility mode.
   - Surface the effective profile as legacy/current-settings mode through the same state/profile surface.
   - Do not persist a normal snapshot during plain restore unless the user explicitly switches to a saved profile.

3. Implement a per-session switch critical section.
   - Serialize profile switching against prompt execution, restore/start, reload, and other profile switches for the same session.
   - `POST /api/sessions/:id/profile` must acquire this session-level guard before commit-sensitive work can mutate runtime or snapshot state.
   - Recheck that the session exists and is still idle inside the guard before committing any switch.
   - If the session is running, or becomes running before commit, return `409 Conflict` with the required user-facing meaning: wait for the current response to finish before switching profiles.
   - Prompt/start/reload routes must not observe or enter a half-switched state; they should wait for the critical section or reject according to existing route semantics.
   - Guarantee the running rejection leaves the current runtime and saved snapshot unchanged.

4. Build candidate snapshot/runtime in isolation.
   - Resolve the target profile using phase-01/02 profile resolution rules.
   - Build a new capability snapshot for the session cwd.
   - Create the new profile-scoped runtime or reload plan without exposing it as the active wrapper yet.
   - Candidate runtimes must not be registered in `globalThis.__piSessions`, emit normal running/SSE state, or leave subscriptions, timers, or extension bindings behind if creation or persistence fails.
   - Apply runtime tool policy through the phase-04 helper after extension binding/reload. Phase 08 only consumes provenance/conflict metadata for display.
   - If no active `AgentSessionWrapper` exists, use the candidate runtime/reload plan only to validate the profile-scoped capability set, then persist the snapshot and leave the session unloaded unless the route intentionally registers the validated candidate after commit.

5. Commit snapshot and runtime atomically under the session guard.
   - Preserve the previous snapshot record, previous CAS token, and previous active wrapper before committing.
   - Stage the new snapshot write using the phase-03 snapshot store's atomic write/replace behavior.
   - Do not allow `get_state`, the session profile endpoint, prompt/start, reload, or a second switch to observe a saved snapshot that does not match the active runtime during the commit window.
   - Commit the staged snapshot and active runtime swap as one guarded operation: after success, the active runtime and persisted snapshot must describe the same capability set.
   - If candidate runtime creation fails, destroy the candidate and keep the previous runtime/snapshot.
   - If snapshot persistence fails, destroy the candidate and keep the previous runtime/snapshot.
   - If active swap fails after persistence has been staged or written, restore the previous snapshot using the phase-03 rollback helper and previous token, and restore the previous runtime before releasing the guard. If consistency cannot be restored, destroy/unregister the live wrapper and return an error rather than exposing mismatched capabilities.
   - No failed switch may leave a new snapshot active with the old runtime, or a new runtime active with the old snapshot.

6. Reapply tool policy on existing-session reload paths.
   - Any existing-session explicit reload or resource/settings reload route must use the same per-session guard or an equivalent serialization mechanism.
   - After reload completes, call the Phase 04 runtime tool-policy helper before reporting `get_state`, `/api/sessions/:id/profile`, or `get_tools` results.
   - Add tests proving plugin override/provenance metadata remains correct after restore, idle switch, and reload, not just during new-session creation.

7. Return switch result and reconcile frontend state.
   - Return the new saved snapshot after a successful switch.
   - Ensure `useSessionProfile.applyProfile(profileRef)` can update its effective snapshot from the response.
   - Ensure `ChatWindow`/session runtime state can refresh or remount as needed after the switch.
   - Keep `ChatInput` switching disabled while `agentRunning` is true; this phase relies on server `409` as the authoritative guard.

## Acceptance criteria

- Existing session startup with a saved snapshot creates services using that snapshot.
- Existing session startup does not re-resolve mutable profile definitions in place of the saved snapshot.
- Existing session startup without a snapshot remains compatible as legacy/current-settings mode.
- Existing session startup with an invalid persisted snapshot fails closed with an error/diagnostic instead of falling back to broader settings.
- Running-session profile switch returns `409 Conflict` before any snapshot persistence or runtime swap.
- Profile switching is serialized against prompts, restores/starts, reloads, and concurrent switches for the same session.
- Idle-session switch resolves the target profile, builds a new snapshot, persists it, and swaps/reloads runtime state.
- Candidate runtimes remain isolated until commit and are fully cleaned up on failure.
- Any failure leaves the previous runtime and previous snapshot active, or unregisters/destroys the live wrapper if consistency cannot be restored.
- No route can observe a persisted snapshot that differs from the live runtime's capability set during or after a switch.
- No successful response exposes a live runtime whose capabilities differ from the persisted snapshot.
- Switching profiles does not mutate `~/.pi/agent/settings.json`.
- Package/resource selection still reaches `createAgentSessionServices()` before extensions/resources load through the phase-04 integration.
- Runtime tool policy after restore, switch, and reload reflects the selected built-in tools plus selected plugin tools, including provenance/conflict metadata.
- The frontend can reconcile to the returned effective snapshot after a successful switch.

## Tests/validation

Targeted tests:

- Restore uses persisted snapshot even after the underlying profile definition is edited.
- Restore without a snapshot loads legacy/current global+project settings compatibility mode.
- Restore with a corrupt or unresolvable persisted snapshot fails closed and does not fall back to global/project settings.
- Running profile switch returns `409` and leaves previous snapshot/runtime untouched.
- Switch-vs-prompt race returns `409` or otherwise serializes without partial mutation.
- Two concurrent switches for the same session serialize so only a consistent final snapshot/runtime pair is observable.
- `/api/agent/[id]` restore/start during a switch cannot observe or register a half-switched runtime.
- `get_state` and `/api/sessions/:id/profile` reads during the commit window do not observe saved/live mismatch.
- Idle profile switch persists the new snapshot and subsequent restore uses it.
- Candidate runtime creation failure leaves previous snapshot/runtime untouched and cleans up the candidate.
- Snapshot persistence failure leaves previous snapshot/runtime untouched and does not return a live switched runtime.
- Swap failure restores the previous snapshot/runtime, or unregisters the live wrapper if consistency cannot be restored.
- Resource reload after switch preserves profile-scoped packages via the phase-04 settings manager behavior.
- Runtime `get_tools` after restore/switch/reload reflects the same active tool set/conflict behavior represented by the snapshot/preview, using the deterministic plugin override fixture.

Project validation:

```bash
./node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/*.test.mjs
git diff --check
git diff --cached --check
```

Evidence required at phase gate:

- Test output for restore, idle switch, running `409`, rollback, and concurrency cases.
- Manual or automated evidence that `~/.pi/agent/settings.json` is not modified by switch/restore.
- Evidence that a restarted existing session uses the saved snapshot rather than the latest profile definition.
- Evidence that runtime `get_tools` metadata remains correct after restore, switch, and reload.

## Drift guardrails

- Do not add prompt/theme/resource-bundle profile behavior; rely on earlier package normalization for v1 prompts/themes exclusion.
- Do not define new `PackageSource`, profile, or snapshot schema shapes here; reference phases 01 and 03.
- Do not persist snapshots from preview-only paths.
- Do not mutate Pi global settings while restoring or switching.
- Do not implement project default profile behavior in v1.
- Do not use post-load filtering as the primary way to disable plugins; disabled plugins must be absent before resource loading via phase 04.
- Do not restore from a current mutable profile ref when a saved snapshot exists.
- Do not use legacy/current-settings compatibility mode when a persisted snapshot exists but is invalid or cannot create services.
- Do not partially switch a running session or allow client-side disabled controls to be the only running guard.
- Do not expose saved/live capability mismatches to state/profile reads during the switch commit window.
- Do not leave isolated candidate runtimes registered or subscribed after failures.
- Do not treat phase 08 as runtime tool-policy enforcement; it is display polish only.
- Do not expand UI diagnostics or polish beyond returning enough state for phase 07/08 to display.

## Dependencies

- Phase 01: profile schema/store/API validation and exact `PackageSource` handling.
- Phase 02: profile resolution/preview behavior and diagnostics consumed during switch.
- Phase 03: session snapshot store, canonical snapshot types, session profile API surface, and CAS/rollback helpers.
- Phase 04: profile-scoped settings manager, service creation before resource loading, and runtime tool-policy enforcement helper.
- Phase 05: new-session transactional application patterns to mirror for existing-session switch.
- Phase 07: `useSessionProfile`, `ChatWindow`, and `ChatInput` integration for returned snapshot and remount/reconcile behavior.
- Phase 08: display polish for conflicts/diagnostics returned after restore or switch.
- Phase 09: migration bootstrap and legacy labeling details for sessions without snapshots.
