# Split into Chunks

> Cut a video or audio file into frame-exact parts between a minimum and a maximum length, and run the next node once per part.

## Overview

The Split into Chunks node cuts a long video or audio file into consecutive parts. Every part is between a **minimum** and a **maximum** length you set, and no part overlaps the next. Video is cut on exact frames, and each video part's sound never runs past its picture.

Wire a part output into another node in **Each** mode (the default for a new wire) and that node runs once per part — transcribe, dub, upscale or caption a long recording piece by piece.

## When to Use

- Split a long podcast or interview before feeding each part to Transcribe
- Cut a long video into short clips for social posts, each processed by the same chain
- Break an audio file into parts for dubbing or Voice Changer

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Cut by (`mode`) | select | Part length | **Part length** cuts parts between the min and max below. **Shots** cuts a video into one part per shot (see [Cutting at the shots](#cutting-at-the-shots)); the length fields and Audio Format are then hidden and not used. |
| Max chunk length | number (seconds) | 10 | The longest a part may be (minimum 1). Every part is at most this long. |
| Min chunk length | number (seconds) | 4 | The shortest a part may be (0 or more, never above the max). |
| Audio Format | select | `mp3` | Format of audio parts: `MP3`, `WAV`, or `AAC` (saved as `.m4a`) |
| Output Chunk | select (post-run) | Chunk 1 | The one part a wire in **Selected** mode passes on. Visible after a successful run. |

### How the parts are cut

- Parts are as long as the max allows, in order. **Video** parts are cut on whole frames and rounded **down**, so a part never runs over the max: at 29.97 fps a 10-second max gives parts of 299 frames (9.98 s).
- The leftover at the end is the last part. If it is shorter than the min, it is evened out with the parts before it so that every part stays between the min and the max.
- A video part's sound ends on a whole audio frame, at most about 21 ms before its picture does — never after it.
- **Audio** parts (an audio file split on its own) are cut the same way: sample-exact in MP3 and WAV; in AAC on whole 1,024-sample audio frames (a 5 s max gives 4.992 s parts at 48 kHz), and the last few milliseconds of the file (under 21 ms) are left out.
- Files up to **3 hours** long; a longer one fails before any work is done (trim it first).
- At most **200 parts** per file. A split that would make more fails before any work is done, and the message names the shortest max length that fits (or trim the file first).
- A file shorter than the min, or one that cannot be cut into parts between the min and the max (for example 11 s with a 6 s min and a 10 s max), fails with a message saying so.

**Example:** a 60 s phone video at 29.97 fps (1,798 frames), max 10 s, min 4 s → 7 parts: five of 299 frames (9.98 s), then 152 and 151 frames (5.07 s and 5.04 s). Without the min, the last part would be 4 frames long.

### Cutting at the shots

With **Cut by: Shots** (`mode: "shots"`), a video is cut into **one part per shot**, at the cuts measured from the video itself — the same rule as the [Shot Cuts](../processing-video/shot-cuts.md) node: every decoded frame is scored and each hard cut starts a new shot. Dissolves and fades are not cuts, and a flash that returns to the same picture is not one either.

- Each part is cut on whole frames, exactly as above, and keeps the video's own sound (never past its picture). There is no minimum length: a one-frame shot is a one-frame part.
- A video only: the audio input is not used — with an audio file connected the run fails with a message (disconnect it, or cut by part length).
- Videos up to **30 minutes**, and at most **200 shots**; a longer video or one with more shots fails with a message saying so (trim it first).
- Besides the parts, the job's output lists each part's shot: `shotCount` and `shots: [{ index, startSec, endSec, durationSec }]`, seconds on the video to the millisecond. The **Output Chunk** list shows each part's start and end.
- A shot's start is placed on the nearest frame of the constant-rate picture: exact for a constant-frame-rate video, within half a frame for a variable-rate one.

## Inputs & Outputs

**Inputs:**
- `video` — a video file to split
- `audio` — an audio file to split

At least one input is required. With both connected, each is split on its own.

**Outputs:**
- `video` — the video parts (when a video input is connected)
- `audio` — the audio parts (when an audio input is connected)

### What a wire passes on

| Wire mode | What the next node gets |
|-----------|-------------------------|
| **Each** (default for a new wire) | Runs once per part, each run getting its own part |
| **Item** | The one part the wire picks |
| **Bundle** | Every part at once (for nodes that take several, such as Combine Videos) |
| **Selected** | The part named by **Output Chunk** |

Wires drawn before Each became the default keep passing one part (Selected). Workflow JSON written through the API or MCP with no `outputMode` on an edge also passes one part — set `"outputMode": "each"` on the edge's `data` to run the next node once per part.

To keep the parts as rows, wire a part output into a [List](../input/list.md): drop it on the List's **+** pip and it becomes a video or audio column with one row per part. Nodes after the List then read the parts like any other list.

## Pricing

22 credits<!-- credits: split-media --> per run, whatever the number of parts. Nodes after it on an Each wire are charged once per part they run for.

Before the run, the editor's estimate counts the parts from the input's recorded length: the length divided by the max, allowing for the frame rounding above (so it may count one part more than the run makes, never fewer). When cutting at the shots, the shots are only known once the video is measured, so the estimate assumes one shot every 4 seconds of the input (at most 200). When the input's length is not known (a Video URL, or a published app run on the user's own file), the estimate assumes a 10-minute file. Once the node has run, its parts are counted exactly.

Cutting at the shots costs the same per run.

## Common Use Cases

- Batch transcription: split a 60-minute recording into 5-minute parts, then wire Each into Transcribe
- Long-form dubbing: split a video, dub each part, then recombine with Combine Videos
- Clips for social: cut a talk into 30–60 s parts and caption each
- Shot by shot: cut an ad or a music video at its shots, then restyle or upscale each shot on an Each wire

## Tips

- Every part appears in the node's results, where you can play or download it.
- WAV output preserves lossless quality; use AAC (an `.m4a` file) for smaller files.
- To process only some parts, set a range or a list on the Each wire (for example parts 1–5).
