# Content Ideas
> One or more content recipes plus your brand in, concrete post ideas out — and the next node runs once per idea.

**Availability:** Nodaro Cloud only.

## Overview

Content Ideas turns [Content Recipes](./content-recipe.md) — descriptions of why specific posts worked — into new post ideas for your brand. Each idea borrows a recipe's **structure** (its format, hook mechanic, beat order and pacing) and never the original's words, footage, music, faces or brand marks: the model is never shown the source's verbatim lines, so it cannot echo them.

Its output is a **list**: the node after it (typically [Generate Script](./generate-script.md)) runs once per idea, in the editor and on the server, so a whole batch of ideas becomes a batch of scripts in one run.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model (`llmModel`) | select | `gemini-3.6-flash` | Any model that can return structured output. The model's tier sets the price — see [Credit Cost](#credit-cost) |
| Your brand (`brand`) | text | `""` | What you sell, who it is for, your tone, and what the brand never does. Up to 6,000 characters. Can come from a Text node wired into **Brand**. Empty = ideas for a small brand in the same niche as the recipes |
| Number of ideas (`count`) | number | `5` | 1 to 10 |
| Language (`language`) | text | `""` | Optional, e.g. `Hebrew`. Empty = the language the brand text is written in (English when there is none) |

## Inputs & Outputs

- **Input** `recipes` (**Recipes**) — one or more recipes. Wire several Content Recipe nodes, or one Content Recipe that ran once per post: every recipe folds into ONE run. Either of the recipe's outputs works (`json` or `text`), and so does recipe text from any text node. Up to 10 recipes are read.
- **Input** `field-brand` (**Brand**) — the brand profile as text; wins over the typed field.
- **Output** `ideas` — one creative brief per idea. Every wire leaving it runs the next node once per idea. Set a wire to **Selected** to hand the next node all the ideas as one text instead.

### Each idea

| Field | Description |
|-------|-------------|
| `title` | A short working title |
| `format` | One format id (the same list as [Content Recipe](./content-recipe.md#label-vocabularies)) |
| `hook` | `line` (the first spoken line or caption), `firstShot` (what the viewer sees in the first second) and `onScreenText` |
| `beats` | The idea's structure: `start` and `end` in seconds, a `purpose` and a `description` |
| `shotList` | 2–6 filmable shots |
| `durationSec` | Target length |
| `cta` | The closing call to action |
| `whyItFitsUs` | Why this idea suits the brand and its audience |
| `inspiredBy` | `recipe` (which input recipe, from 1), the source post's `url` and `title` when the recipe carries them, and `borrowed` — the structural element taken from it |

The brief each run of the next node receives holds the same fields as readable text, ending with the post that inspired it.

## Credit Cost

Charged per batch of up to five ideas, by the tier of the chosen model:

| Model tier | 1–5 ideas | 6–10 ideas |
|------------|-----------|------------|
| Economy (e.g. Gemini 3.6 Flash — the default) | 10 | 20 |
| Standard (e.g. Claude Sonnet 4.6) | 35 | 70 |
| Premium (e.g. Claude Opus 5) | 50 | 100 |

Formula: `credits = batch price × ceil(ideas ÷ 5)`, with the batch price set by the model's tier. Examples: 5 ideas on the default model = 10 credits; 7 ideas on a standard model = 70 credits; 10 ideas on a premium model = 100 credits. A reasoning effort of `xhigh` or `max` moves the run one tier up. The credit ids are `content-ideas[:economy|:premium]` (1–5 ideas) and `content-ideas:10[:economy|:premium]` (6–10). A run that fails is refunded.

## Tips

- The more specific the brand text, the better the ideas — include the audience, the tone, an offer, and the things the brand never does.
- Mix recipes from different posts: the ideas spread across them and across hook mechanics.
- `{Content Ideas}` inside another node's text is the digest of every idea, not the current one — wire the node instead.
