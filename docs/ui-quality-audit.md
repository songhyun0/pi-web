# UI Quality Audit

## Inventory scope

This document preserves the complete supplied 29-item UI quality inventory from initial review through implementation and post-fix verification. The original issue statements remain as the audit baseline. The independent verification register records the initial verdicts, and the finalization record at the end is authoritative for implementation and post-fix status.

This Finalize phase changes documentation only. Application-source changes referenced below were produced in earlier implementation phases and were not modified while finalizing this record.

## Status conventions

- **Baseline fields:** Original `Untriaged`, `Pending verification`, and `Not started` fields are retained verbatim for traceability and are superseded by the independent verification register and finalization record.
- **Initial verdict:** Confirmed, Partial (materially narrowed), Rejected, or Deferred after review synthesis.
- **Implementation status:** Implemented, skipped by disposition, or not assigned.
- **Post-fix status:** Pass, Partial, Fail, or Not run. A failing repository gate prevents an overall pass even when the issue's rendered behavior passes.
- **External gate:** Physical iOS Safari/PWA and Android Chrome checks remain release-environment validation where explicitly listed.

---

## I01 — Workspace actions content has no vertical inset

### Scope

Mobile workspace actions sheet spacing, including its body boundaries and shared sheet primitives.

### Severity

Untriaged — pending verification.

### Claim

The Current workspace section is flush against the sheet header and the last content is flush to the bottom because the body/content lacks vertical padding.

### Suspected files

- `components/app-shell/MobileMoreSheet.module.css`
- `components/app-shell/MobileMoreSheet.tsx`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- The Current workspace section has intentional vertical separation from the sheet header.
- The final content row has intentional bottom spacing, including applicable safe-area space.
- Spacing follows the StyleSeed 8px grid and remains consistent in light and dark themes.

### Implementation status

Not started.

### Post-fix validation

Not run. Validate the mobile More sheet at phone widths, with and without a bottom safe-area inset.

---

## I02 — Mobile profile menu reflows the run-controls sheet

### Scope

Profile selection inside the mobile run-controls sheet.

### Severity

Untriaged — pending verification.

### Claim

ProfileSelector changes its menu to position:static on mobile, inserting the menu into layout and expanding the parent sheet.

### Suspected files

- `components/ProfileSelector.module.css`
- `components/ProfileSelector.tsx`
- `components/ChatInput.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Opening the profile selector does not unexpectedly resize or reflow the run-controls sheet.
- The profile menu remains fully reachable within the mobile viewport and safe areas.
- Opening and closing the menu preserves the surrounding run-control layout.

### Implementation status

Not started.

### Post-fix validation

Not run. Compare closed and open states at representative iOS and Android phone sizes.

---

## I03 — Run controls contains nested scrolling regions

### Scope

Scroll ownership within the mobile run-controls dialog and profile menu.

### Severity

Untriaged — pending verification.

### Claim

The Dialog body scrolls while the inline mobile profile menu also scrolls, producing nested scroll capture on mobile.

### Suspected files

- `components/ProfileSelector.module.css`
- `components/ChatInput.module.css`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- The run-controls experience has one predictable primary vertical scroll region.
- Profile options remain reachable without nested scroll trapping or gesture capture.
- Scroll behavior remains usable with touch, a virtual keyboard, and viewport resizing.

### Implementation status

Not started.

### Post-fix validation

Not run. Test touch scrolling from the first through the last option on iOS Safari/PWA and Android Chrome.

---

## I04 — Dialogs focus the first control unconditionally

### Scope

Initial focus behavior in the shared Dialog component.

### Severity

Untriaged — pending verification.

### Claim

Shared Dialog programmatically focuses the first body control, causing unwanted focus chrome, scrolling, or keyboard activation on open.

### Suspected files

- `components/ui/Dialog.tsx`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- Dialogs apply an intentional initial-focus policy appropriate to pointer, touch, and keyboard activation.
- Opening a dialog does not unexpectedly scroll content or summon the virtual keyboard.
- Keyboard users retain a visible, predictable focus location and complete focus containment.

### Implementation status

Not started.

### Post-fix validation

Not run. Open representative dialogs by keyboard, mouse, and touch and verify focus, scroll position, keyboard behavior, and focus restoration.

---

## I05 — Panel resizing is disabled at 1024px and below

### Scope

Sidebar and inspector resizing across desktop, compact/tablet, and phone viewport tiers.

### Severity

Untriaged — pending verification.

### Claim

Both runtime guards and CSS hide/disable sidebar and inspector resizing whenever viewport tier is compact or phone.

### Suspected files

- `components/AppShell.tsx`
- `components/AppShell.module.css`
- `hooks/useViewportTier.ts`

### Verification status

Pending verification.

### Acceptance criteria

- Resizing availability follows the responsive shell contract rather than an unexplained hard cutoff.
- Any compact layout that presents adjacent panels provides an appropriate resizing or sizing strategy.
- Phone push-layer behavior remains intentional and does not expose unusable resize controls.

### Implementation status

Not started.

### Post-fix validation

Not run. Exercise panel sizing immediately above, at, and below 1024px with mouse, trackpad, and coarse-pointer input.

---

## I06 — Resize handles are undiscoverable and too narrow

### Scope

Desktop sidebar and inspector resize-handle visibility, hit area, and pointer affordance.

### Severity

Untriaged — pending verification.

### Claim

Desktop resize handles are transparent 8px targets visible only while hovered or active, with poor coarse-pointer discoverability.

### Suspected files

- `components/AppShell.module.css`
- `components/AppShell.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Resize boundaries are discoverable before active dragging without adding excessive visual noise.
- Pointer hit areas are reliably usable and coarse-pointer treatment follows the 44px touch-target contract where applicable.
- Hover, focus-visible, active, and disabled states communicate resizing consistently.

### Implementation status

Not started.

### Post-fix validation

Not run. Test discovery and dragging with mouse, trackpad, keyboard if supported, and a coarse pointer.

---

## I07 — Side panels can starve the center workspace

### Scope

Three-column shell sizing constraints and minimum conversation workspace width.

### Severity

Untriaged — pending verification.

### Claim

Sidebar and inspector width limits are independent and do not reserve a minimum center width.

### Suspected files

- `components/AppShell.tsx`
- `components/AppShell.module.css`

### Verification status

Pending verification.

### Acceptance criteria

- Combined side-panel widths preserve a defined usable minimum width for the center workspace.
- Dragging either panel cannot collapse the conversation surface below that minimum.
- Constraints remain stable when panels open, close, or the viewport resizes.

### Implementation status

Not started.

### Post-fix validation

Not run. Maximize both side panels across supported desktop widths and confirm center content remains usable without horizontal overflow.

---

## I08 — Opening side panels clips desktop top-bar controls

### Scope

Desktop top-bar adaptation when the conversation container narrows.

### Severity

Untriaged — pending verification.

### Claim

The desktop toolbar does not adapt to its actual container width and topBar overflow:hidden clips controls when the center narrows.

### Suspected files

- `components/AppShell.tsx`
- `components/AppShell.module.css`

### Verification status

Pending verification.

### Acceptance criteria

- Required top-bar controls remain visible and operable as the center container narrows.
- Secondary controls adapt, collapse, or move intentionally instead of being clipped.
- The top bar does not introduce unintended horizontal page overflow.

### Implementation status

Not started.

### Post-fix validation

Not run. Open both panels, drag through their width ranges, and inspect all toolbar states at supported desktop widths.

---

## I09 — Responsive shell uses viewport instead of container width

### Scope

Responsive chrome selection for a center workspace narrowed by adjacent panels.

### Severity

Untriaged — pending verification.

### Claim

Desktop/compact chrome selection depends only on viewport width, so a narrow center remains in desktop mode after panels open.

### Suspected files

- `components/AppShell.tsx`
- `components/AppShell.module.css`
- `hooks/useViewportTier.ts`

### Verification status

Pending verification.

### Acceptance criteria

- Center chrome adapts to the space actually available to it, including panel-induced narrowing.
- Transitions between desktop and compact presentations are deterministic and do not oscillate.
- Viewport-tier behavior that governs full-screen phone layers remains intact.

### Implementation status

Not started.

### Post-fix validation

Not run. Resize the viewport and both panels around each responsive threshold while monitoring chrome mode and layout stability.

---

## I10 — Mobile current-session title is not viewport centered

### Scope

Horizontal alignment of the mobile top-bar session title.

### Severity

Untriaged — pending verification.

### Claim

One 64px control on the left and two 64px controls on the right shift the flexible center title left.

### Suspected files

- `components/AppShell.tsx`
- `components/AppShell.module.css`

### Verification status

Pending verification.

### Acceptance criteria

- The current-session title is optically centered relative to the safe-area content box (and therefore the physical viewport when inline safe-area insets are symmetric).
- With asymmetric inline safe-area insets, centering intentionally follows the usable safe-area content box rather than the physical viewport.
- Left and right controls remain reachable without overlapping the title.
- Long titles truncate predictably while preserving the centered composition.

### Implementation status

Not started.

### Post-fix validation

Not run. Inspect short and long titles at narrow and wide phone widths in both text directions if supported.

---

## I11 — Mobile empty state is bottom and left biased

### Scope

Mobile conversation empty-state positioning and alignment.

### Severity

Untriaged — pending verification.

### Claim

Mobile empty state uses align-items:end and its single brand item remains left aligned instead of visually centered.

### Suspected files

- `components/ChatWindow.module.css`
- `components/ChatWindow.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- The empty state is visually balanced within the available mobile conversation area.
- Single-item branding and supporting content use intentional horizontal alignment.
- Positioning remains correct with safe areas, the composer, and virtual-keyboard viewport changes.

### Implementation status

Not started.

### Post-fix validation

Not run. Inspect empty states at representative phone sizes in portrait, landscape, light, and dark themes.

---

## I12 — Hover and focus-within override selected session styling

### Scope

Selected, hover, and focus-within state hierarchy for session rows.

### Severity

Untriaged — pending verification.

### Claim

Session selected background is declared before later hover/focus-within rules, so interaction can replace the selected appearance.

### Suspected files

- `components/SessionSidebar.module.css`
- `components/SessionSidebar.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- A selected session remains clearly identifiable while hovered or containing focus.
- Hover and focus-visible feedback supplements rather than replaces selection.
- State combinations are legible in light and dark themes without relying on semantic color.

### Implementation status

Not started.

### Post-fix validation

Not run. Check selected rows under idle, hover, keyboard focus, child-control focus, and touch interaction.

---

## I13 — Run controls exposes an unlabeled N/A action

### Scope

Unavailable OpenAI Fast state in compact run controls.

### Severity

Untriaged — pending verification.

### Claim

The compact OpenAI Fast control can render only N/A without identifying what is unavailable.

### Suspected files

- `components/ChatInput.tsx`
- `components/ChatInput.module.css`

### Verification status

Pending verification.

### Acceptance criteria

- The unavailable state identifies the feature it applies to.
- The control communicates why it is unavailable or provides an accessible explanation when appropriate.
- The row cannot be mistaken for an active, unlabeled action.

### Implementation status

Not started.

### Post-fix validation

Not run. Test supported, unsupported, enabled, disabled, and unavailable model/provider combinations with a screen reader and visually.

---

## I14 — Execution rows lack control affordance

### Scope

