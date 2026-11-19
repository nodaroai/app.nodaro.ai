---
"@nodaro/sdk": minor
"@nodaro/shared": minor
---

`videoRemake.artStyles({ locale })` (`GET /v1/video-remake/art-styles`, public) lists the art styles the Video Remake page's art style picker offers, in its order: each `{ id, label, clipUrl, stillUrl }` (`VideoRemakeArtStyle`, also from `@nodaro/sdk/video-remake`). `id` is a run's `direction.style`, `label` the style's name in `locale` (English when left out, unknown, or not named in that language), `clipUrl` a short preview clip and `stillUrl` a still cut from it, both absolute. The list is empty on a deployment that does not show Nodaro's previews, or one without Video Remake or its art styles. No sign-in needed; the answer may be up to five minutes old.

`@nodaro/shared/i18n` exports `STYLE_SIDECAR_LOADERS`: the `style` catalog's locale sidecars as lazy loaders for `registerSidecarLoaders`, for a host with no bundler glob of its own (a Node server). Each language stays its own chunk.
