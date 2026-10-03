# Apply EDL

> Render an edit decision list (EDL) into one finished media file — plus, optionally, a transcript remapped to match the cut.

## Overview

The Apply EDL node takes a structured **edit decision list** and renders it into a single video or audio file with one FFmpeg pass. An EDL is a compact, JSON description of an edit: a list of `sources` (the media it draws from) and an ordered list of `segments` (which slice of which source plays, and in what order). Because the EDL is data, an editorial node (or an agent, or you by hand) can decide *what* the edit is, and Apply EDL turns that decision into pixels and sound.

Every segment names a time window on the **master clock**; the node trims each source to that window, conforms the picture to one canvas, and joins the segments in order. Hard-cut boundaries abut; crossfade boundaries overlap, so the rendered timeline is *shorter* than the sum of the segment lengths by the total crossfade time.

When you wire a **Transcript** into the node, it emits that transcript **remapped through the cut** on its `json` output — words that fall in removed material are dropped and a word straddling a cut is clipped to the kept part — so captions built downstream stay aligned to the finished edit.

All processing is local FFmpeg. No provider key is required.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| EDL | json | **Yes** | The edit decision list. Wire it from an editorial node or a Text/JSON source. Media resolves from each source's `url`. |
| Transcript | json | No | A transcript to remap through the cut for the `json` output (e.g. from a Transcribe node). |
| Sources | video/audio | No | Optional media-URL overrides for the EDL's sources, applied **positionally** in connection order. The EDL's own `url` values are the primary path; use this only when the media isn't addressable by URL in the EDL. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Media | video **or** audio | The rendered cut. Its type follows the **Output** setting. |
| Transcript | json | The wired transcript remapped through the cut. Empty when no transcript is wired. |

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Output | Select | video | Render `video` (picture + sound) or `audio` (sound only). |
| Quality | Select | final | `final` = full-quality delivery; `proxy` = a fast 720p review render. |
| Default crossfade (ms) | Number | 0 | Crossfade applied at every boundary that has **no** explicit transition in the EDL. Clamped per-boundary to 90% of the shorter neighbouring segment (the FFmpeg limit), so it can never over-blend a short segment. `0` = hard cuts. |

## How the edit is rendered

- **Segment order is the timeline.** The node never re-sorts segments — a multicam or clip-reordering EDL legitimately revisits earlier source time.
- **Boundaries.** A `cut` boundary abuts the two segments; a `crossfade` boundary overlaps them (an FFmpeg `xfade` for video, `acrossfade` for audio), which *compresses* the timeline by the crossfade length.
- **Master audio.** If one source is marked as the master audio, every segment's sound comes from it — a camera switch never touches the sound. Otherwise each segment uses its own audio. A source's `role`, when set, must be one of `master-audio`, `camera`, `wide` or `screen` — an unknown role (a misspelled `master-audio`, say) is refused at ingress rather than silently falling back to each camera's own sound.
- **Validation up front.** The EDL is normalized and validated before any render starts, so a missing or unresolvable source, or a video edit with a picture-less segment, is reported immediately (with the offending id named) rather than failing mid-render.
- **At most 3 hours of output per render.** One render produces at most **180 minutes** of output, measured on the finished (crossfade-compressed) length — the same length the price is computed from. A longer edit is refused before anything is charged: the API answers `400` with `code: "invalid_edl"` and a message naming the edit's length and the limit (e.g. `EDL failed validation: the edit renders 200 minutes of output — over the 180-minute limit for one render; split it into parts of at most 180 minutes`); a workflow run fails that node with the same reason, and the MCP `apply_edl` tool returns it as an error. Split a longer programme into parts and render each separately.
- **What this node refuses.** It renders one source per segment, full frame, with `cut` or `crossfade` boundaries. Anything else the EDL contract can describe is refused up front rather than silently dropped: a layout whose `mode` is not `single`, a layout with more than one slot or whose one slot names a different source than the segment's `video`, a layout `emphasis` other than `none`, a layout transition other than `cut` (`pan`, `zoom`, `xfade:…`), and region crops on a segment, a slot or a source — these are speaker-view features that belong to a different node. A segment that starts before its source's origin (`inMs` earlier than the source's `offsetMs`) is refused too; for an audio-only output only the sound source counts.
- **Segments must fit their sources.** Whether a segment runs past the end of its media can only be known from the file itself, so that is checked once the sources are downloaded — against the **real end of the track the segment reads** (the picture track for a video render, the sound track always), measured from that track's own timestamps on the clock the render reads, rather than from the length the container declares (an mp3 without a proper header under-reports it; a browser recording omits it). A violation **fails the job right away, naming the segment, the source and the track** — credits refunded, not retried, since the same edit would fail the same way — rather than quietly delivering a shorter cut than the EDL (and its price) describes. The same happens when a segment's picture source has no video track at all (an audio file, or an mp3 whose only picture is embedded cover art). A reach of up to one second past a track's end is treated as rounding: the segment still renders its full length, holding the picture's last frame and continuing the sound as silence for the part past the end, so every later cut stays in sync and the output is exactly the EDL's length; MPEG-TS / program-stream containers (whose per-track timestamps are not on the render's clock) are checked against the length the container declares instead, with five seconds of slack: a segment reaching further fails the job the same way, and one inside it keeps its full length (frozen last frame over silence for the part past the end). That declared length is trusted only when the file's timestamps run continuously; a recording whose timestamps jump (two recordings joined into one file, a stream that reconnected, a recorder whose clock restarted) declares a length other than what it actually plays, so it is not checked, as below. A track whose end cannot be read at all is not checked — a segment that runs past it keeps its full length the same way, however long the overrun is.
- **Long edits render in pieces, joined seamlessly.** An edit with more than 30 segments is rendered at most 30 segments at a time, split only at hard cuts. A run of segments joined by crossfades (with **Default crossfade** on, the whole edit) is split inside one of its clips instead, at an invisible cut that leaves every crossfade exactly as it was. Only a run whose clips are all too short for their crossfades to be cut (for example 1-second clips under 5-second crossfades) renders as one piece, however long it is. The picture pieces are joined without re-encoding, frame-exact. The sound is rendered losslessly in pieces, joined sample-exact and encoded to AAC once, for video and audio-only renders alike. So a long render's sound ends exactly on the edit's length, with no gap or click at any join.
- **Long renders in a workflow.** A final-quality render of a long episode can take hours. Each Apply EDL render gets a time budget sized from its own edit (the render allowance of every chunk, plus downloading and probing its sources). A chunk's allowance grows with its output, with how much of each source it must read through to reach its clips (a few short clips spread across a long recording take far longer than the same clips back to back), and with the picture size (a 4K render gets about four times the 1080p allowance); inside a workflow the node is allowed that full budget instead of the standard 90 minutes per node, and the workflow's overall limit (normally 120 minutes) grows by the same amount. Workflows without such a render keep the standard limits. If the service running the workflow restarts mid-render (for example during a deploy), the resumed run re-attaches to the render that is still in progress instead of starting it again, and the render's time budget keeps counting from when it first started — a restart never grants it extra time. Cancelling a run stops a render that is in progress at its next chunk.

