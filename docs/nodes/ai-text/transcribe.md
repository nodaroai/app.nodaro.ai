# Transcribe
> Convert spoken audio to text with optional speaker diarization and audio event tagging.

## Overview

The Transcribe node uses ElevenLabs Speech-to-Text to convert audio into a text transcript. It supports automatic language detection or explicit language selection, speaker diarization (identifying who said what), and audio event tagging (labeling non-speech sounds like music, laughter, or applause). The output includes the full transcript text as well as per-segment results with timestamps.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `TranscribeProvider` | `"elevenlabs-stt"` | Transcription engine |
| Language | `string` | `"auto"` | Language code for the audio, or "auto" for automatic detection. Supports 20+ languages |
| Speaker Diarization | `boolean` | `false` | When enabled, identifies and labels different speakers in the transcript |
| Tag Audio Events | `boolean` | `false` | When enabled, annotates non-speech audio events (music, laughter, applause, etc.) in the transcript |

## Inputs & Outputs

- **Input**: `in` -- audio file to transcribe
- **Output**: `text` -- full transcript text string

### Output Details

The node produces both a simple text output and structured result data:

| Field | Type | Description |
|-------|------|-------------|
| generatedText | `string` | The full transcript as plain text |
| generatedResults | `array` | Array of result objects, each containing `text`, `language`, `jobId`, and `timestamp` |

When Speaker Diarization is enabled, the transcript includes speaker labels (e.g., "Speaker 1:", "Speaker 2:") before each segment.

When Tag Audio Events is enabled, non-speech sounds are annotated inline (e.g., "[music]", "[laughter]").

## Credit Cost

2 credits per transcription (`elevenlabs-stt`).

## Best Practices

- Use auto-detect for language unless you know the audio is in a specific language. Explicit language selection can improve accuracy for languages that sound similar.
- Enable Speaker Diarization when the audio contains multiple speakers (interviews, meetings, podcasts) to get labeled segments.
- Enable Tag Audio Events when the audio context matters (e.g., transcribing a video where background sounds are relevant to understanding).
- For best accuracy, use clean audio. Consider running the Voice Extractor node upstream if the source has significant background noise.
- Shorter audio segments transcribe more reliably. For very long audio, consider splitting into segments first.

## Common Use Cases

- Transcribing interview or podcast audio for written content
- Generating subtitles and captions from video audio tracks
- Converting voice memos or meeting recordings to text
- Creating searchable text archives from audio libraries
- Feeding transcripts into downstream AI nodes for summarization or analysis

## Tips

- The output connects to any text-consuming node. Common downstream connections include AI Writer (for summarization), Combine Text (for assembly), and Add Captions (for subtitle generation).
- Speaker diarization and audio event tagging are independent options -- you can enable one, both, or neither.
- The transcription is processed asynchronously via the backend worker queue. Progress is shown in the node during execution.
- Language auto-detection works across the full set of supported languages. The explicit language dropdown provides 20+ language options matching the ElevenLabs STT model's capabilities.
- For word-level timestamps (rather than segment-level), use the Forced Alignment node with the transcript output of this node.
