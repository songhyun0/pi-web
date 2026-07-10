# Session capability profiles — validation report

## Run identity

- Validation status: **PASS**
- Independent Gate E status: **PASS** (`wave_e_blocker_recheck`; no remaining blockers)
- Date: 2026-07-10 (local)
- Repository / branch / base: `repos/pi-web` / `main` / `96dd5919b1a9fcd4d16ffc4dc855f2c072e3b52e`
- Workspace at validation: 43 modified or untracked entries; no staged changes
- Node / npm / Pi: `v26.3.0` / `11.16.0` / `0.80.3`
- Isolated smoke port: `30151`
- Served port `30141`: listener PID `48361` before, after, and at the final check; never stopped, restarted, or redeployed
- No build, deployment, commit, or push was performed

## Executive verdict

The current workspace passes typechecking, lint, all **144/144** library tests, both diff checks, and an isolated HTTP smoke. The smoke covers first-use migration, one-shot warnings, read-only preview, authoritative skill narrowing, plugin-over-built-in provenance, durable and immutable new-session publication, idle profile switching, running-switch rejection, and restart restoration after the selected profile is mutated.

The implementation remains limited to built-in tools, selected Pi `PackageSource` packages/plugins, and skills. Effective package sources force `prompts: []` and `themes: []`. Profile resolution, preview, application, switching, and restoration do not write global or project Pi settings.

## Final command evidence

| Command | Result |
| --- | --- |
| `./node_modules/.bin/tsc --noEmit` | PASS, exit 0, no diagnostics |
| `npm run lint -- --quiet` | PASS, exit 0 |
| `PI_CODING_AGENT_DIR=<temp> node --test lib/*.test.mjs` | PASS, **144/144** |
| `git diff --check` | PASS |
| `git diff --cached --check` | PASS |
| `/tmp/pi-web-wave-e-smoke.sh` | PASS, `SMOKE_OK` |

Node emitted the repository's existing `MODULE_TYPELESS_PACKAGE_JSON` performance warnings during `.mjs` tests. No test failed, was skipped, or was cancelled.

## Gate remediation evidence

The first independent Gate E review blocked the earlier 125-test revision. A scoped re-review then identified additional concrete transaction, fail-closed, skill-filter, and UI race paths. The current validation run includes focused regressions for the resulting fixes:

| Gate area | Current closing evidence |
| --- | --- |
| Exact tool authority | Same-name built-in substitution is rejected; bind/reload/late mutation paths reapply policy; a policy violation swallowed by Pi's extension boundary still leaves a fatal dead wrapper that cannot be registered or swapped. |
| Canonical identity and trust | Session ID, JSONL path/header, canonical cwd, snapshot record, runtime cwd, and explicit project trust are validated together. |
| Durable new-session publication | The SDK session manager is pointed at a non-discoverable pending path before any JSONL write. It materializes and binds there; after snapshot persistence the file is atomically promoted and the live wrapper registered. Bind-time session entries stay on the pending file. |
| Existing-session isolation | Candidate construction uses a copy, cleans it after construction failures, keeps it isolated through snapshot persistence, rejects candidate-file mutation, then promotes and swaps without an intervening await. |
| Dead runtime publication | `registerRpcSession` and `replaceRpcSession` reject closed wrappers; binding persists fatal profile-policy violations across Pi's handler error boundary. |
| Invalid settings | Profile-backed initial load and every reload reject parse errors and non-object global or trusted-project roots. Plugin inventory returns visible error diagnostics. Legacy restore behavior is unchanged. |
| Skill authority | Partial selection emits `!**` plus exact force-includes, including nonstandard manifest paths. Source-unverifiable hidden refs produce a blocking diagnostic rather than suffix-hiding another package's skill. Runtime skill errors and collisions fail closed. |
| Store/schema/locks | Reserved capability fields, malformed package filters, widened tools, and incoherent records are rejected. A recovery claim serializes abandoned-owner reclamation; a 16-process regression and a separate 20-round stress probe found no overlapping critical sections. |
| UI reconciliation | Profile state stays pending until runtime reconciliation; old runtime responses are invalidated by an epoch; stale SSE messages are ignored; state/tools/commands/extension UI are cleared and reloaded; `includeState` is serialized with profile mutation; exact switch errors are always visible. |
| Warnings and filtered inventory | Bootstrap/repair warnings survive first mutations and reach previews/snapshots/UI. Exact filtered `PackageSource` values survive the profile manager and wizard paths. |

## Settings immutability evidence

The smoke asserted equality before and after bootstrap, preview, rejected dynamic-capability creation, successful creation, session-file mutation through Pi, idle switch, running rejection, profile mutation, and restart restore.

| File | Equal before/after SHA-256 |
| --- | --- |
| Real `~/.pi/agent/settings.json` | `7855f8a27e2f8a1d7a81b8df8409cb10690f1ed445f52ff4c0acb054a17697f8` |
| Isolated global `settings.json` | `91e15c93095e399fb1d2f00596a9604c51c7d5ec0f718cd405d59be6966b9b84` |
| Isolated project `.pi/settings.json` | `84912b97cf0d1901fa1c586dba1896a3b92d97e0417fa9b6af5add6bb0672574` |

The isolated agent directory contained no `.lock` or `.tmp` artifact after the run. Port `30151` had no listener after cleanup.

## Invariant traceability