## Credit Cost

Priced **per minute of rendered output**, measured on the finished (crossfade-compressed) length:

- **Formula:** `10 credits × ceil(output_seconds ÷ 60)`
- **Floor:** minimum 1 minute (10 credits)

| Rendered output length | Minutes billed | Credits |
|------------------------|----------------|---------|
| 40 seconds | 1 | 10 |
| 3 min 10 s | 4 | 40 |
| 12 min 00 s | 12 | 120 |

The **reserve** is computed from the EDL's own durations (crossfades already subtracted), so what you are charged matches the render.

### What the estimate shows before you run

The cost on the node, the **Run** button and the run-confirm dialog is an **estimate** at the current rate — what a render realistically costs, leaning high. It is not a guarantee: the true length of a cut is decided by the plan, and when that plan is about to be regenerated the editor cannot know it yet.

**When the cut already exists, the estimate is exact:**

- **An EDL set on the node itself** (nothing wired into **EDL**) is exactly what renders.
- **Running only this node** — the **Run** button, or the cost shown on the node — renders the plan already on the canvas, so it is priced at that plan's own length.

**When an upstream Edit Plan re-plans in the same run** (running the whole workflow), the plan on the canvas is the *previous* run's and is ignored — last week's shorter episode must not under-price this week's:

- **Tighten** is priced at the **episode's full length** (the longer of the master source and the transcribed media). A tightened cut is normally shorter, so this over-quotes. With no recorded length it prices the 180-minute ceiling — see [Edit Plan](./edit-plan.md#what-the-estimate-shows-before-you-run).
- **Clips** is priced **per clip at twice the clip-length setting** (the setting is a target the planner aims near, not a limit; with no setting, 90 seconds is assumed), never more than the episode, multiplied by the **clip count** (8 when unset, at most 50). Every node fed from the render with an *each* edge — such as Add Captions — is counted per clip too. A planner that returns much longer clips than the target can cost more than the estimate.
- **An EDL from any other node that re-runs** prices the 180-minute ceiling.

The balance check before a run compares against this estimate. You are **charged for the length of the cut that is rendered** — computed from its EDL — never for the estimate.

## Common Use Cases

- Render a transcript-driven "tighten" of a long recording into a clean cut.
- Assemble a set of clip ranges into one deliverable from a single edit description.
- Produce an audio-only cut of an edit (podcast episode) with the same timeline as its video version.
- Emit an aligned transcript alongside the cut to feed a captions node.

## Tips

- Leave **Default crossfade** at 0 for talking-head/podcast edits — hard cuts on speech read cleanly, and the EDL can still ask for a crossfade on any individual boundary.
- Use **Proxy** quality for review passes, then switch to **Final** for delivery.
- Wire a Transcribe node's transcript into the **Transcript** input so the `json` output carries the transcript **remapped onto the finished edit** — every word timestamp shifts to match the cut. Downstream nodes read that aligned transcript — wire it into [Add Captions](add-captions.md#transcript-input)' `transcript` input and the captions follow the cut. Captions need the transcript's **words**, so run that Transcribe node on `elevenlabs-stt` or `incredibly-fast-whisper`: a `whisper` transcript (phrase segments, no words) that reaches Add Captions through this node is [refused before the run](../ai-text/transcribe.md#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run), with nothing billed.
