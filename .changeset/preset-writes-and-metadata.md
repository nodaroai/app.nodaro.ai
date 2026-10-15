---
"@nodaro/sdk": minor
"@nodaro/cli": minor
"@nodaro/prompts": minor
---

Node presets can be written over the API. `client.presets` gains `create`, `update(id, patch, { expectedUpdatedAt })`, `delete`, `import`, `reorder`, `favorites`, `addFavorite`, `removeFavorite`, `createGroup`, `updateGroup` and `deleteGroup`. Your own API key may call them; an OAuth app needs the `assets:write` scope (reads still need `presets:read`); a key limited to some workflows cannot reach presets.

Every preset now says how many connected photos it works from and shows an example picture: `minReferences` and `needsImage` (`minReferences > 0` — Reference Sheet, Portrait Transformations, Edits and every template using `{image:N}`) and `previewUrl` (an absolute URL, or `null` while a preset has none) on each factory entry (the new `FactoryPresetEntry` type) and on `NodePreset`. A preset of your own can store a picture: pass `previewUrl` on create, update or import — an image already stored on the platform (an upload or a finished result); `null` removes it. The preset keeps its own copy, so the `previewUrl` it answers with is the copy's address, not the one you sent. To use it: show `previewUrl` when it is not null, and ask for `minReferences` reference images before running a preset whose `needsImage` is true. The fields are optional in the types because older servers leave them out.

The CLI gains `nodaro presets create`, `update`, `delete`, `import <file>` (what `presets export` writes, or a JSON list), `favorites`, `favorite`, `unfavorite`, and `presets groups create|update|delete` (bare `presets groups` still lists); `presets list --factory` shows each preset's photo count and whether it has a picture.

`@nodaro/prompts`: `FactoryPreset` gains an optional `minReferences` declaration, with `presetMinReferences(nodeType, data, declared?)` (the count from a preset's `{image:N}` tokens and its declaration), `factoryPresetPreviewUrl(presetId, baseUrl)` and the committed picture map `FACTORY_PRESET_PREVIEW_FILES`.

Behavior changes on the existing routes: `DELETE /v1/node-presets/:id` of a preset that is not yours, or is already gone, answers `404 not_found` (it answered `200`, as folders already did not) — `client.presets.delete` then throws, so treat a 404 as already deleted; `DELETE /v1/node-presets/:id` and `DELETE /v1/node-preset-groups/:id` answer `404 not_found` for an id that is not a uuid (it was a `500`), and `DELETE /v1/node-presets/:id?expectedUpdatedAt=…` answers `404` rather than `409 conflict` for a preset that is not yours. Each account keeps at most 5,000 presets, 500 folders and 2,000 favorites (`409 limit_reached` past that), and one reorder from an API key or an OAuth app moves at most 500 presets and 100 folders.
