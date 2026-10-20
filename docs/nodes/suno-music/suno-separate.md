# Suno Separate
> Separate any audio with Suno: vocals from the instrumental, a song into its stems, or one named instrument out of the mix.

## Overview

Suno Separate splits **any** audio. That can be a track from an upstream Suno node, an upload, the audio output of another node, or a URL. It has three modes:

- **Vocals / instrumental** (`separate_vocal`, the default): a vocal track and an instrumental track.
- **Full stems** (`split_stem`): every stem Suno finds in the track (drums, bass, guitar, piano, backing vocals, and so on).
- **One instrument** (`split_stem_advanced`): the instrument you name, alone, plus the song without it.

### Where the audio comes from

The node picks the source by itself. There is no switch to set.

- **A Suno task ID**, from a connected Suno track or typed into the node: Suno separates its own track by its IDs. The audio ID is taken from a connected Suno track first, then from the node's own Audio ID field; when there is none, the task ID is used as the audio ID. Workflows built on a Suno track run exactly as they did before any audio was accepted.
- **Any other audio** (an upload, another node's audio, a URL): the file is sent to Suno by its URL. Audio sent this way can be up to **20 MB**.
- **One instrument** works on both. On a Suno track it uses the track's IDs; on any other audio it sends the file by URL.

If the node has a Suno task ID (from a wired Suno node or typed in) as well as other audio, it uses the IDs and ignores the other audio, in the editor and in workflow runs alike. An audio ID without a task ID does not count. Clear Task ID to separate the wired audio instead.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Separation Type | `"separate_vocal" \| "split_stem" \| "split_stem_advanced"` | `"separate_vocal"` | **Vocals / instrumental**, **Full stems** or **One instrument**. |
| Instrument (`stemName`) | string | `"Lead Vocal"` | One instrument mode only. One of Suno's instrument names, such as `Lead Vocal`, `Piano`, `Drum Kit`, `Bass` or `Backing Vocals`. |
| If Suno refuses, use Demucs (`fallbackToDemucs`) | boolean | off | When Suno refuses the audio, separate it with Demucs (the engine behind the [Audio Separation](../ai-audio/audio-separation.md) node) instead of failing. Vocals / instrumental and Full stems only. See [When Suno refuses](#when-suno-refuses). |
| Task ID | string | `""` | Optional. A Suno task ID, to separate a Suno track that is not wired in. A wired Suno node supplies these automatically. |
| Audio ID | string | `""` | Optional. The Suno audio ID that goes with the Task ID. Left empty, the Task ID is used. |

## Inputs & Outputs

- **Input:** `audio` — any audio: a Suno track, an upload, another node's audio output, or a URL.
- **Outputs** (each an audio URL):
  - `vocals` — the vocal track.
  - `instrumental` — the instrumental track.
  - `isolated` — the instrument you named, alone (One instrument mode).
  - `without` — the song without that instrument (One instrument mode).

Which outputs are live depends on the mode. `isolated` and `without` light up only in One instrument mode, and `vocals` and `instrumental` are greyed out there. An output with nothing behind it stays empty. It is never filled with the original audio.

### What each mode returns

**Vocals / instrumental:** `vocals` and `instrumental`.

**Full stems:** every stem Suno returns, listed in the node. You can play and download each one, but the stems are not outputs you can wire to other nodes. The `vocals` output carries the vocal stem. In full-stems mode `instrumental` is empty unless Suno returns an instrumental stem. (It used to pass on the vocals by mistake.)

**One instrument:** Suno returns two takes. Take 1 drives the `isolated` and `without` outputs. Take 2 is shown in the node, where you can play and download it, but it cannot be wired.

### Job output (API and MCP)

A finished job's `output_data` holds one URL field per result:

- `vocalUrl`, `instrumentalUrl`
- Full stems: `backingVocalsUrl`, `drumsUrl`, `bassUrl`, `guitarUrl`, `pianoUrl`, `keyboardUrl`, `percussionUrl`, `stringsUrl`, `synthUrl`, `fxUrl`, `brassUrl`, `woodwindsUrl`, and `otherUrl` (only after a Demucs fallback)
- One instrument: `isolatedUrl` and `withoutUrl` (take 1), `isolated2Url` and `without2Url` (take 2)
- `audioUrl`: the main result (the vocals, else the instrumental, else the isolated instrument, else the first stem)

A stem Suno did not return is absent. When the run fell back to Demucs, `engineUsed` is `"demucs"` and `sunoRefused` is `true`.

## When Suno refuses

Suno will not separate a recording it recognises as **commercially released**. Audio sent by URL must also be **20 MB** or smaller.

- **Setting off (default):** the job fails with a clear message and your credits are refunded in full. Use the [Audio Separation](../ai-audio/audio-separation.md) node for that audio, or turn the setting on. A file over 20 MB fails the same way, before anything is sent to Suno.
- **Setting on:** the audio is separated with Demucs instead, and the node shows a note that Demucs was used. You pay the Audio Separation price, never more than the Suno price you were quoted (see [Credits](#credits)). A file over 20 MB goes straight to Demucs. (Demucs needs an audio file, so a run that separates a Suno track by its IDs never falls back, even with other audio wired in. Suno does not refuse its own tracks.) Demucs returns its own set of stems: vocals and instrumental, or vocals, drums, bass, guitar, piano and other.
- **One instrument never falls back.** Demucs cannot pull out a named instrument, so a refused One instrument run fails and is refunded in full whatever the setting.

If Suno cannot download the audio at all, the job fails with "Suno couldn't download this audio" and is refunded in full. That is not a refusal, so it does not fall back to Demucs.

## Credits

Fixed per run:

| Mode | Credits |
|------|---------|
| Vocals / instrumental | **44 credits**<!-- credits: suno-separate --> |
| Full stems | **143 credits**<!-- credits: suno-separate-stem --> |
| One instrument | **88 credits**<!-- credits: suno-separate-single --> |

The price is the same whether the audio is a Suno track or any other audio. A failed or refused run is refunded in full.

When the Demucs fallback runs, you pay the Audio Separation price — 33 credits<!-- credits: audio-separation --> for vocals/instrumental, 66 credits<!-- credits: audio-separation:stems --> for full stems — never more than the Suno price you were quoted. The Suno price is held when the run starts, and the rest is released when the fallback finishes. For example, a refused Vocals / instrumental run holds 44 credits<!-- credits: suno-separate --> and charges 33 credits<!-- credits: audio-separation --> when Demucs finishes.

## Best Practices

- Start with Vocals / instrumental before committing to a full stem split.
- Use One instrument when you need a single part (a lead vocal, a piano, a drum kit) and the rest of the song without it.
- Use Full stems when you need control over every instrument for mixing or re-arranging.
- For commercially released music, use [Audio Separation](../ai-audio/audio-separation.md) directly, or turn on **If Suno refuses, use Demucs** so a refusal does not stop the workflow.
- Connect `vocals` to a Voice Changer or Dubbing node for further processing.
- Connect `instrumental` or `without` to Suno Add Vocals to layer new vocals onto the backing track.

## Common Use Cases

- Extracting vocals from a song for remixing or sampling.
- Isolating instrumentals for karaoke or background music.
- Pulling one instrument out of a mix, or removing it so you can play or sing that part yourself.
- Decomposing a full mix into stems for re-mixing or mastering.
- Creating acapella versions of generated songs.

## Tips

- Keep audio under 20 MB: trim long or high-bitrate files first, or let the Demucs fallback handle them.
- Full stems takes longer than Vocals / instrumental. Use it only when you need individual instruments.
- The stems you get depend on what Suno detects in the track. A stem it does not find is left out.
- Listen to both takes in One instrument mode. If take 2 is better, download it from the node.
