---
node_type: generate-video
generated_at: 2026-09-01T21:25:23.906Z
generated_from: f99d6fa6e
---

# Generate Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-video`
**Category:** ai
**Credit cost:** 20
**Inputs (target handles):** `prompt`, `negative`, `startFrame`, `endFrame`, `imageReferences`, `videoReferences`, `audio`, `audioReferences`, `assets`, `elements`, `look`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `model: string`
- `duration: number`
- `fieldMappings: FieldMappings`
- `provider: VideoGenProvider`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
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
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `veoMode?: "frame-to-frame" | "reference"`
- `direction?: DirectionFields`
- `structured?: StructuredPromptFields`
- `seedance2InputMode?: "frames" | "references"`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`
- `aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "4:5" | "5:4" | "21:9" | "9:21" | "adaptive" | "Auto"`
- `referenceImageOrder?: readonly string[]`

**Default data:**
```json
{
  "label": "Generate Video",
  "provider": "seedance-2-fast",
  "duration": 5,
  "prompt": "",
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
- `reference_image_urls`
- `reference_video_urls`
- `reference_audio_urls`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "generate-video-1",
  "type": "generate-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Video",
    "provider": "seedance-2-fast",
    "duration": 5,
    "prompt": "",
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->

<!-- AUTO-GEN:START provider-prompting -->
## Provider prompting doctrine

Model-family-specific prompting rules. Apply the section matching the node's `provider`.

### Seedance 2 (seedance-2, seedance-2-fast, seedance-2-mini, seedance-2-5)

Prompt structure (front-load what matters most):
precise subject → action details → scene/environment → lighting & color tone → camera movement → visual style → image quality → constraints.

**Shots & pacing**
- Storyboard complex videos as "Shot 1: … Shot 2: … Shot 3: …" in event order. TIMESTAMPS ARE VERSION-SPLIT: the 2.0 SKUs (seedance-2 / -fast / -mini) respond to shot numbers only — do NOT attach timestamps there (e.g. "(0-3s)"; precise timing is officially unstable on 2.0 and forcing durations can break generation, so let the model pace). seedance-2-5 honours integer-second timestamps — the forms and limits are under "Generation differences" below.
- Per shot cover, in order: camera move or transition, subject action + expression, spatial/position change, audio for that shot.
- One camera movement type per shot — never ask for push + pan + orbit at once (image instability).
- Prefer slow, gentle, continuous movements over high-burst action (sprints, big jumps, violent rolls morph). Describe actions per body part with quantified degree: "slowly raises a hand", "pushes hard off the ground". Chain actions with inertia: "uses the momentum of the turn to naturally raise an arm".
- Express emotion as externalized physical detail, never abstract words: not "very sad" but "lowering the head, shoulders trembling slightly, eyes reddening, fingers clutching the corner of clothing".

**Generation differences (seedance-2-5 vs the 2.0 SKUs)**
- A single 2.5 shot runs to 30s, where every 2.0 SKU stops at 15s. Plan a complete 4-6 shot beat inside ONE generation instead of splitting it into two clips and stitching — no seam to hide, and continuity holds because it never leaves the model.
- 2.5 also takes far more reference material (30 images / 10 videos / 10 audio vs 9/3/3). Treat that as room for COVERAGE — more distinct characters, locations and props in one shot — not as licence to pile refs onto one identity. The "ONE headshot + ONE full-body, 4-5 assets total" rule above still produces the best likeness on 2.5.
- 2.5 renders at 480p/720p/1080p (1080p since 2026-08-17): there is no 4K tier, so route a job that needs 4K to seedance-2 (which has it) or upscale afterwards.
- With a start frame, 2.5 always derives the output aspect from that frame — an explicit aspect ratio is rejected outright, so compose the frame at the ratio you want.
- Timestamps (official 2.5 guide, "Differences from Seedance 2.0"): 2.0 does not respond to them; 2.5 supports integer-second timestamps in three forms — gap-free intervals ("0-3s: … 3-7s: … 7-15s: …" or "[1s-4s] … [4s-8s] …"; never leave a hole like "0-3s … 5-6s"), time-point control ("At the 5-second mark, …"), and relative time ("After 3 seconds, …"). Use 1-second units. Too little content in a range lets the model improvise; too much packs in extra cuts or drops beats — budget the seconds. Never use timestamps to drive high-frequency actions ("shake three times per second").
- Multi-view subject images: not recommended on 2.0 (the views read as separate people → twins); supported on 2.5. ONE headshot + ONE full-body remains the safest default on both.
- Transitions and camera terms on 2.5: state a transition's trigger point AND method in one sentence — "At the 5-second mark, the camera quickly transitions leftward using a left wipe combined with a natural dissolve." Basic shot and camera terms are written directly (push in / pull out / pan / track / orbit / dolly zoom / whip pan / hard cut / dissolve / one-shot / speed ramp); only niche terms need [term + descriptive explanation] — which is exactly what the pickers' compact hint mode emits versus their long hints.

**References (when reference media is attached)**
- Refer to assets by ordinal in attachment order: "@Image 1", "Video 2", "Audio 1". Asset ORDER is priority — put the most identity-critical asset first. (In the editor, the `{image:N:label}` / `{video:N}` / `{audio:N}` prompt tokens auto-emit this binding — `{image:1:person}` resolves to "the person from @image_1" — so a wired reference and its mention stay in sync. An API caller that passes `connectedReferences` can instead name a reference by its own id — `{ref:<id>}` / `{ref:<id>:label}` — and the platform substitutes the `@image_N` seat after it has numbered the references, so the client never computes N; a token whose reference was not attached drops to its label or name.)
- Define each subject once, then reuse the label consistently: 'Define the woman in the red dress in Image 1 as the courier' … 'the courier opens the door'. In multi-character scenes bind every character to its image ("the man from Image 1 hands the box to the woman from Image 2") and append: "do not generate duplicate copies of the same character".
- Character identity: ONE close-up headshot + ONE full-body image is ideal. On the 2.0 SKUs do NOT attach multi-view/three-view character sheets — the model reads the views as separate people, causing identity drift and twin duplicates; 2.5 accepts multi-view images (see "Generation differences").
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

**Auto-path formula (community-sourced enrichment; captured 2026-08-09)**
- Six steps IN ORDER, 60-100 words total (longer measurably degrades): Subject → Action → Environment → Camera → Style → Constraints.
- ONE primary camera instruction per shot. Compound moves chain with "then": "camera slow tracking then subtle rise" — never two competing verbs. The 8 reliable camera types: push-in, pull-out, pan, tracking, orbit/arc, aerial, handheld, locked-off.
- SEPARATE camera movement from subject movement — the single biggest quality lever: "The dancer spins slowly. Camera holds fixed framing." — never "spinning camera around a dancing person".
- Pace with human words (slow / gentle / gradual / smooth / controlled) — never fps numbers or f-stops in the basic path.
- ALWAYS add one lighting phrase (highest-impact single addition): golden hour / rim light / neon glow / backlit / overcast.
- Bake stability constraints in: "avoid jitter and bent limbs", "avoid temporal flicker", "avoid identity drift".
- Ban vague adjectives standing alone ("epic", "amazing", "beautiful", bare "cinematic") — every adjective needs a concrete noun.
- Mode notes: i2v — skip subject description (the frame has it), focus on motion, append "preserve composition and colors". v2v — describe the style TRANSFORM, keep motion + identity.
- Advanced (pro path): focal angles in degrees ("47° normal", "29° telephoto", "107° wide"); "180° shutter" for filmic motion blur; handheld texture as "organic shake, micro-drift, subtle dutch"; "white balance locked 5200K"; explicit POSITIVE LOCKS section + "100% matches the reference" for identity-critical shots.

**Camera-path control — the magenta-line method (STORYBOARD community technique; the
manual pro path for precise trajectories, NOT the auto path)**
1. Duplicate the start frame; on the COPY draw a thick magenta line + arrowhead — the line is the camera's flight path, the arrow its end point. Keep the clean original.
2. Attach BOTH frames and declare the guide: "Image N contains a magenta line and arrow — a hidden camera trajectory guide, NOT part of the scene. Completely remove it: no line, no arrow, no paint, no trail, no reflection." Skipping the removal order RENDERS the line.
3. Command the path: "one continuous FPV drone glide following the S-shaped curve as closely as possible — do not shortcut. Camera motion is the priority." Lock the clean frame as first frame + scene reference; lock the destination frame if wired.
4. Pace with timing blocks ("[00:00-00:02] rise over the rooftop … [00:07-00:09] settle on the doorway") and keep any dialogue SHORT — long lines fight the move.
5. Assign image-input roles explicitly: first-frame/scene-ref · destination frame · path-guide · 3-6 character-identity refs — and bind identities with @-mentions exactly like the platform's reference pills.

### Kling 2.1 / 2.5 / 2.6 / 3.0 / 3 Omni (kling, kling-3.0, kling-3-omni, kling-turbo, kling-master)

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

**Variant note — kling-turbo (2.5 Turbo Pro) & kling-master (2.1 Master)**
- SILENT tiers: no audio parameter, so the entire Audio block above does not apply — skip dialogue/SFX cues; the Scene → Character → Motion → Style structure and motion guidance carry over unchanged.
- Durations 5/10s; kling-turbo takes an end frame (tail_image_url); kling-master is single-image i2v.

### MiniMax Hailuo 3 (minimax-h3)

Prompt structure (front-load what matters most):
precise subject → action details → scene/environment → lighting & color tone → camera movement → visual style → image quality → constraints. Prompts are natural language, 1-7000 characters, across all three modes.

**Modes (picked automatically from the wired inputs)**
- First frame and/or last frame connected, nothing else → exact frame mode (image-to-video): the output opens on the first frame and/or closes on the last. The clip's aspect is inferred from the frame — there is no aspect parameter in this mode.
- ANY reference connected (image, video, or audio) → reference mode (reference-to-video): frames ride along as reference images with a prompt directive binding them to the opening/closing position. Aspect defaults to adaptive (matches the input); a concrete ratio can be forced.
- Nothing visual connected → text-to-video. A concrete aspect ratio is required (21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 — no adaptive); Nodaro renders 16:9 unless one is picked.

**References (when reference media is attached)**
- Refer to assets by ordinal in attachment order: "@Image 1", "Video 1", "Audio 1". Put the identity-critical asset first. (In the editor, the `{image:N:label}` / `{video:N}` / `{audio:N}` prompt tokens auto-emit this binding, so a wired reference and its mention stay in sync. An API caller that passes `connectedReferences` can instead write `{ref:<id>}` / `{ref:<id>:label}` with the reference's own id — the platform substitutes the `@image_N` seat after numbering.)
- Caps: 9 reference images; 3 reference videos, each 2-15s and ≤15s combined; 3 reference audio clips, ≤15s combined. Reference audio cannot be used alone — it must accompany an image or video reference.
- Define each subject once, then reuse the label consistently ("the woman from @Image 1 … the woman opens the door"). A focused set of 4-5 assets beats maxing every cap.
- Billing note: generated seconds AND reference-video input seconds bill at the same per-second rate; the first 5 input images are free and each extra image adds a small surcharge; audio input is free.

**Audio**
- Audio is always generated — there is no on/off toggle. With reference audio attached, the model syncs speech to the supplied track (the platform's lip-sync surface routes image + voice line through this mode automatically).
- Quoted dialogue in the prompt gives the model the line to perform; describe the voice in words when no reference audio is supplied.

**Duration & pacing**
- 4-15 seconds, integer, default 6. Per-second pricing — a 15s clip costs ~3.7× a 4s clip, so pick the shortest duration that serves the shot.
- One camera movement type per shot; chain actions with physical, quantified detail ("slowly raises a hand", "pushes hard off the ground") rather than abstract emotion words.

**Constraints**
- There is NO negative-prompt parameter — all constraints belong in the prompt text itself: "keep it subtitle-free, do not generate a watermark, do not generate a logo, stable picture".

### VEO 3.1 — Quality / Fast / Lite (veo3, veo3.1, veo3_lite)

Prompt structure (Google's official Veo 3.1 formula — lead with the camera):
[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance].
Example: "Medium shot, a tired corporate worker, rubbing his temples in exhaustion, in front of a bulky 1980s computer in a cluttered office late at night, lit by harsh fluorescents and the green monitor glow. Retro aesthetic, 1980s color film, slightly grainy."

**Camera vocabulary (use the exact terms)**
- Movement: dolly shot, tracking shot, crane shot, aerial view, slow pan, POV shot, 180-degree arc shot.
- Composition: wide shot, medium shot, close-up, extreme close-up, two-shot, low angle, high angle.
- Lens/focus: shallow depth of field, deep focus, wide-angle lens, macro lens, soft focus.

**Audio (native, multi-track — dialogue / SFX / ambience)**
- Dialogue: quote the exact line with attribution: The detective says in a weary voice, "Of all the offices in this town, you had to walk into mine." Append "(no subtitles)" — VEO otherwise tends to burn captions in.
- Sound effects on their own line: "SFX: a crystal wine glass shatters on the marble floor". Ambient bed: "Ambient noise: rain against the window, distant traffic".
- Sound can drive the visual ("the sound reverberating through the empty ballroom") — VEO syncs audio-visual timing.

**Multi-shot timestamp prompting (inside one generation)**
- Split the clip into [mm:ss-mm:ss] windows, one action per window:
[00:00-00:02] Medium shot from behind a young explorer walking toward a clearing.
[00:02-00:04] Reverse shot of her freckled face, eyes widening.
[00:04-00:08] Wide, high-angle crane shot revealing the ruins below.
- 4 / 6 / 8 second clips; budget ~2s per window.

**Frames & references**
- Start + end frame: wire both (imageUrls [start, end]) and describe the camera path between them — "a smooth 180-degree arc shot, starting front-facing and circling to end on the POV from behind her".
- Reference images (ingredients): attach character/object/scene refs and name them in the prompt ("using the provided images for the detective and the office, …"). Reference runs DO generate audio.

**Constraints**
- Negative prompting works by positive description: write "a desolate landscape with no buildings or roads", not "no buildings".
- Keep prompts ≤ ~175 words — beyond that instructions conflict and adherence drops. Resolution 720p/1080p; aspect 16:9 / 9:16.

Sources: Google Cloud "Ultimate prompting guide for Veo 3.1"
(cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1),
KIE VEO API docs (docs.kie.ai/veo3-api/generate-veo-3-video). Captured 2026-08-09.

### Gemini Omni (gemini-omni-video, gemini-omni-flash)

Prompt structure (no public Google prompt guide exists for the Omni video endpoint —
the API contract is the doctrine source, like MiniMax H3; structure guidance mirrors the
platform's ordinal-reference conventions):
subject → action → scene/environment → lighting → camera movement → style → constraints.

**Modes (picked from the wired inputs)**
- Nothing visual → text-to-video. A concrete aspect ratio is REQUIRED — the API hard-rejects a missing one (Nodaro sends the node's ratio; there is no adaptive).
- Image(s) wired → image-to-video: the first image anchors the scene; extra images are references — bind each in the prompt ("the woman from the first image", "the interior from the second image").
- Source video wired → video-edit (served through the same handle): describe the CHANGE ("replace the daylight with dusk, keep the motion and framing"), not a full re-description.

**Audio (native)**
- Audio is generated with the clip. Quote dialogue to have it spoken; describe SFX and ambience plainly ("rain on glass, low synth bed"). State exclusions ("no music") or a bed may be invented.

**Duration & tiers**
- 4 / 6 / 8 / 10 seconds. 720p/1080p tier or the pricier 4K tier — pick 4K only when the deliverable needs it (nearly 2× the credits).
- gemini-omni-flash is the faster/cheaper tier with the identical request surface — same 4/6/8/10s, same 720p/1080p and 4K tiers, same video-edit path. Everything above applies verbatim.

Source: KIE gemini-omni-video market contract (parameters + live behavior probed for the
aspect-ratio hard-reject, see providers/kie/video.ts). Captured 2026-08-09.

### Grok Imagine (grok-i2v, grok-imagine-video-1.5)

Prompt structure (xAI's guidance is minimal by design — the model auto-expands prompts):
Subject + Action + Setting + Camera + Lighting/Mood, written simply and directly. Reduce
descriptions of static/unchanged parts — spend the words on what MOVES.

**Image-to-video (the primary mode)**
- The input image is the FIRST FRAME, not a loose reference: composition, subject identity, and visual style carry over. Describe motion and camera only ("she turns toward the window as the camera slowly pushes in"); re-describing the still wastes adherence.
- grok-imagine-video-1.5 accepts up to 7 images (identity/scene references beyond the first frame); at 1080p only ONE image is allowed.

**Audio (video-1.5)**
- Native audio generates with the clip — background music, SFX, and lip-synced dialogue. Quote the spoken line; describe the music/SFX plainly. There is no audio toggle on the KIE contract — cue (or exclude) sound in the prompt text.

**Durations / tiers**
- grok-i2v: 6 or 10 seconds. grok-imagine-video-1.5: 1-15 seconds in 1s steps (default 8), 480p (default) / 720p / 1080p. Prompt cap 4096 chars — but shorter is better here.

Sources: KIE Grok Imagine contracts (docs.kie.ai/market/grok-imagine/image-to-video,
docs.kie.ai/market/grok-imagine/1-5-preview), xAI Grok Imagine 1.5 release notes
(x.ai/news/grok-imagine-1-5). Captured 2026-08-09.

### Wan 2.x (wan, wan-i2v, wan-turbo, wan-2.7 family)

Prompt structure (Alibaba Model Studio's official formulas):
- Basic: Entity + Scene + Motion.
- Advanced: Entity (description) + Scene (description) + Motion (description) + Aesthetic control + Stylization.
- Image-to-video: Motion + Camera movement ONLY — the wired image already defines entity and scene; re-describing it fights the frame.
- Sound (2.5/2.6/2.7): … + Sound description (voice / sound effects / background music).
- Multi-shot (2.6/2.7): Overall description + Shot number + Timestamp + Shot content.
- Reference-to-video (2.6/2.7): Reference identifier + Action + Scene + optional Lines + optional BGM.

**Camera vocabulary**
push-in (intimacy/tension), pull-out (scale/isolation), tracking shot, orbit, fixed camera, and compound movements chained sequentially for epic scale.

**Single-shot control (2.7)**
- The shot_type parameter no longer exists — write "Generate single shot" in the prompt to force one continuous take; otherwise 2.7's planner may cut.

**References**
- English format is "Image 1" / "Video 1" (capitalized, space-separated) — bind every wired asset by that name or it may be ignored.

**Official anti-patterns (from Alibaba's guide)**
- Do NOT name specific real people.
- Do NOT script exact lip-synced dialogue — describe the voice and intent ("she murmurs a reassurance, warm and low") instead of demanding word-perfect lips.
- Avoid rapid scene changes inside a single clip, very long choreographed sequences, and demands for exactly legible on-screen text.

**Stylization**
- Style words are strong levers: cyberpunk, line-art illustration, felt style, 3D cartoon, pixel style, puppet animation, claymation, black-and-white animation, tilt-shift, time-lapse.

Source: Alibaba Cloud Model Studio — "Text-to-video / image-to-video prompt guide"
(alibabacloud.com/help/en/model-studio/text-to-video-prompt). Captured 2026-08-09.

### Wan 3.0 (wan-3, wan-3-prime)

Prompt structure (no public Wan 3.0 prompt guide exists — the KIE API contract is the
doctrine source, like MiniMax H3 and HappyHorse; platform-standard structure applies):
subject → action → scene/environment → lighting → camera movement → style → constraints.

**Modes (mutually exclusive at the provider)**
- Frame mode: first_frame_url, optionally with last_frame_url, and NO references — the frames anchor the shot exactly, so describe MOTION and camera, not the still.
- Reference mode: image / video / audio reference arrays. The provider CANNOT take these together with the first/last frame parameters, so when both are wired the platform folds — the frame is appended to the reference images (after the caller's own, ordinals unchanged) and bound in the prompt as the opening/closing frame. Write for reference mode whenever a reference is attached.
- Text-only runs are supported and are the model's default mode.

**Reference binding**
- Assets bind by ORDINAL TOKEN in array order: Image1, Image2, …, Video1, …, Audio1, …. Note the format has NO space — Wan 2.x's "Image 1" is a different generation and does not apply here.
- Write the binding into the prompt explicitly ("Image1 walks into the room described in Image2"); an unnamed reference may simply be ignored.
- Caps: up to 10 images, 5 videos, 5 audio clips. Each video and each audio clip must be 1-15s with ≤15s combined per array. Audio should not be the only media input — pair it with an image or a video.

**Duration, resolution, aspect**
- 2-30 seconds (provider default 5). With reference videos there is an extra ceiling: input video duration + output duration ≤ 30 seconds.
- 480p / 720p / 1080p. Aspect "adaptive" (the default — the model selects the ratio from the input media and intent) or 16:9 / 4:3 / 1:1 / 3:4 / 9:16. There is no 21:9.
- Prompts accept Chinese and English, up to 20,000 characters; anything beyond is truncated silently, so front-load the load-bearing content.

**Audio**
- The "audio" boolean defaults ON and produces an ambient/SFX track with the clip. Describe the soundscape you want plainly ("rain on glass, distant traffic"), or state the exclusion, or turn the toggle off. The contract documents no lip-synced dialogue guarantee — plan spoken lines as a separate TTS + lip-sync pass.

**Tiers**
- wan-3 and wan-3-prime take identical inputs. Prime trades a higher per-second rate for faster turnaround; it is not documented as a quality tier.

Source: KIE Wan 3.0 market contract (docs.kie.ai/market/wan/3-0-video,
docs.kie.ai/market/wan/3-0-video-prime). Captured 2026-09-01.

### HappyHorse 1.1 (happyhorse, happyhorse-i2v, happyhorse-ref2v)

Prompt structure (no public HappyHorse prompt guide exists — the KIE API contract is the
doctrine source; platform-standard structure applies):
subject → action → scene/environment → lighting → camera movement → style → constraints.

**Contract facts (KIE, per-mode pages)**
- Prompts: any language, up to 5000 non-Chinese / 2500 Chinese characters — excess is TRUNCATED silently, so put the load-bearing content first.
- Duration 3-15s (default 5), billed per second. Resolution 720p / 1080p (default). Aspect 16:9 (default) / 9:16 / 1:1 / 4:3 / 3:4.
- Modes: text-to-video (happyhorse), image-to-video (happyhorse-i2v), reference-to-video (happyhorse-ref2v) — ref2v preserves wired identities; name each reference in the prompt so the binding is explicit.

**Style guidance (platform-standard, honestly generic)**
- One camera movement per shot; physical, quantified action ("slowly raises a hand") over abstract emotion words; state exclusions ("no on-screen text, no watermark") in the prompt.

Source: KIE HappyHorse 1.1 contracts (docs.kie.ai/market/happyhorse/text-to-video,
…/happyhorse-1-1/image-to-video, …/happyhorse-1-1/reference-to-video). Captured 2026-08-09.

### Runway via KIE (runway-kie)

Prompt structure (KIE contract guidance): "be specific about subject, action, style, and
setting" — subject → action → scene → camera → style, within the 1800-character cap.

**Contract facts (KIE Runway endpoint)**
- Duration 5 or 10 seconds; quality 720p or 1080p — 10s@1080p does NOT exist (10s forces 720p; 1080p forces 5s). Choose by deliverable: crisp hero shot → 5s/1080p; longer beat → 10s/720p.
- Text-to-video REQUIRES aspectRatio (16:9 / 4:3 / 1:1 / 3:4 / 9:16). Image-to-video IGNORES aspectRatio — the input image dictates output dimensions.
- No audio is generated — score/SFX are a separate pass (merge-video-audio / video-sfx downstream).

**Style guidance**
- The image input anchors composition and identity — describe the motion ("she pushes the door open as the camera tracks left"), not the still.
- Keep one continuous camera idea per clip; front-load the subject and action.

Source: KIE Runway contract (docs.kie.ai/runway-api/generate-ai-video). Captured 2026-08-09.

_Generated from `PROVIDER_PROMPT_DOCTRINES` in `@nodaro/prompts` — edit there, then `npm run gen:skills`._
<!-- AUTO-GEN:END provider-prompting -->
