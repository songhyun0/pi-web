# Pi Web UI Primitives

Project-owned StyleSeed primitives for the Technical design lock. Import components from `@/components/ui`.

## Sources of truth

- `STYLESEED.md` — product and interaction decisions
- `styleseed/tokens.json` — token source values
- `app/design-tokens.css` — runtime CSS implementation
- `components/ui/primitives.css` — primitive anatomy and states

Keep token JSON and CSS synchronized. Components must use semantic tokens rather than local hex colors.

## Controls

- `Button` / `IconButton`: `primary`, `secondary`, `ghost`, and `danger`; `compact`, `default`, and `touch` sizes.
- `Field` + `Input` / `Select` / `Textarea`: persistent labels, linked hints/errors, and visible invalid state.
- `Switch`: reversible boolean action with text label and optional description.
- `SegmentedControl`: keyboard-navigable single selection for small option sets such as Global/Project.

Pointer-first controls are dense. Coarse-pointer controls automatically meet the 44px touch target.

## Feedback

- `Badge`: compact text status; pills are reserved for this role.
- `Notice`: icon + text feedback so meaning never depends on color alone.
- `EmptyState`: focused title, recovery guidance, and one optional action.
- `Skeleton`: non-blocking loading placeholder with reduced-motion support.

## Dialog surfaces

`Dialog` owns portal rendering, focus entry/trapping/restoration, Escape/backdrop dismissal, nested-dialog stacking, and body scroll lock.

- `dialog`: centered at every viewport.
- `adaptive`: centered on desktop, full-screen on phones; use for complex settings.
- `sheet`: centered on desktop, bottom sheet on phones; use for short choices and confirmations.
- `fullscreen`: full viewport at every size.

Browser-history integration belongs to the feature navigation layer, not the visual dialog primitive.
