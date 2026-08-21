---
node_type: slideshow
generated_at: 2026-08-21T00:36:17.389Z
generated_from: 23b00a372
---

# Slideshow

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `slideshow`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `images`, `audio`, `transition`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `perImageDuration: number`
- `transitionDuration: number`
- `motion: "none" | "zoom-in" | "zoom-out" | "ken-burns" | "alternate"`
- `intensity: number`
- `resolution: "720p" | "1080p" | "4K"`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:3"`
- `fps: 24 | 30`
- `fit: "cover" | "contain"`
- `padColor: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `lastScaleFactor?: number`
- `lastAppliedTransition?: string`
- `lastSlideCount?: number`
- `lastSilent?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Slideshow",
  "perImageDuration": 3,
  "transitionDuration": 0.5,
  "motion": "none",
  "intensity": 3,
  "resolution": "1080p",
  "aspectRatio": "16:9",
  "fps": 30,
  "fit": "cover",
  "padColor": "#000000",
  "fieldMappings": {}
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
  "id": "slideshow-1",
  "type": "slideshow",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Slideshow",
    "perImageDuration": 3,
    "transitionDuration": 0.5,
    "motion": "none",
    "intensity": 3,
    "resolution": "1080p",
    "aspectRatio": "16:9",
    "fps": 30,
    "fit": "cover",
    "padColor": "#000000",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
