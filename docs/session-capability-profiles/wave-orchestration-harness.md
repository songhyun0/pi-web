# Wave orchestration harness

## Purpose

This harness makes the session capability profiles implementation proceed by dependency-gated waves instead of a single linear workflow or ad-hoc parent edits. It is an operational rulebook for the parent assistant, workflow agents, reviewers, and gate verdicts.

The harness exists because the implementation spans multiple ownership boundaries: profile contracts, preview resolution, runtime loading, transactional session application, UI source of truth, migration, and final smoke validation. A later wave must not leak into an earlier patch.

## Non-negotiable rules

1. Do not run all ten phases as one linear implementation workflow.
2. Do not start a wave until prerequisite gates have objective evidence.
3. Subagents are read-only unless explicitly assigned an implementation-planning role; they return findings or patch plans, not direct edits.
4. Parent applies only reviewed, scoped patch plans, one phase/gate at a time.
5. Every changed tracked or untracked file must belong to exactly one active phase manifest or be quarantined.
6. Reviewers must flag unnecessary changes, broad refactors, unrelated cleanup, premature future-phase work, and design drift.
7. Gate pass requires command output, changed-file inventory, invariant checklist, and reviewer verdicts tied to the exact patch.
8. If a role mutates the tree unexpectedly, stop, archive the mutation, and return to the last clean gate state.

## Dependency graph

```txt
                         ┌────────────────────┐
                         │ 00 Root Coordinator │
                         │ invariants / gates  │
                         └─────────┬──────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Wave A: Foundation Contracts │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┴────────────────────────┐
          ▼                                                 ▼
 ┌────────────────┐                               ┌────────────────┐
 │ 01 Schema/API  │                               │ 03 Snapshots   │
 │ profile store  │──────── dependency ─────────▶│ CAS/rollback   │
 └───────┬────────┘                               └───────┬────────┘
         │                                                │
         └────────────────────┬───────────────────────────┘
                              ▼
                 ┌────────────────────────┐
                 │ Wave B: Resolver Layer │
                 └───────────┬────────────┘
                             ▼
                 ┌────────────────────────┐
                 │ 02 Preview Resolver    │
                 │ diagnostics / conflicts│
                 └───────────┬────────────┘
                             ▼
              ┌──────────────────────────────┐
              │ Wave C: Runtime Integration  │
              └──────────────┬───────────────┘
                             ▼
              ┌──────────────────────────────┐
              │ 04 Scoped Settings + Tools   │
              │ pre-load packages / get_tools│
              └──────────────┬───────────────┘
                             │
              ┌──────────────┴───────────────┐
              ▼                              ▼
┌────────────────────────┐      ┌────────────────────────────┐
│ 05 New Session Apply   │      │ 06 Existing Restore/Switch │
│ atomic create          │      │ idle switch / rollback     │
└───────────┬────────────┘      └──────────────┬─────────────┘
            │                                  │
            └──────────────┬───────────────────┘
                           ▼
              ┌────────────────────────┐
              │ Wave D: UX Integration │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │ 07 UI Selector/Wizard  │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │ 08 Diagnostics Polish  │
              └───────────┬────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
┌────────────────────────┐        ┌────────────────────────┐
│ 09 Migration/Legacy    │◀───────│ depends on 01/03/04/06│
└───────────┬────────────┘        └────────────────────────┘
            ▼
┌────────────────────────┐
│ 10 E2E Validation      │
│ final evidence gate    │
└────────────────────────┘
```

## Phase pod structure

Each phase is handled by a pod, not a single all-purpose agent.

```txt
┌────────────────────┐
│ Phase Lead Agent   │
│ scope / files / API│
└─────────┬──────────┘
          │
 ┌────────┼─────────────────────────────┐
 ▼        ▼                             ▼
Impl A   Impl B                    Test Agent
module   route/store/etc.          phase tests
 │        │                             │
 └────────┴──────────┬──────────────────┘
                     ▼
          ┌────────────────────┐
          │ Integrator Agent   │
          │ patch merge plan   │
          └─────────┬──────────┘
                    ▼
          ┌────────────────────┐
          │ Review Agents      │
          │ drift / risk / API │
          └─────────┬──────────┘
                    ▼
          ┌────────────────────┐
          │ Gate Verdict Agent │
          │ pass/block/fixes   │
          └────────────────────┘
```

## Phase manifest shape

Before a wave starts, the parent records a manifest in the conversation/todo metadata or a gate ledger. Each manifest must include:

