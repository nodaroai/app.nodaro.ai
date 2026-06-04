---
node_type: character
generated_at: 2026-06-04T12:41:29.006Z
generated_from: 9bf1388db
---

# Character

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `character`
**Category:** character
**Credit cost:** 5
**Inputs (target handles):** `in`
**Outputs (source handles):** `characterRef`

**Required data fields:**
- `label: string`
- `characterDbId: string`
- `characterName: string`
- `description: string`
- `sourceImageUrl: string`
- `gender: "male" | "female" | "other"`
- `style: "realistic" | "anime" | "3d-pixar" | "illustration"`
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
- `currentJobProgress?: number`
- `errorMessage?: string`
- `scriptCharacterIndex?: number`
- `referencePhotos?: ReadonlyArray<{ url: string; kind: ReferencePhotoKind }>`
- `seedPrompt?: string`
- `canonicalDescription?: string`
- `realLifeRefsByVariant?: Readonly<Record<string, ReadonlyArray<string>>>`
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
  "label": "Character",
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

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

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
    "label": "Character",
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
