# Workflow Components — Design Spec

**Date:** 2026-03-27
**Status:** Approved

## Overview

Users can publish workflows as **components** — reusable black-box nodes with defined inputs, outputs, exposed settings, and creator-set pricing. Other users discover components in a marketplace, add them to their workflows as single nodes, and pay credits per execution. Creators earn from every run.

A component is a new `publish_type` on the existing `published_apps` system. Execution goes through the app-runner, reusing its snapshot immutability, monetization, credit flow, and earnings tracking.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Execution engine | App-runner (headless) | Reuses ~500 lines of billing, earnings, snapshot logic |
| Input/output definition | Unified presentation flags + handle metadata | No duplication; same flags drive app and component I/O |
| Discovery UX | Dedicated Component Browser dialog | Voice Browser pattern; rich info without leaving canvas |
| Node visual design | Rich with result preview | Shows output media on the node; reinforces black-box model |
| Versioning for consumers | Pinned version + update prompt | Prevents silent breakage; consumer controls upgrades |
| Config panel | Info card + optional exposed settings | Consistent with app exposed fields; handles aren't great for dropdowns |
| Component nesting | Supported (depth limit 5 + cycle detection) | Falls out of app-runner model; same safeguards as sub-workflows |

## Data Model

### `published_apps` table additions

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `publish_type` | `TEXT NOT NULL` | `'app'` | `'app'` or `'component'` |
| `component_metadata` | `JSONB` | `NULL` | Handle configs (inputs, outputs, exposed settings) |

No new tables. Components are `published_apps` records with `publish_type = 'component'`.

### `component_metadata` JSONB structure

```typescript
interface ComponentMetadata {
  inputs: ComponentHandle[]
  outputs: ComponentHandle[]
  exposedSettings: ExposedSetting[]
}

interface ComponentHandle {
  id: string              // maps to presentation node ID in snapshot
  name: string            // creator-assigned label (e.g., "Source Image")
  type: 'image' | 'video' | 'audio' | 'text'  // type hint for connection validation
  required: boolean       // inputs only; outputs always present
  mediaPreview?: boolean  // outputs only; exactly one must be true — displayed on node
  fieldKey: string        // data field to read/write (derived from node type at publish time)
                          // Inputs: from INPUT_FIELD_MAP (e.g., "text" for text-prompt, "url" for upload-image)
                          // Outputs: from NodeOutput keys (e.g., "imageUrl", "videoUrl", "audioUrl", "text")
}

interface ExposedSetting {
  nodeId: string          // inner node this setting belongs to
  field: string           // field name on node data (e.g., "quality", "aspectRatio")
  label: string           // consumer-facing label
  type: 'select' | 'text' | 'number' | 'toggle'
  allowedValues?: unknown[]  // optional restriction
  defaultValue: unknown
}
```

### `ComponentNodeData` (frontend node type)

```typescript
interface ComponentNodeData {
  label: string
  appSlug: string              // stable cross-version identifier (used for API calls and version checks)
  appVersionId: string         // published_apps.id for the pinned version (version-specific UUID)
  pinnedVersion: number        // display version number (e.g., 3)
  componentMetadata: ComponentMetadata  // cached from published_apps at add-time
  exposedSettings: Record<string, unknown>  // consumer-set values for exposed fields, keyed by "nodeId:field"
  outputResults?: Record<string, string>   // handle ID → output URL/value (populated after execution)
  creatorName: string          // cached for footer display
  creatorId: string            // for earnings attribution
  estimatedCredits: number     // cached monetized cost for display
  // standard node fields: status, progress, result, error
}
```

The `outputResults` field follows the same pattern as `SubWorkflowData.outputResults` — maps output handle IDs to their resolved values after execution. This is critical for downstream node input resolution and output extraction.

### Handle ID conventions

React Flow edges reference handles by ID. Component handles use prefixed IDs to distinguish inputs from outputs:

- **Input handles**: `in_<handleId>` (e.g., `in_node-123` where `node-123` is the inner presentation node ID)
- **Output handles**: `out_<handleId>` (e.g., `out_node-456`)

These prefixes are used consistently in edge wiring, input resolution (`sourceHandle.replace(/^out_/, "")`), and output extraction. The `ComponentHandle.id` stores the unprefixed inner node ID; the prefix is added by the component node's React Flow handle rendering.

