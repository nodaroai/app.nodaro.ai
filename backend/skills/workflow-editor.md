---
generated_at: 2026-05-24T21:24:58.561Z
generated_from: bda59987
---

# Nodaro Workflow Editor — General Patterns

Call this skill BEFORE building or editing any Nodaro workflow via `update_workflow_json` or `create_workflow`. It teaches the JSON shape, edge wiring, and the catalog of available node types you can request per-node skills for.

## Workflow JSON shape

A workflow is a React Flow graph stored on a `workflows` row. The full shape:

```json
{
  "nodes": [
    { "id": "n1", "type": "<node-type>", "position": { "x": 0, "y": 0 }, "data": { "label": "...", "...": "..." } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "sourceHandle": "<output-handle>", "target": "n2", "targetHandle": "<input-handle>" }
  ]
}
```

- **`id`** — unique within the workflow. Kebab-case or any string you control. Don't reuse.
- **`type`** — kebab-case node type (e.g., `generate-image`, NOT `generateImage` or `GenerateImage`). See the catalog below.
- **`position.x`, `position.y`** — canvas pixel coordinates. Lay nodes out left-to-right with `x` increasing by ~340 per stage and `y` separating sibling rows by ~280.
- **`data`** — node-type-specific payload. Call `get_node_skill(<type>)` for the exact required + optional fields per type.

## Edge wiring conventions

Every edge connects a SOURCE node's output handle to a TARGET node's input handle:

```json
{ "id": "e1", "source": "n1", "sourceHandle": "image", "target": "n2", "targetHandle": "in" }
```

- **`sourceHandle`** — must match one of the source node's published output handles. Per-node skill content lists the canonical handles. Common shorthand: `generate-image` → `"image"`, `image-to-video` → `"video"`, `generate-music` → `"audio"`.
- **`targetHandle`** — must match one of the target node's input handles. Most generation nodes accept `"in"` as the default input. Specialized handles: `image-to-video` exposes `"startFrame"`, `"endFrame"`, `"audio"`.
- **Loop (Table) node columns** — each column on a `loop` node exposes its own source handle named `col_<column_id>`. Wire `sourceHandle: "col_<id>"` to fan out a column's values into a downstream node. Omitting `sourceHandle` connects to the default output, which usually isn't what you want.

## update_workflow_json contract

`update_workflow_json(workflow_id, workflow, expected_updated_at?)` overwrites the workflow's full graph (nodes + edges). Use it after each approved stage to attach new content to the user's canvas — the user watches it assemble during conversation.

- **`workflow_id`** — UUID from `create_workflow`.
- **`workflow`** — the full `{ nodes, edges }` object. You must include ALL existing nodes + the new ones (no partial diff support).
- **`expected_updated_at`** — optional optimistic concurrency token. Pass the `updated_at` you got from the previous `get_workflow` call to detect races.

Read the current workflow with `get_workflow_json(workflow_id)` before each update so you're appending to the latest state, not overwriting concurrent edits.

## Result-field contract (the single most-important rule)

Every node that produced a generated asset (`generate-image`, `image-to-video`, `generate-music`, `trim-video`, `combine-videos`, `merge-video-audio`) MUST set TWO fields on `data` for the asset to render on the canvas:

1. **`executionStatus: "completed"`** — string literal. Without it the node renders as pending.
2. **`generated<Type>Url: "<asset URL>"`** — exact field name per node type. See `get_node_skill(<type>)` for the canonical name (it's `generatedImageUrl` for image nodes, `generatedVideoUrl` for video nodes, `generatedAudioUrl` for music — NEVER `imageUrl`, `result.url`, etc.).

Optional but recommended: `generatedResults: [{ url, jobId, timestamp }]`, `activeResultIndex: 0`, `currentJobId`. Always include `fieldMappings: {}` on every node that has it in its data type (most do).

<!-- AUTO-GEN:START node-catalog -->
## Available node types

Call `get_node_skill(<type>)` for the full schema of any node type:

- `3d-title` — 3D Title
- `action-fx` — Action FX
- `add-captions` — Add Captions
- `adjust-volume` — Adjust Volume
- `aesthetic` — Aesthetic / Microtrend
- `after-effects` — After Effects
- `animal` — Animal
- `aspect-ratio` — Aspect Ratio
- `atmosphere` — Atmosphere
- `audio-isolation` — Voice Extractor
- `backdrop` — Backdrop
- `camera-format` — Camera / Film Stock
- `camera-motion` — Camera Motion
- `character` — Character
- `character-fx` — Character FX
- `collect` — Collect
- `color-look` — Color / Look
- `combine-audio` — Combine Audio
- `combine-text` — Combine Text
- `combine-videos` — Combine Videos
- `component` — Component
- `composite` — Composite
- `composition-effects` — Composition Effects
- `deduplicate` — Remove Duplicates
- `dubbing` — Dubbing
- `duration` — Duration
- `era` — Era / Period
- `exposure-settings` — Exposure Settings
- `extend-video` — Extend Video
- `extract-field` — Extract Field
- `extract-frame` — Extract Frame
- `face` — Face
- `face-swap` — Face Swap
- `facebook-post` — Facebook Post
- `fade-video` — Fade In/Out
- `filter-list` — Filter List
- `forced-alignment` — Forced Alignment
- `framing` — Framing
- `furniture` — Furniture
- `generate-image` — Generate Image
- `generate-mask` — Generate Mask
- `generate-music` — Generate Music
- `generate-script` — Generate Script
- `generative-pipeline` — Story → Video
- `group` — Group
- `held-prop` — Held Prop
- `image-critic` — Image Critic
- `image-to-text` — Describe Image
- `image-to-video` — Image to Video
- `instagram-post` — Instagram Post
- `instrumentation` — Instrumentation
- `json-process` — JSON Process
- `lens` — Lens
- `lighting` — Lighting
- `linkedin-post` — LinkedIn Post
- `lip-sync` — Lip Sync
- `list` — List
- `llm-chat` — Generate Text
- `location` — Location
- `loop` — Table
- `loop-subject` — Loop Subject
- `loop-video` — Loop Video
- `lottie-overlay` — Lottie Overlay
- `manual-edit` — Manual Edit
- `material` — Material
- `merge-lists` — Merge Lists
- `merge-video-audio` — Merge Video & Audio
- `mix-audio` — Mix Audio
- `modify-image` — Modify Image
- `mood` — Mood
- `motion` — Motion
- `motion-graphics` — Motion Graphics
- `motion-transfer` — Motion Transfer
- `music-genre` — Music Genre
- `music-mood` — Music Mood
- `object` — Object
- `person` — Person
- `photo-genre` — Photo Genre
- `photographer` — Photographer / Artist Style
- `pose` — Pose
- `post-process-effects` — Post-Process Effects
- `preview` — Preview
- `provider` — Provider
- `qa-check` — QA Check
- `reduce` — Reduce
- `reference-audio` — Reference Audio
- `remove-background` — Remove Background
- `render-quality` — Render Quality
- `render-video` — Render Video
- `resize-video` — Resize Video
- `router` — Router
- `rss-feed` — RSS Feed
- `save-to-storage` — Save to Storage
- `scene` — Scene
- `scene-count` — Scene Count
- `schedule-trigger` — Schedule Trigger
- `setting` — Setting
- `social-media-format` — Social Media Format
- `sort-list` — Sort List
- `speech-to-video` — Speech to Video
- `speed-ramp` — Adjust Speed
- `split-media` — Split Media
- `split-text` — Split Text
- `sticky-note` — Sticky Note
- `style` — Style
- `style-guide` — Style Guide
- `styling` — Styling
- `sub-workflow` — Sub-Workflow
- `sub-workflow-input` — Sub-Workflow Input
- `sub-workflow-output` — Sub-Workflow Output
- `suno-add-instrumental` — Suno Add Instrumental
- `suno-add-vocals` — Suno Add Vocals
- `suno-convert-wav` — Suno Convert WAV
- `suno-cover` — Suno Cover
- `suno-extend` — Suno Extend
- `suno-generate` — Suno Generate
- `suno-lyrics` — Suno Lyrics
- `suno-mashup` — Suno Mashup
- `suno-music-video` — Music Video
- `suno-replace-section` — Suno Replace Section
- `suno-separate` — Suno Separate
- `suno-style-boost` — Suno Style Boost
- `suno-upload-extend` — Suno Upload Extend
- `suno-voice` — Suno Voice
- `telegram-post` — Telegram Post
- `telegram-trigger` — Telegram Trigger
- `teleport-receive` — Teleport Receive
- `teleport-send` — Teleport Send
- `temporal` — Temporal
- `text-prompt` — Text Prompt
- `text-to-audio` — Text to Audio
- `text-to-dialogue` — Text to Dialogue
- `text-to-speech` — Text to Speech
- `text-to-video` — Text to Video
- `tiktok-post` — TikTok Post
- `tone` — Tone
- `transcode-video` — Transcode Video
- `transcribe` — Transcribe
- `transition` — Transition
- `trim-audio` — Trim Audio
- `trim-video` — Trim Video
- `upload-audio` — Upload Audio
- `upload-image` — Upload Image
- `upload-video` — Upload Video
- `upscale-image` — Upscale Image
- `vehicle` — Vehicle
- `video-composer` — Compose Video
- `video-to-video` — Video to Video
- `video-upscale` — Upscale Video
- `voice-changer` — Voice Changer
- `voice-character` — Voice Character
- `voice-delivery` — Voice Delivery
- `voice-design` — Voice Design
- `voice-remix` — Voice Remix
- `weapon` — Weapon
- `web-scrape` — Web Scrape
- `webhook-output` — Webhook Output
- `webhook-trigger` — Webhook Trigger
- `x-post` — X Post
- `youtube-upload` — YouTube Upload
- `youtube-video` — Video URL
<!-- AUTO-GEN:END node-catalog -->

## Common gotchas

- Node types are kebab-case in JSON (`generate-image`), not camelCase or PascalCase. The frontend silently drops unknown types.
- The `loop` type's UI label is "Table" — don't confuse it with `list` (single-column).
- An edge with no `sourceHandle` connects to the default node output. For column-aware fan-out from a `loop` node, you MUST set `sourceHandle: "col_<id>"`.
- `update_workflow_json` overwrites — always merge new nodes into the existing graph, never replace it.
- The catalog above auto-generates. If a node type you expect to find isn't here, run `npm run gen:skills` from `backend/`.
