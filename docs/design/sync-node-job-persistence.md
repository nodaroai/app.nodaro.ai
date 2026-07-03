# Sync Node Job Persistence

**Date:** 2026-03-19
**Status:** Approved

## Problem

9 node types execute via sync API calls (or pure client-side logic) without creating persistent job records. After page refresh, their results are lost and they don't appear in execution history.

**Affected nodes:**

| Node | Current behavior | Credits |
|------|-----------------|---------|
| instagram-post | Sync API, backend creates job but frontend ignores jobId | 1 |
| tiktok-post | Same | 1 |
| youtube-upload | Same | 1 |
| linkedin-post | Same | 1 |
| x-post | Same | 1 |
| facebook-post | Same | 1 |
| qa-check | Sync API, backend creates job but frontend ignores jobId | 3 |
| save-to-storage | Sync API, backend creates job but frontend ignores jobId | 0 |
| webhook-output | Sync API, backend does NOT create job | 0 |

**Key discovery:** 8 of 9 nodes already have backend job creation — the frontend simply discards the returned `jobId`. Only webhook-output needs a backend change.

## Approach

**Frontend-only wiring** for 8 nodes + minor backend addition for webhook-output. No architecture changes, no async conversion. The sync routes stay sync.

## Design

### 1. Backend: webhook-output route

Currently `/v1/webhook-output/send` is a pure pass-through (POST to external URL, return `{ success: true }`).

**Change to:**

1. Extract `req.userId` from authenticated request
2. Extract `workflowId` via `extractWorkflowId(req.body)` (matches pattern of all job-creating routes)
3. Create a job record (`status: "pending"`, `user_id: userId`, `workflow_id: workflowId`, `input_data: { url, payload, type: "webhook-output" }`)
4. POST to external URL
5. Update job with `output_data: { success, statusCode, responseBody }` and `status: "completed"` (or `"failed"` with `error_message`)
6. Return `{ jobId, success, statusCode, responseBody }`

This captures the external response so downstream nodes can consume it.

**No changes needed** for social-publish, save-to-storage, qa-check routes — they already create jobs with proper `output_data`:
- social-publish: `{ platformPostId, platformPostUrl }`
- save-to-storage: `{ url, filename, type }`
- qa-check: `{ score, approved, reason, usage }`

### 2. Frontend: execute-node.ts

For all 9 nodes, the `.then()` handler after the API call must store `currentJobId` from the response.

**Social posts (all 6) and save-to-storage** — these produce URL-like results that fit `generatedResults`:
```typescript
socialPublishApi({...}).then((result) => {
  updateNodeData(node.id, {
    executionStatus: "completed",
    currentJobId: result.jobId,           // NEW
    platformPostId: result.platformPostId,
    platformPostUrl: result.platformPostUrl,
    generatedResults: [...(prev), {       // NEW
      jobId: result.jobId,
      url: result.platformPostUrl,
      timestamp: new Date().toISOString(),
    }],
  });
})
```

**qa-check and webhook-output** — these produce structured data (scores, response bodies), not media URLs. Using `generatedResults` (which expects a `url` field) is a poor fit. Instead, just store `currentJobId` for persistence. The restoration logic uses `currentJobId` to query `job.output_data` and repopulate the node-specific fields directly:
```typescript
qaCheckApi({...}).then((result) => {
  updateNodeData(node.id, {
    executionStatus: "completed",
    currentJobId: result.jobId,           // NEW (enables restoration)
    score: result.score,
    approved: result.approved,
    reason: result.reason,
  });
})
```

No polling needed — jobs are already completed by the time the sync response arrives.

### 3. Frontend: api.ts

Update `sendWebhookOutput` return type to include the new fields from the backend:
```typescript
// Before: Promise<{ success: boolean }>
// After:  Promise<{ jobId: string; success: boolean; statusCode: number; responseBody: string }>
```

Also add `withWorkflowId()` wrapper to the `sendWebhookOutput` call so the job is tagged with the current workflow (matching all other job-creating API calls).

### 4. Frontend: types/nodes.ts

Add runtime fields to node data types that currently lack them:

- **`QACheckData`**: add `currentJobId?`, `executionStatus?`, `score?`, `approved?`, `reason?`
- **`SaveToStorageData`**: add `currentJobId?`, `executionStatus?`, `savedUrl?`, `generatedResults?`
- **`WebhookOutputData`**: add `currentJobId?`, `executionStatus?`, `webhookSuccess?`, `webhookStatusCode?`, `webhookResponseBody?`

