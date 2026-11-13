# Combine Videos

> Concatenate multiple video clips with transitions and per-clip frame trim.

## Overview

The Combine Videos node joins multiple video clips in sequence with configurable transitions between them. Supports drag-and-drop reordering of connected clips and per-clip head/tail frame trimming. All processing is done via FFmpeg.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Transition | Select | fade | Transition type between clips |
| Transition Duration | Number | 0.5 | VIDEO transition length in seconds (0.1-2s), hidden for "cut" |
| Audio Mode | Select | crossfade | How to handle audio during transitions |
| Crossfade Duration | Number | 0.5 | AUDIO-only crossfade length (0-5s, shown when Audio = Crossfade). Never affects the video. Falls back to Transition Duration on older workflows. |
| Crossfade Curve | Select | linear | Audio fade curve (shown when Audio = Crossfade) |
| Boundary Cut | Select | manual | How each clip-to-clip boundary is cut. **Manual** trims an exact number of frames (fields below). The **Smart** methods (**Nodaro Cloud only**) find the cut automatically: `best-pair` (the single most similar frame pair), `preroll-keep-next` or `preroll-keep-prev` (see below). Manual and Smart are alternatives, not layers |
| Smart: prev window | Number | 8 | Frames searched at the END of each clip (1-24, shown for Smart methods). A value outside the range is narrowed to it before the run |
| Smart: next window | Number | 8 | Frames searched at the START of the following clip (1-24). A value outside the range is narrowed to it before the run |
| Trim Start Frames | Number | 1 | **Manual method only.** Frames trimmed from the start of EACH clip except the first (0-120). Default 1 drops the duplicated boundary frame AI continuation clips carry |
| Trim End Frames | Number | 2 | **Manual method only.** Frames trimmed from the end of EACH clip except the last (0-120). Default 2 drops boundary generation artifacts |
| Clip Ordering | Drag list | — | Reorder connected video clips |

### Transition Options

50+ FFmpeg `xfade` transitions are available, organized into a tabbed picker in the config panel. The **Common** tab surfaces the most-used handful; the remaining tabs group every option by family. Each tile shows a looping mini-preview so you can compare options at a glance.

**Common tab** — the everyday handful:

| Transition | Description |
|------------|-------------|
| cut | Hard cut — instant switch, no blend. Fastest. |
| fade | Smooth alpha cross-fade. Classic clean blend. |
| dissolve | Random-pixel dissolve. Grainy, organic feel — good for memory beats. |
| dip-to-black | Fade through black. Use between scenes or time jumps. |
| dip-to-white | Fade through white. Bright, ethereal — flashbacks. |
| wipe-left, wipe-right | Hard edge sweeps across the frame. |
| slide-left, slide-right | Next clip pushes the current one off-screen. |
| circle-open | Circular iris opens to reveal the next clip from center. |

**All groups** — full catalog (id → FFmpeg xfade name):

| Group | Transitions |
|-------|-------------|
| Fades & Dips | cut (concat), fade, dissolve, dip-to-black (fadeblack), dip-to-white (fadewhite), fadegrays |
| Wipes | wipe-left, wipe-right, wipe-up, wipe-down, wipe-tl, wipe-tr, wipe-bl, wipe-br |
| Slides | slide-left, slide-right, slide-up, slide-down |
| Smooth | smooth-left, smooth-right, smooth-up, smooth-down (feathered-edge wipes) |
| Shapes | circle-open, circle-close, circle-crop, rect-crop, horz-open, horz-close, vert-open, vert-close, diag-tl, diag-tr, diag-bl, diag-br |
| Slices | hl-slice, hr-slice, vu-slice, vd-slice |
| Reveals | reveal-left, reveal-right, reveal-up, reveal-down |
| Covers | cover-left, cover-right, cover-up, cover-down |
| Effects | pixelize, radial, hblur, distance, zoom-in, squeeze-h, squeeze-v |

**Back-compat note:** Workflows saved with the old 5-value transition field (`cut` / `fade` / `dissolve` / `dip-to-black` / `dip-to-white`) keep working. `dip-to-black` and `dip-to-white` now use FFmpeg's built-in `fadeblack` / `fadewhite` xfade transitions instead of interleaving generated solid-color clips — visually identical, one fewer ffmpeg pass per dip. `dissolve` now produces the FFmpeg `dissolve` xfade (pixel-noise pattern), which differs subtly from `fade` — previously the two were aliased.

### Audio Modes

- **keep** — Preserve original audio from each clip
- **crossfade** — Blend audio during transition (curve configurable, see below)
- **remove** — Strip all audio from output

