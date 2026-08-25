---
name: song-from-reference
description: A song similar to an existing one — a YouTube link or an uploaded track becomes the audio reference for a Suno cover, with an honest fork between covering the song and chasing its vibe
triggers: ["similar song", "a song like this", "cover this song", "make a song from this link", "youtube song reference", "remake this track", "same vibe as this song"]
version: 1
---

# Song From Reference

"Make me a song similar to this" plus a link or a file. The reference is real
audio, so the graph must carry real audio — describing the song in words and
hoping is the fallback, not the plan.

## What does "similar" mean — ask before building

- **A cover** (the same song, new clothes: new style, new voice, new genre) →
  the `suno-cover` graph below. This is the strongest interpretation of
  "similar to THIS song" because the model actually hears the reference.
- **A new song in its vibe** → still the `suno-cover` graph, with a prompt that
  pushes distance ("same energy and tempo, different melody and lyrics") — or,
  when the user can name the vibe in words (genre, mood, instruments), the
  picker-stack path in the `suno-music-basics` recipe with no audio reference
  at all.
- If the user just says "similar" with a link, default to the cover graph and
  say which interpretation you took.

## Getting the reference audio into the graph

The carrier is a `reference-audio` node. Three intakes, by what the user has:

- **A YouTube link** — `sourceType: "youtube"` and the link in `youtubeUrl`.
  The node downloads and extracts the audio on its own (no cost) and exposes
  it on its `audio` output.
- **A file of theirs** — an `upload-audio` node with the file's `assetId`
  (ids come from the user's message references or `browse_uploads`).
- **A direct audio file link** — `reference-audio` with `sourceType: "url"`
  and the link in `directUrl`.

**The URL rule for agents:** you may copy a link the USER themselves pasted in
the chat — byte for byte, never modified — into `youtubeUrl` or `directUrl`.
You may never invent, shorten, or extend a link. No link in the chat? Build
the node with the source type set and tell the user exactly where to paste it
(the Reference Audio node's panel), or ask them to paste the link in chat.

API and MCP clients that carry generation verbs have a second intake: the
`download_youtube_audio` tool turns a YouTube link into an audio job whose
result lands in the user's library, ready to reference by id.

## The cover graph

`reference-audio` (or `upload-audio`) wired `audio → audio` into `suno-cover`,
plus a prompt (direct or via `text-prompt → prompt`) that names the NEW
treatment: target genre, mood, instrumentation, voice character, language.
The reference decides what the song IS; the prompt decides what it becomes.

- Optional: a `suno-voice` persona node wired into `suno-cover`'s `voice`
  input to keep a consistent singer across covers.
- The output is a full song on `suno-cover`'s `audio` output — wire it onward
  (a video's soundtrack, a trim, a mashup) like any audio.

## Prompting the cover

Name the destination, not the source — the model already hears the source.

- Weak: "a song like the reference but different"
- Strong: "acoustic folk ballad version — fingerpicked guitar, warm male
  vocal, half-time feel, intimate room sound"

For "similar but its own song", push the distance explicitly: "keep the drive
and tempo; new melody, new lyrics about the open road".

## Debugging

- The cover sounds identical to the reference → the prompt named no
  destination; add concrete genre, instrumentation and voice direction.
- The reference node produced nothing at run time → the audio was never
  extracted: open the node, confirm the link, and let it finish (status shows
  ready) before running.
- "I can't write that URL" from an agent → the link was not pasted by the
  user in this conversation; ask them to paste it, or point them to the
  node's panel.
