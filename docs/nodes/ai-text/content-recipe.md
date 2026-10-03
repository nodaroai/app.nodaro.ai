# Content Recipe
> Why a post worked, as a reusable recipe: the hook, the format, the beats, why it works, the call to action, the sound and the pace.

**Availability:** Nodaro Cloud only.

## Overview

Content Recipe reverse-engineers one social post — a competitor's video, a viral TikTok, an ad — into a **recipe** another creator can reuse without copying the original. It reads the post's material once with a language model and returns the recipe both as structured data and as readable text.

Feed it a [Video Analysis](../processing-video/video-analysis.md) result for the best recipe: the analysis carries the timings, the verbatim speech, the on-screen text and the sound, so the hook and the beats are read from what the post really does. A scraped post (an [Instagram Scraper](../input/instagram-scrape.md) or [Meta Ads Scraper](../input/meta-ads-scrape.md) item) or plain text (a caption, a transcript, notes) also works; without timings, the beats are estimated from a natural speaking pace.

The usual next node is [Content Ideas](./content-ideas.md), which turns one or more recipes plus your brand into new post ideas.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model (`llmModel`) | select | `gemini-3.6-flash` | Any model that can return structured output. The model's tier sets the price — see [Credit Cost](#credit-cost) |
| Focus (`focus`) | text | `""` | Optional: what to pay special attention to (e.g. "the hook and the editing rhythm"). Up to 2,000 characters; can be mapped from a text node |
| Post link (`sourceUrl`) | text | `""` | Optional: the post's link, used when nothing is wired into **Source post**. Cited on the recipe, never fetched |

## Inputs & Outputs

- **Input** `in` (**Source material**) — the post's material: a Video Analysis result (best), a scraped post, or any text. Given a list of several posts, the node reads the first one and says so on the node; set the wire to **Each** to get one recipe per post.
- **Input** `link` (**Source post**) — the post's own link. Wire the **Video URL** node here (the node reads its page link, never the downloaded file), or any text holding a link. Wins over the typed **Post link**.
- **Output** `json` — the recipe object (below).
- **Output** `text` — the same recipe as readable text: what a person reads, and what Content Ideas reads when the recipe arrives as text.

### The recipe

| Field | Description |
|-------|-------------|
| `version` | `1` |
| `source` | Where the recipe came from: `kind` (`video-analysis`, `post` or `text`), and when known the post's `url`, `platform`, account `handle`, `title` and `language` — all read off the input, never invented |
| `hook` | The first ~3 seconds: `spoken` (verbatim, original language), `onScreenText` (verbatim), `visual`, `types` (1–2 hook mechanics, main one first) and `whyItStops` |
| `format` | `label` (one format, below) and `confidence` (0–1) |
| `beats` | The post's structure in order: `start` and `end` in seconds, a `purpose` and a one-line `description` |
| `whyItWorks` | 2–4 reasons: a `reason` and a `detail` tied to a specific moment of the post |
| `cta` | `kind` and the call to action's `text` (verbatim; empty when the kind is `none`) |
| `sound` | `kind` and a short `detail` |
| `durationSec`, `pace`, `aspect` | Length (measured from the analysis when there is one), `fast` / `medium` / `slow`, and aspect ratio when known |
| `topic`, `summary` | The subject in a few words, and the reusable pattern in 2–3 sentences |

### Label vocabularies

The labels are stable English ids from fixed lists, so filters, routers and later nodes can key on them. Every list ends in an escape hatch.

- **Formats:** `talking-head`, `pov`, `skit`, `storytime`, `tutorial`, `listicle`, `before-after`, `transformation`, `demo`, `unboxing`, `reaction`, `comparison`, `myth-vs-fact`, `day-in-the-life`, `challenge`, `hot-take`, `trend-remix`, `testimonial`, `behind-the-scenes`, `other`.
- **Hook types (the mechanic):** `question`, `bold-claim`, `result-first`, `problem-callout`, `tease`, `story-open`, `direct-address`, `relatable-moment`, `pattern-interrupt`, `visual-shock`, `text-overlay`, `sound-hook`, `other`.
- **Beat purposes:** `hook`, `setup`, `problem`, `build`, `demo`, `proof`, `reveal`, `payoff`, `twist`, `cta`, `other`.
- **Why it works (the driver):** `curiosity`, `emotion`, `humor`, `relatability`, `social-proof`, `novelty`, `utility`, `aspiration`, `controversy`, `satisfaction`, `urgency`, `authority`, `other`.
- **CTA kinds:** `none`, `follow`, `comment`, `share`, `save`, `link-in-bio`, `buy`, `sign-up`, `watch-next`, `dm`, `other`.
- **Sound kinds:** `voiceover`, `on-camera-speech`, `trending-sound`, `music`, `ambient`, `silent`, `mixed`.

## Credit Cost

One flat price per run, by the tier of the chosen model:

| Model tier | Credits per run |
|------------|-----------------|
| Economy (e.g. Gemini 3.6 Flash — the default) | 5 |
| Standard (e.g. Claude Sonnet 4.6) | 20 |
| Premium (e.g. Claude Opus 5) | 35 |

A reasoning effort of `xhigh` or `max` moves the run one tier up, as on every language-model node. The credit id is `content-recipe:economy`, `content-recipe` or `content-recipe:premium`. A run that fails is refunded.

The recipe is cheap; the [Video Analysis](../processing-video/video-analysis.md) that usually feeds it is priced separately, by the video's length.

## Tips

- Analyze the post with Video Analysis first: the hook and the beats are only as good as the material.
- Wire the Video URL node into **Source post** so every idea downstream can link back to the post it came from.
- The text output never starts with a link, so it can feed a fan-out safely.
