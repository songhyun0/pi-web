# Session snapshot store and API surface

## Purpose

Plan the session capability snapshot persistence layer and the session profile API contract.

Phase 03 owns:
- canonical snapshot-specific types: `CapabilitySnapshotV1`, `ToolConflict`, `ProfileDiagnostic`, snapshot store records, and snapshot write tokens;
- `CapabilitySnapshotV1` storage keyed primarily by session id, with optional session file path metadata for restore/cleanup lookups;
- read surface for the current effective saved session profile snapshot;
- atomic, concurrency-safe snapshot store helpers for later new-session and idle-switch transactions;
- legacy compatibility state for sessions without saved snapshots.

Phase 03 does not create profile-scoped runtimes, resolve packages, reload sessions, implement UI display, or complete existing-session profile switching. If a `POST /api/sessions/:id/profile` route is scaffolded in this phase, it must be non-mutating for idle sessions until Phase 06 can perform the runtime swap/rollback transaction in the same server-side operation.

## Source requirements

Traceability:
- Design §5: `CapabilitySnapshotV1`, `ToolConflict`, `ProfileDiagnostic`, snapshot persistence path `~/.pi/agent/web-session-profiles.json`.
- Design §6.1: server-side files are source of truth; localStorage is not authoritative.
- Design §6.2: `GET /api/sessions/:id/profile` and `POST /api/sessions/:id/profile` endpoints.
- Design §6.4: existing session restore loads saved snapshot; missing snapshot uses legacy/global fallback.
- Design §6.5: existing session switch shape, idle-only precondition, atomic persist and runtime-swap requirement.
- Design §12: old sessions show `Legacy / current settings` until explicitly switched.
- Design §13: explicit invalid profile refs fail with no mutation; snapshot persistence failure blocks apply/session creation and prevents capability mismatch.
- Design §14: tests for snapshot store behavior, legacy reads, running switch rejection support, and transactional exposure support.

Invariant coverage:
- Directly covers: I12 and the persistence/store portion of I10.
- Provides canonical types needed by later phases for: I1, I8, and I9.
- Must not violate: I2, I3, I4, I5, I6, I7, I10, and I11.

## Implementation steps

1. Add canonical snapshot-specific types.
   - Define `CapabilitySnapshotV1`, `ToolConflict`, and `ProfileDiagnostic` from the design.
   - Import or reference Phase 01-owned `ProfileRef`, `ToolPreset`, `PackageSource`, and `SkillRef` instead of redefining them.
   - Keep `plugins` as the immutable selected `PackageSource[]` spec/filter set from the snapshot.
   - Do not version-lock package artifacts in this store.

2. Add the session snapshot store module.
   - Store data outside Pi `settings.json`, using `~/.pi/agent/web-session-profiles.json`.
   - Preserve unknown top-level keys when reading/writing the file.
   - Support missing file and missing parent directory.
   - Use `sessionId` as the primary key. Store optional metadata such as `sessionFilePath`, `cwd`, and timestamps only as lookup/audit data; do not make mutable profile definitions part of the restore key.

3. Define the persisted record and revision shape.
   - Use an explicit top-level store revision and per-record revision so later phases have a testable compare-and-swap/rollback contract:

   ```ts
   interface SessionProfilesFileV1 {
     version: 1;
     revision: number;
     sessions: Record<string, SessionProfileRecordV1>;
     [unknownKey: string]: unknown;
   }

   interface SessionProfileRecordV1 {
     sessionId: string;
     sessionFilePath?: string;
     updatedAt: string;
     recordRevision: number;
     snapshot: CapabilitySnapshotV1;
   }

   interface SessionSnapshotWriteToken {
     storeRevision: number;
     recordRevision?: number;
   }
   ```

   - Increment the store revision on every successful write.
   - Increment the target record revision on every replacement of that session's snapshot.
   - Return the new token after every successful write; return the current token on CAS conflict where safe.

