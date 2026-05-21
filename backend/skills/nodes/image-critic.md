---
node_type: image-critic
generated_at: 2026-05-21T12:08:16.232Z
generated_from: 34a5d237
---

# Image Critic

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-critic`
**Category:** ai
**Credit cost:** 5
**Inputs (target handles):** `image`, `reference`, `prompt`
**Outputs (source handles):** `approved`, `rejected`

**Required data fields:**
- `label: string`
- `mode: ImageCriticMode`
- `threshold: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `prompt?: string`
- `llmModel?: string`
- `currentJobId?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `score?: number`
- `approved?: boolean`
- `feedback?: string`
- `details?: {
    perMode?: Partial<Record<Exclude<ImageCriticMode, "all">, { score: number; feedback: string }>>
    issues?: Array<{ category: string; severity: "blocking" | "warning" | "info"; description: string }>
  }`

**Default data:**
```json
{
  "label": "Image Critic",
  "mode": "realism",
  "threshold": 0.7,
  "prompt": "",
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
  "id": "image-critic-1",
  "type": "image-critic",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Image Critic",
    "mode": "realism",
    "threshold": 0.7,
    "prompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
