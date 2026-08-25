---
name: instagram-carousel
description: A full Instagram carousel from one idea — an LLM emits slides in a strict machine-parseable format, a List splits them by delimiter, one image node renders every slide 9:16 with the text baked into the image, plus intro and caption
triggers: ["instagram carousel", "carousel post", "carousel from this text", "slides for instagram", "social post from an idea", "turn this into a carousel", "quote slides", "swipe post"]
version: 1
---

# Instagram Carousel — idea in, carousel out

One idea (or a pasted article) becomes a complete, ready-to-post carousel: N
slide images (text embedded IN each image), an intro text, and a caption with a
hook, CTA and hashtags. The engine of the whole flow is a FORMAT CONTRACT: the
LLM is forced to emit machine-parseable output, so the graph downstream can
split it deterministically.

## The core trick — design the LLM's output for the graph that consumes it

The system prompt (load `references/system-prompt.md` — proven text, reuse
near-verbatim) forces three things:

1. **A slide separator**: every slide block ends with `***` (and `***` may
   appear nowhere else). Downstream, a `list` node column with
   `splitDelimiter: "***"` splits the single LLM text into one row per slide —
   no extra parsing node needed.
2. **A caption wrapper**: the caption is fenced between `><` markers on their
   own lines. A SECOND `list` column with `splitDelimiter: "><"` pulls it out
   of the same LLM output.
3. **A per-slide structure** whose last field is a complete image prompt that
   already contains: `"with text overlay"`, the EXACT slide text in quotes,
   typography, placement, cinematic style, and vertical 9:16 — so the slide row
   can feed an image node's `prompt` DIRECTLY.

Break any of the three and the graph breaks: a chatty preamble or a stray `***`
becomes a phantom slide.

## The graph

1. **System** (`text-prompt`) → `llm-chat`'s `system-prompt` input;
   **Content** (`text-prompt` — the user's idea/article) → its `prompt`.
2. `llm-chat` `text` → **List A** (column `splitDelimiter: "***"`) — one row per
   slide.
3. List A's column output → **one `generate-image`** (`nano-banana-pro`,
   `aspectRatio: "9:16"`): the rows fan the single node into one image per
   slide. The slide text lands INSIDE the image because the prompt demands the
   overlay.
4. The images collect into a second `list` (image column) — the carousel, in
   order, reviewable.
5. `llm-chat` `text` → **List B** (column `splitDelimiter: "><"`) → an optional
   second `llm-chat` ("hook generator") that polishes the caption.
6. Delivery: `social-media-format` on the image set, then an Instagram publish
   step — see the boundary below.

## Hard rules

- **Slide count is detected from the input, capped at 10** — the contract makes
  the LLM match the input's structure, never pad or merge.
- **One slide = one image = ONE scene.** No split screens, collages or
  multi-panel compositions inside a slide — the contract forbids it because
  carousel slides read at phone size.
- **The visual must restate the slide's message** (no generic aesthetics), and
  every slide compresses to a 6-10 word save-worthy line.
- **Consistent visual style across all slides** — stated once in the contract,
  it rides every image prompt.
- 9:16 vertical, always. Caption ≤ 2,000 characters including hashtags.

## Delivery boundary (be honest about it)

The publish step (`instagram-post`, via `social-media-format`) is an OUTBOUND
node. If you are the in-app copilot you cannot author publishing nodes — build
everything through step 5, show the user the finished carousel + caption, and
tell them to add the Instagram Post node themselves and pick their account.
Never silently drop the delivery step — say exactly what is left to wire.

## Phase 0 — Ask first

1. The content: a raw idea, or an existing text to compress? (Both work — the
   contract adapts slide count to the input.)
2. Visual direction in one line (cinematic/minimal/premium is the proven
   default).
3. Whether they want the caption polished by the extra hook pass.
