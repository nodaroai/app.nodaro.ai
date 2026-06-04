# Image to Video → Generate Video

> This node has been unified into **[Generate Video](./generate-video.md)**.

The legacy `image-to-video` node type has been replaced by the unified [Generate Video](./generate-video.md) node, which drives by connection — text-only mode, image-to-video mode, first+last frame mode, or reference mode, all from one node. The provider catalog, parameter set, and credit pricing for image-to-video usage are unchanged; Generate Video also adds text-only mode (no input image) for providers like VEO 3.x and Kling.

## Migration

Existing workflows continue to work — `image-to-video` nodes auto-migrate to `generate-video` the moment the workflow opens in the editor. Handle ids are renamed (`references` → `imageReferences`, `reference-videos` → `videoReferences`, `reference-audio` → `audioReferences`, `cinematography` → `look` / `elements`), legacy data fields are normalized (`connectedRefImageOrder` → `referenceImageOrder`, `kling3Mode`/`kling3Sound` → `mode`/`sound`), and the node `type` is rewritten in-memory. The migration is idempotent.

## What to do now

- **New workflows** — use [Generate Video](./generate-video.md) directly.
- **Existing workflows** — no action needed; they auto-migrate on load.
- **External docs / links pointing here** — the redirect lives at this file path indefinitely; links keep working.

## Pricing & parameters

All image-to-video pricing examples (VEO 3.x, Kling, Seedance 2, Hailuo, Bytedance, MiniMax, Wan, HappyHorse, Runway, …), per-provider parameter tables, end-frame support, multimodal reference limits, and the Loop Trim add-on formula are documented on the [Generate Video](./generate-video.md) page.

## See also

- [Generate Video](./generate-video.md) — the unified replacement node.
- [Text to Video (legacy)](./text-to-video.md) — same migration applies.
- [Video to Video](./video-to-video.md) — for modifying existing videos (separate node).
