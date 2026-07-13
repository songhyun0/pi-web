# StyleSeed — Design Lock

<!-- Locked design decisions. Read this before every UI change and keep token changes synchronized with styleseed/tokens.json and app/design-tokens.css. -->

Implementation-specific UI polish decisions are locked in [`docs/ui-polish-decisions.md`](docs/ui-polish-decisions.md). When the two documents overlap, that decision record supplies the more specific component and responsive contract.

- App domain: Productivity workspace + developer tools; AI/chat is secondary
- Surface: Responsive web/PWA (desktop, compact/tablet, phone)
- Skin: Calm monochrome SaaS—Toss-like clarity without decorative color
- Key color (accent): Neutral ink (`#27272A` light / `#F4F4F5` dark); semantic hues only for genuine success, warning, and error
- Radius personality: Restrained soft (12px surfaces, 8px controls, 16px dialogs; pills only for compact status badges)
- Motion seed: Quiet Snap (`80ms / 140ms / 200ms`, no bounce and no delayed content)
- Type: Geist Sans for UI; Noto Sans Mono for code, paths, IDs, and tabular data
- Density: Compact technical workspace density—56px mobile headers, 44px utility rows and touch targets, 48px primary list rows
- Theme: First visit follows the OS; light and dark have equal structural parity and explicit user choice persists
- Elevation: Whitespace and tonal surfaces first; hairlines only where structure needs them; neutral layered shadows only on floating UI
- Spacing: `8px` base grid with `4px` half-step only for compact icon/text relationships
- Icon language: One outline family, `currentColor`, consistent optical weight; no emoji UI icons
- Locked: 2026-07-11

## Product hierarchy

1. The conversation is the focal surface.
2. Projects, sessions, files, changes, and terminal are workspace navigation—not competing focal points.
3. Configuration remains in focused, independent modules with one shared visual and interaction language.
4. Normal and active states remain monochrome; semantic colors are reserved for genuine success, warning, and error conditions.
5. The default surface is open and flat. Use whitespace or a single divider before adding a container; never nest cards for metadata or controls.

## Responsive contract

- Phone: chat-first navigation stack; Sessions/Explorer and Inspector are pushed full-screen layers.
- Compact/tablet: preserve context with one primary surface and one optional supporting layer.
- Desktop: resizable sidebar + conversation + optional inspector.
- Complex settings use full-screen mobile surfaces; short confirmations and pickers may use bottom sheets.
- Settings use category navigation plus one content surface on desktop. On phone, categories move to a top-level selector and settings become full-width divider rows.
- Mobile workspace list/detail flows use drill-down navigation with visible Back and browser/system-back parity.
- Safe areas, `visualViewport`, virtual keyboards, and `44px` touch targets are required—not polish.

## Settings contract

- Keep Models, Skills, Plugins, Runtime/App, Profiles, Trust, and Hotkeys as focused modules under one shared category navigation.
- Each category owns one open content surface. Group headings and whitespace establish hierarchy; individual settings are full-width rows separated by hairlines, not cards.
- Scope-aware modules use one sticky `Global / Project` switch and expose effective value, inheritance source, and override state without a nested metadata box.
- Reversible toggles/actions save immediately with clear feedback and Undo where practical.
- Complex forms use dirty state and a persistent Save action; destructive and trust actions require confirmation.
- On phone, remove outer borders, radii, and horizontal card margins so list rows use the viewport safely with `16px` content gutters.

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

- Previous technical StyleSeed redesign is preserved at baseline commit `ef7ce8b` (2026-07-11).
- Calm monochrome redesign: StyleSeed source score `93/100` (2026-07-11).
- Rendered gate passed in Chromium at `1440×900`, `768×1024`, and `390×844` in light and dark themes. Verified workspace empty/session states, the single-surface composer, collapsed/expanded process groups, settings category navigation, mobile full-width settings rows, and zero horizontal page overflow.
- Hands-on iOS Safari/PWA and Android Chrome checks remain a release-environment gate; Chromium device emulation does not replace physical-device validation.
