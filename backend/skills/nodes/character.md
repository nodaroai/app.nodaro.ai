---
node_type: character
generated_at: 2026-08-15T21:55:08.561Z
generated_from: 150c80ac9
---

# Character

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `character`
**Category:** character
**Credit cost:** 5
**Inputs (target handles):** `assets`, `in`
**Outputs (source handles):** `characterRef`

**Required data fields:**
- `label: string`
- `characterDbId: string`
- `characterName: string`
- `description: string`
- `sourceImageUrl: string`
- `gender: "male" | "female" | "other"`
- `style: EntityArtStyle`
- `baseOutfit: string`
- `characterSheet: CharacterSheet | null`
- `projectId: string`
- `createdAt: string`
- `executionStatus: "idle" | "running" | "completed" | "failed"`
- `generatedResults: GeneratedResult[]`
- `activeResultIndex: number`
- `fieldMappings: FieldMappings`
- `expressionSheet: string`
- `poseSheet: string`
- `lightingSheet: string`
- `anglesSheet: string`
- `expressions: CharacterAssetItem[]`
- `poses: CharacterAssetItem[]`
- `lightingVariations: CharacterAssetItem[]`
- `angles: CharacterAssetItem[]`
- `bodyAngles: CharacterAssetItem[]`
- `expressionStatus: "idle" | "running" | "completed" | "failed"`
- `poseStatus: "idle" | "running" | "completed" | "failed"`
- `lightingStatus: "idle" | "running" | "completed" | "failed"`
- `anglesStatus: "idle" | "running" | "completed" | "failed"`
- `bodyAnglesStatus: "idle" | "running" | "completed" | "failed"`
- `customVariations: Array<{ prompt: string; url: string; createdAt: string }>`
- `motions: CharacterAssetItem[]`
- `motionStatus: "idle" | "running" | "completed" | "failed"`
- `voice: CharacterVoice | null`
- `personality: CharacterPersonality | null`

**Optional data fields:**
- `provider?: string`
- `identityLock?: "off" | "soft" | "strict"`
- `defaultUsageMode?: import("@nodaro/shared").UsageMode`
- `defaultRole?: string`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `assetInjections?: ReadonlyArray<{ sourceNodeId: string; facet?: string }>`
- `scriptCharacterIndex?: number`
- `sheets?: ReferenceSheet[]`
- `detailCloseups?: CharacterAssetItem[]`
- `outfitVariations?: CharacterAssetItem[]`
- `boards?: ReadonlyArray<CharacterBoardEntry>`
- `selectedAssetByVariant?: Readonly<Record<string, string>>`
- `person?: PersonValue`
- `wardrobe?: WardrobeValue`
- `referencePhotos?: ReadonlyArray<{ url: string; kind: ReferencePhotoKind }>`
- `seedPrompt?: string`
- `canonicalDescription?: string`
- `realLifeRefsByVariant?: Readonly<Record<string, ReadonlyArray<string>>>`
- `referenceVideosByVariant?: Readonly<Record<string, ReadonlyArray<string>>>`
- `injectIdentityInPrompts?: boolean`
- `loraReplicateVersion?: string | null`
- `loraTriggerWord?: string | null`
- `loraTrainingStatus?: "queued" | "training" | "succeeded" | "failed" | "cancelled" | null`
- `defaultAssetUrl?: string`
- `defaultAssetName?: string`
- `defaultAssetAspectRatio?: CharacterAspectRatio`
- `pipeline_id?: string`
- `pipeline_entity_id?: string`
- `pipeline_owned?: boolean`
- `pipeline_state?: PipelineState`
- `is_stale?: boolean`

