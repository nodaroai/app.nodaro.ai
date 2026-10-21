# Choose Best

The **Choose Best** node (type id `reduce`) turns N candidate results into ONE. Feed it the outputs of a fanned-out node (a Generate Image driven by a List), or several separate nodes bundled through Collect, and it either lets an AI judge pick the best candidate against your criteria, or joins / counts / votes / merges them.

Without it, the pattern "generate N variants, pick the best, continue" requires custom downstream logic. Choose Best closes the loop in one node — and shows the chosen result (image thumbnail or text), its position among the candidates, and the judge's reasoning right on the node.

## Position in the canvas

```
List ──▶ Generate Image ──▶ Choose Best ──▶ DownstreamNode
        (fanned out N×)     (runs 1×)

Cover A ─┐
Cover B ─┼─▶ Collect ──▶ Choose Best ──▶ DownstreamNode
Cover C ─┘
```

## What to do with the candidates

Pick one option in the config panel ("What to do with the candidates"). The AI judge is the default for a fresh node and the only priced option; the rest are free. Strategy ids (in parentheses) are what the API / MCP / SDK use.

| Option | Use when | Credits |
|--------|----------|---------|
| **AI picks the best** (`pick-best-llm`) | You want an AI judge to compare every candidate against your criteria and pick one | per token at the judge model's rate — ~6 cr<!-- credits: reduce:pick-best-llm:claude-sonnet-5.5 --> typical on the default judge (see below) |
| **Join into one text** (`concat`) | You want every candidate in a single text, with a separator between them | 0 cr |
| **First that has content** (`first-non-empty`) | You want the first candidate that is not empty | 0 cr |
| **Count them** (`count`) | You want how many candidates arrived | 0 cr |
| **Most common answer** (`vote`) | You want the candidate that appears most often (ties → first) | 0 cr |
| **Merge JSON objects** (`merge-json`) | You want to deep- or shallow-merge JSON objects | 0 cr |

### AI picks the best

Sends the candidates to an AI judge with your criteria. The judge replies with the chosen index + a one-sentence reason, shown on the node and in the Candidates tab.

**Config:**
- **AI Model** — the judge. The same model selector every LLM node has (grouped by provider, with descriptions). Default: Claude Sonnet 5.5. Stored as `strategyConfig.llmModel`; the API / MCP / SDK take the same field (any id from the LLM model registry; an unknown id is a 400 before any credits reserve).
- **Judge by** — describe what a winner looks like. Example: "The most eye-catching cover for a dark editorial Instagram feed — one clear focal point, readable as a thumbnail."
- **The candidates are** — Texts (default) or Images. Set it on the node (the chip next to the model) or in the side panel — same field (`strategyConfig.inputKind`). **Pick Images when the candidates are pictures**: on Texts the judge is handed the image *links* as text and compares those, which reads like a real pick and is not one.

**Pricing.** The judge is one LLM call over all the candidates, charged for the tokens it actually used — your criteria, every candidate (each image counts as an image) and the verdict — at the judge model's rate on the lane that served it ([LLM model rates](../../pricing/llm-models.md)), with a hold first, as on [Generate Text](../ai-text/llm-chat.md#credit-pricing). Its price key is `reduce:pick-best-llm:<model>` (`:direct` on the provider's own API). The strategy picker shows the estimate for the model currently chosen on the node:

| Judge model | Price key | Typical judge call |
|---|---|---|
| Gemini 3.6 Flash | `reduce:pick-best-llm:gemini-3.6-flash` | ~4 cr<!-- credits: reduce:pick-best-llm:gemini-3.6-flash --> |
| Claude Sonnet 5.5 (default) | `reduce:pick-best-llm:claude-sonnet-5.5` | ~6 cr<!-- credits: reduce:pick-best-llm:claude-sonnet-5.5 --> |
| Claude Opus 5.5 | `reduce:pick-best-llm:claude-opus-5.5` | ~11 cr<!-- credits: reduce:pick-best-llm:claude-opus-5.5 --> |

More or longer candidates cost more. A judge answer the provider billed is charged even when it is cut off (the node then falls back to the first candidate).

**Worked example:**
- Upstream: List of 5 prompts → Generate Image (Z-Image) → Choose Best(pick-best-llm, criteria="brightest colors", inputKind="image-url", default judge)
- Cost: 5 image generations + the AI judge = 5 × 3<!-- credits: z-image --> + ~6<!-- credits: reduce:pick-best-llm:claude-sonnet-5.5 --> = ~21 cr<!-- credits: 5*z-image + reduce:pick-best-llm:claude-sonnet-5.5 --> estimated; the judge is then charged what its call used.

### Join into one text, First that has content, Count them, Most common answer, Merge JSON objects

These are pure functions (0 cr). All strategies first filter empty strings from the dense input array — empty strings are how upstream failures appear in `listResults`. `count` and `concat` operate on candidates that have content only, not attempts.

**Worked example (count):**
- Upstream: List of 10 → Generate Image (3 fail) → Choose Best(count) returns `7`, not `10`.

## Behavior on failures

If upstream fails on all N iterations (every candidate is empty / whitespace), the strategy decides what happens:

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
- **No nested fan-out.** A Choose Best cannot itself drive a new fan-out chain unless downstream uses a Split-Text or List node.
- **Sequential fan-out.** Upstream nodes still run sequentially per item. Parallel fan-out is a separate Phase 2 feature.

## Dedup-bypass within a workflow run

The reduce route opts out of the standard 10-second input-fingerprint dedup guard (`{ dedup: false }`). This is what protects loop-iteration / retry collisions within ONE workflow run from silently collapsing into a single job — when an upstream fan-out runs Choose Best N times in quick succession with identical bodies (same strategy, same inputs), each iteration gets its own job and its own credit reservation.

(Human-paced re-runs — clicking Run again a minute later — wouldn't hit the dedup window anyway. The opt-out only matters for fast intra-run repetition.)

## Naming history

- The node's **type id is `reduce`** and does not change: the public API is `POST /v1/reduce`, the MCP tool is `reduce`, the SDK is `client.reduce`, and saved workflows keep `type: "reduce"`.
- Its **display name is "Choose Best"** (formerly "Reduce"). "Reduce" is the functional-programming term for folding N values into one and meant nothing to most builders; "Choose Best" names the headline use, and the strategy options are worded by intent ("AI picks the best", "Join into one text", …) rather than by mechanism.
- Even earlier the node was called **Collect**. That name now belongs to a different node — the aggregator that bundles several producers' outputs into typed lanes, and the natural upstream of Choose Best. Saved workflows referencing the old `"collect"`-as-reducer type are auto-migrated on load (migration 151 + a backward-compat shim in the orchestrator).
