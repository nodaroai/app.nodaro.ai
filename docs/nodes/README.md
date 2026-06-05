# Nodaro.ai Node Reference

Complete reference for all nodes available in the Nodaro.ai visual workflow editor.

## Quick Reference

- **Total Nodes:** 150+
- **Categories:** 16

---

## Table of Contents

- [Input Nodes](#input-nodes)
- [Parameter Nodes](#parameter-nodes)
- [AI Text Nodes](#ai-text-nodes)
- [AI Image Nodes](#ai-image-nodes)
- [AI Video Nodes](#ai-video-nodes)
- [AI Audio & Speech Nodes](#ai-audio--speech-nodes)
- [Suno Music Nodes](#suno-music-nodes)
- [Video Processing Nodes](#video-processing-nodes)
- [Audio Processing Nodes](#audio-processing-nodes)
- [Text Processing Nodes](#text-processing-nodes)
- [Video Composition Nodes](#video-composition-nodes)
- [Asset Nodes](#asset-nodes)
- [Output Nodes](#output-nodes)
- [Workflow Nodes](#workflow-nodes)
- [Generative Pipelines](#generative-pipelines)
- [Utility Nodes](#utility-nodes)

---

## Input Nodes

Provide data to your workflow: text, images, video, audio, or external triggers. These are typically the starting points of any workflow.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Text](./input/text-prompt.md) | User-provided text input with variable support | Provide prompts, descriptions, or text data to downstream nodes |
| [List](./input/list.md) | List of items, or a multi-column typed table, for batch iteration | Batch process multiple prompts or subjects; grow into a typed table for multiple variables per iteration |
| [Upload Image](./input/upload-image.md) | Upload or provide an image URL | Source images for image-to-video, editing, or composition |
| [Upload Video](./input/upload-video.md) | Upload or provide a video URL | Source video for processing, effects, or transformation |
| [Upload Audio](./input/upload-audio.md) | Upload or provide an audio URL | Source audio for TTS, lip sync, dubbing, or mixing |
| [RSS Feed](./input/rss-feed.md) | Pull content from RSS/Atom feeds | Automated content pipelines from blogs or news sources |
| [Web Scrape](./input/web-scrape.md) | Scrape Google Search, web pages, RSS, Instagram, or TikTok (5 actors, dynamic credit cost) | Data ingestion pipelines; seed generation workflows with live search results or social post metadata |
| [Video URL](./input/youtube-video.md) | Download video/audio from YouTube or other URLs | Import video from YouTube, TikTok, Instagram, Facebook, X |
| [Reference Audio](./input/reference-audio.md) | Extract audio from YouTube or uploaded video | Extract audio tracks for dubbing, remixing, or analysis |
| [Webhook Trigger](./input/webhook-trigger.md) | Trigger workflow via HTTP webhook endpoint | Integrate with external systems, APIs, n8n, or Zapier |
| [Schedule Trigger](./input/schedule-trigger.md) | Trigger workflow on a cron schedule | Daily content generation, recurring social posting |
| [Telegram Trigger](./input/telegram-trigger.md) | Trigger workflow when a Telegram bot receives a message | Run pipelines from chat messages, photos, or videos sent to your bot |

---

## Parameter Nodes

Configure shared settings that feed into multiple downstream nodes. These control generation behavior.

Parameter picker nodes have a typed colored output pip — click it to see which downstream nodes are connected to this picker, manage connections (disconnect, focus, connect to a new consumer), and drag-reorder where applicable.

### Generation parameters

Free-form or enum settings that feed AI / video / audio generation nodes via FieldMappings or direct text wiring.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Tone](./parameters/tone.md) | Define tone/style for AI generation | Set consistent tone across script and image generation |
| [Style Guide](./parameters/style-guide.md) | Visual style reference text | Maintain consistent visual aesthetics across generated assets |
| [Provider](./parameters/provider.md) | Select AI provider and model | Route generation to a specific model for downstream nodes |
| [Scene Count](./parameters/scene-count.md) | Specify number of scenes to generate | Control script generation output length |
| [Duration](./parameters/duration.md) | Set target duration in seconds | Define video or audio length for downstream nodes |
| [Aspect Ratio](./parameters/aspect-ratio.md) | Define video/image aspect ratio | Set consistent dimensions (16:9, 9:16, 1:1, 4:5) |
| [Motion](./parameters/motion.md) | Control motion intensity | Adjust video generation movement (subtle/moderate/dynamic) |

### Picker nodes — Look family

Visual style, mood, color, atmosphere, and aesthetic pickers. Wire into an AI image/video node's `cinematography` handle.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Setting](./parameters/setting.md) | Pick from 63 settings across indoor/urban/nature/fantastical | Establish where a shot takes place |
| [Atmosphere](./parameters/atmosphere.md) | Pick atmospheric conditions (fog, rain, smoke, ...) from 40 entries | Add weather, particles, and light scattering to a scene |
| [Style](./parameters/style.md) | Pick a visual style preset (cinematic, anime, oil-painting, ...) from 48 entries | Lock the overall aesthetic register |
| [Color / Look](./parameters/color-look.md) | Pick a color-grading look (warm, teal-orange, bleached, ...) from 41 entries | Set the chromatic signature of a frame |
| [Mood](./parameters/mood.md) | Pick a mood (calm, tense, melancholic, ...) from 50 entries | Anchor the emotional tone of a generation |
| [Photographer / Artist](./parameters/photographer.md) | Pick from 67 photographers, directors, illustrators, painters | Anchor in a recognizable creator-style canon |
| [Aesthetic / Microtrend](./parameters/aesthetic.md) | Pick a microtrend aesthetic (y2k, cottagecore, vaporwave, ...) from 46 entries | Tap into named visual subcultures |
| [Era / Period](./parameters/era.md) | Pick a historical era (1950s, ancient-rome, victorian, ...) from 32 entries | Set the chronological frame |
| [Photo Genre](./parameters/photo-genre.md) | Pick a photography genre (fashion-editorial, street, macro, ...) from 46 entries | Lock genre conventions |
| [Backdrop](./parameters/backdrop.md) | Pick a studio backdrop (white-seamless, cyc-wall, gradient, ...) from 40 entries | Studio / product / portrait composition |
| [Render Quality](./parameters/render-quality.md) | Pick a render-pipeline preset (raytracing, octane, unreal, ...) from 24 entries | Nudge toward CG/3D aesthetics |
| [Composition Effect](./parameters/composition-effects.md) | Pick a composition effect (bursting-through-frame, DoF, ...) from 19 entries | Compositional discipline |
| [Post-Process Effect](./parameters/post-process-effects.md) | Pick a post-processing effect (vignette, grain, light-leak, ...) from 18 entries | Finishing-pass aesthetics |
| [Action FX](./parameters/action-fx.md) | Pick environmental effects (multi-pick) from 72 entries | Earthquake, lightning, explosion, falling-objects — scene-event prompt injection |
| [Loop Subject](./parameters/loop-subject.md) | Pick a loop subject (tunnel, kaleidoscope, vortex, ...) from 35 entries | Seamlessly-looped video content |

### Picker nodes — Camera family

Lens, format, motion, transitions, and character-driven effects.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Camera Motion](./parameters/camera-motion.md) | Pick from 71 camera motions; graph-aware startState/endState handles | Set camera behavior (static, pan, dolly, zoom) for video generation |
| [Lens](./parameters/lens.md) | Pick from 16 lenses (wide-angle, normal-50mm, telephoto, fisheye, anamorphic, ...) | Set focal-length character |
| [Camera / Film Stock](./parameters/camera-format.md) | Pick from 31 camera/film formats (35mm, IMAX, super-8, polaroid, VHS, ...) | Specify recording medium |
| [Transition](./parameters/transition.md) | Pick a cinematic transition (76-entry catalog, 8 categories, multi-pick + timing fields) | Inject transition effects into AI-generated video clips (cross-dissolve, time-shift, morph, portal, glitch, etc.) |
| [Character FX](./parameters/character-fx.md) | Apply a character-driven effect (57 entries, 5 categories) with target ref name substitution | Animate transformations, fantastical powers, body modifications, or subject-bound auras on a named character |

### Picker nodes — Subject / Object family

Pose, material, animals, vehicles, weapons, props.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Pose](./parameters/pose.md) | Pick a pose from 81 entries (standing, sitting, action, dynamic) | Direct subject posture |
| [Material](./parameters/material.md) | Pick a material from 66 entries (silk, leather, metal, glass, marble, ...) | Set dominant surface/substance |
| [Animal](./parameters/animal.md) | Pick an animal from 126 entries with descriptions | Feature animals in a scene |
| [Vehicle](./parameters/vehicle.md) | Pick a vehicle from 107 entries with descriptions | Feature vehicles in a scene |
| [Weapon](./parameters/weapon.md) | Pick a weapon from 85 entries with descriptions | Action / fantasy / sci-fi / period work |
| [Held Prop](./parameters/held-prop.md) | Pick a held prop from 59 entries (smartphone, umbrella, bouquet, ...) | Add narrative texture to a portrait or scene |
| [Furniture](./parameters/furniture.md) | Pick a furniture piece from 78 entries across 9 categories | Furnish an interior scene with a specific, well-described piece |

### Picker nodes — Multi-dim composed pickers

Pickers that combine multiple independent dimensions into a single descriptor.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Framing](./parameters/framing.md) | Multi-dim: shot size + angle + coverage + composition + vantage (72 options across 5 fields) | Per-shot framing direction |
| [Lighting](./parameters/lighting.md) | Multi-dim: time-of-day + style + direction (72 options across 3 fields) | Compose a full lighting setup |
| [Person](./parameters/person.md) | Multi-dim: 20 attributes (type, age, ethnicity, build, face, hair, eyes, skin, …) — 547 options | Casting brief / recurring-character generation |
| [Styling](./parameters/styling.md) | Multi-dim: makeup + eyewear + headwear + hair + jewelry + nails + face-paint + fabric (262 options across 9 fields) | Fashion-editorial / character continuity |
| [Temporal](./parameters/temporal.md) | Multi-dim: speed + freeze + direction + shutter (18 options across 4 fields) | Time-based effects (slow-mo, freeze, reverse) |
| [Exposure Settings](./parameters/exposure-settings.md) | Multi-dim: aperture + shutter speed + ISO (20 options across 3 fields) | Photographic exposure-triangle direction |

### Picker nodes — Sound / Music / Voice

Music and voice-design pickers. Wire into Suno, Generate Music, Text-to-Audio, or ElevenLabs Voice Design.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Music Genre](./parameters/music-genre.md) | Pick genre + subgenre + era for music generation | Feed Suno Generate, Generate Music (MiniMax), Text to Audio |
| [Music Mood](./parameters/music-mood.md) | Pick energy + emotion + vibe for music generation | Feed Suno Generate, Generate Music (MiniMax), Text to Audio |
| [Instrumentation](./parameters/instrumentation.md) | Pick instruments + production style + vocal presence | Feed music generators; flips MiniMax `instrumental` flag |
| [Voice Character](./parameters/voice-character.md) | Pick age + gender + accent + timbre for ElevenLabs Voice Design | Compose voice descriptions for Voice Design |
| [Voice Delivery](./parameters/voice-delivery.md) | Pick pace + emotion + archetype for ElevenLabs Voice Design | Compose voice descriptions for Voice Design |

---

## AI Text Nodes

Generate, transform, or extract text using AI models.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Generate Script](./ai-text/generate-script.md) | AI multi-scene script with cinematography | Create structured video scripts with scene descriptions and camera directions |
| [Generate Text](./ai-text/llm-chat.md) | LLM text generation from a prompt (selectable model, optional image/video/audio refs). Two outputs: full `text` and a `===NEXT===`-split `items` fan-out list. Built-in + user templates; "Create N Image Nodes" fan-out | Rewrite/transform text, caption media, brainstorm, or fan out N image prompts |
| [QA Check](./ai-text/qa-check.md) | LLM quality gate — scores text 0.0-1.0, returns pass/fail + reason | Validate generated scripts or captions before they continue downstream |
| [Transcribe](./ai-text/transcribe.md) | Speech-to-text with diarization | Convert audio to text with speaker identification and timestamps |

---

## AI Image Nodes

Generate, edit, and transform images using 20+ AI providers.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Generate Image](./ai-image/generate-image.md) | AI image generation from text (23 providers) | Create images from prompts with style, aspect ratio, and quality controls |
| [Edit Image](./ai-image/edit-image.md) *(legacy API endpoint)* | Documents the legacy `edit-image` REST endpoint (upscale / remove-bg / nano-banana-edit). **Editor users:** use [Upscale Image](./ai-image/upscale-image.md), [Remove Background](./ai-image/remove-background.md), or [Modify Image](./ai-image/modify-image.md) instead. | Reference for `edit-image` API calls; new workflows should use the dedicated nodes |
| [Modify Image](./ai-image/modify-image.md) | Transform an image with a text prompt (20+ providers) | Prompt-driven editing: style transfer, inpainting, instruction edits |
| [Upscale Image](./ai-image/upscale-image.md) | Increase image resolution (Recraft, Topaz) | Enhance generated or uploaded images to 2K/4K/8K |
| [Remove Background](./ai-image/remove-background.md) | Strip the background to a transparent PNG (Recraft) | Cut out subjects for compositing or product shots |
| [Image to Image](./ai-image/image-to-image.md) *(legacy API endpoint)* | Documents the legacy `image-to-image` REST endpoint (20 providers). **Editor users:** use [Modify Image](./ai-image/modify-image.md) instead — it consolidates all prompt-driven image transformation. | Reference for `image-to-image` API calls; new workflows should use Modify Image |
| [Generate Mask](./ai-image/generate-mask.md) | Text-prompted segmentation mask (Grounded SAM) | Create a mask for inpainting from a description; passes image through for chaining |
| [Image Critic](./ai-image/image-critic.md) | Score an image on realism / character consistency / prompt adherence / anatomy / aesthetic / style-match via VLM | QC pipeline gates, automated regeneration loops with modify-image, batch quality scoring |
| [Describe Image](./ai-image/image-to-text.md) | Extract text description from image | Auto-caption images, extract prompts from art, accessibility |

---

## AI Video Nodes

Generate video from images, text, or other video using state-of-the-art models.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Generate Video](./ai-video/generate-video.md) | Unified video producer — text-only, image-to-video, first+last frame, reference mode, or video-edit (V2V) driven by which inputs are wired (`VIDEO_GEN_PROVIDERS` catalog); providers include VEO 3.x, Gemini Omni, Kling, Seedance 2, LTX 2.3, and more | Animate images, generate from text, run reference-driven multimodal mode (Seedance 2, VEO 3.x), or edit existing video (Gemini Omni) — one node, all modes |
| [Image to Video](./ai-video/image-to-video.md) (legacy) | Redirects to Generate Video; legacy `image-to-video` workflows auto-migrate on load | New workflows: use Generate Video instead |
| [Text to Video](./ai-video/text-to-video.md) (legacy) | Redirects to Generate Video; legacy `text-to-video` workflows auto-migrate on load | New workflows: use Generate Video instead |
| [Video to Video](./ai-video/video-to-video.md) | Transform video with text prompt | Style transfer or content modification on existing video |
| [AI Avatar](./ai-video/ai-avatar.md) | Talking-avatar video from a HeyGen avatar + script or wired audio | Generate presenter or spokesperson videos; two speech modes (script+voice / wired audio) |
| [Lip Sync](./ai-video/lip-sync.md) | Sync audio to character face | Create talking head videos from portrait + audio |
| [Video SFX](./ai-video/video-sfx.md) | Generate synced sound effects, foley, or ambience for a video (replaces existing audio) | Add SFX or atmosphere to silent or AI-generated clips via Replicate's mmaudio |
| [Face Swap](./ai-video/face-swap.md) | Replace face in video with reference image | Character replacement and creative remixing |
| [Speech to Video](./ai-video/speech-to-video.md) | Generate video from speech (Wan 2.2) | Create video driven by speech audio input |
| [Motion Transfer](./ai-video/motion-transfer.md) | Apply video motion to static character | Transfer movement from reference video to character image |
| [Extend Video](./ai-video/extend-video.md) | Continue video generation with new prompt | Extend VEO, Runway, or LTX 2.3 Pro video with new footage at the start or end |
| [Video Retake](./ai-video/video-retake.md) | Replace a time window of an existing video — audio, video, or both (LTX 2.3 Pro) | Surgically fix a few seconds of dialogue, repaint a botched shot, or re-score a specific beat |

---

## AI Audio & Speech Nodes

Text-to-speech, voice processing, and audio generation using ElevenLabs and other providers.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Text to Speech](./ai-audio/text-to-speech.md) | ElevenLabs TTS with 3 models, 46 languages | Convert text to natural speech with voice selection |
| [Text to Audio](./ai-audio/text-to-audio.md) | Generate ambient audio and sound effects | Create SFX, ambient sounds, or background audio from description |
| [Voice Extractor](./ai-audio/audio-isolation.md) | Isolate voice from mixed audio | Remove background noise, extract clean vocal track |
| [Text to Dialogue](./ai-audio/text-to-dialogue.md) | Multi-speaker dialogue generation | Create conversations with different voices per speaker |
| [Voice Changer](./ai-audio/voice-changer.md) | Revoice audio or a talking video | Replace the voice in audio — or a whole video — preserving emotion and timing |
| [Dubbing](./ai-audio/dubbing.md) | Translate audio preserving speaker identity | Translate spoken audio to another language |
| [Voice Remix](./ai-audio/voice-remix.md) | Generate voice from natural language description | Create custom voice from text description |
| [Voice Design](./ai-audio/voice-design.md) | Design custom voices with full controls | Create reusable voices with loudness, guidance, and quality controls |
| [Forced Alignment](./ai-audio/forced-alignment.md) | Word-level timestamp alignment | Get precise word timing for captions or animation sync |
| [Generate Music](./ai-audio/generate-music.md) | AI music generation (MiniMax) — for Suno use the dedicated Suno nodes | Create background music or full songs from prompts |

---

## Suno Music Nodes

Dedicated suite for music creation, editing, and manipulation powered by Suno AI.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Suno Voice](./suno-music/suno-voice.md) | Create a custom voice persona from a recording | Train a `voiceId` to sing on Suno Generate / Cover / Extend |
| [Suno Generate](./suno-music/suno-generate.md) | Generate full song from prompt and lyrics | Create complete songs with style, lyrics, and vocal control |
| [Suno Cover](./suno-music/suno-cover.md) | Create cover version of existing song | Re-record existing audio in a new style or voice |
| [Suno Extend](./suno-music/suno-extend.md) | Continue/extend existing Suno track | Add more content to a Suno-generated track |
| [Suno Lyrics](./suno-music/suno-lyrics.md) | Generate song lyrics from prompt | AI-write lyrics with structure (verse, chorus, bridge) |
| [Suno Separate](./suno-music/suno-separate.md) | Separate vocals and stems | Extract vocal/instrumental or full 12-stem separation |
| [Suno Music Video](./suno-music/suno-music-video.md) | Generate music video for track | Auto-create visual accompaniment for Suno audio |
| [Suno Mashup](./suno-music/suno-mashup.md) | Blend two tracks together | Combine two audio tracks into a mashup |
| [Suno Replace Section](./suno-music/suno-replace-section.md) | Replace section of track | Re-generate a specific time range within a track |
| [Suno Style Boost](./suno-music/suno-style-boost.md) | Enhance style of lyrics | Improve and refine style text for better generation |
| [Suno Add Instrumental](./suno-music/suno-add-instrumental.md) | Add instrumental to vocals | Generate backing track for vocal-only audio |
| [Suno Add Vocals](./suno-music/suno-add-vocals.md) | Add vocals to instrumental | Generate vocals for instrumental-only audio |
| [Suno Convert WAV](./suno-music/suno-convert-wav.md) | Convert MP3 to high-quality WAV | Get lossless audio from Suno output |
| [Suno Upload Extend](./suno-music/suno-upload-extend.md) | Extend non-Suno audio via Suno | Continue any uploaded audio using Suno's generation |

---

## Video Processing Nodes

FFmpeg-based video manipulation.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Combine Videos](./processing-video/combine-videos.md) | Concatenate videos with transitions | Join multiple clips with ~50 FFmpeg `xfade` transitions: cuts, fades, dips, wipes, slides, irises, slices, reveals, covers, blurs, and zooms |
| [Resize Video](./processing-video/resize-video.md) | Crop, pad, or stretch to target aspect ratio | Reformat video dimensions for different platforms |
| [Social Media Format](./processing-video/social-media-format.md) | Auto-format for platform specifications | Prepare video for Instagram, TikTok, YouTube, etc. |
| [Trim Video](./processing-video/trim-video.md) | Cut video to start/end times | Extract specific sections from longer video |
| [Extract Frame](./processing-video/extract-frame.md) | Pull a single still frame as a PNG | Capture last frame for i2v chaining, thumbnails, or reference stills |
| [Video Upscale](./processing-video/video-upscale.md) | Upscale resolution (Topaz, VEO) | Enhance video quality to 1080p, 4K, or 8K |
| [Add Captions](./processing-video/add-captions.md) | Generate and overlay captions on video | Add subtitles, word-highlight, or karaoke-style captions |
| [Adjust Speed](./processing-video/speed-ramp.md) | Change playback speed (0.25x-4x) | Create slow motion or time-lapse effects |
| [Loop Video](./processing-video/loop-video.md) | Repeat video for target duration | Extend short clips by looping |
| [Fade In/Out](./processing-video/fade-video.md) | Add fade transitions to video | Smooth intro/outro with black or white fades |
| [Transcode Video](./processing-video/transcode-video.md) | Convert video codec and resolution | Change codec (H.264/H.265), quality, or resolution |
| [Manual Edit](./processing-video/manual-edit.md) | Open video in web editor | Make manual adjustments in browser-based editor |
| [Remove Audio](./processing-video/remove-audio.md) | Strip the audio track, output a silent video | Mute a clip losslessly before adding new sound |

---

## Audio Processing Nodes

FFmpeg-based audio manipulation.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Split into Chunks](./processing-audio/split-media.md) | Divide a video or audio file into equal-duration segments (2 CR) | Batch transcription, per-scene processing, or chunked dubbing of long recordings |
| [Merge Video & Audio](./processing-audio/merge-video-audio.md) | Combine video with audio tracks | Add voiceover, music, or sound effects to video |
| [Extract Audio](./processing-audio/extract-audio.md) | Demux a video's audio track to MP3 | Pull audio from a video for transcription, dubbing, or reuse |
| [Trim Audio](./processing-audio/trim-audio.md) | Extract section of audio file | Cut specific time range from audio |
| [Mix Audio](./processing-audio/mix-audio.md) | Blend multiple audio tracks with levels | Layer voice, music, and SFX with volume control |
| [Combine Audio](./processing-audio/combine-audio.md) | Concatenate audio tracks end-to-end, with per-segment trim | Join clips sequentially (vs. Mix Audio's layering) |
| [Adjust Volume](./processing-audio/adjust-volume.md) | Change volume and add fade transitions | Normalize, boost, or fade audio tracks |

---

## Text Processing Nodes

Simple text manipulation utilities.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Combine Text](./processing-text/combine-text.md) | Concatenate text with custom separator | Join multiple text outputs into one |
| [Split Text](./processing-text/split-text.md) | Split text by delimiter into list | Break text into items for batch processing |

---

## Video Composition Nodes

AI-powered video composition and rendering. Create professional video productions from assets and prompts.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Compose Video](./composition/video-composer.md) | AI scene-graph video composition from text | Build track-based video from natural language description |
| [After Effects](./composition/after-effects.md) | AI-generated post-processing effects | Apply color grading, vignette, grain, blur, letterbox to video |
| [Lottie Overlay](./composition/lottie-overlay.md) | AI-placed timed Lottie animations over video | Add confetti, particles, animated graphics at specific times |
| [3D Title](./composition/3d-title.md) | AI animated 3D text scenes | Create cinematic 3D title cards with particles and lighting |
| [Motion Graphics](./composition/motion-graphics.md) | AI 2D motion graphics generation | Create lower thirds, title cards, kinetic typography |
| [Composite](./composition/composite.md) | Multi-layer video compositing | Picture-in-picture, split screen, overlay with blend modes |
| [Render Video](./composition/render-video.md) | Finalize composition to video file | Render any composition plan to final video output |
| [Scene](./composition/scene.md) | Cloud-only. Pipeline-managed scene container with shot list, camera, motion. Created by the Story → Video pipeline (Phase 1B.2). | Populated by the Scene Director LLM in Stage 5; animated by the pipeline orchestrator in Phase 1C |

---

## Asset Nodes

Create reusable character, object, location, and face assets with multiple variations for consistent generation across workflows.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Create Character](./assets/character.md) | Multi-variation character assets, built in the full-screen Character Studio | Define characters with expressions, poses, motions, lighting, voice, and personality |
| [Create Object](./assets/object.md) | Object with angles, materials, variations | Define props with multiple viewing angles and material options |
| [Create Location](./assets/location.md) | Environment with time/weather variations | Define settings with time-of-day and weather variations |
| [Create Face](./assets/face.md) | Facial asset for lip-sync and replacement | Maintain facial identity across generated images and video |

---

## Output Nodes

Deliver results to storage, webhooks, or social media platforms.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Save to Storage](./output/save-to-storage.md) | Export final asset to cloud storage | Persist generated content to R2 cloud storage |
| [Webhook Output](./output/webhook-output.md) | Send result to external webhook URL | Deliver results to external systems or APIs |
| [Instagram Post](./output/instagram-post.md) | Publish to Instagram | Post images, reels, stories, or carousels |
| [TikTok Post](./output/tiktok-post.md) | Publish to TikTok | Upload video content to TikTok |
| [YouTube Upload](./output/youtube-upload.md) | Upload to YouTube | Publish videos or shorts with title, tags, privacy |
| [LinkedIn Post](./output/linkedin-post.md) | Post to LinkedIn | Share text, images, or video on LinkedIn |
| [X Post](./output/x-post.md) | Post to X/Twitter | Share content on X (280 char limit) |
| [Facebook Post](./output/facebook-post.md) | Post to Facebook | Share text, images, video, or stories |
| [Telegram Post](./output/telegram-post.md) | Send a message, photo, or video to Telegram | Publish to a Telegram chat, channel, or group via a bot |

