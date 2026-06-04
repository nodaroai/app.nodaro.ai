# Image Critic

> Score generated images on six modes (character consistency, realism, prompt adherence, anatomy, aesthetic, style match) plus an `all` aggregator, with two output handles for self-correction loops.

## Overview

The Image Critic node uses a vision-language model to evaluate an image against a chosen criterion and emit a score (0-1) plus 1-3 imperative-sentence feedback. The node has two output handles, `approved` and `rejected`, which fire mutually exclusively based on whether the score meets the configured threshold. This makes it the building block for QC gates and automated self-correction loops (e.g., wire `rejected → Modify Image.prompt` to retry until the image passes).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | select | `realism` | One of: `character-consistency`, `realism`, `prompt-adherence`, `anatomy`, `aesthetic`, `style-match`, `all` |
| Threshold | number 0-1 | `0.7` | `approved = score >= threshold`. Below the threshold, the `rejected` handle fires instead. |
| Prompt | text | `""` | Required for `prompt-adherence` and `all` modes. Can be wired via the `prompt` input edge -- the edge wins when present. |
| LLM model | select | Claude Sonnet 4.6 | Any vision-capable model. Pricing varies by tier (1 / 1 / 2 credits for economy / standard / premium). |

## Inputs & Outputs

**Inputs** (all 3 handles always render; usage depends on mode):
- `image` -- the image to evaluate. Connect from `Generate Image`, `Modify Image`, `Image to Image`, `Upload Image`, or `Edit Image`.
- `reference` -- required for `character-consistency`, `style-match`, and `all` modes. The reference image to compare against.
- `prompt` -- required for `prompt-adherence` and `all` modes. The target prompt the image was meant to render.

**Outputs:**
- `approved` -- fires when `score >= threshold`. Emits the `feedback` string.
- `rejected` -- fires when `score < threshold`. Emits the `feedback` string.

## Modes

| Mode | What it scores | Requires |
|------|---------------|----------|
| `character-consistency` | Whether two images depict the same person (face geometry, hair, defining features). | image + reference |
| `realism` | Photorealism -- calls out plastic skin, broken anatomy, impossible lighting. | image |
| `prompt-adherence` | Whether the image renders what the prompt asked for. | image + prompt |
| `anatomy` | AI-generation failure modes: hands, eyes, extra limbs, broken faces. | image |
| `aesthetic` | Composition, lighting, framing, color -- cinematography-style grade. | image |
| `style-match` | Palette/mood/treatment adherence to a style reference. | image + reference |
| `all` | Runs every applicable check given the inputs. Score = min across checks. | image (plus optional reference/prompt) |

## Supported Providers

Any vision-capable LLM configured in the editor. The default is Claude Sonnet 4.6. Pricing tiers:

| LLM tier | Credits per call |
|----------|-----------------|
| Economy (Gemini Flash, Claude Haiku) | 1 |
| Standard (Claude Sonnet 4.6, GPT-5.2) -- default | 1 |
| Premium (Claude Opus 4.6, GPT-5.4, Gemini Pro) | 2 |

The `all` mode does NOT multiply the cost -- every dimension is scored in a single VLM call.

## Self-correction loop pattern

Wire `Image Critic.rejected -> Modify Image.prompt`. The `feedback` field is deliberately shaped as imperative sentences ("Reshape the left hand...") that drop directly into a modify-image prompt. Wrap the pair in a `Loop` node for bounded retries.

## Loop / batch behavior

When `Image Critic` runs inside a `Loop` node, the handle dispatch fires only at the **post-loop boundary** when a downstream consumer resolves its inputs. Per-iteration data is accumulated in `__listResults` regardless of which handle the downstream is connected to. To selectively process per-iteration verdicts, put the conditional logic outside the loop.

## Best Practices

- For self-correction loops, set threshold near `0.7` and rely on `feedback` to drive the modify-image call.
- For batch QC, use `all` mode to score every dimension in one VLM call (no per-mode cost multiplier).
- Don't expect the `feedback` to be localized; it is LLM-emitted in English regardless of user locale.
- Wire the same `prompt` source you fed into the upstream generation node when using `prompt-adherence` -- mismatched prompts will produce misleading scores.
- Keep `reference` connected directly to the source-of-truth image (Upload Image or Create Character output) rather than re-running it through generation, to avoid drift.

## Common Use Cases

- QC gate after generate-image with auto-retry through modify-image.
- Batch consistency check across a character's generated images.
- Style-match scoring against a brand reference.
- Anatomy guard between AI generation and downstream lip-sync or motion-transfer nodes.
- Aesthetic ranking when generating multiple candidate variants and picking the best.

## Tips

- The `prompt` field can be typed directly OR wired via the `prompt` input edge. Edge wins when present.
- Changing the mode after a successful run clears the previous score (stale-result guard); changing only the threshold reuses the existing score with a client-side recompute.
- Connecting only the `approved` (or only the `rejected`) handle is valid -- the other handle simply has no downstream effect on that iteration.
- The `feedback` output is the same string on both handles; the only difference is which handle fires.