4. Add atomic and concurrency-safe write helpers.
   - Validate the complete in-memory payload before replacing the existing file.
   - Serialize writes in-process and use a file lock or equivalent lock file if cross-process writes are possible; otherwise document the single-process assumption and still use compare-and-swap against the latest on-disk revision.
   - Write to a temporary file, then rename into place.
   - Return structured errors so later route/orchestration code can block apply/new-session flows on persistence failure.
   - Never partially update one session snapshot if validation, concurrency checks, or file replacement fails.

5. Add snapshot read/write service functions.
   - `getSessionProfileSnapshot(sessionId)` returns a discriminated result: saved snapshot when present, or legacy compatibility when missing, plus the current write token when applicable.
   - `setSessionProfileSnapshot(sessionId, snapshot, metadata, expectedToken?)` atomically replaces the current effective snapshot for that session and returns the new store version/record metadata.
   - `restoreSessionProfileSnapshot(sessionId, previousRecordOrNull, expectedToken)` restores the exact previous record or deletes the new record during rollback, using CAS so rollback cannot overwrite a newer concurrent commit.
   - `deleteSessionProfileSnapshot(sessionId, expectedToken?)` exists only if needed by session delete cleanup.
   - Missing snapshot returns explicit legacy compatibility state, not a fabricated saved profile.

6. Define the machine-readable legacy response shape.
   - Use a discriminant so later phases cannot treat compatibility mode as a saved snapshot:

   ```ts
   type SessionProfileResponse =
     | { state: "snapshot"; snapshot: CapabilitySnapshotV1; record: { sessionId: string; sessionFilePath?: string; updatedAt: string; recordRevision: number } }
     | { state: "legacy"; label: "Legacy / current settings"; snapshot: null };
   ```

7. Add `GET /api/sessions/:id/profile`.
   - Verify the session exists using existing session lookup behavior.
   - Return `state: "snapshot"` with the saved `CapabilitySnapshotV1` when available.
   - For missing snapshots, return `state: "legacy"`, `label: "Legacy / current settings"`, and `snapshot: null`.
   - Do not resolve mutable profile definitions as a substitute for a saved snapshot.

8. Scaffold `POST /api/sessions/:id/profile` only as a safe contract boundary.
   - Accept a target `profileRef` shape for the later existing-session apply flow.
   - Verify the session exists.
   - Reject running sessions with `409 Conflict` and no snapshot mutation.
   - Reject an explicitly invalid `profileRef` with no mutation; do not fall back to the global default for explicit apply.
   - Until Phase 06 performs resolver + runtime swap + snapshot persistence as one transaction, idle-session POST must not replace the saved snapshot. It may return `501 Not Implemented`/equivalent contract response for idle sessions, or remain internal-only.
   - Never persist client-supplied preview output. The snapshot used for apply must be built and validated server-side for the target session cwd by the resolver/orchestrator at apply time.

9. Document handoff helpers for later phases.
   - Phase 02 consumes the canonical snapshot/diagnostic/conflict contracts for preview output.
   - Phase 05 uses `setSessionProfileSnapshot` during new-session creation before exposing/registering the runtime.
   - Phase 06 carries the previous snapshot record/token through idle switch orchestration, builds the target snapshot server-side, creates/swaps the runtime, and uses `restoreSessionProfileSnapshot` if rollback is needed.
   - Phase 04 consumes snapshots but does not own snapshot persistence.

## Acceptance criteria

- Snapshot records are saved and loaded from `~/.pi/agent/web-session-profiles.json`, not Pi `settings.json`.
- `CapabilitySnapshotV1`, `ToolConflict`, and `ProfileDiagnostic` have one canonical owner: this phase.
- Store and `GET /api/sessions/:id/profile` return the persisted snapshot for a session even if the profile definition changes later; actual runtime restore is a later-phase responsibility.
- A missing snapshot is surfaced as `state: "legacy"` with label `Legacy / current settings` and `snapshot: null`.
- Snapshot replacement is atomic at the file level, concurrency-safe for the shared JSON store, revisioned, and all-or-nothing at the session record level.
- Same-session competing writes use the CAS token/record revision and cannot silently lose updates.
- Rollback helpers can restore the previous record or delete a failed-attempt record without overwriting a newer successful commit.
- `GET /api/sessions/:id/profile` exposes saved snapshot or legacy compatibility state without resolving mutable profile definitions.
- Phase 03 does not expose a public idle-session apply path that only mutates the snapshot. Running-session apply is rejected with `409 Conflict` and no mutation; idle apply remains non-mutating until Phase 06 transaction support exists.
- Persistence helpers return errors that later phases can use to prevent exposing a runtime whose capabilities differ from the saved snapshot.

