# Node type inventory

One row per node **type**. Generative model wrappers are not rows — a type that dispatches to a whole model family is a single row, and the model family is named in "what it does".

**Scope:** the 188 entries of `NODE_DEFINITIONS` (`frontend/src/types/nodes.ts`) plus the 2 deprecated type strings the loader still migrates (`loop` → `list`, `ai-writer` → `llm-chat`) = **190 rows**. One entry, `preview`, is retired (soft-delete, 2026-08): it stays in `NODE_DEFINITIONS` so saved workflows keep loading, but is no longer creatable — see its row.

**Where each column comes from**

| column | source |
|---|---|
| type / display name / category / handle names | `NODE_DEFINITIONS` in `frontend/src/types/nodes.ts` (`NODE_DEF_MAP` is built from it) |
| what it does | `NODE_REGISTRY.description` in `backend/src/lib/node-registry.ts` (175 types); `docs/nodes/README.md` for the rest; `(inferred)` marks sentences written from the implementation because no descriptor exists |
| handle types | the handle's colour, which *is* its data type — canonical map `frontend/src/lib/handle-colors.ts` (`HANDLE_COLORS`), family aliases in `frontend/src/lib/{ffmpeg,data,picker,audio-text,generate-image,generate-video,…}-handles.ts`, read off each node component's `HandleWithPopover`. A guard test (`handle-colors.test.ts`) fails CI if a node hardcodes a hex, so colour cannot drift from type |
| interactive? | read from the node component + whatever surface it mounts |

**Handle type vocabulary** (canonical names from `HANDLE_COLORS`): `text`, `image`, `image-ref`, `video`, `audio`, `audio-ref`, `look` (cinematography/picker fragments), `picker-json`, `identity` (character / location / asset / voice refs), `face`, `mask`, `list`, `json`, `variables`, `any` (generic `control` pip), `any-ref` (mixed image+video+audio+text reference). Three names are label-derived rather than colour-derived because the pip uses the generic `control` colour: `composition` (Remotion composition spec — feeds `render-video`), `lottie-json`, `image-set`. `param` marks a config-value pip on a parameter node that is not in the picker registry (`provider`, `duration`, `aspect-ratio`, `scene-count`, `style-guide`, `motion`) — it renders the indigo fallback decoration and carries a plain config value.

**interactive? = YES** only when the node's output cannot be produced without direct manipulation inside the node's own UI (drawing, dragging, painting, spatial point-and-click). Typing params, choosing from a tile grid or dropdown, clicking Run, and wiring upstream edges are all **NO** — including every parameter picker, whose tile grid is a value chooser, not a canvas.

