# Generate-Script Multi-Handle Output + Downstream Auto-Population

## Context

The generate-script node produces rich per-scene data (cinematography, location, mood, characters, dialogue, musicMood, soundEffects, imagePrompt) but currently only exposes a single `scenes` handle that outputs the first scene's `imagePrompt` as text. All structured data is locked inside the node.

The sora-storyboard integration (shipped in PR #808) only uses `visualDescription` and `durationHint` from the script, discarding cinematography, location, mood, and other fields.

This design adds 6 new typed output handles to generate-script, enabling explicit wiring to downstream nodes that auto-populate from the script's structured data.

## Design

### Part 1: Enriched Sora Storyboard Prompts

When auto-filling storyboard shots from script (execution-time auto-fill and "Fill from Script" button), build a richer Scene string by appending cinematography, location, and mood to `visualDescription`:

```
{visualDescription}. Camera: {shotType} {cameraAngle} with {cameraMovement}. Setting: {location.name}, {timeOfDay}. Mood: {mood}
```

Only appends fields that exist. No backend/API changes -- just a better string going into the existing KIE `Scene` field.

**Shared utility**: Extract the prompt-building logic into `packages/shared/src/prompt-builder.ts` as `buildEnrichedScenePrompt(scene): string`. Define a local interface for the scene parameter (matching the existing pattern in `prompt-builder.ts` which defines its own `SceneData`, `BuildImagePromptConfig` etc. rather than importing frontend types). This avoids duplicating the template across frontend execute-node.ts, backend payload-builder.ts, and frontend video-configs.tsx.

### Part 2: New Output Handles on Generate-Script

Generate-script gets 6 new output handles alongside the existing `scenes` handle:

| Handle | Data Shape | Purpose |
|--------|-----------|---------|
| `scenes` (existing) | string | First scene's imagePrompt (backward compatible) |
| `images` | string[] | `imagePrompt` per scene -- feeds Generate Image in list mode |
| `dialogue` | `{ speaker, text, emotion }[]` | All dialogue lines across scenes -- feeds Text-to-Dialogue |
| `music` | string | Deduplicated `musicMood` values joined with ", " (empty values skipped) |
| `sfx` | string | `soundEffects` flattened and joined with ", " across all scenes |
| `characters` | `ScriptSceneCharacter[]` | Deduplicated by name (first occurrence wins) across all scenes |
| `locations` | `ScriptSceneLocation[]` | Deduplicated by name (first occurrence wins) across all scenes |

**Character deduplication**: Key by lowercase `name`. First occurrence of each name wins for `description`, `mood`, `action`, `position`. Old scripts may have `characters` as `string[]` instead of `ScriptSceneCharacter[]` -- when a plain string is encountered, wrap it as `{ name: string, description: "" }`.

**Location deduplication**: Key by lowercase `name`. First occurrence wins.

**Node definition change**: Add 6 outputs to `NODE_DEFINITIONS` for `generate-script`: `outputs: ["scenes", "images", "dialogue", "music", "sfx", "characters", "locations"]`.

**Node component** (`generate-script-node.tsx`): Add 6 new `<Handle>` elements (right side) below the existing `scenes` handle. Each labeled with its type name.

### Part 3: Structured Data Flow -- Bypass Output Extractors

The existing `extractNodeOutput()` (frontend) and `getPrimaryOutput()` (backend) return `string | undefined`. Structured handles (arrays, objects) don't fit this return type.

**Approach**: Input resolvers read structured data directly from node state/data, bypassing the output extractor entirely. This matches the existing `scriptData` passthrough pattern (PR #808) where the input resolver reads `src.data.generatedScript` directly.

**Frontend** (`node-input-resolver.ts`): When `src.type === "generate-script"`, check `srcEdge.sourceHandle`:
- `"scenes"` or null/undefined: set `inputs.prompt = output` (unchanged)
- `"images"`: read active script from `src.data`, collect `imagePrompt` per scene, set `inputs.prompt` as newline-joined string (for list detection -- see Part 5)
- `"dialogue"`: read active script, flatten all `scene.dialogue[]` across scenes, set `inputs.dialogueLines`
- `"music"`: read active script, deduplicate non-empty `musicMood` values, join with ", ", set `inputs.prompt`
- `"sfx"`: read active script, flatten all `soundEffects[]` across scenes, join with ", ", set `inputs.prompt`
- `"characters"`: read active script, deduplicate characters by name, set `inputs.scriptCharacters`
- `"locations"`: read active script, deduplicate locations by name, set `inputs.scriptLocations`
- Any handle → `sora-storyboard` target: also set `inputs.scriptData` (existing behavior)

**Backend** (`input-resolver.ts`): The backend uses a `routeOutput()` function with `Set`-based dispatch. `generate-script` is currently in `TEXT_SOURCE_NODE_TYPES`. The new sourceHandle-based routing must be placed as a dedicated block **before** the `TEXT_SOURCE_NODE_TYPES` catch-all (expanding the existing `generate-script -> sora-storyboard` special case at the top of `routeOutput()` into a full sourceHandle router). Uses `nodeStates[src.id].output.script` instead of `src.data`.

**Helper function**: Extract "get active script from generate-script node data" into a shared inline helper used by both the input resolver and the config panel. Pattern: `scriptResults[activeIndex]?.script ?? generatedScript`.

New fields on `FrontendResolvedInputs` and backend `ResolvedInputs`:
- `dialogueLines?: Array<{ speaker: string; text: string; emotion?: string }>`
- `scriptCharacters?: Array<{ name: string; description: string; mood?: string; action?: string; position?: string }>`
- `scriptLocations?: Array<{ name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }>`

### Part 4: Entity Auto-Population with Dropdown

**Character node**: When connected to generate-script's `characters` handle, the config panel shows a dropdown "From script: [Maya / Leo / Sam]" populated from `sources` array (reading `scriptCharacters` from the connected source's node data).

- New field `scriptCharacterIndex?: number` on `CharacterNodeData`
- On dropdown selection, auto-fills `name`, `description`, `visual_traits` from the selected character
- User can override any field manually after auto-fill
- Dropdown only visible when a `generate-script` source is connected via `characters` handle
- If no selection made, node works normally (manual entry)
- **Stale selection**: If the script is re-generated and character names change, the index may point to a different character. The dropdown shows the current character name at that index so the user sees the mismatch and can re-select. This is config-panel-time only -- no auto-fill happens during execution.

**Location node**: Same pattern.

- New field `scriptLocationIndex?: number` on `LocationNodeData`
- Dropdown: "From script: [Dark alley / Rooftop bar]"
- Auto-fills `name`, `description` (with timeOfDay/weather/lighting appended to description)
- Dropdown only visible when a `generate-script` source is connected via `locations` handle

**Execution behavior**: Character and Location nodes are source nodes (no execution). Their data is read as-is by downstream nodes. The dropdown auto-fill writes to node data at config-panel time; execution just reads whatever is stored.

### Part 5: Image Handle -> List Mode

The `images` handle connected to generate-image triggers list execution:

**Problem**: The existing list infrastructure (`getListInputForNode` / `extractNodeOutputAsList`) only recognizes `list`, `loop`, and `split-text` as list sources. `generate-script` is not detected.

**Solution**: Add `generate-script` to list detection in `getListInputForNode()` only (which has edge access and can check `sourceHandle`). `extractNodeOutputAsList()` does not have a `sourceHandle` parameter and is not modified.

- In `getListInputForNode()` (frontend and backend): when an incoming edge has `sourceHandle === "images"` and source type is `generate-script`, read the active script's scenes and return `imagePrompt[]` as the list items (length > 1 triggers list mode).
- Note: a single-scene script produces a 1-item list, which does NOT trigger list execution (existing `length > 1` guard). This is expected — single-scene scripts run as normal single execution.

This runs N times (once per scene) using existing `executeNodeForList()`. No other list machinery changes needed.

### Part 6: Dialogue Handle -> Text-to-Dialogue

The `dialogue` handle feeds the text-to-dialogue node via a "Fill from Script" config panel button (same pattern as sora-storyboard). No execution-time auto-population — `dialogue` is a primary user-editing field and adding it to `EXECUTION_DATA_KEYS` would break undo for manual edits.

**Type mapping** (`ScriptSceneDialogue` -> `DialogueLine`):
- `speaker` -> stored as `voiceLabel` (display name for the voice)
- `text` -> `text`
- `emotion` -> not mapped (DialogueLine has no emotion field; emotion is conveyed through text/voice selection)
- `voice` (ElevenLabs voice ID) -> left empty, user assigns manually
- `id` -> auto-generated UUID

**Config panel** (`audio-configs.tsx` text-to-dialogue section): When a `generate-script` source is connected via `dialogue` handle and has generated results, show a "Fill N Lines from Script" button (Wand2 icon, same style as storyboard). On click, maps `ScriptSceneDialogue[]` to `DialogueLine[]` using the type mapping above and writes to node data.

**Execution behavior**: During execution, `inputs.dialogueLines` is available but only used if the node's own `dialogue` array is empty (auto-fill as fallback, same as storyboard shots). The node data is NOT written during execution — the auto-filled lines are passed directly to the API call.

## Files Impact

| Area | Files | Change |
|------|-------|--------|
| Shared utility | `packages/shared/src/prompt-builder.ts` | `buildEnrichedScenePrompt()` function |
| Node types | `frontend/src/types/nodes.ts` | New outputs in NODE_DEFINITIONS for generate-script; `scriptCharacterIndex` on CharacterNodeData; `scriptLocationIndex` on LocationNodeData |
| Node component | `frontend/src/components/nodes/generate-script-node.tsx` | 6 new Handle elements with labels |
| Frontend input resolver | `frontend/src/components/editor/workflow-editor/node-input-resolver.ts` | Route by sourceHandle for generate-script; new input fields; list detection for `images` handle |
| Backend input resolver | `backend/src/services/workflow-engine/input-resolver.ts` | Same routing by sourceHandle; list detection |
| Frontend execution | `frontend/src/components/editor/workflow-editor/execute-node.ts` | Enriched storyboard prompts (via shared util); dialogue auto-population from `inputs.dialogueLines` |
| Backend payload builder | `backend/src/services/workflow-engine/payload-builder.ts` | Enriched storyboard prompts (via shared util) |
| Config panels | `frontend/src/components/editor/config-panels/video-configs.tsx` | Enriched "Fill from Script" (via shared util) |
| Config panels | `frontend/src/components/editor/config-panels/entity-configs.tsx` | Character/Location dropdown from script |
| Config panels | `frontend/src/components/editor/config-panels/audio-configs.tsx` | "Fill from Script" button on text-to-dialogue |
| Resolved input types | `frontend/.../node-input-resolver.ts`, `backend/.../types.ts` | New fields: `dialogueLines`, `scriptCharacters`, `scriptLocations` |

**No changes to**: backend routes, database, credits, new node types.

**No changes to output extractors**: `extractNodeOutput()` (frontend) and `getPrimaryOutput()` / `extractSavedNodeOutput()` (backend) remain unchanged. Structured data flows through input resolvers reading node state directly.

## Verification

1. Connect generate-script -> sora-storyboard via existing `scenes` handle -> verify existing behavior unchanged
2. Connect generate-script `images` handle -> generate-image -> verify list execution creates one image per scene
3. Connect generate-script `dialogue` handle -> text-to-dialogue -> verify dialogue lines auto-populate with speaker names as voice labels
4. Connect generate-script `music` handle -> generate-music -> verify prompt filled with deduplicated musicMood values
5. Connect generate-script `sfx` handle -> text-to-audio -> verify prompt filled with joined soundEffects
6. Connect generate-script `characters` handle -> 2 Character nodes -> verify dropdown shows script characters, selecting one auto-fills fields
7. Connect generate-script `locations` handle -> Location node -> verify dropdown and auto-fill
8. Run full pipeline: generate-script -> storyboard with enriched prompts -> verify richer Scene strings sent to KIE
9. Edge case: script with 0 scenes -> all handles produce empty/no output, downstream nodes behave as if unconnected
10. Edge case: script with missing optional fields (no dialogue, no location, no musicMood) -> handles produce empty strings/arrays, no errors
11. Edge case: old script with `characters` as `string[]` -> wrapped as `{ name, description: "" }` in dropdown
12. Backward compatibility: existing workflows with `scenes` handle edges continue to work unchanged
13. Backend orchestrator parity: run same workflow via backend execution, compare results to frontend DAG
14. `npx tsc --noEmit` in both frontend and backend