- `phaseId`
- `wave`
- `dependsOn`
- `allowedFiles`
- `allowedImports`
- `forbiddenFiles`
- `forbiddenImports`
- `ownedTypes`
- `frozenAfterGate`
- `deliverables`
- `requiredTests`
- `faultInjectionTests`
- `invariants`
- `gateEvidence`
- `exitVerdict`

A patch fails scope review if any tracked or untracked changed file is not in the active phase manifest.

## Wave manifests and gates

### Wave A — contracts

Phases:

- `01` Profile schema, store, CRUD API, and global default API.
- `03` Session capability snapshot store/API, CAS token, rollback token, and legacy shape.

Allowed implementation files include only profile contracts, profile store/API, session snapshot store/API, narrow tool preset type ownership, and targeted tests.

Gate A requires:

- canonical profile type ownership is clear;
- snapshot-specific type ownership is clear;
- profile schema is stable;
- snapshot CAS/rollback is stable;
- no preview, runtime application, UI, migration, or project default behavior;
- targeted and full validation commands pass.

### Wave B — preview

Phase:

- `02` Read-only preview resolver/API.

Allowed implementation files include only preview resolver/API/tests and planning docs for Phase 02.

Gate B requires:

- preview is read-only;
- exactly one of `profileRef` or `draftProfile` plus `cwd` is accepted;
- selected profile packages only are resolved;
- effective `PackageSource` normalizes `prompts: []` and `themes: []`;
- unresolved requested capabilities fail closed;
- unknown plugin tool metadata blocks apply and omits complete active tool lists;
- conflicts/provenance are exposed;
- preview shape aligns with Gate A snapshot/diagnostic contracts;
- no runtime/session apply/UI/migration changes.

### Wave C — runtime

Phases:

- `04` Profile-scoped settings manager/resource loading/tool metadata.
- `05` New-session profile application.
- `06` Existing-session restore/switch/rollback.

Gate C requires:

- packages are selected before `createAgentSessionServices()` loads resources;
- reload preserves profile scope;
- runtime tool policy matches preview or documents an explicit reconciled difference;
- no live runtime is exposed before snapshot persistence succeeds;
- running profile switch returns `409` with no partial mutation;
- rollback and no-partial-mutation failure paths are tested.

### Wave D — UI

Phases:

- `07` Selector, manager, wizard, and hooks.
- `08` Diagnostic/conflict display polish.

Gate D requires:

- server global default and session snapshot are authoritative;
- localStorage is a visible convenience/cache only;
- no project defaults in v1;
- no stale `toolNames` override path for profile-controlled sessions;
- running switch errors and preview diagnostics are surfaced faithfully.

### Wave E — migration and validation

Phases:

- `09` Bootstrap/migration and legacy compatibility.
- `10` End-to-end validation and local smoke evidence.

Gate E requires:

- all tests pass;
- local smoke passes;
- design invariants I1-I12 have evidence;
- migration reads only global-scope package settings;
- legacy sessions remain compatibility mode until explicitly switched;
- final ledger records all gates and validation outputs.

## Status guard

Run this before and after every workflow pod, parent-applied patch, and gate:

```bash
git status --porcelain=v1 -uall
git status --short --branch -uall
git diff --name-only
git ls-files --others --exclude-standard
git diff --check
git diff --cached --check
```

Untracked files must be included in scope review. `git diff --stat` alone is not sufficient.

## Validation commands

Default gate validation:

```bash
./node_modules/.bin/tsc --noEmit
npm run lint -- --quiet
node --test lib/*.test.mjs
git diff --check
git diff --cached --check
```

Targeted tests may run first, but they do not replace full validation when a gate is being passed.

Do not run `next build` as part of normal implementation gates unless the explicit local smoke phase asks for it.

## Patch queue protocol

Subagents return patch plans, not direct edits. A patch plan must include:

- phase id and wave;
- base status and changed-file list;
- allowed-path check;
- file-by-file intent;
- hunk summaries or proposed snippets;
- tests to run;
- risks and fault-injection gaps;
- explicit out-of-scope items.

Parent applies only after:

1. scope/drift reviewer passes;
2. contract/API reviewer passes;
3. test/failure-path reviewer passes;
4. gate verdict says `pass` or provides a limited approved fix list.

## Current recovery policy

When the workspace contains mixed-wave work, recover as follows:

1. Archive all tracked diffs and untracked files outside the repo.
2. Revert or remove unverified future-wave files.
3. Keep only gate-verified planning docs and Wave A contract artifacts.
4. Re-run Gate A validation.
5. Re-open Wave B from a clean Gate A baseline using a new Phase 02 pod.

Any recovered later-wave work can be used as reference only after the correct wave opens; it must not be silently kept in the active patch.
