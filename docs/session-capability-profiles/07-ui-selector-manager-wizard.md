# UI selector, manager, and wizard

## Purpose

Implement the pi-web UI and hooks that let users select, view, create, edit, preview, and set the global default for session capability profiles without making the browser authoritative for profile defaults, resource resolution, tool selection, or runtime state. This phase wires the UI to server-owned profile definitions, defaults, previews, and session snapshots, and removes any client-side capability path that could override the server-built profile snapshot.

## Source requirements

- Source sections: design §§6.1-6.5, 10.1-10.4, 11, 12, 13, 14, 15.
- Add `hooks/useProfiles.ts`, `hooks/useSessionProfile.ts`, `components/ProfileSelector.tsx`, `components/ProfileManagerModal.tsx`, and `components/ProfileWizard.tsx`.
- Keep ownership boundaries:
  - `AppShell` owns selected session/project and modal open/close state only.
  - `useAgentSession` owns active session runtime state.
  - profile-specific state lives in hooks near `useAgentSession`, not a global store.
  - `ChatInput` owns dropdown open/close presentation only.
  - manager/wizard draft state remains local until save.
- `useProfiles` loads `/api/profiles`, exposes `globalDefaultProfileRef`, performs profile CRUD through server APIs, and can update the global default only through the server-owned `PATCH /api/profiles/default` endpoint.
- This phase consumes and displays the server-owned global default profile. It must not create a client-local default mechanism.
- `useSessionProfile` resolves the initial new-session profile, loads existing-session effective snapshots, applies profile changes through server APIs, and exposes loading/applying/error/conflict state.
- `ProfileSelector` appears near model/tool/thinking controls, displays the current profile name, disables switching while `agentRunning`, and shows a warning indicator when the effective snapshot has conflicts or diagnostics.
- The existing tool preset/tool selection UI must not remain an editable capability selector. Remove it from the profile-controlled session flow or refactor it into a read-only snapshot-derived tool summary; it must not send `toolNames` or mutate active tools.
- `ProfileManagerModal` / `ProfileWizard` use local reducer state and follow this wizard order: profile creation, base tool preset, plugin on/off, skill on/off narrowing, effective preview.
- New-session default behavior remains server-owned: if no explicit `profileRef` is sent, `/api/agent/new` uses the global default; once created, the UI displays the returned persisted snapshot.
- Client `localStorage` may cache only a validated last-used profile ref for new sessions and must never become authoritative or a de facto default.
- v1 does not read or write project default profile refs.
- Existing-session switches go through `POST /api/sessions/:id/profile`; running switches show the specified `409 Conflict` message and leave current UI/session state unchanged.
- Relevant invariants: I1, I2, I3, I4, I6, I7, I8, I9, I10, I12. This phase references I5 and I11 but does not own their implementation.

## Implementation steps

1. Add `useProfiles`.
   - Fetch profile definitions, generated/built-in entries, and `globalDefaultProfileRef` from `/api/profiles`.
   - Provide create/update/delete helpers that call the profile CRUD routes and refresh local hook state from server responses.
   - Provide a server-backed `setGlobalDefaultProfile(profileRef)` helper that calls `PATCH /api/profiles/default`; do not persist defaults in localStorage or project settings.
   - Reuse phase 01 profile types; do not redefine canonical schema or `PackageSource` behavior in UI code.
   - Surface server validation errors without client-side fallback writes to Pi settings.
   - Treat `globalDefaultProfileRef` as server-owned state.

2. Add `useSessionProfile`.
   - For new sessions, initialize from the server global default plus an optional validated last-used ref displayed as an explicit selection.
   - Preserve a distinct “no explicit profile selected” state so the server can apply the global default.
   - For existing sessions, load `/api/sessions/:id/profile` and display the saved effective snapshot, including legacy compatibility labels when returned by the server.
   - Apply profile changes only through `POST /api/sessions/:id/profile`; keep the previous snapshot selected until the server returns a new snapshot.
   - On `409`, expose the message: “Wait for the current response to finish before switching profiles.”
   - Accept the `profileSnapshot` returned from `/api/agent/new` so the UI reflects the persisted session state immediately after creation.
   - Ensure new-session requests built by the UI cannot include stale legacy `toolNames`, whether or not an explicit `profileRef` is sent. Tools must be derived from the server-built snapshot.