### Database index

```sql
CREATE INDEX IF NOT EXISTS idx_published_apps_publish_type
  ON published_apps(publish_type)
  WHERE is_listed = true AND is_active = true;
```

### `AppBrowseCard` DTO update

The browse API response must include `publishType: string` and `componentMetadata: ComponentMetadata | null` so the frontend can render type badges and I/O pills on browse cards.

## Publishing Flow

The existing publish dialog gets a type selector at the top: **App | Component**.

When "Component" is selected:

1. **Standard fields**: name, slug, description, icon, category, tags, monetization (flat fee + percent)
2. **Handle configuration panel** (new section):
   - Reads nodes flagged with `presentationInput` / `presentationOutput`
   - For each, the creator configures: name, type hint (auto-detected with override), required toggle
   - For outputs: media preview toggle (exactly one required)
3. **Exposed settings panel**:
   - Reads `exposableFields` from NODE_DEFINITIONS for each inner node
   - Creator selects which to surface, optionally restricts with `allowedValues`
4. **Credit estimation**: `calculateMonetizedCost(baseCredits, flatFee, percent)` shows total consumer cost

### Backend

`POST /v1/apps/publish` updated:
- Accepts `publishType: 'app' | 'component'` (defaults to `'app'`)
- Accepts `componentMetadata` when `publishType = 'component'`
- Validates:
  - At least one input handle, at least one output handle
  - Exactly one output handle has `mediaPreview: true`
  - Each `ComponentHandle.id` exists as a node ID in `snapshot_nodes`
  - Each `ComponentHandle.fieldKey` is valid for its node type (inputs: matches `INPUT_FIELD_MAP`, outputs: matches `NodeOutput` keys)
  - Each `ExposedSetting.nodeId` exists in `snapshot_nodes`
  - Each `ExposedSetting.field` is listed in `exposableFields` for that node's type in `NODE_DEFINITIONS`
- Stores in `published_apps` with new columns

A workflow can be published as **both** an app and a component (separate records, same workflow).

## Component Node — Canvas Design

Purple-themed "Rich with Result Preview" node:

```
┌─────────────────────────────────┐
│ 🧩 BG Remover Pro      [8 CR]  │  ← purple gradient header
├─────────────────────────────────┤
│                                 │
│      [ Result preview ]         │  ← placeholder before run, media after
│                                 │
├─────────────────────────────────┤
│ ● Source Image    Result Image ●│  ← named, typed handles
│ ● Prompt                       │
├─────────────────────────────────┤
│ by @designstudio    ⭐ 4.8     │  ← creator footer
└─────────────────────────────────┘
```

- **Header**: puzzle piece icon, component name, credit cost badge
- **Preview area**: shows `mediaPreview` output (image thumbnail, video frame, audio waveform, text snippet)
- **Handles**: colored type dots (blue=image, green=text, orange=audio, pink=video), named labels
- **Footer**: creator name, run count

### Version update badge

When `pinnedVersion < latestVersion`, the header shows a "v2 → v4" badge. Clicking opens a confirmation with handle diff (added/removed/changed). Confirming updates `appVersionId`, `pinnedVersion`, and `componentMetadata`. Changed handles highlight disconnected edges for re-wiring.

### Config panel

When a component node is selected:

1. **Info section** (read-only): name, description, creator, version, pricing breakdown, marketplace link
2. **Settings section** (if exposed fields exist): creator-configured fields with optional `allowedValues`
3. **Handles section**: input/output list with type hints and connection status

## Component Browser Dialog

Modal opened from Add Node popup's "Component" entry (puzzle piece icon, purple, "community" category).

**Add-to-canvas flow:** The Add Node popup and sidebar both have a "Component" entry. Clicking it does **not** add an empty node — instead it opens the Component Browser dialog. The user searches/browses, clicks a component card, and a **pre-configured** component node is placed on canvas with `appSlug`, `appVersionId`, `pinnedVersion`, `componentMetadata`, `creatorName`, and `estimatedCredits` already populated. This is different from the sub-workflow pattern (which adds an empty node first). Implementation: the `onAddNode` callback in `add-node-popup.tsx` intercepts `type === "component"` and opens the browser dialog instead of calling the standard node-add logic.