---

## Workflow Nodes

Build modular, reusable workflows with sub-workflow nesting.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Sub-Workflow Input](./workflow/sub-workflow-input.md) | Define input ports for nested workflow | Create reusable workflow entry points with typed ports |
| [Sub-Workflow Output](./workflow/sub-workflow-output.md) | Define output ports for nested workflow | Define what a sub-workflow returns to its caller |
| [Sub-Workflow](./workflow/sub-workflow.md) | Embed another workflow as a node, with inline editing and breadcrumb nesting | Compose complex pipelines from reusable workflow modules -- create a fresh child or reference an existing standalone workflow |
| [Component](./workflow/component.md) | Embed a published Nodaro Component (versioned marketplace sub-workflow) with exposed settings | Drop a community or personal published component into any workflow; configure its inputs and settings inline |

---

## Generative Pipelines

Multi-stage AI pipelines that generate an editable Nodaro graph from a single prompt. Cloud edition only.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Story → Video](./generative/generative-pipeline.md) | Cloud-only. Variable cost (~30 cr in Phase 1A). Orchestrates Detection (Haiku) → Showrunner (Opus) → Script + Cast Coverage Critics (Sonnet) under approval gates. | Generate a complete cinematic workflow from a single story prompt; review and approve at each stage |

---

## Utility Nodes

