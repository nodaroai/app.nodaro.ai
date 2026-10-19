---
node_type: camera-switch
generated_at: 2026-10-19T11:19:54.565Z
generated_from: 87f6d3095
---

# Camera Switch

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `camera-switch`
**Category:** processing
**Credit cost:** `11` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `edl`, `transcript`, `speakerMap`
**Outputs (source handles):** `edl`, `transcript`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `speakerMap?: Record<string, string>`
- `speakerMapByOrder?: Record<string, string>`
- `speakerNames?: Record<string, string>`
- `minShotMs?: number`
- `leadMs?: number`
- `maxShotMs?: number`
- `wideEvery?: number`
- `layoutHints?: boolean`
- `edl?: unknown`
- `transcript?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: { edl?: unknown; transcript?: unknown }`

**Default data:**
```json
{
  "label": "Camera Switch",
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Put each cut of a multicam edit on the camera of whoever is speaking. Wire an Edit Plan EDL into `edl` and a Transcribe result with speaker detection into `transcript`; Apply EDL renders the switched edit.

Each speaker's camera is decided in this order: a camera set in `data.speakerMap` (or `data.speakerMapByOrder`) wins, then a Speaker Map wired into the `speakerMap` input, then speaker n → camera n.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- `speakerMap` is two different things. The **input handle** `speakerMap` takes a wire from Speaker Map's `json` output (the whole result: `{ version, speakerMap, confidence, notes, edl? }`). The **data field** `data.speakerMap` is the hand-set table: speaker label → EDL source id, `""` = no camera of their own (the wide shot). Never write a Speaker Map result into `data.speakerMap`; wire it.
- A wired `speakerMap` that has not run yet, or that carries something other than a Speaker Map result, refuses the run.
- The `speakerMap` input is offered in the editor only where Speaker Map is enabled; a wire to it in the workflow JSON still runs.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "camera-switch-1",
  "type": "camera-switch",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Camera Switch",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
