# Media links

Many nodes accept a media input as a link, for example a video URL wired
into Trim Video or an audio URL given to Pitch & Tempo over the API. Some
nodes measure their input on the server before a run is charged, and these
answer a link they cannot use with the refusals below:

- Trim Video, Loop Video and Combine Videos;
- Mask Composite and Video Overlay;
- Video SFX, Video Mask and Video Depth;
- Pitch & Tempo;
- Video Upscale with Topaz;
- AI Avatar, in audio mode.

When the server measures or inspects a link, it never reads a streaming
playlist from it, for any node. Other nodes answer such a link with their
own error, or pass it to their provider as it is.

## A link must be an ordinary media file

The link has to point at an ordinary video or audio file, such as an MP4,
MOV, WebM or MKV video, or an MP3, WAV, M4A, AAC, OGG or FLAC recording.
Links to a streaming playlist or manifest are refused before anything is
charged. That covers an HLS playlist (`.m3u8`), a DASH manifest (`.mpd`),
an IMF composition playlist and an ffconcat list. The refusal is a `400`
with the code `media_link_not_a_file`:

> The link must be an ordinary video or audio file, not a streaming
> playlist. Upload the file instead.

To use such media, download the file it plays and upload it, or link to the
file itself.

A link in a format the probe does not read, such as a GIF, a still image
or a raw video stream, gets the same code with a message that lists the
formats it takes:

> The link must be a video or audio file in a supported format (MP4, MOV,
> WebM, MKV, AVI, MP3, WAV, M4A, AAC, OGG or FLAC).

## When a link cannot be reached

If the link's host cannot be looked up for the moment, reading the link
runs out of time, or the server cannot read it just then, the run is
refused with a `503` before anything is charged, and it can simply be
run again. The code is `source_unreachable` for a lookup that failed,
`probe_timeout` for a read that ran out of time, and `probe_unavailable`
when the server could not run the read itself (nothing is wrong with the
link). A host that does not exist is a `400`.

## Addresses

The server reads a media link only from a public address. A link to a
loopback or private address is refused, and so is a link that redirects
to one. A self-hosted install's own storage is the exception; see
[object storage](../deployment.md#2d-configure-object-storage).
