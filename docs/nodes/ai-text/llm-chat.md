# Generate Text
> LLM text generation from a prompt, with optional image/video/audio reference inputs, real-time streaming, and a built-in fan-out item list.

## Overview

The Generate Text node (`llm-chat`, labeled "Generate Text" on the canvas) generates text from a prompt using a selectable LLM, with optional system instructions. It supports real-time token streaming and can reference upstream node outputs in its prompt via field mappings, making it a flexible text-generation and transformation step in any workflow.

It can also accept **reference inputs** on the multi-modal **References** handle (its own fuchsia pip) — an image, video, audio clip, **or text** — for multimodal prompting (e.g. "describe this image", "summarize this clip"). Image/video/audio references are routed to the model as reference media (video and audio require a Gemini model — see [Multimodal inputs](#multimodal-inputs)); a **text** reference is merged into the prompt as added context.

This node is the result of merging the former **AI Agent** (image-prompt fan-out) and **LLM Chat** nodes into one. Existing AI Agent / LLM Chat nodes are auto-migrated to Generate Text on workflow load. The legacy `/v1/ai-writer/*` routes remain available for back-compat; the node itself now runs on `/v1/llm-chat/*`.

## Two outputs

Generate Text exposes **two** outputs:

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
| Model | `string` | `gemini-3-flash` | LLM model picked via the model selector — drives both capability and credit cost (see [Credit pricing](#credit-pricing)) |
| Temperature | `number` | `0.7` | Creativity control (0 = deterministic, 1 = more creative) |
| Max Tokens | `number` | `2048` | Maximum output length in tokens |
| # of runs | `number` | `1` | How many generations to produce per Run click (1–4 in the node's quick toolbar). Each run is charged separately — the Run button shows the multiplied credit cost |

### Model selector

The model is chosen from the shared LLM model selector and determines the credit cost by tier:

| Tier | Models | Multimodal |
|------|--------|------------|
| Economy | Gemini Flash, Claude Haiku | Gemini Flash: image + video + audio. Haiku: image only |
| Standard | Claude Sonnet, GPT-5.2 | image only |
| Premium | Gemini Pro, Claude Opus, GPT-5.4 | Gemini Pro: image + video + audio. Opus / GPT-5.4: image only |

The default model is Gemini Flash (economy tier). All models accept an image reference; only the **Gemini** models accept video and audio references.

## Canvas controls

Hovering the node on the canvas reveals a quick toolbar beneath it, mirroring the Generate Image node:

- **AI Model** — pick the LLM (same options as the config panel's model selector).
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
- **Video / audio reference** — supported **only by Gemini models** (Gemini Flash or Gemini Pro). If a video or audio reference is connected, select a Gemini model or the reference is ignored.

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

Generate Text is built for fan-out — turning one generation into N downstream operations:

- **`items` output (composable)** — split on `===NEXT===` and feed into a Loop or a Generate Image node to run N× automatically as part of a workflow.
- **"Create N Image Nodes"** — a canvas action that spawns one Generate Image node per generated item, laid out in a grid and pre-wired with edges, each pre-filled with its prompt.
- **"Generate All"** — runs all the spawned Generate Image nodes (with a concurrency limit).

The composable `items` output is the recommended path for automated workflows; the canvas actions are for interactive editing on the canvas.

## Credit pricing

Cost depends on the selected model's tier. Formula: `[formula removed]` (1 credit = $0.02, configured pricing factor).

| Tier | Example models | Credits |
|------|----------------|---------|
| Economy | Gemini Flash, Claude Haiku | **1** |
| Standard | Claude Sonnet, GPT-5.2 | **2** |
| Premium | Claude Opus, GPT-5.4, Gemini Pro | **3** |

The credit identifier is `llm-chat` (standard), `llm-chat:economy`, or `llm-chat:premium`, built from the selected model at request time. These match the runtime `STATIC_CREDIT_COSTS` values (`llm-chat` = 2, `llm-chat:economy` = 1, `llm-chat:premium` = 3).

## Best Practices

- Use the Instructions (System Prompt) to define output format, tone, and constraints — good instructions dramatically improve consistency.
- Reference upstream nodes in the User Input via field mappings for dynamic, context-aware prompts.
- Keep Temperature at 0.7 for a balance of creativity and coherence. Lower it for factual or structured output; raise it for brainstorming.
- For long-form content, raise Max Tokens. The default (2048) handles most cases but may truncate very long outputs.
- For image-prompt fan-out (Photo Shoot Planner / Product Catalog Writer / Storyboard Writer), connect a reference image upstream — running these templates is blocked without one. The Custom template does not require one.
- Pick the cheapest model that meets your quality bar — economy (1 cr) is plenty for rewriting and captioning; reserve premium (3 cr) for complex reasoning.
- To process a video or audio reference, select a Gemini model.

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