Visual and semantic affordances for prompt editor, compaction, fast mode, and sound rows.

### Severity

Untriaged — pending verification.

### Claim

Prompt editor, compaction, fast mode, and sound appear as visually similar plain text rows despite different action/toggle semantics.

### Suspected files

- `components/ChatInput.tsx`
- `components/ChatInput.module.css`

### Verification status

Pending verification.

### Acceptance criteria

- Action, toggle, and status rows are visually and semantically distinguishable.
- Interactive targets expose clear hover, focus-visible, pressed/selected, disabled, and unavailable states as applicable.
- Touch targets meet the mobile 44px minimum without making pointer-first desktop globally oversized.

### Implementation status

Not started.

### Post-fix validation

Not run. Review every execution row by mouse, keyboard, touch, and screen reader in all supported states.

---

## I15 — Native select styling is inconsistent on mobile

### Scope

Shared Select appearance and interaction across mobile browsers.

### Severity

Untriaged — pending verification.

### Claim

The shared Select leaves platform appearance unmanaged, producing browser-specific arrows and focus chrome inconsistent with the design system.

### Suspected files

- `components/ui/Field.tsx`
- `components/ui/primitives.css`
- `components/ChatInput.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Shared selects have a consistent control boundary, indicator, spacing, and focus-visible treatment.
- Native behavior and accessibility remain intact on iOS Safari and Android Chrome.
- Disabled, invalid, open, and selected states align with the shared control language.

### Implementation status

Not started.

### Post-fix validation

Not run. Compare selects on Chromium desktop, iOS Safari/PWA, and Android Chrome in light and dark themes.

---

## I16 — Profile selector is too verbose for quick run controls

### Scope

Information density and hierarchy of the profile selector embedded in quick run controls.

### Severity

Untriaged — pending verification.

### Claim

The opened selector duplicates headings and exposes fallback/default/diagnostic/management details that overwhelm the quick settings sheet.

### Suspected files

- `components/ProfileSelector.tsx`
- `components/ProfileSelector.module.css`
- `components/ChatInput.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Quick run controls prioritize profile selection and essential context.
- Diagnostic and management details are removed, progressively disclosed, or moved to an appropriate focused module.
- Users can still identify the active profile, fallback behavior when essential, and a clear route to profile management.

### Implementation status

Not started.

### Post-fix validation

Not run. Conduct a content and interaction review for default, custom, missing, fallback, and error profile states on phone and desktop.

---

## I17 — Focus, selected, and open indicators collide

### Scope

Cross-component interaction-state hierarchy throughout shared and feature-specific UI.

### Severity

Untriaged — pending verification.

### Claim

Several components stack selected/open backgrounds with strong outlines or multiple indicators rather than one coherent interaction-state hierarchy.

### Suspected files

- `components`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- Focus-visible, selected, open, active, and hover states follow one documented visual hierarchy.
- Combined states remain identifiable without redundant rings, accents, and backgrounds.
- Keyboard focus remains WCAG-compliant and clearly visible in light and dark themes.

### Implementation status

Not started.

### Post-fix validation

Not run. Inventory representative controls and inspect all meaningful state combinations with keyboard and pointer input.

---

## I18 — Composer focus highlights the entire floating surface

### Scope

Focus treatment of the conversation composer surface.

### Severity

Untriaged — pending verification.

### Claim

composerSurface:focus-within adds a large halo around the full composer for the entire editing session.

### Suspected files

- `components/ChatInput.module.css`
- `components/ChatInput.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Keyboard users receive a clear focus-visible cue for the active composer control.
- Routine text editing does not keep an unnecessarily dominant halo around the entire composer.
- Focus treatment remains distinguishable from error, drag/drop, recording, or running states.

### Implementation status

Not started.

### Post-fix validation

Not run. Tab into and through the composer, click/tap into the editor, and inspect focus throughout a normal editing session.

---

## I19 — Branch navigator uses focus instead of focus-visible

### Scope

Focus styling for branch navigator search and filter controls.

### Severity

Untriaged — pending verification.

### Claim

Search and filter controls show keyboard-style focus treatment after mouse/touch interaction because plain :focus is used.

### Suspected files

- `components/BranchNavigator.module.css`
- `components/BranchNavigator.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Keyboard navigation produces a clear focus-visible indicator.
- Mouse and touch activation do not retain keyboard-only focus chrome unless required by the platform.
- Focus remains perceivable in forced-colors and light/dark themes.

### Implementation status

Not started.

### Post-fix validation

Not run. Compare tab, Shift+Tab, mouse click, and touch activation across search and filter controls.

---

## I20 — Hover states are not gated for hover-capable pointers

### Scope

Hover styling across components and shared primitives, especially on coarse/touch browsers.

### Severity

Untriaged — pending verification.

### Claim

Broad hover rules can become sticky on coarse/touch browsers and visually masquerade as selection.

### Suspected files

- `components`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- Decorative hover feedback is gated to hover-capable pointers where appropriate.
- Touch interaction does not leave controls looking selected or open after activation.
- Essential feedback remains available through active, selected, focus-visible, and semantic states.

### Implementation status

Not started.

### Post-fix validation

Not run. Test representative interactive components on mouse, hybrid, and touch-only devices, including post-tap state persistence.

---

## I21 — Opening workspace layers forces focus into header controls

### Scope

Initial focus and focus restoration for sidebar and inspector workspace layers.

### Severity

Untriaged — pending verification.

### Claim

AppShell programmatically focuses close/back controls when sidebar or inspector opens, immediately displaying intrusive focus state on some browsers.

### Suspected files

- `components/AppShell.tsx`
- `components/AppShell.module.css`
- `components/SessionSidebar.module.css`

### Verification status

Pending verification.

### Acceptance criteria

- Opening a workspace layer establishes accessible focus without intrusive pointer/touch-only focus chrome.
- Keyboard users can immediately navigate or close the layer and cannot tab behind a modal layer.
- Closing a layer restores focus to the invoking control when it still exists.

### Implementation status

Not started.

### Post-fix validation

Not run. Open and close Sessions and Inspector by keyboard, mouse, touch, and browser/system back on compact and phone layouts.

---

## I22 — Footerless mobile sheets lack bottom safe-area content padding

### Scope

Bottom spacing for mobile sheet dialogs that do not render a footer.

### Severity

Untriaged — pending verification.

### Claim

Sheet dialogs without footers can place their final body row too close to the home/browser area.

### Suspected files

- `components/ui/primitives.css`
- `components/ChatInput.tsx`
- `components/app-shell/MobileMoreSheet.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Footerless sheet bodies include sufficient bottom content padding plus the applicable safe-area inset.
- The final row remains fully visible, reachable, and tappable above browser/system UI.
- Sheets with footers do not receive duplicated or excessive bottom spacing.

### Implementation status

Not started.

### Post-fix validation

Not run. Inspect footerless and footer-bearing sheets on iOS Safari/PWA and Android Chrome with varied safe-area conditions.

---

## I23 — Compact chrome is larger than desktop chrome

### Scope

Top-bar height and density at desktop-to-compact responsive transitions.

### Severity

Untriaged — pending verification.

### Claim

At the compact breakpoint the top bar grows from 48px to 56px, worsening density as available space shrinks.

### Suspected files

- `components/AppShell.module.css`
- `hooks/useViewportTier.ts`

### Verification status

Pending verification.

### Acceptance criteria

- Compact chrome uses intentional density appropriate to reduced space.
- Required touch targets remain at least 44px without unnecessarily increasing the entire bar.
- Transitioning between desktop and compact tiers does not produce a distracting vertical jump.

### Implementation status

Not started.

### Post-fix validation

Not run. Compare top-bar dimensions and target sizes immediately around the compact breakpoint with fine and coarse pointers.

---

## I24 — Coarse-pointer desktop layouts are globally oversized

### Scope

Coarse-pointer media rules on wide desktop-class and hybrid-device layouts.

### Severity

Untriaged — pending verification.

### Claim

Pointer-coarse media rules force touch dimensions on wide desktop-class layouts and reduce information density.

### Suspected files

- `components`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- Coarse pointers receive usable hit areas without indiscriminately enlarging all wide-layout chrome.
- Pointer-first desktop remains balanced in density, including on hybrid devices reporting coarse input.
- Controls that require 44px touch targets provide them without causing clipping or crowding.

### Implementation status

Not started.

### Post-fix validation

Not run. Compare fine-pointer desktop, touch-enabled laptop, tablet with keyboard/trackpad, and touch-only layouts at wide widths.

---

## I25 — Active tabs use redundant visual indicators

### Scope

TabBar active and focus-visible state hierarchy.

### Severity

Untriaged — pending verification.

### Claim

TabBar combines active background and bottom accent, then adds focus outline for a triple indicator.

### Suspected files

- `components/TabBar.module.css`
- `components/TabBar.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- Active tabs use one coherent primary selected-state treatment.
- Keyboard focus remains independently visible without producing a visually conflicting third indicator.
- Active, inactive, hover, focus-visible, dirty, and close-button states remain distinguishable.

### Implementation status

Not started.

### Post-fix validation

Not run. Inspect every tab state and meaningful state combination in light, dark, and forced-colors modes.

---

## I26 — Directory picker bypasses shared dialog and controls

### Scope

Directory picker modal structure, shared primitive usage, focus management, and mobile control sizing.

### Severity

Untriaged — pending verification.

### Claim

DirectoryPickerModal uses many inline styles, incomplete focus management, and undersized mobile controls instead of shared primitives.

### Suspected files

- `components/DirectoryPickerModal.tsx`
- `components/ui/Dialog.tsx`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- The directory picker uses the shared dialog and control language or an explicitly documented compatible variant.
- Initial focus, focus containment, Escape/close behavior, backdrop behavior, and focus restoration are complete.
- Mobile controls meet the 44px target contract and content respects safe areas and virtual keyboards.

### Implementation status

Not started.

### Post-fix validation

Not run. Test browse, path entry, loading, empty, error, disabled, selection, and cancellation flows by keyboard and touch.

---

## I27 — Session command modals bypass shared dialog and controls

### Scope

Session command modal layout, shared primitive usage, focus behavior, safe areas, and control sizing.

### Severity

Untriaged — pending verification.

### Claim

SessionCommandModals uses an absolute inline-styled modal system without shared safe-area/focus behavior and with small controls.

### Suspected files

- `components/SessionCommandModals.tsx`
- `components/ui/Dialog.tsx`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- Session command modals use shared dialog/control behavior or an explicitly documented compatible variant.
- Focus is initialized, contained, and restored predictably; Escape and cancellation work consistently.
- Content respects safe areas, virtual keyboards, and the 44px mobile target minimum.

### Implementation status

Not started.

### Post-fix validation

Not run. Exercise `/tree`, `/fork`, confirmations, errors, cancellation, and long-content states on desktop and phone with keyboard and touch.

---

## I28 — Extension dialogs bypass shared focus and control styling

### Scope

Extension-hosted dialog structure, autofocus behavior, and replacement focus styling.

### Severity

Untriaged — pending verification.

### Claim

ExtensionUiHost uses a separate inline-styled dialog system, autofocus, and outline:none inputs without coherent replacement focus treatment.

### Suspected files

- `components/ExtensionUiHost.tsx`
- `components/ui/Dialog.tsx`
- `components/ui/primitives.css`

### Verification status

Pending verification.

### Acceptance criteria

