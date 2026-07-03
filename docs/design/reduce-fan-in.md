# Collect (Fan-In) Node — Design Spec

> **Note:** This node shipped as `reduce`. This design doc uses its original working name, "collect".

**Date:** 2026-05-21
**Status:** Proposed
**Phase:** 1 of 2 — Phase 2 (parallelize `executeNodeForList`) lives in a separate spec.

## Summary

Add a `collect` node that consumes the `listResults` of an upstream fanned-out node and produces a single aggregated output via a pluggable strategy (pick-best-via-LLM, concat, count, first-non-empty, vote, merge-json). Closes the fan-out/fan-in asymmetry in the DAG without touching the acyclic invariant: `List/Loop → fanned-out node → Collect → continue`.

## Goals

1. First-class "generate N → reduce to 1 → continue" pattern as a 2-node thing instead of a custom downstream node or out-of-band pipeline.
2. Strategy registry that ships new aggregation modes additively (mirrors `parameter-picker-registry`) — each strategy declares its config schema and its result-rendering metadata.
3. UI that reads as "N inputs → 1 output" without lying about what happened (no "lost jobs" perception).
4. No changes to the credit-guard hot path; no changes to executor concurrency semantics; no new cycles in the DAG.

## Non-Goals

- **Parallelize `executeNodeForList`** — separate spec, requires dedup-fingerprint concurrency-safety pass (Phase 2).
- **Multi-source Collect** (merging two parallel fan-out branches via zip/cartesian/pad) — defer to v2.
- **List-output strategies** (top-K, filter, sort that emit a smaller list) — defer to v2; scalar output only in v1.
- **Nested fan-out** (`list → loop → list`) — already-deferred, not in scope.
- **While-loops / cycles / backward edges** — out of scope by architectural decision.

---

## Design

### 1. Node shape

**Data type** — added to `frontend/src/types/nodes.ts`:

```typescript
interface CollectNodeData extends BaseNodeData {
  type: "collect"
  strategyId: CollectStrategyId   // discriminant
  strategyConfig: Record<string, unknown>  // shape per-strategy, validated at runtime
}
```

**Handles:**
- One input handle `in` (accepts upstream `list` output OR direct connection to a fanned-out node — see §4 for resolution).
- One output handle `out` — type depends on strategy (`text | number | image-url | video-url | audio-url | json`).

