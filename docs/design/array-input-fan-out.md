# Array Inputs & Fan-Out Execution — Design Spec

**Date:** 2026-03-19
**Status:** Approved

## Summary

Enable List and Loop nodes as dynamic array inputs in presentation/app mode, with backend orchestrator fan-out and gallery output views. App users can add/remove items (prompts, images, etc.) dynamically, and the workflow fans out to produce multiple results displayed in media-type-aware layouts.

## Goals

1. List node as app input: user enters N text prompts → workflow generates N images/videos/etc.
2. Loop node as app input: user provides N rows of typed data (image+prompt, etc.) → workflow generates N results with correlated data per row.
3. Backend orchestrator fan-out: server-side list expansion for apps, webhooks, and scheduled triggers.
4. Gallery output views: auto-layout by media type (grid/carousel/stacked/collapsible).

## Non-Goals

- New "group" or "array" container node type (reuse existing list/loop)
- Nested fan-out (fan-out within fan-out)
- Parallel iteration execution within a single node (sequential to control credit spikes)

---

## Design

### 1. Loop Node — Typed Columns

**Data model change:**

```typescript
// Current
interface LoopColumn {
  readonly id: string
  readonly name: string
  readonly handleId: string
}

// New
interface LoopColumn {
  readonly id: string
  readonly name: string
  readonly handleId: string
  readonly type: "text" | "image-url" | "video-url" | "audio-url"  // default: "text"
}
```

**Editor UI changes:**
- Column headers show colored type badge (TEXT=cyan, IMAGE=pink, VIDEO=purple, AUDIO=green)
- Click type badge or right-click column header → dropdown to change type
- Table cells render per type:
  - `text` → text input (current behavior)
  - `image-url` → thumbnail preview + filename, or upload zone / paste URL if empty
  - `video-url` → play icon + filename, or upload zone
  - `audio-url` → play icon + filename, or upload zone
- Default column type is `"text"` for backwards compatibility

### 2. List & Loop as Presentation Inputs

**Remove from exclusion list:**

In `packages/shared/src/presentation-utils.ts`, remove `"list"` and `"loop"` from `ALWAYS_EXCLUDED_TYPES`. Do NOT add them to `INPUT_NODE_TYPES` — they rely solely on the explicit `presentationInput` flag (the newer opt-in path). The `getInputNodes()` function already supports this: if `n.data.presentationInput === true` it returns the node regardless of type.

**Node Picker Dialog:**

List and loop nodes appear under a new "Array Inputs" section with type badges and metadata:
- List: shows item count + max
- Loop: shows column count + types + max rows

**New input card components:**

**ListInputCard:**
- Numbered text entries, full-width
- "+" Add button (pink, brand accent)
- "×" Remove per item (text "Remove" button on mobile for larger tap target)
- "N of M max" counter
- Live credit estimate: `N × per-item-cost = total CR`
- Min 1 item required

**LoopInputCard:**
- Each row rendered as a card with labeled fields
- Fields stack vertically (always on mobile, responsive on desktop)
- Per-column rendering based on column type:
  - `text` → textarea
  - `image-url` → upload zone with thumbnail preview
  - `video-url` → upload zone with video preview
  - `audio-url` → upload zone with audio player
- "+" Add Row button, "Remove" per row
- Same counter + credit estimate pattern

**Mobile adaptations:**
- Full-width stacked layout, no side-by-side columns
- 44px+ tap targets, "Remove" as text button (not tiny ×)
- 14px font on inputs (prevents iOS auto-zoom)
- "Tap to upload" instead of "drag & drop"
- 56px thumbnails (vs 32px desktop)

### 3. Limits

**Two-tier limit system:**

| Level | Field | Location | Default |
|-------|-------|----------|---------|
| Per-node (creator) | `maxItems` | `ListNodeData` / `LoopNodeData` | 10 |
| System ceiling (admin) | `max_fanout_items` | `app_settings` table | 20 |

- Effective max = `Math.min(node.maxItems ?? 10, systemMax)`
- Add button disabled when at max
- Counter shows "N of M max"
- Config panel shows "Max items in app mode" number input with system ceiling reference

