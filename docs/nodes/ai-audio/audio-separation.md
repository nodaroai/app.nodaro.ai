# Audio Separation
> Separate any audio into vocals + instrumental, or full stems (drums, bass, other, guitar, piano), using Demucs.

## Overview

The Audio Separation node (internally `audio-separation`) uses Demucs (Meta's Hybrid-Transformer source-separation model) on Replicate to split **any** audio into its component stems. It accepts any uploaded or upstream audio (a song, a recording, an extracted video track, etc.), including commercially released recordings, which [Suno Separate](../suno-music/suno-separate.md) refuses.

It has two modes:

- **Vocal / Instrumental** (default) — outputs a clean **vocal** track and an **instrumental** (music-only) track.
- **Full stems** — outputs **vocals, drums, bass, other**, and (on the highest-quality model) **guitar** and **piano**.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | `string` | `"Audio Separation"` | Display name for the node on the canvas |
| Mode | `"vocal_instrumental" \| "stems"` | `"vocal_instrumental"` | Two-stem voice/music split, or full per-instrument stems |
| Quality | `"auto" \| "fast" \| "best"` | `"auto"` | `fast` = base Demucs (htdemucs); `best` = fine-tuned (htdemucs_ft, ~4× slower); `auto` picks the best model for the mode (htdemucs_6s for full stems) |

## Inputs & Outputs

- **Input**: `audio` — any audio file (URL). Wire from an upload, a generated track, or an extracted video audio track.
- **Outputs** (per stem, each an audio URL):
  - `vocals`, `instrumental` (Vocal/Instrumental mode)
  - `vocals`, `drums`, `bass`, `other`, `guitar`, `piano` (Full stems mode)

Outputs not produced by the chosen mode/model are inactive. Wire each stem from its own output. The node no longer has a single `audio` output: a wire saved on that name is left as it is, because it could mean any stem, so reconnect it to the stem you want.

## Credits

Fixed per run (reserved tier, not metered):

| Mode | Quality | Credits |
|------|---------|---------|
| Vocal / Instrumental | Auto / Fast | **33**<!-- credits: audio-separation --> |
| Vocal / Instrumental | Best | **88**<!-- credits: audio-separation:best --> |
| Full stems | Auto / Best | **66**<!-- credits: audio-separation:stems --> |
| Full stems | Fast | **33**<!-- credits: audio-separation --> |

## Best Practices

- Use **Vocal / Instrumental** mode for karaoke/instrumental beds and acapella extraction.
- Use **Full stems** with **Auto** quality to get guitar/piano stems (htdemucs_6s).
- For a commercially released song, this is the node to use — Suno Separate refuses those recordings (or, with **If Suno refuses, use Demucs** on, hands them to Demucs at this node's price).
- For a clean voice **only** (noise/music removed, no instrumental track), use [Voice Extractor](./audio-isolation.md) instead.

## Common Use Cases

- Extracting an instrumental backing track from a finished song
- Pulling an acapella vocal for remixing or lip-sync
- Splitting a track into stems for re-mixing
- Isolating drums or bass for sampling
