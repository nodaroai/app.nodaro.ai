---
node_type: image-to-video
generated_at: 2026-06-10T20:57:26.693Z
generated_from: 2fc5e6fd3
---

# image-to-video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-to-video`
**Category:** ai
**Credit cost:** 20
**Inputs (target handles):** `startFrame`, `endFrame`, `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: ImageToVideoProvider`
- `model: string`
- `duration: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `motion?: "subtle" | "moderate" | "dynamic"`
- `motionEnabled?: boolean`
- `prompt?: string`
- `negativePrompt?: string`
- `generateAudio?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive" | "Auto"`
- `multiShot?: boolean`
- `resolution?: string`
- `grokMode?: "fun" | "normal" | "spicy"`
- `videoSize?: "standard" | "high"`
- `seed?: number`
- `cameraFixed?: boolean`
- `shots?: Array<{ prompt: string; duration: number }>`
- `elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>`
- `webSearch?: boolean`
- `nsfwChecker?: boolean`
- `videoTrimStart?: number`
- `videoTrimEnd?: number`
- `attachReferenceVideoVariant?: string`
- `loopTrim?: {
    enabled: boolean
    framesToTest?: number
    quality?: "lossless" | "precise"
  }`
- `enableTranslation?: boolean`
- `selectedStartFrameNodeId?: string`
- `selectedEndFrameNodeId?: string`
- `selectedAudioNodeId?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `kieTaskId?: string`
- `connectedImageOrder?: readonly string[]`
- `connectedRefImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `veoMode?: "frame-to-frame" | "reference"`
- `seedance2InputMode?: "frames" | "references"`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Image to Video",
  "provider": "seedance-2-fast",
  "duration": 5,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `animate_image`

**Input parameters:**
- `prompt`
- `image_url`
- `image_asset_id`
- `model`
- `duration`
- `aspect_ratio`
- `resolution`
- `sound`
- `end_frame_url`
- `end_frame_asset_id`
- `reference_image_urls`
- `reference_video_urls`
- `reference_audio_urls`
- `seedance2_input_mode`
- `loop_trim`
- `auto_loop_trim`
<!-- AUTO-GEN:END mcp-call -->

## When to use

Animate a still image into a short video clip (5-15s typical). For multi-shot films, animate sequentially — each shot's end frame anchors the next shot's start frame.

## Common gotchas

- Field name is `generatedVideoUrl`, NOT `generatedImageUrl`. Using the image field name on a video node renders a blank placeholder.
- Seedance 2 (`seedance-2-fast`, `seedance-2`) always runs in multishot mode: pass `multishot: true`, `disable_internal_music: true`, `allow_sfx: true` to the MCP call.
- Veo / Veo 3.1 use fixed 8-second duration — the `duration` config field is ignored; the response is always 8s.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "image-to-video-1",
  "type": "image-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Image to Video",
    "provider": "seedance-2-fast",
    "duration": 5,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->

<!-- AUTO-GEN:START provider-prompting -->
## Provider prompting doctrine

Model-family-specific prompting rules. Apply the section matching the node's `provider`.

### Seedance 2.0 (seedance-2, seedance-2-fast)

Prompt structure (front-load what matters most):
precise subject → action details → scene/environment → lighting & color tone → camera movement → visual style → image quality → constraints.

**Shots & pacing**
- Storyboard complex videos as "Shot 1: … Shot 2: … Shot 3: …" in event order. Do NOT attach timestamps (e.g. "(0-3s)") — precise-timing support is officially unstable and forcing durations can break generation; let the model pace naturally.
- Per shot cover, in order: camera move or transition, subject action + expression, spatial/position change, audio for that shot.
- One camera movement type per shot — never ask for push + pan + orbit at once (image instability).
- Prefer slow, gentle, continuous movements over high-burst action (sprints, big jumps, violent rolls morph). Describe actions per body part with quantified degree: "slowly raises a hand", "pushes hard off the ground". Chain actions with inertia: "uses the momentum of the turn to naturally raise an arm".
- Express emotion as externalized physical detail, never abstract words: not "very sad" but "lowering the head, shoulders trembling slightly, eyes reddening, fingers clutching the corner of clothing".

**References (when reference media is attached)**
- Refer to assets by ordinal in attachment order: "@Image 1", "Video 2", "Audio 1". Asset ORDER is priority — put the most identity-critical asset first.
- Define each subject once, then reuse the label consistently: 'Define the woman in the red dress in Image 1 as the courier' … 'the courier opens the door'. In multi-character scenes bind every character to its image ("the man from Image 1 hands the box to the woman from Image 2") and append: "do not generate duplicate copies of the same character".
- Character identity: ONE close-up headshot + ONE full-body image is ideal. Do NOT attach multi-view/three-view character sheets — the model reads the views as separate people, causing identity drift and twin duplicates.
- 4-5 assets total works best (1-2 character images + 1 scene image + 1 camera-movement video + 1 audio clip). Maxing out the 9-image/3-video/3-audio limits degrades feature priority and adherence.
- Editing/extension instructions name clips directly: "Extend Video 1 backward…", "Remove the chair from Video 1". Saying "reference Video 1" flips the model into reference mode and breaks the edit. Track completion: "Video 1 + [transition description] + followed by Video 2" (≤3 clips, ≤15s total).

**Audio (native multi-track: music + ambience + voice, stereo)**
- Cue the layers separately with the official symbols: full-width parentheses for music （slow jazz piano in the background）, angle brackets for sound effects <rain tapping on glass>, and dialogue as quoted speech: the man says "It's not that bad". Seedance also accepts curly-brace dialogue, but on Nodaro curly braces are reserved for prompt variables — always use quotes for dialogue here.
- Mark the language for non-English/Chinese dialogue ("says in Japanese …").
- With a reference voice attached, also describe the timbre in words: "the low, warm, finely grainy middle-aged male voice of Audio 1".

**Quality & constraints**
- Quality tail: "HD, rich details, cinematic texture, natural colors, stable picture."
- Anti-junk constraints (these official templates ARE negative-form): "keep it subtitle-free", "avoid generating any text or subtitles", "do not generate a watermark", "do not generate a logo". Landscape output is markedly less subtitle-prone than portrait — generate 16:9 and crop when portrait text-safety matters.
- There is NO negative-prompt parameter on Seedance — all constraints belong in the prompt text itself.

**Known weaknesses → workarounds**
- Text rendering is weak: keep on-screen text to short common words; for exact text or logos, attach the artwork as a reference image and instruct "the logo from Image N stays in the corner unchanged".
- More than 4 referenced people gets unstable: group people into composite images of ≤4 first (image generation), then reference those composites.
- Repeated extension degrades quality: prefer high-definition reference assets and avoid stacking many continuations.

_Generated from `PROVIDER_PROMPT_DOCTRINES` in `@nodaro/shared` — edit there, then `npm run gen:skills`._
<!-- AUTO-GEN:END provider-prompting -->
