# Nodaro.ai Node Reference

Complete reference for all nodes available in the Nodaro.ai visual workflow editor.

## Quick Reference

- **Total Nodes:** 90+
- **Categories:** 15

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
| [Text Prompt](./input/text-prompt.md) | User-provided text input with variable support | Provide prompts, descriptions, or text data to downstream nodes |
| [List](./input/list.md) | Create a list of items for iteration | Batch process multiple prompts or subjects |
| [Loop](./input/loop.md) | Table-based loop with columns and rows | Structured batch workflows with multiple variables per iteration |
| [Upload Image](./input/upload-image.md) | Upload or provide an image URL | Source images for image-to-video, editing, or composition |
| [Upload Video](./input/upload-video.md) | Upload or provide a video URL | Source video for processing, effects, or transformation |
| [Upload Audio](./input/upload-audio.md) | Upload or provide an audio URL | Source audio for TTS, lip sync, dubbing, or mixing |
| [RSS Feed](./input/rss-feed.md) | Pull content from RSS/Atom feeds | Automated content pipelines from blogs or news sources |
| [Video URL](./input/youtube-video.md) | Download video/audio from YouTube or other URLs | Import video from YouTube, TikTok, Instagram, Facebook, X |
| [Reference Audio](./input/reference-audio.md) | Extract audio from YouTube or uploaded video | Extract audio tracks for dubbing, remixing, or analysis |
| [Webhook Trigger](./input/webhook-trigger.md) | Trigger workflow via HTTP webhook endpoint | Integrate with external systems, APIs, n8n, or Zapier |
| [Schedule Trigger](./input/schedule-trigger.md) | Trigger workflow on a cron schedule | Daily content generation, recurring social posting |

---

## Parameter Nodes

Configure shared settings that feed into multiple downstream nodes. These control generation behavior.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Tone](./parameters/tone.md) | Define tone/style for AI generation | Set consistent tone across script and image generation |
| [Style Guide](./parameters/style-guide.md) | Visual style reference text | Maintain consistent visual aesthetics across generated assets |
| [Provider](./parameters/provider.md) | Select AI provider and model | Route generation to a specific model for downstream nodes |
| [Scene Count](./parameters/scene-count.md) | Specify number of scenes to generate | Control script generation output length |
| [Duration](./parameters/duration.md) | Set target duration in seconds | Define video or audio length for downstream nodes |
| [Aspect Ratio](./parameters/aspect-ratio.md) | Define video/image aspect ratio | Set consistent dimensions (16:9, 9:16, 1:1, 4:5) |
| [Motion](./parameters/motion.md) | Control motion intensity | Adjust video generation movement (subtle/moderate/dynamic) |
| [Camera Motion](./parameters/camera-motion.md) | Define camera movement type | Set camera behavior (static, pan, zoom) for video generation |
| [Transition](./parameters/transition.md) | Pick a cinematic transition between frames (76-entry catalog, 8 categories, multi-pick + timing fields) | Inject transition effects into AI-generated video clips (cross-dissolve, time-shift, morph, portal, glitch, etc.) |
| [Character FX](./parameters/character-fx.md) | Apply a character-driven effect (transformation, power, body-mod, face FX, aura) with target ref name substitution | Animate transformations, fantastical powers, body modifications, or subject-bound auras on a named character |
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
| [AI Agent](./ai-text/ai-writer.md) | General-purpose AI text generation (Claude Sonnet) | Rewrite text, generate descriptions, brainstorm, create captions |
| [Transcribe](./ai-text/transcribe.md) | Speech-to-text with diarization | Convert audio to text with speaker identification and timestamps |

---

## AI Image Nodes

Generate, edit, and transform images using 20+ AI providers.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Generate Image](./ai-image/generate-image.md) | AI image generation from text (21 providers) | Create images from prompts with style, aspect ratio, and quality controls |
| [Edit Image](./ai-image/edit-image.md) | Upscale, remove background, or AI-edit images | Enhance, upscale, or modify existing images |
| [Image to Image](./ai-image/image-to-image.md) | Transform image with AI prompt (15 providers) | Style transfer, inpainting, reframing, or prompt-guided transformation |
| [Generate Mask](./ai-image/generate-mask.md) | Text-prompted segmentation mask (Grounded SAM) | Create a mask for inpainting from a description; passes image through for chaining |
| [Describe Image](./ai-image/image-to-text.md) | Extract text description from image | Auto-caption images, extract prompts from art, accessibility |

