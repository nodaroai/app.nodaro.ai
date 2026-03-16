# Nodaro.ai Node Reference

Complete reference for all nodes available in the Nodaro.ai visual workflow editor.

## Quick Reference

- **Total Nodes:** 90+
- **Categories:** 15
- **Credit Range:** 0 (free processing) to 189 (premium video generation)
- **1 Credit = $0.02 USD**

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
- [Utility Nodes](#utility-nodes)

---

## Input Nodes

Provide data to your workflow: text, images, video, audio, or external triggers. These are typically the starting points of any workflow.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Text Prompt](./input/text-prompt.md) | User-provided text input with variable support | 0 | Provide prompts, descriptions, or text data to downstream nodes |
| [List](./input/list.md) | Create a list of items for iteration | 0 | Batch process multiple prompts or subjects |
| [Loop](./input/loop.md) | Table-based loop with columns and rows | 0 | Structured batch workflows with multiple variables per iteration |
| [Upload Image](./input/upload-image.md) | Upload or provide an image URL | 0 | Source images for image-to-video, editing, or composition |
| [Upload Video](./input/upload-video.md) | Upload or provide a video URL | 0 | Source video for processing, effects, or transformation |
| [Upload Audio](./input/upload-audio.md) | Upload or provide an audio URL | 0 | Source audio for TTS, lip sync, dubbing, or mixing |
| [RSS Feed](./input/rss-feed.md) | Pull content from RSS/Atom feeds | 0 | Automated content pipelines from blogs or news sources |
| [Video URL](./input/youtube-video.md) | Download video/audio from YouTube or other URLs | 0 | Import video from YouTube, TikTok, Instagram, Facebook, X |
| [Reference Audio](./input/reference-audio.md) | Extract audio from YouTube or uploaded video | 0 | Extract audio tracks for dubbing, remixing, or analysis |
| [Webhook Trigger](./input/webhook-trigger.md) | Trigger workflow via HTTP webhook endpoint | 0 | Integrate with external systems, APIs, n8n, or Zapier |
| [Schedule Trigger](./input/schedule-trigger.md) | Trigger workflow on a cron schedule | 0 | Daily content generation, recurring social posting |

---

## Parameter Nodes

Configure shared settings that feed into multiple downstream nodes. These control generation behavior without consuming credits.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Tone](./parameters/tone.md) | Define tone/style for AI generation | 0 | Set consistent tone across script and image generation |
| [Style Guide](./parameters/style-guide.md) | Visual style reference text | 0 | Maintain consistent visual aesthetics across generated assets |
| [Provider](./parameters/provider.md) | Select AI provider and model | 0 | Route generation to a specific model for downstream nodes |
| [Scene Count](./parameters/scene-count.md) | Specify number of scenes to generate | 0 | Control script generation output length |
| [Duration](./parameters/duration.md) | Set target duration in seconds | 0 | Define video or audio length for downstream nodes |
| [Aspect Ratio](./parameters/aspect-ratio.md) | Define video/image aspect ratio | 0 | Set consistent dimensions (16:9, 9:16, 1:1, 4:5) |
| [Motion](./parameters/motion.md) | Control motion intensity | 0 | Adjust video generation movement (subtle/moderate/dynamic) |
| [Camera Motion](./parameters/camera-motion.md) | Define camera movement type | 0 | Set camera behavior (static, pan, zoom) for video generation |

---

## AI Text Nodes

Generate, transform, or extract text using AI models.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Generate Script](./ai-text/generate-script.md) | AI multi-scene script with cinematography | 10 | Create structured video scripts with scene descriptions and camera directions |
| [AI Agent](./ai-text/ai-writer.md) | General-purpose AI text generation (Claude Sonnet) | 5 | Rewrite text, generate descriptions, brainstorm, create captions |
| [Transcribe](./ai-text/transcribe.md) | Speech-to-text with diarization | 2 | Convert audio to text with speaker identification and timestamps |

---

## AI Image Nodes

