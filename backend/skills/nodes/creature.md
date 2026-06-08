---
node_type: creature
generated_at: 2026-06-08T17:01:14.843Z
generated_from: bacc5721
---

# Animal/Creature

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `creature`
**Category:** creature
**Credit cost:** 5
**Inputs (target handles):** `in`
**Outputs (source handles):** `creatureRef`

**Required data fields:**
- `label: string`
- `creatureDbId: string`
- `creatureName: string`
- `description: string`
- `category: string`
- `style: "realistic" | "anime" | "3d-pixar" | "illustration"`
- `sourceImageUrl: string`
- `projectId: string`
- `createdAt: string`
- `executionStatus: "idle" | "running" | "completed" | "failed"`
- `generatedResults: GeneratedResult[]`
- `activeResultIndex: number`
- `fieldMappings: FieldMappings`
- `angles: ObjectAssetItem[]`
- `poses: ObjectAssetItem[]`
- `variations: ObjectAssetItem[]`
- `anglesStatus: "idle" | "running" | "completed" | "failed"`
- `posesStatus: "idle" | "running" | "completed" | "failed"`
- `variationsStatus: "idle" | "running" | "completed" | "failed"`
- `customVariations: Array<{ prompt: string; url: string; createdAt: string }>`
- `motionClips: ObjectAssetItem[]`
- `motionStatus: AssetStatus`
- `referencePhotos: ObjectReferencePhoto[]`
- `canonicalDescription: string`
- `styleLock: boolean`

**Optional data fields:**
- `species?: string`
- `provider?: string`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `sheets?: ReferenceSheet[]`
- `detailCloseups?: ObjectAssetItem[]`
- `defaultAssetUrl?: string`
- `defaultAssetName?: string`
- `updatedAt?: string`
- `pipeline_id?: string`
- `pipeline_entity_id?: string`
- `pipeline_owned?: boolean`
- `pipeline_state?: PipelineState`
- `is_stale?: boolean`

**Default data:**
```json
{
  "label": "Animal/Creature",
  "creatureDbId": "",
  "creatureName": "",
  "description": "",
  "species": "",
  "category": "",
  "style": "realistic",
  "sourceImageUrl": "",
  "projectId": "",
  "createdAt": "",
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0,
  "fieldMappings": {},
  "angles": [],
  "poses": [],
  "variations": [],
  "anglesStatus": "idle",
  "posesStatus": "idle",
  "variationsStatus": "idle",
  "customVariations": [],
  "motionClips": [],
  "motionStatus": "idle",
  "referencePhotos": [],
  "canonicalDescription": "",
  "styleLock": true
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
  "id": "creature-1",
  "type": "creature",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Animal/Creature",
    "creatureDbId": "",
    "creatureName": "",
    "description": "",
    "species": "",
    "category": "",
    "style": "realistic",
    "sourceImageUrl": "",
    "projectId": "",
    "createdAt": "",
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0,
    "fieldMappings": {},
    "angles": [],
    "poses": [],
    "variations": [],
    "anglesStatus": "idle",
    "posesStatus": "idle",
    "variationsStatus": "idle",
    "customVariations": [],
    "motionClips": [],
    "motionStatus": "idle",
    "referencePhotos": [],
    "canonicalDescription": "",
    "styleLock": true
  }
}
```
<!-- AUTO-GEN:END examples -->
