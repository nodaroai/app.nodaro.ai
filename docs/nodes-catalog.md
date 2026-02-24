# Nodaro.ai — Node Catalog

**73 nodes across 11 categories**

---

## Input (9 nodes)

| Node | Description |
|------|-------------|
| Text Prompt | Free-text input with variable interpolation |
| List | Multi-item text list for batch/iteration |
| Loop | Spreadsheet-style data table; rows drive parallel branches |
| Upload Image | Upload or reference an image from storage |
| Upload Video | Upload or reference a video from storage |
| Upload Audio | Upload or reference an audio file from storage |
| RSS Feed | Fetch items from an RSS feed URL |
| Video URL | Download a YouTube video by URL |
| Reference Audio | Source audio from YouTube, URL, or upload |

## Parameter (8 nodes)

All parameter nodes cost 0 credits. They act as configuration knobs that feed into AI and processing nodes.

| Node | Description |
|------|-------------|
| Tone | Selects a tone style (dramatic, uplifting, etc.) |
| Style Guide | Free-text visual style description |
| Provider | Selects AI provider and model per category |
| Scene Count | Number of scenes to generate |
| Duration | Target length in seconds |
| Aspect Ratio | Output ratio (1:1, 16:9, 9:16, 4:3, 4:5) |
| Motion | Motion intensity (subtle/moderate/dynamic) |
| Camera Motion | Camera movement type (static, pan, zoom) |

## AI (26 nodes)

| Node | Credits | Description |
|------|---------|-------------|
| Generate Script | 2 | Multi-scene video script via Gemini/Claude |
| Generate Image | 4-12 | Text-to-image (nano-banana, flux, grok, gpt-image) |
| Edit Image | 4-6 | Upscale, remove BG, AI inpainting |
| Image to Image | 4-12 | Transform image with prompt, retains structure |
| Image to Video | 1-40 | Animate still image into video clip |
| Text to Video | 1-40 | Pure text-prompt video generation |
| Video to Video | 25 | Prompt-guided video transformation (Wan 2.6) |
| Text to Speech | 1 | ElevenLabs Turbo/Multilingual voices |
| Generate Music | 1 | Background music from prompt |
| Text to Audio | 1 | Sound effects from text description |
| Suno Generate | 3 | Full song generation (V4-V5) |
| Suno Cover | 3 | AI cover version of a song |
| Suno Extend | 3 | Extend an existing Suno track |
| Suno Lyrics | 1 | Generate song lyrics from a concept |
| Suno Separate | 2 | Separate vocals from instrumentals |
| Suno Music Video | 1 | Generate music video from Suno track |
| Describe Image | 1 | Image-to-text description via Claude Vision |
| Transcribe | 3 | Speech-to-text via Whisper |
| Voice Extractor | 1 | Isolate voice, remove background noise |
| Lip Sync | 40 | Animate portrait to lip-sync audio |
| Motion Transfer | 30 | Apply reference video motion to image |
| 3D Title | 3 | AI-generated animated 3D text scene |
| Motion Graphics | 2 | AI-generated 2D motion graphics overlay |
| AI Agent | 2 | General-purpose AI text agent (Claude/Gemini/GPT) |
| QA Check | 1 | AI quality/consistency/safety gate |

## Processing (20 nodes)

| Node | Credits | Description |
|------|---------|-------------|
| Combine Videos | 2 | Concatenate clips with transitions |
| Merge Video & Audio | 1 | Mix audio tracks onto video |
| Add Captions | 2 | Auto-transcribe and burn subtitles |
| Resize Video | 1 | Change aspect ratio (crop/pad/stretch) |
| Extract Audio | 1 | Separate audio from video |
| Mix Audio | 1 | Mix multiple audio tracks |
| Adjust Volume | 0 | Volume, normalize, fade-in/out |
| Trim Video | 0 | Cut to start/end range |
| Adjust Speed | 0 | Speed up or slow down video |
| Loop Video | 0 | Repeat clip N times or to target duration |
| Fade In/Out | 0 | Fade to black/white |
| Transcode Video | 0 | Re-encode codec, resolution, CRF |
| Manual Edit | 0 | Pause workflow for human editing |
| Video Upscale | 15 | AI upscale 1x/2x/4x (Topaz) |
| Compose Video | 2 | AI scene graph composer (Remotion) |
| After Effects | 2 | AI post-processing effects (Remotion) |
| Lottie Overlay | 2 | AI-placed Lottie animations on video |
| Composite | 0 | Multi-layer compositor (PiP, split screen) |
| Render Video | 3 | Final render via Remotion worker |

## Entity (4 nodes)

All entity nodes cost 5 credits.

| Node | Category | Description |
|------|----------|-------------|
| Character | character | Reusable character with asset sheets (expressions, poses, angles) |
| Face | face | Face/portrait reference for lip-sync and generation |
| Object | object | Reusable prop with generated views (angles, materials, variations) |
| Location | location | Environment with time/weather/angle variations |

## Scene (1 node)

| Node | Description |
|------|-------------|
| Scene | Director-mode scene container with characters, dialogue, cinematography settings |

## Output (2 nodes)

| Node | Description |
|------|-------------|
| Save to Storage | Persist asset to cloud storage |
| Webhook Output | Send asset URL to external webhook |

## Utility (3 nodes)

| Node | Description |
|------|-------------|
| Combine Text | Merge multiple text inputs with configurable separator |
| Split Text | Split text by delimiter |
| Sticky Note | Canvas annotation note with color and formatting |

---

## Summary

| Category | Count |
|----------|-------|
| Input | 9 |
| Parameter | 8 |
| AI | 26 |
| Processing | 20 |
| Entity | 4 |
| Scene | 1 |
| Output | 2 |
| Utility | 3 |
| **Total** | **73** |
