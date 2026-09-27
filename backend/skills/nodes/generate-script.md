---
node_type: generate-script
generated_at: 2026-09-27T10:38:39.153Z
generated_from: bf4f83575
---

# Generate Script

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-script`
**Category:** ai
**Credit cost:** `10-30` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `prompt`, `field-tone`, `field-styleGuide`, `field-sceneCount`, `field-targetLength`
**Outputs (source handles):** `scenes`, `images`, `dialogue`, `music`, `sfx`, `characters`, `locations`

**Required data fields:**
- `label: string`
- `provider: ScriptProvider`
- `model: string`
- `sceneCount: number`
- `styleGuide: string`
- `structure: "freeform" | "8-step" | "custom"`
- `tone: string`
- `targetLength: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedScript?: GeneratedScript`
- `generatedResults?: GeneratedScriptResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Generate Script",
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "sceneCount": 5,
  "styleGuide": "",
  "structure": "freeform",
  "tone": "",
  "targetLength": 60,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Turns a topic into a structured, scene-by-scene script (visuals, action, dialogue, image prompt per scene). The topic comes from a Text node (or any text output) wired into `prompt`, or from `data.prompt`.

Four settings inputs set one panel field each at run time, over the typed value:
- `field-tone` — a `tone` node or any text → `tone` (cut to 200 characters).
- `field-styleGuide` — a `style-guide` node or any text → `styleGuide` (sent with the topic; `{Node Label}` references resolve).
- `field-sceneCount` — a `scene-count` node → `sceneCount` (a whole number, clamped to 1–20).
- `field-targetLength` — a `duration` node → `targetLength` (seconds, clamped to 5–600).

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_script`

**Input parameters:**
- `prompt`
- `scene_count`
- `tone`
- `target_duration`
- `model`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- A run with no topic is refused before anything is billed (`prompt_required`). A Tone or Style Guide node is not a topic.
- Wire settings nodes into their `field-*` input, not into `prompt`: parameter nodes wired into `prompt` never become the topic.
- `structure` (freeform / 8-step / custom) is stored but not used by the generator.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "generate-script-1",
  "type": "generate-script",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Script",
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "sceneCount": 5,
    "styleGuide": "",
    "structure": "freeform",
    "tone": "",
    "targetLength": 60,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
