---
name: song-from-reference
description: A song similar to an existing one — a YouTube link or an uploaded track becomes the audio reference for a Suno cover, with a style-analysis fallback that composes an original song when the cover is refused
triggers: ["similar song", "a song like this", "cover this song", "make a song from this link", "youtube song reference", "remake this track", "same vibe as this song"]
version: 2
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
  pushes distance ("same energy and tempo, different melody and lyrics") — or
  the style-analysis path below, which composes an ORIGINAL song from a
  description of the reference and never touches the source audio.
- If the user just says "similar" with a link, default to the cover graph and
  say which interpretation you took.

**Expect the cover to be refused sometimes.** A well-known commercial song can
be recognized by the music provider and rejected on rights grounds — that is a
policy refusal, not a bug. When a cover run fails with a rights or content
message (or the audio cannot be fetched at all), switch to the style-analysis
path without being asked; it is the designed fallback, and it also avoids
copying the original in the first place.

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

## The style-analysis path — when the cover is refused, or to stay original

Analyze the actual song into a STYLE BRIEF, then compose from the brief. The
analyzer hears the real audio (the platform feeds the YouTube link straight to
a multimodal model — no download step is involved, so this path is also immune
to fetch failures), but the song that comes out is an original composition.

1. `video-analysis` node (Cloud editions) with:
   - `youtubeUrl` — the user's pasted link (same URL rule as above; the source
     must be under ten minutes).
   - `analysisFocus` — a music-only brief instruction, for example: "Describe
     ONLY the music: genre and subgenre, tempo and rhythmic feel, mood and
     energy arc, instrumentation and production character, vocal type and
     delivery, era. Write it as a style brief for composing a NEW song in this
     style. Do not transcribe lyrics and do not describe the melody note by
     note."
2. `video-analysis` `text → in` into a `text-prompt` node — the editable brief
   (trim it; briefs work best under a few hundred words).
3. `text-prompt` `prompt → field-style` into `suno-generate` — `field-style`
   is the free-text style seat (the `audio-style` input accepts picker nodes
   only, not text). Give `suno-generate` a short `prompt` of its own for what
   the NEW song is about (subject, lyrics language). The brief styles it; the
   prompt gives it something to say.

Never transcribe or reuse the original lyrics — the brief describes character,
not content. If the user has no Cloud analysis available, fall back to asking
them to describe the style in words (the `suno-music-basics` picker stacks).

## Prompting the cover

Name the destination, not the source — the model already hears the source.

- Weak: "a song like the reference but different"
- Strong: "acoustic folk ballad version — fingerpicked guitar, warm male
  vocal, half-time feel, intimate room sound"

For "similar but its own song", push the distance explicitly: "keep the drive
and tempo; new melody, new lyrics about the open road".

## Debugging

- The cover run failed with a rights or content-policy message → the provider
  recognized the source; switch to the style-analysis path (see above) and say
  why.
- The cover sounds identical to the reference → the prompt named no
  destination; add concrete genre, instrumentation and voice direction.
- The reference node produced nothing at run time → the audio was never
  extracted: open the node, confirm the link, and let it finish (status shows
  ready) before running.
- "I can't write that URL" from an agent → the link was not pasted by the
  user in this conversation; ask them to paste it, or point them to the
  node's panel.
