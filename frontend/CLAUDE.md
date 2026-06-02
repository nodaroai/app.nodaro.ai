# Frontend — Claude Code Reference

## Edition Architecture (`frontend/src/ee/`)

The `frontend/src/ee/` directory holds enterprise-tier UI: admin pages, billing page, credit components, admin/billing/credits hooks, admin layout. It is governed by the Nodaro Enterprise License (`frontend/src/ee/LICENSE`).

**Folder layout under `ee/`:**
- `ee/app/(admin)/admin/<page>/page.tsx` — 17 admin pages (dashboard, users, jobs, usage, models, settings, etc.)
- `ee/app/(dashboard)/billing/page.tsx` — billing/subscription page
- `ee/components/credits/` — `CreditBalance`, `GenerateButton`, `CreditTopup`, `GetCreditsModal`, `InsufficientCreditsModal`, `StorageExceededModal`
- `ee/hooks/queries/` — `use-admin-queries`, `use-billing-queries`, `use-credits-queries`
- `ee/hooks/` — `use-model-credits`, `use-providers-credits-sum`
- `ee/layouts/admin-layout.tsx`

**Routing:** `frontend/src/router.tsx` declares the admin routes inside a `hasAdmin() ? [...] : []` conditional spread. In community builds the admin block is empty and the AdminLayout chunk is never loaded.

**Boundary rules:**
1. **Core code may NOT statically import from `@/ee/...`.** Enforced by `tools/check-ee-imports.mjs` in CI. Pre-migration coupling (~98 files importing `useModelCredits`, `CreditBalance`, etc.) is allowlisted with `TODO Phase 4.5` markers; these will be converted to core shims that return null/no-op when `!hasCredits()`.
2. **Shim path:** when a core component needs a credit-related UI element, a future Phase-4.5 pass extracts a thin core wrapper that conditionally renders the ee component. Until then, the static imports remain on the allowlist.
3. **`*.ee.tsx` filename suffix** is reserved for in-place enterprise variants (e.g., a future `cost-tab.ee.tsx` extending `cost-tab.tsx` with credit/markup display).

---

## API Proxy Architecture (CRITICAL)

All frontend API calls use **same-origin relative paths** (e.g. `/v1/billing/subscription`).
Vite dev server proxy in `frontend/vite.config.ts` forwards `/v1/*` to the backend (`http://localhost:8000`).

**Rules:**
- `API_BASE_URL` in `frontend/src/lib/api.ts` is `""` (empty string) -- NEVER hardcode `localhost:8000`
- Admin pages and hooks must also use relative `/v1/...` paths, NOT their own `API_BASE_URL`
- The backend URL is configured via `VITE_API_URL` env var in `vite.config.ts` only
- **Exception: SSE streaming** calls bypass the proxy and call `VITE_API_URL` directly (proxy buffers responses, breaking real-time delivery)
- All env vars use `VITE_` prefix (NOT `NEXT_PUBLIC_`), accessed via `import.meta.env.VITE_*`

### Auth Headers (`frontend/src/lib/api.ts`)
- `getAuthHeaders()` returns `{ Authorization: 'Bearer <token>' }` from Supabase session, or `{}` if not logged in
- All API calls include auth headers via this helper
- Public endpoints (gallery, download) work without auth

---

## UI / Styling

**Accent Color**: `#ff0073` (pink) — primary buttons, active states, node animations, save button, sidebar active border.

**Dark Mode** (CSS vars in `globals.css`): bg #121212, card #1E1E1E, border #2D2D2D, text #E2E8F0
**Light Mode**: bg #F8FAFC, card #FFFFFF, border #E2E8F0, text #1E293B

**Node Colors (MiniMap)** (`workflow-canvas.tsx`): AI/Scene=#ff0073 (brand pink), Input=#38BDF8 (cyan), Parameter=#818CF8 (indigo), Processing=#475569 (steel grey), Output=#22c55e (green), Character=#F472B6 (pink), Face=#FB923C (orange), Object=#34D399 (emerald), Location=#22D3EE (cyan), Sticky=transparent

