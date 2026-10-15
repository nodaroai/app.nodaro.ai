---
"@nodaro/sdk": minor
"@nodaro/cli": minor
"@nodaro/prompts": minor
---

Your own colour palettes and moodboards, usable as a generate-image direction.

- **SDK:** `client.palettes` and `client.moodboards` (`list` / `get` / `create` / `update` / `delete`) with their types (`ColorPalette`, `Moodboard`, `MoodboardImage`, …). Use one on `nodes.run("generate-image", …)` as `direction: { colorLook: paletteDirectionId(id) }` — the palette's colours, each by an everyday name and its hex, go into the prompt — or `direction: { style: moodboardDirectionId(id) }` — the moodboard's description goes into the prompt and its images go to the model as style references, after your own references and up to the model's reference limit. `GenerateImageParams.direction` is now typed (`DirectionFields`) and documents both values; a run's answer types `warnings?: RunNodeWarning[]` (`moodboard_images_not_sent` when some images did not fit). A malformed value answers 400, one that is not yours 404 `direction_not_found`, and one beside `presetId` 400 for now. OAuth apps need `assets:read` / `assets:write` for the new resources; nothing else changes for existing callers.
- **CLI:** `nodaro palettes list|get|create|update|delete` and `nodaro moodboards list|get|create|update|delete` (`--image <url[|caption]>`, repeatable).
- **Prompts:** the `colorLook` and `style` direction rows take a user-owned reference (`palette:<id>`, `moodboard:<id>`; `parseUserDirectionRef`, `directionKeyForUserRef`); the fold renders the clause a caller resolved for it (`renderDirectionHints` / `partitionStyleClauses` option `refs`, `assembleImageInput`'s `directionRefs`); `assembleImageInput` takes fill-only `styleReferences` and reports `styleReferencesSent`; `renderPaletteClause`, `renderMoodboardClause`, `styleReferenceDescription` and `nearestColorName` give the wording; the catalog-curation guard leaves a user-owned reference on its own key alone. Everything is additive: a fold without them is byte-identical.
