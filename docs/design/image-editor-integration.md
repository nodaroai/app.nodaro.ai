# Filerobot Image Editor Integration

**Date:** 2026-03-25
**Status:** Draft

## Summary

Integrate [react-filerobot-image-editor](https://github.com/scaleflex/filerobot-image-editor) as a lazy-loaded image editing modal, mirroring the FreeCut video editing pattern. Users can crop, rotate, filter, annotate, and adjust images directly in the browser — 0 credits, pure client-side processing.

## Scope

### Nodes with Edit Button

All image-producing nodes:

**Primary image nodes:**
- `generate-image-node`
- `image-to-image-node`
- `edit-image-node`
- `upload-image-node`

**Entity nodes** (generate reference images):
- `character-node`
- `face-node`
- `object-node`
- `location-node`

### Credits

0 credits — client-side processing only, no backend/AI involvement. Same precedent as FreeCut.

## Architecture

### Store State

Add to `use-workflow-store.ts`, mirroring `freecutEdit`:

```typescript
imageEdit: {
  nodeId: string
  imageUrl: string
  designStateUrl?: string  // R2 URL to saved Filerobot designState JSON
} | null

openImageEdit: (nodeId: string, imageUrl: string, designStateUrl?: string) => void
closeImageEdit: () => void
```

### GeneratedResult Extension

Add `filerobotDesignStateUrl` to `GeneratedResult` in `types/nodes.ts`:

```typescript
export interface GeneratedResult {
  readonly url: string
  readonly thumbnailUrl?: string
  readonly timestamp: string
  readonly jobId: string
  readonly freecutProjectUrl?: string
  readonly filerobotDesignStateUrl?: string  // NEW
}
```

### Modal Component

**File:** `frontend/src/components/editor/filerobot-editor-modal.tsx`

- Fullscreen overlay matching FreeCut modal styling
- Lazy-loaded via `lazyWithRetry` in `workflow-editor-main.tsx` (auto-retry on chunk errors after deploy, matching codebase pattern)
- Renders `<FilerobotImageEditor>` with:
  - `source={imageUrl}` — the image to edit
  - `loadableDesignState` — parsed object (NOT a URL). The modal must fetch the JSON from `designStateUrl`, parse it, and pass the resulting object. Use a `useEffect` + `useState` to fetch on mount, render editor only after fetch completes (or immediately if no `designStateUrl`)
  - `onSave(editedImageObject, designState)` — custom save flow (see below). Do NOT use `onBeforeSave` — returning `false` there blocks `onSave` from firing entirely
  - `onClose(closingReason, hasUnsavedChanges)` — confirmation dialog if unsaved
  - `closeAfterSave={false}` — we control close timing
  - `tabsIds` — all tabs: Adjust, Annotate, Filters, Crop, Rotate, Watermark
  - `theme` — reactive dark/light theme object (see Theming)
  - No `noCrossOrigin` prop — R2 images require `crossOrigin="anonymous"` (Filerobot defaults to setting it, which is correct)

### Save Flow

1. `onSave` fires with `editedImageObject` (contains `imageBase64`) + `designState`
2. Convert base64 → `File` blob (`filerobot-edit.png`, type `image/png`)
3. Upload image via `uploadFile(file, userId)` → R2 URL (may throw `StorageExceededError`)
4. Upload `designState` JSON via `POST /v1/upload-json` → R2 URL (reuses existing endpoint)
5. Create `GeneratedResult`:
   ```typescript
   {
     url,
     jobId: `filerobot-edit-${Date.now()}`,
     timestamp: new Date().toISOString(),
     filerobotDesignStateUrl: designStateUrl,
   }
   ```
6. Append to node's `generatedResults`, set as active, update legacy URL field per node type:
   - Primary image nodes (`generate-image`, `image-to-image`, `edit-image`): update `generatedImageUrl`
   - Entity nodes (`character`, `face`, `object`, `location`): update `sourceImageUrl`
   - Upload image: update `generatedImageUrl` (newly added, see below)
7. Show brief "Saved" feedback, then close modal

### Image Node Integration

Add a **Pencil** icon button to the hover overlay on all 8 image nodes:

- Position: bottom-left group, alongside Expand/Download/Copy URL
- Icon: `Pencil` from lucide-react
- Action: `openImageEdit(nodeId, activeUrl, activeResult?.filerobotDesignStateUrl)`
- Only visible when an active image result exists

### Modal Mounting

In `workflow-editor-main.tsx`, alongside FreeCut:

```tsx
{isImageEditOpen && (
  <Suspense fallback={null}>
    <FilerobotEditorModal
      imageUrl={imageEditUrl}
      designStateUrl={imageEditDesignStateUrl}
      onSaveComplete={handleImageEditSave}
      onClose={handleImageEditClose}
    />
  </Suspense>
)}
```

## Theming

Reactive dark/light theme using `useTheme().resolvedTheme` from `next-themes`. Colors match the app's CSS vars from `globals.css`.

**Dark mode:**

| Key | Value | Source |
|-----|-------|--------|
| `bg-primary` | `#121212` | App bg |
| `bg-secondary` | `#1E1E1E` | App card |
| `accent-primary` | `#ff0073` | Brand pink |
| `accent-primary-active` | `#e0005f` | Hover state |
| `icons-primary` | `#E2E8F0` | App text |
| `icons-secondary` | `#94A3B8` | Muted text |
| `borders-primary` | `#2D2D2D` | App border |
| `borders-secondary` | `#3D3D3D` | Secondary border |
| `text-primary` | `#E2E8F0` | App text |
| `text-secondary` | `#94A3B8` | Muted text |

**Light mode:**

| Key | Value | Source |
|-----|-------|--------|
| `bg-primary` | `#F8FAFC` | App bg |
| `bg-secondary` | `#FFFFFF` | App card |
| `accent-primary` | `#ff0073` | Brand pink |
| `accent-primary-active` | `#e0005f` | Hover state |
| `icons-primary` | `#1E293B` | App text |
| `borders-primary` | `#E2E8F0` | App border |
| `text-primary` | `#1E293B` | App text |
| `text-secondary` | `#64748B` | Muted text |

Typography: `fontFamily: "inherit"` to match the app's font stack.

## Dependencies

**New npm packages:**
- `react-filerobot-image-editor` — the editor component
- `react-konva` — peer dependency (canvas rendering)
- `styled-components` — peer dependency (editor internal styling)

All lazy-loaded — zero impact on initial bundle size.

## Files Changed

| File | Change |
|------|--------|
| `frontend/package.json` | Add 3 dependencies |
| `frontend/src/types/nodes.ts` | Add `filerobotDesignStateUrl` to `GeneratedResult` + add `generatedResults`/`activeResultIndex` to `UploadImageData` |
| `frontend/src/hooks/use-workflow-store.ts` | Add `imageEdit` state, `openImageEdit`, `closeImageEdit` |
| `frontend/src/components/editor/filerobot-editor-modal.tsx` | **NEW** — modal component |
| `frontend/src/components/editor/workflow-editor/workflow-editor-main.tsx` | Mount modal with Suspense |
| `frontend/src/components/nodes/generate-image-node.tsx` | Add Pencil edit button |
| `frontend/src/components/nodes/image-to-image-node.tsx` | Add Pencil edit button |
| `frontend/src/components/nodes/edit-image-node.tsx` | Add Pencil edit button |
| `frontend/src/components/nodes/upload-image-node.tsx` | Add `generatedResults`/`activeResultIndex` support + Pencil edit button |
| `frontend/src/components/nodes/character-node.tsx` | Add Pencil edit button |
| `frontend/src/components/nodes/face-node.tsx` | Add Pencil edit button |
| `frontend/src/components/nodes/object-node.tsx` | Add Pencil edit button |
| `frontend/src/components/nodes/location-node.tsx` | Add Pencil edit button |
| `frontend/src/components/editor/workflow-editor/execution-graph.ts` | Update upload-image output extraction to use `generatedResults[activeIndex]` with `url` fallback |
| `backend/src/services/workflow-engine/output-extractor.ts` | Add `upload-image` to `IMAGE_RESULT_TYPES` set so backend orchestrator extracts from `generatedResults` |

## Upload Image Node Upgrade

`upload-image-node` currently uses a flat data model (`url`, `r2Url`, `assetId`) without `generatedResults`/`activeResultIndex`. To support the edit button consistently, add `generatedResults` + `activeResultIndex` to this node:

- Add `generatedResults` and `activeResultIndex` fields to `UploadImageData` type
- Update the node component to read from `generatedResults` when available, falling back to `url`/`r2Url` for backward compatibility with existing workflows
- When user uploads a new file, create a `GeneratedResult` entry (in addition to setting legacy `url`/`r2Url`)
- Filerobot edits append to `generatedResults` like all other image nodes
- Enables version history (thumbnail strip) for upload-image, matching other image nodes

## Error Handling

- **StorageExceeded:** Parent component (`workflow-editor-main.tsx`) catches `StorageExceededError` from `uploadFile()` and shows `StorageExceededModal` — same pattern as FreeCut. The modal component itself does not handle this; it just calls `onSaveComplete` which may throw.
- **Upload failure:** Catch in parent, close modal, log error. Do not update node data on failure.
- **CORS:** R2 images require `crossOrigin="anonymous"`. Filerobot sets this by default — do NOT pass `noCrossOrigin` prop.

## Backend Changes (Minimal)

- Reuses existing `POST /v1/upload-json` for designState persistence
- Reuses existing `uploadFile()` for image upload (from `@/lib/api.ts`)
- No new routes, no credit costs, no billing changes
- **One change:** `output-extractor.ts` — add `upload-image` to `IMAGE_RESULT_TYPES` so backend orchestrator reads `generatedResults[activeIndex]` for upload-image nodes (backward-compatible: falls back to `data.url`)
