# Conflict, diagnostic, and UX polish

## Purpose

Polish the user-facing presentation of profile tool conflicts, provenance, diagnostics, and profile-switch errors so preview, runtime state, and saved effective session state are understandable and consistent.

This phase owns display and consistency checks for conflicts and diagnostics. It does not own core profile resolution, snapshot persistence, settings overlay behavior, runtime creation, runtime tool-policy enforcement, or package/resource loading.

## Source requirements

- Design §5: capability snapshots include separate canonical fields for tool conflicts and profile diagnostics: `snapshot.tools.conflicts` and `snapshot.diagnostics`.
- Design §8.2: selected plugin tools may override selected built-in tools, and preview must mark conflicts.
- Design §8.3: `get_tools` must provide enough metadata for UI display: tool name, active state, provenance when known, selected provider for collisions, and override/conflict marker.
- Design §9: if `PackageSource.skills` and `disabledSkillRefs` mention the same skill, hidden wins and preview should emit a diagnostic.
- Design §10.2: `ProfileSelector` shows conflicts and diagnostics indicators when effective snapshots have warnings or conflicts.
- Design §13: missing/unresolved package, explicit invalid profile ref, missing global default fallback, unknown plugin tool metadata, and running-switch errors must surface clear messages without partial state mutation.
- Design §14: validation must cover preview diagnostics, runtime `get_tools`, plugin override visibility, UI running-state disablement, and server-side errors.
- Invariants covered directly: I8 and I9.
- I10 coverage in this phase is limited to client display/no-optimistic-effective-state behavior; transactional persistence and runtime rollback enforcement are owned by earlier server/runtime phases.
- Must not violate: I1, I2, I3, I4, I5, I7, I10, I12.

## Implementation steps

1. **Inventory conflict and diagnostic producers and consumers**
   - Confirm phase 02 preview returns canonical `diagnostics` for unresolved selected packages, hidden-wins skill conflicts, invalid profile refs, unknown plugin tool metadata, and fallback warnings when applicable.
   - Confirm tool override conflicts are returned as `tools.conflicts`, not as `ProfileDiagnostic` entries.
   - Confirm phase 03/06 session profile endpoints expose the saved effective snapshot, including both `tools.conflicts` and `diagnostics`, for existing sessions.
   - Confirm phase 04 runtime `get_tools` metadata exposes tool name, active state, provenance, selected provider for collisions, and conflict marker.
   - Confirm phase 08 consumes, rather than recreates, canonical conflicts and diagnostics from earlier phases.

2. **Polish tool provenance, active state, and override display**
   - Update `ProfileSelector` or its directly implied child UI to summarize conflicts from `effectiveSnapshot.tools.conflicts`.
   - Show tool name, active/inactive state, selected provider, and built-in vs plugin provenance when that metadata is returned by preview/snapshot/runtime state.
   - Ensure plugin override/conflict indicators appear even when `snapshot.diagnostics` is empty.
   - If provenance is genuinely unknown for a non-conflict tool, degrade gracefully; for override/conflict cases, missing upstream metadata is a blocker rather than a reason to guess in the client.
   - Ensure plugin override messaging matches both preview conflict data and runtime `get_tools` metadata.
   - Avoid adding a separate tool-policy implementation in the UI; UI display must reflect server/runtime data.

3. **Polish diagnostics surfaces**
   - Add compact warning/error indicators near the current profile name for `snapshot.diagnostics` and a distinct conflict/override indicator for `snapshot.tools.conflicts`.
   - Provide a details view or inline summary for snapshot diagnostics with severity, message, and optional source/path.
   - Group repeated diagnostics only for display; do not alter persisted or API diagnostic data.
   - Keep informational diagnostics visually subordinate to warnings/errors.

4. **Polish skill hidden-wins messaging**
   - Display the resolver diagnostic when a skill is both included by package filters and hidden by `disabledSkillRefs`.
   - Make the message clear that hidden wins for the effective profile.
   - Do not add new skill-filtering behavior in this phase.

5. **Polish profile resolution and package error messages**
   - Surface blocking diagnostics from preview/apply/create flows without implying that the profile was applied.
   - Distinguish draft-save warnings from apply/session-creation blockers when the server makes that distinction.
   - For explicit invalid profile refs, show a clear choose-another-profile message and do not update effective session state.
   - For missing global default fallback warnings returned by the server, surface the warning while displaying the actual fallback snapshot/profile that was applied.
   - Keep package messages tied to the server diagnostic `source`/`path` when present.
   - For unknown plugin tool metadata, explain that the profile cannot be applied until tool metadata can be resolved because overrides/conflicts cannot be ruled out.

6. **Polish failed apply/create and running-session handling**
   - Ensure profile switching controls are disabled while `agentRunning` is true.
   - If the server returns `409`, show the required message: “Wait for the current response to finish before switching profiles.”
   - For any failed apply/create response, including but not limited to `409`, do not optimistically update the effective profile or snapshot.
   - Leave the current effective profile unchanged after rejected existing-session switches.

