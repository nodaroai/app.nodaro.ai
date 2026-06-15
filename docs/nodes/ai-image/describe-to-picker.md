# Describe to Picker
> Analyze an image with an Anthropic vision model and emit catalog-valid picker JSON that auto-fills the picker nodes you wire to it.

## Overview

Describe to Picker (`describe-to-picker`) looks at the primary subject and scene of an input image and produces a structured **picker JSON** object whose keys and values are guaranteed to be valid options from each parameter picker's catalog. It fills **every analyzable picker you connect to its output** in a single vision-LLM call — currently [**Person**](../parameters/person.md), **Styling**, **Framing**, **Lens**, and **Camera / Film Stock**. For each connected picker it detects the relevant traits (e.g. Person: type, age, ethnicity, build, hair, eyes, skin; Framing: shot size, angle, composition; Lens; Camera/film stock) and emits them as ids those nodes understand.

Unlike [Describe Image](./image-to-text.md), which returns free-form prose, this node returns machine-structured data: each dimension is mapped to the closest allowed catalog id (or omitted when the trait is not visible/determinable). It is a sync HTTP node — it calls the Anthropic API directly via forced tool-use rather than queuing a BullMQ job — and its output is `data` (multi-section picker JSON), not text or an image.

The result is a multi-section object like `{ "person": {…}, "styling": {…} }` that **fans out**: each connected picker node reads its own section and applies it. See [Consumer flow](#consumer-flow).

## Selection is edge-derived (wire what you want filled)

There is **no "target picker" setting**. The node analyzes exactly the analyzable picker nodes wired to its `picker-json` output — the wiring *is* the selection. Connect the Person, Styling, Framing, Lens, and/or Camera/Film Stock nodes you want filled, and the analyzer fills precisely those (and no others), so token cost scales with what you actually use. If nothing analyzable is connected, a run is rejected with a "connect a picker node" message. The config panel shows the live derived set (e.g. *"Analyzing: Person · Styling · Framing"*).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Analyzing (read-only) | derived | — | The picker nodes currently wired to this node's output — the set that will be analyzed. Not editable; change it by wiring/unwiring pickers. |
| Model (Anthropic vision) | select | `claude-sonnet-4.6` | The vision model used for analysis. **Anthropic models only** (Claude Haiku 4.5 / Claude Sonnet 4.6 / Claude Opus 4.7). See [Why Anthropic-only](#why-anthropic-only). |
| Extra guidance | text | `""` | Optional instructions appended to the analyzer's system prompt (e.g. "focus on the foreground subject"). Max 2000 characters. |

## Inputs & Outputs

**Inputs:**
- `image` — source image from an upstream node (Upload Image, Generate Image, Edit Image, etc.) or a direct URL

**Outputs:**
- `picker-json` — a multi-section, catalog-valid JSON object keyed by picker type. Wire it to one or more picker nodes' `picker-json` input handles; each consumes its own section. The same output can fan out to several pickers at once.

## Why Anthropic-only

The node uses **forced tool-use** to guarantee a valid, parseable result: the model is required to call a single emit tool whose schema is composed from the connected pickers' catalogs (built from the same `PickerAnalyzerSpec` the pickers themselves use), so every emitted dimension is constrained to allowed ids and choice limits. This structured-output path runs through the direct Anthropic SDK (a model's `directFallbackModel`), which is why only Anthropic-vendor models are offered and why the route rejects any non-Anthropic model with a `validation_error`. The default is **Claude Sonnet 4.6** — a strong balance of vision quality and cost for trait extraction.

If the Anthropic API key is not configured, the node returns `503 provider_unavailable`.

## Credit Cost

**Flat 1 credit per run**, regardless of how many pickers you wire or which Anthropic model you pick — it is always one vision call. The tiered identifiers `describe-to-picker`, `describe-to-picker:economy`, and `describe-to-picker:premium` all resolve to 1 credit. Credits are reserved when the job starts, committed on success, and fully refunded if the analysis fails.

## Consumer flow

The picker JSON only takes effect once you connect this node's `picker-json` output to a picker node's `picker-json` input. Each consuming node ([Person](../parameters/person.md), Styling, Framing, Lens, Camera/Film Stock) reads **its own section** of the multi-section object and decides how (and when) to merge the detected values into its current selection.

**Apply mode** — "When image JSON is injected" (per picker):

| Mode | Label | Behavior |
|------|-------|----------|
| `override` *(default)* | **Full override (clear undetected)** | Detected dimensions are written; **any dimension the model did not detect is cleared.** Use when the image should fully define this picker. |
| `overwrite-detected` | **Overwrite detected (keep rest)** | Only writes the dimensions that were detected; every other field you set manually is left untouched. |
| `fill-empty` | **Fill empty only** | Writes a detected dimension only when that field is currently empty — never overwrites a value you already chose. |

In every mode the merge touches **only that picker's dimension fields** — it never changes the node's label, custom before/after text, or layout settings.

**Auto-apply toggle** — "Auto-apply on change":
- **On:** whenever a new (different) picker JSON arrives upstream, it is applied automatically using the selected apply mode.
- **Off** *(default):* nothing is applied automatically. Instead, a manual **"⚡ Update from injected"** button appears on the picker node (enabled when the injected section differs from what was last applied; "Up to date" otherwise). Change detection is order-independent, so re-running the analyzer with the same result won't show a spurious pending change.

## Catalog-gap feedback

When the closest available catalog id clearly misrepresents what the model sees (a missing item), or a salient visible attribute isn't covered by any dimension of the wired pickers (a missing category), the analyzer records that as a **catalog gap** — without ever changing the catalog-valid result it returns. Gaps accumulate (with an occurrence count) for operators to review in the admin **Picker Gaps** dashboard (cloud/business editions) and decide which catalog additions would make future results more accurate. This is a background signal; it has no effect on your workflow output.

## Best Practices

- Wire Describe to Picker to **multiple** pickers at once (e.g. Person + Styling + Framing) to turn one reference photo into a full casting + look + shot brief in a single call.
- Use **Fill empty only** when you've hand-picked a few defining traits and want the image to fill in the rest without disturbing your choices.
- Use **Overwrite detected** when you want the image to refresh detectable traits but keep manual extras intact.
- Use **Full override** for a clean, image-driven re-cast of a picker.
- Add **Extra guidance** when an image has multiple subjects or a busy background (e.g. "describe the woman in the red coat").

## Common Use Cases

- Reverse-engineer Person + Styling + Framing pickers from a reference portrait, then feed them into Generate Image / Generate Video for consistent, well-framed character generation.
- Seed a recurring-character definition (and its styling/lens look) from a single photo.
- Batch-cast: run an image through the analyzer, auto-apply across several pickers, and fan out variations.

## Tips

- The node outputs structured `data`, not text — connect it to picker nodes' `picker-json` handles, not to text-consuming nodes.
- The emitted JSON is constrained to each picker's catalog, so it can't produce ids a picker doesn't recognize. Dimensions that aren't visible are simply omitted (and, in Full-override mode, cleared on that picker).
- Only the pickers you wire are analyzed — connect more to detect more, fewer to spend fewer tokens.