**The audio crossfade never influences the video.** Its duration and curve shape only the soundtrack: at a cut the video stream is copied byte-for-byte (identical whether crossfade is on or off), and at blend transitions the video fade length is governed solely by Transition Duration.

**How crossfade behaves per transition type:**

- **Cut (or any transition at duration 0):** the video switches instantly, and the audio does an **L-cut**: each incoming clip's sound starts exactly ON its cut (in sync, fading in), while the outgoing clip's sound lingers `d` seconds past the cut and fades out over it — a true blend with no dropout. The lingering tail comes from stretching the outgoing audio a few percent (pitch-preserved), which is masked under the fade. The **last clip is untouched**: its sound runs to the very end of the video, no fade-out.
- **Blend transitions (fade, dissolve, wipes, …):** every clip's audio stays anchored to its video start — no drift, regardless of the audio crossfade length. The fades cross-blend over the video overlap; an audio crossfade *longer* than the video fade simply extends the blend gently into both clips. The last clip's audio is never faded out.

**Audio normalization:** every clip is re-encoded to a common format before joining (24fps H.264, AAC 44.1kHz stereo), so clips from different providers — which often ship different sample rates — always splice cleanly. If some clips have audio and others are silent, the silent clips get a silent audio track injected so the combined track never drops out mid-video.

### Smart Cut

> **Nodaro Cloud only.** Smart Cut's boundary-matching algorithms run from Nodaro's cloud engine; self-hosted Community and Business editions offer the exact frame trims (`Trim Start/End Frames`) instead, and the API returns `cloud_only_feature` if `smartCutEnabled` is requested there.

For continuation clips (each generated from the previous clip's last frame), the seam usually stutters because the models re-render a near-identical moment on both sides. **Smart Cut** looks at the last *N* frames of each clip and the first *M* of the next and places the cut for you. All three methods share the same windows and the same fixed-trims fallback; they differ in where the cut lands:

- **Best pair** (default): cut at the single most similar frame pair — the first clip ends **on** the best match, the next starts **right after** its twin, so the shared moment plays exactly once. Byte-identical to the node's pre-method behavior.
- **Pre-roll keep-next**: some continuation models restart *before* the boundary frame and re-enact the previous clip's last moments before diverging. This method cuts at the **start** of that overlap, so the whole overlap plays from the *next* clip's copy and the seam moves away from the point where the model rejoins new content.
- **Pre-roll keep-prev**: cuts at the **end** of the same overlap instead — the *previous* clip's original (often sharper) frames are kept and the next clip drops its re-enactment.

**Fallback:** frames only count as a genuine match when they are close enough to be the same moment, and the pre-roll methods additionally require a real run of matching frames rather than one isolated pair. Boundaries with a match use the method's cut; boundaries **without** one (clips that don't actually continue each other, or a failed search) fall back to the **default trims** (start 1 / end 2). Custom trim values belong to the Manual method only — switching to a Smart method resets them, so nothing hidden steers the fallback.

**Voice at smart boundaries (audio-preserving cut):** the trimmed frames are *duplicated video*, but their audio is not a duplicate — continuation models re-render the picture overlap while the speech simply carries on, so cutting both streams would clip words mid-syllable. With **Audio = Crossfade** and a hard-cut transition (`cut`, or any transition at duration 0), a **matched** boundary therefore trims only the previous clip's *video*: its real audio tail keeps playing under the next clip's first moments and fades out over the audio-crossfade length — an L-cut made of the genuine recording instead of a synthetic stretch. Unmatched boundaries, the Manual method, `keep`/`remove` audio, and blend transitions keep the classic symmetric trim.

**Window bounds.** Both windows accept **1-24**. A value outside that range — typed
into the panel, carried over by an imported workflow, or written into the workflow
JSON by an agent — is narrowed to the nearest legal value before the request is
sent (48 becomes 24, 0 becomes 1), and a non-numeric value falls back to the
default 8. The run proceeds; it is never rejected for this.

**Every junction is searched independently** — with 3 clips there are 2 boundaries, each with its own result. The applied values are reported in the job's `output_data.smartCuts`:

```json
"smartCuts": [
  { "boundary": 0, "prevClipEndTrimFrames": 0, "nextClipStartTrimFrames": 1, "psnrDb": 30.19, "matched": true, "searchedPrevFrames": 8, "searchedNextFrames": 8 },
  { "boundary": 1, "prevClipEndTrimFrames": 2, "nextClipStartTrimFrames": 1, "psnrDb": 11.7, "matched": false, "searchedPrevFrames": 8, "searchedNextFrames": 8 }
]
```

