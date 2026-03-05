# How to Add a New Node to Nodaro.ai

Step-by-step guide for adding a new node type to the Nodaro.ai workflow editor.

---

## Overview

A node touches **4 layers**: backend route, frontend types, UI components, and DAG executor. The minimum set of files is **13-17** depending on complexity.

---

## Checklist

### 1. Backend Route

| Step | File | Action |
|------|------|--------|
| 1a | `backend/src/routes/<node-type>.ts` | **Create** route file (see pattern below) |
| 1b | `backend/src/app.ts` | Import + `app.register()` |
| 1c | `backend/src/billing/credits.ts` | Add to `STATIC_CREDIT_COSTS` |
| 1d | `backend/src/billing/credit-manager.ts` | Add to `CREDIT_COSTS` |

**Route pattern** (synchronous, non-polling):
```typescript
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"

const bodySchema = z.object({
  // ... your fields
  userId: z.string().uuid().optional(),
})

export async function myNodeRoutes(app: FastifyInstance) {
  app.post("/v1/my-node/action", {
    preHandler: creditGuard(() => "my-node"),
  }, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message } })

    // Create job -> reserve credits -> call API -> commit/refund
    const { data: job } = await supabase.from("jobs").insert({ ... }).select("id").single()
    const reservation = await reserveCreditsForJob(req, reply, job.id, "my-node")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    try {
      // ... API call ...
      await supabase.from("jobs").update({ status: "completed", output_data: { ... } }).eq("id", job.id)
      if (usageLogId) await CreditsService.commitCredits(usageLogId)
      return reply.send({ jobId: job.id, /* results */ })
    } catch (err) {
      await supabase.from("jobs").update({ status: "failed" }).eq("id", job.id)
      if (usageLogId) await CreditsService.refundCredits(usageLogId)
      return reply.status(502).send({ error: { code: "provider_error", message: err.message } })
    }
  })
}
```

For **polling-based** nodes (video generation, etc.), create a job and return `{ jobId }` immediately. The frontend polls `GET /v1/jobs/:id` until completion.

### 2. Frontend Types

| Step | File | Action |
|------|------|--------|
| 2a | `frontend/src/types/nodes.ts` | Add `YourNodeData` type |
| 2b | Same file | Add to `SceneNodeData` union |
| 2c | Same file | Add to `SceneNodeType` union |
| 2d | Same file | Add `NODE_DEFINITIONS` entry |

**Type pattern:**
```typescript
export type YourNodeData = {
  [key: string]: unknown          // Required for SceneNodeData compatibility
  label: string
  // ... your fields
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string          // or generatedImageUrl, generatedVideoUrl, etc.
  generatedResults?: Array<{ /* result shape */ }>
  activeResultIndex?: number
}
```

**NODE_DEFINITIONS entry:**
```typescript
{
  type: "your-node",
  label: "Your Node",
  category: "ai",          // "input" | "parameter" | "ai" | "processing" | "output" | "utility"
  creditCost: 1,
  inputs: ["image"],       // handle IDs
  outputs: ["text"],       // handle IDs
  defaultData: { label: "Your Node", /* defaults */ } as YourNodeData,
}
```

### 3. Node Component

| Step | File | Action |
|------|------|--------|
| 3a | `frontend/src/components/nodes/<node-type>-node.tsx` | **Create** component |
| 3b | `frontend/src/components/nodes/index.ts` | Import + add to `nodeTypes` map |

**All new nodes MUST use the new UI style:**
- Wrap in `<div className="relative max-w-[220px]">`
- `EditableNodeLabel` floating above (from `./editable-node-label`)
- `BaseNode` with `hideHeader`, `minWidth={220}`, `isRunning`, custom handles with `hideHandle: true` + `customStyle`
- `HandleIcon` components (from `./handle-icon`) for visual handle indicators
- `RunNodeButton` as `topToolbarContent` (for executable nodes)
- Status states: running (Loader2 spinner), completed (result preview), failed (AlertCircle + error), idle (placeholder)

