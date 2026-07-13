# UI Polish Decision Lock

> Status: **Approved**
>
> This document is the authoritative design lock for the next UI-polish implementation. It records every decision approved in the review conversation. Application source must not be changed until this document exists and has been checked for completeness.

## 1. Objective

Repair the visual inconsistency and responsive regressions visible in the mobile Explorer, Inspector, Settings, and Run controls while preserving the current product behavior as much as possible.

The intended result is a compact technical UI that looks like one coherent application without introducing decorative cards, nested pills, excessive borders, or explanatory copy.

## 2. Non-goals and behavior-preservation rule

- Preserve the existing navigation model and functional behavior unless a decision below explicitly says otherwise.
- Sessions/Explorer continues to close with `X`.
- Inspector continues to return with a back arrow.
- Settings and Run controls retain their existing modal/sheet roles.
- Browser history, routing, session actions, file actions, model/profile behavior, and panel open/close semantics must remain unchanged.
- The work is visual polishing and responsive-layout repair, not a navigation rewrite.
- Do not add visible labels, helper paragraphs, tooltips, badges, or explanatory prose unless explicitly approved below.
- Accessibility-only names and descriptions such as `aria-label` remain allowed and required even when no visible label is shown.

## 3. Global design language

### D01 — Compact technical density

Use the compact density tier:

- Mobile utility header title: `15px`
- Tab and section title: `13px`
- List item name: `14px`
- Metadata/count: `11–12px`
- Monospace path/value: `12px`
- General utility icons: `16–18px`
- Utility/context row height: `44px`
- Primary list row height: `48px`
- Header icon hit area: `44px`

Do not return to globally enlarged 52–56px list rows or oversized desktop controls unless a specific accessibility target requires a larger hit area.

### D02 — Surface hierarchy

Use **white chrome + neutral content**:

- Header: raised/white surface
- Tab bar: raised/white surface
- Bottom utility bar: raised/white surface
- Main content, context rows, section headers, and lists: neutral page surface
- Selected tab or selected row: one neutral selected background
- Hover: neutral hover background
- Boundaries: single 1px dividers
- No decorative shadows for these structural surfaces
- No card shells around tabs, lists, or section headers

Dark mode must use the equivalent tonal elevation rather than introducing shadows.

### D03 — Monochrome selection and semantic color

- Selection and active navigation use neutral gray backgrounds.
- Do not use accent color for ordinary selection.
- Green/red/warning colors are reserved for real semantic states such as additions, deletions, success, warnings, and errors.
- Apply this rule consistently across Explorer, Inspector, Settings, Run controls, and configuration lists.

### D04 — Radius usage

Radius is allowed only on genuinely independent controls or floating surfaces:

Allowed:

- Inputs
- Selects
- Switches
- Independent primary buttons
- Modal/sheet/dialog outer panel

Not allowed:

- Tabs
- Section headers
- List rows
- Selected rows
- Scope switches
- Structural navigation strips

Avoid nested rounded tracks, pills, and card-in-card compositions.

### D05 — Disabled states

Use readable muted disabled states:

- Labels and current values must remain legible.
- Do not reduce the opacity of the entire row to an unreadable level.
- Disable the actual control and preserve semantic `disabled`/ARIA state.
- Do not use faint `Unavailable` pills.
- Disabled state must not depend only on color.

### D06 — Focus presentation

Approved visual rule:

- Do not use visible focus outlines.
- Use a focus background on the actual interactive control for `:focus-visible`.
- Never focus-highlight the entire dialog panel, sheet, header, or large parent surface.
- Mouse/touch activation must not leave a persistent focus background.
- Selected and selected + focus-visible intentionally use the same selected background.
- No extra border, outline, text-color change, or stronger background is added for selected + focus.

Known trade-off: keyboard focus is not independently visible when it is on an already selected item. This was explicitly accepted during review and must be recorded in accessibility review results rather than silently changed.

### D07 — Hover presentation

- Apply visual hover states only to fine, hover-capable pointers.
- Touch/coarse-pointer interaction must not leave sticky hover styling.
- Hover and focus must never overwrite persistent selected state.

## 4. Shared mobile chrome

### D08 — Behavior-preserving mobile header

Explorer/Sessions and Inspector keep their current behavior but share one visual header contract:

- Header height: `56px`
- Single-row utility header
- Consistent safe-area handling
- Consistent horizontal gutters
- Consistent title typography
- Consistent icon size and hit area
- Consistent lower divider
- Explorer/Sessions retains `X`
- Inspector retains back arrow