- Extension dialogs provide shared or behaviorally equivalent dialog spacing, focus containment, dismissal, and restoration.
- Inputs never suppress the native outline without a clear accessible focus-visible replacement.
- Autofocus does not unexpectedly scroll content or invoke the mobile keyboard when inappropriate.

### Implementation status

Not started.

### Post-fix validation

Not run. Test extension alert, confirm, prompt, select, and custom dialog variants by keyboard, mouse, and touch, including mobile keyboard behavior.

---

## I29 — The application has divergent modal systems

### Scope

Application-wide consistency among shared Dialog, directory picker, session commands, and extension dialogs.

### Severity

Untriaged — pending verification.

### Claim

Shared Dialog, directory picker, session commands, and extension dialogs implement incompatible spacing, focus, safe-area, and tap-target behavior.

### Suspected files

- `components/ui/Dialog.tsx`
- `components/DirectoryPickerModal.tsx`
- `components/SessionCommandModals.tsx`
- `components/ExtensionUiHost.tsx`

### Verification status

Pending verification.

### Acceptance criteria

- All modal systems follow one documented contract for anatomy, spacing, elevation, focus, dismissal, safe areas, scrolling, and tap targets.
- Legitimate variants such as centered dialogs, full-screen mobile surfaces, and bottom sheets share compatible primitives and state behavior.
- Existing modal workflows retain their required functionality and extension compatibility after convergence.

### Implementation status

Not started.

### Post-fix validation

Not run. Run a cross-modal matrix covering desktop, compact, phone, light/dark, keyboard, touch, safe areas, virtual keyboard, loading, error, disabled, destructive, and long-content states.

---

# Independent verification register

## Synthesis

### Disposition

- **Implement — confirmed:** I01, I02, I03, I06, I07, I08, I09, I10, I12, I13, I14, I17, I18, I20, I22, I26, I27, I29.
- **Implement — narrowed:** I04, I15, I16, I23, I24, I25, I28.
- **Rejected:** I05, I19.
- **Deferred:** I11 pending product intent; I21 pending cross-browser input-modality evidence.
- **Total:** 25 implementation findings, 2 rejected findings, and 2 deferred findings. Confirmed IDs remain individually traceable where several share one root cause.

### Primary workstreams and dependencies

1. **Footerless phone-sheet safe areas (I01, I22):** implement one footer-aware safe-area contract; verify MobileMoreSheet and Run controls without double-padding footer-bearing dialogs.
2. **Phone profile-picker flow (I02, I03, I16):** remove the in-flow nested scroller, keep sheet geometry stable with one scroll owner, simplify duplicate hierarchy/copy, preserve inherited/default and recovery semantics, and close Run controls before opening profile management.
3. **Desktop center/panel/chrome constraints (I07, I08, I09):** reserve a usable center minimum, compute side-panel maxima jointly, and adapt center chrome by container width without changing viewport-tier overlay topology. A CSS-only compact-chrome swap is unsafe because More currently depends on overlay mode.
4. **Persistent/hover/focus state hierarchy (I12, I17, I20):** selected/open state must survive hover and focus-within; retain independent focus-visible cues; gate hover-only visuals for non-hover/coarse pointers.
5. **Compact Execution semantics (I13, I14):** preserve native button/ARIA behavior while making feature identity, toggle state, unavailable state, and destructive compaction state visible without color alone.
6. **Modal-platform convergence (I26, I27, I28, I29):** migrate through shared lifecycle or component-specific adapters while preserving directory behavior, session-command keyboard logic, extension flows, topmost ownership, and custom-terminal Tab/Escape semantics.
7. **Targeted fixes (I04, I06, I10, I15, I18, I23, I24, I25):** retain required focus and 44px targets; separate hit area from visual density; keep native select semantics; narrow composer focus scope; and preserve breakpoint synchronization.

### Cross-cutting validation

- Keep the 1024/1025 and 640/641 boundaries synchronized across TypeScript and CSS.
- Test short and keyboard-reduced visual viewports, safe areas, light/dark themes, fine/coarse pointers, and focus restoration.
- Do not remove initial dialog focus, keyboard focus-visible styling, native mobile select pickers, or required 44px targets as shortcuts.
- Avoid double-counting severity: shared architectural causes remain grouped for implementation, but every confirmed ID remains in this register for traceability.

## I01 — Confirmed (0.99)

**Verified finding:** MobileMoreSheet explicitly zeroes body padding. Its content wrapper supplies only inter-section gaps, so Current workspace has no top inset and the footerless sheet has no trailing or bottom-safe-area clearance after Theme.

**Evidence:** `components/app-shell/MobileMoreSheet.module.css` (`.body { padding: 0 }`, no first-section/trailing spacing); `components/app-shell/MobileMoreSheet.tsx` (Current workspace first, Theme last, no footer); `components/ui/primitives.css` and `components/ui/Dialog.tsx` (phone body restores horizontal padding only; safe-area bottom belongs only to a rendered footer); `STYLESEED.md` (8px grid and safe-area contract).

**Verified acceptance criteria:** Add at least 16px token-based top inset; add at least 16px ordinary trailing space plus `--pi-safe-area-bottom` for footerless phone sheets; preserve body scrolling, final-row reachability, horizontal safe-area gutters, 44px targets, and dismissal; avoid double-padding footer-bearing sheets.

## I02 — Confirmed (0.99)

**Verified finding:** At widths ≤640px, ProfileSelector changes its menu from absolute to static. The menu is mounted inside the selector before Execution, so it enters normal flow, grows the bottom sheet, then increases body scroll extent at the panel cap. Scope is phone-only.

**Evidence:** `components/ProfileSelector.module.css` (static phone menu, `max-height: min(52dvh, 440px)`); `components/ProfileSelector.tsx` (non-portaled child); `components/ChatInput.tsx` and `.module.css` (normal-flow placement before Execution); `components/ui/primitives.css` (bottom-aligned capped sheet with scrolling body).

**Verified acceptance criteria:** Opening the selector must not materially change the panel rectangle or move Execution; render options outside normal flow or use a stable replacement view; keep one predictable scroll owner and safe-area clearance; verify 640/641 behavior and preserve anchored behavior above 640px; restore focus without unexpectedly closing/repositioning Run controls.

## I03 — Confirmed (0.98)

**Verified finding:** The phone menu retains independent scrolling and `overscroll-behavior: contain` inside the independently scrolling Dialog body. A long profile list or reduced viewport activates both regions and can trap touch gestures. The defect is conditional but actionable.

**Evidence:** `components/ProfileSelector.module.css` (inner overflow, contained overscroll, 52dvh/440px cap); `components/ui/primitives.css` (viewport-constrained panel and scrolling body); `components/ChatInput.tsx`/`.module.css` (substantial surrounding content); `components/ProfileSelector.tsx` (header, profile rows, optional issues, manager action).

**Verified acceptance criteria:** With a long-profile fixture and short/keyboard-reduced viewport, no more than one vertical scroller may be active; one continuous swipe over a profile row must reach later profiles and Execution; keep all options/actions reachable with safe areas, 44px targets, and no horizontal overflow; preserve desktop/compact popover, keyboard, Escape, and outside-click behavior.

## I04 — Narrowed (0.98)

**Verified finding:** Dialog always moves focus, but not always to the first body control. Target order is explicit ref, broad body query, first panel control (normally Close), then panel. Moving focus inside an aria-modal dialog is required. The defect is an under-specified fallback that does not validate visibility/inertness/actual tabbability and calls `focus()` without `preventScroll`; source does not prove accidental activation, universal scrolling, or universal keyboard opening.

**Evidence:** `components/ui/Dialog.tsx` (target order, broad selector, no target validation or `preventScroll`, Close precedes body/footer); `components/ui/primitives.css` (required focus-visible and constrained scroll body); explicit text/non-text refs in `components/HotkeysModal.tsx`, `components/models-config/AddProviderDialog.tsx`, `components/ChatInput.tsx`, `components/ProjectTrustModal.tsx`, `components/ProfileManagerModal.tsx`, and `components/SkillsConfig.tsx`.

**Verified acceptance criteria:** Define a per-dialog initial-focus policy; validate targets as connected, visible, enabled, non-inert, non-aria-hidden, and tabbable; respect roving tabindex; use safe static/action targets and `preventScroll` where appropriate; require caller opt-in for mobile text-input autofocus; preserve focus-visible, trap, Escape, nested dialogs, and restoration; test invalid refs, no body control, scrolling, hidden/disabled candidates, and nested dialogs.

## I05 — Rejected (0.99)

**Verified finding:** Resizing is intentionally unavailable at and below 1024px because compact/phone use fixed supporting layers rather than desktop columns. The locked responsive contract assigns resizing only to desktop; no narrower defect remains.

**Evidence:** `hooks/useViewportTier.ts` (inclusive tier queries); `components/AppShell.tsx` (overlay guards and absent separators); `components/AppShell.module.css` (fixed/full-width overlays and hidden handles); `STYLESEED.md` (desktop-only resizable columns).

**Verified acceptance criteria:** Leave resizing unavailable in overlay/push tiers; if requirements change, first define adjacent compact geometry, center minimum, bounds, coarse-pointer behavior, and overflow in the responsive contract; keep TypeScript, rendering guards, and CSS aligned at inclusive 1024px.

## I06 — Confirmed (0.99)

**Verified finding:** Desktop resize separators are transparent 8px full-height targets with visual treatment only on hover/active drag. Borders show panel boundaries but not draggability. Wide coarse-pointer devices receive the same target because desktop mode ignores pointer capability, conflicting with the 44px contract. Keyboard/ARIA support mitigates but does not fix pointer acquisition.

**Evidence:** `components/AppShell.module.css` (8px transparent handle, no persistent/coarse rule); `hooks/useViewportTier.ts` (width-only tier); `components/AppShell.tsx` (pointer flow ignores pointer type; keyboard/ARIA support exists); `STYLESEED.md` (resizable desktop panels and 44px touch targets).

**Verified acceptance criteria:** Provide a ≥44px coarse-pointer cross-axis hit region or equivalent explicit control above 1024px; show a subtle persistent cue; keep hover/focus/active distinct and retain keyboard arrows/ARIA updates; preserve clamps, `touch-action:none`, and pointer cleanup; keep handles absent ≤1024px; separate narrow visual cue from hit region to avoid intercepting content.

## I07 — Confirmed (0.99)

**Verified finding:** Desktop sidebar and inspector maxima are independent and reserve no center minimum. Both sides are non-shrinking, the center may shrink to zero, and shell overflow is clipped. Overlay tiers are unaffected.

**Evidence:** `components/AppShell.tsx` (sidebar up to `min(520px, 50vw)`, inspector up to `min(960px, 75vw)` across restore/resize/ARIA without joint constraint); `components/AppShell.module.css` (non-shrinking sides, shrinkable `min-width:0` center, clipped shell, overlay cutoff).

**Verified acceptance criteria:** Define a usable center minimum; make each panel maximum account for viewport, the other open panel, and center reservation; apply to restoration, opening, viewport resize, pointer/keyboard resize, and ARIA values; test both opening/resizing orders, oversized persisted widths, and narrowing; preserve ≤1024px overlays.

## I08 — Confirmed (0.99)

**Verified finding:** Docked panels can narrow the center while desktop toolbar composition remains fixed. The top bar clips overflow and has no container response, so legal panel combinations can hide focusable actions, especially with both panels open or enlarged.

