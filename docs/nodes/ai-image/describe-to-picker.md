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
| Model | select | `gemini-3.8-flash` | The vision model used for analysis. **Vision models with guaranteed structured output**: Claude Haiku 4.5 / Claude Haiku 5.5 / Claude Sonnet 4.6 / Claude Sonnet 5 / Claude Sonnet 5.5 / Claude Opus 4.7 / Claude Opus 4.8 / Claude Opus 5 / Claude Opus 5.5 / Claude Fable 5, Gemini 3 Flash / Gemini 3.6 Flash / Gemini 3.8 Flash / Gemini 3.1 Pro / Gemini 4 Argon, GPT-5.4 / GPT-5.5 / GPT-5.6 Luna / GPT-5.6 Terra / GPT-5.6 Sol / GPT-6 Astra / GPT-6 Luna / GPT-6 Sol / GPT-6.1 Sol, Grok 4.6 / Grok 4.7, Kimi K3, and DeepSeek V4.1 Flash. See [Why these models](#why-these-models). |
| Effort | select | `Auto` (`High` on Claude Opus 5.5) | Reasoning effort for models that support it — hidden for models with no reasoning levels. Auto sends no effort (the model's own default), the default model included. Claude Opus 5.5 is the one model with a preset: it runs at **High** unless you pick another level, and offers no Auto — an omitted effort runs at High there. Over the API, omitting `reasoningEffort` gives the same defaults. A Claude effort runs on Anthropic's own API, charged at that lane's rate — see [Credit Cost](#credit-cost). |
| Advanced mode | `boolean` | `false` | Gemini and Claude models. Runs the model on the provider's own API so **Temperature**, **Max Tokens** and the full reasoning-depth range actually apply — those controls appear once it is on. The call is charged at that lane's per-token rate; Claude Opus 5.5 at High already runs there, so turning Advanced mode on does not change its price. The node's cost badge updates immediately. Disabled with an inline reason on other models |
| Extra guidance | text | `""` | Optional instructions appended to the analyzer's system prompt (e.g. "focus on the foreground subject"). Max 2000 characters. |

## Inputs & Outputs

**Inputs:**
- `image` — source image from an upstream node (Upload Image, Generate Image, Edit Image, etc.) or a direct URL

**Outputs:**
- `picker-json` — a multi-section, catalog-valid JSON object keyed by picker type. Wire it to one or more picker nodes' `picker-json` input handles; each consumes its own section. The same output can fan out to several pickers at once.

## Why these models

The node guarantees a valid, parseable result via **forced structured output**: the emit schema is composed from the connected pickers' catalogs (the same `PickerAnalyzerSpec` the pickers themselves use), so every emitted dimension is constrained to allowed ids and choice limits. It routes through the unified LLM client, which enforces that schema natively per vendor — **Anthropic** via forced tool-use on Anthropic's own API (Claude Sonnet 5.5 and Opus 5.5 do not accept a forced tool, so they are asked to call it, with a strict tool schema; on the aggregator lane, which cannot carry a tool with an image, Claude is asked for the JSON in its instructions, and the answer is validated the same way — if it never validates, Anthropic's own API is asked once more), **Gemini** via KIE `response_format`, **GPT, Grok, Kimi and DeepSeek (responses API)** via `text.format` JSON schema — so only **vision-capable models with a native structured-output mode** are offered. GPT-5.2 is excluded (its chat-completions routing has no native structured mode → unreliable for a forced schema), and the route rejects any other model with a `validation_error`. The default is **Gemini 3.8 Flash at Auto** — a fast vision model that reads the legend-sized prompt cheaply. For the most thorough read pick **Claude Opus 5.5**, which runs at **High** reasoning effort by default: in the picker bake-off it filled the most attributes per image (e.g. skin tone). Claude Fable 5 is offered too; its analyzer prompt is a full catalog legend, so a read on it is one of the node's most expensive (see [Credit Cost](#credit-cost)). Every answer is validated against the composed schema whichever model runs it, and a non-conforming answer is retried.

If no LLM API key (KIE or Anthropic) is configured, the node returns `503 provider_unavailable`.

## Credit Cost

One vision call per run, however many pickers you wire, charged for the tokens it actually used — the analyzer's prompt (the legend of every connected picker's catalog, plus your guidance), the photo, and the answer — at the selected model's rate on the lane that served it. Every model's rate is in [LLM model rates](../../pricing/llm-models.md); the call is charged the same way as [Generate Text](../ai-text/llm-chat.md#credit-pricing), hold first, then the real charge.

The Run button shows `≈N`, an estimate of a typical read (more connected pickers means a longer legend, so a larger figure):

- An untouched node (Gemini 3.8 Flash, Effort Auto) → `describe-to-picker:gemini-3.8-flash` → **≈6 credits<!-- credits: describe-to-picker:gemini-3.8-flash -->**
- Claude Sonnet 5.5 at Effort Auto → `describe-to-picker:claude-sonnet-5.5` → **≈19 credits<!-- credits: describe-to-picker:claude-sonnet-5.5 -->**
- Claude Opus 5 at Effort Auto → `describe-to-picker:claude-opus-5` → **≈48 credits<!-- credits: describe-to-picker:claude-opus-5 -->**
- Claude Opus 5.5 (Effort High by default, or Low) → runs on Anthropic's own API → `describe-to-picker:claude-opus-5.5:direct` → **≈94 credits<!-- credits: describe-to-picker:claude-opus-5.5:direct -->**
- Claude Fable 5 at Effort Auto → `describe-to-picker:claude-fable-5` → **≈94 credits<!-- credits: describe-to-picker:claude-fable-5 -->**; with an effort it runs on Anthropic's own API → **≈235 credits<!-- credits: describe-to-picker:claude-fable-5:direct -->**
- Gemini 4 Argon at any effort → `describe-to-picker:gemini-4-argon:direct` → **≈94 credits<!-- credits: describe-to-picker:gemini-4-argon:direct -->** (it always runs on Google's own API)

`POST /v1/credits/model-costs` answers these keys (`llmPriceKey("describe-to-picker", model, effort, advancedMode)` from `@nodaro/shared/llm-models` builds one). A call runs on the provider's own API when Advanced mode is on, or when a Claude model carries any effort (Claude's reasoning effort only takes effect on Anthropic's own API). Claude Opus 5.5 carries High by default, so every Opus 5.5 read started from the editor runs there; over the API, `reasoningEffort: "none"` on Opus 5.5 clamps to no effort and runs on the aggregator.

A hold is reserved when the job starts — the read's first attempt at the model's output cap — and the run is then charged what it used. A balance below the hold is refused before anything runs (`402`, "Needs up to N credits").

- **When Claude is unavailable.** If a Claude model cannot answer for a reason on the platform's side (its service down or busy, or the platform's account with it out of credit), the same analysis runs once on **Gemini 3.8 Flash**. The run is charged what both reads used: the Claude attempt, if the provider billed it, plus the Gemini 3.8 Flash read at its own rate. If Gemini 3.8 Flash fails too, the run fails, charged only for any billed usage.
- **A content refusal.** If the model declines the photo on content grounds, the run fails with the content-policy message and is not re-asked on another model. It is charged when the provider billed the refusal, and refunded when it did not.
- **An empty read the provider billed is charged.** An analysis that finds no trait for any connected picker fails with "We couldn't read anything in this photo — try a clearer photo of one person." followed by the charge ("You were charged N credits for the model's attempt."). An empty read the provider did not bill is refunded ("You weren't charged.").
- **Other failures.** A failure the provider billed (an answer cut off at the cap, an answer that never validated) is charged for that usage, and the error says how much; one it did not bill is refunded.

## Streaming the answer (API)

`POST /v1/describe-to-picker` can deliver its answer as server-sent events, so a client can show each detected trait the moment the model has written it. Send `Accept: text/event-stream` (for example `Accept: text/event-stream, application/json`). Without it, the route answers JSON exactly as before.

Every failure decided before the stream opens (`400`, `401`, `402`, `500`, `502`, `503`) stays a plain HTTP response with the usual JSON error body. The stream itself is `200` with `Content-Type: text/event-stream`: one JSON object per `data:` line and a blank line between events. Comment lines (`: keepalive`) may appear; ignore them.

| Event | `data` | Meaning |
|-------|--------|---------|
| `field` | `{ "field": "<picker>.<dimension>", "value": "<id>" }` or `"value": ["<id>", …]` | One detected trait (e.g. `person.hair-color`), sent once the model has finished writing it. At most one per trait. **Provisional**: it is the model's raw pick, which can still fail validation (an id outside the catalog, more picks than the dimension allows) and be corrected. `done` replaces them all. |
| `done` | `{ jobId, pickerJson, gaps? }` | Exactly the JSON answer. Authoritative. |
| `error` | `{ "code": "llm_error", "message": "…" }` | The analysis failed after the stream opened. It is charged for any usage the provider billed (the message says how much) and refunded otherwise. |

The stream ends after `done` or `error`; a stream that ends with neither is a failed read.

- **Safety.** A streamed value never contains an id the minor-age safety floor could remove, for any subject. Such traits arrive only in `done`.
- **Models.** Traits stream from a Claude model when its call runs on Anthropic's own API — a Claude effort (Claude Opus 5.5 carries High by default), or Advanced mode — and the deployment has a direct Anthropic key. A Claude model with no effort runs on the aggregator first and its stream carries only `done`, as does any other model's — the default, Gemini 3.8 Flash, included — and a run that fell back to Gemini 3.8 Flash. A model refusing the photo on content grounds fails the run with the content-policy message and is never re-asked on another model; the refusal is charged like any answer when the provider billed it, and refunded when it did not. A self-hosted install without its own LLM keys answers through its cloud connection as plain JSON, even when a stream is asked for.
- **Billing is the same as without a stream.** One analysis per request, charged for what it used when `done` arrives; on `error` it is charged for any usage the provider billed and refunded otherwise. A client that disconnects does not stop or re-bill the analysis; the job still completes.

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