3. Wire new-session and existing-session data flow.
   - Pass explicit selected `profileRef` into `/api/agent/new { cwd, profileRef }` when the user has chosen one.
   - Stop treating `toolNames` as the profile UI contract; the profile-controlled request path must omit legacy tool override values and ignore old tool selector state.
   - Remove the old editable tool preset selector from profile-controlled session creation, or replace it with a read-only display of snapshot/runtime tool metadata.
   - On existing-session mount/remount, load the saved snapshot through `useSessionProfile`.
   - After an idle switch succeeds, do not rely on an optimistic local swap alone. Invalidate/refetch the session profile endpoint, reconcile or remount `useAgentSession` as required by the phase 06 runtime handoff, and refresh tool metadata such as `get_tools` so existing controls reflect the new runtime.
   - If post-switch reconciliation/refetch fails, keep the prior visible state or refetch the current server state before showing an error; do not display a snapshot/tools combination that has not been confirmed by the server/runtime.

4. Add `ProfileSelector` in `ChatInput`.
   - Display the effective profile name for existing sessions and the selected/default profile for new sessions.
   - Disable selection while `agentRunning` or a profile apply request is in flight.
   - Provide entry points to choose another profile and open the manager modal.
   - Show a compact warning/conflict indicator from snapshot diagnostics/conflicts; defer detailed display polish to phase 08.
   - If tool information remains visible near the selector, render it as profile-derived read-only metadata, not as an independent tool override control.

5. Add `ProfileManagerModal` and `ProfileWizard`.
   - Keep draft editing in a local reducer until save/apply.
   - Implement the required wizard order exactly: profile creation → base tool preset → plugin on/off → skill on/off narrowing → effective preview.
   - Use `/api/profiles/preview` for effective preview of saved refs or unsaved drafts; do not resolve packages, tools, or skill narrowing in the browser.
   - Add a server-backed “Set as global default” action for saved editable profiles, using `PATCH /api/profiles/default`, and refresh from the server response.
   - Do not add project default controls, even disabled controls, in v1.
   - When plugin on/off selections change, clear or reconcile downstream skill narrowing and invalidate stale preview results through the server preview flow. Skill refs/filters for removed plugins must not be silently saved.
   - Allow drafts with preview warnings where the server permits saving, and block only when the server returns blocking validation errors.

6. Handle empty, error, and compatibility states.
   - Display missing/invalid profile and missing global default errors from server responses.
   - For legacy sessions without snapshots, display the server-provided compatibility state rather than inventing a mutable profile ref.
   - Keep current selection visible and unchanged on apply failures.

## Acceptance criteria

- `useProfiles` and `useSessionProfile` are the only new profile state hooks; no Redux/Zustand-style global store is introduced.
- The selector is visible near existing model/tool/thinking controls and shows the effective profile name.
- The manager exposes a server-backed set-global-default action through `PATCH /api/profiles/default`; no browser/project default source is introduced.
- The old tool preset/tool selection control is removed from profile-controlled capability selection or rendered read-only from snapshot/runtime metadata.
- New sessions use `profileRef` as the profile input when explicitly selected, otherwise rely on the server global default.
- No UI path sends stale `toolNames` alongside `profileRef` or uses legacy tool state to override the server-built profile snapshot.
- Existing sessions display their saved effective snapshot, not the latest mutable profile definition.
- Profile switching is disabled while the agent is running, and a server `409` produces the required retry-after-current-response message with no local snapshot swap.
- Successful idle switches update visible profile/tool/runtime state only after the server responds, then refetch or reconcile session profile, agent state, and tool metadata.
- If post-switch reconciliation fails, the UI keeps the previous confirmed state or refetches the current server state instead of showing unconfirmed mixed capabilities.
- The manager/wizard can create/edit/delete profiles, set the global default, and preview through server APIs without mutating `~/.pi/agent/settings.json`.
- Wizard steps appear in the required order and keep unsaved draft state local.
- Plugin selection changes invalidate or reconcile downstream skill narrowing and preview state so removed-plugin skill refs are not saved accidentally.
- Conflict/diagnostic presence is visible at selector level and is driven only by snapshot/preview API data; richer diagnostic presentation is handed to phase 08.
- No project default profile UI or storage behavior is added in v1.
- No client-local global default behavior is added; last-used `localStorage` selection remains only an explicit, validated new-session convenience.