**Evidence:** `components/AppShell.tsx` (viewport-only mode, independent widths, always-rendered full desktop action sequence); `components/AppShell.module.css` (shrinking center, `overflow:hidden`, non-wrapping/non-shrinking toolbar controls); `hooks/useViewportTier.ts` (no container measurement).

**Verified acceptance criteria:** Test all panel states and resize extremes above 1024px; keep every required action visible/operable; reserve center width and/or adapt toolbar from its container; keep both panel toggles reachable and move secondary actions into an accessible overflow/compact form; prevent partial clipping during transitions; include full Session info and retest 1024/1025.

## I09 — Confirmed (0.99)

**Verified finding:** Viewport width alone selects desktop/compact chrome. Panels can narrow the center without changing tier, leaving clipped desktop chrome. Viewport-based overlay topology may remain; center-owned chrome needs a separate container-width decision.

**Evidence:** `hooks/useViewportTier.ts` (window media queries only); `components/AppShell.tsx` (no center-responsive state; existing ResizeObserver only positions top panels; compact More calls an overlay-only path); `components/AppShell.module.css` (shrinkable center, clipped top bar, viewport-only chrome swap).

**Verified acceptance criteria:** Add a separate center/container density decision while keeping viewport tier for topology; adapt chrome during panel transitions; ensure compact chrome shown at desktop viewport is functional, especially More; test center threshold ±1 and 1024/1025; prevent center collapse.

## I10 — Confirmed (0.99)

**Verified finding:** Phone title is centered in the flex remainder between one left and two right controls, not in the viewport. With ordinary 64px controls, its region sits 32px left of center; intrinsic widths may vary the exact offset.

**Evidence:** `components/AppShell.tsx` (Sessions, title, More, Inspector, zero-width branch host); `components/AppShell.module.css` (64px minimum non-shrinking controls, flexible title, no balancing strategy); `hooks/useViewportTier.ts` (phone ≤640px).

**Verified acceptance criteria:** Keep title-region center within 1 CSS px of the safe-area content-box center from 320–640px (equivalent to viewport center with symmetric inline insets); with asymmetric inline insets, intentionally center within that usable content box rather than the physical viewport; remain stable across title/meta/control states; preserve ≥44px independently operable controls; truncate without overlap at 320px; preserve compact/desktop.

## I11 — Deferred (0.99)

**Verified finding:** At phone width, the empty-state group is block-end aligned and branding remains at inline start after versions are hidden. The full-width inner group and composer are still horizontally centered, so the entire empty state is not left-aligned. The contract does not establish whether bottom anchoring is unintended; product intent is required.

**Evidence:** `components/ChatWindow.module.css` (phone `align-items:end`, centered full-width inner, one-child `space-between` brand row); `components/ChatWindow.tsx` (brand/notices/composer move as one group); `STYLESEED.md` (composer reachability, no centered-brand requirement).

**Acceptance criteria after decision:** Document composer-led bottom anchor versus centered welcome intent; if centered, center brand at 320/390/640px; if bottom anchored, intentionally align brand to composer gutter or explicitly center it; verify light/dark portrait/landscape, 640/641, no overflow, and reduced-height/safe-area reachability.

## I12 — Confirmed (0.99)

**Verified finding:** Selected session background is replaced by hover/focus-within while `aria-selected` remains active. Later source order and higher specificity both contribute. The current diff further weakens persistence by removing the accent border.

**Evidence:** `components/SessionSidebar.module.css` (selected rule loses to more-specific interaction selectors; title weight remains); `components/SessionSidebar.tsx` (selection stays active and descendant actions trigger focus-within); `app/design-tokens.css` (distinct hover/selected colors); current SessionSidebar CSS diff (accent edge removed).

**Verified acceptance criteria:** Selected rows must remain distinct from unselected hovered rows in idle/hover/direct-focus/descendant-focus states in both themes; preserve unselected interaction feedback and focus outlines; keep delete-confirmation precedence; keep data/ARIA selection synchronized; verify desktop/mobile parent/fork/leaf rows and fix specificity, not source order alone.

## I13 — Confirmed (0.99)

**Verified finding:** In compact Run controls, unavailable OpenAI Fast is visibly and accessibly named only `N/A`, which does not identify the capability. Desktop already provides identifying copy and is unaffected.

**Evidence:** `components/ChatInput.tsx` (compact `N/A` with no label/title/description; desktop `Fast N/A` plus title/ARIA); `components/ChatWindow.tsx` and `lib/pi-codex-fast.ts` (reachable ineligible state); `hooks/useViewportTier.ts` (phone/compact through 1024px); `components/ChatInput.module.css` (no hidden identifying text).

**Verified acceptance criteria:** Show feature and state together (for example, `OpenAI Fast — Unavailable`); accessible name must identify both; keep unavailable disabled; keep eligible active/inactive identity and pressed state clear; add compact regression coverage forbidding a button named only `N/A`; preserve desktop behavior.

## I14 — Confirmed (0.99)

**Verified finding:** Compact Execution renders momentary actions and toggles as identical flat rows. ARIA and labels remain functional, so this is visual affordance/state legibility. Active treatment is color-only and may disappear in dark mode; sheet CSS also masks Stop compaction danger styling.

**Evidence:** `components/ChatInput.tsx` (same class, differing `aria-pressed` semantics, terse labels); `components/ChatInput.module.css` (flat identical rows, color-only active, danger override); `app/design-tokens.css` (dark text and accent are identical); `hooks/useViewportTier.ts` (scope ≤1024px).

**Verified acceptance criteria:** Distinguish action from persistent toggle affordance; give Fast/Sound always-visible non-color state synchronized with ARIA; use self-explanatory Fast copy; preserve Stop/in-progress danger treatment; retain native buttons, focus/disabled states, 44px targets, and hairline-list style; verify light/dark phone/tablet without changing desktop toolbar.

## I15 — Narrowed (0.99)

**Verified finding:** The native select's boundary is styled, but platform appearance is not reset and no project-owned closed indicator exists, so arrows vary by browser/OS. The focus-chrome claim is unsupported because tokenized 2px focus-visible is explicitly enforced. Native mobile pickers are expected and out of scope.

**Evidence:** `components/ui/Field.tsx` (bare semantic select); `components/ui/primitives.css` (custom shell but no appearance reset/indicator); `app/globals.css` (focus-visible and iOS 16px anti-zoom); `components/ChatInput.tsx`/`.module.css` (shared select without local normalization).

**Verified acceptance criteria:** Choose a closed-control strategy; if consistency is required, reset appearance compatibly and render exactly one decorative indicator; retain native select/picker; reserve label clearance; preserve focus ring, 40px default, 44px touch, and 16px iOS text; verify no duplicate arrows plus disabled/invalid states on iOS, Android, Chromium; regression-check ChatInput, SettingsModal, and ProviderEditor.

## I16 — Narrowed (0.98)

**Verified finding:** The phone quick picker duplicates hierarchy and explanatory copy before choices, exposes implementation-oriented fallback prose, uses a verbose manager row, and creates a second scroller. Conditional/collapsed diagnostics, recovery rows, and management access remain justified. The strongest defect is phone-specific, not the 641–1024px absolute popover.

**Evidence:** `components/ChatInput.tsx` (outer Capability profile heading); `components/ProfileSelector.tsx` (Session capability/Profile/summary, duplicate-looking default/resolved choices, conditional diagnostics/recovery, manager subtitle); `lib/profiles.ts` (bootstrap fallback copy); `components/ProfileSelector.module.css` and `components/ui/primitives.css` (nested phone scrollers); `components/ChatWindow.tsx` (manager opens over Run controls).

**Verified acceptance criteria:** Show one profile hierarchy heading and no capability-count prose before choices; concisely distinguish inherited default from pinned profile; retain recovery rows only when applicable; show one concise diagnostic status with detail collapsed/moved; use one concise management action and close Run controls before Profiles; at 390×844 use one scroller with all controls reachable; preserve 768×1024/desktop placement, selection semantics, ARIA, keyboard/Escape, applying state, and ≥44px targets.

## I17 — Confirmed (0.96)

**Verified finding:** The application lacks one coherent persistent-state hierarchy. Selected/open styling is sometimes replaced by hover/focus and equivalent controls use inconsistent combinations of fill, border, underline, badge, dot, and weight. Focus-visible is a separate required keyboard-location cue and must remain.

**Evidence:** `components/SessionSidebar.module.css`, `components/AppShell.module.css`, `components/ModelsConfig.module.css`, `components/PluginsConfig.module.css`, `components/SkillsConfig.module.css`, and `components/ProfileManagerModal.module.css` (interaction selectors override persistent state); `components/TabBar.module.css`, `components/FileViewer.module.css`, and `components/BranchNavigator.module.css` (incompatible multi-marker grammars); shared primitives/Terminal/Git styles (coherent fill plus focus counterexamples); `app/design-tokens.css` and `STYLESEED.md` (existing distinct state tokens/contract).

**Verified acceptance criteria:** Document precedence as disabled/destructive, focus-visible, selected/current/open, hover, idle; persistent identity survives interaction; use one primary persistent marker per family, allowing extra semantic cues only for distinct meaning; fix AppShell, session, and Models/Plugins/Skills/Profiles precedence at minimum; align tabs/viewer/inspector/terminal/git/segmented controls; verify compound states in light/dark desktop/mobile with snapshots or computed-style assertions.

## I18 — Confirmed (0.99)

**Verified finding:** `.composerSurface:focus-within` rings the combined editor and toolbar throughout routine editing. Toolbar controls can show both their local outline and the outer group ring. The ring is restrained but spans a large surface.

**Evidence:** `components/ChatInput.module.css` (surface ring, suppressed editor outline, local button outlines, large surface dimensions); `components/ChatInput.tsx` (wrapper encloses editor, send/queue, controls, Stop, Options); current diff (focus moved from editor to unified surface).

**Verified acceptance criteria:** Provide a clear editor-local cue without the persistent group perimeter; toolbar controls show one local focus-visible indicator; preserve unified surface, divider, dimensions, autocomplete, streaming state, and mobile targets; verify light/dark desktop/phone, single/multiline input, and open menus.

## I19 — Rejected (0.98)

**Verified finding:** Search input and native select may conventionally retain visible focus after pointer activation because users can continue typing or use the keyboard. Global focus-visible already applies, and native controls may match it after pointer activation, so changing local `:focus` does not reliably remove the alleged treatment. No defect is established.

**Evidence:** `components/BranchNavigator.module.css` (localized form-control focus versus focus-visible buttons/rows); `components/BranchNavigator.tsx` (native controlled input/select); `app/globals.css` (important global focus-visible ring).

**Verified acceptance criteria:** Do not change absent an explicit product requirement; if adopted, test actual mouse/touch/Tab behavior in Chromium, Firefox, and Safari; preserve clear keyboard focus and search/filter operation.

## I20 — Confirmed (0.99)

**Verified finding:** Visual hover rules are widespread and unconditional; coarse-pointer rules enlarge/expose controls but do not suppress synthesized/sticky hover. Several hover styles equal or override selected/open state, so retained touch hover can misreport state.

