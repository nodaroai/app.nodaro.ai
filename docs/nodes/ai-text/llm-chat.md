# Prompt
> LLM text generation from a prompt, with optional image/video/audio reference inputs, real-time streaming, and a built-in fan-out item list.

## Overview

The Prompt node (`llm-chat`, labeled "Prompt" on the canvas; called "Generate Text" until September 2026) generates text from a prompt using a selectable LLM, with optional system instructions. It supports real-time token streaming and can reference upstream node outputs in its prompt via field mappings, making it a flexible text-generation and transformation step in any workflow.

It can also accept **reference inputs** on the multi-modal **References** handle (its own fuchsia pip) — an image, video, audio clip, **or text** — for multimodal prompting (e.g. "describe this image", "summarize this clip"). Image/video/audio references are routed to the model as reference media (video and audio require a Gemini model — see [Multimodal inputs](#multimodal-inputs)); a **text** reference is merged into the prompt as added context.

This node is the result of merging the former **AI Agent** (image-prompt fan-out) and **LLM Chat** nodes into one. Existing AI Agent / LLM Chat nodes are auto-migrated to Prompt on workflow load. The legacy `/v1/ai-writer/*` routes remain available for back-compat; the node itself now runs on `/v1/llm-chat/*`.

## Two outputs

Prompt exposes **two** outputs:

| Output | Contents | Use it to |
|--------|----------|-----------|
| `text` | The full generated output as a single string, with any `===NEXT===` delimiters left **intact** | Feed a single block of text into Combine Text, a Preview node, a Save to Storage node, or a downstream Generate Text pass |
| `items` | The output split on `===NEXT===` into a fan-out list (each segment becomes one item, trimmed) | Feed into a Loop, a Generate Image node, or any list-aware consumer to fan out N× — one downstream run per item |

When the prompt (or a template) produces a single block with no `===NEXT===` markers, `items` is a one-element list containing the whole output.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Preset | `string` | `"custom"` | Built-in preset or one of your saved presets (see [Presets](#presets)). Sets the instructions and output format |
| Instructions (System Prompt) | `string` | `""` | Optional system instructions that guide the model's behavior and output format. Labeled **Instructions (System Prompt)** in the config panel and **Instructions** on the node handle |
| User Input | `string` | `""` | The main prompt. Can include references to upstream nodes via field mappings |
| Model | `string` | `gemini-3.6-flash` | LLM model picked via the model selector — drives both capability and credit cost (see [Credit pricing](#credit-pricing)) |
| Temperature | `number` | `0.7` | Creativity control (0 = deterministic, 1 = more creative). Ignored by models that reject the parameter (Claude Opus 4.7, GPT-5.5, the GPT-5.6 and GPT-6 families, Grok 4.6 and 4.7, Claude Sonnet 5 and 5.5, Claude Opus 4.8, 5 and 5.5, Claude Fable 5, Kimi K3, and DeepSeek V4.1 Flash) |
| Max Tokens | `number` | `8192` | Maximum output length in tokens. A model's reasoning counts toward it, so the cap has a floor: at `xhigh`/`max` effort — and at **every** effort, including `Auto`, for the models that reason by default — it is raised to 32768 (Claude Opus 5, Claude Sonnet 5.5, Claude Opus 5.5, Grok 4.6 and 4.7, the GPT-6 family, Kimi K3, DeepSeek V4.1 Flash), 16384 (Gemini 3.8 Flash, Gemini 3.1 Pro) or 8192 (Gemini 3 Flash, Gemini 3.6 Flash, Gemini 3.7 Flash). If the model still reaches the cap before it finishes, the run **fails** with a *cut off* error and its credits are refunded — a partial answer is never saved or passed to the next node. DeepSeek V4.1 Flash does not accept an output cap at all, so Max Tokens does not limit its answer |
| # of runs | `number` | `1` | How many generations to produce per Run click (1–4 in the node's quick toolbar). Each run is charged separately — the Run button shows the multiplied credit cost |
| Effort | `string` | `Auto` | Reasoning effort for models that support it — hidden entirely for models with no reasoning levels. See [Reasoning effort](#reasoning-effort) |
| Advanced mode | `boolean` | `false` | Gemini and Claude models. Runs the model on the provider's own API so **Temperature**, **Max Tokens** (above the model's reasoning floor — see Max Tokens) and the full reasoning-depth range actually apply — those controls appear once it is on. Bills one credit rung up (a premium model moves to premium-direct); the node's cost badge updates immediately. Disabled with an inline reason on other models |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the **User Input** (never the Instructions / system prompt) at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

### Model selector

The model is chosen from the shared LLM model selector — a searchable picker grouped by provider (Anthropic / DeepSeek / Google / Moonshot AI / OpenAI / xAI), with each group ordered economy → premium. The selected model determines the credit cost by tier. Every model accepts an image reference; the table below shows which **Gemini** models additionally accept video and audio references.

| Model | Tier | Multimodal (references) |
|-------|------|--------------------------|
| Gemini 3 Flash | Economy | image + video + audio |
| Gemini 3.6 Flash | Economy | image + video + audio |
| Gemini 3.7 Flash | Economy | image only |
| Gemini 3.8 Flash | Economy | image only |
| Claude Haiku 4.5 | Economy | image only |
| GPT-5.6 Luna | Economy | image only |
| GPT-6 Luna | Economy | image only |
| DeepSeek V4.1 Flash | Economy | image only |
| Claude Sonnet 4.6 | Standard | image only |
| GPT-5.2 | Standard | image only |
| GPT-5.6 Terra | Standard | image only |
| Grok 4.6 | Standard | image only |
| Grok 4.7 | Standard | image only |
| Claude Sonnet 5 | Standard | image only |
| Claude Sonnet 5.5 | Standard | image only |
| Gemini 3.1 Pro | Premium | image + video + audio |
| Claude Opus 4.7 | Premium | image only |
| GPT-5.4 | Premium | image only |
| GPT-5.5 | Premium | image only |
| GPT-5.6 Sol | Premium | image only |
| GPT-6 Astra | Premium | image only |
| GPT-6 Sol | Premium | image only |
| GPT-6.1 Sol | Premium | image only |
| Claude Opus 4.8 | Premium | image only |
| Claude Opus 5 | Premium | image only |
| Claude Opus 5.5 | Premium | image only |
| Claude Fable 5 | Premium | image only |
| Kimi K3 | Premium | image only |

The default model is Gemini 3.6 Flash (economy tier). Most models expose reasoning levels and show an **Effort** selector next to the model picker (the exceptions: Gemini 3 Flash, Claude Haiku 4.5, GPT-5.2, and Gemini 3.1 Pro have no effort lever — though the two Gemini models gain one under **Advanced mode**, which reaches the provider's fuller range) — see [Reasoning effort](#reasoning-effort).

Gemini 3.7 Flash and Gemini 3.8 Flash currently accept **image references only** — video/audio references for them are not yet enabled (use Gemini 3.6 Flash or Gemini 3.1 Pro for those).

## Canvas controls

Hovering the node on the canvas reveals a quick toolbar beneath it, mirroring the Generate Image node:

- **AI Model** — pick the LLM (same options as the config panel's model selector).
- **Effort** — reasoning effort for models that support it; hidden when the selected model has no reasoning levels. See [Reasoning effort](#reasoning-effort).
- **Preset** — choose a built-in preset or one of your saved presets.
- **# of runs** — generate 1–4 results per click; the Run button's credit cost updates to reflect the multiplier.
- **Run** — execute the node.

The result card has a top action strip: a **view toggle**, **Copy**, **Download**, and **Log** on the left; a **Show outputs** toggle and a **delete** (✕) on the right. The **view toggle** switches the output between raw text and a rendered view — a **colored JSON object view** when the output parses as JSON (the icon becomes `{ }`), otherwise **rendered Markdown** (eye icon). Pressing **Show outputs** (shown only when there is more than one result) reveals a **results browser** that floats above the node: numbered tiles with prev/next paging, arrow-key navigation when the node is selected, an active-result ring, and a hover delete affordance. The card shows the currently selected result and, just under the action strip, the **model** and **preset** that produced it. The **Log** button opens the full execution log grouped by run (each run is labeled with its model and preset). The output text scrolls inside the card with the same scrollbar as the Text Prompt node.

Drag the **magnifier handle** at the bottom-left corner to zoom the node up to 2× for easier reading; the bottom-right corner resizes it (hold Alt to swap corners).

## Inputs & Outputs

- **Inputs**:
  - `prompt` — text/picker producers, injected into the User Input.
  - `references` — multi-modal (own fuchsia pip): image, video, audio, **or text**. Media becomes a reference attachment; text is merged into the prompt as added context.
  - `system-prompt` — text producers, used as the system instructions.
- **Outputs**:
  - `text` — the full generated string (delimiters intact)
  - `items` — the `===NEXT===`-split fan-out list

### Multimodal inputs

- **Image reference** — supported by every model. Useful for "describe this image", "write a caption", or generating prompts from a connected image.
- **Video / audio reference** — supported **only by the video-capable Gemini models** (Gemini 3 Flash, Gemini 3.6 Flash, or Gemini 3.1 Pro — Gemini 3.7 Flash and Gemini 3.8 Flash are image-only for now). If a video or audio reference is connected, select one of those models or the reference is ignored.

## Presets

Presets set the instructions (system prompt) and output format. There are two kinds:

**Built-in presets:**

| Preset | Purpose | Requires reference image |
|----------|---------|--------------------------|
| Custom | Free-form — use your own Instructions and User Input | No |
| Photo Shoot Planner | Generate N image prompts for a photo-shoot series | Yes |
| Product Catalog Writer | Generate N product-shot image prompts | Yes |
| Storyboard Writer | Generate N storyboard-shot image prompts | Yes |

The Photo Shoot Planner / Product Catalog Writer / Storyboard Writer presets are **image-prompt fan-out** templates: they emit multiple prompts separated by `===NEXT===` (ready for the `items` output). When one of these templates is selected, the config panel shows an amber warning if no reference image is connected, and **running the node is blocked** ("No reference image connected") until you wire one in. The Custom template has no reference-image requirement.

Built-in fan-out templates use an `{outputCount}` placeholder that is replaced at runtime with the requested number of items.

**User-defined presets:**

Use **"Save as preset"** to store your current Instructions + settings as a reusable preset. When one of your saved presets is selected, two extra controls appear next to the dropdown:

- **Update** — overwrite the selected preset in place with your current Instructions + settings (keeps the same name).
- **Delete** (🗑) — remove the selected preset (asks for confirmation, then falls back to the Custom preset).

User presets are also managed in **Settings** and appear in the Preset dropdown alongside the built-in presets.

## Fan-out

Prompt is built for fan-out — turning one generation into N downstream operations:

- **`items` output (composable)** — split on `===NEXT===` and feed into a Loop or a Generate Image node to run N× automatically as part of a workflow.
- **"Create N Image Nodes"** — a canvas action that spawns one Generate Image node per generated item, laid out in a grid and pre-wired with edges, each pre-filled with its prompt.
- **"Generate All"** — runs all the spawned Generate Image nodes (with a concurrency limit).

The composable `items` output is the recommended path for automated workflows; the canvas actions are for interactive editing on the canvas.

## Credit pricing

Cost depends on the selected model's tier.

| Tier | Example models | Credits |
|------|----------------|---------|
| Economy | Gemini Flash, Claude Haiku, GPT-6 Luna, DeepSeek V4.1 Flash | **1** |
| Standard | Claude Sonnet, GPT-5.2, Grok 4.6 / 4.7 | **2** |
| Premium | Claude Opus, Claude Fable 5, GPT-5.4, GPT-6 Astra / Sol / 6.1 Sol, Kimi K3, Gemini Pro | **6** |
| Premium-direct | a premium model running on the provider's own API (Advanced mode, or a Claude model with an effort) | **15** |

The credit identifier is `llm-chat` (standard), `llm-chat:economy`, `llm-chat:premium`, or `llm-chat:premium-direct`, built from the selected model, effort and Advanced mode at request time. These match the runtime `STATIC_CREDIT_COSTS` values (`llm-chat` = 2, `llm-chat:economy` = 1, `llm-chat:premium` = 6, `llm-chat:premium-direct` = 15 — every LLM feature's premium-direct price is its premium price × 2.5, rounded up).

**Where the call runs, and what it costs.** A call is priced on the route it actually takes. By default every model runs through our aggregator at its tier price; if the aggregator fails, the call is retried on the provider's own API at no extra charge. It runs on the provider's own API — and bills **one rung up** (economy → standard → premium → premium-direct) — when:

- **Advanced mode** is on (Gemini and Claude models), or
- you pick any **Effort** on a **Claude** model: Claude's reasoning effort only takes effect on Anthropic's own API, so choosing one sends the call there. Leave Effort on **Auto** to keep a Claude model on its tier price.

## Reasoning effort

Reasoning-capable models expose an **Effort** selector (Auto/low/…/max — the levels vary
per model). **Auto** applies the vendor default. `xhigh` and `max` bill **one tier up**:
economy models bill the standard price, standard models bill the premium price, premium
models are unchanged.

Examples (LLM Chat: 1 cr economy / 2 cr standard / 6 cr premium):
- GPT-5.6 Luna at `max` → 2 credits (economy billed as standard)
- GPT-5.6 Terra at `xhigh` → 6 credits (standard billed as premium)
- Grok 4.6 at `xhigh` → 6 credits (standard billed as premium; its ladder is low/medium/high/xhigh)
- GPT-5.6 Sol at `max` → 6 credits (premium, unchanged)
- GPT-6 Astra at `xhigh` → 6 credits (premium, unchanged; its ladder is low/medium/high/xhigh)
- Claude Sonnet 5 at `high` → 6 credits (a Claude effort runs on Anthropic's own API: standard billed as premium; `high` adds no effort bump of its own)
- Claude Sonnet 5 at `Auto` → 2 credits (standard)
- Claude Opus 5.5 at `medium` → 15 credits (premium billed as premium-direct)
- Claude Sonnet 5.5 at `max` → 15 credits (the effort bump and the direct bump stack: standard → premium → premium-direct)
- Gemini 3.6 Flash with Advanced mode → 2 credits (economy billed as standard)
- Claude Sonnet 5.5 at `max` → 6 credits (standard billed as premium)
- DeepSeek V4.1 Flash at `xhigh` → 2 credits (economy billed as standard)
- GPT-6.1 Sol has no `none` level (its ladder is low…max): a `none` request runs at the vendor default
- Kimi K3 exposes `low`/`medium`/`high` only — requests above `high` clamp down to it, so it always bills premium (6 credits)
- Gemini 3.6 Flash, Gemini 3.7 Flash, and Gemini 3.8 Flash expose `low`/`high` only — none of them changes the price (requests above `high` clamp down to it)

## Best Practices

- Use the Instructions (System Prompt) to define output format, tone, and constraints — good instructions dramatically improve consistency.
- Reference upstream nodes in the User Input via field mappings for dynamic, context-aware prompts.
- Keep Temperature at 0.7 for a balance of creativity and coherence. Lower it for factual or structured output; raise it for brainstorming.
- For long-form content, raise Max Tokens. The default (8192) handles most cases, but an answer that reaches the cap fails the run (credits refunded) rather than being saved cut off. At `xhigh`/`max` effort the cap is automatically floored — and so it is at **every** effort, including `Auto`, on the models that reason by default, whose reasoning tokens share the output budget on every call: 32768 for Claude Opus 5, Claude Sonnet 5.5, Claude Opus 5.5, Grok 4.6 and 4.7, the GPT-6 family, Kimi K3 and DeepSeek V4.1 Flash; 16384 for Gemini 3.8 Flash and Gemini 3.1 Pro; 8192 for Gemini 3 Flash, Gemini 3.6 Flash and Gemini 3.7 Flash. A small Max Tokens on those models is raised to the floor, so it cannot starve the answer.
- If a run fails with *The answer was cut off*, ask for a shorter answer in the instructions, lower **Effort**, or raise Max Tokens.
- For image-prompt fan-out (Photo Shoot Planner / Product Catalog Writer / Storyboard Writer), connect a reference image upstream — running these templates is blocked without one. The Custom template does not require one.
- Pick the cheapest model that meets your quality bar — economy (1 cr) is plenty for rewriting and captioning; reserve premium (6 cr) for complex reasoning.
- To process a video or audio reference, select a video-capable Gemini model (see the model table — Gemini 3.7 Flash and Gemini 3.8 Flash are image-only for now).

## Common Use Cases

- Rewriting or transforming upstream text (more concise, different tone)
- Generating social-media captions from a video description
- Creating image prompts from a high-level concept (especially with the fan-out templates)
- Brainstorming variations from a seed concept, then fanning out via the `items` output
- Describing or summarizing a connected image, video, or audio clip (multimodal)
- Building structured data (JSON, lists, tables) from natural-language input

## Tips

- Streaming is active by default — tokens appear in real time as the model generates them, with a blinking cursor and a stop button during generation.
- The `===NEXT===` delimiter is the fan-out boundary: the `text` output keeps it; the `items` output splits on it.
- Field mappings inject upstream node outputs into the prompt. For example, connect a Text Prompt node and reference its output in the User Input.
- The node uses the SSE streaming endpoint `/v1/llm-chat/generate-stream`, which bypasses the Vite proxy for real-time delivery. Both the config panel and the DAG executor use the same streaming path. (The legacy `/v1/ai-writer/generate-stream` endpoint remains for back-compat.)