---

## AI Video Nodes

Generate video from images, text, or other video using state-of-the-art models.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Image to Video](./ai-video/image-to-video.md) | Generate video from static image (21 providers) | Animate images with VEO, Kling, Sora, Minimax, Runway, and more |
| [Text to Video](./ai-video/text-to-video.md) | Generate video from text prompt (15 providers) | Create video directly from text descriptions |
| [Video to Video](./ai-video/video-to-video.md) | Transform video with text prompt | Style transfer or content modification on existing video |
| [Lip Sync](./ai-video/lip-sync.md) | Sync audio to character face | Create talking head videos from portrait + audio |
| [Face Swap](./ai-video/face-swap.md) | Replace face in video with reference image | Character replacement and creative remixing |
| [Speech to Video](./ai-video/speech-to-video.md) | Generate video from speech (Wan 2.2) | Create video driven by speech audio input |
| [Sora Storyboard](./ai-video/sora-storyboard.md) | Multi-shot video from scene descriptions | Create multi-scene video with per-shot control |
| [Motion Transfer](./ai-video/motion-transfer.md) | Apply video motion to static character | Transfer movement from reference video to character image |
| [Extend Video](./ai-video/extend-video.md) | Continue video generation with new prompt | Extend VEO or Runway-generated video with new directions |

---

## AI Audio & Speech Nodes

Text-to-speech, voice processing, and audio generation using ElevenLabs and other providers.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Text to Speech](./ai-audio/text-to-speech.md) | ElevenLabs TTS with 3 models, 46 languages | Convert text to natural speech with voice selection |
| [Text to Audio](./ai-audio/text-to-audio.md) | Generate ambient audio and sound effects | Create SFX, ambient sounds, or background audio from description |
| [Voice Extractor](./ai-audio/audio-isolation.md) | Isolate voice from mixed audio | Remove background noise, extract clean vocal track |
| [Text to Dialogue](./ai-audio/text-to-dialogue.md) | Multi-speaker dialogue generation | Create conversations with different voices per speaker |
| [Voice Changer](./ai-audio/voice-changer.md) | Convert audio to different voice | Transform speech to another voice while preserving emotion |
| [Dubbing](./ai-audio/dubbing.md) | Translate audio preserving speaker identity | Translate spoken audio to another language |
| [Voice Remix](./ai-audio/voice-remix.md) | Generate voice from natural language description | Create custom voice from text description |
| [Voice Design](./ai-audio/voice-design.md) | Design custom voices with full controls | Create reusable voices with loudness, guidance, and quality controls |
| [Forced Alignment](./ai-audio/forced-alignment.md) | Word-level timestamp alignment | Get precise word timing for captions or animation sync |
| [Generate Music](./ai-audio/generate-music.md) | AI music generation (Suno, Udio) | Create background music or full songs from prompts |

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
| [Combine Videos](./processing-video/combine-videos.md) | Concatenate videos with transitions | Join multiple clips with fade, dissolve, or cut transitions |
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

---

## Audio Processing Nodes

FFmpeg-based audio manipulation.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Merge Video & Audio](./processing-audio/merge-video-audio.md) | Combine video with audio tracks | Add voiceover, music, or sound effects to video |
| [Trim Audio](./processing-audio/trim-audio.md) | Extract section of audio file | Cut specific time range from audio |
| [Mix Audio](./processing-audio/mix-audio.md) | Blend multiple audio tracks with levels | Layer voice, music, and SFX with volume control |
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

---

## Workflow Nodes

Build modular, reusable workflows with sub-workflow nesting.

| Node | Description | When to Use |
|------|-------------|-------------|
| [Sub-Workflow Input](./workflow/sub-workflow-input.md) | Define input ports for nested workflow | Create reusable workflow entry points with typed ports |
| [Sub-Workflow Output](./workflow/sub-workflow-output.md) | Define output ports for nested workflow | Define what a sub-workflow returns to its caller |
| [Sub-Workflow](./workflow/sub-workflow.md) | Embed another workflow as a node, with inline editing and breadcrumb nesting | Compose complex pipelines from reusable workflow modules -- create a fresh child or reference an existing standalone workflow |

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
| [Sticky Note](./utility/sticky-note.md) | Annotated notes on workflow canvas | Document workflow logic and leave notes for collaborators |

---