| Invariant | Result | Evidence |
| --- | --- | --- |
| I1 profiles are session capability snapshots only | PASS | Exact profile/snapshot schema and UI payload guards. |
| I2 no prompt/theme/resource-bundle profiles | PASS | Reserved fields are rejected; normalized packages and snapshots force empty prompt/theme filters. |
| I3 applying profiles never mutates Pi settings | PASS | No-write overlay tests and all three smoke hashes. |
| I4 package selection precedes resource loading | PASS | Profile settings manager is injected before service/resource creation; excluded-resource marker never executes. |
| I5 use Pi `PackageSource` exactly | PASS | Exact validators and omitted-versus-empty filter tests. |
| I6 one server-owned global default | PASS | Bootstrap/repair tests; valid `builtin:default` remains byte-stable; local storage is convenience only. |
| I7 plugin default then narrow skills | PASS | Authoritative filters, nonstandard manifest-path resolver test, source-safe denylist cleanup, and one-skill smoke snapshot. |
| I8 plugin tools may override built-ins | PASS | Preview, snapshot, runtime metadata, and conflict diagnostics agree on plugin-provided `read`. |
| I9 existing sessions switch only while idle | PASS | Early/late race tests and HTTP `409` with an unchanged snapshot-store hash. |
| I10 runtime/snapshot replacement is transactional | PASS | CAS/ABA/rollback tests, pre-materialization pending paths, rollback retry/error propagation, isolated existing candidates, dead-wrapper guards, and immutable restore. |
| I11 migration imports global packages only | PASS | Bootstrap tests and smoke exclusion of the project-only package. |
| I12 sessions without snapshots remain legacy | PASS | Real legacy restore creates no snapshot until an explicit idle switch. |

## Phase 10 matrix

| Area | Result | Concrete evidence |
| --- | --- | --- |
| Profile store and migration | PASS | Bootstrap, explicit built-in path, warnings, global-only import, repair convergence, strict validation, and crash-recoverable locks. |
| Profile CRUD/default API | PASS | Create/update/delete/default tests, read-only built-ins, exact errors, server-owned default. |
| Snapshot store | PASS | Strict schema, CAS, races, ABA defense, rollback, binding metadata, and lock recovery. |
| Preview | PASS | Saved/draft/built-in resolution, package filters, hidden wins, conflicts, unresolved packages, and dynamic metadata fail closed without extension execution. |
| New session | PASS | Pending path before materialization/bind, SDK-compatible later append, immutable snapshot, rollback retry and surfaced persistent failure, dead-wrapper rejection, ignored client `toolNames`. |
| Existing restore/switch | PASS | Legacy restore, immutable restart restore, isolated candidate construction/persistence, running checks, rollback containment, and lifecycle shutdown. |
| Runtime policy | PASS | Exact provider, active-tool, selected-package skill, collision, bind/reload/mutation, and closed-registry checks. |
| Skill narrowing | PASS | Exact filters, nonstandard paths, inventory-assisted re-enable, source-safe hidden refs, authoritative dynamic inventory. |
| UI and errors | PASS | Materialized IDs, recovery IDs, request epochs, SSE/state/tool/command reconciliation, visible exact errors, plugin diagnostics, and compaction guard. |
| Derived sessions | PASS | Clone/fork snapshot staging uses a fresh snapshot ID and hides the derived JSONL until snapshot persistence. |
| Regression commands | PASS | Typecheck, lint, 144 tests, and both diff checks. |
| Local smoke | PASS | Isolated process on `30151`; served process on `30141` remained PID `48361`. |

## Isolated HTTP smoke

Evidence directory: `/tmp/pi-web-wave-e-smoke.Lj651G`.

- Bootstrap default: `profile:80eb386a-8f97-42b3-af83-b2deb59dfc5e` (`Coding Full`).
- New session: `019f4a68-01bb-7a1b-92a0-bac0f7c6b6b2`.
- Initial snapshot: `32ded467-fafe-4cf4-9fb8-10037b6064f6`.
- Idle-switch snapshot: `831457de-f54c-4666-a841-945312d62a4d`.
- Restart restored the same snapshot ID after the mutable target profile was widened.
- `set_session_name` succeeded after blank-session publication, proving the precreated JSONL remains compatible with later Pi session-manager flushes.
- The dynamic-resource extension was rejected before execution or snapshot creation.
- During a five-second `user_bash`, switching returned `409` and `Wait for the current response to finish before switching profiles.`
- The snapshot-store hash was unchanged by the rejected switch.
- The isolated process stopped cleanly; protected port `30141` remained PID `48361`.

## Scope note

Pi exposes known initial binding, resource reload, active-tool mutation, and tool-registry refresh paths. Pi-web guards and revalidates each of those paths. The report does not claim transactionality for arbitrary external side effects performed by third-party extension code; it does require and prove cleanup of Pi-web-owned runtimes, bindings, subscriptions, timers, registries, candidate files, snapshots, and publication state.

## Sign-off checklist

- [x] I1-I12 have current evidence.
- [x] Every Phase 10 matrix row has current automated or smoke evidence.
- [x] All prior evidence-backed Gate blockers have focused regressions.
- [x] Global, project, and real Pi settings remained byte-stable.
- [x] No covered path publishes a live profile runtime after a capability mismatch.
- [x] Legacy sessions remain legacy until an explicit idle switch.
- [x] The isolated process stopped cleanly and port `30141` was untouched.
- [x] No build, deploy, commit, or push was performed.
- [x] Final independent Gate E decision recorded: PASS.
