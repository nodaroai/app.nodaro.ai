# Voice Clone
> Clone a voice from a short audio sample and get a reusable voice ID for Text to Speech, Voice Changer, and Voice Changer Pro.

## Overview

Voice Clone creates an instant voice clone (ElevenLabs) from a reference recording: give it a clean audio sample and a name, and you get back a custom voice that appears in the **My Voices** tab of the Voice Browser and can be selected anywhere a voice can — Text to Speech, Text to Dialogue, Voice Changer, and Voice Changer Pro.

Unlike the other pages in this section, Voice Clone is not a canvas node. It's a platform capability you reach from the Voice Browser (and from every API surface):

- **In the editor** — open any voice-picking node's Voice Browser and switch to the **My Voices** tab. Upload a sample, name it, and hit **Clone Voice**. The new voice is immediately selectable.
- **REST** — `POST /v1/voice-clones` (multipart file upload) or `POST /v1/voice-clones/from-url` (already-uploaded sample). `GET /v1/voice-clones` lists yours; `PATCH`/`DELETE /v1/voice-clones/:id` manage them.
- **SDK** — `client.voices.createClone({ name, audioUrl })` or `client.voices.createCloneFromFile({ name, file })`; `listClones()` / `deleteClone(id)`.
- **CLI** — `nodaro voice clones create --name <name> --audio <url>|--file <path>`, plus `clones list` / `clones delete <id>`.
- **MCP** — the `voice_clone` tool (pass `audio_url` or an `audio_asset_id` from a prior job, plus a `name`).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Name | `string` | — | Display name for the clone (shown in My Voices) |
| Sample | audio file or URL | — | The reference recording to clone. Max **10 MB** |

## Output

The create call returns the clone row — the field that matters is `elevenlabsVoiceId`: pass it as the voice anywhere a `voice_id` is accepted. The row also carries `sampleAudioUrl` (your uploaded reference) and `id` (the management id used by `PATCH`/`DELETE`).

## Credit Pricing

Cloning costs **5 credits** per clone (the price is shown on the Clone Voice button). Using a cloned voice afterwards costs the same as any other voice — you pay the generation, not the voice.

## Best Practices

- Use 30–90 seconds of clean, single-speaker audio. Background music, other speakers, and heavy processing all degrade the clone.
- Record at a consistent distance from the microphone; avoid clipping.
- The sample's speaking style carries into the clone — an energetic sample yields an energetic voice.
- Clone once, reuse everywhere: the `elevenlabsVoiceId` works across Text to Speech, Voice Changer, and Voice Changer Pro (including per-speaker entries in `orderedVoices`).
- If a clone drifts from how the sample sounds, delete it and re-clone from a cleaner sample rather than fighting generation settings.

## Common Use Cases

- Personalized re-voicing: clone your own voice, then use Voice Changer to make any recording speak as you
- Recasting an interview's speakers to consistent brand voices with Voice Changer Pro
- A narrator voice reused across every Text to Speech node in a project
- Localizing content while keeping a familiar voice (pair with Dubbing)

## See also

- [Voice Changer](./voice-changer.md) — single-voice re-voicing
- [Voice Changer Pro](./voice-changer-pro.md) — per-speaker recasting
- [Voice Design](./voice-design.md) — design a synthetic voice from a description instead of a sample
