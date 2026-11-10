# Shot Cuts

> Find where every shot of a video starts and ends, measured from the file itself, and optionally save each shot's first and last frame as images.

## Overview

Shot Cuts reads a video and lists its shots: where each one starts, where it ends and how long it lasts. It measures the file itself: every decoded frame is compared with the one before it, and a frame that changes sharply from a quiet background starts a new shot. A camera flash held for two or three frames before the picture comes back is not counted as a cut; a one-frame flash does start a new shot. It is the same rule the platform uses for Video Mask's per-shot masking.

Turn on **Save first and last frames** to also get each shot's exact first frame and its last frame (the frame just before the next cut, or the video's final frame) as images.

It never calls an external provider: the video is read locally with FFmpeg, so it works on every edition, including a keyless community install.

## When to Use

- Get a shot list of an edit (an ad, a trailer, a music video) to rebuild or restyle it shot by shot
- Grab a still of every shot as a reference image for image or video models
- Find the cut points before [Split into Chunks](../processing-audio/split-media.md) (its **Shots** mode cuts the video at these same points)

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| Video | video | **Yes** | The video to measure: MP4, MOV, MKV or WebM, up to **30 minutes** long. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Shots | json | The shot count, the cut times, the video's length and every shot (below). |
| First frames | json | With frames on: a list of each shot's first frame (image URLs), in shot order. |
| Last frames | json | With frames on: a list of each shot's last frame (image URLs), in shot order. |

The **Shots** output (also the job's `output_data.json`):

```json
{
  "shotCount": 3,
  "cutsSec": [2.5, 6.042],
  "durationSec": 9,
  "shots": [
    { "index": 0, "startSec": 0, "endSec": 2.5, "durationSec": 2.5, "firstFrameUrl": "https://…", "lastFrameUrl": "https://…" },
    { "index": 1, "startSec": 2.5, "endSec": 6.042, "durationSec": 3.542, "firstFrameUrl": "https://…", "lastFrameUrl": "https://…" },
    { "index": 2, "startSec": 6.042, "endSec": 9, "durationSec": 2.958, "firstFrameUrl": "https://…", "lastFrameUrl": "https://…" }
  ]
}
```

- Times are seconds from the video's first frame, to the millisecond.
- `cutsSec`: where each new shot starts, ascending, never 0. A video with a single shot has `cutsSec: []` and one shot covering the whole video.
- `durationSec`: the video's length. The last shot ends there.
- `firstFrameUrl` / `lastFrameUrl` (PNG): only when frames are on. A one-frame shot's first and last frame are the same image.

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| **Save first and last frames** (`frames`) | off | Also save every shot's first and last frame as images. The price is the same. Frames are saved for videos with up to 1,000 shots. |

### What counts as a cut

- A hard cut, where one frame differs sharply from the frames around it, starts a new shot.
- Gradual transitions (a dissolve, a fade through black) spread the change over many frames and are **not** cuts: the shots on both sides count as one.
- A flash held for two or three frames that returns to the same picture is not a cut; a one-frame flash is. A cut immediately followed (within three frames) by a second large change, such as a whip pan, can be missed.

## Credit Cost

2 credits<!-- credits: shot-cuts --> per run, with or without frames, whatever the length of the video. Community and Business editions have no credits.

**Fails and is refunded:** a file that is not a readable video, a file over about 10.7 GiB (the download stops there), a video longer than 30 minutes (trim it first), and, with frames on, a video with more than 1,000 shots (turn frames off to get the times alone, or trim the video).

## API

`POST /v1/shot-cuts` with `{ videoUrl, frames? }` queues a job and answers `{ jobId }`; a malformed request answers `400 validation_error` before any credits are reserved. The finished job's `output_data.json` is the Shots result above; with frames on, `output_data.firstFrames` and `output_data.lastFrames` list the frame images in shot order. See [API Integration](../../api-integration.md) and the [SDK Reference](../../sdk-reference.md) (`client.media.shotCuts`). MCP: `shot_cuts`.

## Common Use Cases

- Rebuild an ad shot by shot: Shot Cuts with frames on, then each first frame as the start image of a new clip
- Measure the pacing of an edit: the shots' lengths, at a glance
- Cut a video into one clip per shot: [Split into Chunks](../processing-audio/split-media.md) in **Shots** mode

## Tips

- Wire the **Shots** output into Extract Field (field `shots`, Output Type `list`) or a list node to read a single shot's times.
- Frames are the exact decoded frames, saved without loss. They are as large as the video's picture.
