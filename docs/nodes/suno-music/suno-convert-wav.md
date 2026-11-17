# Suno Convert WAV
> Convert a Suno-generated MP3 audio track to lossless WAV format.

## Overview

Suno Convert WAV takes a Suno-generated audio track and converts it from compressed MP3 format to uncompressed WAV format. This is useful when higher audio quality is needed for downstream processing, professional production, or archival purposes. The node requires a Suno Task ID and Audio ID from an upstream node. No additional configuration is needed.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Task ID | string | `""` | Suno task ID — inherited from a connected Suno node (the panel shows the inherited value under the field), or paste one manually to work with a track from an earlier session. A live connection takes precedence over a manual value. |
| Audio ID | string | `""` | Suno audio ID — inherited from the connected Suno node's **selected** track (switch tracks on the source node and this follows), or paste one manually. A live connection takes precedence over a manual value. |

No additional configuration fields. The conversion is automatic.

## Stems

A stem from **Suno Separate** converts too: wire the separate node's Vocals, Instrumental, Isolated or Without pip into this node, and the separation's task id and that stem's id are sent. This works for every separation mode, and for a separation of a song made with Suno or of any uploaded audio. On the API, pass the separation job's task id as `taskId` and the stem's id as `audioId` (the separation job's output keeps each stem's id in `sunoStemIds`).

Refused before the run starts, with nothing charged:

- a separation that Demucs made (after Suno refused the audio): it has no Suno stems (`suno_wav_stem`);
- an audio id that is not one of that separation's stems (`suno_wav_stem`);
- a separation that kept no stem ids — one run before they were kept, or delivered by a connected cloud (`suno_wav_stem`): run it again to convert its stems;
- a [Suno Speech](./suno-speech.md) take: it is not a song (`suno_not_a_track`).

A track or a stem made on another account converts as before, so a shared workflow or a published app keeps working.

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node, or a stem pip of Suno Separate
- **Outputs:** `audio` -- WAV format audio URL
## Best Practices

- Place this node at the end of a Suno workflow when you need lossless output for production use.
- WAV files are significantly larger than MP3 -- consider storage implications before converting.
- Use this before feeding audio into FFmpeg processing nodes that benefit from lossless input.
- Not all downstream use cases require WAV -- skip this node if MP3 quality is sufficient.
- The cost is negligible so convert proactively when quality matters.

## Common Use Cases

- Converting generated music to lossless format for professional mixing and mastering.
- Preparing audio for video production pipelines that require uncompressed audio.
- Archiving high-quality versions of Suno-generated tracks.
- Feeding lossless audio into downstream audio processing nodes (mix, adjust volume, etc.).
- Meeting format requirements for platforms or tools that do not accept MP3.

## Tips

- This is one of the simplest Suno nodes -- no configuration beyond the automatic Task ID and Audio ID resolution.
- This is tied with Suno Style Boost as one of the cheapest Suno operations.
- The source must be a Suno track or a stem of a Suno separation. This is not a general-purpose audio format converter.
- WAV output will be uncompressed PCM audio, resulting in much larger file sizes than the source MP3.
