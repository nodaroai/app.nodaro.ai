# Voice Extractor
> Isolate and clean up vocal audio by removing background noise and non-speech elements.

## Overview

The Voice Extractor node (internally `audio-isolation`) uses ElevenLabs voice isolation, through ElevenLabs' own API, to separate speech from background noise, music, and other non-vocal audio. It takes any audio input and outputs a clean version containing only the isolated voice. This is useful as a preprocessing step before feeding audio into other speech-related nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | `string` | `"Voice Extractor"` | Display name for the node on the canvas |

No additional configuration is required. The node processes the input audio automatically.

## Inputs & Outputs

- **Input**: `audio` -- an audio file containing speech mixed with background noise or music. A video file works too: only its sound is sent, never the picture.
- **Output**: `audio` -- cleaned audio file with isolated voice (URL). It is stored in the format ElevenLabs returns.

## Pricing

The node is priced by the length of its audio, as the server reads it from the file before anything is charged: **11 credits<!-- credits: elevenlabs-isolation:per-10s@1 --> per started 10 seconds**, at least one. A length up to 0.05 seconds past a 10-second mark is charged at that mark.

| Audio length | Credits |
|---|---|
| 8 s | 11 credits<!-- credits: elevenlabs-isolation:per-10s@1 --> |
| 30 s | 33 credits<!-- credits: elevenlabs-isolation:per-10s@3 --> |
| 60 s | 66 credits<!-- credits: elevenlabs-isolation:per-10s@6 --> |
| 5 min | 330 credits<!-- credits: elevenlabs-isolation:per-10s@30 --> |
| 30 min | 1,980 credits<!-- credits: elevenlabs-isolation:per-10s@180 --> |

The credits held when the run starts are the credits charged. The price shown before a run uses the length of the wired audio when the editor knows it (an upload, a recording, a node that makes audio of a set length); otherwise it shows the 30-minute price, marked as an estimate (≈), and the run is charged for the audio's real length.

### Limits

- **30 minutes.** Audio longer than 30 minutes (more than 0.05 seconds past) is refused before anything is charged, with a message that names the limit. Split or trim it first (Trim Audio, or Split Media), then isolate the parts.
- **500 MB.** A file larger than 500 MB is refused and nothing is charged.
- An audio whose length cannot be read is refused before anything is charged; check that the link is a reachable audio or video file in a common format.

A step after it that measures the audio it is given and is charged by its length (Lip Sync, Pitch & Tempo, Dubbing, …) quotes the isolated voice a quarter second past its input's length, as after a Dubbing, whose file was measured to run up to about 0.13 seconds past its input: a Lip Sync priced per second on an Audio Isolation of a 4.8-second recording is quoted as 6 seconds.
## Best Practices

- Use this node before Voice Changer or Lip Sync to ensure the source audio is clean and free of background noise.
- Place it upstream of the Transcribe node when working with noisy audio to improve transcription accuracy.
- Works best when the input contains recognizable speech -- purely instrumental or non-vocal audio will produce minimal output.
- For best results, the input audio should have at least some audible speech content above the noise floor.

## Common Use Cases

- Cleaning up interview or field recording audio before editing
- Preprocessing noisy audio before transcription
- Extracting vocal tracks from music or mixed audio for re-voicing
- Removing background noise from podcast recordings
- Isolating dialogue from video audio tracks before dubbing

## Tips

- The node processes the entire audio input -- there is no option to select a time range. Use the Trim Audio processing node first if you only need a specific segment.
- Output quality depends heavily on input quality. Audio where speech is heavily buried under noise may produce artifacts.
- This node outputs audio, not data. For word-level timing information, use the Forced Alignment node instead.

