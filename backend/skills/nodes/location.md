---
node_type: location
generated_at: 2026-06-04T12:41:29.043Z
generated_from: 9bf1388db
---

# Location

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `location`
**Category:** location
**Credit cost:** 5
**Inputs (target handles):** `in`
**Outputs (source handles):** `locationRef`

**Required data fields:**
- `label: string`
- `locationDbId: string`
- `locationName: string`
- `description: string`
- `category: "indoor" | "outdoor" | "urban" | "nature" | "fantasy" | "sci-fi" | "historical" | "futuristic" | "other"`
- `style: "realistic" | "anime" | "3d-pixar" | "illustration"`
- `sourceImageUrl: string`
- `projectId: string`
- `createdAt: string`
- `executionStatus: "idle" | "running" | "completed" | "failed"`
- `generatedResults: GeneratedResult[]`
- `activeResultIndex: number`
- `fieldMappings: FieldMappings`
- `timeOfDay: LocationAssetItem[]`
- `weather: LocationAssetItem[]`
- `angles: LocationAssetItem[]`
- `lighting: LocationAssetItem[]`
- `lightingStatus: AssetStatus`
- `seasons: LocationAssetItem[]`
- `seasonsStatus: AssetStatus`
- `atmosphereMotions: LocationAssetItem[]`
- `atmosphereStatus: AssetStatus`
- `referencePhotos: LocationReferencePhoto[]`
- `canonicalDescription: string`
- `styleLock: boolean`
- `timeOfDayStatus: "idle" | "running" | "completed" | "failed"`
- `weatherStatus: "idle" | "running" | "completed" | "failed"`
- `anglesStatus: "idle" | "running" | "completed" | "failed"`
- `customVariations: Array<{ prompt: string; url: string; createdAt: string }>`

**Optional data fields:**
- `updatedAt?: string`
- `provider?: string`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `scriptLocationIndex?: number`
- `piiConsentAt?: string`
- `selectedVariant?: string`
- `pipeline_id?: string`
- `pipeline_entity_id?: string`
- `pipeline_owned?: boolean`
- `pipeline_state?: PipelineState`
- `is_stale?: boolean`

**Default data:**
```json
{
  "label": "Location",
  "locationDbId": "",
  "locationName": "",
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
  "timeOfDay": [],
  "weather": [],
  "angles": [],
  "lighting": [],
  "lightingStatus": "idle",
  "seasons": [],
  "seasonsStatus": "idle",
  "atmosphereMotions": [],
  "atmosphereStatus": "idle",
  "referencePhotos": [],
  "canonicalDescription": "",
  "styleLock": true,
  "timeOfDayStatus": "idle",
  "weatherStatus": "idle",
  "anglesStatus": "idle",
  "customVariations": []
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
  "id": "location-1",
  "type": "location",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Location",
    "locationDbId": "",
    "locationName": "",
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
    "timeOfDay": [],
    "weather": [],
    "angles": [],
    "lighting": [],
    "lightingStatus": "idle",
    "seasons": [],
    "seasonsStatus": "idle",
    "atmosphereMotions": [],
    "atmosphereStatus": "idle",
    "referencePhotos": [],
    "canonicalDescription": "",
    "styleLock": true,
    "timeOfDayStatus": "idle",
    "weatherStatus": "idle",
    "anglesStatus": "idle",
    "customVariations": []
  }
}
```
<!-- AUTO-GEN:END examples -->
