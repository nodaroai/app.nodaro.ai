# Describe to Picker
> Analyze an image with an Anthropic vision model and emit catalog-valid picker JSON that auto-fills a downstream Person picker.

## Overview

Describe to Picker (`describe-to-picker`) looks at the primary subject of an input image and produces a structured **picker JSON** object whose keys and values are guaranteed to be valid options from a parameter picker's catalog. In v1 the only target is the [**Person**](../parameters/person.md) picker — the node detects traits like type, age, ethnicity, build, hair, eyes, skin, facial features, and more, then emits them as ids the Person node understands.

Unlike [Describe Image](./image-to-text.md), which returns free-form prose, this node returns machine-structured data: each dimension is mapped to the closest allowed catalog id (or omitted when the trait is not visible/determinable). It is a sync HTTP node — it calls the Anthropic API directly via forced tool-use rather than queuing a BullMQ job — and its output is `data` (picker JSON), not text or an image.

The result is meant to be wired into a Person picker's `picker-json` input, where it can auto-fill (or selectively update) the picker's attributes. See [Consumer flow on the Person node](#consumer-flow-on-the-person-node).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Target picker | select | `"person"` | Which picker catalog the JSON targets. **v1: Person only.** |
| Model (Anthropic vision) | select | `claude-sonnet-4.6` | The vision model used for analysis. **Anthropic models only** (Claude Haiku 4.5 / Claude Sonnet 4.6 / Claude Opus 4.7). See [Why Anthropic-only](#why-anthropic-only). |
| Extra guidance | text | `""` | Optional instructions appended to the analyzer's system prompt (e.g. "focus on the foreground subject"). Max 2000 characters. |

After a run, the config panel shows how many traits were detected and reminds you to connect the output to a Person picker.

## Inputs & Outputs

**Inputs:**
- `image` — source image from an upstream node (Upload Image, Generate Image, Edit Image, etc.) or a direct URL

**Outputs:**
- `picker-json` — a catalog-valid JSON object of detected picker attributes (the active result). Wire this into a Person picker's `picker-json` input handle.

## Why Anthropic-only

The node uses **forced tool-use** to guarantee a valid, parseable result: the model is required to call a single emit tool whose schema is derived from the Person catalog (built from the same `PickerAnalyzerSpec` the picker itself uses), so every emitted dimension is constrained to allowed ids and choice limits. This structured-output path runs through the direct Anthropic SDK (a model's `directFallbackModel`), which is why only Anthropic-vendor models are offered and why the route rejects any non-Anthropic model with a `validation_error`. The default is **Claude Sonnet 4.6** — a strong balance of vision quality and cost for trait extraction.

If the Anthropic API key is not configured, the node returns `503 provider_unavailable`.

## Credit Cost

**Flat 1 credit per run**, regardless of which Anthropic model you pick. The tiered identifiers `describe-to-picker`, `describe-to-picker:economy`, and `describe-to-picker:premium` all resolve to 1 credit. Credits are reserved when the job starts, committed on success, and fully refunded if the analysis fails.

## Consumer flow on the Person node

The picker JSON only takes effect once you connect this node's `picker-json` output to a [**Person**](../parameters/person.md) node's `picker-json` input. The Person node then decides how (and when) to merge the detected traits into its current selection.

**Apply mode** — "When image JSON is injected" (Person config):

| Mode | Label | Behavior |
|------|-------|----------|
| `override` *(default)* | **Full override (clear undetected)** | Detected dimensions are written; **any dimension the model did not detect is cleared.** Also resets the custom-age field. Use when the image should fully define the person. |
| `overwrite-detected` | **Overwrite detected (keep rest)** | Only writes the dimensions that were detected; every other field you set manually is left untouched. |
| `fill-empty` | **Fill empty only** | Writes a detected dimension only when that field is currently empty — never overwrites a value you already chose. |

In every mode the merge touches **only dimension fields** — it never changes the node's label, custom before/after text, or layout settings.

**Auto-apply toggle** — "Auto-apply on change":
- **On:** whenever a new (different) picker JSON arrives upstream, it is applied automatically using the selected apply mode.
- **Off** *(default):* nothing is applied automatically. Instead, a manual button appears on the Person node.

**"Update from injected" button** (shown on the Person node only when auto-apply is off and an upstream `picker-json` is connected):
- Reads **"⚡ Update from injected"** and is enabled when there is a pending change — i.e. the injected JSON differs from what was last applied.
- Reads **"Up to date"** and is disabled when the injected JSON matches the last-applied snapshot.
- Change detection is **order-independent**: two JSON objects with the same keys/values are treated as identical regardless of property order (via a canonical key), so re-running the analyzer with the same result won't show a spurious pending change. The last-applied snapshot is stored on the Person node as `lastAppliedPickerJson`.

## Best Practices

- Pair Describe to Picker with a Generate Image / Upload Image upstream and a Person picker downstream to turn a reference photo into a reusable casting brief.
- Use **Fill empty only** when you've hand-picked a few defining traits and want the image to fill in the rest without disturbing your choices.
- Use **Overwrite detected** when you want the image to refresh detectable traits but keep manual extras (e.g. a wardrobe note) intact.
- Use **Full override** for a clean, image-driven re-cast.
- Add **Extra guidance** when an image has multiple people or a busy background (e.g. "describe the woman in the red coat").

## Common Use Cases

- Reverse-engineer a Person picker from a reference portrait, then feed that picker into Generate Image / Generate Video for consistent character generation.
- Seed a recurring-character definition from a single photo.
- Batch-cast: run an image through the analyzer, auto-apply to a Person node, and fan out variations.

## Tips

- The node outputs structured `data`, not text — connect it to a Person picker's `picker-json` handle, not to text-consuming nodes.
- The emitted JSON is constrained to the Person catalog, so it can't produce ids the picker doesn't recognize. Dimensions that aren't visible in the image are simply omitted (and, in Full-override mode, cleared on the picker).
- Results include a history (`generatedResults`) with job IDs and timestamps, navigable from the config panel; the active result is the one fed downstream.
