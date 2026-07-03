# Smart Progress Bars — Design Spec

## Overview

Replace the current binary status indicators (running/completed/failed) with sophisticated time-estimated progress bars that use historical execution data, a non-linear ease-out curve, and multi-node flow aggregation for presentation/app views.

## Goals

1. Show smooth, realistic progress during node execution using historical average durations
2. Non-linear curve that decelerates near the end — never feels "stuck at 99%"
3. In presentation/app views, show combined progress across hidden upstream nodes as a single bar per visible output node

## 1. `model_execution_stats` Table

### Schema

```sql
CREATE TABLE model_execution_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_identifier TEXT NOT NULL,          -- e.g. "flux", "veo-3", "sora-2-text-to-video"
  aspect_ratio TEXT NOT NULL DEFAULT '',   -- e.g. "16:9", "1:1", or '' if N/A
  quality TEXT NOT NULL DEFAULT '',        -- e.g. "2K", "4K", "high", or '' if N/A
  duration_seconds INT NOT NULL DEFAULT 0, -- video duration in seconds, or 0 if N/A
  avg_duration_ms INT NOT NULL,
  min_duration_ms INT,
  max_duration_ms INT,
  sample_count INT NOT NULL DEFAULT 1,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_identifier, aspect_ratio, quality, duration_seconds)
);

CREATE INDEX idx_model_execution_stats_model ON model_execution_stats (model_identifier);

-- RLS: public read, service-role-only write
ALTER TABLE model_execution_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read execution stats"
  ON model_execution_stats FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policies — only service-role (backend) can write
```

### Stats Update Flow

After each successful job completion:
- **Backend orchestrator** (`orchestrator-worker.ts`): after node completes, extract model + config from input data, upsert stats
- **BullMQ worker** (`worker.ts`): after single-node job completes successfully, upsert stats (this is where all async jobs finalize — route handlers only enqueue jobs)

Upsert logic (exponential moving average, α = 0.3):
```
new_avg = floor(α * new_duration + (1 - α) * old_avg)
new_min = MIN(old_min, new_duration)
new_max = MAX(old_max, new_duration)
new_count = old_count + 1
```

Using EMA instead of simple running average ensures recent executions have more weight (adapting to provider speed changes) and naturally resists outlier drift. The α = 0.3 factor means a single outlier shifts the average by only ~30%.

**Outlier guard:** If `new_duration > 3 * old_avg` and `sample_count >= 5`, skip the upsert — likely a provider timeout or network issue, not representative.

### Extracting Stats Key from Job Data

Different node types store model/config under different field names. A `buildStatsKey(nodeType, inputData)` utility extracts the composite key:

| Node category | `model_identifier` source | `aspect_ratio` source | `quality` source | `duration_seconds` source |
|---------------|--------------------------|----------------------|------------------|--------------------------|
| Image (generate-image) | `inputData.provider` (e.g., `"flux"`) | `inputData.aspect_ratio` or `inputData.image_size` | `inputData.resolution` or `inputData.quality` | 0 |
| Video (image-to-video, text-to-video) | `inputData.provider` (e.g., `"veo-3"`) | `inputData.aspect_ratio` | `""` | `inputData.duration` |
| Audio/TTS (text-to-speech) | `inputData.ttsModel` or `inputData.provider` | `""` | `""` | 0 |
| Music (suno) | `"suno"` | `""` | `""` | `inputData.duration` or 0 |
| LLM (ai-writer, generate-script) | `inputData.llmModel` or `"llm"` | `""` | `""` | 0 |
| Upscale (topaz) | `inputData.provider` | `""` | `inputData.scale` or `""` | 0 |
| FFmpeg processing | Skip — not tracked (0 credits, near-instant) | — | — | — |
| Inline (combine-text, split-text) | Skip — not tracked | — | — | — |

The `model_identifier` should align with the credit system identifiers where possible (e.g., `"flux"`, `"veo-3"`, `"gpt-image"`).