---

## Credit Components

All gated behind `hasCredits()`:
- `CreditBalance` — toolbar widget, auto-refresh 30s
- `GenerateButton` — config panel button showing cost per model, disables when insufficient
- `InsufficientCreditsModal` — balance vs required, with Upgrade/Buy CTAs
- `RunNodeButton` — hover button under each node "Run (N CR)"
- `useModelCredits(modelId)` hook — fetches from `/v1/credits/model-cost` with cache

---

## AI Prompt Helper

Inline AI-powered prompt enhancement for node config panels (gated behind `hasCredits()`):

- `PromptHelperButton` — small pink sparkles "AI" button, placed inline next to prompt fields
- `PromptHelperDialog` — modal with: current prompt display, style dropdown (node-type-aware: `IMAGE_PROMPT_STYLES`, `VIDEO_PROMPT_STYLES`, `MUSIC_PROMPT_STYLES`, `AUDIO_PROMPT_STYLES`), LLM model selector (`LlmModelSelect` with `feature="prompt-helper"`), goal text field, editable enhanced result
- `prompt-helper-styles.ts` — style presets per node type
- Backend: `POST /v1/prompt-helper/wizard` (the `enhance` action) with `creditGuard` + `resolveLlmCreditId()`

---

## LLM Model Select

`LlmModelSelect` — reusable shadcn `Select` dropdown showing models grouped by tier with colored badges:
- Economy (green) — fast, low cost
- Standard (blue) — balanced
- Premium (amber) — highest quality

Used in: all LLM config panels (AI Writer, Generate Script, After Effects, Motion Graphics, 3D Title, Lottie Overlay, Prompt Helper, Image-to-Text, QA Check)

---

## Aspect Ratio Selector

`AspectRatioSelector` — visual SVG tile grid replacing plain `<Select>` dropdowns for aspect ratio fields:
- Dynamically generated SVG ratio icons proportional to value (e.g., `"16:9"`)
- Non-ratio values (e.g., `"Auto"`) get a `Wand2` icon
- Responsive grid: 2-col for ≤2 options, 3-col otherwise
- ARIA: `role="radiogroup"` + `role="radio"` + `aria-checked`
- Used in: `image-configs.tsx`, `video-configs.tsx`, `composition-configs.tsx`, `processing-configs.tsx`

---

## Presentation / App Runner

Flexible curated I/O system for published apps and presentation mode:
- Nodes opt in via `presentationInput: true` / `presentationOutput: true` flags on node data
- `NodePickerDialog` — checkbox list of eligible nodes for input/output curation
- `NodeConfigModal` — node configuration modal for app runner (renders config panels inline)
- `NodeSection` — labeled sortable section (`@dnd-kit/sortable`) with "Add" button
- `SortableCardWrapper` — drag handle + editable description per card
- `ParameterCard` — input card for parameter nodes (tone, style-guide, provider, etc.)
- `presentationSettings.inputOrder` / `outputOrder` / `cardMeta` persisted in workflow store
- `packages/shared/src/presentation-utils.ts` — `getInputNodes()` / `getOutputNodes()` with `curatedOnly` flag

---

## SSE Client (`frontend/src/lib/sse-client.ts`)

Async generator for SSE from POST requests (native `EventSource` only supports GET):

```typescript
import { streamRequest, type StreamEvent } from "@/lib/sse-client"

const controller = new AbortController()
for await (const event of streamRequest("/v1/ai-writer/generate-stream", {
  body: { systemPrompt, userInput, userId, model },
  signal: controller.signal,
})) {
  switch (event.type) {
    case "token": output += event.data; break
    case "done":  /* handle completion */ break
    case "error": /* handle error */ break
  }
}
controller.abort() // Cancel mid-stream
```

