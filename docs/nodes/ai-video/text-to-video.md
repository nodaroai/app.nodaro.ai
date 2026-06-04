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

All text-to-video pricing examples (VEO 3.x, Kling, Seedance 2, Hailuo Standard, Bytedance, MiniMax, Wan, HappyHorse, Runway, …), per-provider parameter tables, and the dispatch rules that route a wireless node to `text-to-video` mode are documented on the [Generate Video](./generate-video.md) page.

## See also

- [Generate Video](./generate-video.md) — the unified replacement node.
- [Image to Video (legacy)](./image-to-video.md) — same migration applies.
- [Video to Video](./video-to-video.md) — for modifying existing videos (separate node).
