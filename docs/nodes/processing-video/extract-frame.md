# Extract Frame

> Pull a single still frame out of a video as a PNG image.

## Overview

The Extract Frame node converts a frame of video into a still image you can route into image-based nodes (modify, edit, upscale, generate-image as reference, etc.). Six pick modes:

- **First** — the first frame of the video
- **Last** — the final rendered frame
- **Timestamp** — a specific second-precision offset (e.g., 2.5s into the clip)
- **Nearest keyframe** — snap to the nearest keyframe at or after a given timestamp (faster, no inter-frame decode; defaults to `0` = first keyframe)
- **Frame # from start** — extract by frame index (`0` = first frame); worker probes source fps to seek precisely
- **Frame # from end** — extract by frame index from the end (`0` = last, `1` = second-to-last, etc.); worker probes duration + fps

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | first | One of the six modes above |
| Timestamp (s) | Number | 0 | Seconds into the video (used by `timestamp` and `keyframe`) |
| Frame # from start | Number | 0 | Frame index from the start (used by `frame-index`) |
| Frames back from end | Number | 0 | Frame index from the end, 0 = last (used by `frame-from-end`) |

## Inputs & Outputs

**Inputs:** Video (required, connected upstream or via Upload Video)
**Outputs:** Image (PNG)

## Source file

When the video connected to this node is a generation result that kept its original file beside its playable copy (an HDR, 10-bit or HEVC video: see [Video originals and previews](../../design/video-original-and-preview.md)), the node works from that original, not from the copy, and still outputs an 8-bit H.264 MP4. An HDR picture (HLG or PQ) is converted to SDR first, by the same conversion as the result's playable copy, so the output looks like the copy you played; an HDR video you upload is converted the same way. All of a run's conversions together get up to 15 minutes; a video too long to convert in what is left is read as before: the playable copy, or an upload as it is. When a picture was converted, the job's output says so: `output_data.warningCode` is `hdr_tone_mapped`, with an English `warningMessage`. If the original cannot be used (it is gone, it is over the node's download limit, or converting it fails or would take too long), the node works from the playable copy, as before. The price is the same either way.

## Credit Cost

**11 credits**<!-- credits: extract-frame --> per extraction, regardless of mode or video length.

## Best Practices

- Use **last** mode to grab the closing frame of a generated video for use as the start frame of a follow-up i2v generation — that's the trick behind continuous multi-clip storytelling.
- Use **first** mode to verify what an upstream video starts with when chaining nodes.
- Use **frame # from end** when you want "the second-to-last frame" or "10 frames back from the end" without caring about the source's exact length.
- Use **frame # from start** when you need an exact frame index (e.g., frame 24 for the second of a 24fps clip).
- Use **nearest keyframe** when extraction speed matters or when the source is high-bitrate — keyframe extraction skips inter-frame decoding (`-skip_frame nokey`).
- Timestamp mode honors decimals (e.g., `2.5` for 2.5 seconds in). Out-of-range timestamps clamp to the nearest valid frame.
- The output image inherits the video's resolution — to resize it before downstream use, route through Resize Video upstream or use a generative node's resolution control.

## Common Use Cases

- Capture the final frame of a VEO/Kling clip to seed the next i2v step (perfect-loop or storyboard-chain workflows).
- Pull a representative still for a thumbnail before posting to social.
- Extract a specific moment from a long video for editing or reference.
- Grab the start frame of an upstream clip to use as a reference image for a Generate Image node.
- Extract "the frame just before the end" (e.g., 5 frames back) when the last frame has dissolve artifacts — `frame-from-end` with `framesFromEnd=5`.

## Tips

- Frame extraction does NOT incur Topaz / VEO / KIE provider charges — it's a local FFmpeg operation costing ten Nodaro credits for orchestration.
- The frame is exported as PNG (lossless), not JPEG — safe to route into upscale, edit-image, or as the anchor frame for video continuation (extends) without adding compression artifacts to the chain.
- `frame-index` and `frame-from-end` hard-fail if the source's fps or frame-count probe yields an invalid value (rather than silently mis-converting).
- Combine with **Combine Videos** to take a still from clip A, run it through Generate Image to remix, and stitch the result back into a new clip.