- Uses `fetch()` + `ReadableStream.getReader()` + `TextDecoder`
- Optional `baseUrl` to bypass Vite proxy for real-time SSE
- Buffers partial chunks, skips SSE comments, supports `AbortSignal`

### Streaming API Wrapper (`frontend/src/lib/api.ts`)

```typescript
const { jobId, generatedText } = await generateAIWriterStream({
  systemPrompt, userInput, model, temperature, maxTokens, userId,
  onToken: (token) => { output += token; setText(output) },
  signal: abortController.signal,
})
```

Calls `POST /v1/ai-writer/generate-stream` via SSE (bypasses proxy). Returns `{ jobId, generatedText }` on done. On abort: returns gracefully with collected text.

### Streaming UX Pattern (AI Writer Node)
- **Streaming**: Tokens appear real-time with blinking cursor. Stop button visible. `accumulatedTextRef` flushes to Zustand via `requestAnimationFrame` (~60fps).
- `activeResultIndex = -1` at start so `generatedText` drives display (not stale results)
- DAG executor also uses `generateAIWriterStream()` -- same real-time tokens during workflow execution
- Both sync and streaming paths produce identical output format (`generatedText` + `generatedItems` + `generatedResults`)

### Adding Streaming to a New Feature (Frontend Steps)
1. Wrapper in `api.ts` calling `streamRequest()` with `onToken` callback + `AbortSignal`
2. Node component: `accumulatedTextRef` + `requestAnimationFrame` flush to Zustand. `activeResultIndex: -1` at start. `isStreaming` state for cursor + stop button.

---

## Output Handle Map (for edge creation)

| Node Type | Output Handle |
|-----------|---------------|
| generate-image / upload-image | `"image"` |
| edit-image / image-to-image | `"out"` |
| character | `"characterRef"` |
| object | `"objectRef"` |
| location | `"locationRef"` |
| face | `"faceRef"` |

---

## List / Skip Node Patterns

