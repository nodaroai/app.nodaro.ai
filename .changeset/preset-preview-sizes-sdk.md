---
"@nodaro/sdk": minor
---

`FactoryPresetEntry.previewWidth` / `previewHeight` (`presets.listFactory`, `GET /v1/node-presets/factory`): a built-in preset's tile picture's real width and height, so a client boxes the picture at its own shape before it loads. A preset's `data.aspectRatio` is what it generates, which is not always its picture's shape.