### 4. Input Value Storage

**presentationStore / run slots:**

```typescript
// List node
inputValues[listNodeId] = {
  items: ["prompt A", "prompt B", "prompt C"]
}

// Loop node
inputValues[loopNodeId] = {
  rows: [
    ["https://img1.jpg", "sunset prompt"],
    ["https://img2.jpg", "ocean prompt"]
  ]
}
```

- Tab mode: updates `node.data.items` (list) or `node.data.rows` (loop) directly
- App runner: updates `presentationStore.inputValues`, saved to run slot on execution
- Before orchestrator execution: list/loop node data patched with user-provided values

### 5. Backend Orchestrator Fan-Out

**Existing infrastructure (already implemented):**
- `NodeOutput.listResults?: string[]` in `types.ts` — accumulated fan-out results
- `input-resolver.ts` lines 62-73 — downstream routing based on `edge.data.outputMode` + `state.output.listResults`
- `output-extractor.ts` — `extractSourceNodeOutputAsList()` for list/loop/split-text source nodes

**What's new:** The orchestrator's `node-executor.ts` must detect fan-out and run N iterations (currently it only passes through single values).

**Execution flow:**

1. **Detect** — In `node-executor.ts`, before executing a node, call `getListInputForNode()`. If items[] returned and edge outputMode is "each", enter fan-out loop.
2. **Iterate** — For each item: build payload with `overridePrompt` (text) or `overrideMediaUrl` (URL-like), execute via same node-executor path. Sequential within node. Check `ctx.cancelled` before each iteration.
3. **Collect** — Store results in existing `nodeStates[nodeId].output.listResults[]`. Set `output.text` / `output.url` to first result for backwards compatibility.
4. **Downstream** — Already implemented: `input-resolver.ts` resolves from `listResults` based on edge outputMode:
   - `"each"` → downstream also fans out, **zipped by index** (item[i] → downstream iteration[i], producing N results not N×N)
   - `"all"` → `listResults.join(", ")`
   - `"last"` → `listResults[listResults.length - 1]`
   - `"item:N"` → `listResults[N]`

**Edge outputMode in app mode:** Edge data (including outputMode) is frozen in the workflow snapshot at publish time. App users have no access to edge configuration. The published app uses whatever outputMode the creator set in the editor.

**Progress tracking additions to NodeExecutionState:**

```typescript
interface NodeExecutionState {
  // ... existing fields ...
  iterationTotal?: number            // total fan-out iterations
  iterationCompleted?: number        // completed so far (for progress UI)
}
```

These fields are on `NodeExecutionState` (the per-node status in `node_states` JSONB), NOT on `NodeOutput`. The actual results go in `NodeOutput.listResults` (existing field).

**Cancellation & partial failure:**
- Check `ctx.cancelled` before each iteration — if cancelled, stop and preserve completed results
- If iteration K of N fails, iterations 1..K-1 results are preserved in `listResults`
- Execution status set to "failed" with partial results available for display
- Each iteration charges credits independently — failed iterations after credit reservation get refunded per existing refund flow

**Key constraints:**
- Sequential iteration execution within a node (avoids credit spikes)
- Parallel across independent nodes in the same DAG level (existing behavior)
- Frontend DAG executor unchanged — existing fan-out keeps working
- 15min per-node timeout (`NODE_TIMEOUT_MS`) applies to all iterations combined
- Per-iteration credit charging (each iteration is a separate job)

### 6. Output Display

**Two display modes per output node:**

| Mode | Behavior |
|------|----------|
| **Gallery** | All results in one card, auto-layout by media type |
| **Individual Cards** (default) | One card per result (current clone behavior) |

Default is "individual" for backwards compatibility — existing published apps see no change. Missing `outputDisplayModes` entry = "individual".

**Auto layout by media type (Gallery mode):**

| Output Type | Layout | Details |
|-------------|--------|---------|
| Image | Grid | 3-col desktop, 2-col mobile. Click opens lightbox. |
| Video | Carousel | Prev/next arrows, thumbnail strip. "1/N" counter. Swipe on mobile. |
| Audio | Stacked list | Inline player per result with progress bar and duration. |
| Text | Collapsible sections | First expanded, rest collapsed with preview snippet. |

