# Voice Extractor
> Isolate and clean up vocal audio by removing background noise and non-speech elements.

## Overview

The Voice Extractor node (internally `audio-isolation`) uses ElevenLabs voice isolation to separate speech from background noise, music, and other non-vocal audio. It takes any audio input and outputs a clean version containing only the isolated voice. This is useful as a preprocessing step before feeding audio into other speech-related nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | `string` | `"Voice Extractor"` | Display name for the node on the canvas |

No additional configuration is required. The node processes the input audio automatically.

## Inputs & Outputs

- **Input**: `in` -- audio file containing speech mixed with background noise or music
- **Output**: `audio` -- cleaned audio file with isolated voice (URL)

## Credit Cost

1 credit per extraction (`elevenlabs-isolation`).

## Best Practices

- Use this node before Text to Speech voice cloning to ensure the reference audio is clean and free of background noise.
- Place it upstream of the Transcribe node when working with noisy audio to improve transcription accuracy.
- Works best when the input contains recognizable speech -- purely instrumental or non-vocal audio will produce minimal output.
- For best results, the input audio should have at least some audible speech content above the noise floor.

## Common Use Cases

- Cleaning up interview or field recording audio before editing
- Preprocessing noisy audio before transcription
- Extracting vocal tracks from music or mixed audio for voice cloning
- Removing background noise from podcast recordings
- Isolating dialogue from video audio tracks before dubbing

## Tips

- The node processes the entire audio input -- there is no option to select a time range. Use the Trim Audio processing node first if you only need a specific segment.
- Output quality depends heavily on input quality. Audio where speech is heavily buried under noise may produce artifacts.
- This node outputs audio, not data. For word-level timing information, use the Forced Alignment node instead.
- At 1 credit per use, this is one of the most cost-effective AI audio nodes.
