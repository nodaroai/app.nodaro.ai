---
node_type: object
generated_at: 2026-06-07T18:49:01.962Z
generated_from: db2337ab
---

# Object

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `object`
**Category:** object
**Credit cost:** 5
**Inputs (target handles):** `in`
**Outputs (source handles):** `objectRef`

**Required data fields:**
- `label: string`
- `objectDbId: string`
- `objectName: string`
- `description: string`
- `category: "furniture" | "vehicle" | "weapon" | "food" | "clothing" | "electronics" | "nature" | "tool" | "animal" | "other"`
- `style: "realistic" | "anime" | "3d-pixar" | "illustration"`
- `sourceImageUrl: string`
- `projectId: string`
- `createdAt: string`
- `executionStatus: "idle" | "running" | "completed" | "failed"`
- `generatedResults: GeneratedResult[]`
- `activeResultIndex: number`
- `fieldMappings: FieldMappings`
- `angles: ObjectAssetItem[]`
- `materials: ObjectAssetItem[]`
- `variations: ObjectAssetItem[]`
- `anglesStatus: "idle" | "running" | "completed" | "failed"`
- `materialsStatus: "idle" | "running" | "completed" | "failed"`
- `variationsStatus: "idle" | "running" | "completed" | "failed"`
- `customVariations: Array<{ prompt: string; url: string; createdAt: string }>`
- `motionClips: ObjectAssetItem[]`
- `motionStatus: AssetStatus`
- `referencePhotos: ObjectReferencePhoto[]`
- `canonicalDescription: string`
- `styleLock: boolean`

**Optional data fields:**
- `provider?: string`
- `animalId?: string`
- `vehicleId?: string`
- `furnitureId?: string`
- `weaponId?: string`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `sheets?: ReferenceSheet[]`
- `detailCloseups?: ObjectAssetItem[]`
- `defaultAssetUrl?: string`
- `defaultAssetName?: string`
- `updatedAt?: string`
- `legacyPickerSelection?: {
    kind: "animal" | "vehicle" | "furniture" | "weapon"
    id: string
  } | null`
- `pipeline_id?: string`
- `pipeline_entity_id?: string`
- `pipeline_owned?: boolean`
- `pipeline_state?: PipelineState`
- `is_stale?: boolean`

**Default data:**
```json
{
  "label": "Object",
  "objectDbId": "",
  "objectName": "",
  "description": "",
  "category": "other",
  "style": "realistic",
  "sourceImageUrl": "",
  "projectId": "",
  "createdAt": "",
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0,
  "fieldMappings": {},
  "angles": [],
  "materials": [],
  "variations": [],
  "anglesStatus": "idle",
  "materialsStatus": "idle",
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
  "id": "object-1",
  "type": "object",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Object",
    "objectDbId": "",
    "objectName": "",
    "description": "",
    "category": "other",
    "style": "realistic",
    "sourceImageUrl": "",
    "projectId": "",
    "createdAt": "",
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0,
    "fieldMappings": {},
    "angles": [],
    "materials": [],
    "variations": [],
    "anglesStatus": "idle",
    "materialsStatus": "idle",
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
