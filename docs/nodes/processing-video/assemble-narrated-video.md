# Assemble Narrated Video

> Fit N ordered (clip, voice) blocks into one narrated MP4 — audio is never cropped.

## Overview

The Assemble Narrated Video node is the finishing step for a narrated-video pipeline: it
takes N ordered pairs of (silent clip, voice take) and fits each voice to its clip
automatically, then concatenates the fitted blocks into a single MP4. It is audio-led —
the voice always plays in full, never trimmed to fit the picture:

- **Voice ≤ clip** — the clip plays as-is; the voice is centered in the block with silence
  padding on both sides, mixed over the clip's own audio (its "ambient bed") at a lower
  volume.
- **Voice > clip** — the clip is slowed down (`setpts`) to stretch to the voice's length,
  capped at `maxSlowdown`. If the voice is still longer than the capped, stretched clip,
  the clip's **last frame holds** for the remainder so the voice always finishes over
  picture.
- **No voice for a block** — the block passes through untouched (its own audio, if any, is
  kept; if it has none, a silent track is synthesized so the final concat never breaks).

All processing is done locally via FFmpeg — there is no external provider call, so pricing
is flat per-block rather than per-second of output.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Voice Volume | Number (%) | 100 | 0–200. Loudness of the voice track in the mix. |
| Clip Audio Volume | Number (%) | 40 | 0–200. Loudness of the clip's own audio (the "ambient bed") under the voice. |
| Max Slowdown | Number (×) | 1.5 | 1–2. Cap on how much a clip can be slowed to match a longer voice. Beyond this factor the clip's last frame holds instead of slowing further. |
| Trim Start Frames | Number (frames) | 0 | 0–120. Trimmed from the start of every clip **except the first** (interior-join seam trim). |
| Trim End Frames | Number (frames) | 0 | 0–120. Trimmed from the end of every clip **except the last** (interior-join seam trim). |

Trim Start/End Frames mirror [Combine Videos](./combine-videos.md)'s per-clip trim: the
first block's start edge and the last block's end edge are always protected, so trimming
only ever removes interior-join seams, never the video's true head or tail.

## Inputs & Outputs

**Inputs:**
- **Video** (list) — N ordered video clips, one per block.
- **Audio** (list) — N ordered voice takes, one per block, paired to the video list **by
  index**: block `i` = video clip `i` + audio clip `i`.

**Pairing rules:**
- The audio list may be **shorter** than the video list — trailing video blocks with no
  matching audio entry pass through untouched (no voice).
- The audio list **must not be longer** than the video list. Connecting more voice clips
  than video clips is a pre-flight validation error (fails before any API/FFmpeg call,
  rather than silently dropping the extra voice takes).
- At least 1 video block is required. Up to 60 blocks are supported per run.

**Outputs:** Single assembled video (all blocks concatenated in order).

## Credit Cost

Assemble Narrated Video is priced **per block**, not per second of output (all processing
is local FFmpeg — no external provider cost):

```
credits = 3 + ceil(N / 6)
```

where `N` is the number of blocks (video clips) in the run.

| Block count (N) | Credits |
|---|---|
| 1–6 | 4 |
| 7–12 | 5 |
| 13–18 | 6 |
| 19–24 | 7 |
| 25–30 | 8 |
| 31–36 | 9 |
| 37–42 | 10 |
| 43–48 | 11 |
| 49–54 | 12 |
| 55–60 | 13 |

Worked examples: 6 blocks → **4** credits, 24 blocks → **7** credits, 60 blocks (the cap) →
**13** credits.

> **Known gap:** the formula above is exact for single-node Run, MCP, and SDK calls (they
> go through the route's `computeCredits` hook). Server-side **workflow-engine** runs
> (executing this node as part of a larger workflow) currently reserve the flat 6-block
> base — **4 credits** — regardless of actual block count; the payload builder does not yet
> build a block-count-scaled composite identifier the way it does for other dynamically
> priced nodes. This is a tracked billing follow-up, not a docs error.

## Fallback & Edge-Case Behaviors

- **Clip has no audio stream.** Handled as a first-class case, not an error. If the block
  also has no voice, a silent audio track is synthesized for the block's exact final
  duration (so the trailing concatenation always has a uniform audio stream across blocks).
  If the block has a voice, the voice plays alone (no ambient bed to mix under it).
- **Voice longer than clip, beyond `maxSlowdown`.** The clip slows to the cap, then its
  last frame holds for the remaining duration — the voice is never cut short and always
  finishes over picture.
- **Voice longer than the video list itself.** Rejected before the run starts: "N voice
  clips but only M video clips — connect at most one voice clip per video clip."
- **Interior-join seam trims.** `Trim Start Frames` / `Trim End Frames` never touch the
  very first clip's start or the very last clip's end — only interior joins are affected,
  same protection as Combine Videos.

## Best Practices

- Keep clips speech-free — the voice track carries all spoken narration; a talking mouth
  in a slowed (retimed) clip will desync from its own lip movement.
- Use one consistent voice (`voice_id`) across all blocks for a coherent narrator.
- Leave Trim Start/End Frames at 0 for plain hard-cut sequences; only set them when
  clips are continuations of each other and need seam-blending at interior joins.
- Lower Clip Audio Volume (or leave it at the 40% default) so ambient bed never competes
  with the voice.

## Common Use Cases

- Narrated explainer videos: one style-locked silent clip + one voice take per beat.
- Product walkthroughs where a script is recorded separately from the b-roll.
- Any narrated-video pipeline that authors clips and voice takes independently and needs
  them fitted together without manual timeline editing.

## Related

- [Combine Videos](./combine-videos.md) — sibling FFmpeg concatenation node (no per-clip
  audio fitting).
- [MCP `assemble_narrated_video` tool](../../mcp/tools.md#video-generation-tools) — the
  same capability exposed to MCP clients, plus the `video-explainer` content recipe that
  drives this node end-to-end (see [Content Recipes](../../mcp/recipes.md)).
