# Table Node Display & Presentation Sizing

## Summary

Two intertwined improvements:

1. **Table node display upgrades** — editor canvas toggle (info ↔ data preview), two presentation view modes (rich cards + traditional table)
2. **General presentation display settings** — any node with `presentationInput`/`presentationOutput` gets configurable grid columns and element sizing, stored per-node with per-card overrides

## Data Model

### PresentationDisplay type

```typescript
interface PresentationDisplay {
  columns?: 1 | 2 | 3 | 4          // cards per row (default: auto based on type)
  elementSize?: "sm" | "md" | "lg"  // media element size within cards (default: "md")
  viewMode?: string                 // node-type-specific, e.g. "cards" | "table" for loop
}
```

### Storage

1. **Node data** — `node.data.presentationDisplay: PresentationDisplay` — builder sets defaults in the config panel
2. **Card meta override** — `presentationSettings.cardMeta[nodeId].display: Partial<PresentationDisplay>` — per-card override in presentation edit mode

### Resolution

Merge `cardMeta.display` over `node.data.presentationDisplay`, then apply auto-defaults when neither is set:

| Node type | Default columns | Default elementSize | Default viewMode |
|-----------|----------------|--------------------|--------------------|
| Image output | 2 | md | — |
| Video output | 1 | md | — |
| Audio output | 1 | md | — |
| Text output | 1 | — | — |
| Loop (has image cols) | 1 | md | cards |
| Loop (text-only cols) | 1 | md | table |

## Editor — Table Node Canvas Preview

The loop node component (`loop-node.tsx`) adds a toggle between two views.

### Info view (current default)

Unchanged: row × column count, column type badges.

### Data view

- Mini spreadsheet rendered inline on the canvas node
- All rows shown; node height grows with content, capped at ~200px with vertical scroll
- Column headers with type badges (TXT, IMG, VID, AUD)
- Image/video/audio cells: 24×24 thumbnails
- Text cells: truncated single-line text
- Toggle: small icon button (e.g. `Table2` / `Info` lucide icons) in the node header

### Config panel data tab

The config panel (`input-configs.tsx` `LoopConfig`) adds a "Data" tab alongside the existing column/row editor:

- Read-only formatted table view of current data
- Larger and more readable than the canvas preview
- Useful for verifying data without entering presentation mode

### Persistence

Toggle state is ephemeral (React state), not saved to workflow.

## Presentation/App Mode — Table Views

The `LoopInputCard` is rebuilt to support two view modes controlled by `presentationDisplay.viewMode`.

### Cards view (`viewMode: "cards"`)

- Each row renders as a horizontal card
- Image columns display large, sized by `elementSize`:
  - sm: 64px
  - md: 128px
  - lg: 256px
- Text columns stack vertically beside the image
- If no image columns, cards show text fields in a clean vertical layout
- Editable inputs: textarea for text, existing media upload for image/video/audio
- Add/remove row buttons maintained
- `columns` setting controls cards per row (1 = full-width list, 2+ = grid)

### Table view (`viewMode: "table"`)

- Proper HTML table with column headers (name + type badge)
- Image cells show thumbnails sized by `elementSize`:
  - sm: 40px
  - md: 64px
  - lg: 96px
- Text cells are inline-editable inputs
- Striped rows, sticky header on scroll
- Add/remove row controls at bottom + per-row delete button
- `columns` setting is ignored (table is always full-width)

### Default behavior

When `viewMode` is not set: default to `"cards"` if any column has type `image-url`, `video-url`, or `audio-url`; default to `"table"` otherwise.

## General Display Settings for All Node Types

Every node with `presentationInput` or `presentationOutput` gets access to `presentationDisplay` settings.

### Available controls per node type

| Node Type | Columns | Element Size | View Mode |
|-----------|---------|-------------|-----------|
| Image output | 1–4 (default 2) | sm/md/lg image | — |
| Video output | 1–4 (default 1) | sm/md/lg player | — |
| Audio output | 1–4 (default 1) | sm/md/lg player | — |
| Text output | 1–4 (default 1) | — | — |
| Table/Loop input | 1–4 (default 1) | sm/md/lg media | cards / table |