Generate, edit, and transform images using 20+ AI providers.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Generate Image](./ai-image/generate-image.md) | AI image generation from text (21 providers) | 1-8 | Create images from prompts with style, aspect ratio, and quality controls |
| [Edit Image](./ai-image/edit-image.md) | Upscale, remove background, or AI-edit images | 1-13 | Enhance, upscale, or modify existing images |
| [Image to Image](./ai-image/image-to-image.md) | Transform image with AI prompt (15 providers) | 2-8 | Style transfer, inpainting, reframing, or prompt-guided transformation |
| [Describe Image](./ai-image/image-to-text.md) | Extract text description from image | 5 | Auto-caption images, extract prompts from art, accessibility |

---

## AI Video Nodes

Generate video from images, text, or other video using state-of-the-art models.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Image to Video](./ai-video/image-to-video.md) | Generate video from static image (21 providers) | 4-189 | Animate images with VEO, Kling, Sora, Minimax, Runway, and more |
| [Text to Video](./ai-video/text-to-video.md) | Generate video from text prompt (15 providers) | 4-189 | Create video directly from text descriptions |
| [Video to Video](./ai-video/video-to-video.md) | Transform video with text prompt | 22-35 | Style transfer or content modification on existing video |
| [Lip Sync](./ai-video/lip-sync.md) | Sync audio to character face | 19-56 | Create talking head videos from portrait + audio |
| [Speech to Video](./ai-video/speech-to-video.md) | Generate video from speech (Wan 2.2) | 4-8 | Create video driven by speech audio input |
| [Sora Storyboard](./ai-video/sora-storyboard.md) | Multi-shot video from scene descriptions | 47-85 | Create multi-scene video with per-shot control |
| [Motion Transfer](./ai-video/motion-transfer.md) | Apply video motion to static character | 2-188 | Transfer movement from reference video to character image |
| [Extend Video](./ai-video/extend-video.md) | Continue video generation with new prompt | 19-79 | Extend VEO or Runway-generated video with new directions |

---

## AI Audio & Speech Nodes

Text-to-speech, voice processing, and audio generation using ElevenLabs and other providers.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Text to Speech](./ai-audio/text-to-speech.md) | ElevenLabs TTS with 3 models, 46 languages | 2-4 | Convert text to natural speech with voice selection |
| [Text to Audio](./ai-audio/text-to-audio.md) | Generate ambient audio and sound effects | 1 | Create SFX, ambient sounds, or background audio from description |
| [Voice Extractor](./ai-audio/audio-isolation.md) | Isolate voice from mixed audio | 1 | Remove background noise, extract clean vocal track |
| [Text to Dialogue](./ai-audio/text-to-dialogue.md) | Multi-speaker dialogue generation | 5 | Create conversations with different voices per speaker |
| [Voice Changer](./ai-audio/voice-changer.md) | Convert audio to different voice | 4 | Transform speech to another voice while preserving emotion |
| [Dubbing](./ai-audio/dubbing.md) | Translate audio preserving speaker identity | 8 | Translate spoken audio to another language |
| [Voice Remix](./ai-audio/voice-remix.md) | Generate voice from natural language description | 4 | Create custom voice from text description |
| [Voice Design](./ai-audio/voice-design.md) | Design custom voices with full controls | 5 | Create reusable voices with loudness, guidance, and quality controls |
| [Forced Alignment](./ai-audio/forced-alignment.md) | Word-level timestamp alignment | 3 | Get precise word timing for captions or animation sync |
| [Generate Music](./ai-audio/generate-music.md) | AI music generation (Suno, Udio) | 7-13 | Create background music or full songs from prompts |

---

## Suno Music Nodes

