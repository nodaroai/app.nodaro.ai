# Component Marketplace Preview — Design

**Date:** 2026-04-13
**Status:** Proposed

## Problem

The component marketplace makes it hard to understand what a component actually does before adding it to a workflow.

Two surfaces both have gaps:

1. **Fullscreen marketplace** (`ComponentMarketplaceModal` with `variant="fullscreen"`, opened from the canvas toolbar). Cards show name, preview media, and output-type pills, but never show the component's **inputs**, **outputs**, or exposed **settings**. The description is rendered but is clamped to two lines and disappears behind a hover overlay. Clicking a card adds the component immediately — users have no chance to review what they're picking.

2. **Popup marketplace** (`ComponentMarketplaceModal` with `variant="popup"`, opened from the add-node / right-click menu). Each list item shows the component name plus the creator's display name. The creator name isn't useful for deciding whether to add the component — the description would be.

Both gaps are about the same root question: "what does this component do?". All the data needed to answer it (`description`, `componentMetadata.inputs/outputs/exposedSettings`, `previewMediaUrl`) is already on the `AppBrowseCard` returned by the marketplace API — it just isn't rendered.

## Goals

- Let users understand a component's purpose, inputs, outputs, and settings *before* adding it.
- Keep the existing fast path for power users who already know what they want.
- Zero new API calls: use data already on `AppBrowseCard`.

## Non-goals

- No "run the component from the marketplace" interaction. The preview is read-only; running requires auth, credits, and orchestration.
- No new published-app data capture (first-run example inputs, screenshots, etc.). Use only what the card already carries.
- No changes to how components are authored or published.

## Design

### Surface 1 — Fullscreen marketplace: Component Preview Modal

**New interaction:**

| User action | Result |
|-------------|--------|
| Single click on grid card | Opens preview modal (does **not** add component) |
| Double click on grid card | Adds component directly, closes marketplace (skips preview) |
| Click "+ Add to Workflow" in preview modal | Adds component, closes modal and marketplace |
| Click outside / Esc / × in preview modal | Closes preview modal, returns to marketplace grid |

The `onSelect` callback (which adds the component to the canvas) fires only from the "+ Add to Workflow" button or a grid double-click.

**Modal layout (desktop):**

```
┌─────────────────────────────────────────────────────────────────┐
│ [icon] Component Name                           ♥   ✕           │
│ by Creator · 5 CR · Category pill                               │
│ Full description (no line clamp).                               │
│ Falls back to italic "No description provided." when empty.     │
├─────────────────────────────────────────────────────────────────┤
│  INPUTS                          │  PREVIEW                     │
│  ◦ [img] Reference Image · req   │  ┌───────────────────────┐   │
│  ◦ [txt] Prompt · req            │  │                       │   │
│  ◦ [img] Style Reference         │  │   previewMediaUrl     │   │
│                                  │  │   (image or video,    │   │
│  OUTPUTS                         │  │    16:9)              │   │
│  ◦ [img] Generated Image         │  │                       │   │
│  ◦ [txt] Caption                 │  └───────────────────────┘   │
│                                  │                              │
│  SETTINGS (3)                    │                              │
│  ◦ Aspect ratio                  │                              │
│  ◦ Quality                       │                              │
│  ◦ Style                         │                              │
├─────────────────────────────────────────────────────────────────┤
│                                    [ + Add to Workflow ]        │
└─────────────────────────────────────────────────────────────────┘
```

