# Migration and legacy compatibility

## Purpose

Plan the v1 bootstrap and compatibility behavior so session capability profiles can be introduced without changing existing users' effective capabilities or promoting unsupported project-specific defaults.

This phase owns bootstrap/migration and legacy-exit verification. It references Phase 03 for the session profile API legacy response shape and Phase 06 for actual runtime restore behavior.

## Source requirements

- Design §5: profile definitions live in `~/.pi/agent/web-profiles.json`; snapshots live separately in `~/.pi/agent/web-session-profiles.json`.
- Design §6.1 and §10.3: server files are authoritative; the server-owned global default is the initial default for new sessions unless the UI sends an explicit validated `profileRef`.
- Design §10.4: v1 does not read or write project default profile refs.
- Design §12: first-run bootstrap reads current global-scope package settings only, creates a user-editable default profile such as `Coding Full`, sets `defaults.globalProfileRef`, and uses the `full` built-in tool preset unless an authoritative server-owned prior default is migrated.
- Design §12: sessions without snapshots display `Legacy / current settings`, restore with current global/project settings, and only become normal profiled sessions after an explicit switch persists a snapshot.
- Design §13: omitted profile input uses the server default path; explicitly invalid refs block; missing or invalid global defaults fall back safely with user-visible warnings.
- Covers invariants: I1, I2, I3, I5, I6, I10, I11, I12.
- Must not violate: I4, I7, I8, I9.

## Implementation steps

1. Add an idempotent bootstrap path layered on the Phase 01 raw profile store and used by shared profile resolution.
   - All server callers that resolve profiles/defaults, including `/api/profiles`, `/api/profiles/preview`, `/api/agent/new`, restore, and apply flows, must see the same initialized or safely-fallback profile state.
   - If `web-profiles.json` is missing, create a v1 profiles file.
   - Use a concurrency-safe write strategy, such as a store lock plus temp-file-and-rename with re-read on conflict, so simultaneous first requests do not create duplicate defaults.
   - Preserve unknown keys when reading/writing any existing profiles file.
   - Do not use Pi `settings.json` as the profile storage target.
   - This final bootstrap behavior supersedes Phase 01's raw-store non-persisted missing-file fallback for public API/resolver paths.
2. Build the initial default profile from global-scope package settings only.
   - Copy only globally configured package sources into `ProfileDefinition.plugins`.
   - Do not include project package settings or project profile defaults.
   - Set `tools.builtinPreset` to `full` for the bootstrap profile unless migrating a valid prior pi-web default.
   - A valid prior pi-web default means an authoritative server-owned persisted global default from an existing profile schema or migration source; never use client localStorage, UI cache, or project defaults as the preserved default.
   - Set `tools.pluginTools` to `fromSelectedPlugins`.
   - Set `skills.mode` to `pluginDefaultThenNarrow` without inventing additional skill behavior.
3. Normalize package sources according to the profile schema and v1 resource boundaries.
   - Keep Pi's `PackageSource` shape exactly: a string source or `{ source, extensions?, skills?, prompts?, themes? }`.
   - For every effective `PackageSource` passed to Pi during preview, apply, new-session creation, restore from snapshot, or reload, force v1 profile packages to object form with `prompts: []` and `themes: []`.
   - This normalization is mandatory even if copied global package settings contain prompt/theme filters, so v1 profiles cannot become prompt/theme/resource-bundle profiles.
4. Set `defaults.globalProfileRef` to the created or preserved valid default profile ref.
   - If the stored global default ref is missing or invalid, use the built-in safe fallback: a generated default-compatible profile with `full` built-in tools, no project defaults, and only global-scope package sources when available; include a setup warning.
   - Do not create or resolve project default refs.
5. Verify legacy snapshot lookup and runtime restore behavior through the owning phases.
   - Phase 03 owns the `/api/sessions/:id/profile` response shape for missing snapshots: `Legacy / current settings` with `snapshot: null`.
   - Phase 06 owns runtime restore for sessions without snapshots using current global/project settings for compatibility.
   - This phase verifies those behaviors in migration/legacy tests and ensures bootstrap does not convert viewed/restored sessions into profiled sessions.
   - Keep the compatibility path separate from profiled restore; do not treat a missing snapshot as a reference to the mutable global default profile.
6. Ensure explicit profile switch exits legacy mode.
   - When the user applies a saved profile to an idle legacy session, use the phase 06 switch flow to build and transactionally persist a normal snapshot.
   - Running-session switches still return `409 Conflict` with no partial mutation.
