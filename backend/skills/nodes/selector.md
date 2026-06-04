---
node_type: selector
generated_at: 2026-06-04T12:41:29.174Z
generated_from: 9bf1388db
---

# Selector

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `selector`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `picked`, `rest`

**Required data fields:**
- `label: string`
- `config: SelectorConfig`

**Optional data fields:**
- `pickedResults?: string[]`
- `__pickedResults?: string[]`
- `__pickedTotal?: number`
- `restResults?: string[]`
- `__restResults?: string[]`
- `__restTotal?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Selector",
  "config": {
    "mode": "item",
    "itemIndex": "1"
  }
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Pick one item — or a subset — from an upstream list when the selection is shared across multiple downstream consumers, complex enough to deserve a label on the canvas, or needs operators the per-edge selector doesn't support (random, modulo, predicate, named-key).

The edge selector (`outputMode: "item"`, range tab, list tab) stays the right tool for trivial single picks feeding one consumer. Reach for the Selector node when:

- The same selection feeds multiple downstream consumers (DRY — configure once, not on every edge).
- You want the selection visible on the canvas with a meaningful label.
- You need to route rejected items through the `rest` output.
- You need random / modulo / predicate / named-key — operators the edge doesn't expose.

### Config shape (`SelectorConfig`)

The node's `data.config` is a `SelectorConfig`. Field meaning:

| Field | Type | Required when | Meaning |
|-------|------|---------------|---------|
| `mode` | `"item" \| "range" \| "list" \| "random" \| "modulo" \| "predicate" \| "named-key"` | always | Selection strategy |
| `itemIndex` | `string` | `mode="item"` | 1-based index expression. Accepts `"3"`, `"last"`, `"last-1"`. Clamps out-of-bounds, falls back to `"1"` on malformed input. |
| `rangeFrom`, `rangeTo` | `string` | `mode="range"` | Inclusive 1-based bounds. Same syntax as `itemIndex`. |
| `rangeStep` | `number` | `mode="range"` | Stride. Negative reverses direction. `0` treated as `1`. |
| `listExpression` | `string` | `mode="list"` | Mixed indices + ranges, e.g. `"1, 3..5, last"`. Falls back to all items on malformed input. |
| `seed` | `string` | optional, `mode="random"` | Empty = new randomness per run; non-empty = deterministic via `mulberry32`. Supports `{NodeLabel}` refs. |
| `randomCount` | `number` | `mode="random"` | Default `1`. Clamps to list length. Samples without replacement. |
| `moduloDivisor` | `string` | `mode="modulo"` | Literal int or `{NodeLabel}` ref. Index = `divisor % length`. Non-numeric → index 0. |
| `predicateField` | `string` | `mode="predicate"` | JSON path into each item, e.g. `"score"` or `"meta.tags[0]"`. |
| `predicateOp` | operator enum | `mode="predicate"` | Reuses Filter List's 14-operator set (`>`, `<`, `>=`, `<=`, `=`, `!=`, `contains`, `not_contains`, `starts_with`, `ends_with`, `regex`, `exists`, `not_exists`). |
| `predicateValue` | `string` | `mode="predicate"` | Compared against the field via `predicateOp`. Supports `{NodeLabel}` refs. |
| `predicateMatch` | `"first" \| "all"` | `mode="predicate"` | `"first"` returns one match; `"all"` returns every match. |
| `predicateCaseSensitive` | `boolean` | `mode="predicate"` | Applies to string ops. |
| `namedKeyField` | `string` | `mode="named-key"` | JSON path into each item. |
| `namedKeyValue` | `string` | `mode="named-key"` | Equality target. Supports `{NodeLabel}` refs. |

### Outputs

- `picked: string[]` — selected items. Always a list (1-element list for single-item modes).
- `rest: string[]` — items NOT selected, in source order.

Partition invariants: `picked.length + rest.length === items.length`, `picked ∩ rest = ∅`. Partitions by index (not value) so duplicates land in the correct bucket.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Pure logic, runs inline.** Selector is in the `INLINE_NODES` set — no provider call, no credit cost, no async wait. It does NOT create a `jobs` row.
- **Two output channels.** Downstream consumers read `picked` or `rest` based on the edge's `sourceHandle`. Wiring mirrors the multi-handle pattern from `generate-script`.
- **Single-item modes still emit a list.** `mode="item"` returns a 1-element `picked` array, not a bare string. Downstream consumers receive the first item by default; set the edge's `each` mode to fan out across multi-item picks.
- **`{NodeLabel}` refs work only in 4 fields.** `moduloDivisor`, `predicateValue`, `namedKeyValue`, `seed`. All other fields are literal expressions (`itemIndex`, `rangeFrom`, etc. are selector-lib syntax, not template strings).
- **Lenient by design.** Bad config sets `errorMessage` and falls back — it does NOT fail the workflow. `status="failed"` only on unexpected library errors.
- **Backend orchestrator parity.** Selector runs both in the frontend executor (`execute-node.ts`) and the backend orchestrator (`inline-executor.ts::executeSelector`). Both paths call `runSelector` from `@nodaro/shared` so results are identical for the same inputs.

### Common workflow patterns

- **"Pick the best variant after fan-out."** List → Generate Image (each) → Sort List (by score desc) → Selector (mode=item, itemIndex=`"1"`). For LLM-judged picks use `Reduce(strategy="pick-best-llm")` instead.
- **"Cycle through assets in a loop."** Loop → Selector (mode=modulo, moduloDivisor=`"{LoopIteration}"`) → consumer. The same shorter list cycles per iteration.
- **"Look up a character by name."** Generate Script (emits cast list) → Selector (mode=named-key, namedKeyField=`"name"`, namedKeyValue=`"{HeroName}"`) → downstream consumer.
- **"Random A/B test in a published app."** List of variants → Selector (mode=random, seed=`""`, randomCount=`1`) → output. Omit `seed` for a fresh random pick on every run.
- **"Pick all items above a score threshold."** Image Critic → Selector (mode=predicate, field=`"score"`, op=`">="`, value=`"7"`, match=`"all"`) → fan out via edge `each` mode.
- **"Route rejected items to a fallback path."** Selector(mode=predicate) → `picked` handle goes to the happy path; `rest` handle goes to a regeneration / human-review node.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "selector-1",
  "type": "selector",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Selector",
    "config": {
      "mode": "item",
      "itemIndex": "1"
    }
  }
}
```
<!-- AUTO-GEN:END examples -->