**Evidence:** `components/ui/primitives.css` (unconditional primitive hover); `components/AppShell.module.css` (hover equals pressed); `components/ChatInput.module.css` (hover combined with active); `components/SessionSidebar.module.css` (hover replaces selection/reveals actions); `components/app-shell/MobileMoreSheet.module.css` and `InspectorFileSheet.module.css` (touch surfaces retain hover); repository search (no hover-capability gate).

**Verified acceptance criteria:** Gate visual hover with hover/fine capability or neutralize it for non-hover/coarse; touch release leaves no hover-only visual/revealed-action state; persistent ARIA/data states remain distinct; preserve keyboard focus, roving behavior, 44px targets, and explicit touch actions; verify representative primitives/navigation/composer/session/sheets in both themes on desktop and iOS/Android touch.

## I21 — Deferred (0.99)

**Verified finding:** Opening Sessions/Inspector at ≤1024px schedules focus on close/back. CSS shows a ring only if the browser also matches focus-visible; programmatic focus does not guarantee it, and supplied Chromium checking found no pointer-open outline. Focus transfer is accessibility-correct because conversation content becomes inert. Cross-browser modality evidence is required before changing it; restoration is credible follow-up scope.

**Evidence:** `components/AppShell.tsx` (overlay-only focus effect and inert conversation); `hooks/useViewportTier.ts`; `components/SessionSidebar.tsx`; `components/ui/primitives.css`, `app/globals.css`, `components/AppShell.module.css`, and `components/SessionSidebar.module.css` (focus-visible-only ring).

**Acceptance criteria before implementation:** Test pointer/touch opening in Chromium, Firefox, Safari; keep focus in active overlay and visible for keyboard opening; do not remove transfer or suppress IconButton focus-visible; preserve desktop docked behavior; if focus changes, restore opener/fallback on all close paths.

## I22 — Confirmed (0.99)

**Verified finding:** Phone sheets are bottom-aligned, but bottom safe-area padding exists only on a rendered footer. Footerless Run controls has fixed non-safe-area body padding; footerless MobileMoreSheet zeroes it. Final controls can enter a nonzero unsafe inset.

**Evidence:** `components/ui/primitives.css` and `components/ui/Dialog.tsx` (footer-only inset, conditional footer); `components/ChatInput.tsx`/`.module.css` (footerless actions); `components/app-shell/MobileMoreSheet.tsx`/`.module.css` (footerless zero-padding body); `app/design-tokens.css` (`--pi-safe-area-bottom`); `app/layout.tsx` (`viewportFit: cover`); `STYLESEED.md`.

**Verified acceptance criteria:** Footerless phone bodies reserve ordinary space plus safe-area, including custom body classes; with simulated 34px inset, final Run controls/Workspace actions rows remain above unsafe band; with zero inset retain ordinary spacing; footer-bearing sheets consume inset exactly once; verify short/overflowing 390×844 content and final-row visibility/focus/tap.

## I23 — Narrowed (0.99)

**Verified finding:** Top bar jumps from 48px at 1025px to 56px at inclusive 1024px. Compact chrome is a distinct touch-oriented composition, so taller is not inherently defective. The actionable concern is the unconditional increase on compact fine-pointer viewports.

**Evidence:** `components/AppShell.module.css` (48px desktop, 56px compact/buttons, distinct compact/phone composition); `hooks/useViewportTier.ts` (same inclusive breakpoint, no pointer input); `app/design-tokens.css` and `STYLESEED.md` (44px touch minimum, not 56px requirement).

**Verified acceptance criteria:** Fine-pointer 1025→1024 must not increase measured bar height; coarse compact/phone actions remain ≥44px; scope extra height to explicit coarse/phone policy; keep CSS/TypeScript boundary aligned; verify labels and two-line identity at tablet/phone widths and text zoom.

## I24 — Narrowed (0.98)

**Verified finding:** Desktop tier ignores pointer capability while 17 component stylesheets have unbounded primary-coarse rules. Required 44px controls are not defects and hybrid `any-pointer` capability alone is not involved. The actionable excess is non-target/layout inflation, especially 52px terminal strips and 72px attachment previews. This predates the current diff.

**Evidence:** `hooks/useViewportTier.ts`; `components/ui/primitives.css` and `app/design-tokens.css` (legitimate 44px target adaptation); `STYLESEED.md`; `components/TerminalPanel.module.css` (52px chrome); `components/ChatInput.module.css` (72px previews); BranchNavigator/FileExplorer/MessageView CSS (mostly legitimate interactive-row adaptation); repository inventory and current diff.

**Verified acceptance criteria:** Compare wide fine-primary/coarse-primary layouts; keep all actionable targets ≥44px; remove/justify non-action preview inflation while retaining 44px remove hit area; reduce/justify terminal chrome; accept density loss only for actionable targets/no-hover discoverability and prevent clipping; add a regression check for unbounded coarse rules affecting static layout; do not call this a current-diff regression without evidence.

## I25 — Narrowed (0.98)

**Verified finding:** Active tabs combine persistent background and accent underline. A focused Select/Close action may add an inset outline, but that is required focus location, not a redundant third active marker. Only persistent grammar consistency is actionable.

**Evidence:** `components/TabBar.module.css` (background plus reserved border, independent child focus outline); `components/TabBar.tsx` (selection semantics and distinct Select/Close actions); `components/AppShell.module.css` (Inspector tabs use selected fill plus separate focus).

**Verified acceptance criteria:** If aligning TabBar, use at most one primary persistent container treatment; retain 2px focus-visible for Select/Close; preserve role/ARIA/roving tabindex/sizing/truncation/close geometry; keep transparent border reservation to avoid shift; verify active/inactive/hover and both child-focus states in both themes.

## I26 — Confirmed (0.99)

**Verified finding:** DirectoryPickerModal is a bespoke portal with inline styles and raw buttons. It has basic semantics, initial panel focus, backdrop/Escape, and safe-area sizing, but lacks shared focus trap/restoration, topmost Escape, and body lock. Controls bypass shared 44px rules and are undersized.

**Evidence:** `components/DirectoryPickerModal.tsx` (custom portal, inline controls, no trap/restoration/lock/stack, 26px close and small buttons); `components/ui/Dialog.tsx` (shared lifecycle); `components/ui/primitives.css` and `app/design-tokens.css` (tokenized modal and 44px controls).

**Verified acceptance criteria:** Use shared Dialog/Button/IconButton or documented equivalent; preserve browsing; provide intentional focus, topmost trap/Escape/backdrop, restoration, and body lock; all phone/coarse actions ≥44px with visible focus; move duplicated styling to tokens/scoped CSS; retain safe-area/dynamic-viewport protection and test the responsive variant.

## I27 — Confirmed (0.99)

**Verified finding:** Session command selectors use a chat-local absolute inline-styled ModalShell. Despite `aria-modal=true`, it lacks accessible naming, focus trap/restoration, topmost Escape, background lock, safe-area/dynamic viewport sizing, and shared 44px controls.

**Evidence:** `components/SessionCommandModals.tsx` (unnamed shell, local key handling, no lifecycle, 26px/16px/tiny actions, `100vh` sizing); `components/ui/Dialog.tsx` and `components/ui/primitives.css` (missing shared behavior); `app/design-tokens.css` (available tokens bypassed); `components/ChatWindow.tsx` (chat-local mounting).

**Verified acceptance criteria:** Use shared/equivalent viewport modal with naming, topmost Escape, focus trap/restoration, and background lock; preserve search focus and command keyboard behavior; use safe-area/dynamic viewport; all actionable controls ≥44px on phone/coarse; preserve tree/fork navigation, label editor isolation, states, and callbacks; automate naming/focus/Escape/restoration coverage.

## I28 — Narrowed (0.99)

**Verified finding:** ExtensionUiHost bypasses shared dialogs/controls, causing modal-scope, naming, focus-management, responsive, and token defects. Ordinary input/editor autofocus is reasonable, and global important focus-visible overrides inline `outline:none`. The custom terminal is a true focus failure because focus moves to an invisible 1×1 textarea with no visible panel cue or normal Tab route to Close.

**Evidence:** `components/ExtensionUiHost.tsx` (absolute inline overlays, incomplete naming/focus/lifecycle, invisible terminal focus, hardcoded white accent text); `app/globals.css` (ordinary control focus remains visible); `components/ui/Dialog.tsx`/`primitives.css` (missing shared contract); `components/ChatWindow.tsx`/`.module.css` (conversation scope); `components/AppShell.tsx` (workspace Escape recognizes only `.pi-dialog`); `app/design-tokens.css` (`--accent-contrast`).

**Verified acceptance criteria:** Use shared/equivalent adapter with naming, body portal, topmost Escape, trap/lock/restoration; keep purposeful autofocus and initialize every request; retain ordinary focus-visible; give terminal visible focus-within and keyboard-reachable Close while preserving terminal Tab if required; use safe areas, 100dvh, ≥44px targets, tokens, and accent contrast; block full background and test request transitions, focus, Escape, restoration, mobile, and dark contrast.

## I29 — Confirmed (0.99)

**Verified finding:** Four materially different modal contracts exist. Shared Dialog provides portal stacking, lock, focus lifecycle, topmost Escape, safe-area/dvh, tokens, and coarse sizing. Directory, session-command, and extension systems implement inconsistent subsets with concrete keyboard, naming, viewport, touch, and layering defects. Directory picker already handles all four safe-area insets/100dvh; safe-area defects primarily affect session commands and extensions. None explicitly handles visualViewport keyboard changes.

**Evidence:** `components/ui/Dialog.tsx` (complete shared lifecycle); `components/DirectoryPickerModal.tsx` (safe-area portal but incomplete focus/lock/stack and small controls); `components/SessionCommandModals.tsx` (unnamed chat-local shell without safe areas/lifecycle); `components/ExtensionUiHost.tsx` (custom overlays and specialized terminal semantics); `components/ui/primitives.css` (shared contract not inherited).

**Verified acceptance criteria:** Route all modal families through shared lifecycle or documented adapters with portal ownership, stack-aware dismissal, body lock, naming, focus entry/trap/restoration; preserve custom terminal Escape/Tab semantics and ensure ordinary Escape closes once; apply shared safe-area/viewport behavior and test keyboard-reduced views; all modal actions ≥44px on mobile/coarse; use shared anatomy tokens with documented variants; add cross-modal keyboard, accessibility, long-content, scroll, safe-area, and workflow tests.

---

# Finalization record

## Final outcome

- **Initial review:** 25 implementation findings, 2 rejected findings (I05, I19), and 2 deferred findings (I11, I21).
- **Implementation:** All 25 implementation findings were assigned to completed implementation groups. I11 was intentionally skipped pending product intent; rejected and deferred findings were not changed.
- **Post-fix verification:** 13 pass, 4 partial, 8 fail, 2 rejected/not applicable, and 2 deferred/not run.
- **Repository audit:** **Pass.** The compact BranchNavigator source assertion now follows the labeled semantic `section`, the repaired wide-coarse inventory remains green, and the full MJS gate passes 219/219.
- **Release environment:** Physical iOS Safari/PWA and Android Chrome verification was unavailable. Chromium/device emulation covered the documented rendered checks but does not replace the external device gate.
- **Finalize-phase scope:** Documentation only; no application source was altered.

## Implementation group ledger