### D09 — Header titles

- Explorer/Sessions continues to display the configured app name, currently `Nema`.
- Inspector continues to display the contextual title `Inspector`.
- Typography and alignment are shared even though the text content differs.

### D10 — Header icon buttons

Use ghost icon buttons:

- `44px` hit area
- No default border
- No default background
- Neutral icon color
- Hover/focus-visible may use a background according to D06/D07
- Back, refresh, and `X` share the same visual treatment
- No boxed icon-button row in the resting state

### D11 — New session action

- Display only a plus icon; remove visible `New` text.
- Use the same ghost icon-button shell as other header actions.
- Do not use a filled dark primary button.
- The plus icon may use a slightly darker neutral color or weight than secondary actions.
- Preserve `aria-label="New session"`.

### D12 — Mobile session title centering

- Center the active session title against the viewport, not the remaining flex space.
- Sessions stays in the left action group.
- More and Inspector stay in the right action group.
- Unequal action counts must not move the title.
- Truncate the title before it overlaps either action group.

## 5. Tabs

### D13 — Shared flat full-width tabs

Apply the same contract to:

- Sessions / Explorer
- Changes / Preview / Terminal

Rules:

- Full-width tab bar
- Equal-width options
- Shared height
- Selected state uses one neutral background only
- No radius
- No shadow
- No selected underline
- No selected top/bottom inset line
- No duplicate selection indicator
- Labels use the approved compact tab typography

### D14 — Changes count location

- Remove the file-count badge from the `Changes` tab.
- Show the file count only in the Changes summary row.
- Do not duplicate the same count in the tab and summary.

## 6. Section headers and refresh actions

### D15 — Compact utility section header

Use for both Explorer and Changes:

- Height: `44px`
- Normal title casing: `Explorer`, `Changes`
- Title on the left
- Muted supporting metadata where required
- Refresh action on the right
- Single divider boundary
- No rounded container
- No prominent card surface

### D16 — Refresh visibility and copy

- Sessions mode shows only the session refresh in the top header.
- Explorer mode shows only the file refresh in the Explorer section header.
- Do not show both refresh actions in the same mode.
- Refresh is icon-only.
- Do not add a visible label or explanatory tooltip.
- Preserve a nonvisual accessible name.

## 7. Explorer context and list

### D17 — Project and branch rows

Keep two separate compact utility rows and preserve existing behavior:

- Project path row: `44px`
- Branch/worktree row: `44px`
- Remove excessive gaps between the rows.
- Use shared gutters and icon slots.
- Preserve path truncation.

### D18 — Remove ambiguous branch number

- Remove the unlabeled `15` from the default branch row.
- Default branch row becomes `branch icon · main · chevron`.
- Additional numerical detail, if still needed, belongs inside the existing branch/worktree menu.
- Do not add a visible explanatory label to the compact row.

### D19 — Flat utility list rows

Apply a shared row contract to Explorer and Changes:

- Height: `48px`
- Shared horizontal gutter
- Shared leading/trailing slot geometry
- Single divider between rows
- No card background per row
- No row radius
- Selected row uses one neutral selected background
- Focus/hover follow D06/D07
- Long names and paths truncate cleanly
- Trailing action/stat region has reserved width so text cannot collide with it

Semantic typography may differ:

- Explorer names: sans-serif
- Changes paths: monospace

### D20 — Explorer trailing actions

Preserve direct one-tap behavior:

- Keep direct mention (`@`) and download actions rather than moving them into a More menu.
- Use a consistent trailing action slot.
- Reduce resting contrast so repeated `@` actions do not dominate the list.
- Increase contrast on selected/focused rows only as allowed by D06.
- Show download only on applicable file rows.
- Preserve precise nonvisual accessible names.

## 8. Changes summary and rows

### D21 — Single-line Changes summary

Use one compact line:

`Changes · 65 files · +10666 · -2196 · main`

Rules:

- Keep refresh on the right as an icon-only action.
- Remove redundant `HEAD` text.
- Do not add explanatory copy.
- When space is insufficient, hide branch information first.
- Always prioritize title, file count, addition count, deletion count, and refresh.

### D22 — Changes row selection

- Selected file row uses one neutral selected background.
- No left accent line.
- No shadow.
- No additional selected border.
- Hover/focus must not replace selected background.
- The selected + focus trade-off follows D06.

## 9. Explorer bottom configuration bar

### D23 — Keep only in Explorer/Sessions

- Keep Models / Skills / Plugins / Settings in Explorer/Sessions.
- Do not add this bar to Inspector.
- Inspector continues to return through back navigation.