Stop/go gate: proceed only when the UI can create a session, restore a session, complete an idle profile switch, and set the global default using server APIs as the source of truth, with running-session switches safely rejected and no legacy tool override path remaining.

## Tests/validation

- Hook tests with mocked APIs:
  - `useProfiles` loads defaults/profiles, refreshes after CRUD, updates global default through the server API, and surfaces validation errors.
  - `useSessionProfile` preserves “no explicit profile” vs explicit selection for new sessions.
  - new-session request construction omits `toolNames` and ignores stale legacy tool selector state, including when an explicit `profileRef` is present.
  - returned `profileSnapshot` from `/api/agent/new` replaces pre-create selection display.
  - existing sessions display the saved snapshot and do not follow later profile-definition edits.
  - `409` switch failures keep the previous snapshot and expose the required message.
  - successful idle switches wait for the POST response, then invalidate/refetch session profile state and refresh/remount agent/tool metadata.
  - reconciliation/refetch failures after a switch do not leave the UI showing unconfirmed mixed old/new capabilities.
  - last-used `localStorage` refs are ignored when not present in `/api/profiles` and never become a default profile source.
- Component tests:
  - `ProfileSelector` renders near the existing controls, disables while `agentRunning`, and shows warning/conflict state.
  - any remaining tool display is read-only and snapshot/runtime-derived; it cannot change new-session or existing-session capabilities.
  - manager/wizard follows the five required steps and keeps draft edits local until save.
  - manager can mark a saved profile as the server-owned global default and reflects the server response.
  - plugin on/off changes clear or reconcile downstream skill selections and invalidate preview results before save.
  - preview calls `/api/profiles/preview` for drafts and saved refs.
- Regression checks:
  - no UI path writes Pi `settings.json` or project default profile refs.
  - no prompt/theme/resource-bundle profile controls are introduced.
  - no client-side package/resource resolver duplicates the server preview resolver.
  - no request path can combine a profile-derived snapshot with client-selected legacy `toolNames`.
- Run project validation:
  - `./node_modules/.bin/tsc --noEmit`
  - `npm run lint`
  - `node --test lib/*.test.mjs`
  - `git diff --check`
  - `git diff --cached --check`

## Drift guardrails

- Do not add prompt, theme, or general resource-bundle profile behavior; this UI is for session capabilities only.
- Do not add project default profile behavior in v1, even as disabled UI.
- Do not mutate or offer to mutate `~/.pi/agent/settings.json` when selecting, applying, saving, or setting a profile as global default.
- Do not treat browser state, `localStorage`, or a current profile ref as authoritative for existing-session restore; display the saved snapshot returned by the server.
- Do not leave an editable legacy tool selector that can send `toolNames` or otherwise override profile-derived tools.
- Do not optimistically display a switched profile as effective until the server apply call succeeds and required profile/runtime/tool reconciliation has completed or been safely refetched.
- Do not save stale skill narrowing from plugins that are no longer selected; reconcile draft dependencies through preview/server data.
- Do not use UI filtering to pretend a plugin is disabled. Package/resource selection is owned by earlier server/runtime phases before resource loading.
- Do not redefine schema, snapshot persistence, preview generation, settings integration, or runtime switching semantics in this document or phase.
- Any profile conflict or diagnostic shown here must come from the snapshot/preview APIs; detailed diagnostics presentation belongs to phase 08.
- Do not invent client-side legacy profile refs if the server legacy response is unavailable; render only server-provided compatibility state.

## Dependencies

- Phase 01 provides profile schema/types and `/api/profiles` CRUD/default behavior.
- Phase 02 provides `/api/profiles/preview` and core preview diagnostics/conflict data.
- Phase 03 provides session profile snapshot storage and `GET /api/sessions/:id/profile` response semantics.
- Phase 05 provides `/api/agent/new { cwd, profileRef }` and returned `profileSnapshot` for new sessions.
- Phase 06 provides idle existing-session switch/reload behavior and `409` rejection for running sessions.
- Phase 08 owns detailed conflict/diagnostic display polish beyond the compact selector indicator.
- Phase 09 owns bootstrap and legacy compatibility behavior; this phase only renders the server-provided legacy state.