Dedicated suite for music creation, editing, and manipulation powered by Suno AI.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Suno Generate](./suno-music/suno-generate.md) | Generate full song from prompt and lyrics | 7-13 | Create complete songs with style, lyrics, and vocal control |
| [Suno Cover](./suno-music/suno-cover.md) | Create cover version of existing song | 7 | Re-record existing audio in a new style or voice |
| [Suno Extend](./suno-music/suno-extend.md) | Continue/extend existing Suno track | 7 | Add more content to a Suno-generated track |
| [Suno Lyrics](./suno-music/suno-lyrics.md) | Generate song lyrics from prompt | 2 | AI-write lyrics with structure (verse, chorus, bridge) |
| [Suno Separate](./suno-music/suno-separate.md) | Separate vocals and stems | 5-16 | Extract vocal/instrumental or full 12-stem separation |
| [Suno Music Video](./suno-music/suno-music-video.md) | Generate music video for track | 5 | Auto-create visual accompaniment for Suno audio |
| [Suno Mashup](./suno-music/suno-mashup.md) | Blend two tracks together | 4 | Combine two audio tracks into a mashup |
| [Suno Replace Section](./suno-music/suno-replace-section.md) | Replace section of track | 2 | Re-generate a specific time range within a track |
| [Suno Style Boost](./suno-music/suno-style-boost.md) | Enhance style of lyrics | 1 | Improve and refine style text for better generation |
| [Suno Add Instrumental](./suno-music/suno-add-instrumental.md) | Add instrumental to vocals | 4 | Generate backing track for vocal-only audio |
| [Suno Add Vocals](./suno-music/suno-add-vocals.md) | Add vocals to instrumental | 4 | Generate vocals for instrumental-only audio |
| [Suno Convert WAV](./suno-music/suno-convert-wav.md) | Convert MP3 to high-quality WAV | 1 | Get lossless audio from Suno output |
| [Suno Upload Extend](./suno-music/suno-upload-extend.md) | Extend non-Suno audio via Suno | 4 | Continue any uploaded audio using Suno's generation |

---

## Video Processing Nodes

FFmpeg-based video manipulation. Most processing nodes cost 0 credits.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Combine Videos](./processing-video/combine-videos.md) | Concatenate videos with transitions | 0 | Join multiple clips with fade, dissolve, or cut transitions |
| [Resize Video](./processing-video/resize-video.md) | Crop, pad, or stretch to target aspect ratio | 0 | Reformat video dimensions for different platforms |
| [Social Media Format](./processing-video/social-media-format.md) | Auto-format for platform specifications | 0 | Prepare video for Instagram, TikTok, YouTube, etc. |
| [Trim Video](./processing-video/trim-video.md) | Cut video to start/end times | 0 | Extract specific sections from longer video |
| [Video Upscale](./processing-video/video-upscale.md) | Upscale resolution (Topaz, VEO) | 2-38 | Enhance video quality to 1080p, 4K, or 8K |
| [Add Captions](./processing-video/add-captions.md) | Generate and overlay captions on video | 0 | Add subtitles, word-highlight, or karaoke-style captions |
| [Adjust Speed](./processing-video/speed-ramp.md) | Change playback speed (0.25x-4x) | 0 | Create slow motion or time-lapse effects |
| [Loop Video](./processing-video/loop-video.md) | Repeat video for target duration | 0 | Extend short clips by looping |
| [Fade In/Out](./processing-video/fade-video.md) | Add fade transitions to video | 0 | Smooth intro/outro with black or white fades |
| [Transcode Video](./processing-video/transcode-video.md) | Convert video codec and resolution | 0 | Change codec (H.264/H.265), quality, or resolution |
| [Manual Edit](./processing-video/manual-edit.md) | Open video in web editor | 0 | Make manual adjustments in browser-based editor |

---

## Audio Processing Nodes

FFmpeg-based audio manipulation. All cost 0 credits.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Merge Video & Audio](./processing-audio/merge-video-audio.md) | Combine video with audio tracks | 0 | Add voiceover, music, or sound effects to video |
| [Trim Audio](./processing-audio/trim-audio.md) | Extract section of audio file | 0 | Cut specific time range from audio |
| [Mix Audio](./processing-audio/mix-audio.md) | Blend multiple audio tracks with levels | 0 | Layer voice, music, and SFX with volume control |
| [Adjust Volume](./processing-audio/adjust-volume.md) | Change volume and add fade transitions | 0 | Normalize, boost, or fade audio tracks |

---

## Text Processing Nodes

Simple text manipulation utilities. All cost 0 credits.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Combine Text](./processing-text/combine-text.md) | Concatenate text with custom separator | 0 | Join multiple text outputs into one |
| [Split Text](./processing-text/split-text.md) | Split text by delimiter into list | 0 | Break text into items for batch processing |

---

## Video Composition Nodes