| Implementation group | Issues | Recorded implementation result | Recorded checks |
|---|---|---|---|
| Fix dialog foundation | I04, I15, I22 | Added validated panel-first/opt-in initial focus with `preventScroll`; normalized the native Select's closed indicator; added footer-aware safe-area padding for footerless phone sheets. | TypeScript, targeted ESLint, CSS parse, LSP, and `git diff --check` passed; physical iOS/Android remained pending. |
| Fix workspace sheet | I01 | Added a token-based top inset and ordinary trailing clearance plus bottom safe area to Workspace actions while preserving scroll, gutters, targets, and dismissal. | TypeScript, ESLint, LSP, CSS contract assertion, and `git diff --check` passed. |
| Fix run controls | I02, I03, I13, I14, I16, I18 | Reworked the phone profile view, Execution semantics, Fast labels/states, diagnostics, manager transition, and editor-local focus. Preserved the >640px anchored popover. | Profile tests, TypeScript, ESLint, LSP, rendered 390/640/641/768 checks, `git diff --check`, and StyleSeed 96/100 passed. |
| Fix shell layout | I06, I07, I08, I09, I10, I23, I24 | Added joint side-panel limits and a 480px center reservation, center-measured chrome density, persistent/coarse resize affordances, balanced phone title geometry, pointer-aware compact height, and targeted wide-coarse density reductions. | 187 implementation-phase tests, TypeScript, LSP, diff check, rendered 390/1024/1440 checks, and StyleSeed 94/100 passed; ESLint had two unrelated existing warnings. |
| Fix mobile empty | I11 | Skipped because the initial finding was deferred pending a product decision between a composer-led bottom anchor and centered welcome composition. | No implementation or post-fix check assigned. |
| Fix interaction states | I12, I17, I20, I25 | Established persistent state precedence, retained independent focus-visible cues, removed redundant active markers, and gated component hover visuals to fine hover-capable pointers. | Interaction tests, TypeScript, ESLint, CSS parse/audit, rendered light/dark desktop/phone checks, diff check, and StyleSeed 96/100 passed in the implementation phase. |
| Fix directory dialog | I26 | Migrated DirectoryPicker to shared Dialog/Button primitives with token CSS, focus lifecycle, body lock, 44px mobile controls, and logical opener restoration. | TypeScript, ESLint, LSP, interaction tests, diff check, rendered desktop/phone light/dark checks, and StyleSeed 96/100 passed. |
| Fix session dialogs | I27 | Migrated tree/fork selectors to shared Dialog, added naming/focus/safe-area/dvh behavior and touch-safe controls, and preserved command keyboard flows. | TypeScript, ESLint, LSP, 4/4 contract tests, diff check, responsive visual checks, and StyleSeed 93/100 passed. |
| Fix extension dialogs | I28 | Migrated standard/custom extension surfaces to shared Dialog and controls, retained protocol and terminal key behavior, added terminal focus-within plus F6 Close access, and used accent-contrast/touch tokens. | TypeScript, ESLint, 9 tests, diff check, desktop/mobile light/dark visual gate, and StyleSeed 91/100 passed; four pre-existing index-key diagnostics remained. |
| Converge modal systems | I29 | Unified modal families on shared lifecycle/variants, added visualViewport handling, safe-area/dvh behavior, reduced-motion handling, and explicit terminal adapters. | TypeScript, ESLint, 18/18 modal tests, diff check, rendered 390×844/390×520 checks, and StyleSeed 92/100 passed; physical device checks remained external. |

## I01–I29 traceability

The initial verdict column preserves the supplied verdict language. “Partial” means the original claim was materially narrowed before implementation. Detailed initial evidence and acceptance criteria remain in the independent verification register above.

| ID | Initial verdict | Implementation group/disposition | Post-fix | Final verification result and remaining work |
|---|---|---|---|---|
| I01 | Confirmed (0.99) | Fix workspace sheet; coordinated with I22 | **Pass** | Computed phone padding provided 16px top and 24px + safe-area bottom clearance; short-height scroll/focus/touch behavior and dismissal passed. No remaining issue. |
| I02 | Confirmed (0.99) | Fix run controls | **Fail** | Normal portrait and 640/641 behavior, focus restoration, and nonzero menu viewport passed. At 640×360, opening Profiles still moved Execution and made lower controls unreachable while the outer scroller was disabled. Add the landscape regression and repair the TSX `act` harness; repeat physical mobile checks. |
| I03 | Confirmed (0.98) | Fix run controls | **Pass** | Long-profile Chromium checks showed exactly one active menu scroller, reachable final option/Manage action, stable panel/Execution geometry at tested portrait/reduced heights, touch scrolling, safe-area handling, and 640/641 behavior. Physical iOS/Android remains an external gate. |
| I04 | Partial (0.98) | Fix dialog foundation | **Pass** | Dialog interaction checks pass 47/47 across explicit/fallback focus, invalid/hidden/inert/roving targets, `preventScroll`, no activation, trapping, nesting, Escape, viewport changes, and restoration. The compact BranchNavigator assertion follows the labeled semantic `section`, and the full MJS gate passes 219/219. Physical iOS Safari/PWA and Android Chrome virtual-keyboard/focus checks remain external release validation. |
| I05 | Rejected (0.99) | No implementation | **Not applicable** | Compact/phone resizing is intentionally absent under the locked overlay/push-layer contract. Keep the 1024px boundary synchronized. |
| I06 | Confirmed (0.99) | Fix shell layout | **Fail** | Application acceptance passed: persistent cue, 44×44 coarse hit testing for both handles, keyboard/ARIA, pointer cleanup, and ≤1024 hiding. Postcheck remains failed solely because the related viewport test file is 10/11 due to the stale coarse-pointer inventory. |
| I07 | Confirmed (0.99) | Fix shell layout | **Partial** | Joint constraints preserve the 480px center across restoration/open/resize orders. During viewport narrowing, flex-shrunk outer panels can temporarily clip their fixed-width inner content. Add panel client/scroll-width assertions and eliminate transition-time clipping; repository inventory gate also remains red. |
| I08 | Confirmed (0.99) | Fix shell layout | **Fail** | Rendered center chrome, More → Session tree, Session info, panel extremes, focusability, and no document overflow passed. Overall postcheck fails on the stale coarse-pointer inventory; add a mounted AppShell More/tree interaction test to harden coverage. |
| I09 | Confirmed (0.99) | Fix shell layout | **Pass** | Center-measured density is separate from viewport topology; desktop compact More works, panel transitions are deterministic, 480px center is enforced, and explicit project tests passed 208/208. No remaining issue. |
| I10 | Confirmed (0.99) | Fix shell layout | **Fail** | Phone grid centering passed 320–640px, symmetric/asymmetric safe areas, long content, 200% text checks, and 1024/1025 boundaries, including the SSR density state. Postcheck remains failed on the inventory test and because live React hydration/click interaction did not activate in the available headless dev render. |
| I11 | Partial (0.99) → deferred | Fix mobile empty skipped | **Not run** | Source proves bottom anchoring and left-biased branding, but not that the composition is wrong. Product must choose a composer-led bottom anchor or centered welcome composition before implementation. |
| I12 | Confirmed (0.99) | Fix interaction states | **Pass** | Selected session rows retain selected fill through hover/direct/descendant focus in light/dark desktop/mobile; unselected feedback, delete confirmation, ARIA/data synchronization, and focus indicators passed. No remaining issue. |
| I13 | Confirmed (0.99) | Fix run controls | **Pass** | Compact control now renders “OpenAI Fast” with Unavailable/Off/On, forces ineligible state disabled/not pressed/not active, preserves desktop behavior, and has real DOM regression coverage. No remaining issue. |
| I14 | Confirmed (0.99) | Fix run controls | **Pass** | Actions and toggles are visibly distinct; Fast state is structured and synchronized with ARIA; unavailable overrides active; compaction danger/in-progress treatment and 44px controls passed. No remaining issue. |
| I15 | Partial (0.99) | Fix dialog foundation | **Partial** | Native select semantics, one decorative indicator, appearance reset, spacing, focus, 40/44px sizing, iOS 16px text, disabled/invalid states, and Chromium light/dark fixtures passed. Physical iOS Safari/PWA and Android Chrome native picker/arrow checks remain required. |
| I16 | Partial (0.98) | Fix run controls | **Pass** | Phone hierarchy/copy, inherited-vs-pinned meaning, conditional recovery rows, announced collapsed diagnostics, manager transition, single-scroll layout, keyboard/ARIA, focus, and 44px targets passed. No remaining issue. |
| I17 | Confirmed (0.96) | Fix interaction states | **Fail** | Most families now preserve persistent selection and focus. Real selected Models rows still lose selected fill on fine-pointer hover because `.modelRow:hover` beats `.navRowSelected`; the current fixture misses the production class combination. Fix specificity, add the exact fixture, and resolve the BranchNavigator ARIA diagnostic. |
| I18 | Confirmed (0.99) | Fix run controls | **Pass** | Editor focus is local, toolbar controls retain one local 2px focus cue, and no composer-wide focus-within halo remains; unified surface, divider, dimensions, autocomplete, streaming, multiline sizing, and 44px mobile controls passed. No remaining issue. |
| I19 | Rejected (0.98) | No implementation | **Not applicable** | Native input/select pointer focus is conventional and global focus-visible already applies. Do not change absent an explicit cross-browser product requirement. |
| I20 | Confirmed (0.99) | Fix interaction states | **Partial** | Repository-wide hover gating, touch post-release state, persistent-state precedence, focus, roving behavior, explicit touch actions, and emulated iOS/Android light/dark checks passed. The directly related coarse-pointer inventory assertion remains stale; physical devices remain an external gate. |
| I21 | Partial (0.99) → deferred | No implementation | **Not run** | Focus transfer into inert compact/phone layers is accessibility-correct and Chromium did not prove an intrusive pointer ring. Run cross-browser modality testing before code change; preserve keyboard focus and add restoration only with explicit scope. |
| I22 | Confirmed (0.99) | Fix dialog foundation | **Pass** | Footerless phone sheets compute ordinary + safe-area bottom clearance even with body classes; footer-bearing sheets consume the inset once; short/overflowing Run controls and Workspace actions remained reachable, focusable, and tappable. No remaining issue. |
| I23 | Partial (0.99) | Fix shell layout | **Partial** | Fine-pointer 1025/1024 height, coarse 44px targets, phone centering, and breakpoint synchronization passed. At 768/1024px under 200% text-only zoom, the fixed 48px compact bar clips the two-line session identity. Add intrinsic growth/text-zoom coverage; inventory gate also remains red. |
| I24 | Partial (0.98) | Fix shell layout | **Fail** | Wide attachment previews and terminal chrome now pass, and File Explorer static inflation was reduced. Non-action `.queueRow` and `.feedback` still inflate to 44px in wide coarse mode; the inventory both allows this and fails on compact primitive selectors. Restrict static inflation, strengthen the actionable-selector audit, and resolve/quarantine the profile-layout cleanup failure. |
| I25 | Partial (0.98) | Fix interaction states | **Pass** | Active tabs now use one selected fill while retaining the transparent 2px border reservation and independent Select/Close focus indicators; ARIA, roving tabindex, truncation, close geometry, and light/dark states passed. No remaining issue. |
| I26 | Confirmed (0.99) | Fix directory dialog | **Pass** | Shared modal/control lifecycle, browsing flows, focus trap/restoration, body lock, safe areas/visual viewport, 44px controls, token styling, and logical opener restoration passed. Physical mobile remains an external gate only. |
| I27 | Confirmed (0.99) | Fix session dialogs | **Fail** | Shared lifecycle, naming, safe areas, 44px controls, command behavior, deterministic post-fork composer focus, and rendered dialog tests passed. Overall postcheck fails solely because the full MJS suite is 214/215 on the stale coarse-pointer selector inventory. |
| I28 | Partial (0.99) | Fix extension dialogs | **Pass** | Rendered tests cover naming, initial focus, request transitions, wrapping, Escape/restoration, terminal Tab/Escape/F6/Close behavior, visual viewport, 44px controls, body isolation, protocol, and AA accent contrast. No remaining issue. |
| I29 | Confirmed (0.99) | Converge modal systems | **Fail** | Shared lifecycle, visualViewport initialization, 44px compact controls, variant adapters, and key workflows passed. Cross-modal behavioral coverage remains incomplete for DirectoryPicker flows, real long-content scroll/safe-area geometry, and submitted extension response values; add the full desktop/compact/phone light/dark matrix. |

