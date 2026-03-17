# Forced Alignment
> Generate word-level timestamps by aligning a transcript to its corresponding audio.

## Overview

The Forced Alignment node uses the ElevenLabs Forced Alignment API to match each word in a provided transcript to its exact position in the audio. The output is structured JSON data containing word-level start and end timestamps. This is a data-producing node -- it outputs timing information, not audio.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Transcript | `string` (textarea, required) | `""` | The full text transcript of the audio input. Must accurately match what is spoken in the audio |

## Inputs & Outputs

- **Input**: `in` -- audio file to align against the transcript
- **Output**: `data` -- JSON array of word-level timestamps (not audio)

### Output Format

The output is an array of `AlignmentWord` objects:

```json
[
 { "word": "Hello", "start": 0.0, "end": 0.35 },
 { "word": "world", "start": 0.38, "end": 0.72 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| word | `string` | The aligned word |
| start | `number` | Start time in seconds |
| end | `number` | End time in seconds |
## Best Practices

- The transcript must closely match the actual spoken content for accurate alignment. Mismatches between the transcript and audio will produce unreliable timestamps.
- Clean up the transcript before alignment -- remove filler words, false starts, or non-speech annotations unless they are actually spoken in the audio.
- Use the Voice Extractor node upstream if the audio has significant background noise, as clean audio produces better alignment accuracy.
- For long audio files, ensure the transcript covers the full duration. Partial transcripts will only align the covered portion.

## Common Use Cases

- Generating precise word-level timestamps for subtitle/caption creation
- Building karaoke-style word highlighting synchronized to audio
- Creating timed animations or motion graphics that react to specific words
- Synchronizing visual elements to speech in video compositions
- Quality-checking TTS output timing against expected pacing

## Tips

- This node outputs `data`, not `audio`. The output handle is `"data"`, which means it connects to data-consuming nodes rather than audio-consuming ones.
- The transcript should be plain text without formatting, timestamps, or speaker labels. Just the words as spoken.
- Forced alignment works best with clear, well-paced speech. Rapid speech, heavy accents, or overlapping speakers may reduce accuracy.
- Pair this node with the Add Captions processing node for automated subtitle generation with precise word timing.
- The alignment data can be consumed by downstream nodes that need timing information, such as motion graphics or video composition nodes.