### Tabs

| Tab | Content |
|-----|---------|
| Browse | Public marketplace, filtered by `publish_type = 'component'` |
| My Components | Creator's own published components |
| Favorites | User's favorited components |

### Card layout

Each card shows: name, creator, credit cost, I/O type pills (e.g., `image + text → video`), run count, short description. Click to place on canvas.

### Filters

- Category (reuse app categories)
- Output type (image, video, audio, text)
- Sort: popular / newest / most-favorited
- Search with 300ms debounce

### Backend

No new routes. `GET /v1/apps/browse` gets a `publishType` filter param:
- `?publishType=component` → `WHERE publish_type = 'component'`
- Default (no param) returns both, or `?publishType=app` for apps only

One new lightweight route: `GET /v1/apps/by-slug/:slug/latest-version` for update badge checks. Returns `{ latestVersion: number, latestVersionId: string }`. The component node has `appSlug` and `pinnedVersion`, so it compares `pinnedVersion < latestVersion` directly.

## Apps Page Updates

The `/apps` page gets a top-level type toggle: **Apps | Components**. Passes `publishType` filter to browse API. "My Apps" section shows both with type badges.

### Earnings display

Earnings display shows "App" vs "Component" badges per entry, with summary totals split by type. The backend `GET /v1/user/earnings` route (in `monetization.ts`) must JOIN `published_apps.publish_type` and include `publishType` in each earnings item response. Frontend renders a badge based on this field.

## Execution

### Prerequisite: Extract `executeAppRun()` core function

The current `POST /v1/app/:slug/run` handler is tightly coupled to HTTP req/res. Before component execution works, extract the core logic into a reusable function:

```typescript
// backend/src/services/app-execution.ts (NEW FILE)

interface ExecuteAppRunParams {
  appVersionId: string
  workflowId: string
  userId: string
  inputOverrides?: Record<string, Record<string, unknown>>
  nodeIds?: string[]              // for route filtering
  isComponentRun?: boolean        // marks this as a component execution
  skipRateLimit?: boolean         // true for orchestrator-triggered runs (programmatic)
  componentDepth?: number         // nesting depth (0 = top-level, max 5)
  executingComponentIds?: string[] // cycle detection: appSlug values of ancestor components
}

interface ExecuteAppRunResult {
  executionId: string
  appRunId: string
}

async function executeAppRun(params: ExecuteAppRunParams): Promise<ExecuteAppRunResult>
```

This function encapsulates: credit eligibility check → `workflow_execution` creation → `app_runs` record creation → orchestration enqueue. The HTTP route becomes a thin wrapper calling this function. ~100-150 lines of refactoring.

**`app_runs` record is required** — the `process_app_monetization` RPC needs `app_runs.id` as a foreign key for `app_earnings`. Component executions must create `app_runs` records just like app executions. The `executeAppRun()` function creates the `app_runs` record itself (currently only done in the HTTP handler), so the orchestrator doesn't need separate app_runs creation logic.

**Rate limiting**: The `max_runs_per_user_per_day` check on `published_apps` could block programmatic component use inside workflows (e.g., a loop node running a component 20 times). `executeAppRun()` accepts a `skipRateLimit: boolean` flag. The HTTP route passes `false` (user-facing runs are rate-limited). The backend orchestrator's `executeComponentNode()` passes `true` (programmatic runs within workflows skip rate limits). Frontend DAG execution goes through the HTTP route but should also pass a `headless: true` flag which the route interprets as "skip rate limit".

### Frontend DAG executor

New file: `frontend/src/components/editor/workflow-editor/component-executor.ts` (~200-300 lines)

Component nodes are a new execution category in `execute-node.ts`, dispatched via dynamic import (same pattern as sub-workflow):

```typescript
if (node.type === "component") {
  return import("./component-executor").then(({ executeComponent }) =>
    executeComponent(node, ctx).then(() => "")
  )
}
```

`executeComponent()` flow:

