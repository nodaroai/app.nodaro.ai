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
| **AI picks the best** (`pick-best-llm`) | You want an AI judge to compare every candidate against your criteria and pick one | by judge model tier — 3 / 10 / 25 cr (see below) |
| **Join into one text** (`concat`) | You want every candidate in a single text, with a separator between them | 0 cr |
| **First that has content** (`first-non-empty`) | You want the first candidate that is not empty | 0 cr |
| **Count them** (`count`) | You want how many candidates arrived | 0 cr |
| **Most common answer** (`vote`) | You want the candidate that appears most often (ties → first) | 0 cr |
| **Merge JSON objects** (`merge-json`) | You want to deep- or shallow-merge JSON objects | 0 cr |

### AI picks the best

Sends the candidates to an AI judge with your criteria. The judge replies with the chosen index + a one-sentence reason, shown on the node and in the Candidates tab.

**Config:**
- **AI Model** — the judge. The same model selector every LLM node has (Economy / Standard / Premium tiers, with descriptions). Default: the Standard-tier default for this feature. Stored as `strategyConfig.llmModel`; the API / MCP / SDK take the same field (any id from the LLM model registry; an unknown id is a 400 before any credits reserve).
- **Judge by** — describe what a winner looks like. Example: "The most eye-catching cover for a dark editorial Instagram feed — one clear focal point, readable as a thumbnail."
- **The candidates are** — Texts (default) or Images. Set it on the node (the chip next to the model) or in the side panel — same field (`strategyConfig.inputKind`). **Pick Images when the candidates are pictures**: on Texts the judge is handed the image *links* as text and compares those, which reads like a real pick and is not one.

**Pricing** follows the chosen judge model's tier, exactly like every other LLM node (`buildLlmCreditIdentifier` over the feature id `reduce:pick-best-llm`):

| Judge model tier | Credit identifier | Credits |
|---|---|---|
| Economy (e.g. Gemini Flash, Haiku) | `reduce:pick-best-llm:economy` | 3 cr |
| Standard (default) | `reduce:pick-best-llm` | 10 cr |
| Premium (e.g. Opus) | `reduce:pick-best-llm:premium` | 25 cr |

The strategy picker shows the price for the model currently chosen on the node.

**Worked example:**
- Upstream: List of 5 prompts → Generate Image → Choose Best(pick-best-llm, criteria="brightest colors", inputKind="image-url", default Standard judge)
- Cost: 5 image generations + 10 cr for the AI judge = e.g. 5×2 + 10 = 20 cr. With a Premium judge: 5×2 + 25 = 35 cr; with an Economy judge: 5×2 + 3 = 13 cr.

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
