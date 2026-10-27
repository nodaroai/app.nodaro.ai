# Video Depth

> Turn any video into a depth video — near is bright, far is dark.

## Overview

Video Depth estimates per-frame depth and renders it as a video. Feed the grayscale result into depth-guided generation, relighting or compositing, or pick a colormap for a stylised look.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | Video Depth Anything | `video-depth-anything` (temporally consistent) or `depth-anything-frames` (Depth Anything per frame; may flicker; grayscale or inferno) |
| Model size | Select | Large | Small / Base / Large — larger is more detailed and slower |
| Colormap | Select | Grayscale | Video Depth Anything: grayscale, turbo, inferno, magma, viridis. Depth Anything (per frame): grayscale or inferno. |
| Resolution | Select | Auto | Video Depth Anything only: auto, 360p, 480p, 720p, 1080p |
| Side by side | Toggle | Off | Video Depth Anything only: original and depth next to each other |

A setting the chosen provider does not take is ignored, and a colormap it cannot render becomes grayscale — a run is never refused for either, so a provider switched by a field mapping still runs.

## Length limit

Video Depth Anything accepts up to **2,400 frames** (≈80 s at 30 fps, 100 s at 24 fps) and at most **300 seconds** whatever the frame rate. A clip that reports no frame rate is counted at 30 fps. Depth Anything (per frame) accepts up to **80 seconds**. Longer clips are rejected before any credits are reserved — trim them first.

## Inputs & Outputs

- **Input:** Video
- **Output:** Video (MP4)

## Credit Cost

Billed by the input clip's length, rounded up to the next tier. The clip is measured before the run; the chip on the node updates once a video with a known length is connected.

| Provider | 15s | 30s | 1min | 2min | 5min |
|----------|----:|----:|-----:|-----:|-----:|
| `video-depth-anything` | 330<!-- credits: video-depth-anything:15s --> | 660<!-- credits: video-depth-anything:30s --> | 1,320<!-- credits: video-depth-anything:60s --> | 2,640<!-- credits: video-depth-anything:120s --> | 6,600<!-- credits: video-depth-anything:300s --> |
| `depth-anything-frames` | 33<!-- credits: depth-anything-frames:15s --> | 66<!-- credits: depth-anything-frames:30s --> | 132<!-- credits: depth-anything-frames:60s --> | 264<!-- credits: depth-anything-frames:120s --> | — |

Depth Anything (per frame) accepts clips up to 80 seconds, so its 2-minute tier is the most a run can cost.

Worked examples: a 5 s clip → 15s tier; 15 s → 15s tier; 15.01 s → 30s tier; 61 s → 2min tier.

The clip is always measured before the run. A clip that cannot be read is refused (`video_unreadable`) before any credits are reserved — the run is never priced at a guessed length. The editor reads a connected video's length from the clip itself, so the node and the run estimate show that clip's tier. Until the length is known, or when the browser cannot read the clip, the node shows the 15s tier and the run estimate shows the highest tier.

## Tips

- Keep grayscale when the result feeds another node; colormaps are for viewing.
- Use Small for quick previews, Large for the final pass.