| type | display name | category | what it does | inputs (name:type) | outputs (name:type) | interactive? |
|---|---|---|---|---|---|---|
| `list` | List | input | Static list of items for fan-out. On the canvas a table whose media column (image / video / audio) has content — typed, uploaded, or resolved live from a connected source — opens in the data view (gallery) by default; empty and pure-text tables start in the compact info view. The info/data toggle (⊞) is display-only and an explicit toggle always wins over the default | `in`:any | dynamic ᵃ | NO |
| `loop` | Loop (alias of List) | input | Deprecated type string — migrated to `list` on load by `list-loop-migration.ts` (inferred) | `in`:any | — | NO |
| `reference-audio` | Reference Audio | input | Extract audio from YouTube videos or provide audio via upload/URL | `in`:text | `audio`:audio | NO |
| `rss-feed` | RSS Feed | input | Pull content from RSS/Atom feeds for automated content pipelines | `in`:any | `content`:text | NO |
| `schedule-trigger` | Schedule Trigger | input | Trigger the workflow on a cron/interval | — | `payload`:any | NO |
| `telegram-channel-feed` | Telegram Channel Feed | input | Read recent posts from a PUBLIC Telegram channel (t.me/s/<channel>) — emits their text for rewrite/repost workflows | — | `text`:text | NO |
| `telegram-trigger` | Telegram Trigger | input | Trigger the workflow when a connected Telegram bot receives a message | — | `text`:text, `imageUrl`:image, `videoUrl`:video, `audioUrl`:audio, `chatId`:text, `messageId`:text | NO |
| `text-prompt` | Text | input | User-supplied text prompt. Connect to AI nodes' prompt input | `in`:text | `prompt`:text | NO |
| `upload-audio` | Upload Audio | input | Upload an audio asset | `in`:text | `audio`:audio | NO |
| `upload-image` | Upload Image | input | Upload an image asset. Output is the image URL | `in`:text | `image`:image | NO |
| `upload-video` | Upload Video | input | Upload a video asset | `in`:text | `video`:video | NO |
| `web-scrape` | Web Scrape | input | Fetch data from web pages, Google Search, Instagram, TikTok, or RSS feeds and emit structured JSON | `in`:text | `json`:json | NO |
| `webhook-trigger` | Webhook Trigger | input | Trigger the workflow via HTTP POST | — | `payload`:any | NO |
| `youtube-video` | Video URL | input | Download video or audio from YouTube, TikTok, Instagram, Facebook, or X | `in`:text | `video`:video | NO |
| `action-fx` | Action FX | parameter | Pick environmental effects (multi-pick) from the action-fx catalog (earthquake, lightning, explosion, falling-objects, ...) | `in`:any | `out`:look | NO |
| `aesthetic` | Aesthetic / Microtrend | parameter | Pick a microtrend aesthetic from 46 entries (y2k, cottagecore, vaporwave, dark-academia, ...) | `in`:any | `out`:look | NO |
| `animal` | Animal | parameter | Pick an animal from 126 entries across subcategories (mammal, bird, reptile, sea, insect, etc.) | `in`:any | `out`:look | NO |
| `aspect-ratio` | Aspect Ratio | parameter | Set the target aspect ratio for connected image and video generation nodes | `in`:any | `aspect_ratio`:param | NO |
| `atmosphere` | Atmosphere | parameter | Pick an atmospheric condition from 40 entries (clear, fog, dust, rain, snow, smoke, ...) | `in`:any | `out`:look | NO |
| `backdrop` | Backdrop | parameter | Pick a studio backdrop from 40 entries (white-seamless, cyc-wall, gradient, painted, ...) | `in`:any | `out`:look | NO |
| `camera-format` | Camera / Film Stock | parameter | Pick a camera or film format from 31 entries (35mm-film, IMAX, super-8, polaroid, vhs, ...) | `in`:any, `picker-json`:picker-json | `out`:look | NO |
| `camera-motion` | Camera Motion | parameter | Pick a camera motion from 71 entries across categories (static/pan/tilt/dolly/zoom/track) | `in`:any | `out`:video | NO |
| `character-fx` | Character FX | parameter | Pick character-driven effects (57 entries, 5 categories — transformation, power, body-mod, face FX, aura) with position/duration/intensity timing | `in`:any | `out`:look | NO |
| `color-look` | Color / Look | parameter | Pick a color-grading look from 41 entries (warm, teal-orange, bleached, vintage, ...) | `in`:any | `out`:look | NO |
| `composition-effects` | Composition Effects | parameter | Pick a composition effect from 19 entries (none, bursting-through-frame, pixel-disintegration, ...) | `in`:any | `out`:look | NO |
| `duration` | Duration | parameter | Set a target duration in seconds for connected video or audio generation nodes | `in`:any | `duration`:param | NO |
| `era` | Era / Period | parameter | Pick a historical era from 32 entries (1950s, 1990s-mall, ancient-rome, victorian, ...) | `in`:any | `out`:look | NO |
| `exposure-settings` | Exposure Settings | parameter | Multi-dim picker for aperture + shutter-speed + ISO (20 catalog options across 3 fields) | `in`:any | `out`:look | NO |
| `framing` | Framing | parameter | Multi-dim picker for shot-size + angle + coverage + composition + vantage (72 catalog options across 5 fields) | `in`:any, `picker-json`:picker-json | `out`:look | NO |
| `furniture` | Furniture | parameter | Pick a furniture piece from 78 entries across 9 categories (seating, tables, beds, storage, lighting, kitchen-dining, outdoor, decorative, bath) | `in`:any | `out`:look | NO |
| `held-prop` | Held Prop | parameter | Pick a held prop from 59 entries (smartphone, umbrella, bouquet, briefcase, ...) | `in`:any | `out`:look | NO |
| `instrumentation` | Instrumentation | parameter | Pick instruments (up to 5) + production style + vocal presence (up to 3) + singing style (up to 3). 'instrumental' vocal-presence flips MiniMax instrumental flag | `in`:any | `out`:audio | NO |
| `lens` | Lens | parameter | Pick a lens from 16 entries (wide-angle, normal-50mm, telephoto, fisheye, anamorphic, ...) | `in`:any, `picker-json`:picker-json | `out`:look | NO |
| `lighting` | Lighting | parameter | Multi-dim picker for time-of-day + lighting-style + lighting-direction (72 catalog options across 3 fields) | `in`:any | `out`:look | NO |
| `loop-subject` | Loop Subject | parameter | Pick a loop subject from 35 entries across 2 categories | `in`:any | `out`:look | NO |
| `material` | Material | parameter | Pick a material from 66 entries (silk, leather, metal, glass, marble, ...) | `in`:any | `out`:look | NO |
| `mood` | Mood | parameter | Pick a mood from 50 entries (calm, tense, melancholic, joyful, ominous, ...) | `in`:any | `out`:look | NO |
| `motion` | Motion | parameter | Define the motion intensity level for connected video generation nodes | `in`:any | `out`:param | NO |
| `music-genre` | Music Genre | parameter | Pick a music genre (single or up to 3 for fusion) with optional subgenre and era | `in`:any | `out`:audio | NO |
| `music-mood` | Music Mood | parameter | Pick energy + emotion + vibe for music generation | `in`:any | `out`:audio | NO |
| `person` | Person | parameter | Multi-dim picker for person attributes — type, age, ethnicity, build, body proportions, face shape, jawline, cheekbones, facial fullness, eyes (shape, eyelid type, canthal tilt, spacing, brow distance), nose, nose tip, lip fullness, lip shape, hair, eyebrows, skin, facial hair, distinctive features (~573 options across 29 fields, incl. a dedicated facial-geometry layer) | `picker-json`:picker-json | `out`:look | NO |
| `photo-genre` | Photo Genre | parameter | Pick a photography genre from 46 entries (fashion-editorial, street, macro, documentary, ...) | `in`:any | `out`:look | NO |
| `photographer` | Photographer / Artist Style | parameter | Pick from 67 photographers, artists, directors, illustrators, or painters (Tim Walker, Deakins, Lubezki, Ghibli, Rutkowski, ...) | `in`:any | `out`:look | NO |
| `pose` | Pose | parameter | Pick a pose from 81 entries across categories (standing, sitting, action, dynamic) | `in`:any | `out`:look | NO |
| `post-process-effects` | Post-Process Effects | parameter | Pick a post-processing effect from 18 entries (vignette-soft, film-grain, light-leak, chromatic-aberration, ...) | `in`:any | `out`:look | NO |
| `provider` | Provider | parameter | Select an AI provider and model (image / video / voice / script) to override the default provider on connected generation nodes | `in`:any | `provider`:param | NO |
| `render-quality` | Render Quality | parameter | Pick a render-pipeline preset from 24 entries (raytracing, octane, unreal, blender, ...) | `in`:any | `out`:look | NO |
| `scene-count` | Scene Count | parameter | Specify the number of scenes for script generation nodes | `in`:any | `scene_count`:param | NO |
| `setting` | Setting | parameter | Pick a setting from 63 entries across 4 categories (indoor, urban, nature, fantastical) | `in`:any | `out`:look | NO |
| `style` | Style | parameter | Pick a style preset from 48 entries (cinematic, anime, oil-painting, photoreal, ...) | `in`:any | `out`:look | NO |
| `style-guide` | Style Guide | parameter | Define visual style reference text for consistent aesthetics across AI generation nodes in a workflow | `in`:any | `style_guide`:param | NO |
| `styling` | Styling | parameter | Multi-dim picker for makeup + eyewear + headwear + hair cut/treatment + jewelry + nails + face-paint + fabric (262 catalog options across 9 fields) | `in`:any, `picker-json`:picker-json | `out`:look | NO |
| `suno-voice` | Suno Voice | parameter | Create a custom voice persona from a recording | — | `voicePersona`:identity | NO |
| `temporal` | Temporal | parameter | Multi-dim picker for temporal-speed + freeze + direction + shutter (18 catalog options across 4 fields) | `in`:any | `out`:look | NO |
| `tone` | Tone | parameter | Define a tone or style modifier text (e.g., "cinematic", "cheerful") to influence connected AI nodes | `in`:any | `tone`:text | NO |
| `transition` | Transition | parameter | Pick a cinematic transition (76 entries, 8 categories) with position/duration/intensity timing fields | `in`:any | `out`:video | NO |
| `vehicle` | Vehicle | parameter | Pick a vehicle from 107 entries across subcategories (car, truck, motorcycle, boat, aircraft, spaceship, etc.) | `in`:any | `out`:look | NO |
| `voice-character` | Voice Character | parameter | Pick age + gender + language (up to 3 for multilingual) + accent + timbre for ElevenLabs Voice Design | `in`:any | `out`:audio | NO |
| `voice-delivery` | Voice Delivery | parameter | Pick pace + emotion + archetype for ElevenLabs Voice Design | `in`:any | `out`:audio | NO |
| `weapon` | Weapon | parameter | Pick a weapon from 85 entries across subcategories (blade, ranged, firearm, fantasy, sci-fi, etc.) | `in`:any | `out`:look | NO |
| `3d-title` | 3D Title | ai | AI-generated 3D animated text | `background`:image | `composition`:composition | NO |
| `ai-avatar` | AI Avatar | ai | Generate a talking-avatar video from a HeyGen avatar + voice + script, or wired audio | `script`:text, `audio`:audio, `image`:image | `video`:video | NO |
| `ai-writer` | AI Agent | ai | Deprecated legacy text-generation node — auto-migrated to `llm-chat` on workflow load; the backend still executes it for in-flight runs (inferred) | `in`:any | `text`:text | NO |
| `audio-isolation` | Voice Extractor | ai | Isolate and clean up vocal audio by removing background noise and non-speech elements | `audio`:audio | `audio`:audio | NO |
| `audio-separation` | Audio Separation | ai | Separate ANY audio into vocals + instrumental, or full stems (drums, bass, other, guitar, piano), using Demucs on Replicate | `audio`:audio | `audio`:audio | NO |
| `cinematic-avatar` | Cinematic Avatar | ai | Prompt-driven generative avatar clip from 1-3 HeyGen avatar looks (no script/voice) | `prompt`:text, `ref-video`:video, `ref-audio`:audio, `ref-image`:image | `video`:video | NO |
| `describe-to-picker` | Describe to Picker | ai | Analyze an image with a vision LLM and emit catalog-valid picker JSON (Person) to auto-fill a parameter picker | `image`:image | `picker-json`:picker-json | NO |
| `dubbing` | Dubbing | ai | Translate spoken audio or a whole video (ElevenLabs Dubbing) into another language while preserving each speaker's voice — video in (or a public source link) yields the dubbed video + audio track; priced per minute of the dubbed span | `audio`:audio, `video`:video | `audio`:audio, `video`:video | NO |
| `edit-video-pro` | Edit Video Pro | ai | Replace a span (min 4s, max 120s) of an existing video with newly generated content — Seedance 2 reference bridge, stitched back into the source (Cloud edition only) | `video`:video, `prompt`:text, `imageReferences`:image-ref | `video`:video | NO |
| `extend-video` | Extend Video | ai | Continue a generated video with a new prompt direction | `video`:video, `cinematography`:look, `prompt`:text | `video`:video | NO |
| `face-swap` | Face Swap | ai | Replace the face in a video with a face from a reference image | `face`:face, `video`:video | `out`:video | NO |
| `forced-alignment` | Forced Alignment | ai | Generate word-level timestamps by aligning a transcript to its corresponding audio | `audio`:audio, `transcript`:text | `data`:json | NO |
| `generate-image` | Generate Image | ai | Generate an image from a text prompt using an AI provider | `prompt`:text, `negative`:text, `references`:image, `assets`:identity, `elements`:look, `look`:look | `image`:image | NO |
| `generate-mask` | Generate Mask | ai | Produce a binary segmentation mask for a subject described by a text prompt (Grounded SAM) | `image`:image | `image`:image, `mask`:mask | NO |
| `generate-music` | Generate Music | ai | Generate music with MiniMax | `prompt`:text, `ref-audio`:audio, `audio-style`:audio | `audio`:audio | NO |
| `generate-script` | Generate Script | ai | AI-powered multi-scene script generation with cinematography details, character actions, and structured scene breakdowns | `prompt`:text | `scenes`:video, `images`:image, `dialogue`:text, `music`:audio, `sfx`:audio, `characters`:identity, `locations`:identity | NO |
| `generate-video` | Generate Video | ai | Unified video producer — text-only, image-to-video, first+last frame, reference mode, or video-edit (V2V) driven by which inputs are wired (`VIDEO_GEN_PROVIDERS` catalog); providers include VEO 3.x, Gemini Omni, Kling, Seedance 2, LTX 2.3, and more | `prompt`:text, `negative`:text, `startFrame`:image, `endFrame`:image, `imageReferences`:image-ref, `videoReferences`:video, `audio`:audio, `audioReferences`:audio-ref, `assets`:identity, `elements`:look, `look`:look | `video`:video | NO |
| `generate-video-pro` | Generate Video Pro | ai | Long-form video — auto-splits requests beyond a single segment's 15s limit into multiple Seedance 2 segments and stitches them into one clip (Cloud edition only) | `prompt`:text, `negative`:text, `startFrame`:image, `endFrame`:image, `imageReferences`:image-ref, `videoReferences`:video, `audio`:audio, `audioReferences`:audio-ref, `assets`:identity, `elements`:look, `look`:look | `video`:video | NO |
| `image-critic` | Image Critic | ai | Score an image on realism / character consistency / prompt adherence / anatomy / aesthetic / style match via VLM | `image`:image, `reference`:image, `prompt`:text | `approved`:text, `rejected`:text | NO |
| `image-to-text` | Describe Image | ai | Extract a text description from an image using Claude Sonnet vision, with configurable detail levels | `image`:image, `video`:video, `text`:text | `text`:text | NO |
| `image-to-video` | Image to Video | ai | Animate a still image into a video | `startFrame`:image, `endFrame`:image, `audio`:audio | `video`:video | NO |
| `lip-sync` | Lip Sync | ai | Sync audio to a character's face to create a talking head video | `image`:image, `video`:video, `audio`:audio | `video`:video | NO |
| `llm-chat` | Generate Text | ai | LLM text generation from a prompt (+ optional image/video/audio refs) | `prompt`:text, `references`:any-ref, `system-prompt`:text | `text`:text, `items`:list | NO |
| `modify-image` | Modify Image | ai | Transform an existing image with a text prompt across 20+ image-to-image / editing providers (Flux, GPT Image, Ideogram, Nano Banana, Qwen, Seedream, + Nano Banana Edit) | `image`:image, `mask`:mask, `cinematography`:look | `out`:image | NO |
| `motion-graphics` | Motion Graphics | ai | AI-generated 2D motion graphics (classic elements or AI-authored Lottie) | `in`:video | `composition`:composition, `lottie`:lottie-json | NO |
| `motion-transfer` | Motion Transfer | ai | Apply motion from a reference video to a static character image | `image`:image, `video`:video, `prompt`:text, `negative`:text, `assets`:identity | `out`:video | NO |
| `qa-check` | QA Check | ai | LLM quality gate — scores upstream text 0.0-1.0 against a check type (content / quality / consistency / safety) and returns score + approved + reason | `in`:any | `approved`:text, `rejected`:text | NO |
| `reference-board` | Reference Board | ai | Generate a dense reference board (hero + metadata + panels + palette) in one AI pass from reference image(s); refine globally, with a mask, or re-roll | `prompt`:text, `references`:image | `image`:image | NO |
| `reference-sheet` | Reference Sheet | ai | Composite a turnaround / expression / full reference sheet from a character, object, or location | `in`:identity | `sheet`:image, `panels`:image-set | NO |
| `remove-background` | Remove Background | ai | Remove the background from an image and output a transparent PNG (Recraft) | `image`:image | `out`:image | NO |
| `speech-to-video` | Speech to Video | ai | Generate video driven by speech audio input using Wan 2.2 | `image`:image, `audio`:audio, `prompt`:text, `cinematography`:look | `video`:video | NO |
| `suno-add-instrumental` | Suno Add Instrumental | ai | Add an AI-generated instrumental backing track to an existing vocal track | `audio`:audio | `audio`:audio | NO |
| `suno-add-vocals` | Suno Add Vocals | ai | Add AI-generated vocals to an existing instrumental track | `audio`:audio | `audio`:audio | NO |
| `suno-convert-wav` | Suno Convert WAV | ai | Convert a Suno-generated MP3 audio track to lossless WAV format | `audio`:audio | `audio`:audio | NO |
| `suno-cover` | Suno Cover | ai | Create a cover version of an existing audio track using Suno AI | `audio`:audio, `prompt`:text, `voice`:identity | `audio`:audio | NO |
| `suno-extend` | Suno Extend | ai | Extend an existing Suno-generated track by continuing from a specified timestamp | `audio`:audio, `prompt`:text, `voice`:identity | `audio`:audio | NO |
| `suno-generate` | Suno Generate | ai | Full song generation using Suno AI with extensive creative controls | `prompt`:text, `audio-style`:audio, `voice`:audio, `field-style`:text, `field-lyrics`:text, `field-title`:text, `field-negativeStyle`:text | `audio`:audio | NO |
| `suno-lyrics` | Suno Lyrics | ai | Generate song lyrics from a text prompt using Suno AI | `prompt`:text | `text`:text | NO |
| `suno-mashup` | Suno Mashup | ai | Blend two audio tracks into a single mashup using Suno AI | `audio1`:audio, `audio2`:audio | `audio`:audio | NO |
| `suno-music-video` | Music Video | ai | Generate a music video for a Suno-generated track | `audio`:audio | `video`:video | NO |
| `suno-replace-section` | Suno Replace Section | ai | Replace a specific time range within a Suno-generated track with new content | `audio`:audio, `prompt`:text | `audio`:audio | NO |
| `suno-separate` | Suno Separate | ai | Separate vocals from instrumentals, or split a track into individual stems | `audio`:audio | `audio`:audio | NO |
| `suno-style-boost` | Suno Style Boost | ai | Enhance and refine the style of lyrics or text content using Suno AI | `prompt`:text | `text`:text | NO |
| `suno-upload-extend` | Suno Upload Extend | ai | Extend any audio file (not limited to Suno-generated tracks) using Suno AI | `audio`:audio, `prompt`:text | `audio`:audio | NO |
| `switchx` | Relight & Switch | ai | Relight + switch/composite driven by the source pixels (Beeble SwitchX) | `video`:video, `image`:image, `mask`:mask, `mask-video`:mask, `prompt`:text | `video`:video | NO |
| `text-to-audio` | Text to Audio | ai | Generate sound effects and ambient audio from a text description using ElevenLabs SFX | `prompt`:text, `audio-style`:audio | `audio`:audio | NO |
| `text-to-dialogue` | Text to Dialogue | ai | Generate multi-speaker dialogue audio where each line is spoken by a different voice | `prompt`:text | `audio`:audio | NO |
| `text-to-speech` | Text to Speech | ai | Synthesize speech from text using ElevenLabs | `prompt`:text | `audio`:audio | NO |
| `text-to-video` | Text to Video | ai | Generate video from a text prompt | `in`:text | `video`:video | NO |
| `transcribe` | Transcribe | ai | Convert spoken audio to text with optional speaker diarization and audio event tagging | `audio`:audio | `text`:text | NO |
| `upscale-image` | Upscale Image | ai | Increase image resolution with Recraft Upscale or Topaz Upscale (1x / 2x / 4x factor) | `image`:image | `out`:image | NO |
| `video-retake` | Retake Video | ai | Replace a time window of an existing video — audio, video, or both (LTX 2.3 Pro) | `video`:video, `prompt`:text, `look`:look | `video`:video | NO |
| `video-sfx` | Video SFX | ai | Generate synced sound effects, foley, or ambience for a video (replaces existing audio) | `prompt`:text, `negative`:text, `video`:video | `video`:video | NO |
| `video-to-video` | Video to Video | ai | Transform existing video using AI with a text prompt | `video`:video, `cinematography`:look, `prompt`:text, `negative`:text | `video`:video | NO |
| `voice-changer` | Voice Changer | ai | Replace the voice in an audio recording — or in an entire talking video — with a different voice, preserving the original emotion, cadence, and timing | `audio`:audio, `video`:video | `audio`:audio | NO |
| `voice-changer-pro` | Voice Changer Pro | ai | Detect each speaker in a multi-speaker recording and replace each one's voice independently, preserving words, timing and lip-sync | `audio`:audio, `video`:video | `audio`:audio, `video`:video | NO |
| `voice-design` | Voice Design | ai | Create a custom voice with full parameter controls and receive both an audio preview and a reusable voice ID | `prompt`:text, `audio-style`:audio | `audio`:audio, `voiceId`:identity | NO |
| `voice-remix` | Voice Remix | ai | Generate a voice from a natural language description and hear it speak preview text | `audio`:audio, `audio-style`:audio | `audio`:audio | NO |
| `add-captions` | Add Captions | processing | Burn captions into a video. Static (subtitle) is FFmpeg/free; kinetic styles (word-highlight, karaoke, tiktok-words, word-pop, bouncy) render via Remotion at 5 credits | `in`:video | `video`:video | NO |
| `adjust-volume` | Adjust Volume | processing | Change audio volume with optional normalize and fade-in / fade-out transitions (FFmpeg) | `in`:video\|audio | `audio`:video\|audio | NO |
| `after-effects` | After Effects | processing | AI-generated post-processing layer | `in`:video | `composition`:composition | NO |
| `assemble-narrated-video` | Assemble Narrated Video | processing | Fit N ordered (clip, voice) blocks into one MP4: center short voice, slow-to-fit long voice, never crop audio | `video`:video, `audio`:audio | `video`:video | NO |
| `audio-fx` | Audio FX | processing | Apply creative audio effects (FFmpeg) — scenario reverbs (Room, Bathroom, Car, Hall, Concert Hall, Church, Cave, Arena, Outdoor), Telephone, Megaphone, Echo, or Custom (delay + EQ) | `in`:audio | `audio`:audio | NO |
| `combine-audio` | Combine Audio | processing | Concatenate audio tracks end-to-end in order, with optional per-segment trim | `in`:audio | `audio`:audio | NO |
| `combine-videos` | Combine Videos | processing | Concatenate multiple videos with transitions, audio handling, boundary trims, and smart cut | `in`:video | `video`:video | NO |
| `composite` | Composite | processing | Multi-layer video compositor (up to 4 layers) with per-layer positioning, scale, blending, and opacity | `video1`:video, `video2`:video, `video3`:video, `video4`:video | `composition`:composition | NO |
| `extract-audio` | Extract Audio | processing | Demux the audio track from a video to a standalone MP3 | `in`:video | `audio`:audio | NO |
| `extract-frame` | Extract Frame | processing | Extract a single frame as an image | `in`:video | `image`:image | NO |
| `fade-video` | Fade In/Out | processing | Add fade transitions to the beginning and end of video | `in`:video | `video`:video | NO |
| `gif-to-video` | Gif to Video | processing | Convert an animated GIF to an H.264 MP4 so it can be used as a motion reference for video models that reject GIF input; optional seam-aware loop-to-minimum and 24fps interpolation. Local FFmpeg, zero credits | `image`:image | `video`:video | NO |
| `image-collage` | Image Collage | processing | Composite N images into one 2K/4K image with a smart (justified) or grid layout; optional 1-based sequence numbers and per-image labels for storyboards | `in`:image | `image`:image | NO |
| `loop-video` | Loop Video | processing | Repeat video to reach a target duration or count, with optional smart-loop-cut for seamless seams | `in`:video | `video`:video | NO |
| `lottie-overlay` | Lottie Overlay | processing | AI-placed timed Lottie animations overlaid on video | `in`:video, `lottie`:lottie-json | `composition`:composition | NO |
| `manual-edit` | Manual Edit | processing | Open video in a browser-based web editor for manual adjustments | `in`:identity | `video`:video | YES |
| `merge-video-audio` | Merge Video & Audio | processing | Mux a video and an audio track | `in`:video\|audio | `video`:video | NO |
| `still-to-video` | Still to Video | processing | Turn one still image + one audio track into an MP4 with an optional motion effect (zoom / pan / Ken Burns). Local FFmpeg — no provider, no GPU, zero credits. The output duration is the audio's duration (no duration field) | `image`:image, `audio`:audio | `video`:video | NO |
| `slideshow` | Slideshow | processing | Turn 2-100 images + one optional audio track into an MP4 slideshow with per-slide motion (zoom / ken-burns / alternate) and transitions. Local FFmpeg — no provider, no GPU, zero credits. Audio wired: the output duration IS the audio's duration (never cropped); unwired: N x perImageDuration, silent output | `images`:image-set, `audio`:audio, `transition`:param | `video`:video | NO |
| `mix-audio` | Mix Audio | processing | Blend multiple audio tracks with individual volume control | `in`:audio | `audio`:audio | NO |
| `paint-mask` | Paint Mask | processing | Hand-paint a mask over a connected image in the editor; emits the painted mask PNG (white = edit, black = preserve) for any mask input. Source node — never executes; optionally seeded by a Generate Mask output for hand-refinement. The node card follows the theme (light / dark) like every other node; the Mask editor modal it opens is dark by design (an image-editing surface, like the FreeCut / Filerobot editors) | `image`:image, `mask`:mask | `mask`:mask | YES |
| `remove-audio` | Remove Audio | processing | Strip the audio track from a video, leaving a silent clip (stream-copied, lossless) | `in`:video | `video-out`:video | NO |
| `render-video` | Render Video | processing | Render a Remotion composition to MP4 | `in`:composition | `video`:video | NO |
| `resize-video` | Resize Video | processing | Resize a video | `in`:video | `video`:video | NO |
| `social-media-format` | Social Media Format | processing | Auto-format video for specific platform specifications | `media`:video\|image, `text`:text | `media`:video\|image, `text`:text | NO |
| `speed-ramp` | Adjust Speed | processing | Change playback speed (0.05x to 100x), reverse, choose audio treatment (pitch-preserve / pitch-shift / drop), opt into motion-compensated frame interpolation (smooth slow-mo), or define a piecewise speed ramp via segments | `in`:video | `video`:video | NO |
| `split-media` | Split into Chunks | processing | Split a video or audio file into equal-duration chunks for batch processing — emits a video clip and an audio file per chunk | `video`:video, `audio`:audio | `video-out`:video, `audio-out`:audio | NO |
| `transcode-video` | Transcode Video | processing | Convert video codec, quality, and resolution | `in`:video | `video`:video | NO |
| `trim-audio` | Trim Audio | processing | Extract a section of audio or extract audio from video | `in`:audio | `audio`:audio | NO |
| `trim-video` | Trim Video | processing | Trim a video by start/end seconds | `in`:video | `video`:video | NO |
| `video-analysis` | Video Analysis | processing | Scene-segmented analysis of a video: prompt-ready visuals, camera language, mode-tagged audio, castable entity slots | `video`:video | `json`:json, `text`:text | NO |
| `video-audit` | AI Audit | processing | Re-watch a video against its analysis and disclose every fix | `video`:video, `analysis`:json | `json`:json, `text`:text | NO |
| `video-composer` | Compose Video | processing | AI-powered scene-graph video composition from natural language prompts | `in`:identity | `composition`:composition | NO |
| `video-upscale` | Upscale Video | processing | Upscale video resolution using Topaz or VEO AI | `video`:video | `video`:video | NO |
| `collect` | Collect | utility | Explicit list-builder — multiple inputs converge on a single 'in' handle in connection order (reorderable in the panel via `data.order`) and are bucketed by type into four typed lanes. The card previews what was collected (image thumbnails, clamped text, video/audio counts) — display-only. Each lane pip behaves as a plain producer of its type, so it connects anywhere the matching upload node can (Image Collage, Combine Videos, Mix Audio, prompts, Merge Lists / Sort / Dedup / Selector, Choose Best …) and both resolvers route the value by lane | `in`:any | `out-text`:text, `out-image`:image, `out-video`:video, `out-audio`:audio — **always present** ᵃ | NO |
| `combine-text` | Combine Text | utility | Concatenate text inputs | `text`:text | `text`:text | NO |
| `component` | Component | utility | Embed a published Nodaro Component (a curated, versioned sub-workflow from the marketplace or your own apps) as a black-box node — its exposed inputs/settings/outputs surface in the config panel | dynamic ᵃ | dynamic ᵃ | NO |
| `deduplicate` | Remove Duplicates | utility | Remove duplicate items from an upstream list, keeping the first occurrence | `in`:list | `out`:list | NO |
| `extract-field` | Extract Field | utility | Pull a specific field or dot-notation path from upstream JSON — output can be a single string, a list for fan-out, or a raw JSON value | `in`:json | `text`:json\|text | NO |
| `filter-list` | Filter List | utility | Keep only the upstream list items matching one or more field conditions (AND/OR), with 12 operators (equals, contains, regex, in-list, ...) | `in`:list | `out`:list | NO |
| `group` | Group | utility | Visual container that groups child nodes via React Flow parentId — emits members as a structured list to downstream consumers (Loop, Merge Lists, sub-workflow). Lane pips appear the moment a member of that type is inside the frame (before any run), for lanes with collected values, and for any lane an outgoing edge references — so an edge can never point at a missing handle. Its lane pips connect to typed inputs exactly like Collect's | dynamic ᵃ | dynamic ᵃ | YES |
| `json-process` | JSON Process | utility | Transform upstream JSON — input-path drill, filter conditions, and field projection via a visual builder, or a raw transformation expression in Advanced mode | `in`:json | `out`:any | NO |
| `merge-lists` | Merge Lists | utility | Combine multiple upstream lists into one — concatenate (append in edge order) or zip (element-wise merge with modulo-wrap), with optional dedupe | `in`:list | `out`:list | NO |
| `preview` | Preview *(retired)* | utility | **Retired 2026-08 (soft-delete)** — removed from the node picker, the Common → Finish section, `docs/nodes/README.md` and the backend `NODE_REGISTRY` (`GET /v1/nodes` / MCP discovery); saved workflows that contain one keep loading and running (component, `EXECUTABLE_TYPES`, executor branch and extractors stay). It predated per-node result rendering; every job it did is covered by a clearer node — each node shows its own result, Collect gathers several, Choose Best shows the winner, outputs wire straight to Telegram / Publish / Save. Usage before retirement: 8 of 691 workflows, none as a delivery step | `in`:any | `out`:any | NO |
| `reduce` | Choose Best | utility | Turns N candidate results into ONE. Options (strategy ids in parentheses): **AI picks the best** (`pick-best-llm`) — an AI judge compares every candidate against your criteria and picks one; **Join into one text** (`concat`); **First that has content** (`first-non-empty`); **Count them** (`count`); **Most common answer** (`vote`); **Merge JSON objects** (`merge-json`). The judge model is selectable (`strategyConfig.llmModel`, same LlmModelSelect as every LLM node; default from `LLM_FEATURE_DEFAULTS["pick-best-llm"]`) and its tier sets the price: economy 3 / standard 10 / premium 25 cr; other options are free. The card renders MODE + AI Model chips, the mode's headline setting editable in place (Judge by / Separator / Case sensitivity / How to merge — writes the same `strategyConfig` field the panel does), a 4-column CANDIDATES grid with the WINNER tagged, and an OUTPUT bar with the result + the judge's reasoning. Type id `reduce` and `POST /v1/reduce` / MCP `reduce` / SDK `client.reduce` are unchanged | `in`:any (label *Candidates*) | `out`:any (label *Result*) | NO |
| `router` | Router | utility | Conditionally split workflow execution into one or more named routes (radio / checkbox / conditional modes) | `in`:any | `route_a`:any, `route_b`:any + dynamic ᵃ | NO |
| `selector` | Selector | utility | Pick item(s) from a list — supports item/range/list/random/modulo/predicate/named-key modes | `in`:list | `picked`:list, `rest`:list | NO |
| `sort-list` | Sort List | utility | Sort an upstream list by value or by a dot-path field, with Auto/Text/Number/Date comparison and asc/desc direction (missing values sort last) | `in`:list | `out`:list | NO |
| `split-text` | Split Text | utility | Split text by delimiter | `text`:text | `out`:text | NO |
| `sticky-note` | Sticky Note | utility | Place annotated notes on the workflow canvas for documentation and organization | — | — | NO |
| `sub-workflow` | Sub-Workflow | utility | Embed another workflow as a node. Selects a route (matched input+output pair) on the referenced workflow; ports become handles on the parent canvas. Expand opens the child for editing with a breadcrumb back to the parent | dynamic ᵃ | dynamic ᵃ | NO |
| `sub-workflow-input` | Sub-Workflow Input | utility | Entry boundary of a callable sub-workflow route | — | dynamic ᵃ | NO |
| `sub-workflow-output` | Sub-Workflow Output | utility | Exit boundary of a callable sub-workflow route | dynamic ᵃ | — | NO |
| `teleport-receive` | Teleport Receive | utility | Receive a value from a Teleport Send node on the same channel (A-F), without a visible wire | `in`:any | — | NO |
| `teleport-send` | Teleport Send | utility | Broadcast its upstream value on a named channel (A-F) without a visible wire — every Teleport Receive tuned to the same channel gets the value | `in`:any | — | NO |
| `facebook-post` | Facebook Post | output | Post text, images, video, and stories to Facebook | `in`:any | — | NO |
| `instagram-post` | Instagram Post | output | Publish images, reels, stories, and carousels directly to Instagram | `in`:any | — | NO |
| `linkedin-post` | LinkedIn Post | output | Post text, images, and video to LinkedIn | `in`:any | — | NO |
| `publish-social` | Publish to Social | output | Publish to any connected social account (Instagram, Facebook, X, LinkedIn, TikTok, YouTube, Telegram, Bluesky, Reddit, and more) — pick the account and the platform follows | `in`:any | — | NO |
| `save-to-storage` | Save to Storage | output | Persist a node output to user storage | `in`:any | `asset`:any | NO |
| `telegram-post` | Telegram Post | output | Send a message, photo, or video to a Telegram chat, channel, or group via a connected bot (send type auto-detected from connected media) | `in`:any | — | NO |
| `tiktok-post` | TikTok Post | output | Publish video content directly to TikTok | `in`:any | — | NO |
| `webhook-output` | Webhook Output | output | POST a node output to a URL | `in`:any | — | NO |
| `x-post` | X Post | output | Post text, images, and video to X (Twitter) | `in`:any | — | NO |
| `youtube-upload` | YouTube Upload | output | Upload videos and Shorts to YouTube with full metadata control | `in`:any | — | NO |
| `generative-pipeline` | Story → Video | scene | Conversational pipeline: prompt + duration + format → editable film graph | `story_prompt`:text | — | NO |
| `scene` | Scene | scene | Structured scene container with shot list, camera, motion | `characters`:identity, `location`:identity, `objects`:identity, `prev_last_frame`:image | `video`:video, `last_frame`:image, `audio_track`:audio | NO |
| `character` | Character Asset | character | Reusable character — portrait, expressions, poses, motion clips, voice & personality, edited in the full-screen Character Studio | `assets`:identity, `in`:text | `characterRef`:identity | NO |
| `creature` | Animal/Creature Asset | creature | Reusable animal / creature reference — species, angles, poses, variations, motion clips, edited in the full-screen Creature Studio | `in`:text, `type`:image-ref | `creatureRef`:image-ref | NO |
| `face` | Face | face | Reusable face reference | `in`:text | `faceRef`:face | NO |
| `location` | Location Asset | location | Reusable location reference | `in`:text, `cinematography`:look | `locationRef`:image | NO |
| `object` | Object/Props Asset | object | Reusable object / prop reference | `in`:text, `type`:image-ref | `objectRef`:image-ref | NO |