## Remaining issue register

### Application or coverage defects

1. **I02 — short landscape profile flow:** At 640×360, opening Profiles moves Execution and can make later controls unreachable while outer scrolling is disabled. Add the viewport to `lib/profile-selector-layout.test.mjs`, retain one scroll owner, and repair the React `act` harness used by the affected TSX tests.
2. **I07 — transient panel-content clipping:** The 480px center survives narrowing, but fixed-width inner side-panel content can be clipped while outer widths flex-shrink/transition. Reconcile inner/outer widths or suppress viewport-driven transition clipping and assert panel `clientWidth`/`scrollWidth` throughout narrowing.
3. **I10 — live hydration evidence:** Geometry is correct in static and SSR states, but real hydrated button interaction was not observed in the available headless dev render. Investigate the harness/runtime before certifying the end-to-end interaction.
4. **I17 — selected Models hover:** Exclude `.navRowSelected` from `.modelRow:hover` or otherwise make selected state win. Add a computed fixture with the exact `.modelRow.navRowSelected` production combination. Resolve the BranchNavigator semantic/ARIA diagnostic.
5. **I23 — compact text zoom:** At 768px and 1024px fine-pointer compact layouts, 200% text-only zoom clips the two-line session identity inside the fixed 48px bar. Permit intrinsic accessibility growth and assert vertical `scrollHeight <= clientHeight` in rendered coverage.
6. **I24 — static wide-coarse inflation:** Non-action queue and feedback content still grows under primary-coarse mode. Keep 44px on actionable controls, remove/justify static inflation, and make the audit reject non-action selectors rather than any declaration that happens to use `--control-touch`.
7. **I29 — cross-modal behavior matrix:** Add mounted DirectoryPicker loading/success/empty/error/busy/navigation/select/cancel/backdrop/Escape/focus/viewport/target tests; assert real long-content scroll ownership and footer/safe-area reachability; behaviorally submit extension select/confirm/input/editor responses; run desktop/compact/phone light/dark coverage.

### Shared repository gate

8. **Profile layout cleanup stability:** One I24 broad sweep repeatedly observed `lib/profile-selector-layout.test.mjs` failing temporary-directory cleanup with `ENOTEMPTY`; isolate or repair this before claiming repeated-run stability. The current full MJS gate passes 219/219.

### Deferred product/browser decisions

9. **I11:** Choose and document bottom-anchored composer-led versus centered welcome composition before implementation.
10. **I21:** Gather Chromium/Firefox/Safari keyboard/mouse/touch modality evidence before changing required overlay focus transfer; preserve keyboard-visible focus and restoration.
11. **Physical mobile gate:** Run iOS Safari/PWA and Android Chrome checks for native Select presentation, touch scrolling, virtual keyboard/visualViewport, safe areas, focus visibility/restoration, and post-tap hover behavior.

## Repository check ledger

| Check | Final result | Evidence / note |
|---|---|---|
| Finalize-phase source scope | **Pass** | Finalization was read-only except for this document. No application source, build, commit, push, deployment, or reset operation was performed. |
| `git diff --check` | **Pass** | No whitespace errors. Untracked files were separately checked for trailing whitespace and passed. |
| TypeScript | **Pass** | `node_modules/.bin/tsc --noEmit` completed with no output. |
| ESLint | **Pass with warnings** | `npm run lint` reported 0 errors and 2 pre-existing `@typescript-eslint/no-unused-vars` warnings in unchanged `hooks/useProfiles.ts:72` and `:86`. |
| CSS syntax | **Pass** | PostCSS and Lightning CSS parsed all 27 changed CSS files with zero failures. |
| Design-token synchronization | **Pass** | All 27 color values in `styleseed/tokens.json` matched `app/design-tokens.css`. |
| Responsive/focus/safe-area source review | **Pass** | Hover rules are fine-pointer gated; focus-visible cues remain; joint panel limits and overflow containment exist; dialogs and phone sheets use safe-area plus visualViewport handling. Issue-specific exceptions are recorded above. |
| Dialog interaction tests | **Pass** | `npm run test:dialog-interaction` passed 34/34. Correctly loaded TSX accessibility/control tests passed 2/2. |
| Responsive Chromium checks | **Pass for audited fixtures** | Center reservation, compact surfaces, phone centering, coarse targets, and profile layout fixtures passed. Issue-specific counterexamples at 640×360 and compact 200% text zoom remain recorded above. |
| Change-scope audit | **Pass** | Changes were limited to the UI redesign, related hooks, design docs/tokens, tests, and test dependencies; no accidental server/API/deployment changes were found. |
| Full repository regression gate | **Pass** | `node --test --test-concurrency=1 hooks/*.test.mjs lib/*.test.mjs` passed 219/219. The wide-coarse inventory and compact BranchNavigator semantic-section assertions both pass. |
| Physical mobile browsers | **Not run** | No available iOS simulator or Android device. This remains an external release-environment gate. |

## Final audit decision

**FAIL — not ready to close the full 29-item audit as fully verified.** The repository regression gate is green at 219/219 and I04 is closed by deterministic dialog coverage. The audit-wide decision remains blocked only by the unrelated issue-specific defects and coverage gaps listed above. Physical mobile checks remain external release validation.

# Closeout addendum

## Authority and scope

This addendum preserves the baseline, independent verification register, implementation ledger, post-fix table, remaining-issue register, and earlier final decision above as historical audit evidence. It records the later repair and independent recheck phases and supersedes only the earlier closeout statuses for I02, I04, I06, I07, I08, I10, I15, I17, I20, I23, I24, I27, and I29.

The Closeout addendum changes documentation only. No application source was edited during this phase, and no build, commit, push, deployment, reset, or generated artifact was produced.

## Closeout outcome

- **Repository-verifiable closeout: PASS.** Every repaired or strengthened issue listed in this addendum passed its final independent recheck.
- **Repository gates: PASS.** The final deterministic gates completed with 219/219 MJS tests and 49/49 TSX tests, plus clean TypeScript and whitespace checks and lint with no errors.
- **Prior blockers resolved:** the 640×360 profile flow, transition-time panel clipping, compact 200% text growth, selected Models hover, wide-coarse static-content inventory, mounted More → Session tree behavior, modal behavior matrix, and stale BranchNavigator source expectation are all covered by passing executable checks.
- **External release validation remains:** physical iOS Safari/PWA and Android Chrome checks were not run. These items are external-only and do not represent a repository failure.
- **Unchanged historical dispositions:** I05 and I19 remain rejected/not applicable; I11 and I21 remain deferred pending product or cross-browser decisions. This addendum does not reclassify them.

## Repair summaries

| Repair group | Issues | Repair summary | Repair-phase evidence |
|---|---|---|---|
| Profile landscape | I02 | Added the 480–640px short-landscape Run-controls layout, preserved Profile/Execution geometry, made the profile menu the sole vertical scroll owner, retained management/Execution reachability, and added deterministic 640×360 Chromium coverage with stable cleanup. | Profile layout passed 3 consecutive runs; related profile/accessibility/Fast tests passed 11/11; TypeScript, targeted ESLint, LSP, and diff checks passed. |
| Coarse inventory | I06, I20, I24, I27 | Revalidated the existing 44×44 coarse resize handles, accepted correct grouped primitive selectors, removed wide-coarse static queue/feedback and redundant notice inflation, strengthened static-selector rejection, and restored the full MJS gate. | Targeted repair checks passed 16/16; the subsequent final MJS gate passed 219/219. |
| Shell clipping and compact growth | I07, I08, I10, I23 | Made panel inners follow transitional outer widths, allowed compact chrome to grow intrinsically at 200% text while retaining normal density, added transition-frame clipping checks, and added a hydrated AppShell fixture for More → Session tree. | Focused responsive suite passed 12/12; final MJS gate passed 219/219; TypeScript, targeted ESLint, LSP, and diff checks passed. |
| Selected Models hover | I17 | Prevented fine-pointer hover from replacing selected Models fill, tested the exact `.modelRow.navRowSelected` production combination, and aligned BranchNavigator with a labeled semantic `section`. | Interaction-state suite passed 3/3; mounted Session tree interaction passed; static gates and diagnostics passed. |
| Cross-modal matrix | I29 | Added mounted DirectoryPicker workflows, submitted extension values, and real bundled Chromium long-content/scroll-owner/safe-area coverage across desktop, compact, phone, light, and dark. No new application defect was proven. | Dialog interaction passed 47/47, modal contracts passed 21/21, and the final repository gates passed. |
| Dialog and Select external-gate review | I04, I15 | Added deterministic focus, reduced visual viewport, `preventScroll`, restoration, and touch-emulated native Select coverage. No additional reproducible source defect was found. | Dialog interaction passed 47/47; Chromium checks passed at 390×844, reduced 390×420, and 412×915; final MJS gate passed 219/219. |

## Per-issue final rechecks

