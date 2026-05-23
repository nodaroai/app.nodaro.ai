# Reduce

The **Reduce** node aggregates the output of an upstream fanned-out node (a Generate Image, Generate Video, etc. driven by a List/Loop) into a single value.

Without Reduce, the pattern "generate N variants, pick the best, continue" requires custom downstream logic. Reduce closes the loop in one node.

## Position in the canvas

```
List ──▶ Generate Image ──▶ Reduce ──▶ DownstreamNode
        (fanned out N×)     (runs 1×)
```

## Strategies

Pick one strategy in the config panel. Each behaves differently:

| Strategy | Use when | Credits |
|----------|----------|---------|
| **Pick best (LLM judge)** | You want Claude Sonnet to rank N candidates against your criteria | 3 cr |
| **Concatenate** | You want to join all survivors with a separator | 0 cr |
| **First non-empty** | You want the first non-empty survivor | 0 cr |
| **Count** | You want the number of survivors | 0 cr |
| **Majority vote** | You want the most common survivor (ties → first) | 0 cr |
| **Merge JSON** | You want to deep- or shallow-merge JSON objects | 0 cr |

### Pick best (LLM judge)

Sends survivors to Claude Sonnet with your criteria. Sonnet replies with `chosen_index` + a one-sentence reason.

**Config:**
- **Criteria** — what to optimize for. Example: "Pick the sharpest image with no artifacts."
- **Input kind** — `text` (default) or `image-url` (Sonnet sees the images via URL).

**Worked example:**
- Upstream: List of 5 prompts → Generate Image → Reduce(pick-best-llm, criteria="brightest colors", inputKind="image-url")
- Cost: 5 image generations + 3 cr for pick-best = e.g. 5×2 + 3 = 13 cr.

### Concatenate, First non-empty, Count, Majority vote, Merge JSON

These are pure functions (0 cr). All strategies first filter empty strings from the dense input array — empty strings are how upstream failures appear in `listResults`. `Count` and `Concat` operate on **survivors only**, not attempts.

**Worked example (count):**
- Upstream: List of 10 → Generate Image (3 fail) → Reduce(count) returns `7`, not `10`.

## Behavior on failures

If upstream fails on all N iterations (every survivor is empty / whitespace), the strategy decides what happens:

| Strategy | All-empty behavior |
|----------|--------------------|
| `concat` | Returns `""` with `summary: "Joined 0 of N inputs"`. No error. |
| `count` | Returns `0` with `summary: "Counted 0 of N inputs"`. No error. |
| `first-non-empty` | Fails with HTTP 400 `no_valid_inputs`. |
| `vote` | Fails with HTTP 400 `no_valid_inputs`. |
| `merge-json` | Fails with HTTP 400 `no_valid_inputs`. |
| `pick-best-llm` | Fails with HTTP 400 `no_valid_inputs`. |

The error message is `"All upstream iterations failed; nothing to reduce."` Configure upstream nodes to default to a placeholder if you want the workflow to keep running on empty fan-in.

## Output

Single value, type depends on strategy. Downstream nodes can consume it as text (URL for image strategies, JSON string for merge-json, stringified number for count).

## Limits (v1)

- **Single source supported.** Multi-source merging happens by concatenation (multiple incoming edges' results are appended).
- **No nested fan-out.** A Reduce cannot itself drive a new fan-out chain unless downstream uses a Split-Text or List node.
- **Sequential fan-out.** Upstream nodes still run sequentially per item. Parallel fan-out is a separate Phase 2 feature.

## Dedup-bypass within a workflow run

Reduce routes opt out of the standard 10-second input-fingerprint dedup guard (`{ dedup: false }`). This is what protects loop-iteration / retry collisions within ONE workflow run from silently collapsing into a single job — when an upstream fan-out runs Reduce N times in quick succession with identical bodies (same strategy, same inputs), each iteration gets its own Reduce job and its own credit reservation.

(Human-paced re-runs — clicking Run again a minute later — wouldn't hit the dedup window anyway. The opt-out only matters for fast intra-run repetition.)

## Renamed from "Collect"

This node was previously called **Collect**. The name was changed because "Collect" semantically suggests gathering / aggregating items, but the node actually *reduces* N values into one — which fits the canonical functional-programming term. Saved workflows referencing the old `"collect"` type are auto-migrated on load (via migration 151 + a one-line backward-compat shim in the orchestrator); the public API now exposes `POST /v1/reduce`, MCP tool `reduce`, and SDK `client.reduce`.