**Default data:**
```json
{
  "label": "Character Asset",
  "characterDbId": "",
  "characterName": "",
  "description": "",
  "sourceImageUrl": "",
  "gender": "other",
  "style": "realistic",
  "baseOutfit": "",
  "characterSheet": null,
  "projectId": "",
  "createdAt": "",
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0,
  "fieldMappings": {},
  "expressionSheet": "",
  "poseSheet": "",
  "lightingSheet": "",
  "anglesSheet": "",
  "expressions": [],
  "poses": [],
  "lightingVariations": [],
  "angles": [],
  "bodyAngles": [],
  "expressionStatus": "idle",
  "poseStatus": "idle",
  "lightingStatus": "idle",
  "anglesStatus": "idle",
  "bodyAnglesStatus": "idle",
  "customVariations": [],
  "motions": [],
  "motionStatus": "idle",
  "voice": null,
  "personality": null
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

A reusable person the user saved: portrait, variants (expressions, poses, angles, body angles, wardrobe, detail close-ups), voice and identity description, edited in the Character Studio. Set `characterDbId` to the saved character's id (from `list_characters` / the user's `[references]` line) — the server hydrates the media; never write URLs. Wire `characterRef` into a generator's `assets` handle and the character's identity travels with every generation.

## Variants and @-mentions (how to use a SPECIFIC angle, expression or pose)

When a character node is wired into a generator, EVERY named variant in its buckets becomes addressable from the prompt by an `@` token — the model-writable way to pick "the back angle of Iris" with no URL:

- `@<slug>:<N>` — the canonical portrait. `<slug>` is the slugified character name (lowercase, non-alphanumerics collapsed to dashes: "Emma Walker 2" → `emma-walker-2`). `<N>` is the 1-based position this mention takes in the prompt's identity-directive block — number mentions in order of appearance, starting at 1.
- `@<slug>:<N>:<variant>` — a specific variant IMAGE. `<variant>` is the slugified variant name from the character's buckets (an `angles` entry named "3/4 left" → `3-4-left`). Read the real names with `get_character` (FULL returns `expressions`, `poses`, `angles`, `body_angles`, and the wardrobe/detail arrays) and slugify the same way.
- `@<slug>:<N>:<mode>` — canonical image with a usage-mode override shaping the identity directive: one of `identical`, `face`, `face-pose`, `pose`, `emotion`, `style`, `name`, `none`. A third segment that matches a mode keyword IS a mode; anything else is a variant slug.
- `@<slug>:<N>:<variant>:<mode-or-role>` — variant picks the IMAGE, the 4th segment shapes the PHRASE: a mode keyword sets the usage mode; any other slug is a per-mention role ("the clothes from …").
- A trailing `~lock` / `~nolock` forces the identity lock on/off for that one mention.

The prompt reads naturally around the tokens: `@iris:1:back walks away down the corridor`. Unmatched tokens (wrong slug, variant not in the buckets) are simply skipped — verify the slugs against `get_character` rather than guessing.

## Common gotchas

- The token index is REQUIRED: bare `@iris` is not a mention — always at least `@iris:1`.
- A variant slug must exist in the character's buckets to resolve; a typo does not error, it silently un-references. Check `get_character` first.
- The character must actually be WIRED (its `characterRef` into the consumer's `assets`) for its `@` tokens to resolve — a mention with no wired character is inert text.
- The `image` output handle is a PLAIN image of the portrait (routes like an upload), not an identity reference — identity flows through `characterRef`/`assets`.
- Never write `sourceImageUrl`/asset URLs on this node; set `characterDbId` and let hydration fill the media.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "character-1",
  "type": "character",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Character Asset",
    "characterDbId": "",
    "characterName": "",
    "description": "",
    "sourceImageUrl": "",
    "gender": "other",
    "style": "realistic",
    "baseOutfit": "",
    "characterSheet": null,
    "projectId": "",
    "createdAt": "",
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0,
    "fieldMappings": {},
    "expressionSheet": "",
    "poseSheet": "",
    "lightingSheet": "",
    "anglesSheet": "",
    "expressions": [],
    "poses": [],
    "lightingVariations": [],
    "angles": [],
    "bodyAngles": [],
    "expressionStatus": "idle",
    "poseStatus": "idle",
    "lightingStatus": "idle",
    "anglesStatus": "idle",
    "bodyAnglesStatus": "idle",
    "customVariations": [],
    "motions": [],
    "motionStatus": "idle",
    "voice": null,
    "personality": null
  }
}
```
<!-- AUTO-GEN:END examples -->