On mobile the two columns stack: header → preview → inputs → outputs → settings → CTA (preview stays near the top so the primary visual isn't pushed below the fold).

**Row format:**

- Inputs / outputs: `[type icon] [handle name] [· required pill if input && required]`. Type icon reuses `OUTPUT_TYPE_ICON` (image / video / audio / text).
- Settings: `[label]` only — no icon and no required pill. `ExposedSetting.type` is a different enum (`select | text | number | toggle | aspect-ratio`) not covered by the media-type icon map, and settings always have defaults.

Handle/label text uses `truncate` + a `title` attribute with the full string for hover tooltip.

Sections hide themselves when their list is empty. If all three sections (`inputs`, `outputs`, `exposedSettings`) are empty, show a single line: *"No metadata published for this component."*

**Preview pane:**

- If `previewMediaUrl` exists: render identically to `AppMarketplaceCard`'s preview block (autoplay + loop for video, `object-cover`, 16:9 aspect). Same renderer apps already use.
- If absent: centered "No preview available" placeholder with a Sparkles icon, matching the existing `AppMarketplaceCard` empty state.

**Data source:**

The modal reads everything from the `AppBrowseCard` object that the grid already has in memory. No new fetch. Fields used:

| Field | Where shown | Fallback |
|-------|-------------|----------|
| `name` | Header | — (required) |
| `iconUrl` | Header (leading 20×20 thumb) | `<Puzzle />` — same pattern as `ComponentListItem` line 188-192 |
| `description` | Header (full, `whitespace-pre-wrap`) | italic "No description provided." |
| `creatorDisplayName` | Header subtitle ("by X") | `"Community"` — same fallback as popup |
| `estimatedCredits` | Header subtitle | 0 rendered as "0 CR" |
| `category` | Header subtitle pill | Label `"Other"` + `CATEGORY_COLORS.other` — same pattern as `AppMarketplaceCard` line 22-23 |
| `previewMediaUrl` + `previewMediaType` | Preview pane | "No preview available" placeholder with Sparkles icon |
| `componentMetadata.inputs` | Inputs section | Hidden if empty; "No metadata published" if all three empty |
| `componentMetadata.outputs` | Outputs section | Hidden if empty |
| `componentMetadata.exposedSettings` | Settings section | Hidden if empty |
| `id` | Favorite toggle target | — (required) |

**My Components tab:** preview is **not** added here. That tab uses a custom `renderCard` (not `AppMarketplaceCard`) with Open/Edit/Archive buttons, and owners already have the "Open" button that navigates to `/app/:slug` — richer than our read-only preview. The popup marketplace and the fullscreen Browse/Favorites tabs are the only surfaces that get the new behavior.

### Surface 2 — Popup marketplace: description instead of creator name

In `ComponentListItem` (currently showing `{card.name}` over `{card.creatorDisplayName || "Community"}`), replace the second line:

```
card.description || card.creatorDisplayName || "Community"
```

Single line, truncated with `truncate`, same font size and color. Preserves the fallback ladder so the row is never visually empty.

No other popup changes.

## Component Boundaries

All new code lives inside the existing `ComponentMarketplaceModal` file tree to keep the change focused:

- **`component-preview-modal.tsx`** (new, ~150 lines) — the preview modal itself. Props: `{ card: AppBrowseCard | null; isFavorited: boolean; onToggleFavorite: (id) => void; onAdd: (card) => void; onClose: () => void }`.
  - Renders its own portal on `document.body` (matches existing pattern) with z-index one layer above the marketplace — use `z-[60]` (marketplace is `z-50`).
  - Dialog container: centered, `max-w-3xl w-full mx-4`, body uses `max-h-[85vh] overflow-y-auto` so long descriptions scroll instead of pushing the CTA off-screen (matches the `max-h-[85vh]` used by `ComponentEditDialog`).
  - Description rendered as plain text with `whitespace-pre-wrap` to preserve publisher-entered newlines (no markdown interpretation).
  - Accessibility: outer container gets `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing to the header's `h2` id. Focus moves to the Add button on mount.
  - Reuses `OUTPUT_TYPE_ICON`, `CATEGORY_COLORS`, `APP_CATEGORIES` already imported in the marketplace modal. Reuses the preview-media render block by lifting it into a tiny shared helper (or copy-pasting — the block is ~15 lines).
  - Reads `componentMetadata` via the same safe-default cast pattern used by `browseCardToSelection` (`const meta = (card.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }) as unknown as ComponentMetadata`).

- **`component-marketplace-modal.tsx`** (edit) — state: `const [previewCard, setPreviewCard] = useState<AppBrowseCard | null>(null)`. Grid `onClick` sets `previewCard`; `onDoubleClick` (React prop name) calls the old `handleSelectBrowseCard` directly. Render `<ComponentPreviewModal>` alongside existing content. The existing Esc-closes-marketplace effect must short-circuit while `previewCard !== null` (add `previewCard` to the deps array and early-return when it's set), so Esc only closes the preview.

- **`AppMarketplaceCard`** (edit) — add an optional `onPreview?: (card) => void` prop. When present, single click fires `onPreview` instead of `onSelect`; React's `onDoubleClick` on the outer div fires `onSelect`. Apps page (`/apps`) doesn't pass `onPreview`, so its single-click-navigates-to-/app/:slug behavior is unchanged. Existing hover overlay stays as-is (instant info at a glance is still useful, and removing it is out of scope).
  - **Favorite button propagation:** the favorite button currently stops only `onClick`. Because the parent div now also handles `onDoubleClick`, the button must also `stopPropagation()` on `onDoubleClick` — otherwise a user double-clicking the heart would toggle the favorite twice and also add the component to the canvas. Add `onDoubleClick={(e) => e.stopPropagation()}` to the favorite button.

- **`ComponentListItem`** (edit) — one-line swap to use `card.description` with fallback.

## Edge Cases

- **Component with no `componentMetadata`:** `browseCardToSelection` already defaults to `{ inputs: [], outputs: [], exposedSettings: [] }`. Preview modal renders the "No metadata published" fallback.
- **Required pill on outputs:** outputs don't have a meaningful "required" concept — ignore `required` for output rows.
- **Long handle names:** `truncate` on the row, full name in `title` attribute for hover tooltip.
- **Preview video on mobile:** inherits the existing `muted`/`playsInline` attributes from the shared render block — no autoplay issues.
- **Keyboard navigation:** arrow-key + Enter nav only exists in the popup variant (not fullscreen), and the popup isn't gaining preview behavior, so that loop is untouched. In the fullscreen preview modal, Esc closes the preview only; the marketplace's Esc effect short-circuits while `previewCard !== null`.
- **Click vs. double-click race:** the browser fires two `click` events before firing `dblclick`, so a naïve handler opens the preview on click #1 and then adds on dblclick. Two acceptable implementations — pick one:
  - **(a) Debounced click:** wrap the `onClick` in a ~250ms `setTimeout`, cancel it from `onDoubleClick`. Tradeoff: every single-click feels slightly laggy.
  - **(b) Instant open, cleanup-on-dblclick:** fire `onClick` immediately (modal opens), and `onDoubleClick` closes the preview and calls add. Tradeoff: a <100ms modal flash during a double-click; no lag on single-click.
  Recommendation: (b) — single-click responsiveness matters more than a brief flash. Implementer may swap to (a) if the flash is visually objectionable.
- **Favorite toggle inside preview:** same `favMutation` the grid uses; reads `favSet` from the marketplace modal's scope and passes the boolean in.

## Testing

This is a presentational change — all logic is a trivial `a || b || c` fallback and UI wiring. No unit tests; validate manually in the dev server per the project's UI-change convention.

**Manual test checklist:**
- Single click on fullscreen card opens preview.
- Double click on fullscreen card skips preview and adds.
- "+ Add to Workflow" in modal adds and closes.
- Esc / × / backdrop closes preview without adding.
- Preview with no `componentMetadata` shows fallback.
- Preview with no `previewMediaUrl` shows placeholder.
- Popup list item shows description; falls back to creator when description empty; falls back to "Community" when both empty.
- Favorite toggle works from both the grid card and inside the preview.
- Double-clicking the favorite heart on a grid card toggles the favorite (twice) but does NOT add the component to the canvas.
- Marketplace Esc does not fire while preview is open (preview captures it).
- My Components tab: preview NOT opened from these cards (unchanged behavior).
- Apps page (`/apps`): single click still navigates to `/app/:slug` (unchanged behavior).

## Out of Scope

- "Try it" link to `/app/:slug` from the preview — easy follow-up later; keeping initial diff small.
- Richer input rendering (actual disabled `InputCard` components) — intentionally skipped per design call.
- Capturing real first-run example inputs/outputs at publish time — separate feature.
- Apps marketplace (`/apps` page) behavior — unchanged.
