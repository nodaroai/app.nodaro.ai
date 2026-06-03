# Extract Audio

> Demux the audio track from a video to a standalone MP3.

## Overview

The Extract Audio node pulls the audio track out of a video and outputs it as a standalone MP3 file. It's the audio half of "splitting" a clip — pair it with [Remove Audio](../processing-video/remove-audio.md) (the video half) or use it on its own to feed the audio into transcription, dubbing, voice, or music nodes.

There are no settings — connect a video and run.

## Inputs & Outputs

**Inputs:** Video (required)

**Outputs:**
- Audio (MP3)

## Configuration

This node has no configurable fields.

## Best Practices

- The node fails with a clear error if the source video has no audio track — make sure the clip actually contains sound.
- Want the silent video instead of the audio? Use [Remove Audio](../processing-video/remove-audio.md).
- To later recombine a processed audio track with a video, use [Merge Video & Audio](./merge-video-audio.md).

## Common Use Cases

- Pull a video's audio to feed [Transcribe](../ai-audio/transcribe.md), [Dubbing](../ai-audio/dubbing.md), or [Voice Changer](../ai-audio/voice-changer.md)
- Extract a soundtrack from a video clip for reuse
- Isolate dialogue or music for downstream audio processing

## Tips

- The output is always MP3. For format control or to cut a section, use [Trim Audio](./trim-audio.md), which can also extract audio from a video.
