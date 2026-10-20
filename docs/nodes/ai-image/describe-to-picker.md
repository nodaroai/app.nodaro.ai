# Describe to Picker
> Analyze an image with a vision model and emit catalog-valid picker JSON that auto-fills the picker nodes you wire to it.

## Overview

Describe to Picker (`describe-to-picker`) looks at the primary subject and scene of an input image and produces a structured **picker JSON** object whose keys and values are guaranteed to be valid options from each parameter picker's catalog. It fills **every analyzable picker you connect to its output** in a single vision-LLM call — currently [**Person**](../parameters/person.md), **Styling**, **Framing**, **Lens**, and **Camera / Film Stock**. For each connected picker it detects the relevant traits (e.g. Person: type, age, ethnicity, build, hair, eyes, skin; Framing: shot size, angle, composition; Lens; Camera/film stock) and emits them as ids those nodes understand.

Unlike [Describe Image](./image-to-text.md), which returns free-form prose, this node returns machine-structured data: each dimension is mapped to the closest allowed catalog id (or omitted when the trait is not visible/determinable). It is a sync HTTP node — it calls the vision LLM synchronously with forced structured output rather than queuing a BullMQ job — and its output is `data` (multi-section picker JSON), not text or an image.

The result is a multi-section object like `{ "person": {…}, "styling": {…} }` that **fans out**: each connected picker node reads its own section and applies it. See [Consumer flow](#consumer-flow).

## Selection is edge-derived (wire what you want filled)

There is **no "target picker" setting**. The node analyzes exactly the analyzable picker nodes wired to its `picker-json` output — the wiring *is* the selection. Connect the Person, Styling, Framing, Lens, and/or Camera/Film Stock nodes you want filled, and the analyzer fills precisely those (and no others), so token cost scales with what you actually use. If nothing analyzable is connected, a run is rejected with a "connect a picker node" message. The config panel shows the live derived set (e.g. *"Analyzing: Person · Styling · Framing"*).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Analyzing (read-only) | derived | — | The picker nodes currently wired to this node's output — the set that will be analyzed. Not editable; change it by wiring/unwiring pickers. |
| Model | select | `gemini-3.8-flash` | The vision model used for analysis. **Vision models with guaranteed structured output**: Claude Haiku 4.5 / Claude Haiku 5.5 / Claude Sonnet 4.6 / Claude Sonnet 5 / Claude Sonnet 5.5 / Claude Opus 4.7 / Claude Opus 4.8 / Claude Opus 5 / Claude Opus 5.5, Gemini 3 Flash / Gemini 3.6 Flash / Gemini 3.8 Flash / Gemini 3.1 Pro / Gemini 4 Argon, GPT-5.4 / GPT-5.5 / GPT-5.6 Luna / GPT-5.6 Terra / GPT-5.6 Sol / GPT-6 Astra / GPT-6 Luna / GPT-6 Sol / GPT-6.1 Sol, Grok 4.6 / Grok 4.7, Kimi K3, and DeepSeek V4.1 Flash. Claude Fable 5 is not offered on this node (a saved node or API call naming it is refused with a `validation_error`; the editor resets such a node to the default). See [Why these models](#why-these-models). |
| Effort | select | `Auto` (`High` on Claude Opus 5.5) | Reasoning effort for models that support it — hidden for models with no reasoning levels. Auto sends no effort (the model's own default), the default model included. Claude Opus 5.5 is the one model with a preset: it runs at **High** unless you pick another level, and offers no Auto — an omitted effort runs at High there. Over the API, omitting `reasoningEffort` gives the same defaults. A Claude effort runs on Anthropic's own API, which changes the price — see [Credit Cost](#credit-cost). |
| Advanced mode | `boolean` | `false` | Gemini and Claude models. Runs the model on the provider's own API so **Temperature**, **Max Tokens** and the full reasoning-depth range actually apply — those controls appear once it is on. Bills one credit rung up (a premium model moves to premium-direct) unless the call already runs on the provider's API: Claude Opus 5.5 at High already does and bills premium-direct, so turning Advanced mode on there does not change the price. The node's cost badge updates immediately. Disabled with an inline reason on other models |
| Extra guidance | text | `""` | Optional instructions appended to the analyzer's system prompt (e.g. "focus on the foreground subject"). Max 2000 characters. |

## Inputs & Outputs

**Inputs:**
- `image` — source image from an upstream node (Upload Image, Generate Image, Edit Image, etc.) or a direct URL

**Outputs:**
- `picker-json` — a multi-section, catalog-valid JSON object keyed by picker type. Wire it to one or more picker nodes' `picker-json` input handles; each consumes its own section. The same output can fan out to several pickers at once.

## Why these models

The node guarantees a valid, parseable result via **forced structured output**: the emit schema is composed from the connected pickers' catalogs (the same `PickerAnalyzerSpec` the pickers themselves use), so every emitted dimension is constrained to allowed ids and choice limits. It routes through the unified LLM client, which enforces that schema natively per vendor — **Anthropic** via forced tool-use on Anthropic's own API (Claude Sonnet 5.5 and Opus 5.5 do not accept a forced tool, so they are asked to call it, with a strict tool schema; on the aggregator lane, which cannot carry a tool with an image, Claude is asked for the JSON in its instructions, and the answer is validated the same way — if it never validates, Anthropic's own API is asked once more), **Gemini** via KIE `response_format`, **GPT, Grok, Kimi and DeepSeek (responses API)** via `text.format` JSON schema — so only **vision-capable models with a native structured-output mode** are offered. GPT-5.2 is excluded (its chat-completions routing has no native structured mode → unreliable for a forced schema), Claude Fable 5 is withheld from this node (its analyzer prompt — a full catalog legend — makes a read on it cost far more than any of the node's prices covers), and the route rejects any other model with a `validation_error`. The default is **Gemini 3.8 Flash at Auto** — a fast vision model that reads the legend-sized prompt at the node's lowest price. For the most thorough read pick **Claude Opus 5.5**, which runs at **High** reasoning effort by default: in the picker bake-off it filled the most attributes per image (e.g. skin tone), at the node's top price. Every answer is validated against the composed schema whichever model runs it, and a non-conforming answer is retried.

If no LLM API key (KIE or Anthropic) is configured, the node returns `503 provider_unavailable`.

## Credit Cost

One vision call per run, however many pickers you wire. The rung follows the selected model's tier and the lane the call runs on:

| Rung | When | Credits |
|------|------|---------|
| `describe-to-picker:economy` | an economy model (Gemini 3.8 Flash — the default — and the other Flash, Haiku, Luna and DeepSeek models) | **11**<!-- credits: describe-to-picker:economy --> |
| `describe-to-picker` | a standard model (Claude Sonnet, GPT-5.6 Terra, Grok) | **20**<!-- credits: describe-to-picker --> |
| `describe-to-picker:premium` | a premium model (Claude Opus, Gemini 3.1 Pro, GPT-5.4/5.5/Sol/Astra, Kimi K3) on the aggregator, or a standard one at `xhigh`/`max` | **40**<!-- credits: describe-to-picker:premium --> |
| `describe-to-picker:premium-direct` | a premium call that runs on the provider's own API — Advanced mode, Claude Opus 5.5 at its default High (or any Claude effort on a premium Claude model), Gemini 4 Argon | **150**<!-- credits: describe-to-picker:premium-direct --> |

The credit identifier is built from the selected model, effort and Advanced mode at request time, the same way as for [Generate Text](../ai-text/llm-chat.md#credit-pricing): a call runs on the provider's own API — and bills one rung up — when Advanced mode is on, or when a Claude model carries any effort (Claude's reasoning effort only takes effect on Anthropic's own API); `xhigh` and `max` add one tier of their own. The default, Gemini 3.8 Flash at Auto, runs on the aggregator, so an untouched node bills economy. Claude Opus 5.5 carries High by default, which runs on Anthropic's own API, so choosing it bills premium-direct; the editor offers no Auto on that model, so every Opus 5.5 read started from the editor is a premium-direct read. Over the API, `reasoningEffort: "none"` on Opus 5.5 clamps to no effort and runs on the aggregator at `describe-to-picker:premium` (40 credits<!-- credits: describe-to-picker:premium -->).

Worked examples:
- An untouched node (Gemini 3.8 Flash, Effort Auto) → `describe-to-picker:economy` → **11 credits<!-- credits: describe-to-picker:economy -->**
- Claude Sonnet 5.5 at Effort Auto → `describe-to-picker` → **20 credits<!-- credits: describe-to-picker -->**
- Claude Opus 5 at Effort Auto → `describe-to-picker:premium` → **40 credits<!-- credits: describe-to-picker:premium -->**
- Claude Opus 5.5 (Effort High by default, or Low) → `describe-to-picker:premium-direct` → **150 credits<!-- credits: describe-to-picker:premium-direct -->**
- Gemini 4 Argon at any effort → `describe-to-picker:premium-direct` → **150 credits<!-- credits: describe-to-picker:premium-direct -->** (it always runs on Google's own API)

Credits are reserved when the job starts, committed on success, and fully refunded if the analysis fails — except a content refusal the provider billed (see below).

- **When Claude is unavailable.** If a Claude model cannot answer for a reason on the platform's side (its service down or busy, or the platform's account with it out of credit), the same analysis runs once on **Gemini 3.8 Flash**, and you are charged Gemini 3.8 Flash's price (**11 credits<!-- credits: describe-to-picker:economy -->**), not the reserved Claude price. If Gemini 3.8 Flash fails too, the run fails and is refunded.
- **A content refusal.** If the model declines the photo on content grounds, the run fails with the content-policy message and is not re-asked on another model. It is charged when the provider billed the refusal, and refunded when it did not.
- **An empty read is not charged.** An analysis that finds no trait for any connected picker fails with "We couldn't read anything in this photo — try a clearer photo of one person. You weren't charged." and the credits are refunded.

## Streaming the answer (API)

`POST /v1/describe-to-picker` can deliver its answer as server-sent events, so a client can show each detected trait the moment the model has written it. Send `Accept: text/event-stream` (for example `Accept: text/event-stream, application/json`). Without it, the route answers JSON exactly as before.

Every failure decided before the stream opens (`400`, `401`, `402`, `500`, `502`, `503`) stays a plain HTTP response with the usual JSON error body. The stream itself is `200` with `Content-Type: text/event-stream`: one JSON object per `data:` line and a blank line between events. Comment lines (`: keepalive`) may appear; ignore them.

| Event | `data` | Meaning |
|-------|--------|---------|
| `field` | `{ "field": "<picker>.<dimension>", "value": "<id>" }` or `"value": ["<id>", …]` | One detected trait (e.g. `person.hair-color`), sent once the model has finished writing it. At most one per trait. **Provisional**: it is the model's raw pick, which can still fail validation (an id outside the catalog, more picks than the dimension allows) and be corrected. `done` replaces them all. |
| `done` | `{ jobId, pickerJson, gaps? }` | Exactly the JSON answer. Authoritative. |
| `error` | `{ "code": "llm_error", "message": "…" }` | The analysis failed after the stream opened. The credits are refunded (a billed content refusal is charged). |

The stream ends after `done` or `error`; a stream that ends with neither is a failed read.

- **Safety.** A streamed value never contains an id the minor-age safety floor could remove, for any subject. Such traits arrive only in `done`.
- **Models.** Traits stream from a Claude model when its call runs on Anthropic's own API — a Claude effort (Claude Opus 5.5 carries High by default), or Advanced mode — and the deployment has a direct Anthropic key. A Claude model with no effort runs on the aggregator first and its stream carries only `done`, as does any other model's — the default, Gemini 3.8 Flash, included — and a run that fell back to Gemini 3.8 Flash. A model refusing the photo on content grounds fails the run with the content-policy message and is never re-asked on another model; the refusal is charged like any answer when the provider billed it, and refunded when it did not. A self-hosted install without its own LLM keys answers through its cloud connection as plain JSON, even when a stream is asked for.
- **Billing is unchanged.** One analysis per request: committed on `done`, refunded on `error` (a billed content refusal is charged). A client that disconnects does not stop or re-bill the analysis; the job still completes.

## Consumer flow

The picker JSON only takes effect once you connect this node's `picker-json` output to a picker node's `picker-json` input. Each consuming node ([Person](../parameters/person.md), Styling, Framing, Lens, Camera/Film Stock) reads **its own section** of the multi-section object and decides how (and when) to merge the detected values into its current selection.

**Apply mode** — "When image JSON is injected" (per picker):

| Mode | Label | Behavior |
|------|-------|----------|
| `override` *(default)* | **Full override (clear undetected)** | Detected dimensions are written; **any dimension the model did not detect is cleared.** Use when the image should fully define this picker. |
| `overwrite-detected` | **Overwrite detected (keep rest)** | Only writes the dimensions that were detected; every other field you set manually is left untouched. |
| `fill-empty` | **Fill empty only** | Writes a detected dimension only when that field is currently empty — never overwrites a value you already chose. |

In every mode the merge touches **only that picker's dimension fields** — it never changes the node's label, custom before/after text, or layout settings.

**Auto-apply toggle** — "Auto-apply on change" (per picker, in its settings panel):
- **On** *(default)*: every completed Describe to Picker run is applied automatically using the selected apply mode — to every connected picker, even one whose section came back the same as last time. A value you change by hand on the picker is kept until the next run. While a hand edit leaves the picker out of step with the injected JSON, the picker shows **"⚡ Update from injected"** so you can sync it back.
- **Off:** nothing is applied automatically. The picker node shows a **"⚡ Update from injected"** button instead, enabled whenever there is something to apply — after a new analysis run, or after you changed a value by hand — and reading "Up to date" otherwise.

Opening a workflow never changes a picker. A picker that has never applied an analysis (for example one saved while auto-apply was off by default) treats the analysis already present when the workflow opens as its starting point: its values stay as saved, the update button offers the difference, and auto-apply takes over from the next run.

Whether the picker counts as out of date follows the apply mode: under **Fill empty only**, a value you filled in by hand is never flagged, because applying would not touch it.

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