**Category in `add-node-popup.tsx`:** "Workflow" — the category that already holds `router`, `sub-workflow-input`, `sub-workflow-output`, `sub-workflow`, `teleport-send`, `teleport-receive`. (List/Loop themselves live in the "Data" category since they're data sources; Collect is control-flow, so it belongs with Router. Collect makes no provider calls except `pick-best-llm`, and even that is a control-plane LLM judge, not a generative output.)

### 2. Strategy registry

**Shared registry** at `packages/shared/src/collect-strategy-registry.ts` (single source of truth for backend + frontend):

```typescript
export type CollectStrategy<TConfig = unknown, TResult = unknown> = {
  readonly id: string
  readonly label: string                      // human-readable, used in dropdown
  readonly description: string                // short tooltip
  readonly configSchema: ZodType<TConfig>     // validated in route + UI
  readonly defaultConfig: TConfig
  readonly outputType: OutputType             // "image" | "video" | "audio" | "text" | "data" — from packages/shared/src/presentation-utils.ts
  readonly creditCostKey: string              // e.g. "collect:pick-best-llm" — looked up in STATIC_CREDIT_COSTS
}

export type CollectStrategyId = typeof COLLECT_STRATEGIES[number]["id"]

export const COLLECT_STRATEGIES = [
  PICK_BEST_LLM_STRATEGY,
  CONCAT_STRATEGY,
  FIRST_NON_EMPTY_STRATEGY,
  COUNT_STRATEGY,
  VOTE_STRATEGY,
  MERGE_JSON_STRATEGY,
] as const

export function getStrategy(id: CollectStrategyId): CollectStrategy
```

**Input shape — `string[]`, not `NodeOutput[]`.** `NodeOutput.listResults` is `string[]` (`backend/src/services/workflow-engine/types.ts:41`) and `extractNodeOutputAsList()` returns `string[]`. Image/video/audio inputs come through as URL strings; the strategy decides how to interpret them (`pick-best-llm` sends URLs to Sonnet which can see images; `merge-json` parses each string as JSON).

**Backend execution side** — strategy implementations live in `backend/src/services/collect-strategies/<id>.ts`, each exporting:

```typescript
export async function execute(
  items: string[],
  config: TConfig,
  ctx: { userId: string; jobId: string; logger: Logger }
): Promise<{ result: string | number; meta: ResultMeta }>

export type ResultMeta = {
  readonly selectedIndex?: number            // pick-best, first-non-empty
  readonly reasoning?: string                // pick-best LLM rationale
  readonly summary: string                   // 1-line human-readable
}
```

A central dispatcher `backend/src/services/collect-strategies/index.ts` maps `strategyId → execute()` and is the only thing the route imports. Adding a strategy = new file + 1 line in the dispatcher + 1 entry in the shared registry.

> **Pattern note:** one-file-per-strategy is a new convention for this codebase. Prior pluggable registries (`parameter-picker-registry`, `combine-transitions`, `audio-crossfade-curves`) centralize their config in a single file. Collect splits because each strategy has meaningful execution code (especially `pick-best-llm`), not just static config. If subsequent registries adopt this pattern, extract a shared convention in a follow-up.

### 3. v1 strategies

| Strategy | Config | Output type | Behavior | Credit cost key |
|----------|--------|-------------|----------|-----------------|
| `pick-best-llm` | `{ criteria: string; inputKind: "text" \| "image-url" }` | string (URL or text — matches input) | Sonnet judges all N items against `criteria`, returns chosen item + reasoning. For `inputKind: "image-url"` Sonnet sees images via URL; video pick-best deferred to v2 (needs frame extraction). | `collect:pick-best-llm` (TBD, suggest 3 cr) |
| `concat` | `{ separator: string }` (default `"\n\n"`) | `text` | Joins all string items with separator | `collect:concat` (0 cr) |
| `first-non-empty` | `{}` | string (matches input) | Returns first item that is non-null/non-empty | `collect:first-non-empty` (0 cr) |
| `count` | `{}` | `"data"` (value is a number stringified for transport) | Returns `valid.length` (count of survivors after empty-string filter) | `collect:count` (0 cr) |
| `vote` | `{ caseSensitive?: boolean }` | `text` | Returns most-common string (ties → first) | `collect:vote` (0 cr) |
| `merge-json` | `{ strategy: "deep" \| "shallow" }` | `json` (serialized) | Parses each item as JSON, merges into one object, returns JSON string | `collect:merge-json` (0 cr) |

> All "Behavior" descriptions above operate on **survivors only** — empty strings from failed upstream iterations are filtered out before strategy execution (see §4 Failure handling). E.g. `count` returns survivor count, not attempt count; `concat` joins survivors without empty separators.

**Pick-best-llm prompt template** (in `backend/src/services/collect-strategies/pick-best-llm.ts`):

```
You are judging N candidate outputs against criteria.
Criteria: {criteria}
Candidates:
  [1] {item_1}
  [2] {item_2}
  ...
Reply with JSON: { "chosen_index": <1-based>, "reasoning": "<one sentence>" }
```

Uses `llmComplete` from `backend/src/lib/llm-client.ts` with model id `claude-sonnet-4.6` (DOT form — canonical for the unified LLM client per `backend/CLAUDE.md` "Unified LLM Client" table). NOT to be confused with `claude-sonnet-4-6` (hyphen) used by `ee/pipelines/llms/call-llm.ts`, which is a separate code path for pipeline-specific critics.

**Image content block handling — implementation decision required.** `llmComplete` tries KIE's messages proxy first and falls back to direct Anthropic SDK only when `directFallbackModel` is set. The direct-Anthropic path accepts `{ type: "image", source: { type: "url", url: item } }` content blocks natively (verified at `llm-client.ts:144` — the client converts the shape correctly). KIE's proxy behavior with image content blocks is NOT verified — it may strip image blocks, error, or work silently incorrectly.

For `inputKind: "image-url"`, the implementer must pick ONE of:
1. **Force direct-Anthropic path**: pass `directFallbackModel: "claude-sonnet-4-6"` on every call (verified at `packages/shared/src/llm-models.ts:70` — this is the current direct-Anthropic SDK id for the Sonnet model that pairs with the KIE-side `claude-sonnet-4.6`; the dot vs hyphen difference is real, one is KIE's id and one is Anthropic SDK's). Skips KIE entirely. Simplest, but loses KIE cost/rate-limit pooling.
2. **Verify KIE supports image content blocks** via direct test against KIE before implementation. If yes, route normally; if no, fall back to option 1.
3. **Borrow the `ee/pipelines/llms/image-critic.ts` pattern** (uses `callLLM`, which has battle-tested image support). Requires either moving pick-best-llm into ee/ OR extracting a shared core helper. Heavier, but it's the same problem image-critic already solved.

Recommended default: **option 1** for v1 (smallest blast radius, fully predictable). Revisit if pick-best-llm volume justifies KIE routing.

**Output type:** all strategies return `string` (URLs are strings) or `number` (count). Downstream type-routing follows the same per-item URL regex classification already used by `input-resolver.ts:117-128` (mixed photo/video lists handled via `VIDEO_URL_RE`).

### 4. DAG execution semantics

**The core problem:** today's `executeNodeForList` (`frontend/src/components/editor/workflow-editor/list-execution.ts:20`) detects an upstream List/Loop and fans out the consuming node, running it N times. A Collect node connected to that same fan-out source must NOT itself be fanned out — it needs the *whole* `listResults` array as a single input.

**Existing precedent — `ARRAY_ACCUMULATING_TYPES`.** `backend/src/services/workflow-engine/input-resolver.ts:661` already declares:

```typescript
const ARRAY_ACCUMULATING_TYPES = new Set(["combine-videos", "mix-audio", "combine-audio"])
```

…and at line 111-116 handles the fan-in case by routing each item individually through `routeOutput()` into type-specific media arrays (`videoUrls`, `audioUrls`). This is the closest existing pattern: nodes that consume a list rather than being fanned out.

**Why a new sibling set, not joining ARRAY_ACCUMULATING_TYPES.** `ARRAY_ACCUMULATING_TYPES` routes items into typed media arrays via `routeVideoOutput`/`routeAudioOutput`. Collect doesn't care about media type — it wants the raw `string[]`. Different routing target, so:

```typescript
// backend/src/services/workflow-engine/input-resolver.ts (sibling of ARRAY_ACCUMULATING_TYPES at line 661)
// Match the existing convention: plain Set<string> with string literals, NOT a literal-union type
const FAN_IN_NODE_TYPES = new Set(["collect"])
```

**Resolution rule** — in `getListInputForNode` (`backend/src/services/workflow-engine/input-resolver.ts:369`):

> Before walking upstream for a fan-out source, check `FAN_IN_NODE_TYPES.has(node.type)`. If true, the node is *itself* the consumer — return `null` for fan-out detection (no fan-out happens). In the per-item-routing branch (around line 105-116), add a parallel branch for `FAN_IN_NODE_TYPES` that sets `inputs.listInputs = filtered` (full `string[]`) instead of routing items individually.

**New input-resolver behavior — single-result wrapping.** Today the resolver pulls `state?.output?.listResults` (line 85-90 area); if upstream wasn't fanned out, this is `undefined` and Collect has no input. We need a fallback: when target is in `FAN_IN_NODE_TYPES` and `listResults` is missing, wrap the upstream's primary output: `effectiveListResults = listResults ?? (output != null ? [output] : [])`. This is **new logic** to add to the resolver.

**Frontend mirror:** same check in `list-execution.ts:executeNodeForList` (line 20) — skip fan-out if the current node is in the frontend's `FAN_IN_NODE_TYPES` set. Read upstream's `__listResults` directly and pass as `string[]` to a single execute call.

**Result:** the graph `List → GenerateImage → Collect` produces:
- `GenerateImage` runs N times (fan-out, existing behavior)
- `Collect` runs ONCE with `items: string[] = listResults`
- Downstream of `Collect` sees a single output (existing behavior)

**Cycle invariant:** unchanged. Kahn topo sort still works — Collect is just another node with a deterministic input → output relationship.

**Failure handling — dense `listResults` with empty-string failures.** `executeNodeForList` allocates `new Array(items.length).fill("")` at `frontend/src/components/editor/workflow-editor/list-execution.ts:106` and writes results in-place per iteration. Failed iterations remain `""`. Collect therefore receives a **dense array including empty strings for failures** — NOT a sparse array, and NOT explicit nulls. Define the contract:

- **All strategies normalize inputs first:** `const valid = items.filter((s) => s !== "")` at the top of every `execute()`. This gives the strategy the survivor count `valid.length` and avoids feeding empty strings into Sonnet / JSON.parse / vote tallies.
- **Strategies that accept any count:** `concat` (joins survivors only — no empty separators), `count` (returns `valid.length`, NOT `items.length` — count is "successes", not "attempts"), `first-non-empty` (already trivially correct), `vote` (counts survivors).
- **Strategies that need ≥1 survivor:** `pick-best-llm`, `merge-json`. When `valid.length === 0`, these throw `EmptyInputError`; route returns 400 with `{ code: "no_valid_inputs", message: "All upstream iterations failed; nothing to collect." }`.
- **Collect's node status reflects strategy result:** if `valid.length === 0` AND the strategy throws, Collect itself goes to `failed`. If `valid.length < items.length` and the strategy succeeds, Collect succeeds with whatever items came through; `meta.summary` reflects the count (`"Collected from 3 of 5 inputs (2 upstream failures)"`). The orchestrator's node-failure cascade is unchanged — Collect failure stops downstream as usual.
- **Implementation note:** factor the `items.filter((s) => s !== "")` normalization into a shared helper at `backend/src/services/collect-strategies/_normalize.ts` so all six strategies stay consistent.

### 5. Credit pricing

- Per-strategy keys in `STATIC_CREDIT_COSTS` (`backend/src/ee/billing/credits.ts`) using the composite-key pattern already established for `gpt-image:high`:
  - `"collect:pick-best-llm": 3`
  - `"collect:concat": 0`
  - `"collect:first-non-empty": 0`
  - `"collect:count": 0`
  - `"collect:vote": 0`
  - `"collect:merge-json": 0`
- `CREDIT_COSTS` entry for `collect` resolves to the strategy-specific key via `data.strategyId`.
- Migration `NNN_collect_node_pricing.sql` inserts the 6 composite keys into `model_pricing` (per CLAUDE.md pitfall 3 — admin UI reads DB, not `STATIC_CREDIT_COSTS`).

### 6. Frontend UX

**Node component** (`frontend/src/components/nodes/collect-node.tsx`):
- Standard node frame.
- **"N → 1" pill** in the header — counts items from upstream `listResults` length (live, updates when fan-out completes). Pill grey when idle/awaiting, brand-pink when execution complete.
- Strategy label as subtitle (e.g. "Pick best (LLM)").

**Config panel** (`frontend/src/components/editor/config-panels/collect-configs.tsx`):
- Layout: shadcn `<Tabs>` (primitive at `@/components/ui/tabs`, already imported by `image-configs.tsx:17` for the provider multi-picker — established precedent). Two tabs: **Config** (default) and **Inputs**. The Inputs tab is only enabled when `nodeState.status === "completed"` AND upstream `listResults.length > 0`; otherwise it shows a disabled hint ("Run the workflow to inspect inputs").
- **Config tab:** strategy picker dropdown over `COLLECT_STRATEGIES` + per-strategy form rendered from `getStrategy(id).configSchema` (criteria textarea for pick-best-llm, separator input for concat, deep/shallow radio for merge-json, etc.).
- **Inputs tab** — visible when the node has been executed (i.e. `NodeOutput.listResults` is populated on the input edge):
  - Renders N input items as a vertical list of thumbnail/chip rows.
  - Highlights `meta.selectedIndex` with a brand-pink ring + "selected" badge (for pick-best-llm, first-non-empty).
  - Renders `meta.reasoning` as a blockquote below the highlighted item (pick-best-llm only).
  - For `concat`/`count`/`vote`/`merge-json`: shows all N items unstyled + a summary chip up top ("Joined 5 items", "Counted 5", "Winner: 'option_a' (3/5 votes)", "Merged 5 JSON objects").
- Reuses existing inspection patterns from the fan-out side; no new canvas wiring.

**Skip:** per-iteration connector visual (one edge per clone into Collect). It fights the current "one source edge → Collect" mental model in React Flow and isn't worth the canvas-layer work. The pill + inputs tab + existing `expandLoopResults` clones on the fan-out side already carry the legibility load.

### 7. Backend

**Route** (`backend/src/routes/collect.ts`):
- `POST /v1/collect` — concrete Zod schema, mirroring `routes/ai-writer.ts` and `routes/qa-check.ts` (both inline-LLM routes):

```typescript
const collectBody = z.object({
  strategyId: z.enum(COLLECT_STRATEGY_IDS),       // discriminant; from shared registry
  strategyConfig: z.record(z.unknown()),           // per-strategy shape; validated at dispatcher via getStrategy(id).configSchema
  inputs: z.array(z.string()),                     // the upstream listResults — dense array, empty strings for failures (see §4)
  workflowExecutionId: z.string().uuid().optional(),  // audit trail + dedup-fingerprint differentiator (see below)
})
```

- **Pattern:** thin Fastify route → `creditGuard` → dispatcher → returns aggregated result.
- **`creditGuard` resolver** reads `req.body.strategyId` from the raw body (before Zod strips), same `resolveLlmCreditId()`-style pattern used by `ai-writer.ts:9` and `qa-check.ts`. The resolver returns the composite key `"collect:" + strategyId` (e.g. `"collect:pick-best-llm"`) which `creditGuard` looks up in `STATIC_CREDIT_COSTS` / `model_pricing`.
- **Dedup-fingerprint bypass — REQUIRED.** The 2026-05-20 dedup-fingerprint middleware hashes `req.url + JSON.stringify(req.body)` and collapses identical POSTs within a 10s window. Two distinct workflow runs that produce identical upstream outputs (e.g. cached results, deterministic prompts, or rapid re-runs) would collide on Collect — silently returning the first run's job id and leaving the second run hanging. Mitigation:

```typescript
app.post("/v1/collect", {
  preHandler: creditGuard(
    (req) => `collect:${(req.body as Record<string,unknown>).strategyId}`,
    { dedup: false }  // identical inputs across workflow runs MUST NOT collapse
  ),
}, ...)
```

`{ dedup: false }` is the established escape hatch (precedent: `routes/voice-clones.ts` uses it for both POST handlers). The optional `workflowExecutionId` in the body is a belt-and-suspenders measure but is NOT sufficient on its own — pass `dedup: false`.

- **Inline execution** (no BullMQ queue) — strategies are either pure functions (0-credit ones) or a single `llmComplete` call (pick-best-llm). The worker pattern is overkill; the LLM call is bounded by `llm-client.ts:16` (`LLM_TIMEOUT_MS = 120s`) which is well inside the 30-min `NODE_TIMEOUT_MS`. If pick-best-llm latency becomes an issue at scale, promote to the queue then.
- **Returns** `{ jobId, output, meta }` — `output` is `string` (for url/text strategies) or stringified `number` (for `count`); `meta` is the `ResultMeta` shape from §2. Matches existing `NodeOutput` conventions so frontend `executeNode` integration is symmetric.

**Strategy implementations** in `backend/src/services/collect-strategies/`:
- `pick-best-llm.ts` (uses `llmComplete` with `claude-sonnet-4.6`).
- `concat.ts`, `first-non-empty.ts`, `count.ts`, `vote.ts`, `merge-json.ts` (pure functions).
- `index.ts` — central dispatcher (map `strategyId → execute`).

**EE consideration:** `pick-best-llm` consumes paid LLM credits — its credit cost is gated through the standard `creditGuard` middleware shim (which dispatches to `ee/lib/credit-guard-impl` only when `hasCredits()`). No new `ee/` placement needed; the strategy itself lives in core, the credit gating is already at the middleware layer.

**MCP exposure:** add `collect` tool at `backend/src/lib/mcp/tools/collect.ts` (the existing MCP tool directory — `apps.ts`, `characters.ts`, `components.ts`, etc. live here) mirroring the route. Scope: `workflows:execute` (consistent with other workflow-execution tools). Out of scope for v1 ship — add as a follow-up after the node lands.

### 8. Registration checklist

Cross-references `[internal spec reference removed]` (the 19-step master). All 19 standard steps apply. Steps with non-standard content:

- **Step 3 (`STATIC_CREDIT_COSTS`)** — 6 composite keys (one per strategy), not a single key. Resolver in `CREDIT_COSTS` reads `data.strategyId` to pick the key. Existing precedent for composite keys: `gpt-image:high`, `flux:2K` (per `backend/CLAUDE.md` "Variable Credit Pricing" table).
- **Step 9 (sidebar list)** — Collect lives in the **Workflow** category in `add-node-popup.tsx` alongside list/loop/router/sub-workflow-input/sub-workflow-output/sub-workflow/teleport-send/teleport-receive.
- **Step 15 (executable gate)** — the actual gate is `isExecutableNode(node)` at `frontend/src/components/editor/workflow-editor/types.ts:262`, backed by an `EXECUTABLE_TYPES` set in that file (root CLAUDE.md refers to this as `EXECUTABLE_NODE_TYPES` — the spec there is mildly stale on the name, but the concept is real). Add `"collect"` to `EXECUTABLE_TYPES`. The Collect node IS executable (unlike List/Loop which are sources in `SOURCE_NODE_TYPES`).
- **Step 16 (DAG execution block)** — branch must NOT call `executeNodeForList`; instead resolve the upstream's `__listResults` (via `extractNodeOutputAsList()`) and call `executeCollectNode` once. New helper.
- **Step 18 (`node-input-resolver.ts` frontend / `input-resolver.ts` backend)** — see §4: special-case Collect via the new `FAN_IN_NODE_TYPES` set, plus the single-result wrapping fallback. New logic, not just a registration step.
- **Step 19 (`NODE_REGISTRY` at `backend/src/lib/node-registry.ts`)** — descriptor's `inputSchema` describes the common fields only (the `strategyId` picker UI hint + a generic `strategyConfig` slot); per-strategy config validation is deferred to the dispatcher via `getStrategy(id).configSchema`. `capabilities` lists per-strategy info for the `GET /v1/nodes` discovery API.

**Two new sets to add (NOT in the existing 19-step list):**
- `FAN_IN_NODE_TYPES` in `backend/src/services/workflow-engine/input-resolver.ts` (sibling of `ARRAY_ACCUMULATING_TYPES` at line 661) — `Set<"collect">` for v1.
- Same set in `frontend/src/components/editor/workflow-editor/types.ts` for parity with the frontend executor.

These are net-new concepts; flag for inclusion in `[internal spec reference removed]` as Step 20 once this lands.

**Additional verification points (during implementation):**

- **`output-extractor.ts`** — REQUIRED: add `case "collect"` to `getPrimaryOutput()` at `backend/src/services/workflow-engine/output-extractor.ts:267`. Verified during audit that this function dispatches on node type with ~15 existing cases (sub-workflow, suno-voice, voice-design, qa-check, router, etc.) and currently has no fallthrough for Collect's `{ result, meta }` shape — without an explicit case Collect's downstream consumers would receive `undefined`. Return `output.result` (string or stringified number).
- **`payload-builder.ts`** — Collect uses inline sync execution (not BullMQ); confirm the orchestrator's sync-HTTP execution branch (per `backend/CLAUDE.md` "Execution Categories" table — same path as `ai-writer`, `lottie-overlay`) covers Collect, or whether a new inline branch is needed.
- **Clone persistence** — Collect runs ONCE per workflow execution (not per list item). It does NOT participate in `expandLoopResults` / `collapseExpandedClones`. The frontend's clone-detection (`__expandedClone` flag + `_iter_\d+$` ID pattern) should skip Collect naturally because Collect is not on the fan-out source side.
- **Run from here / Run selected** — since Collect is in `EXECUTABLE_TYPES`, these patterns work out of the box. No special case needed; standard topo-sort handles it.

### 9. Public docs

Per CLAUDE.md "Public Docs Maintenance Rule":
- Create `docs/nodes/workflow/collect.md` — describes the 6 strategies, when to use each, pricing per strategy, worked examples (especially for pick-best-llm criteria writing).
- Add row to `docs/nodes/README.md`.
- Cross-check examples in docs against tests in `backend/src/services/collect-strategies/*.test.ts`.

### 10. SDK & client

- Add `collect` tool to `@nodaro/client` `nodes` resource (auto-generated from `NODE_REGISTRY` if that path exists; otherwise manual).
- Add usage example to `docs/sdk-quickstart.md`.

---

## Tests

**Shared** (`packages/shared/src/__tests__/collect-strategy-registry.test.ts`):
- Snapshot the registry's strategy IDs (catches silent renames/drops — same pattern as `combine-transitions.test.ts`).
- Each strategy's `configSchema` accepts `defaultConfig`.
- `getStrategy(id)` returns the right strategy; unknown id throws.

**Backend** (`backend/src/services/collect-strategies/__tests__/`):
- One test file per strategy (`pick-best-llm.test.ts`, `concat.test.ts`, etc.).
- `pick-best-llm`: mock `llmComplete`, assert prompt template + chosen-index parsing + reasoning surfacing; tests for malformed LLM responses (fall back to index 0 with `reasoning: "fallback"`); tests for empty `items`.
- `concat`: separator handling, empty items skipped, mixed-type input coerced to string.
- `vote`: tie-breaking (returns first), case-sensitive flag, empty items.
- `merge-json`: deep vs shallow, conflict resolution (last-write-wins), non-JSON input → typed error.
- Each strategy: empty `items` → typed error (return `null` output + `meta.summary: "No inputs"`).

**Backend route** (`backend/src/routes/__tests__/collect.test.ts`):
- Auth required, strategyId validated against registry, configSchema validated per-strategy.
- Credit reservation via composite key.
- Returns `{ jobId, output, meta }` shape.
- **Dedup-fingerprint bypass verification:** the route is registered with `{ dedup: false }` (see §7). Tests: (a) two POSTs with identical body within 10s both create distinct jobs (no `deduped: true` short-circuit), (b) a 10-iteration workflow with deterministic upstream still creates 10 Collect jobs across re-runs, not 1.

**Backend DAG** (`backend/src/services/workflow-engine/__tests__/`):
- `execution-graph.test.ts`: `LIST_CONSUMER_NODE_TYPES` does not fan out.
- `input-resolver.test.ts`: Collect's `in` handle resolves to upstream's `listResults` or `[singleOutput]`.
- End-to-end: `List → GenerateImage → Collect(pick-best-llm) → DownstreamNode` — GenerateImage fans out 3×, Collect runs 1×, downstream sees Collect's single output.

**Frontend** (`frontend/src/components/__tests__/collect-node.test.tsx`):
- Renders "N → 1" pill correctly when upstream has listResults.
- Pill is grey when idle, brand-pink when complete.
- Config panel renders correct UI per `strategyId`.
- Inputs tab highlights `meta.selectedIndex` and renders `meta.reasoning`.

**Total estimate:** ~50 tests across 8-10 files.

---

## Open questions

None blocking. The single-vs-multi-source question was resolved in conversation (single-source for v1, multi-source as v2). The strategy list is finalized at 6 for v1. The credit cost for `pick-best-llm` is a suggested 3 cr — to be finalized with the cost-model owner during PR review.

## Phase 2 preview (separate spec)

Once Collect ships and proves the shape:

1. **Parallelize `executeNodeForList`** — concurrency knob on Loop/List nodes (default `4`, configurable up to `16`).
2. **Dedup-fingerprint × fan-out concurrency-safety pass** — either `dedup: false` from `executeNodeForList` (option already exists on `creditGuard`, used by `voice-clones.ts`) or mix iteration index into fingerprint payload. Settle before flipping parallel on.
3. **Credit reservation race audit** — verify `FOR UPDATE` locks on credit RPC survive parallel fan-out load; add a load test if not already covered.

v2 additions (no spec yet):
- Multi-source Collect (zip / pad / cartesian).
- List-output strategies (top-K, filter, sort).
- Nested fan-out (`list → loop → list`).

---

## Verified codebase references (2026-05-21)

Every architectural claim in this spec is anchored to a real file. Implementers should navigate from these, not from CLAUDE.md alone:

| Concept | Path | Line | Notes |
|---|---|---|---|
| `NodeOutput.listResults: string[]` | `backend/src/services/workflow-engine/types.ts` | 41 | Strings only — strategies parse URLs/JSON from strings |
| `getListInputForNode` | `backend/src/services/workflow-engine/input-resolver.ts` | 369 | Fan-out detection — must early-return for `FAN_IN_NODE_TYPES` |
| `ARRAY_ACCUMULATING_TYPES` (sibling pattern) | `backend/src/services/workflow-engine/input-resolver.ts` | 661 | `Set(["combine-videos", "mix-audio", "combine-audio"])` — closest precedent; routes per-item to typed media arrays |
| Per-item routing branch | `backend/src/services/workflow-engine/input-resolver.ts` | 111-116 | Where `FAN_IN_NODE_TYPES` branch must hook in |
| Mixed media-type per-item classification | `backend/src/services/workflow-engine/input-resolver.ts` | 117-128 | `VIDEO_URL_RE` precedent for typing strings |
| `executeNodeForList` | `frontend/src/components/editor/workflow-editor/list-execution.ts` | 20 | Fan-out engine — must skip when target is in `FAN_IN_NODE_TYPES` |
| `expandLoopResults` | `frontend/src/components/editor/workflow-editor/list-execution.ts` | 188 | Visual clone expansion — unchanged, lives on fan-out side |
| `isExecutableNode` / `EXECUTABLE_TYPES` | `frontend/src/components/editor/workflow-editor/types.ts` | 262 | Step-15 gate — add `"collect"` to the set |
| `STATIC_CREDIT_COSTS` (composite keys) | `backend/src/ee/billing/credits.ts` | ~96+ | Pattern: `"gpt-image:high"`, `"flux:2K"` — use `"collect:<strategy>"` |
| Composite-key resolver helper | `frontend/src/components/editor/config-panels/helpers.ts` | — | `buildCreditModelIdentifier()` — Collect frontend equivalent reads `data.strategyId` |
| `llmComplete` (unified LLM client) | `backend/src/lib/llm-client.ts` | 56 | `claude-sonnet-4.6` (DOT) — canonical for this path |
| MCP tools directory | `backend/src/lib/mcp/tools/` | — | NOT `ee/mcp/tools/` |
| `NODE_REGISTRY` | `backend/src/lib/node-registry.ts` | — | Discovery API descriptor |
| `creditGuard` core shim | `backend/src/middleware/credit-guard.ts` | — | Stays in core, dispatches to `ee/lib/credit-guard-impl.ts` |

## Net-new logic flagged for review

These are NOT just registration changes — they are net-new code paths that need their own test coverage:

1. **`FAN_IN_NODE_TYPES` set + per-item-routing branch** in `input-resolver.ts` (~10 lines). Mirror in frontend `list-execution.ts`.
2. **Single-result wrapping fallback** — when target is in `FAN_IN_NODE_TYPES` and upstream has no `listResults`, wrap the primary output as `[output]`. Currently no analogous behavior in the resolver; needs unit test for both array and non-array upstream cases.
3. **`extractNodeOutputAsList()` consumption path** — verify the frontend helper (per `frontend/CLAUDE.md` "List / Loop / Skip Node Patterns") returns `string[]` consistently across all upstream node types; Collect depends on this contract.
4. **`llmComplete` image-URL content block usage** — pick-best-llm sends `{ type: "image", source: { type: "url", ... } }` content. Verify the unified client's messages API path supports this shape (the `ee/pipelines/llms/image-critic.ts` does similar work via `callLLM`; the `llmComplete` path may need a thin extension).