ᵃ **dynamic** — the handle set is built at runtime, not declared in `NODE_DEFINITIONS`: `list` mints one source pip per typed column (`loop-node.tsx`); `collect` renders **all four** aggregate lane pips (`out-text` / `out-image` / `out-video` / `out-audio`, `groupHandleId` in `@nodaro/shared`) unconditionally — a fixed contract, so a flow can be wired in any order and an edge can never point at a missing handle (`NODE_DEFINITIONS` still declares a placeholder `out` that never renders); `group` mints a lane pip when a member of that type is inside the frame, when the lane has values, or when an outgoing edge references it (`computeAggregateLanes` in `@nodaro/shared`); `router` mints one pip per named route; and `component` / `sub-workflow` / `sub-workflow-input` / `sub-workflow-output` mint `in_<port>` / `out_<port>` pips from the referenced workflow's declared ports, each coloured by that port's `mediaType`.

**List vs Collect — which one?** Both can show a row of images on the canvas, but they point in opposite directions. **List is a SOURCE that fans OUT**: one origin (rows you typed / uploaded, or ONE connected node's results), and by default every downstream node runs once per row — "here are 10 items, do something to EACH". Natural consumers: Generate Image / Video, anything that runs per item. **Collect is an AGGREGATOR that fans IN**: several separate nodes each wire into it, and it hands the whole set on as one bundle — "here are 3 candidates, do something to ALL of them together". Natural consumers: Choose Best, Image Collage, Combine Videos, anything that needs the set. Rule of thumb: one origin + many items + act on each → List; many nodes + pack their outputs together → Collect. They chain into the standard "generate N, pick 1" pattern: List (spread) → Collect (gather) → Choose Best (decide).

**Aggregate lanes are typed producers.** A wire leaving `collect` / `group` on `out-image` / `out-video` / `out-audio` / `out-text` is treated by the canvas validator, the input popovers and both runtime resolvers as a plain producer of that lane's type (`resolveEffectiveSourceType` in `@nodaro/shared` maps the lane to `upload-image` / `upload-video` / `upload-audio` / `list`) — the same per-handle remap entity nodes use for their `image` pip. So `out-image` reaches every image input, `out-video` every video input, and so on; the lane's type is enforced (an image lane is rejected by a video-only input) and no lane is an identity ref.

**Note — registry name vs canvas handle id.** The table uses the `NODE_DEFINITIONS` names. For a handful of nodes the id rendered on canvas differs: `add-captions` renders `video-out` for registry `video`, `adjust-volume` renders `video-out` + `audio-out` for registry `audio`, `split-media` renders `video` + `audio` for registry `video-out` + `audio-out`, and `rss-feed` renders `text` + `image` for registry `content`. The reverse also happens — `webhook-trigger` and `schedule-trigger` render an `in` target pip that `NODE_DEFINITIONS` does not declare, so their inputs read `—` here.

---

## 1. Nodes that read pointer events or render an editable canvas surface

Component-layer sweep of `frontend/src` for `<canvas>`, `onPointerDown/onPointerMove/onMouseDown` with real coordinate math (`clientX`, `getBoundingClientRect`), and embedded editors. Node-shell plumbing is **excluded** — `base-node.tsx` drag/resize, `custom-handle.tsx` / `handle-with-popover.tsx` / `handle-hint.tsx` connection wiring, `editable-node-label.tsx`, and the `e.stopPropagation()` click-isolation guards that appear in most node components (`sticky-note`, `text-prompt`, `upload-*`, `character`, `youtube-video`, …) are gesture *isolation*, not an editing surface.

| node type | surface | what the pointer does |
|---|---|---|
| `manual-edit` | `freecut-editor-modal.tsx` — the NodarCut/FreeCut editor in an `<iframe>` (postMessage protocol, `VITE_FREECUT_URL`), hosted by `workflow-editor-main.tsx` when the node sets `isEditorOpen` | full timeline edit; the node's output IS the editor's export |
| `paint-mask` | `editor/mask-painter-modal.tsx` (`<canvas>`, `handlePointerMove` brush, `lib/mask-utils.ts`), opened from the node itself | paint the mask by hand; the painted PNG IS the node's output |
| `reference-board` | `reference-board-node.tsx:406` → `editor/mask-painter-modal.tsx` (`<canvas>`, `handlePointerMove` brush, `lib/mask-utils.ts`) | paint a refine mask over the board, straight from the node |
| `generate-image` | `generate-image-node.tsx:385` → `editor/extract-references-modal.tsx` (`<canvas>`, rectangle drag + lasso point capture, `lib/image-utils.ts` `cropPolygonToBlob`) | draw a rect/lasso over the result to cut out a character / location / object reference |
| `generate-image` | `config-panels/image-configs.tsx:851` (`GenerateImageConfigImpl`) → `MaskPainterModal` | paint the inpaint mask (`data.maskUrl`) |
| `modify-image` | `config-panels/image-configs.tsx:1603` (`ModifyImageConfigImpl`) → `MaskPainterModal` | paint the inpaint mask (`data.maskUrl`) |
| `upload-image`, `upload-video`, `upload-audio` | `editor/media-editor/` (`crop-panel.tsx` drag-handle crop rect with mouse+touch coordinate math, `trim-panel.tsx` drag trim, `use-filmstrip.ts` `<canvas>` frame strip) via `useMediaEditor` + `MediaEditorModal` imported directly by each node | crop / trim the uploaded asset by dragging |
| `group` | `group-node.tsx` — React Flow `NodeResizer` drag handles; membership comes from dragging other nodes into the frame (`parentId`) | resize the frame; drag nodes in/out to change what it emits |
| `list` (and the `loop` alias) | `loop-node.tsx` — `SortableNodeRow` drag-to-reorder rows in the typed table | reorder list rows by dragging |
| 35 video-result nodes: `add-captions`, `ai-avatar`, `assemble-narrated-video`, `cinematic-avatar`, `combine-videos`, `component`, `edit-video-pro`, `extend-video`, `face-swap`, `fade-video`, `generate-video`, `generate-video-pro`, `gif-to-video`, `lip-sync`, `loop-video`, `merge-video-audio`, `motion-transfer`, `remove-audio`, `render-video`, `resize-video`, `slideshow`, `social-media-format`, `speech-to-video`, `speed-ramp`, `still-to-video`, `suno-music-video`, `switchx`, `transcode-video`, `trim-video`, `upload-video`, `video-sfx`, `video-to-video`, `video-upscale`, `voice-changer`, `voice-changer-pro` | `openFreeCut(...)` from `use-workflow-store` → same FreeCut iframe editor | post-hoc timeline edit of an already-produced result (optional; re-uploads as a new result) |
| 10 image-result nodes: `creature`, `face`, `generate-image`, `image-collage`, `location`, `modify-image`, `object`, `remove-background`, `upload-image`, `upscale-image` | `openImageEdit(...)` → Filerobot image editor (`filerobotDesignStateUrl` per result) | post-hoc paint/crop/annotate of an already-produced result (optional) |

Considered and rejected: `kling3-director-modal.tsx` (its only `onMouseDown` inserts an `@mention` from a dropdown — no canvas), `waveform-audio-player.tsx` (playback scrubbing in config-panel previews), `router` (route chips are buttons), every parameter picker (tile grids are value choosers), `composite` (per-layer position/scale are numeric config fields, no drag surface), `video-retake` / `edit-video-pro` (span windows are numeric seconds), `selector` (pick modes are config).

## 2. Nodes that output a mask / matte

| node type | output handle | how the mask is produced |
|---|---|---|
| `generate-mask` | `mask`:mask (plus `image`:image passthrough of the source) | **text prompt → auto-segmentation.** `backend/src/routes/generate-mask.ts` sends `{imageUrl, prompt, threshold}` to `schananas/grounded_sam` (Grounding DINO + SAM, version-pinned in `providers/replicate/grounded-sam.ts`); the phrase names the subject, the model returns a binary mask. No drawing, no clicking. |
| `paint-mask` | `mask`:mask | **manual drawing, exposed as a handle.** The only node whose mask output is a first-class pip rather than an internal `data.maskUrl` — `MaskPainterModal` opens from the node, and the painted PNG is what downstream mask inputs consume. Optionally seeded from a `generate-mask` output for hand-refinement. |
| `remove-background` | `out`:image | **auto-segmentation, matte baked into the alpha channel.** KIE `recraft/remove-background` (`providers/kie/models.ts:369`); output is a transparent PNG rather than a separate mask handle. |
| `reference-board` | none — internal | **manual drawing.** `MaskPainterModal` brush → uploaded mask URL → `onMaskSaved` feeds the node's own masked-refine pass. Never exposed as a handle. |
| `generate-image` | none — internal (`data.maskUrl`) | **manual drawing.** `MaskPainterModal` from the config panel; white = edit, black = preserve. Consumed by the node's own inpaint call. |
| `modify-image` | none — internal (`data.maskUrl`) | **manual drawing** (same painter), or **passed from upstream** through its `mask`:mask input handle (`ACCEPTS_MASK`) — typically wired from `generate-mask`. |

Mask **consumers** (no mask output of their own): `modify-image` (`mask` target) and `switchx` (`mask` target in `select` alpha mode, `mask-video` target in `custom` mode; `auto`/`fill` modes derive the alpha internally and are enforced by the route's Zod refine in `backend/src/routes/switchx.ts:46`). `switchx` emits only video — no matte handle.