1. Read `appSlug`, `appVersionId`, `exposedSettings`, `componentMetadata` from node data
2. Build `inputOverrides` by merging two sources:
   - **Upstream inputs** (from handle wiring): for each input handle, `{ [handle.id]: { [handle.fieldKey]: upstreamValue } }`
     - `fieldKey` comes from `INPUT_FIELD_MAP` at publish time (e.g., `"text"` for text-prompt, `"url"` for upload-image)
   - **Exposed settings** (from config panel): for each exposed setting the consumer configured, merge into the same `inputOverrides` structure:
     ```typescript
     // exposedSettings is keyed by "nodeId:field" → value
     for (const setting of componentMetadata.exposedSettings) {
       const key = `${setting.nodeId}:${setting.field}`
       const value = exposedSettings[key]
       if (value !== undefined) {
         inputOverrides[setting.nodeId] = { ...inputOverrides[setting.nodeId], [setting.field]: value }
       }
     }
     ```
   - This merges both data sources into a single `inputOverrides` object — the app-runner doesn't need to know about exposed settings as a separate concept.
3. `POST /v1/app/:slug/run` with `{ version: pinnedVersion, inputOverrides, headless: true }`
4. Poll `GET /v1/workflow-executions/:execId` until complete (existing polling pattern)
5. On completion: fetch execution's `node_states`, extract outputs using `componentMetadata.outputs`:
   - For each output handle: read `nodeStates[handle.id]?.output?.[handle.fieldKey]`
   - `fieldKey` is the NodeOutput key (e.g., `"imageUrl"`, `"videoUrl"`, `"audioUrl"`, `"text"`)
6. Store results in `node.data.outputResults` (handle ID → output URL/value)
7. The `mediaPreview` output populates the node's result preview area

### Frontend input resolution & output extraction

**`node-input-resolver.ts`** — new case for component sources:

```typescript
} else if (src.type === "component") {
  const outputResults = srcData.outputResults as Record<string, string> | undefined
  if (outputResults && sourceHandle) {
    const handleId = sourceHandle.replace(/^out_/, "")
    output = outputResults[handleId] || undefined
  }
}
```

**`execution-graph.ts`** — new case in `extractNodeOutput()` with fallback chain (matches sub-workflow pattern):

1. Check `sourceHandle` → extract specific output from `outputResults`
2. Fallback: first output marked `mediaPreview: true` in `componentMetadata`
3. Fallback: first available value in `outputResults`

### Backend orchestrator

New `executeComponentNode()` in `node-executor.ts`, dispatched as a new category (before sub-workflow check):

```typescript
if (node.type === "component") {
  return executeComponentNode(node, resolvedInputs, ctx)
}
```

**Execution model: QUEUED (not inline)**

Unlike sub-workflows which execute inline (blocking the parent orchestrator), component execution is **queued** — it creates a separate `workflow_execution` + `app_runs` record and enqueues to the orchestration queue. The parent orchestrator polls for completion. This is necessary because:

1. Monetization requires `app_runs` records with proper FK relationships
2. The child execution needs its own `orchestrator-worker` instance to handle `process_app_monetization` at completion
3. Snapshot loading (frozen nodes/edges from `published_apps`) must happen in the child worker, not the parent

This means a component execution consumes one of the available orchestrator concurrency slots (default: 20). Nested components consume additional slots.

`executeComponentNode()` flow:

1. Read `appSlug`, `appVersionId`, `exposedSettings`, `componentMetadata` from `node.data`
2. Check cycle detection: if `appSlug` in `ctx.executingComponentIds`, throw cycle error
3. Check depth: if `ctx.componentDepth >= 5`, throw depth error
4. Build `inputOverrides` by merging two sources (same logic as frontend executor):
   - **Upstream inputs**: for each input handle, `{ [handle.id]: { [handle.fieldKey]: resolvedValue } }`
   - **Exposed settings**: for each setting, merge `{ [setting.nodeId]: { [setting.field]: value } }`
   - Example: upload-image handle → `{ "node-123": { "url": "https://..." } }`
5. Call `executeAppRun()` (the extracted core function) with `skipRateLimit: true`, `componentDepth + 1`, `executingComponentIds: [...ctx.executingComponentIds, appSlug]`
6. Poll `workflow_executions` table for completion (3s interval, 30min timeout)
7. On completion: read `workflow_executions.node_states`, extract outputs using `componentMetadata.outputs`:
   - For each output handle: read `nodeStates[handle.id]?.output?.[handle.fieldKey]`
   - Example: generate-image handle → `nodeStates["node-456"].output.imageUrl`
