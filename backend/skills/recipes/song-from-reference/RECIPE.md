---
name: song-from-reference
description: A song similar to an existing one — someone else's track is analyzed, DISTILLED by an llm-chat into a name-scrubbed style prompt, and composed as an original song; a cover is built only from audio the user owns
triggers: ["similar song", "a song like this", "cover this song", "make a song from this link", "youtube song reference", "remake this track", "same vibe as this song", "song inspired by this"]
version: 4
---

# Song From Reference

"Make me a song similar to this" plus a link or a file. The reference is real
audio, so the graph should hear real audio — but WHOSE audio it is decides the
entire graph.

## The fork — whose recording is it? Settle this before wiring anything.

- **Someone else's song** (a YouTube link to a released track — the common
  case) → INSPIRATION, never reproduction. **Do NOT build a cover from it.**
  The music provider matches uploaded audio against a catalog of existing
  recordings and refuses recognized ones at generation time — the run fails
  AFTER the whole pipeline ran ("this audio matches an existing recording").
  Copying is not the goal anyway: analyze the song into a style brief and
  compose an original. Build the style-analysis graph below.
- **The user's OWN recording** (their demo, their track, audio they made or
  hold the rights to) → the cover graph applies: the same song, new clothes.
- The user often answers implicitly: a link to a famous song is someone
  else's; "my demo" or an upload of their own is theirs. When it is genuinely
  ambiguous, ask. If the user insists on covering a song they do not own, say
  once that the provider will likely refuse it, then respect their call.

## The style-analysis graph — the default for someone else's song

Three nodes: the analyzer HEARS, the distiller CLEANS, the composer CREATES.
The analyzer gets the real audio (the platform feeds the YouTube link straight
to a multimodal model — no download step involved, so this path is immune to
fetch failures and to catalog matching), and the song that comes out is an
original composition.

1. `video-analysis` node (Cloud editions) with:
   - `youtubeUrl` — the user's pasted link (the URL rule below; the source
     must be under ten minutes).
   - `analysisFocus` — a music-only instruction, for example: "Describe ONLY
     the music: genre and subgenre, tempo and rhythmic feel, groove and drum
     character, mood and energy arc, instrumentation and production
     character, vocal type and delivery, era. Write it as a style brief for
     composing a NEW song in this style. Do not transcribe lyrics and do not
     describe the melody note by note."
   - **Know what this node emits:** its schema is a FILM analysis — a JSON of
     metadata, visual slots and a scene list, with the music description
     scattered across per-scene audio entries, and the source's own title and
     artist names in the metadata. It is NOT a clean brief. Never wire it
     straight into a music node: the music field would receive a truncated
     film JSON whose surviving part is mostly the identifying names.
2. `video-analysis` `text → prompt` into `llm-chat` — **the distiller, and it
   is load-bearing.** Copy its `systemPrompt` VERBATIM from
   `references/style-brief-system-prompt.md`: it reads the whole analysis
   (including every buried audio entry), keeps only generic musical
   characteristics, silently strips every identifying name (title, artist,
   soundtrack, label), bans "in the style of" phrasing, forbids melody and
   lyric reproduction, and outputs ONLY a production-ready Suno prompt. To
   steer the NEW song's subject or lyrics language, append one line to that
   system prompt ("The new song is about leaving home; lyrics in Hebrew.").
3. `llm-chat` `text → prompt` into `suno-generate`. The distilled prompt IS
   the whole song request — leave `suno-generate`'s own prompt empty rather
   than competing with it.

A user may keep this distiller saved as an llm-chat preset —
`list_node_presets` / `get_node_preset` will find it — but the reference file
above works for everyone. Without Cloud analysis available, fall back to
asking the user to describe the style in words (the `suno-music-basics`
picker stacks).

## The cover graph — the user's own audio only

Their audio reaches the graph one of three ways:

- **An upload of theirs** — an `upload-audio` node with the file's `assetId`
  (ids come from the user's message references or `browse_uploads`).
- **A YouTube link to their own video** — a `reference-audio` node with
  `sourceType: "youtube"` and the link in `youtubeUrl`; the node downloads and
  extracts the audio on its own (no cost).
- **A direct audio file link** — `reference-audio` with `sourceType: "url"`
  and the link in `directUrl`.

Then `audio → audio` into `suno-cover`, plus a prompt (direct or via
`text-prompt → prompt`) that names the NEW treatment: target genre, mood,
instrumentation, voice character, language. The reference decides what the
song IS; the prompt decides what it becomes. Optional: a `suno-voice` persona
node into `suno-cover`'s `voice` input for a consistent singer.

**The URL rule for agents:** you may copy a link the USER themselves pasted in
the chat — byte for byte, never modified — into `youtubeUrl` or `directUrl`.
You may never invent, shorten, or extend a link. No link in the chat? Build
the node with the source type set and tell the user exactly where to paste it,
or ask them to paste the link in chat.

API and MCP clients that carry generation verbs have one more intake: the
`download_youtube_audio` tool turns a YouTube link into an audio job whose
result lands in the user's library, ready to reference by id.

## Prompting

Name the destination, not the source — the model already hears or reads the
source.

- Weak: "a song like the reference but different"
- Strong: "acoustic folk ballad — fingerpicked guitar, warm male vocal,
  half-time feel, intimate room sound"

For the analysis path, push originality explicitly in the suno prompt: "an
original song; new melody, new lyrics about the open road".

## Debugging

- A cover failed with "matches an existing recording" (or any rights or
  content-policy message) → it was someone else's song; switch to the
  style-analysis graph and say why.
- The new song ignored the reference's vibe → read the distiller's own result
  (it is a normal node result): if it is a film-scene dump or carries artist
  names, the `systemPrompt` was not set from the reference file; if it is a
  good prompt, push the distiller for more rhythm and instrumentation detail.
- The result sounds too close to the reference → the prompt named no
  destination; add concrete genre, instrumentation and voice direction.
- The reference node produced nothing at run time → the audio was never
  extracted: open the node, confirm the link, and let it finish (status shows
  ready) before running.
- "I can't write that URL" from an agent → the link was not pasted by the
  user in this conversation; ask them to paste it, or point them to the
  node's panel.