Helpers for debugging and workflow organization.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Preview](./utility/preview.md) | Display text, image, video, or audio in editor | Debug and inspect intermediate results |
| [Reduce](./utility/reduce.md) | Fan-in N upstream values into 1 via a strategy (pick-best-llm / concat / first-non-empty / count / vote / merge-json) | Close a List fan-out — pick the best variant, count survivors, or merge JSON |
| [Selector](./utility/selector.md) | Pick item(s) from a list — 7 modes (item / range / list / random / modulo / predicate / named-key); two outputs: `picked` + `rest` | Share a single selection across multiple consumers, route rejected items, or reach operators the edge selector doesn't support |
| [Sticky Note](./utility/sticky-note.md) | Annotated notes on workflow canvas | Document workflow logic and leave notes for collaborators |
| [Group](./utility/group.md) | Spatial container that aggregates children's outputs by type | Organize related nodes; fan out per-type arrays into list-aware consumers |
| [Collect](./utility/collect.md) | Aggregate multiple inputs into per-type arrays | Merge outputs from many nodes into ordered per-type lists |
| [Filter List](./utility/filter-list.md) | Keep list items matching one or more conditions (AND/OR) | Narrow a scraped or generated list before fan-out |
| [Sort List](./utility/sort-list.md) | Sort a list by value or field (text/number/date, asc/desc) | Order items by score, date, or name |
| [Deduplicate](./utility/deduplicate.md) | Remove duplicate list items by value or field | Drop repeats from scraped or merged lists |
| [Merge Lists](./utility/merge-lists.md) | Combine lists by concatenation or element-wise zip | Join parallel lists; inject a shared value into every item |
| [JSON Process](./utility/json-process.md) | Filter, project, and extract paths from JSON data | Reshape scraped/API JSON; drill into nested payloads |
| [Extract Field](./utility/extract-field.md) | Pull a specific field or dot-notation path from upstream JSON | Extract `title`, `url`, or a nested property from Web Scrape or JSON Process output |
| [Router](./utility/router.md) | Split execution into named routes via radio, checkbox, or data-driven conditional rules | Build branching workflows, A/B paths, or data-conditional pipelines |
| [Teleport Send](./utility/teleport-send.md) | Broadcast a value on a named channel without a visible wire | Declutter large canvases; share one upstream value with distant or multiple downstream nodes |
| [Teleport Receive](./utility/teleport-receive.md) | Receive a value from a Teleport Send on the same channel | Pick up a wirelessly broadcast value anywhere on the canvas |

---