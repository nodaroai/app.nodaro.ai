---
"@nodaro/client": minor
---

Add `CreaturesResource` to `@nodaro/client`, exposed as `client.creatures`, with 13 methods (`list` / `listArchived` / `get` / `create` / `update` / `delete` / `permanentDelete` / `restore` / `generate` / `generateAsset` / `generateMotion` / `approveMainImage` / `recaption`). Mirrors `ObjectsResource` against the deployed creature routes (`/v1/creatures*` + `/v1/generate-creature*`).

Creature-specific deltas vs objects:
- `species` free-text field (the creature subject) — the primary differentiator object has no equivalent of
- `poses` asset bucket where object has `materials`
- 4-value asset-type enum (angles / poses / variations / custom) — NO `motion` value (creature motion flows through the dedicated `generate-creature-motion` endpoint)
- free-text `category` (a creature can be any type — not object's fixed 10-value enum)
- `attachToCreatureId` replaces `attachToObjectId`
- `generate-motion` reuses the object aspect-ratio enum (5-value: 1:1 / 3:4 / 16:9 / 9:16 / 4:3) and the object motion defaults (provider `kling-turbo` + aspect ratio `1:1`)

New public exports: `Creature`, `CreatureDetail`, `CreatureReferencePhoto`, `CreatureReferencePhotoKind`, `CreateCreatureInput`, `UpdateCreatureInput`, `UpsertCreatureInput`, `Generate*` input/result types, `CreatureAssetType`, `CreatureAttachColumn`, `CreatureAspectRatio`, plus the runtime tuples `CREATURE_ASSET_TYPES` / `CREATURE_ATTACH_COLUMNS` / `CREATURE_ASPECT_OPTIONS` / `CREATURE_ASPECT_DEFAULTS`.