| ID | Final repository status | Final recheck evidence | Remaining work |
|---|---|---|---|
| I02 | **Pass / closed** | Absolute phone replacement surface, locked outer scroll ownership, stable panel and Execution geometry, option/Manage reachability, no horizontal overflow, and Escape/selection focus restoration passed across 390×844, 390×520, 640×360, 640×844, and the 641px boundary. `lib/profile-selector-layout.test.mjs` passed 3 consecutive runs; related tests passed 11/11. | Physical iOS Safari/PWA and Android Chrome profile-flow checks only. |
| I04 | **Pass / closed** | Shared Dialog target validation, safe panel-first focus, explicit-focus opt-in, `preventScroll`, visible focus, no activation, trapping, nesting, topmost Escape, visual viewport handling, and opener restoration passed. `npm run test:dialog-interaction` passed 47/47 and the full MJS gate passed 219/219. | Physical mobile virtual-keyboard, focus visibility, reduced visual viewport, and restoration checks only. |
| I06 | **Pass / closed** | Persistent/state styling, 44×44 wide-coarse targets, ≤1024 hiding, keyboard/ARIA/clamping, primary-button filtering, pointer-id isolation, and cleanup all passed. The focused viewport suite passed 12/12 and the full MJS gate passed 219/219. | Hands-on mouse, trackpad, and physical touch dragging are external/manual release checks only. |
| I07 | **Pass / closed** | The 480px center reservation and joint panel limits now apply across restoration, opening, resize, pointer, keyboard, and ARIA paths. Animated narrowing asserts aligned inner/outer widths with no clipping or shell overflow; focused tests passed 12/12 and MJS passed 219/219. | None. |
| I08 | **Pass / closed** | Center-measured chrome adaptation, intentional compact overflow, required control reachability, Session info containment, panel-extreme behavior, mounted More → Session tree interaction, and no horizontal overflow passed. Focused tests passed 12/12 and MJS passed 219/219. | None. |
| I10 | **Pass / closed** | Phone title geometry passed from 320–640px with symmetric/asymmetric safe areas, long content, focus states, 100%/200% text, SSR/hydration reconciliation, and mounted More → Session tree focus entry/Escape/restoration. MJS passed 219/219. | Physical iOS Safari/PWA and Android Chrome layout/interaction checks only. |
| I15 | **Pass / closed** | The shared control retains a native `select`, one decorative indicator, appearance reset, 40/44px sizing, 16px iOS anti-zoom text, focus, keyboard selection, disabled/invalid treatment, light/dark tokens, and no overflow. Dialog/Select interaction passed 47/47. | Physical iOS Safari/PWA and Android Chrome native picker/arrow presentation in light and dark only. |
| I17 | **Pass / closed** | Fine-pointer hover excludes `.navRowSelected`; the exact `.modelRow.navRowSelected` fixture retains selected fill and a 2px focus cue across light/dark, desktop/mobile, and fine/touch matrices. Interaction tests passed 3/3, viewport tests 12/12, and MJS 219/219. | None. |
| I20 | **Pass / closed** | All audited hover visuals are under fine/hover capability gates, persistent state remains independent, touch/coarse matrices show no ghost hover, and the wide-coarse selector inventory is action-scoped. Interaction tests passed 3/3 and MJS passed 219/219. | Physical iOS Safari/PWA and Android Chrome post-tap sticky-hover checks only. |
| I23 | **Pass / closed** | Compact chrome grows intrinsically for 200% text, retains 48px fine and 56px phone/coarse floors, keeps 44×44 coarse actions, and preserves synchronized 640/641 and 1024/1025 boundaries. Focused viewport tests passed 12/12 and MJS passed 219/219. | None. |
| I24 | **Pass / closed** | Unbounded coarse rules now inflate actionable controls only; static queue, feedback, and notice selectors are rejected, while terminal density and 44×44 resize hit regions remain covered. Issue-specific checks passed 3/3 and MJS passed 219/219. | Physical wide-coarse iOS/Android or hybrid-device density checks only. |
| I27 | **Pass / closed** | Shared adaptive session dialogs retain naming, intentional focus, topmost Escape, containment/restoration, body lock, safe-area/dynamic viewport behavior, command-key isolation, and 44px touch controls. Session contracts passed 5/5, dialog interaction 47/47, and MJS 219/219. | Physical iOS Safari/PWA and Android Chrome dialog checks only. |
| I29 | **Pass / closed** | Real bundled DirectoryPicker, Session tree, standard extension, and custom extension surfaces passed desktop/compact/phone × light/dark long-content coverage with reduced visual viewports, safe areas, touch scrolling, one scroll owner, final-content reachability, and no horizontal overflow. Dialog interaction passed 47/47 on five consecutive runs; modal contracts passed 21/21; MJS passed 219/219. | Physical mobile touch scrolling, virtual keyboards, safe areas, and focus restoration only. |

## Final repository gates

The supplied final gate was read-only and left the working tree unchanged.

| Gate | Final result | Closeout evidence |
|---|---|---|
| Whitespace | **Pass** | `git diff --check` completed with no output. Untracked text-file trailing-whitespace checks also passed where recorded by the final rechecks. |
| TypeScript | **Pass** | `node_modules/.bin/tsc --noEmit` completed with no diagnostics. |
| ESLint | **Pass with warnings** | `npm run lint` completed with 0 errors and 2 pre-existing warnings in unmodified `hooks/useProfiles.ts:72` and `:86` for unused `_warnings`; the same lines exist in `HEAD`. |
| Responsive focused suite | **Pass** | `hooks/useViewportTier.test.mjs` passed 12/12. |
| Repository MJS suite | **Pass** | All 37 `*.test.mjs` files, discovered with `find` and `LC_ALL=C sort`, passed 219/219 with deterministic single-test concurrency. |
| Repository TSX suite | **Pass** | All 6 TSX test files passed 49/49 with `NODE_ENV=test` and `--test-concurrency=1`. |
| Diagnostics | **Pass** | Issue-specific final rechecks reported no source errors; TypeScript and targeted ESLint were clean. Non-gating organize-import information or fixture-string warnings did not represent application diagnostics. |
| Working-tree preservation | **Pass** | Final status matched the initial working-tree state; the gates edited or generated no files. |

### Non-blocking repository warnings

- `hooks/useProfiles.ts:72` and `hooks/useProfiles.ts:86` contain two pre-existing ESLint unused-variable warnings; both are present in `HEAD`.
- ESM-loaded tests emitted pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warnings because `package.json` has no `type` field in either `HEAD` or the working tree.

## External-only physical device items

The following are release-environment checks, not unresolved repository defects and not represented as completed:

1. **iOS Safari and installed PWA:** verify portrait and short-landscape profile flow, real touch scrolling, safe-area clearance, virtual-keyboard/visualViewport resizing, dialog focus visibility, and opener restoration.
2. **Android Chrome:** repeat profile, dialog, long-content scrolling, safe-area/system-UI clearance, virtual-keyboard, and focus-restoration checks.
3. **Native Select presentation:** confirm the closed arrow and OS picker behavior in light/dark on physical iOS Safari/PWA and Android Chrome while preserving native semantics.
4. **Post-tap state:** confirm touch activation leaves no sticky hover that resembles selected/open state on representative primitives, navigation, composer, session, and sheet controls.
5. **Physical resize input:** perform hands-on mouse, trackpad, and applicable coarse/touch resize-handle dragging, including cancellation and adjacent-control hit testing.
6. **Cross-modal physical matrix:** sample DirectoryPicker, session tree/fork, standard extension, and custom extension surfaces for real touch scrolling, virtual keyboards, safe areas, final-content reachability, and focus restoration.

## Closeout decision

**PASS — the repository-verifiable repair and recheck scope is ready to close.** All issue-specific blockers carried into this addendum are resolved by source evidence and passing deterministic tests. Physical iOS Safari/PWA and Android Chrome validation remains explicitly external and must not be inferred from Chromium emulation. I11 and I21 retain their prior deferred dispositions, and I05 and I19 retain their prior rejected dispositions.

# Approved-polish implementation addendum — 2026-07-12

## Authority and supersession

`docs/ui-polish-decisions.md` records the subsequently approved D01–D44 product decisions and is authoritative for this polish phase. This addendum supersedes the older implementation dispositions above where those decisions supplied the previously missing product intent, including the centered mobile welcome, background-only focus treatment, tablet resizing, shared modal chrome, and flat configuration-list contracts. Historical findings and earlier closeout evidence remain preserved for traceability.

## StyleSeed source score

**Design Score: 91 / 100 (A) — pass.** This score was produced from the implemented source after the final focus/profile corrections, using the weighted `/ss-score` rubric and real file evidence.

| Category | Score | Evidence |
|---|---:|---|
| Color discipline | 15/16 | Semantic light/dark tokens and neutral ordinary selection live in `app/design-tokens.css`; semantic hues are reserved for status. A small deduction remains for legacy inline compatibility colors outside the primary tokenized surfaces. |
| Hierarchy & typography | 14/16 | Shared 56/44/48px density, compact technical metadata, title hierarchy, and monospace paths are consistent. Dense data chrome intentionally retains a few very small metadata sizes. |
| Layout & rhythm | 10/12 | Shared gutters, flat rows, centered empty state, center reservation, and modal scroll ownership are coherent. The constrained phone Profile replacement intentionally offers a compact 120px single-scroll viewport to keep Execution visible. |
| Cards & elevation | 9/10 | Primary workspace and inventories are flat tonal surfaces without nested cards or decorative shadows. Single structural dividers remain by the approved design lock. |
| States & accessibility | 17/18 | 44px touch controls, readable disabled states, ARIA labels, neutral selected state, focus restoration, and background-only `:focus-visible` are covered by rendered and executable checks. Physical mobile-browser confirmation remains external. |
| Motion & interaction | 6/6 | Named motion tokens, capability-gated hover, reduced-motion fallbacks, and non-blocking transitions are present. |
| Coherence | 11/12 | One monochrome selection language, one radius scope, shared modal chrome, and consistent icon/control anatomy are implemented across the audited families. |
| Distinctiveness | 9/10 | The compact technical workspace identity, terminal/file metaphors, and Nema composition avoid generic card-grid and icon-chip patterns. |

## StyleSeed rendered verification

**Visual gate: PASS for repository-verifiable surfaces.** The final `/ss-verify` loop rendered and manually reviewed 23 screenshots plus one tablet resize-contract record in `/tmp/pi-web-visual-evidence`. The loop caught and repaired a stretched Settings action, duplicate modal Close actions, the Run Profile clipping/scroll contract, the desktop composer shadow, and the global outline-based focus rule before the final pass.

Covered evidence:

- Phone portrait at 320px, 390px, and 430px.
- Short landscape at 640×360.
- Tablet at 768×1024 with the resize handle available.
- Desktop at 1440×900 with both panels open.
- Desktop panel extremes: Sidebar 520px, Inspector 440px, center workspace 480px.
- Light and dark themes.
- Settings Runtime/Web app, Models, Skills, Plugins, Profiles, Run controls closed/open Profile, Explorer, Inspector Changes, selected/disabled/focused states, centered new-session welcome, and 200% text enlargement.
- Final metrics: zero document or body horizontal-overflow failures in every captured state.
- Run Profile open state: stable panel and Execution geometry, one menu scroll owner, reachable final option/Manage action, no sibling reflow, and no leaked/clipped control chrome.
- Focus state: selected plus keyboard focus retains the same neutral selected background with no panel or control outline.

The expected blank remainder in short configuration inventories is the unused portion of a preserved fullscreen inventory surface, not an extra card, spacer, or detached footer. No unexplained clipping, duplicate close/refresh action, panel-wide focus treatment, or decorative nested-card regression remained in the reviewed final captures.

## Final automated validation

| Gate | Result |
|---|---|
| `git diff --check` | **Pass** |
| `node_modules/.bin/tsc --noEmit` | **Pass** |
| `npm run lint` | **Pass with 0 errors**; two pre-existing unused `_warnings` warnings remain in `hooks/useProfiles.ts:72` and `:86`. |
| MJS repository suite | **219/219 pass** |
| TSX repository suite | **49/49 pass** |
| Profile replacement regression | **Pass** across 390×844, keyboard-reduced portrait, safe-area portrait, 640×360, 640×844, and the 641px anchored-popover boundary. |
| Final visual capture metrics | **24/24 records pass**, including 23 screenshots; 0 horizontal-overflow failures. |

## External-only validation

Physical iOS Safari/PWA and Android Chrome were not available and are not claimed as tested. Real safe-area behavior, native Select presentation, virtual keyboards, touch scrolling, post-tap hover, and physical resize input remain release-environment checks.

## Deployment status

The source, StyleSeed, rendered, and automated gates are green. Local served-app deployment is the next authorized step; deployment evidence is recorded separately after `npm run deploy:local` completes.
