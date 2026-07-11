# StyleSeed — Design Lock

<!-- Locked design decisions. Read this before every UI change and keep token changes synchronized with styleseed/tokens.json and app/design-tokens.css. -->

- App domain: Developer tools + productivity workspace; AI/chat is secondary
- Surface: Responsive web/PWA (desktop, compact/tablet, phone)
- Skin: Technical
- Key color (accent): `#23454B` in light mode; accessible derived teal in dark mode
- Radius personality: Precision (`4px / 6px / 8px`; pills only for compact status badges)
- Motion seed: Snap (`60ms / 100ms / 180ms`, no bounce)
- Type: Geist Sans for UI; Noto Sans Mono for code, paths, IDs, and tabular data
- Density: Dense on pointer-first desktop; comfortable with `44px` minimum targets on touch
- Theme: Dark-leading visual language with complete light parity; first visit follows the OS and explicit user choice persists
- Elevation: Tonal surfaces + hairlines; restrained tinted shadows in light mode, tonal elevation in dark mode
- Spacing: `8px` base grid with `4px` half-step only for compact icon/text relationships
- Icon language: One outline family, `currentColor`, consistent optical weight; no emoji UI icons
- Locked: 2026-07-10

## Product hierarchy

1. The conversation is the focal surface.
2. Projects, sessions, files, changes, and terminal are workspace navigation—not competing focal points.
3. Configuration remains in focused, independent modules with one shared visual and interaction language.
4. Normal states are neutral. Accent marks active/running/primary states; semantic colors are reserved for genuine success, warning, and error conditions.

## Responsive contract

- Phone: chat-first navigation stack; Sessions/Explorer and Inspector are pushed full-screen layers.
- Compact/tablet: preserve context with one primary surface and one optional supporting layer.
- Desktop: resizable sidebar + conversation + optional inspector.
- Complex settings use full-screen mobile surfaces; short confirmations and pickers may use bottom sheets.
- Mobile list/detail flows use drill-down navigation with visible Back and browser/system-back parity.
- Safe areas, `visualViewport`, virtual keyboards, and `44px` touch targets are required—not polish.

## Settings contract

- Keep Models, Skills, Plugins, Runtime/App, Profiles, Trust, and Hotkeys as focused modules.
- Scope-aware modules use one sticky `Global / Project` switch and expose effective value, inheritance source, and override state.
- Reversible toggles/actions save immediately with clear feedback and Undo where practical.
- Complex forms use dirty state and a persistent Save action; destructive and trust actions require confirmation.

## Mobile workspace contract

- Top bar exposes Sessions, current session/status, and Inspector; secondary actions live in a More sheet.
- Composer always exposes attachment, current model, and Send/Stop. Remaining run options live in a bottom sheet.
- Mobile Sessions use `Project → Session` drill-down; Sessions and Explorer are top-level modes.
- Mobile Inspector preserves `Changes / Preview / Terminal` tabs.
- File Preview shows one current file; switching and closing open files happens in a sheet.
- Message actions must never be hover-only.

## Quality gates

- Read real files and rendered output; never invent a score.
- Substantially changed UI must pass `/ss-score` at `>= 80` before presentation.
- Run `/ss-verify` after the code gate whenever a renderable browser surface is available.
- Manually verify light/dark at desktop, compact/tablet, iOS Safari/PWA, and Android Chrome sizes.
- Render and inspect happy, loading, empty, error, disabled, dirty, and destructive-confirmation states.

## Migration status

- Foundation and primitives: StyleSeed source score `91/100` (2026-07-10).
- Responsive `SettingsModal`: StyleSeed source score `95/100` (2026-07-10). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including loading, error, project-blocked, inline feedback/Undo, dirty, and discard-confirmation states.
- Responsive `ModelsConfig`: StyleSeed source score `96/100` (2026-07-10). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including provider/model editors, add-provider search, loading, empty, error, model-test feedback, dirty authentication, browser-back handling, and destructive confirmation states.
- Responsive `PluginsConfig`: StyleSeed source score `96/100` (2026-07-10). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including inventory/detail navigation, installation, loading, empty, error, diagnostics, working, inline feedback/Undo, dirty browser-back handling, and destructive confirmation states.
- Responsive `SkillsConfig`: StyleSeed source score `96/100` (2026-07-10). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including loaded-skill filtering, registry search/install, loading, empty, error, diagnostics, working, inline feedback/Undo, install failure, and browser-back handling.
- Responsive Profiles UI (`ProfileManagerModal`, `ProfileWizard`, and `ProfileSelector`): StyleSeed source score `97/100` (2026-07-10). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including inventory/detail navigation, the five-step capability wizard, effective preview, loading, empty, error, setup warnings, diagnostics, inline feedback/Undo, dirty browser-back handling, and destructive confirmation states.
- Responsive `ProjectTrustModal`: StyleSeed source score `97/100` (2026-07-10). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including decision-required, trusted, denied, inherited, no-resource, loading, error, confirmation-impact, and saved-decision states.
- Responsive `HotkeysModal`: StyleSeed source score `97/100` (2026-07-10). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including grouped registry, search, status filters, customized/conflict/unbound shortcuts, loading, empty, and fallback-on-error states.
- Responsive workspace shell (`AppShell`, `SessionSidebar`, `FileExplorer`, and `TabBar`): StyleSeed source score `96/100` (2026-07-11). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including desktop resizing, compact overlays, phone project drill-down, Sessions/Explorer switching, worktree controls, session actions and destructive confirmation, file actions, Inspector/More layers, loading, empty, server-error, Escape, focus/inert behavior, and browser Back/Forward state composition.
- Responsive Chat/Composer (`ChatWindow`, `ChatInput`, `MessageView`, `ChatMinimap`, and `BranchNavigator`): StyleSeed source score `96/100` (2026-07-11). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including transcript-first user/assistant turns, collapsed and expanded thinking/tool process stacks, long Markdown, streaming Steer/Follow-up/Stop controls, queued messages, retry feedback, attachments, slash/model menus, Prompt Editor focus, loading, empty, recoverable error, and no-horizontal-overflow states.
- Responsive Inspector internals (`GitChangesPanel`, `FileViewer`, `TerminalPanel`, `TabBar`, and `InspectorFileSheet`): StyleSeed source score `98/100` (2026-07-11). Visual gate passed at `1440×900`, `768×1024`, and `390×844` in light and dark themes, including Git list/detail and long diffs, file source/Markdown/image previews, live SSE revision diffs, open-file switching/closing with browser Back/Forward restoration, loading, empty, oversized-file and server-error recovery, terminal loading/empty/service-error states, and kill/restart confirmations. No horizontal overflow or unexpected runtime errors were observed.
- Release gate still requires hands-on iOS Safari/PWA and Android Chrome checks; Chromium device emulation does not replace physical-device validation.