AI-powered video composition and rendering. Create professional video productions from assets and prompts.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Compose Video](./composition/video-composer.md) | AI scene-graph video composition from text | 10 | Build track-based video from natural language description |
| [After Effects](./composition/after-effects.md) | AI-generated post-processing effects | 10 | Apply color grading, vignette, grain, blur, letterbox to video |
| [Lottie Overlay](./composition/lottie-overlay.md) | AI-placed timed Lottie animations over video | 10 | Add confetti, particles, animated graphics at specific times |
| [3D Title](./composition/3d-title.md) | AI animated 3D text scenes | 15 | Create cinematic 3D title cards with particles and lighting |
| [Motion Graphics](./composition/motion-graphics.md) | AI 2D motion graphics generation | 10 | Create lower thirds, title cards, kinetic typography |
| [Composite](./composition/composite.md) | Multi-layer video compositing | 0 | Picture-in-picture, split screen, overlay with blend modes |
| [Render Video](./composition/render-video.md) | Finalize composition to video file | 15 | Render any composition plan to final video output |

---

## Asset Nodes

Create reusable character, object, location, and face assets with multiple variations for consistent generation across workflows.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Create Character](./assets/character.md) | Multi-pose/expression character assets | 2 | Define characters with angles, expressions, poses, lighting |
| [Create Object](./assets/object.md) | Object with angles, materials, variations | 2 | Define props with multiple viewing angles and material options |
| [Create Location](./assets/location.md) | Environment with time/weather variations | 2 | Define settings with time-of-day and weather variations |
| [Create Face](./assets/face.md) | Facial asset for lip-sync and replacement | 2 | Maintain facial identity across generated images and video |

---

## Output Nodes

Deliver results to storage, webhooks, or social media platforms.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Save to Storage](./output/save-to-storage.md) | Export final asset to cloud storage | 0 | Persist generated content to R2 cloud storage |
| [Webhook Output](./output/webhook-output.md) | Send result to external webhook URL | 0 | Deliver results to external systems or APIs |
| [Instagram Post](./output/instagram-post.md) | Publish to Instagram | 1 | Post images, reels, stories, or carousels |
| [TikTok Post](./output/tiktok-post.md) | Publish to TikTok | 1 | Upload video content to TikTok |
| [YouTube Upload](./output/youtube-upload.md) | Upload to YouTube | 1 | Publish videos or shorts with title, tags, privacy |
| [LinkedIn Post](./output/linkedin-post.md) | Post to LinkedIn | 1 | Share text, images, or video on LinkedIn |
| [X Post](./output/x-post.md) | Post to X/Twitter | 1 | Share content on X (280 char limit) |
| [Facebook Post](./output/facebook-post.md) | Post to Facebook | 1 | Share text, images, video, or stories |

---

## Workflow Nodes

Build modular, reusable workflows with sub-workflow nesting.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Sub-Workflow Input](./workflow/sub-workflow-input.md) | Define input ports for nested workflow | 0 | Create reusable workflow entry points with typed ports |
| [Sub-Workflow Output](./workflow/sub-workflow-output.md) | Define output ports for nested workflow | 0 | Define what a sub-workflow returns to its caller |
| [Sub-Workflow](./workflow/sub-workflow.md) | Execute another workflow as a step | 0 | Compose complex pipelines from reusable workflow modules |

---

## Utility Nodes

Helpers for debugging and workflow organization.

| Node | Description | Credits | When to Use |
|------|-------------|---------|-------------|
| [Preview](./utility/preview.md) | Display text, image, video, or audio in editor | 0 | Debug and inspect intermediate results |
| [Sticky Note](./utility/sticky-note.md) | Annotated notes on workflow canvas | 0 | Document workflow logic and leave notes for collaborators |

---

## Credit Cost Quick Reference

| Category | Range | Notes |
|----------|-------|-------|
| Input / Parameters | 0 | Always free |
| AI Text | 2-10 | Script generation costs more than simple text ops |
| AI Image | 1-13 | Varies by provider and quality/resolution |
| AI Video | 4-189 | Kling 3.0 15s with audio is most expensive |
| AI Audio | 1-8 | TTS is 2-4, dubbing is 8 |
| Suno Music | 1-16 | Full stem separation is most expensive |
| Video Processing | 0 | FFmpeg-based, always free (except upscale) |
| Audio Processing | 0 | FFmpeg-based, always free |
| Text Processing | 0 | Always free |
| Composition | 0-15 | Composite is free; AI composition + render costs credits |
| Assets | 2 | Per asset generation |
| Output | 0-1 | Social posts cost 1 credit each |
| Workflow | 0 | Always free |
| Utility | 0 | Always free |
