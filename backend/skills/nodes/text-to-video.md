---
node_type: text-to-video
generated_at: 2026-07-16T15:25:02.751Z
generated_from: be2cab0e0
---

# Text to Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-video`
**Category:** ai
**Credit cost:** 25
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: TextToVideoProvider`
- `duration: number`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "4:5" | "5:4" | "21:9" | "9:21" | "adaptive"`
- `negativePrompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `seed?: number`
- `enableTranslation?: boolean`
- `resolution?: string`
- `generateAudio?: boolean`
- `webSearch?: boolean`
- `nsfwChecker?: boolean`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `kieTaskId?: string`
- `connectedRefImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Text to Video",
  "prompt": "",
  "provider": "seedance-2-fast",
  "duration": 5,
  "negativePrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_video`

**Input parameters:**
- `prompt`
- `presetId`
- `model`
- `duration`
- `aspect_ratio`
- `resolution`
- `sound`
- `negative_prompt`
- `seed`
- `structured`
- `connected_references`
- `reference_order`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "text-to-video-1",
  "type": "text-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Text to Video",
    "prompt": "",
    "provider": "seedance-2-fast",
    "duration": 5,
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->

<!-- AUTO-GEN:START provider-prompting -->
## Provider prompting doctrine

Model-family-specific prompting rules. Apply the section matching the node's `provider`.

### Seedance 2.0 (seedance-2, seedance-2-fast, seedance-2-mini)

Prompt structure (front-load what matters most):
precise subject → action details → scene/environment → lighting & color tone → camera movement → visual style → image quality → constraints.

**Shots & pacing**
- Storyboard complex videos as "Shot 1: … Shot 2: … Shot 3: …" in event order. Do NOT attach timestamps (e.g. "(0-3s)") — precise-timing support is officially unstable and forcing durations can break generation; let the model pace naturally.
- Per shot cover, in order: camera move or transition, subject action + expression, spatial/position change, audio for that shot.
- One camera movement type per shot — never ask for push + pan + orbit at once (image instability).
- Prefer slow, gentle, continuous movements over high-burst action (sprints, big jumps, violent rolls morph). Describe actions per body part with quantified degree: "slowly raises a hand", "pushes hard off the ground". Chain actions with inertia: "uses the momentum of the turn to naturally raise an arm".
- Express emotion as externalized physical detail, never abstract words: not "very sad" but "lowering the head, shoulders trembling slightly, eyes reddening, fingers clutching the corner of clothing".

**References (when reference media is attached)**
- Refer to assets by ordinal in attachment order: "@Image 1", "Video 2", "Audio 1". Asset ORDER is priority — put the most identity-critical asset first. (In the editor, the `{image:N:label}` / `{video:N}` / `{audio:N}` prompt tokens auto-emit this binding — `{image:1:person}` resolves to "the person from @image_1" — so a wired reference and its mention stay in sync.)
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

### Kling 2.6 / 3.0 / 3 Omni (kling, kling-3.0, kling-3-omni)

Prompt structure: Scene (setting, light) → Character/Element (who, appearance) → Motion (action, camera) → Audio (dialogue / SFX / ambience / music) → Others (style, emotion).

**Dialogue (native speech + lip sync — verified on the KIE path 2026-07-16)**
- Quote the spoken line and enable the sound toggle; the model bakes the voice AND matching lip movement: the woman says "The quick brown fox jumps over the lazy dog."
- Prefer labeled dialogue with a voice description: [Character label: voice/tone description]: "line". Example: [Exhausted Partner: trembling frustrated voice]: "You never listen to me."
- Keep character labels unique and reuse them verbatim — never switch to pronouns mid-prompt; the label is what binds a voice to a speaker across lines. Kling 2.6 additionally supports [Character@VoiceName] platform-voice binding.
- Tone words inside the bracket steer delivery: whispering, crying voice, controlled serious voice, fast urgent voice. Sequence speech with temporal markers ("Immediately", "after a pause") when two lines must not overlap.
- Languages: Kling 2.6 outputs English/Chinese voices only (other languages are auto-translated to English). Kling 3.0 supports multiple languages, dialects, accents, and code-switching within one scene — mark the language explicitly ("says in Japanese …").

**SFX / ambience / music**
- Put them in the same Audio block, described plainly: "Rain tapping softly on the window, distant thunder, no music."
- State exclusions explicitly — "no background music, no other sounds" — or the model tends to add a bed under dialogue.

**Toggle + cost**
- The audio lever is the node's sound toggle (KIE `sound` param). On kling (2.6) and kling-3.0 enabling audio raises the credit cost (the `:audio` composite); kling-3.0 generates audio by DEFAULT — pass sound: false for the cheaper silent tier. kling-3-omni (Replicate) includes audio in its flat per-duration rate.
- Multi-shot kling-3.0 (`multi_shots`) forces sound ON — budget for the audio rate.

**References & elements (kling-3.0 / omni)**
- Wired references are injected as `kling_elements` and MUST be mentioned as @element_name in the prompt — the editor's {image:N} tokens and the server prefixer handle this automatically; when hand-writing prompts, mention every element or it is silently ignored.
- kling-3-omni is image-to-video only (start frame required) and accepts up to 7 reference images; element voice references (element_input_audio_urls, 5-30s clips) bind a voice to an element.

**Limits**
- Kling 2.6 prompts cap at 1000 characters — front-load scene + dialogue and trim style tails first. kling-3.0 accepts long prompts.
- Durations: 2.6 = 5/10s; 3.0/omni = 3-15s. A spoken line needs roughly 1s per 2-3 words — don't script more dialogue than the clip can hold.

_Generated from `PROVIDER_PROMPT_DOCTRINES` in `@nodaro/shared` — edit there, then `npm run gen:skills`._
<!-- AUTO-GEN:END provider-prompting -->
