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

Billed by the input clip's length. The clip is measured before the run; the chip on the node shows the most a run can cost until a video with a known length is connected.

**Video Depth Anything** is billed per second of the clip: 22<!-- credits: video-depth-anything:1s --> credits a second, with the length rounded **up** to whole seconds, so a clip under 1 s costs the same as 1 s and 9.2 s costs the same as 10 s. Each length has its own price row, `video-depth-anything:<n>s` (`video-depth-anything:1s` … `video-depth-anything:300s`). The editor's cost badge, a single-node run, a run inside a workflow, and API / MCP / SDK calls all charge the same row for the same clip, and the amount reserved when the job starts is the amount charged.

| Clip | Billed as | Credits |
|------|-----------|--------:|
| 0.5 s | 1 s | 22<!-- credits: video-depth-anything:1s --> |
| 4 s | 4 s | 88<!-- credits: video-depth-anything:4s --> |
| 9 s | 9 s | 198<!-- credits: video-depth-anything:9s --> |
| 9.2 s | 10 s | 220<!-- credits: video-depth-anything:10s --> |
| 15 s | 15 s | 330<!-- credits: video-depth-anything:15s --> |
| 1 min | 60 s | 1,320<!-- credits: video-depth-anything:60s --> |
| 5 min (maximum) | 300 s | 6,600<!-- credits: video-depth-anything:300s --> |

**Depth Anything (per frame)** is billed by length tier, with the clip's length rounded up to the next tier:

| Provider | 15s | 30s | 1min | 2min |
|----------|----:|----:|-----:|-----:|
| `depth-anything-frames` | 33<!-- credits: depth-anything-frames:15s --> | 66<!-- credits: depth-anything-frames:30s --> | 132<!-- credits: depth-anything-frames:60s --> | 264<!-- credits: depth-anything-frames:120s --> |

Depth Anything (per frame) accepts clips up to 80 seconds, so its 2-minute tier is the most a run can cost. Worked examples: a 5 s clip → 15s tier; 15 s → 15s tier; 15.01 s → 30s tier; 61 s → 2min tier.

The clip is always measured before the run. A clip that cannot be read is refused (`video_unreadable`) before any credits are reserved — the run is never priced at a guessed length. The editor reads a connected video's length from the clip itself, so the node and the run estimate show that clip's price. The server's workflow estimates (`POST /v1/credits/estimate-workflow` and a published app's listed price) read an uploaded clip's length from the file too, unless the app's user replaces that upload. Until the length is known — nothing connected, the clip not read yet, or a clip that cannot be read — the node and the estimates show the provider's highest price (5 minutes on Video Depth Anything, the 2-minute tier on Depth Anything per frame), the most a run can cost; the run itself is always charged the measured clip's price.

## Tips

- Keep grayscale when the result feeds another node; colormaps are for viewing.
- Use Small for quick previews, Large for the final pass.