7. Surface safe fallback labels and warnings through profile/session profile API responses.
   - Omitted `profileRef` on new-session creation uses the server-owned global default path; if that default is missing or invalid, use the safe fallback and return a warning.
   - Explicitly supplied invalid `profileRef` returns a blocking error for the UI to surface and does not create/apply a runtime.
   - Legacy snapshot absence is labeled as compatibility mode, not as the mutable default profile.

## Acceptance criteria

- First run creates a valid v1 profile file with exactly one server-owned global default ref and a matching user-editable default profile, even under concurrent requests.
- Bootstrap is available through the shared store/resolver for all profile resolution paths, not only after `/api/profiles` has been called.
- Bootstrap imports global-scope package settings only; project package settings are not promoted.
- Bootstrap does not add prompt, theme, or resource-bundle profile behavior, and every effective v1 package spec passed to Pi has `prompts: []` and `themes: []`.
- Selecting/applying a profile never mutates `~/.pi/agent/settings.json`.
- New-session creation with omitted `profileRef` uses the server-owned global default or safe fallback with warning; it does not block merely because the client omitted a ref.
- Existing sessions without snapshots restore successfully through Phase 06 compatibility behavior and display `Legacy / current settings` through Phase 03 API behavior.
- Viewing or restoring a legacy session does not create a snapshot.
- Explicitly switching a legacy idle session persists a normal capability snapshot and removes the legacy label.
- Missing defaults and invalid explicit refs produce the phase-specified warning/blocking behavior without exposing mismatched live runtime state.

## Tests/validation

- Unit test missing profile file bootstrap creates `version: 1`, `defaults.globalProfileRef`, and a matching default profile.
- Unit test concurrent bootstrap is idempotent and leaves exactly one default profile/ref.
- Unit test bootstrap imports global package settings and excludes project package settings.
- Unit test valid prior default migration accepts only server-owned persisted default state and ignores client/localStorage or project defaults.
- Unit test every effective profile package normalization path forces `prompts: []` and `themes: []`.
- Unit test profile file read/write preserves unknown keys.
- Unit test bootstrap/default handling never writes Pi `settings.json`.
- API test `/api/profiles` returns the bootstrapped default and warning state for repaired/missing defaults as applicable.
- API test `/api/agent/new` without `profileRef` uses the bootstrapped/global default or safe fallback warning instead of blocking.
- API test explicit invalid `profileRef` blocks creation/apply and returns an error the UI can surface.
- API test `/api/sessions/:id/profile` returns `Legacy / current settings` when no snapshot exists, using the Phase 03 response shape.
- Restore test confirms Phase 06 legacy sessions without snapshots use compatibility current settings, not the latest mutable profile definition as a saved snapshot.
- Switch test confirms an idle legacy session persists a normal snapshot through the existing transactional apply path.
- Regression test running legacy-session switch returns `409 Conflict` and leaves prior state unchanged.
- Include project validation from the design: `./node_modules/.bin/tsc --noEmit`, `npm run lint`, `node --test lib/*.test.mjs`, `git diff --check`, and `git diff --cached --check`.

## Drift guardrails

- Do not add project default profile behavior in v1; schema space is reserved for future work only.
- Do not promote project packages into the global default profile.
- Do not use client localStorage, UI cache, or project defaults as a preserved prior global default.
- Do not model prompts, themes, or resource bundles as profile capabilities.
- Do not pass v1 profile packages to Pi without forcing `prompts: []` and `themes: []`.
- Do not mutate Pi `settings.json` during bootstrap, restore, or profile apply.
- Do not treat a missing snapshot as a reference to the current mutable default profile.
- Do not expose a live returned runtime whose capabilities differ from the persisted snapshot when leaving legacy mode.
- Do not implement plugin-only post-load filtering as the migration mechanism.
- Do not make new-session default resolution depend on the UI calling `/api/profiles` first.
- Do not re-own Phase 03 legacy API shape or Phase 06 legacy runtime restore; verify them here.

## Dependencies

- Phase 01: profile schema, `PackageSource` validation, raw file store behavior, concurrency-safe profile writes, and package normalization rules.
- Phase 03: session snapshot store, canonical snapshot types, and `/api/sessions/:id/profile` legacy response surface.
- Phase 04: profile-scoped settings integration and runtime resource/tool policy for profiled sessions.
- Phase 05: new-session default profile application.
- Phase 06: transactional existing-session switch, idle/running enforcement, and legacy runtime restore.
- Phase 07/08: UI display of profile labels, warnings, diagnostics, and disabled switching while running.
