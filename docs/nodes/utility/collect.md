# Collect

The **Collect** node aggregates the output of an upstream fanned-out node (a Generate Image, Generate Video, etc. driven by a List/Loop) into a single value.

Without Collect, the pattern "generate N variants, pick the best, continue" requires custom downstream logic. Collect closes the loop in one node.

## Position in the canvas

```
List ──▶ Generate Image ──▶ Collect ──▶ DownstreamNode
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
- Upstream: List of 5 prompts → Generate Image → Collect(pick-best-llm, criteria="brightest colors", inputKind="image-url")
- Cost: 5 image generations + 3 cr for pick-best = e.g. 5×2 + 3 = 13 cr.

### Concatenate, First non-empty, Count, Majority vote, Merge JSON

These are pure functions (0 cr). All strategies first filter empty strings from the dense input array — empty strings are how upstream failures appear in `listResults`. `Count` and `Concat` operate on **survivors only**, not attempts.

**Worked example (count):**
- Upstream: List of 10 → Generate Image (3 fail) → Collect(count) returns `7`, not `10`.

## Behavior on failures

If upstream fails on all N iterations:
- `concat`, `count`, `first-non-empty`, `vote`: return empty/0 silently with `summary: "No valid inputs"`.
- `pick-best-llm`, `merge-json`: the Collect node itself fails with HTTP 400 `no_valid_inputs`.

## Output

Single value, type depends on strategy. Downstream nodes can consume it as text (URL for image strategies, JSON string for merge-json, stringified number for count).

## Limits (v1)

- **Single source supported.** Multi-source merging happens by concatenation (multiple incoming edges' results are appended).
- **No nested fan-out.** A Collect cannot itself drive a new fan-out chain unless downstream uses a Split-Text or List node.
- **Sequential fan-out.** Upstream nodes still run sequentially per item. Parallel fan-out is a separate Phase 2 feature.