Stop/go gate:
- Go only when store tests prove atomic write behavior, concurrent write safety, CAS behavior, rollback restore/delete behavior, unknown-key preservation, missing-file handling, and legacy-read behavior.
- Stop if implementation needs to mutate Pi `settings.json`, derive restore from current mutable profile definitions, persist client-supplied preview snapshots, or create/swap runtimes in this phase.

## Tests/validation

Required tests:
- Missing snapshot store file returns an empty store and does not create invalid defaults.
- Store read/write preserves unknown keys.
- Invalid snapshot payload is rejected before replacing the existing file.
- Failed write leaves the previous snapshot file intact.
- Concurrent writes to different session ids preserve both snapshots and increment store revision correctly.
- Competing writes to the same session obey the CAS/recordRevision contract and do not silently lose updates.
- Rollback helper restores the exact previous record after a failed same-session switch when the expected new token matches.
- Rollback helper deletes a failed-attempt new record when the previous state was legacy/missing.
- Rollback helper refuses to overwrite a newer concurrent successful commit and returns a structured consistency error.
- `getSessionProfileSnapshot` returns the exact saved snapshot for a session.
- Missing session snapshot returns legacy compatibility state, not a generated saved snapshot.
- `GET /api/sessions/:id/profile` returns saved snapshot data.
- `GET /api/sessions/:id/profile` returns `state: "legacy"`, label `Legacy / current settings`, and `snapshot: null` for old sessions without snapshots.
- `POST /api/sessions/:id/profile`, if scaffolded, rejects running-session apply with `409 Conflict` and performs no snapshot mutation.
- Idle `POST /api/sessions/:id/profile`, if scaffolded before Phase 06, performs no snapshot mutation and clearly reports that apply is not implemented yet.
- Snapshot replacement uses a server-built `CapabilitySnapshotV1`, not a pointer to the mutable profile definition and not client-supplied preview output.

Project validation commands for the eventual implementation:
- `./node_modules/.bin/tsc --noEmit`
- `npm run lint`
- `node --test lib/*.test.mjs`
- `git diff --check`

## Drift guardrails

- Do not add prompt, theme, or resource-bundle profile behavior in this phase.
- Do not write or patch `~/.pi/agent/settings.json`.
- Do not make project default profiles active in v1.
- Do not implement package/resource loading here; Phase 04 owns profile-scoped settings integration before resource load.
- Do not create, swap, or expose live runtimes here; Phases 05 and 06 own transactional runtime exposure.
- Do not publicly report an existing-session profile switch unless the runtime and saved snapshot are changed by the same server-side transaction.
- Do not restore from a current mutable `profileRef`; restore/read from the saved `CapabilitySnapshotV1`, or return explicit legacy mode when none exists.
- Do not persist client-supplied preview output or stale localStorage/client state.
- Do not duplicate profile-definition schema/type ownership from Phase 01; reference its definitions and validate persisted snapshots against them.

## Dependencies

Prior phases:
- Phase 01 provides profile-definition, `PackageSource`, `SkillRef`, `ProfileRef`, and validation definitions.

Parallel/consumer phases:
- Phase 02 consumes this phase's snapshot, diagnostic, and tool-conflict contracts for preview output. Phase 03 does not depend on Phase 02's resolver implementation.

Later phases:
- Phase 04 reads snapshots to construct profile-scoped settings before `createAgentSessionServices()` resource loading.
- Phase 05 persists the snapshot transactionally during new-session creation before exposing the runtime.
- Phase 06 completes existing-session restore, idle switch, runtime swap, rollback, and public apply semantics using this store/API contract.
- Phases 07/08 consume API output for selector, wizard, conflict, and diagnostic display without redefining persistence semantics.