8. Return `{ output: { outputResults: { [handleId]: value } } }` to parent DAG
9. Monetization earnings recorded automatically by the **child** `orchestrator-worker` completion handler (existing `process_app_monetization` flow)

### Depth tracking

The `OrchestratorContext` does not currently track depth (sub-workflows use a function parameter). For component nesting, depth is tracked by passing it through the `executeAppRun()` params and into the `WorkflowExecutionJob`. The child orchestrator-worker reads the depth and increments it before executing inner nodes. If an inner node is itself a component, the depth increments again. Max depth 5 applies across both sub-workflows and components combined.

Add to `WorkflowExecutionJob`:
```typescript
componentDepth?: number           // 0 = top-level, incremented for each nested component
executingComponentIds?: string[]  // serialized cycle detection set (appSlug values)
```

`executeComponentNode()` reads `ctx.componentDepth` (or 0), checks `< 5`, passes `componentDepth + 1` to `executeAppRun()`.

### Cycle detection

Sub-workflows detect cycles via a local `Set<string>` passed as a function parameter — this works because they execute inline. Component execution is queued across separate orchestrator workers, so the cycle detection context must be **serialized into the job data**.

`executeComponentNode()` checks if `appSlug` is already in `ctx.executingComponentIds`. If so, throws a cycle error. Otherwise, appends it and passes the updated array to `executeAppRun()`, which includes it in the `WorkflowExecutionJob`. The child orchestrator-worker reads the array into its context.

This prevents: Component A → Component B → Component A (cycle detected when B tries to execute A).

### Concurrency note

Parent orchestrators hold a concurrency slot while polling child component executions. Deep nesting or high fan-out (e.g., 5 parallel components each nesting 3 more) could exhaust the 20 orchestrator slots, causing slowdowns. The depth limit of 5 mitigates this. For v1, this is a known limitation — not a blocker. If it becomes an issue, the orchestrator concurrency can be raised via `ORCHESTRATOR_CONCURRENCY` env var.

### Isolation

The inner execution runs under a **separate `workflow_execution` record** linked to the component's snapshot via `appVersionId`. An `app_runs` record is also created (required for monetization FK). The parent execution sees only the component node's aggregate status (pending → running → completed/failed). The consumer never sees inner node states.

### Credit flow (two-phase model)

Component credit flow follows the existing app-run model, which is **two-phase**:

**Phase 1 — Inner execution (base cost):**
Each inner node in the component's workflow reserves and spends credits individually through the normal orchestrator flow. Credits come from the **consumer's** (runner's) balance. This is identical to how app runs work today.

**Phase 2 — Monetization markup (at completion):**
After the inner execution completes successfully, `orchestrator-worker.ts` calls the `process_app_monetization` RPC. At successful completion, the creator's configured markup is charged to the consumer and credited to the creator's earnings balance ([reference removed]), and an `app_earnings` record is inserted with the full breakdown.

**Pre-check:** Before execution starts, the consumer's balance is validated against `estimated_credits` to catch insufficient funds early. This is a soft check — actual costs may vary.

**On failure:** Inner node credits are refunded individually (existing per-node refund logic). No monetization markup is charged since `process_app_monetization` only runs on successful completion.

### Nesting

Component nesting is supported. A workflow containing component nodes can be published as an app or another component. Each component execution creates its own `workflow_execution` + `app_runs` record. Depth limit 5 and cycle detection (same as sub-workflows) prevent runaway recursion. Depth is tracked via the orchestrator context and incremented for each nested component/sub-workflow execution.

## New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `backend/src/services/app-execution.ts` | Extracted `executeAppRun()` core function (refactored from app-runner.ts) | 100-150 |
| `frontend/src/components/editor/workflow-editor/component-executor.ts` | Frontend component execution (resolve inputs, call API, poll, extract outputs) | 200-300 |
| `frontend/src/components/nodes/component-node.tsx` | Component node canvas component (purple theme, result preview, creator footer) | 150-250 |
| `frontend/src/components/editor/config-panels/component-config.tsx` | Config panel (info card, exposed settings, handles list) | 200-300 |
| `frontend/src/components/editor/component-browser-dialog.tsx` | Component Browser modal (browse/my/favorites, search, filters, cards) | 300-400 |
| `supabase/migrations/XXX_components.sql` | Schema migration (publish_type, component_metadata, index) | 20-30 |

## Modified Files

| File | Changes |
|------|---------|
| `backend/src/routes/app-runner.ts` | Refactor to call `executeAppRun()`, add `headless` flag support |
| `backend/src/routes/published-apps.ts` | `publishType` filter on browse, `componentMetadata` on publish, version check endpoint |
| `backend/src/services/workflow-engine/node-executor.ts` | Add `component` dispatch case → `executeComponentNode()` |
| `backend/src/services/workflow-engine/input-resolver.ts` | Add `component` source case (backend side, mirrors frontend) |
| `backend/src/services/workflow-engine/output-extractor.ts` | Add `component` case for extracting `outputResults` |
| `backend/src/services/workflow-engine/types.ts` | Add `componentDepth` to `WorkflowExecutionJob` and `OrchestratorContext` |
| `backend/src/workers/orchestrator-worker.ts` | Pass `componentDepth` through context, read from job data |
| `frontend/src/types/nodes.ts` | `ComponentNodeData`, `SceneNodeType` union, `SceneNodeData` union, `NODE_DEFINITIONS` entry |
| `frontend/src/components/nodes/index.ts` | Register `component-node` in `nodeTypes` map |
| `frontend/src/components/editor/add-node-popup.tsx` | "Component" entry that intercepts and opens browser dialog |
| `frontend/src/components/editor/node-toolbar.tsx` | "Component" entry (same intercept pattern) |
| `frontend/src/components/editor/config-panel.tsx` | Add `case "component"` dispatch |
| `frontend/src/components/editor/config-panels/index.ts` | Export `ComponentConfig` |
| `frontend/src/components/editor/editor-toolbar.tsx` | Add `case "component"` to reset/clear switch |
| `frontend/src/components/editor/workflow-editor/types.ts` | Add `"component"` to `EXECUTABLE_NODE_TYPES` |
| `frontend/src/components/editor/workflow-editor/execute-node.ts` | Add `component` dispatch case (dynamic import) |
| `frontend/src/components/editor/workflow-editor/execution-graph.ts` | Add `component` case in `extractNodeOutput()` with fallback chain |
| `frontend/src/components/editor/workflow-editor/node-input-resolver.ts` | Add `component` source case for `outputResults` |
| `frontend/src/lib/api.ts` | `browseComponents()`, `getLatestComponentVersion()`, `publishType` param on existing functions |
| `frontend/src/app/(dashboard)/apps/page.tsx` | Type toggle (Apps \| Components), type badges on cards |
| `backend/src/routes/monetization.ts` | Add `publishType` to earnings response items (JOIN `published_apps.publish_type`) |
| `backend/src/billing/credits.ts` | `STATIC_CREDIT_COSTS` entry (0 — component itself is free, inner nodes have their own costs) |
| `packages/shared/src/presentation-utils.ts` | Exclude `component` from `NON_OUTPUT_TYPES` if needed |

## Scope

### In scope (v1)

- `published_apps` schema additions (`publish_type`, `component_metadata`, filtered index)
- Extract `executeAppRun()` core function from app-runner HTTP handler
- Publish dialog: component mode with handle config + exposed settings
- `component` node type (18-step registration, all files listed above)
- Component node UI: purple theme, result preview, version badge, config panel
- Component Browser dialog (browse/my/favorites tabs, search, filters)
- Apps page: type toggle (Apps | Components)
- Execution: frontend DAG + backend orchestrator via extracted app-runner function
- `app_runs` records for component executions (required for monetization FK)
- Earnings display: app vs component breakdown (JOIN on `published_apps.publish_type`)
- Version check endpoint
- `AppBrowseCard` DTO: add `publishType` + `componentMetadata` fields

### Out of scope (v1)

- Ratings/reviews (favorites + run count sufficient for ranking)
- Private/team components (public marketplace only)
- Dedicated component analytics dashboard (existing earnings page suffices)
- Auto-migration on version update (consumer re-wires manually)
- Component forking/remixing
- Composite credit estimation breakdown (would leak internals)
- Denormalized `publish_type` on `app_earnings` (JOIN is sufficient for v1)
