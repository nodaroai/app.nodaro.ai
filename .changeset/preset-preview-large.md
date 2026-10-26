---
"@nodaro/prompts": minor
"@nodaro/sdk": minor
---

Factory preset pictures come in two sizes: the tile picture (512px wide, `previewUrl`) and a full-screen one (1024px wide). `GET /v1/node-presets/factory` entries carry `previewSrcSet` — both with their widths, ready for an `<img srcset>` — when the preset has both files; `FactoryPresetEntry.previewSrcSet` in the SDK. `@nodaro/prompts/presets` exports the large file map (`FACTORY_PRESET_PREVIEW_LARGE_FILES`), `factoryPresetPreviewSrcSet` and the two widths.