See `social-node.tsx` for action/output pattern, `transcribe-node.tsx` for text-output pattern, `generate-image-node.tsx` for image-output pattern.

### 4. Config Panel

| Step | File | Action |
|------|------|--------|
| 4a | `frontend/src/components/editor/config-panels/<category>-configs.tsx` | Add config component |
| 4b | `frontend/src/components/editor/config-panels/index.ts` | Export it |
| 4c | `frontend/src/components/editor/config-panel.tsx` | Import, add display name, add to `GENERATE_BUTTON_TYPES` or `RUN_BUTTON_TYPES`, add render conditional |

### 5. Add Node to All Menus (3 files!)

| Step | File | Action |
|------|------|--------|
| 5a | `frontend/src/components/editor/add-node-popup.tsx` | Add to `NODE_OPTIONS` (context menu / search popup) |
| 5b | `frontend/src/components/editor/node-toolbar.tsx` | Add to sidebar `TOOLBAR_NODES` list |
| 5c | `frontend/src/components/editor/editor-toolbar.tsx` | Add `case` to the reset/clear switch statement |

**All three are required.** The popup (5a) and sidebar (5b) are independent node lists — missing either means the node won't appear in that UI.

### 6. API Client

| Step | File | Action |
|------|------|--------|
| 6a | `frontend/src/lib/api.ts` | Add API function |

### 7. DAG Executor

| Step | File | Action |
|------|------|--------|
| 7a | `frontend/src/components/editor/workflow-editor/types.ts` | Add to `EXECUTABLE_NODE_TYPES` set ⚠️ **Without this, "Run" button shows error** |
| 7b | `frontend/src/components/editor/workflow-editor/execute-node.ts` | Import API + type, add execution block |
| 7c | `frontend/src/components/editor/workflow-editor/execution-graph.ts` | Add to `extractNodeOutput()` |
| 7d | `frontend/src/components/editor/workflow-editor/node-input-resolver.ts` | Add as input source for downstream nodes |

**Execution patterns:**
- **Synchronous** (fast API call, <30s): Call API, store result directly. Used by: ai-writer, image-to-text.
- **Polling** (slow jobs): Call API to get `jobId`, poll `getJobStatus()` on interval. Used by: generate-image, image-to-video, transcribe.
- **SSE streaming**: Open EventSource, process token events. Used by: ai-writer (stream variant).

### 8. Documentation

| Step | File | Action |
|------|------|--------|
| 8a | `docs/nodes-catalog.md` | Add entry, update counts |

---

## Common Pitfalls

1. **Forgetting the Zod enum** in the backend route schema. This has caused validation bugs multiple times.
2. **Not adding to `SceneNodeType` union** — TypeScript won't catch this at the definition site, but `nodeTypes` map will fail.
3. **Missing `[key: string]: unknown`** in the data type — required for the `SceneNodeData` union to work.
4. **Wrong handle IDs** — the DAG executor resolves inputs by handle ID. Use `"image"` for image inputs, `"text"` for text outputs, `"in"` for generic inputs.
5. **Forgetting credit costs** in both `credits.ts` AND `credit-manager.ts`.
6. **Only adding to `add-node-popup.tsx` but not `node-toolbar.tsx`** — the sidebar and the popup/context-menu are **separate node lists**. You must add to both, plus the reset handler in `editor-toolbar.tsx`.
7. **Forgetting `EXECUTABLE_NODE_TYPES` in `types.ts`** — without this, clicking "Run" shows "This node type cannot be run individually."

---

## Verification

1. `npx tsc --noEmit` in both `backend/` and `frontend/`
2. Start backend, verify route registers in startup logs
3. Add node to canvas via add-node menu
4. Connect upstream source, run node
5. Verify downstream nodes receive output
6. Check credit deduction in dev tools network tab

---

*Last updated: 2026-02-22*
