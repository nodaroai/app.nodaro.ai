# Text to Video → Generate Video

> This node has been unified into **[Generate Video](./generate-video.md)**.

The legacy `text-to-video` node type has been replaced by the unified [Generate Video](./generate-video.md) node, which drives by connection — text-only mode, image-to-video mode, first+last frame mode, or reference mode, all from one node. The provider catalog, parameter set, and credit pricing for text-to-video usage are unchanged.

## Migration

Existing workflows continue to work — `text-to-video` nodes auto-migrate to `generate-video` the moment the workflow opens in the editor. Handle ids are renamed (the legacy `in` prompt handle becomes the typed `prompt` handle, `cinematography` becomes `look` / `elements`), and the node `type` is rewritten in-memory. The migration is idempotent.

## What to do now

- **New workflows** — use [Generate Video](./generate-video.md) directly.
- **Existing workflows** — no action needed; they auto-migrate on load.
- **External docs / links pointing here** — the redirect lives at this file path indefinitely; links keep working.

## Pricing & parameters

All text-to-video pricing examples (VEO 3.x, Gemini Omni, Kling, Seedance 2, Hailuo Standard, Bytedance, MiniMax, Wan 2.6 / 2.7 / **3.0**, HappyHorse, Runway, …), per-provider parameter tables, and the dispatch rules that route a wireless node to `text-to-video` mode are documented on the [Generate Video](./generate-video.md) page.

`/v1/text-to-video` remains a live API route and behaves identically to the
unified node. A resolution, aspect ratio or duration the wired model does not
support is **corrected** rather than rejected, and you are billed for the
corrected value because it is also the value sent to the provider: off-list
values snap to the nearest supported option (never the cheapest, and never
landscape from a portrait request), an omitted resolution is sent at the band it
is priced at, `4K` canonicalises to `4k`, and LTX 2.3 durations move to the
nearest seeded rung. The route returns the corrections in an `adjustments` array.
See [Resolution, aspect ratio and duration corrections](./generate-video.md#resolution-aspect-ratio-and-duration-corrections)
and the API reference on [Parameter corrections](../../api-integration.md#4d-parameter-corrections-adjustments).

## See also

- [Generate Video](./generate-video.md) — the unified replacement node.
- [Image to Video (legacy)](./image-to-video.md) — same migration applies.
- [Video to Video](./video-to-video.md) — for modifying existing videos (separate node).

## Pre & post text

This node supports `promptPrefix` / `promptSuffix` — optional text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md).