7. **Enforce preview/snapshot/runtime consistency**
   - Compare effective preview conflicts/diagnostics with existing-session saved snapshot display after apply.
   - Compare runtime `get_tools` metadata with the snapshot conflict display for plugin override cases, including selected provider, provenance/conflict marker, and active state.
   - Treat missing or inconsistent required metadata as a blocking issue for overall implementation acceptance. Fix it in the owning resolver, settings integration, runtime, or API phase before accepting this phase.
   - Do not reconstruct missing provenance, diagnostics, or conflict state in the client as a workaround.

## Acceptance criteria

- `ProfileSelector` displays the current profile name plus visible indicators when the effective snapshot has profile diagnostics and/or tool conflicts.
- Tool override/provenance display is derived from `tools.conflicts`, snapshot data, preview data, and runtime `get_tools` metadata, not from client-side guesses.
- Plugin tool overrides are visible in both preview-oriented UI and runtime/current-session UI, even when `diagnostics` is empty.
- Runtime tool metadata display includes active/inactive state when shown.
- Skill hidden-wins conflicts are displayed as diagnostics and do not cause the UI to show the skill as effectively visible.
- Missing/unresolved package diagnostics and unknown plugin tool metadata diagnostics are visible during preview and block/apply failure states when returned by the server.
- Explicit invalid profile refs block with a choose-another-profile message; missing global default fallback warnings are surfaced when returned by the server.
- Running-session profile switches remain disabled in the UI, and server `409` responses leave the current effective profile unchanged.
- Other failed apply/create responses also leave the current effective profile/snapshot unchanged.
- Preview conflict data, persisted snapshot conflict data, and runtime `get_tools` metadata render one coherent provider/provenance/conflict message for the same plugin override case.
- No UI path suggests prompt/theme/resource-bundle profile behavior.
- No implementation in this phase mutates Pi `settings.json`, persists snapshots, changes runtime tool policy, or changes package/resource loading.

## Tests/validation

- Add or update component/hook tests for diagnostics indicators, conflict indicators, and detail rendering in `ProfileSelector` / `useSessionProfile` flows.
- Test plugin override display with mocked preview data, mocked persisted snapshot data, and mocked runtime `get_tools` metadata for the same override; assert one coherent selected-provider/provenance/conflict message and active state.
- Test that a valid `tools.conflicts` value with empty `diagnostics` still displays an override/conflict indicator.
- Test hidden-wins skill diagnostic rendering and effective hidden state.
- Test unresolved package and unknown-tool-metadata preview/apply error display, including source/path when present.
- Test explicit invalid profile ref handling and missing-global-default fallback warning display when returned by the server.
- Test running-session switch disablement and `409` handling with no optimistic profile change.
- Test non-409 apply/create failures with no optimistic effective profile/snapshot update.
- Run project validation required by the design:
  - `./node_modules/.bin/tsc --noEmit`
  - `npm run lint`
  - `node --test lib/*.test.mjs`
  - `git diff --check`
  - `git diff --cached --check`

## Drift guardrails

- Do not define new profile capabilities; display only tools, selected packages/plugins, and skills.
- Do not introduce prompt/theme/resource-bundle profile UI; v1 diagnostics may mention prompts/themes only to confirm they are disabled by package normalization elsewhere.
- Do not write or propose writes to `~/.pi/agent/settings.json`.
- Do not implement plugin/package filtering in the client; disabled plugins must already be absent before resource loading.
- Do not persist snapshots or alter transaction behavior; phase 08 only reflects server-returned state and avoids optimistic effective-state updates on failures.
- Do not treat tool conflicts as profile diagnostics; consume `snapshot.tools.conflicts` and `snapshot.diagnostics` separately.
- Do not treat the mutable profile definition as the current effective session state; display the saved snapshot for existing sessions.
- Do not add project default profile behavior.
- Do not accept this phase by filing follow-up issues for required preview/snapshot/runtime consistency; required metadata mismatches must be fixed in the owning phase before acceptance.

## Dependencies

- Phase 01: canonical profile-definition types such as `PackageSource` and profile refs.
- Phase 02: preview resolver diagnostics for package resolution, unknown plugin tool metadata, and skill hidden-wins cases, plus `tools.conflicts` for tool conflicts.
- Phase 03: canonical `ToolConflict`, `ProfileDiagnostic`, `CapabilitySnapshotV1`, session profile API, and snapshot exposure for effective diagnostics and tool conflicts.
- Phase 04: runtime `get_tools` metadata contract and tool-policy enforcement helper.
- Phase 05: new-session response includes the persisted `profileSnapshot`.
- Phase 06: existing-session switch/restore exposes effective snapshot and preserves rollback semantics.
- Phase 07: `useProfiles`, `useSessionProfile`, `ProfileSelector`, manager/wizard flows, and base UI placement.