### List Node (`list`, formerly also `loop`/"Table")
- The canonical batch-source node. Component: `frontend/src/components/nodes/loop-node.tsx` (file name kept for now); data type `LoopNodeData` in `frontend/src/types/nodes.ts`.
- **Single-column by default**: starts as one text column ("Items") — one value per row, each emitted to downstream nodes in turn.
- **Grows into a multi-column typed table**: connect a producer to the bottom-left **"+"** quick-add handle (`LOOP_COL_ADD_HANDLE`, cyan `Plus`) and a new typed column is added. Each column gets a per-column input handle (`loopColInputHandle` → `col_<id>_in`) and output handle (`loopColBaseHandle` → `col_<id>`). Column type (text / image-url / video-url / audio-url / json) drives the handle pip type and the auto-selected view mode (`resolveViewMode`).
- Dynamic handles require `useUpdateNodeInternals` (React Flow v12 doesn't auto-detect new `<Handle>` components). The legacy single `"in"` handle is still recognized for backward-compat.
- The config panel adapts: single-column **List** editor at one column, multi-column **Table** editor once there's more than one.
- **`loop` is a deprecated alias of `list`** — auto-migrated to `list` on load in the editor (`frontend/src/lib/list-loop-migration.ts`, run from `use-workflow-store.ts:loadWorkflow`), presentation, and the app runner, plus a backend execution-time normalizer (`backend/src/services/workflow-engine/normalize-node-types.ts`) and a one-time DB sweep. Never frame `loop` as a separate creatable node type — it is not in the add-node UI; old workflows keep working via migration.

### List Execution
- `extractNodeOutputAsList()` returns `string[]`. `getListInputForNode()` detects list input from upstream. `executeNodeForList()` runs node N times sequentially with progress (`__listTotal`/`__listCompleted`/`__listResults`).
- All node types: `executeNode` accepts optional `overridePrompt` (no store mutation).
- UI badges: xN badge (cyan pill), running counter (fuchsia pill, animated) "2/3", progress bar with gradient.

### Expand/Collapse Clones
- After list execution, `expandLoopResults()` creates visual clones (`node_7_iter_0`) with individual results. Originals hidden (`hidden: true`).
- Before any execution, `collapseExpandedClones()` removes clones, unhides originals, restores clean graph.
- Clone detection: `__expandedClone` flag AND `/_iter_\d+$/` ID pattern (backwards compat).

### Run Selected
- Multi-select -> floating action bar with "Run selected (N)". Also in right-click context menu.
- `handleRunSelected()`: collapses clones, topological sort within selection only.
- Components: `selection-action-bar.tsx`, `node-context-menu.tsx`, store fields `runSelected`/`setRunSelected`

### Key Functions (workflow-editor/)

| Function | File | Purpose |
|----------|------|---------|
| `collapseExpandedClones()` | `execution-graph.ts` | Pre-execution: remove clones, unhide originals |
| `expandLoopResults()` | `list-execution.ts` | Post-execution: create clones from `__listResults` |
| `handleRunFromHere(nodeId)` | `run-handlers.ts` | BFS forward, collapse first, execute downstream |
| `handleRunSelected()` | `run-handlers.ts` | Execute selected nodes in topological order |
| `executeNodeForList()` | `list-execution.ts` | Run node N times for each list item |
| `getEffectivelySkippedIds()` | `execution-graph.ts` | Compute skipped nodes + downstream propagation |
| `executeNode()` | `execute-node.ts` | Main dispatch for all ~40+ node types |
| `resolveNodeInputs()` | `node-input-resolver.ts` | Wire upstream outputs into node inputs |
| `pollJobToCompletion()` | `poll-job.ts` | Generic job polling with status updates |

### Skip Node
- Right-click or multi-select to skip/unskip. Visual: opacity-40 + dashed border + orange SKIP badge.
- Runtime-only flag (`data.skipped`), not persisted to DB.
- **Effective Skip Propagation** (`getEffectivelySkippedIds`): directly skipped + nodes whose ALL parents are effectively skipped (fixed-point cascade). Nodes with at least one non-skipped parent still execute.

---

## Gallery Frontend

- `/gallery` standalone page with grid, filter tabs (image/video/audio), dialog preview
- Lightbox with arrow navigation, download, CSS fullscreen overlay (z-[9999])
- Reference media: avatar-stack thumbnails, click opens separate Radix Dialog
- Key file: `frontend/src/app/gallery/page.tsx`

---

## StorageExceededModal

- `StorageExceededError` class in `api.ts` with `throwApiError()` (~60 throw sites)
- `workflow-editor/workflow-editor-main.tsx` catches on all 14+ API calls (shows modal not toast); `use-file-upload.ts` catches for uploads

---

## Canvas Layout (ELKjs)

"Tidy Up" uses `elkjs` (layered algorithm) for size-aware node layout:
- Uses `node.measured?.width` / `node.measured?.height` from React Flow for actual dimensions
- Direction RIGHT, orthogonal edge routing, network simplex node placement
- Selection mode: 2+ selected nodes only (preserves bounding box origin)
- All-nodes mode: all non-sticky nodes
- Sticky notes excluded in both modes
- Import: `"elkjs/lib/elk.bundled.js"` (browser-compatible)

---

*Last updated: 2026-05-05 (ee/ migration Phase 4)*

---

## Architecture Rules (non-obvious) — migrated from root CLAUDE.md

| Area | Rule |
|------|------|
| Image generation params | Per-provider param routing in `model-options.ts`: Nano Banana v1 uses `image_size` (no `resolution`); Nano Banana 2 + Pro use `aspect_ratio` + 1K/2K/4K resolution; `output_format` only sent to Nano Banana family; Flux Kontext/Max have their own aspect ratio set; `negative_prompt` sent natively for imagen4/ideogram/qwen, appended as "Avoid: …" for others. |
