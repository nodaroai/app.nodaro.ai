# FreeCut Project Persistence Design

## Goal

Persist FreeCut project state (layers, edits, effects) so users can resume editing when reopening a video, instead of starting from scratch every time.

## Architecture

Projects are stored as lightweight JSON snapshots (~50-200KB) on R2 at `/projects/{uuid}.json`, linked per-result in the node's `GeneratedResult`. This avoids duplicating video data (already on R2) while preserving the full editing state (tracks, items, transitions, keyframes, compositions).

## Data Flow

### Save (every "Save & Close")

1. FreeCut exports video buffer + lightweight project JSON via `FREECUT_EXPORT_COMPLETE: { videoBuffer, projectJson }`
2. Nodaro uploads video to R2 at `/videos/...` (existing flow)
3. Nodaro uploads project JSON to R2 at `/projects/{uuid}.json` (new)
4. Both URLs stored in the `GeneratedResult` on the node — `freecutProjectUrl` field

### Reopen (auto-restore)

1. User clicks "Edit in FreeCut" on a result that has `freecutProjectUrl`
2. Nodaro fetches video buffer + project JSON (both from R2)
3. Sends both to FreeCut via `NODARO_LOAD_VIDEO: { videoBuffer, projectJson }`
4. FreeCut restores project from JSON, re-imports video, links media by hash
5. No prompt — project is always auto-restored

### New Project (discard & start fresh)

1. "New Project" button in Nodaro header bar (top-left, next to "FreeCut Editor" label)
2. Confirmation dialog: "Start a new project? This will discard your current edits."
3. If confirmed, sends `NODARO_RESET_PROJECT` to FreeCut
4. FreeCut discards current project, creates fresh one with the original video on a single track

## Storage

- **Location:** R2 at `/projects/{uuid}.json`
- **Format:** FreeCut's lightweight ProjectSnapshot JSON (no media files, just metadata + timeline structure)
- **Size:** ~50-200KB per project
- **Scope:** Per-result — each entry in a node's `generatedResults` array can have its own FreeCut project. This allows the same source video to have different edits across different nodes.

## PostMessage Protocol Changes

### NODARO_LOAD_VIDEO (Nodaro → FreeCut)

```typescript
{
  type: "NODARO_LOAD_VIDEO",
  payload: {
    videoUrl: string,
    videoBuffer?: ArrayBuffer,      // existing
    projectJson?: ProjectSnapshot   // NEW — if present, restore project instead of creating new
  }
}
```

### FREECUT_EXPORT_COMPLETE (FreeCut → Nodaro)

```typescript
{
  type: "FREECUT_EXPORT_COMPLETE",
  payload: {
    videoBuffer: ArrayBuffer,       // existing
    projectJson: ProjectSnapshot    // NEW — always included on save
  }
}
```

### NODARO_RESET_PROJECT (Nodaro → FreeCut)

```typescript
{
  type: "NODARO_RESET_PROJECT",
  payload: {}
}
```

FreeCut discards the current project and creates a fresh one with the original video.

## File Changes

### Nodaro Side

| File | Change |
|------|--------|
| `frontend/src/types/nodes.ts` | Add `freecutProjectUrl?: string` to `GeneratedResult` |
| `frontend/src/components/editor/freecut-editor-modal.tsx` | Accept `freecutProjectUrl` prop; fetch & send project JSON; add "New Project" button with confirmation dialog; handle `projectJson` in export |
| `frontend/src/components/editor/workflow-editor/workflow-editor-main.tsx` | Upload project JSON to R2 on export; store `freecutProjectUrl` in result; pass `freecutProjectUrl` from active result to modal |
| `frontend/src/hooks/use-workflow-store.ts` | Extend `freecutEdit` state to include optional `freecutProjectUrl` |
| Video node components (22 files) | Pass `freecutProjectUrl` from active result when calling `openFreeCut` |
| `frontend/src/components/nodes/video-result-overlay.tsx` | Pass `freecutProjectUrl` through `onEdit` callback |

### FreeCut Side

| File | Change |
|------|--------|
| `src/features/embedded/services/embedded-message-handler.ts` | Accept `projectJson` in payload; restore project from JSON instead of creating new; handle `NODARO_RESET_PROJECT` |
| `src/features/embedded/hooks/use-send-back.ts` | Include project JSON snapshot in `FREECUT_EXPORT_COMPLETE` |

## UX

- **Auto-restore:** No prompt when reopening — project restores silently
- **"New Project" button:** Top-left of Nodaro's FreeCut header bar, small secondary button
- **Confirmation:** "Start a new project? This will discard your current edits." with "Cancel" / "Start Fresh"
- **Save & Close:** Existing button, now also exports project JSON alongside video