### D24 — Compact utility-bar treatment

- Keep icons and short visible labels.
- Reduce bar height and vertical padding.
- Apply bottom safe area exactly once.
- Normalize icon size and stroke.
- Present items as neutral configuration actions, not selected navigation tabs.
- Give this bar lower visual priority than the workspace header and content.

## 10. Settings

### D25 — Dismiss behavior

- Keep the top `X`.
- Remove the redundant bottom `Close` button.
- Remove a footer that exists only to hold `Close`.
- A footer is allowed only when the surface has a real Save/Apply/Confirm action that belongs at modal level.

### D26 — Runtime/Web app/Integrations tabs

- Use the shared flat full-width tab contract in D13.
- No rounded segmented track.
- No shadow or underline.

### D27 — Global/Project scope switch

Keep one-tap switching but reduce its visual weight:

- Two options on one line
- Height: `40px`
- Flat structural control
- No rounded outer track
- No pill selection
- Selected option uses one neutral selected background
- Lower hierarchy than Runtime/Web app/Integrations tabs

### D28 — Scope/path spacing

- Preserve scope behavior and path information.
- Remove excessive vertical gaps.
- Long absolute paths remain truncatable and subordinate to the setting name.
- Do not promote paths above the setting hierarchy.

### D29 — Setting metadata

Render Effective / Source / Default as compact inline metadata:

`Effective xhigh · Source global · Default unset`

- Labels are muted.
- Values are monospace.
- The line wraps naturally when needed.
- Remove the large fixed three-column mobile grid.
- No surrounding card or background.

### D30 — Override/New session metadata

These are metadata tags, not buttons.

- Render as plain inline muted text: `Override · New session`.
- No background.
- No border.
- No pill.
- No hover/focus/cursor behavior.

### D31 — Per-setting actions

Use a compact inline action row:

- Align actions to the right.
- Reset: ghost text button.
- Apply: compact primary button.
- Width is based on content, not half the screen.
- Disable Apply when no change exists.
- Remove oversized half-width action boxes and excessive action-area whitespace.

## 11. Run controls

### D32 — Sheet sizing and scroll ownership

- Use a content-sized bottom sheet.
- Let the sheet grow naturally with its content up to a viewport-safe maximum.
- Use exactly one vertical scroll owner after reaching the maximum height.
- Do not distribute sections with `space-between` or forced full-height rows.
- Preserve access to every action in short landscape viewports.
- Opening Profile must not create a second nested vertical scroller or unexpectedly reflow sibling sections.

### D33 — Reasoning and Capability profile layout

Approved mobile layout: clean inline rows.

- Row height: `48px`
- Label on the left
- Current value/control on the right
- Both sides use `min-width: 0`
- Control uses no more than roughly 55% of available width
- Long values truncate with ellipsis
- No horizontal body scrolling
- No negative translation or clipped left labels
- Use a stacked fallback only when the inline row cannot physically fit, such as 200% text zoom

### D34 — Remove default explanatory copy

- Remove the visible `Applied to the current model…` style description from the normal state.
- Display label and current value only.
- Show short visible copy only for an actual error or unsupported condition when required.
- Keep necessary accessible descriptions nonvisually.

### D35 — Execution semantic controls

Use control types that match behavior:

- Prompt editor: trailing chevron; no `Open` text required
- Compact context: trailing `Run` text action; no chevron
- OpenAI Fast: switch
- Completion sound: switch
- All rows share height, alignment, and gutters
- Do not use mixed pills/badges/chevrons for unrelated semantics

### D36 — OpenAI Fast unavailable state

- Use the same switch presentation as Completion sound.
- When unavailable: muted label, switch off and disabled.
- Do not show visible `Unavailable` text or badge.
- Preserve nonvisual accessible explanation.

## 12. Modal system

### D37 — One shared modal contract

Apply to Settings, Run controls, Directory picker, Session commands, and Extension dialogs:

- Shared `56px` mobile header
- Shared title typography
- Shared close-button presentation
- Shared body gutters
- Shared safe-area handling
- Shared body-lock behavior
- Shared focus lifecycle
- Shared scroll ownership rules
- Footer only for real actions
- No panel-wide focus outline or focus background
- Preserve the appropriate fullscreen/sheet/dialog variant for each use case
- Remove or migrate divergent inline modal chrome where practical without changing protocol or workflow behavior

### D38 — Mobile configuration lists

Models, Plugins, Skills, Profiles, and comparable configuration inventories use edge-to-edge flat lists:

- No outer left/right list gutter
- Each row owns `16px` internal horizontal padding
- Single dividers
- One neutral selected background
- No card shells
- No nested rounded containers
- No decorative borders

## 13. Resizable shell

### D39 — Resize availability

- Desktop: Sidebar and Inspector are resizable.
- Tablet/compact layout: Sidebar and Inspector are also resizable, including overlay panels.
- Phone/fullscreen layer: resize is disabled.
- Preserve existing open/close and overlay behavior.
- Support pointer and touch resizing where enabled.

### D40 — Hidden resize handles

- Resize handles are invisible at rest.
- Desktop discovery relies on the edge cursor/hit region.
- Tablet retains an invisible edge touch-drag region.
- Show the rail only during hover or active drag.
- No persistent rail, grip icon, or pill.

### D41 — Center-aware chrome

- Choose desktop versus compact center chrome from the actual center container width, not viewport width alone.
- When panels narrow the center, move secondary actions to More rather than clipping or horizontally scrolling the toolbar.
- Restore desktop chrome when center width is sufficient again.

### D42 — Minimum center width

- Reserve at least `480px` for the center workspace in split desktop/tablet layouts.
- Compute Sidebar and Inspector limits jointly.
- Clamp restored or dragged panel widths when necessary to preserve the center minimum.

## 14. Empty state

### D43 — Centered mobile welcome

- Center the new-session welcome composition in the available content area.
- Center-align app name and guidance.
- Keep the composer at the bottom.
- Do not anchor the welcome block immediately above the composer.

## 15. Visual copy restraint

### D44 — Minimal visible explanation

- Prefer icon, placement, and state over visible instructional copy.
- Refresh uses only an icon.
- New session uses only a plus icon.
- Do not add explanatory labels merely to compensate for inconsistent layout.
- Keep visible text when it is the actual value, title, error, or essential action.
- Preserve nonvisual accessibility labels and descriptions.

## 16. Implementation order

Implementation must be staged in this order:

### Phase 1 — Shared contracts

- Tokens and density
- Surface hierarchy
- Header chrome
- Flat tabs
- Section headers
- Flat list rows
- Focus/hover/selected/disabled rules
- Shared modal contract

### Phase 2 — Explorer, Inspector, and shell

- Explorer header/context/list/footer
- Inspector header/tabs/summary/list
- Refresh scoping
- Changes metadata
- Mobile session centering
- Sidebar/Inspector resizing
- Center-width constraints and center-aware chrome
- Mobile empty state

### Phase 3 — Settings and Run controls

- Settings tabs, scope, metadata, action rows, and footer removal
- Run-controls content sizing, inline fields, scroll ownership, and execution controls
- Edge-to-edge configuration lists
- Modal family migration/polish

### Phase 4 — Visual gate

No deployment may be declared complete until real rendered screenshots are reviewed for:

- 320px phone portrait
- 390px phone portrait
- 430px phone portrait
- Short landscape, including approximately 640×360
- 200% text zoom
- Tablet with panel resize
- Desktop with both panels open
- Desktop with both panels resized to extremes
- Light mode
- Dark mode
- Closed/open/focused/selected/disabled states
- Settings
- Run controls closed/open Profile state
- Explorer
- Inspector Changes
- Long paths and large change counts

The gate must explicitly check:

- No clipping
- No horizontal body scroll
- No unexplained large blank regions
- No panel-wide focus treatment
- No duplicate refresh or close action
- Correct selected-state persistence
- Safe-area applied once
- Reachable final content
- Consistent header/tab/list geometry

### Phase 5 — Automated verification

Required after visual review:

- `git diff --check`
- TypeScript
- ESLint
- Relevant DOM/component tests
- Responsive/layout tests
- Full repository test suites affected by the change

Automated tests do not replace the visual gate.

### Phase 6 — Deployment

- Build only after visual and automated gates pass.
- Restart the actual configured LaunchAgents.
- Verify new process IDs.
- Verify HTTP and relevant APIs.
- Inspect production logs.
- Report physical iOS/Android checks honestly if unavailable; do not represent emulation as physical-device validation.

## 17. Completion rule

The work is complete only when:

1. Every approved decision D01–D44 is mapped to source evidence.
2. All visual-gate screenshots are reviewed.
3. No known responsive or interaction defect remains.
4. Automated checks are green apart from explicitly documented pre-existing warnings.
5. The deployed service is verified.

If a later implementation choice conflicts with this document, stop and ask for a new decision rather than silently changing the approved design.