**Single result = current output card (no change).**

**Settings storage:**

```typescript
// presentationSettings additions
{
  outputDisplayModes: {
    [nodeId]: "gallery" | "individual"
  }
}
```

**Creator configures in output node picker:** after checking an output node, a "When multiple results" toggle appears with Gallery / Individual Cards options.

---

### 7. Edge Cases

**Empty / single item:**
- 0 items: validation blocks execution ("At least 1 item required")
- 1 item: no fan-out — executes once normally (existing behavior: `getListInputForNode()` returns `undefined` for single item)
- Loop with empty rows: validation requires all columns filled in all rows (media-url columns must have a URL)

**Validation rules for `areAllInputsFilled()`:**
- List: at least 1 non-empty item
- Loop: at least 1 row, every cell in every row must be non-empty (text must have content, URLs must be valid)

**Credit estimate in app mode:**
- `getFanOutMultiplier()` already exists in frontend — reads list length dynamically
- Credit estimate updates reactively as items are added/removed (recalculates on each render)
- Estimate covers immediate fan-out node only, not full downstream chain (too complex, matches current editor behavior)

**Progress during fan-out:**
- Output card shows "3/10 generated" progress (reads `iterationCompleted` / `iterationTotal` from nodeStates)
- Individual results appear as they complete (gallery view populates incrementally)

**Media uploads in loop cells:**
- Same R2 upload flow as existing upload nodes (via `useMediaUpload` shared hook)
- Uploads tied to the user's account, cleaned up by existing R2 cleanup cron if no job references them

---

## Files to Modify

### Shared Package
- `packages/shared/src/presentation-utils.ts` — Remove list/loop from ALWAYS_EXCLUDED_TYPES; add new `ArrayInputFieldSchema` type alongside existing `InputFieldSchema` for list/loop (distinct from scalar inputs)

### Frontend — Types
- `frontend/src/types/nodes.ts` — Add `type` to LoopColumn, `maxItems` to ListNodeData/LoopNodeData

### Frontend — Editor (Loop Node)
- `frontend/src/components/nodes/loop-node.tsx` — Typed column cells (upload zones, thumbnails, audio players)
- `frontend/src/components/editor/config-panels/input-configs.tsx` — Column type selector, max items setting

### Frontend — Presentation
- `frontend/src/components/presentation/input-cards/list-input-card.tsx` — New: dynamic list input
- `frontend/src/components/presentation/input-cards/loop-input-card.tsx` — New: dynamic loop input with typed fields
- `frontend/src/components/presentation/input-card.tsx` — Add list/loop cases to dispatcher
- `frontend/src/components/presentation/node-picker-dialog.tsx` — Array Inputs section
- `frontend/src/components/presentation/output-cards/` — Gallery views (grid, carousel, stacked, collapsible)
- `frontend/src/components/presentation/presentation-view.tsx` — Output display mode toggle, render gallery vs individual
- `frontend/src/components/presentation/helpers.ts` — Validation for list/loop inputs (min 1 item, all required fields filled)

### Frontend — Workflow Store
- `frontend/src/hooks/use-workflow-store.ts` — presentationSettings.outputDisplayModes
- `frontend/src/hooks/use-presentation-store.ts` — Support new inputValue shapes for list (items[]) and loop (rows[][])

### Frontend — App Runner
- `frontend/src/components/app-runner/use-run-slots.ts` — Handle list/loop inputValues, patch node data before execution
- `frontend/src/components/app-runner/types.ts` — `makeEmptyInputs()` and `makeSnapshotInputs()` for list/loop; `RunSlotNodeState` to carry `listResults`

### Backend — Orchestrator
- `backend/src/services/workflow-engine/node-executor.ts` — Fan-out detection + iteration loop (main new logic)
- `backend/src/services/workflow-engine/types.ts` — `iterationTotal` / `iterationCompleted` on NodeExecutionState (for progress)
- `backend/src/workers/orchestrator-worker.ts` — Persist iteration progress to DB between iterations

### Backend — Database
- Supabase migration: insert `max_fanout_items` = 20 into `app_settings` table