### Builder configuration — config panel

New "Presentation" section at the bottom of each node's config panel. Only visible when the node has `presentationInput` or `presentationOutput` set. Contains:

- **Columns** — 1–4 button group
- **Element Size** — S / M / L button group (hidden for text-only nodes)
- **View Mode** — dropdown or button group (only shown for node types with multiple view modes, currently only loop)

### Builder configuration — presentation edit mode

The existing card gear/edit UI in presentation view gets the same controls as overrides, stored in `cardMeta[nodeId].display`.

### Fan-out outputs

When a node produces multiple results from list execution, `columns` controls the result grid layout (e.g., 3 generated images in a 3-column grid vs single-column list).

## Element size mapping reference

| Context | sm | md | lg |
|---------|----|----|-----|
| Cards view — image | 64px | 128px | 256px |
| Table view — thumbnail | 40px | 64px | 96px |
| Canvas data preview | 24px | 24px | 24px |
| Image output card | 200px max-h | 400px max-h | 70vh max-h |
| Video output card | 200px max-h | 400px max-h | 70vh max-h |
| Audio output card | 40px player height, no waveform | 56px player height, mini waveform | 80px player height, full waveform |

## Files to modify

### Types
- `frontend/src/types/nodes.ts` — add `PresentationDisplay` interface, add `presentationDisplay` to node data types

### Editor — table node
- `frontend/src/components/nodes/loop-node.tsx` — add info/data toggle, inline data table
- `frontend/src/components/editor/config-panels/input-configs.tsx` — add "Data" tab to LoopConfig

### Presentation display settings
- `frontend/src/components/editor/config-panel.tsx` — render "Presentation" section for nodes with presentation flags
- `frontend/src/components/presentation/input-card.tsx` — pass display settings to input cards
- `frontend/src/components/presentation/output-card.tsx` — apply columns/element size to output cards
- `frontend/src/components/presentation/node-section.tsx` — apply grid columns to card containers; update sortable strategy for grid layout when columns > 1

### App runner
- `frontend/src/components/app-runner/mobile-app-shell.tsx` — pass display settings to InputCard/OutputCard (same props as presentation-view)

### Table presentation views
- `frontend/src/components/presentation/input-cards/loop-input-card.tsx` — rebuild with cards/table dual view

### Presentation edit mode
- `frontend/src/components/presentation/sortable-card-wrapper.tsx` — add display override controls in edit mode
- Workflow store `cardMeta` type — extend with `display: Partial<PresentationDisplay>`

### Output card sizing
- `frontend/src/components/presentation/output-cards/image-output-card.tsx` — respect elementSize
- `frontend/src/components/presentation/output-cards/video-output-card.tsx` — respect elementSize
- `frontend/src/components/presentation/output-cards/audio-output-card.tsx` — respect elementSize
- `frontend/src/components/presentation/output-cards/image-grid-output.tsx` — respect columns + elementSize
- `frontend/src/components/presentation/output-cards/gallery-output-card.tsx` — respect columns + elementSize

## Published apps

`presentationDisplay` lives on `node.data`, which is persisted in the workflow's `nodes` JSONB column. Published app snapshots (`published_apps.nodes`) copy the full JSONB, so display settings are automatically included. The app-runner rendering path must consume display settings from the snapshot — no additional snapshotting logic needed.

## Responsive behavior

On narrow viewports (mobile app-runner shell, <640px), `columns` clamps to a max of 2 regardless of the builder's setting. This prevents 3- or 4-column grids from becoming unusable on small screens.

## Out of scope

- Backend changes (no new routes, no DB schema changes)
- New node types
- Drag-to-resize or pixel-level sizing
- View mode options for non-table nodes (only table gets cards/table for now)
