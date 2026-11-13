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

**Video Depth Anything** is billed per second of the clip: 22<!-- credits: video-depth-anything:1s --> credits a second, with the length rounded **up** to whole seconds, so a clip under 1 s costs the same as 1 s and 9.2 s costs the same as 10 s. Up to 0.05 s past a whole second is ignored first: a 12 s cut of a 29.97 fps clip comes out 12.012 s long and costs the same as 12 s. Each length has its own price row, `video-depth-anything:<n>s` (`video-depth-anything:1s` … `video-depth-anything:300s`). The editor's cost badge, a single-node run, a run inside a workflow, and API / MCP / SDK calls all charge the same row for the same clip, and the amount reserved when the job starts is the amount charged.

| Clip | Billed as | Credits |
|------|-----------|--------:|
| 0.5 s | 1 s | 22<!-- credits: video-depth-anything:1s --> |
| 4 s | 4 s | 88<!-- credits: video-depth-anything:4s --> |
| 9 s | 9 s | 198<!-- credits: video-depth-anything:9s --> |
| 9.2 s | 10 s | 220<!-- credits: video-depth-anything:10s --> |
| 12.012 s | 12 s | 264<!-- credits: video-depth-anything:12s --> |
| 15 s | 15 s | 330<!-- credits: video-depth-anything:15s --> |
| 1 min | 60 s | 1,320<!-- credits: video-depth-anything:60s --> |
| 5 min (maximum) | 300 s | 6,600<!-- credits: video-depth-anything:300s --> |

**Depth Anything (per frame)** is billed the same way: 2.2<!-- credits-rate: depth-anything-frames:1s --> credits per second of the clip, with the length rounded **up** to whole seconds after ignoring the same 0.05 s, and each total rounded up to a whole credit. A clip under 1 s costs the same as 1 s, 4.1 s costs the same as 5 s, and a 15 s cut of a 29.97 fps clip comes out 15.015 s long and costs the same as 15 s. Each length has its own price row, `depth-anything-frames:<n>s` (`depth-anything-frames:1s` … `depth-anything-frames:80s`). It accepts clips up to 80 seconds, so 80 s is the most a run can cost.

| Clip | Billed as | Credits |
|------|-----------|--------:|
| 0.5 s | 1 s | 3<!-- credits: depth-anything-frames:1s --> |
| 4 s | 4 s | 9<!-- credits: depth-anything-frames:4s --> |
| 4.1 s | 5 s | 11<!-- credits: depth-anything-frames:5s --> |
| 15 s | 15 s | 33<!-- credits: depth-anything-frames:15s --> |
| 15.015 s | 15 s | 33<!-- credits: depth-anything-frames:15s --> |
| 1 min | 60 s | 132<!-- credits: depth-anything-frames:60s --> |
| 80 s (maximum) | 80 s | 176<!-- credits: depth-anything-frames:80s --> |

The clip is always measured before the run. A clip that cannot be read is refused (`video_unreadable`) before any credits are reserved — the run is never priced at a guessed length.

Before a run, the node's price, its Run button and the workflow's estimate (in the editor, and on the server: `POST /v1/credits/estimate-workflow`, MCP, a published app's listed price) read the same length for the connected video:

- **A video another node makes in this run** is read at the length that node will produce at its settings: a generation at the length its model renders (Auto at its longest clip, a reference video wired or not, unless the run declares a Seedance 2.5 Edit of it: then that clip rounded up plus a second; a length set through a Duration node or a field mapping as the run reads it), an Extend Video at its source plus the seconds it adds, a Trim, Loop or Combine Videos by the length it passes on (a Trim with Lossless on, whose cut starts at the keyframe at or before the window and can run a few frames past its end: at most to the end of its cut plus 0.6 seconds and never past its input, at its input's length when the cut runs to the clip's end or is set in frames; on an input of unknown length, a cut that keeps the last N seconds at N seconds, a minimum, and an open or frames cut as a length nothing knows). **Each clip made on the way adds about a tenth of a second**: a made clip runs a frame or an audio track a little past its planned length, the run measures the whole file, and only 0.05 s past a whole second is ignored. So a generation set to 5 s is quoted at 6 s — 132 credits<!-- credits: video-depth-anything:6s --> on Video Depth Anything — as a clip measured past 5.05 s is charged.
- **A node that does not run in this run** (Video Depth run on its own, or a frozen node) hands on the result it already holds, so it is read at the length recorded for that result. A video generation (Generate Video, Image to Video, Text to Video, Video to Video) whose result recorded no length — a fixed-length run records none — made that result at its settings, so it is read at the length they make, its Duration, as a clip the node makes in this run is read.
- **An uploaded clip**, or one added from your own uploads in the Library, is read at the length measured when it was uploaded; an upload with no length recorded is read from the file itself (the editor reads the clip, the server's estimates probe the file, unless the app's user replaces that upload).
- A length the upstream node only stores (an earlier result of a node that runs again, the seconds an extension adds) is never read.

Until the length is known — nothing connected, a VEO or Runway extension, a video link, the clip not read yet, or a clip that cannot be read — the node and the estimates show the provider's highest price (5 minutes on Video Depth Anything, 80 seconds on Depth Anything per frame), the most a run can cost; the run itself is always charged the measured clip's price.

## Tips

- Keep grayscale when the result feeds another node; colormaps are for viewing.
- Use Small for quick previews, Large for the final pass.