`boundary` k is the join between clip k and clip k+1. Every pair in the `searchedPrevFrames` × `searchedNextFrames` grid is compared (the requested windows, clamped to short clips). The trim fields are the values actually **applied** (drop counts: `prevClipEndTrimFrames: 0` = the match was the previous clip's very last frame, kept; `nextClipStartTrimFrames: 1` = the next clip dropped just its duplicated first frame). `matched: false` means no pair cleared the threshold — the reported values are the fixed trims the boundary fell back to. `psnrDb`: >30 ≈ visually identical, 100 = pixel-identical, `null` = the search errored.

### Crossfade Curve (only when Audio = Crossfade)

| Curve | FFmpeg `acrossfade=curve=` | When to use |
|-------|----------------------------|-------------|
| Linear | `tri` | Default — predictable but can dip in the middle for music |
| Equal Power | `qsin` | Keeps perceived loudness roughly constant — best for music |
| Smooth (Sine) | `hsin` | Gentler than equal-power — good for dialogue and ambient |
| Logarithmic | `log` | Compensates for the ear's logarithmic loudness response; long, slow tails |
| Exponential | `exp` | Sharp out / slow in — punchy, good for impact moments |

## Inputs & Outputs

**Inputs:** 2 to 100 video clips (connected via input handles). A run of more than 100 clips is refused before any clip is read: `400 validation_error` on the API, and in a workflow the node fails with `Combine Videos joins at most 100 clips; this run has N.`
**Outputs:** Single combined video

**One input passes through.** In a workflow, when only one video reaches Combine Videos, the node outputs that video unchanged, at no cost. Calling the API directly still needs at least two videos.

## Credit Cost

Combine Videos is **dynamically priced** based on output length and input count:

- **Base:** 11 credits<!-- credits-rate: combine-videos --> per started 5 seconds of output length (the sum of the clips' lengths, minus transition overlaps, minus per-clip frame trim)
- **Input adder:** +11 credits<!-- credits-rate: combine-videos --> per extra input beyond the first 2
- **Floor:** minimum 11 credits<!-- credits: combine-videos -->

The base and the adder are priced together as one charge.

A single-node run, a run inside a workflow or a published app, and MCP or SDK calls are all charged this way, at the length the run measures.

**Measured before the charge.** Every run measures each clip it is given before anything is reserved — the length of its picture, where the clips are joined (a generated clip's sound can run a frame or two past its last frame; that tail is not counted) — and is charged by that length; a length sent with the request (`upstreamDurations`) is ignored. A clip that cannot be read is refused before anything is charged: `Could not read clip 2 of 3. The file may be corrupted or an unsupported format.` How long measuring may take depends on who is waiting. On a single-node run, an API call or an MCP call — someone waits for the answer — the whole request — every clip together — is measured within 90 seconds: reading a clip's header takes at most 30 seconds, and a clip whose header carries no length (a recording made in a browser, for example) is read in full, packet by packet, in what is left of the 90 seconds. In a workflow or a published app, a clip's header takes at most 30 seconds and a full read at most 120 seconds, the time the render itself gets to download the clip. A clip read in full has no size limit other than that time. A measure that runs out of time is answered `503 probe_timeout` (`Timed out reading … — run it again.`; in a workflow the node fails with that message), with nothing charged, and can simply be run again. A link whose host cannot be looked up at that moment is answered `503 source_unreachable` (`Could not reach … — run it again.`) the same way; a link whose host does not exist is refused like a clip that cannot be read (`400 invalid_video_duration`, `Could not read …: its host was not found. Check the link.`). If the server sees the request closed while its clips are measured, before the charge, the measure stops there: no job is created and nothing is charged. A request it does not see closed — a connection held open on the way to the server, or an MCP call, which runs the step on the server itself — is measured, run and charged as usual. Each started 5 seconds is a unit, and the charge forgives up to 0.1 seconds past a 5-second mark on each clip: a 10-second generation that measures 10.04 seconds is charged as 10 seconds, while a clip of 10.15 seconds is charged the next unit.

**Re-measured at the render.** The run measures each clip again once it has downloaded it, before anything is rendered. If the clips, each less about half a second, now need more units than the run was charged (a link that now serves a longer file), the run is refused — `Clip 2 of 3 is 16 seconds, longer than the 10 seconds this run was priced for — run it again` — and the charge is refunded; clips that have grown but still fit the units charged render as charged. A run that carries no priced length is refused and refunded too.

**Before a run**, the Run button, the workflow's estimate and a published app's listed price quote the same length for the video each wire will hand on:

- a video another node makes in this run: the length that node will produce at its settings — a generation at the length its model renders (Auto at its longest clip, a reference video wired or not, since a run that declares nothing lets the model pick its length; a Seedance 2.5 Edit of a wired reference video at that clip rounded up plus a second, an Extend as the run resolves it; a length set through a Duration node or a field mapping as the run reads it; a length an app's user types freely, at the longest the model renders), an Extend Video at its source plus the seconds it adds, a Trim, Loop or Combine Videos by the length it passes on (a Trim with Lossless on, whose cut starts at the keyframe at or before the window and can run a few frames past its end: at most to the end of its cut plus 0.6 seconds and never past its input, at its input's length when the cut runs to the clip's end or is set in frames; on an input of unknown length, a cut that keeps the last N seconds at N seconds, a minimum, and an open or frames cut as a length nothing knows) — plus about a tenth of a second for each clip made on the way, so the quote is not below the measured charge;
- a node that does not run in this run (you run the step on its own, or the node is frozen): the length recorded with the result it hands on. A generated video made at an automatic length, or by a Seedance 2.5 Edit or Extend, records the length it really is, leaving off at most a quarter second past a whole second; the estimate adds that quarter second back, so it is never below the clip the run measures. A video generation (Generate Video, Image to Video, Text to Video, Video to Video) whose result recorded no length — a fixed-length run records none — made that result at its settings, so it is read at the length they make, its Duration, as a clip the node makes in this run is read;
- an uploaded clip, or one added from your own uploads in the Library: the length measured when it was uploaded;
- a render's output (Apply EDL, a [Tighten Episode](./tighten-episode.md#steps-after-the-node)'s episode): the render's estimated length, rounded up to whole minutes;
- the output of a step that keeps its input's length (Add Captions, Resize Video, Fade Video, Face Swap, Video Upscale, …): its input's length, read by these same rules;
- a list of clips on one wire (a Bundle, such as UGC Finish's finished clips): each clip at its own length. The estimate before the run counts every clip such a wire brings: after a node that runs once per item (a List into a Trim on Each, then a Bundle into Combine Videos), one clip per item, each with its input adder;
- when nothing can say how long a video will be (a Library video whose length was not recorded, a VEO or Runway extension, a video link): an **8-second stand-in**. That is a minimum: the run is charged the length it measures.

For example, two 15-second generations joined by cuts (with the default 1 + 2 frame trims) are quoted at 29.75 seconds (each 15.1 seconds less the 0.1-second grace) — 66 credits<!-- credits: combine-videos@6 --> — and charged by the clips they deliver.

Examples:

| Configuration | Estimated Output | Credits |
|---|---|---|
| 2 clips × 5s, cut transition | 10s | 22<!-- credits: combine-videos@2 --> |
| 3 clips × 10s, cut, no frame trim | 30s | 77<!-- credits: combine-videos@7 --> (66<!-- credits-rate: combine-videos@6 --> base + 11<!-- credits-rate: combine-videos --> input adder) |
| 3 clips × 10s, fade 0.5s | 29s | 77<!-- credits: combine-videos@7 --> (66<!-- credits-rate: combine-videos@6 --> base + 11<!-- credits-rate: combine-videos --> input adder) |
| 5 clips × 8s, dissolve 0.5s, trim 24+24 frames per clip | 28s | 99<!-- credits: combine-videos@9 --> (66<!-- credits-rate: combine-videos@6 --> base + 33<!-- credits-rate: combine-videos@3 --> input adder) |

The Run button shows the live estimate.

## Best Practices

- Use "fade" (0.5s) for professional-looking transitions between most clips
- Use "cut" for fast-paced edits or when clips are meant to be seamless
- Reorder clips via drag-and-drop before running the workflow
- Keep transition duration short (0.3-0.5s) for social media content
- Use **Trim End Frames** to drop VEO 3.1 tail dissolves consistently across all clips before concat

## Common Use Cases

- Assemble AI-generated video clips into a sequence
- Join multiple Image-to-Video outputs into a longer video
- Create montages from different generation nodes
- Build final videos from individually processed clips
- Build perfect-loop sequences (combine an i2v clip with itself to create a loop, paired with merge-video-audio for soundtrack)

## Tips

- "Dip-to-black" works well between scenes with different settings or moods
- Audio crossfade prevents jarring audio cuts during transitions — 0.5–1s blends ambient soundtracks smoothly across a hard cut without touching the picture
- Connect a Merge Video & Audio node after combining to add a soundtrack
- Per-clip frame trim is applied uniformly to every connected input — useful when all upstream clips have the same fixed-length tail dissolve