`SocialPostData` already has `executionStatus`, `platformPostId`, `platformPostUrl` — just add `currentJobId?` and `generatedResults?`.

### 5. Frontend: Result restoration on workflow load

The existing `syncNodeResultsFromDB` in `use-workflow-persistence.ts` finds nodes with `currentJobId`, batch-queries jobs, and repopulates results. Currently it only understands `imageUrl`/`videoUrl`/`audioUrl`/`script` from `job.output_data`.

**A node-type-aware branch** is needed after the generic media path. When the generic `outputUrl` is undefined (no `imageUrl`/`videoUrl`/`audioUrl`), check the node type and map `output_data` fields accordingly:

```typescript
// After the generic: const outputUrl = job.output_data?.imageUrl ?? ...
if (!outputUrl) {
  // Node-type-specific restoration
  switch (node.type) {
    case "instagram-post":
    case "tiktok-post":
    case "youtube-upload":
    case "linkedin-post":
    case "x-post":
    case "facebook-post":
      updateNodeData(node.id, {
        platformPostId: outputData.platformPostId,
        platformPostUrl: outputData.platformPostUrl,
        executionStatus: "completed",
      });
      break;
    case "qa-check":
      updateNodeData(node.id, {
        score: outputData.score,
        approved: outputData.approved,
        reason: outputData.reason,
        executionStatus: "completed",
      });
      break;
    case "save-to-storage":
      // Note: backend stores `url`, frontend uses `savedUrl`
      updateNodeData(node.id, {
        savedUrl: outputData.url,
        executionStatus: "completed",
      });
      break;
    case "webhook-output":
      updateNodeData(node.id, {
        webhookSuccess: outputData.success,
        webhookStatusCode: outputData.statusCode,
        webhookResponseBody: outputData.responseBody,
        executionStatus: "completed",
      });
      break;
  }
}
```

Restoration is a safety net for the race condition where the user refreshes after the API call returns but before auto-save fires.

### 6. Frontend: extractNodeOutput changes

`extractNodeOutput()` in `execution-graph.ts` determines what value a node passes downstream.

**Changes:**

| Node Type | Output value | Handle routing |
|-----------|-------------|----------------|
| qa-check | (no change) | Already works with dual `approved`/`rejected` handles |
| save-to-storage | `savedUrl` | Single output — the R2 URL |
| webhook-output | `webhookResponseBody` | Single output — the response from the external API |

**Social posts (all 6):** Currently have `outputs: []` in NODE_DEFINITIONS — no output handles exist. Adding `extractNodeOutput` without output handles would be dead code. Output handles for social posts are **out of scope** for this change; can be added later if users need to chain social post results downstream.

## Files to modify

### Backend (1 file)
- `backend/src/routes/webhook-output.ts` — Add job creation (`req.userId`, `extractWorkflowId`), capture external response in `output_data`

### Frontend (5 files)
- `frontend/src/lib/api.ts` — Update `sendWebhookOutput` return type, add `withWorkflowId` wrapper
- `frontend/src/types/nodes.ts` — Add `currentJobId`, `executionStatus`, and result fields to `QACheckData`, `SaveToStorageData`, `WebhookOutputData`, `SocialPostData`
- `frontend/src/components/editor/workflow-editor/execute-node.ts` — Store `currentJobId` (+ `generatedResults` where applicable) for all 9 nodes
- `frontend/src/components/editor/workflow-editor/execution-graph.ts` — Add `extractNodeOutput` cases for save-to-storage and webhook-output
- `frontend/src/hooks/use-workflow-persistence.ts` — Add node-type-aware branch in `syncNodeResultsFromDB` for the 9 node types

## Out of scope

- Converting sync routes to async/worker-queued (unnecessary — they're fast operations)
- Adding job persistence to pure-logic nodes (combine-text, split-text, preview, composite, manual-edit) — these are deterministic/interactive and don't benefit from persistence
- Changes to the backend orchestrator — it already handles all 9 nodes correctly via sync HTTP / inline executors
- Output handles for social post nodes (`outputs: []` today) — can be added later if needed
- `applyBackendExecutionState`/`applyCompletedExecutionResults` changes — the orchestrator already persists these node outputs in `workflow_executions.node_states` correctly