This utility lives in `backend/src/services/execution-stats.ts`.

### Lookup Fallback Chain

When estimating duration for a node, try in order:

1. **Exact match** — same model + aspect_ratio + quality + duration_seconds
2. **Ignore aspect ratio** — same model + quality + duration_seconds (aspect ratio has minimal impact)
3. **Extrapolate duration** — same model + quality, scale linearly by duration ratio (e.g., 10s video ≈ 2× of 5s entry)
4. **Model only** — any entry for the same model, take the average
5. **Category defaults** — hardcoded fallbacks:
   - Image: 30,000ms
   - Video: 120,000ms
   - Audio/TTS: 15,000ms
   - Music (Suno): 60,000ms
   - LLM (AI writer, scripts): 8,000ms
   - Upscale: 30,000ms
   - Inline (combine-text, split-text): 500ms

Note: Step 3 (extrapolate duration) only applies when `duration_seconds > 0` (video/music models). For image/audio models where duration is always 0, this step is automatically skipped.

Each response includes a `confidence` field: `"exact" | "partial" | "model" | "default"` and `sampleCount` so the frontend knows how reliable the estimate is.

### API Endpoints

**`GET /v1/execution-stats/estimate`**

Query params: `model`, `aspectRatio?`, `quality?`, `duration?`

Response:
```json
{
  "estimatedMs": 45000,
  "confidence": "exact",
  "sampleCount": 127
}
```

**`POST /v1/execution-stats/batch-estimate`**

Body:
```json
{
  "nodes": [
    { "nodeId": "abc", "model": "flux", "aspectRatio": "16:9", "quality": "2K" },
    { "nodeId": "def", "model": "veo-3", "duration": 5 }
  ]
}
```

Response:
```json
{
  "estimates": {
    "abc": { "estimatedMs": 12000, "confidence": "exact", "sampleCount": 84 },
    "def": { "estimatedMs": 95000, "confidence": "partial", "sampleCount": 12 }
  }
}
```

Both endpoints require auth (standard JWT middleware). Batch endpoint limited to max 50 nodes per request.

Both routes must include Zod validation schemas (GET query params + POST body). Route prefix: `/v1/execution-stats`.

## 2. Non-Linear Progress Curve

### Shared Utility

Location: `packages/shared/src/progress-curve.ts`

```typescript
function calculateProgress(
  elapsedMs: number,
  estimatedMs: number,
  exponent: number = 2
): number
```

**Formula:** `progress = 99 * (1 - (1 - t)^exponent)` where `t = clamp(elapsedMs / estimatedMs, 0, 1)`

### Behavior

| Elapsed (% of estimate) | Progress shown |
|--------------------------|---------------|
| 0% | 0% |
| 25% | ~44% |
| 50% | ~75% |
| 75% | ~94% |
| 100% | 99% |
| >100% (overrun) | stays at 99% |
| Completion signal | jumps to 100% |

The exponent is tunable — `2` is the default (quadratic ease-out). Higher values (e.g., `3`) produce even more front-loading.

### Usage

- **Editor single-node runs:** Modified flow in `poll-job.ts`:
  1. Before polling loop starts (in the caller, e.g., `execute-node.ts`), call `getExecutionEstimate()` for the node's model/config and record `startTime = Date.now()`
  2. Pass `{ estimatedMs, startTime }` into `pollJobWithNodeUpdate()`
  3. On each poll tick, compute `calculateProgress(Date.now() - startTime, estimatedMs)` and set `currentJobProgress` to the result
  4. Keep `job.progress` as fallback — if the API returns a non-zero `job.progress`, use `Math.max(calculated, job.progress)` so real progress can overtake the estimate
  5. On completion, set `currentJobProgress` to 100
- **Presentation/app views:** Combined with multi-node logic (see section 3).
- Estimate is fetched once when a node starts executing and cached for the duration of that run.

## 3. Multi-Node Combined Progress in Presentation/App View

### Problem

