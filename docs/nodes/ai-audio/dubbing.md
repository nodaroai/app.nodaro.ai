# Dubbing
> Translate spoken audio into another language while preserving the original speaker's voice and identity.

## Overview

The Dubbing node uses ElevenLabs Dubbing to translate audio from one language to another. It preserves the speaker's voice characteristics, making the output sound like the same person speaking in a different language. The process is asynchronous -- the node submits the dubbing job, polls for completion, and returns the translated audio when ready.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Target Language | `string` | `"es"` | Language code for the desired output language (required) |
| Source Language | `string` (optional) | auto-detect | Language code of the input audio. Leave empty for automatic detection |
| Number of Speakers | `number` (1-10, optional) | auto-detect | Number of distinct speakers in the input. Leave empty for automatic detection |

## Inputs & Outputs

- **Input**: `in` -- source audio file to be dubbed
- **Output**: `audio` -- dubbed audio file in the target language (URL)
## Best Practices

- Explicitly set the source language when you know it -- auto-detection is reliable but specifying it avoids edge cases with accented or mixed-language speech.
- Specify the number of speakers if the input has multiple voices. Auto-detection works but can occasionally merge or split speakers incorrectly.
- Use clean source audio without heavy background music. The model handles moderate background noise, but music overlapping speech degrades quality.
- For best voice preservation, ensure the source audio has clear, well-separated speech segments.
- Test with shorter clips first before dubbing long audio to verify the target language quality meets expectations.

## Common Use Cases

- Localizing podcast episodes or video narration for international audiences
- Creating multilingual versions of training or educational content
- Dubbing interview audio for cross-language content repurposing
- Translating voiceover tracks for marketing videos
- Making content accessible in languages the original speaker does not know

## Tips

- The dubbing process is asynchronous and may take longer than other audio nodes, depending on the length of the input audio.
- The internal flow is: submit dubbing job, poll for completion, download the dubbed audio. Progress is shown in the node during execution.
- Target language uses standard language codes (e.g., "es" for Spanish, "fr" for French, "de" for German, "ja" for Japanese).
- This is one of the more computationally intensive audio operations, reflecting the complexity of voice-preserving translation.
- For simple translation of text (without voice preservation), consider using a Translate node followed by Text to Speech instead.
- The node preserves speaker identity but not background audio -- the output contains only the translated speech.
