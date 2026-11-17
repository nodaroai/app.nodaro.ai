# Suno Speech
> Generate spoken audio with Suno's expressive speech: from a one-line brief it scripts itself, or from your own script.

## Overview

Suno Speech performs spoken audio — tone, rhythm, emotion and, if you like, background music. It is not a fixed-voice text to speech: the delivery is performed, and every run makes **two takes** to choose from. It has two modes:

- **Brief** (the default): describe the scene in one line ("A short morning news intro about sunny weather") and Suno writes the script and performs it.
- **Script**: write the words to speak, and optionally the tone, how much the two takes may differ, the voice gender and background music.

## Configuration

| Field | Mode | Type | Default | Description |
|-------|------|------|---------|-------------|
| Mode | both | `brief` \| `script` | `brief` | Brief: Suno writes the script from your brief. Script: it speaks your script. |
| Brief (`prompt`) | Brief | text, 1–3,000 characters | `""` | A one-line scene description. |
| Script (`script`) | Script | text, 1–5,000 characters | `""` | The words to speak. Line breaks are kept. |
| Tone (`tone`) | Script | text, up to 1,000 characters | `""` | Tone, rhythm, emotion and setting — an accent or the accompaniment style can go here too. |
| Variety (`variety`) | Script | 0–4 | unset (the model's default) | How far the two takes differ: 0 exact style, 1 balanced, 2 distinct styles, 3 bold exploration, 4 unreasonably varied. |
| Voice (`vocalGender`) | Script | `female` \| `male` | unset (the model picks) | The voice gender. |
| Background music (`backgroundMusic`) | Script | boolean | `false` | Add background music. |

Limits are counted after leading and trailing spaces are removed. An empty brief or script, or one over its limit, is refused before the run starts and nothing is charged. A field of the other mode is never sent: a Brief run sends only the brief, a Script run only the script and the options you set.

## Inputs & Outputs

- **Inputs:** `prompt` — text wired from an upstream node (Text, Generate Text, Suno Lyrics, …). It replaces the mode's own text: the brief in Brief mode, the script in Script mode.
- **Outputs:** `audio` — the selected take. Both takes of every run stay on the node; switch between them on the node, and the output follows.

## Pricing

A run costs 33 credits<!-- credits: suno-speech --> whatever the mode or settings, for both takes.

## API and MCP

- REST: `POST /v1/suno-speech` with `{ "mode": "brief", "prompt": "…" }` or `{ "mode": "script", "script": "…", "tone": "…", "variety": 1, "vocalGender": "female", "backgroundMusic": true }`. It answers `{ "jobId" }`; the job's output has `audioUrl` (the first take), `audioUrls` (both) and `sunoTracks` (each take's id, title and duration).
- MCP: the `suno_speech` tool takes the same fields (`vocal_gender`, `background_music`).

## Best Practices

- Start in Brief mode to hear how Suno reads a scene, then move to Script mode to fix the words.
- Put the delivery in Tone ("warm, calm narrator, slightly smiling") rather than in the script itself — words in the script are spoken.
- Keep Variety low when you need two near-identical takes to pick from, and raise it to explore.

## Common Use Cases

- Voice-overs and narration for videos and slideshows.
- News intros, announcements and podcast openers.
- Short dialogue lines and character readings to feed Lip Sync or Merge Video & Audio.

## Tips

- Suno Speech is a separate model from Suno's music nodes: its takes cannot be extended, separated, covered or converted to WAV by their Suno ids. Those runs are refused before they start, with nothing charged: Extend, Separate and Convert to WAV answer `suno_not_a_track`, and Suno Cover given a take's ids with no audio answers `suno_cover_source`. A take's audio works wherever a node takes any audio: Suno Cover and Suno Separate take it as a file.
- A wired script from Suno Lyrics or Generate Text runs as it arrives — check its length first.