In presentation/app view, visible output nodes often depend on hidden upstream nodes. The user sees no activity until their visible node actually starts executing, which could be minutes into the workflow.

### Solution

Compute a weighted progress bar per visible output node that spans all its upstream dependencies.

### Flow Segment Computation

When execution starts, for each visible output node:

1. Walk backward through edges to collect all ancestor nodes up to (and including) the visible node
2. Order nodes topologically (execution order)
3. Fetch time estimates for all nodes in one batch call
4. Assign each node a proportional slice of 0–99% based on `nodeEstimate / totalEstimate`

**Example:**

```
node1(90s) → node2(180s) → node3(90s)
Only node3 is visible in app view.

Total estimated = 360s
node1 slice: 0% – 25%     (90/360 = 25%)
node2 slice: 25% – 75%    (180/360 = 50%)
node3 slice: 75% – 99%    (90/360 = 24%, stretches to 99%)
```

### Progress During Execution

Using the existing polling on `workflow_executions` (2s interval in app runner):

For each node in the segment:
- **Completed:** contribute its full slice width
- **Running:** apply `calculateProgress(elapsed, nodeEstimate)` and map the result to the node's slice range
- **Pending:** contribute 0

**Example calculation:**

node1 completed, node2 is 60% through its 180s estimate:
- node1: full 25 points
- node2: `calculateProgress(108000, 180000)` ≈ 91% of its 50-point range → 45.5 points
- Total: 25 + 45.5 = **70.5%** shown on node3's progress bar

### Edge Cases

- **Branching/merging paths:** If a visible node has multiple upstream paths, take all unique ancestors. For parallel branches, the slowest branch determines when the next sequential node starts — use `max(branch estimates)` for the parallel section.
- **Already-running execution:** If user opens presentation view mid-execution, compute segments and backfill progress from current `node_states` (which have `startedAt`/`completedAt` timestamps).
- **Visible node with no upstream:** Just shows its own progress bar (no combining needed).
- **Multiple visible output nodes sharing upstream:** Each gets its own independent combined bar. The shared upstream nodes contribute to both.

### Where Segments Are Computed

Frontend only — `use-app-runner-store.ts` and presentation view already have access to the full workflow graph (nodes + edges). On execution start:
1. Compute segments once per visible output node
2. Batch-fetch estimates for all unique nodes
3. Cache segments + estimates for the duration of the run

## 4. Integration Points

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/XXX_model_execution_stats.sql` | Table creation |
| `backend/src/services/execution-stats.ts` | Lookup (fallback chain) + upsert logic |
| `backend/src/routes/execution-stats.ts` | GET estimate + POST batch-estimate |
| `packages/shared/src/progress-curve.ts` | `calculateProgress()` + category defaults |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/app.ts` | Register execution-stats route |
| `backend/src/workers/orchestrator-worker.ts` | After node completion, upsert stats |
| `backend/src/worker.ts` | After single-node job completion, upsert stats |
| `frontend/src/lib/api.ts` | Add `getExecutionEstimate()` and `batchExecutionEstimates()` |
| `frontend/src/components/editor/workflow-editor/poll-job.ts` | Use `calculateProgress()` with fetched estimate |
| `frontend/src/hooks/use-app-runner-store.ts` | Segment computation, batch estimate fetch, combined progress |
| `frontend/src/components/presentation/presentation-view.tsx` | Render progress bar per visible output node |
| `packages/shared/src/index.ts` | Export `progress-curve` module |

### Unchanged

- Backend orchestrator execution logic
- Editor canvas node status badges (running/completed/failed)
- `jobs` and `workflow_executions` table schemas
- No edition gating — works for all editions

## 5. Non-Goals

- Real-time SSE for progress (stay with polling for now)
- Progress bars on the editor canvas itself (keep status badges)
- Confidence-based UI changes (e.g., showing "estimate may be inaccurate" — future enhancement)
- Per-user execution stats (this is global aggregate data)
