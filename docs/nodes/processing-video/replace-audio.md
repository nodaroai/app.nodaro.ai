# Replace Audio

> Keep a video's speech and replace its music — or replace all its sound — as one run.

## Overview

The Replace Audio node gives a video a new soundtrack without losing what people say in it. It separates the speech from everything else in the video's sound, puts the new music under it — the music dips while someone talks and comes back up in the pauses — and lays the mix on the video in place of its original sound. The result is exactly as long as the video: a shorter music ends in silence, a longer one is cut.

The new music is either a file you connect (an audio, or a video whose sound is used) or a track made for you from a prompt: an instrumental as long as the video.

It all runs as one job, with one price and one refund: if any step fails, the whole run is refunded.

**Nodaro Cloud only.** On a self-hosted install the node is not offered, and a workflow that holds one cannot run it.

## Inputs & Outputs

**Inputs:**
- Video (required) — the video whose sound is replaced.
- Music — one audio or video source. Leave it unconnected when the music is made from a prompt.

**Outputs:**
- Video — the video with its new sound.

Beside the video, the run keeps three files of its own, shown under the node and in the job: the final mix, the new music, and the separated speech (when it was kept).

## Configuration

| Field | Values | Default | What it does |
|-------|--------|---------|--------------|
| Mode | Keep the speech / Replace all the sound | Keep the speech | Keep the speech: the speech stays and the music is replaced. Replace all: the new music is the video's only sound. |
| Music | Connected music / Make it from a prompt | Connected music | Where the new music comes from. |
| Music prompt | up to 1,000 characters | — | The music to make, described in words (for example "warm lo-fi piano, slow, gentle"). Only with "Make it from a prompt". |
| Music volume | 0–200 % | 80 % | How loud the new music is. |
| Speech volume | 0–200 % | 100 % | How loud the kept speech is. |
| Duck amount | 0–100 | 70 | How far the music dips under the speech. 0 keeps it level. Keep the speech only. |

## Limits

- Videos up to 10 minutes, and up to 6 minutes when the music is made from a prompt.
- Files up to 500 MB.
- A file that cannot be read, a video with no picture, or a music with no sound is refused before anything is charged.

## Pricing

One price per run, by mode and by where the music comes from:

| Mode | Music from a file | Music from a prompt |
|------|-------------------|---------------------|
| Keep the speech | 165 credits<!-- credits: replace-audio --> | 198 credits<!-- credits: replace-audio:prompt --> |
| Replace all the sound | 55 credits<!-- credits: replace-audio:replace-all --> | 88 credits<!-- credits: replace-audio:replace-all:prompt --> |

A run is priced by what it does: "Keep the speech" on a video with no sound has no speech to keep, so it runs — and is charged — as "Replace all the sound" (55 credits<!-- credits: replace-audio:replace-all --> with a music file). The price is the same whatever the video's length. If any step fails, the whole run is refunded.

## Best Practices

- Use "Keep the speech" for talking-head clips, interviews, tutorials and ads with a voice-over: the voice stays clear over the new music.
- Use "Replace all the sound" when nothing in the original sound should stay (a clip whose sound is only music or noise).
- Raise the duck amount when the music competes with the voice; lower it for a music bed that should stay present.
- A music file longer than the video is fine: it is cut where the video ends.

## Common Use Cases

- Swap a copyrighted or unwanted soundtrack for a licensed or generated one, keeping the dialogue.
- Give a series of clips the same music bed.
- Make a version of an ad with a different mood, from a prompt.

## API and agents

- REST: `POST /v1/replace-audio` with `{ videoUrl, musicUrl | musicPrompt, mode?, musicVolume?, speechVolume?, duckAmount? }` returns `{ jobId }`; poll `GET /v1/jobs/:jobId`. An `Idempotency-Key` header makes a retry return the job it already started.
- SDK: `client.media.replaceAudio({ videoUrl, musicPrompt: "warm lo-fi piano" })`.
- MCP: the `replace_audio` tool.
