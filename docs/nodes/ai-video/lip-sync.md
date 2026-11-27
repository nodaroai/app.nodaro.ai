# Lip Sync

> Sync audio to a character's face to create a talking head video.

## Overview

The Lip Sync node takes a portrait image and an audio track (speech/voiceover) and generates a video where the character's lips move in sync with the audio. Supports optional motion prompts for head and expression movements.

It can also **dub an existing video**: HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, and Volcengine Lip Sync take a source video plus a replacement audio track and re-animate the lips to match the new speech, billed per second of output. Volcengine is the cheapest modern dubbing option and the only one with multi-speaker scene detection + speaker ID (basic mode).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling-avatar | AI model for lip sync |
| Resolution | Select | 720p | Output resolution: 480p/720p (most KIE providers); OmniHuman 1.5 is 720p/1080p (default 1080p); OmniHuman 2.0 has no choice (always 720p, the field is hidden); the full `seedance-2` adds **1080p / 4K** and `seedance-2-5` adds **1080p / 4K** (`seedance-2-fast` and `seedance-2-mini` are 480p/720p only); `ltx-2.5-fast` is **720p (default) / 1080p / 1440p** |
| Motion Prompt | Textarea | — | Optional: describe head/expression motions (KIE providers only) |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

### OmniHuman 1.5 options

`omnihuman-1-5` is ByteDance's premium **prompt-directed** talking avatar (image + audio → performing avatar). It animates people, pets, or anime at any aspect ratio, and uses the motion prompt to direct the performance.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Motion Prompt | Textarea | — | Directs the performance (e.g. "sing confidently into a microphone") |
| Resolution | Select | 1080p | 720p or 1080p (no 480p) |
| Fast Mode | Toggle | Off | Trade some quality for faster generation (`pe_fast_mode`) |
| Seed | Number | -1 | Reproducibility — same seed + inputs → near-identical result. -1 = random |

### OmniHuman 2.0

`omnihuman-2-0` is ByteDance's OmniHuman 2.0, offered beside OmniHuman 1.5 (it is a different model, not a replacement). It animates one still image from an audio track: the voice drives the lips and the motion, and the optional prompt steers the scene, the character's movement and the camera. The output is a **720p** MP4 as long as the audio — up to **5 minutes**.

It has none of 1.5's other options: no resolution choice, no fast mode and no seed. Switching a node from 1.5 to 2.0 clears those values, and a request that sends them anyway (API, SDK, MCP, workflow JSON) has them dropped before the run.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Motion Prompt | Textarea | — | Optional: the scene, the character's motion and the camera. Up to **300 characters** — a longer prompt is cut to its first 300 |

**What it takes.** Each limit is checked before any credits are held; a run outside them is refused with a message that says which limit, and nothing is charged.

| Input | Limits |
|-------|--------|
| Image (required) | One image, under 30 MB, each side up to 6,000 pixels, width ÷ height between 0.4 and 2.5. JPEG, PNG, WebP, GIF or TIFF (an image whose size Nodaro cannot read — for example a HEIC photo or a BMP — is refused; convert it to JPEG or PNG first). The model takes each side from 300 pixels: a smaller image is enlarged before it is sent, its shape kept, until its shorter side is 300 pixels (a 250×400 portrait is sent as 300×480) |
| Audio (required) | Up to **300 seconds** (under 4 seconds is padded, below), in a file under **100 MB**, in any common audio format: MP3 (or MP2), WAV (or RF64), Wave64, AIFF, CAF, AU, M4A (or MP4/MOV), AAC, AC-3, E-AC-3, AMR, Ogg (Vorbis, Opus or FLAC), FLAC, WebM/MKA, WMA, MPEG-TS, AVI, MPG/VOB, FLV, DTS, WavPack, Monkey's Audio (APE), TTA, Musepack (MPC) or LATM AAC. A playlist, a stream manifest or other file that points at further files is refused. Every file is converted to a 44.1 kHz stereo MP3 before it is sent. The model takes audio under 15 MB, so the audio sent is held to that after conversion — an MP3 of 300 seconds is about 7 MB |

**Short audio is padded.** Audio shorter than 4 seconds is padded with silence to exactly 4 seconds before it is sent, so the video runs 4 seconds and the avatar holds still for the padded part. It is billed as 4 seconds.

**Long audio is refused.** Audio longer than 300 seconds is refused before anything is held — trim it first (for example with Trim Audio). Audio up to 0.05 seconds longer (a 5-minute cut can decode a few hundredths over) is held and billed as 300 seconds, the price before the run named, and cut to exactly 300 seconds before it is sent.

**The length is the length it plays.** Nodaro downloads the audio and decodes it to measure it: the run is priced on how long the audio actually plays, never on the length its file declares (a file's header can be wrong). The link must answer directly and keep sending: a download that stalls or trickles is stopped, and the run is refused before anything is held.

**The audio priced is the audio sent.** Nodaro measures the audio to price the run, then downloads it once more for the run, checks that this copy is the one it priced (no longer, under 100 MB), converts it to MP3, checks that the MP3 plays no longer than the run was priced for, and sends the model that MP3. The price and the MP3 come from the same decoding of the file, so a file that changes its sample rate or channels part-way through (MP3 or AAC clips joined together, for example) is priced on exactly the audio that is sent. If the file at the link changed in between — it now runs longer than the run was priced for — the run is stopped before the model is asked and nothing is charged; run it again to price the new audio.

**Gaps in the audio are played as silence.** When the audio's timeline has gaps — a recording that dropped packets or paused its microphone, clips joined without re-encoding — Nodaro fills the gaps with silence, the way a player plays them (time missing is filled once it adds up to a tenth of a second). The run is priced on that length, silence included (it counts toward the 300 seconds), and that is the audio the model is sent. Audio whose timestamps step back or start over is never cut, and audio that starts later than zero is not padded at its start. In some formats a very large jump is collapsed as the file is read rather than filled (MPEG-TS and MPG: a jump over 10 seconds); that audio is priced and sent without the jump.

**Audio that does not decode to its end is refused.** Rather than price a file on only the part that decodes, Nodaro refuses it before anything is held (`400`, `audio_unreadable`), with a message to re-export the audio as one complete, continuous file. That happens when:

- the file reports damage as it is read: a WebM/MKA file with a damaged block, or an Ogg file with a corrupted page. Zero bytes after the end of a WebM/MKA file's audio (as a recording recovered after a crash can have) are not damage;
- the audio decodes clearly shorter — by more than half a second — than the length the file states. The length is taken only from formats that state it exactly: WebM/MKA when the program that wrote it finished the file (a recording a browser streamed, even one whose length an app added afterwards, states none Nodaro relies on), M4A/MP4/MOV, Ogg, FLAC, WAV, Wave64, AIFF, CAF, AU, WavPack, TTA, Monkey's Audio, Musepack, and WMA when the audio is its only track. A cut-off file in one of these formats is refused this way. A file that states a shorter length than it plays is not refused: it is priced on what it plays;
- reading stops on an error part-way, for example in an Ogg file joined from parts with different channel counts or sample rates. A few stray bytes after the end of the audio (an AAC file with a broken last header, a WavPack file with a tag after its audio) do not count: nothing is lost.

Some damage cannot be told from a complete file. Such a file is priced on, and sent as, exactly the audio that decodes, with any gap filled: a file in a format that states no exact length (MP3, AAC, AC-3, DTS, MPEG-TS, MPG, AVI, FLV) that was cut off, or that joins two formats (an MP3 followed by AAC, for example); a cut-off WAV, Wave64 or CAF (their length is taken from the file's size, not stated) or Ogg (its stated length follows the cut); a WMA cut off well before its end (one cut off near its end is refused); damage that leaves only a gap in the timeline (a damaged TTA or FLAC frame), which is played as silence; and two WavPack or TTA files joined byte for byte (only the first is read).

**Busy.** Only a few audio files are downloaded and measured at once. If they are all taken, a request (the editor's Run, the API, the SDK, MCP) waits up to 30 seconds and is then refused before anything is held (`429`, `lip_sync_audio_busy`) with a message to try again in a moment; a workflow or app run waits up to 2 minutes before it is refused. `POST /v1/lip-sync` also takes at most 30 requests a minute from one caller (one signed-in session, API key or MCP user) for the models that measure their audio (`omnihuman-2-0`, `kling-avatar`, `kling-avatar-pro`, `omnihuman-1-5` and the dubbing models); past that it answers `429` (`rate_limit_exceeded`). Requests for the other lip-sync models are not limited this way. If measuring the audio takes too long on Nodaro's side and is stopped, the request is answered `503` (`lip_sync_audio_measure_stopped`): nothing is charged; try again.

### Seedance 2 (image + audio avatar)

`seedance-2`, `seedance-2-fast`, `seedance-2-mini`, `seedance-2-5` and `seedance-2-5-flash` are also offered on the lip-sync surface. They are ByteDance's multimodal video models, which do native phoneme-level lip sync in 8+ languages when fed an audio track alongside a portrait — routed through the image-to-video provider with the audio passed as `reference_audio_urls` (not the dedicated lip-sync flow). The full `seedance-2` accepts **1080p and 4K** output; `seedance-2-5` accepts **1080p** (no 4K); `seedance-2-fast`, `seedance-2-mini` and `seedance-2-5-flash` are **480p/720p only** (no 1080p SKU). `seedance-2-5-flash`, the faster, lower-cost tier of Seedance 2.5, takes a voice line of **2–30 s** (a line outside that range is refused before anything is reserved, `audio_too_short` or `audio_too_long`); a line that is not WAV or MP3 (an M4A, for example) is converted to MP3 before it is sent. `seedance-2-fast` requires each reference audio clip to be ≤ 15.2 s; `seedance-2-5` allows up to 30 s. Full controls live on the [Generate Video](./generate-video.md) page.

**The voice you give is the soundtrack of the result.** These models (and `minimax-h3`, below) read the voice line to move the lips, and the clip they return does not always carry it. Nodaro checks the returned clip: when it has no audio track, your voice line is laid on it before the result is stored — the picture is copied as it is (unless the result is watermarked or needs converting for browser playback), the voice starts at the first frame, a line longer than the clip is cut where the clip ends, and a shorter one is followed by silence (the voice is never stretched). The job's output then carries `voiceLineMuxed: true`. A clip that comes back with its own audio is stored as it is. Three cases deliver the returned clip as it came instead: it already has audio; it cannot be checked for audio at all (the job's output carries `voiceLineProbeFailed: true`); or it has no audio and your voice line cannot be read — its link no longer answers, or the file holds no audio (`voiceLineUnreadable: true`). In the last two, lay a voice on the clip with a [Merge Video & Audio](../processing-audio/merge-video-audio.md) node if it is silent. If the voice cannot be added for any other reason, the run is tried again from the clip already made — the model is never run twice — and, if it still cannot be added, the run fails and its credits are refunded.

**Seedance lip-sync price.** A Seedance lip-sync run makes one **8-second** clip from the portrait and the voice line, with no reference video, so it is charged the model's plain 8-second price at the resolution it renders — whatever the voice line's length. A resolution the model does not render runs (and is charged) at its top tier: 1080p or 4K on `seedance-2-fast`, `seedance-2-mini` or `seedance-2-5-flash` runs at 720p. On `seedance-2-5` 4K runs at 4K (until 2026-11-25 it ran, and was charged, at 1080p), and only an explicit 4K does (`4k`, `2160p` or `UHD`, in any case): a size it does not list, such as 1440p, runs at 1080p. No resolution set runs at 720p.

| Model | 480p | 720p | 1080p | 4K |
|---|---:|---:|---:|---:|
| `seedance-2` | 418<!-- credits: seedance-2:8s:480p --> | 902<!-- credits: seedance-2:8s:720p --> | 2244<!-- credits: seedance-2:8s:1080p --> | 4576<!-- credits: seedance-2:8s:4k --> |
| `seedance-2-fast` | 341<!-- credits: seedance-2-fast:8s:480p --> | 726<!-- credits: seedance-2-fast:8s:720p --> | — | — |
| `seedance-2-mini` | 209<!-- credits: seedance-2-mini:8s:480p --> | 451<!-- credits: seedance-2-mini:8s:720p --> | — | — |
| `seedance-2-5` | 616<!-- credits: seedance-2-5:8s:480p --> | 1386<!-- credits: seedance-2-5:8s:720p --> | 3476<!-- credits: seedance-2-5:8s:1080p --> | 5522<!-- credits: seedance-2-5:8s:4k --> |
| `seedance-2-5-flash` | 407<!-- credits: seedance-2-5-flash:8s:480p --> | 902<!-- credits: seedance-2-5-flash:8s:720p --> | — | — |

`minimax-h3` (MiniMax H3) rides the same audio-as-reference mechanism: portrait + voice line route through its reference-to-video endpoint with the audio as `reference_audio_urls`. Output renders at H3's **2K default** — the lip-sync surface's Resolution select never names H3's own 768P tier, so any value collapses onto the 2K-rate duration composite — audio is always on, reference audio caps at **15 s per clip**, and the reservation tier is the 8s duration composite (`minimax-h3:8s` = 803<!-- credits: minimax-h3:8s --> cr) on every path: a single run, a workflow or app run, and the estimates. See [Generate Video](./generate-video.md) for the full pricing formula (768P applies on the generation surfaces, not here).

### LTX 2.5 Fast (portrait + voice, as long as the voice)

`ltx-2.5-fast` (LTX 2.5 Fast, decided 2026-11-23) makes a talking clip from a **portrait image** and the **voice line**, and the clip is **as long as the voice**. It is the same audio-to-video run as Generate Video's [LTX 2.5 Fast with an audio clip](./generate-video.md#audio-to-video-ltx-25-fast), with the portrait as the first frame: the clip takes the portrait's shape.

- **Inputs**: a portrait image is required, as a PNG, JPEG, WebP, AVIF, HEIC, GIF, TIFF or SVG file. A video face input is refused before anything is charged (this model makes a clip from an image). So is a portrait link whose file, read before the hold by its content and not its name, is not such a picture (decided 2026-11-24): a video or audio file, a BMP (which the run cannot read), or a file that is no image at all. The message says what was found. A portrait link Nodaro cannot read in time is not refused: the run goes on, and the model fetches it itself. A price quote does not read the portrait.
- **The voice**: an MP3, WAV, M4A, AAC, OGG or FLAC file of up to 50 MB, **2.05 to 20 seconds** long — **10 seconds at most at 1440p**. A voice from any source works: an uploaded file or a voice made in the run by a speech node.
- **Measured before the hold**: Nodaro reads the voice's decoded length before anything is held (a length the request or the node states is not read) and sends the model that length less a twentieth of a second.
- **Refused before anything is charged**: a voice shorter than 2.05 s, one longer than the run takes at its resolution (the message names the setting to change), a video file wired as the voice, or a file whose length cannot be read. Unlike the bucketed models above, a voice past the limit is **refused, not trimmed**: the clip follows the voice, and a trimmed voice would cut the line.
- **Resolution**: 720p (the node's default), 1080p or 1440p; a request naming another resolution runs, and is charged, at 1080p. **Seed** is taken; **fast mode** is not.
- **Sound**: the clip is made to the voice. A render that comes back without a soundtrack gets the voice laid on, fitted to the clip, and is stored once (watermarked when the run is).
- **Free credits**: open at 720p for a voice up to 4 seconds.
- **Not offered in the film pipeline's lip sync step.**

### HeyGen Lipsync Precision options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Dynamic Duration | Toggle | On | Adjust the output length to match the new audio |
| Remove Music Track | Toggle | Off | Strip background music from the source video |
| Speech Enhancement | Toggle | Off | Improve speech clarity in the output |

### Sync Lipsync 2 Pro options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Sync Mode | Select | loop | Behavior when audio/video durations differ: `loop`, `bounce`, `cut_off`, `silence`, `remap` |
| Temperature | Slider 0–1 | 0.5 | How expressive the lip sync can be |
| Active Speaker Detection | Toggle | Off | Lip-sync whoever is speaking in the clip |

### Sync Lipsync v3 options

`sync-lipsync-v3` is the fal.ai-hosted sync.so sync-3 model. Expressiveness, obstruction handling and frame reasoning are managed natively by the model (its `temperature` is ignored), so it exposes two levers:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Sync Mode | Select | cut_off | Behavior when audio/video durations differ: `loop`, `bounce`, `cut_off`, `silence`, `remap` |
| Active Speaker Detection | Toggle | Off | Lip-sync whoever is speaking in the clip (sync.so's auto-detect, v3 detector). Turn it on for videos with more than one person on screen. |

### Volcengine Lip Sync options

`volcengine-lipsync` is the KIE-hosted Volcengine video-to-video dubbing model. It re-syncs an existing clip's lips to a new vocal track and is the cheapest modern dubbing option (~22 CR/s). Output length follows the audio (the source video is trimmed if longer, looped if shorter).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | lite | `lite` = single-person frontal, faster · `basic` = complex scenes, enables multi-speaker scene detection + speaker ID |
| Separate vocals | Toggle | Off | Strip background noise from the driving audio |
| Scene detection + speaker ID | Toggle | Off | **Basic mode only** — segment scene cuts and identify who is speaking (multi-speaker clips) |
| Loop video if audio is longer | Toggle | On | **Lite mode only** — loop the source video when the audio runs longer than it |
| Reverse loop | Toggle | Off | **Lite mode only** — ping-pong the loop (requires looping to be on) |
| Template start time | Number (s) | 0 | Where in the source video to start driving the lips (advanced) |

### Retired models

Wav2Lip, VideoReTalking and SadTalker are retired from Lip Sync. A saved node, an API or SDK request, or an MCP call that still names one (`wav2lip`, `video-retalking`, `sadtalker`) is refused before anything is charged, with a message to pick another Lip Sync model. The editor shows such a node as retired and keeps its settings until you pick another model; nothing switches it for you, because the models differ in their inputs and price.

## Inputs & Outputs

**Inputs:**
- Portrait Image (required for most providers) — clear face photo
- Video (required for HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, and Volcengine Lip Sync) — the source clip to dub. OmniHuman 2.0 takes an image only
- Audio (required) — speech or voiceover track

**Outputs:**
- Lip-synced video

> HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, and Volcengine Lip Sync replace the audio on a **video** input (not a portrait image).

## Audio Length Limits

| Provider | Max input audio |
|----------|-----------------|
| `kling-avatar` (Standard) | 5 minutes |
| `kling-avatar-pro` (Pro) | 5 minutes |
| `infinitalk` | 15 seconds |
| `omnihuman-1-5` | 60 seconds |
| `omnihuman-2-0` | 5 minutes (at least 4 seconds — shorter is padded) |
| `heygen-lipsync-precision` | 5 minutes* |
| `lipsync-2-pro` | 5 minutes* |
| `sync-lipsync-v3` | 5 minutes* |
| `volcengine-lipsync` | 5 minutes |
| `ltx-2.5-fast` | 20 seconds (10 at 1440p; at least 2.05 s) — refused past it, not trimmed |

Audio longer than the cap is trimmed to half a second under it before it is sent, and a model priced by the length of its audio charges its top tier for it (see [How the audio's length is measured](#how-the-audios-length-is-measured)). `infinitalk` is trimmed the same way. `omnihuman-2-0` is the exception: audio past its 5 minutes is refused before anything is held, not trimmed. Long-audio runs on `kling-avatar(-pro)` and `volcengine-lipsync` can take tens of minutes — the editor polls for up to ~1 hour before timing out.

\* For HeyGen Lipsync Precision, Sync Lipsync 2 Pro, and Sync Lipsync v3, audio past 5 minutes is trimmed to the 5-minute tier it is charged.

## Credit Cost

Kling AI Avatar and OmniHuman 1.5 are priced by the length of their audio, rounded up to the next tier. Nodaro measures the audio itself before it holds anything; the hold is the charge (see [How the audio's length is measured](#how-the-audios-length-is-measured)).

| Provider | Per-second | 15s | 30s | 1min | 2min | 5min |
|----------|-----------:|----:|----:|-----:|-----:|-----:|
| `kling-avatar` (720p) | ~22 CR/s | 330<!-- credits: kling-avatar:15s --> | 660<!-- credits: kling-avatar:30s --> | 1,320<!-- credits: kling-avatar:60s --> | 2,640<!-- credits: kling-avatar:120s --> | 6,600<!-- credits: kling-avatar:300s --> |
| `kling-avatar-pro` (1080p) | ~44 CR/s | 660<!-- credits: kling-avatar-pro:15s --> | 1,320<!-- credits: kling-avatar-pro:30s --> | 2,640<!-- credits: kling-avatar-pro:60s --> | 5,280<!-- credits: kling-avatar-pro:120s --> | 13,200<!-- credits: kling-avatar-pro:300s --> |
| `omnihuman-1-5` (720p/1080p) | ~74 CR/s | 1,122<!-- credits: omnihuman-1-5:15s --> | 2,233<!-- credits: omnihuman-1-5:30s --> | 4,455<!-- credits: omnihuman-1-5:60s --> | — | — |

`omnihuman-1-5` is capped at 60s of audio (longer is auto-trimmed), so only the 15s / 30s / 60s tiers apply. Resolution (720p vs 1080p) does not change the price.

### LTX 2.5 Fast pricing

`ltx-2.5-fast` is charged on the voice's measured length **rounded up to a whole second** (a few hundredths past a whole second are forgiven), at the resolution sent, from the same per-second rows as Generate Video's LTX 2.5 Fast (`ltx-2.5-fast:<N>s:<resolution>`, one row for every whole second from 2 s). The hold is the charge. Some of the rows:

| Voice (rounded up) | 720p | 1080p | 1440p |
|---|---|---|---|
| 2s | 66<!-- credits: ltx-2.5-fast:2s:720p --> | 88<!-- credits: ltx-2.5-fast:2s:1080p --> | 132<!-- credits: ltx-2.5-fast:2s:1440p --> |
| 3s | 99<!-- credits: ltx-2.5-fast:3s:720p --> | 132<!-- credits: ltx-2.5-fast:3s:1080p --> | 198<!-- credits: ltx-2.5-fast:3s:1440p --> |
| 4s | 121<!-- credits: ltx-2.5-fast:4s:720p --> | 176<!-- credits: ltx-2.5-fast:4s:1080p --> | 253<!-- credits: ltx-2.5-fast:4s:1440p --> |
| 5s | 154<!-- credits: ltx-2.5-fast:5s:720p --> | 220<!-- credits: ltx-2.5-fast:5s:1080p --> | 319<!-- credits: ltx-2.5-fast:5s:1440p --> |
| 8s | 242<!-- credits: ltx-2.5-fast:8s:720p --> | 352<!-- credits: ltx-2.5-fast:8s:1080p --> | 506<!-- credits: ltx-2.5-fast:8s:1440p --> |
| 10s | 297<!-- credits: ltx-2.5-fast:10s:720p --> | 429<!-- credits: ltx-2.5-fast:10s:1080p --> | 627<!-- credits: ltx-2.5-fast:10s:1440p --> |
| 15s | 451<!-- credits: ltx-2.5-fast:15s:720p --> | 649<!-- credits: ltx-2.5-fast:15s:1080p --> | — |
| 20s | 594<!-- credits: ltx-2.5-fast:20s:720p --> | 858<!-- credits: ltx-2.5-fast:20s:1080p --> | — |

A 7.2 s voice at 720p is charged as 8 s: 242<!-- credits: ltx-2.5-fast:8s:720p --> credits. Every whole second is listed on the [Generate Video](./generate-video.md) page. An estimate made before the voice's length is known quotes the longest clip the run can hold at its resolution (20 s, or 10 s at 1440p) and shows it as an estimate.

### OmniHuman 2.0 pricing

`omnihuman-2-0` is charged **per second of its audio**, with no tiers: 38.5<!-- credits-rate: omnihuman-2-0:per-second --> credits per second. The audio's length is rounded **up** to a whole second, at least 4 seconds, and the whole run is rounded up to a whole credit once. Audio that plays up to 0.05 seconds past a whole second is held and charged as that second (decoders disagree by a few hundredths at a file's end); the price before a run reads the length exactly, so it is never below the charge. Nodaro measures the audio itself before it holds anything, on every path (the editor's Run, a workflow or app run, the API, the SDK and MCP); a length a request sends (`audioDurationSec`) is ignored for this model. The hold is the charge: nothing is refunded or added afterwards.

| Audio | Billed as | Credits |
|-------|-----------|--------:|
| 3.2 s (padded to 4 s) | 4 s | 154<!-- credits: omnihuman-2-0:per-second@4 --> |
| 10 s | 10 s | 385<!-- credits: omnihuman-2-0:per-second@10 --> |
| 10.04 s | 10 s | 385<!-- credits: omnihuman-2-0:per-second@10 --> |
| 10.1 s | 11 s | 424<!-- credits: omnihuman-2-0:per-second@11 --> |
| 15 s | 15 s | 578<!-- credits: omnihuman-2-0:per-second@15 --> |
| 1 min | 60 s | 2,310<!-- credits: omnihuman-2-0:per-second@60 --> |
| 5 min | 300 s | 11,550<!-- credits: omnihuman-2-0:per-second@300 --> |
| 5 min 0.03 s (cut to 5 min before it is sent) | 300 s | 11,550<!-- credits: omnihuman-2-0:per-second@300 --> |
| over 5 min 0.05 s | — | refused, nothing charged |

**The price before a run** (the node's chip, its Run button, the workflow's estimate in the editor and on the server, an app's listed price) reads the wired audio's length as the steps that measure their input read it:
- an uploaded audio: the length recorded for it. An AAC audio (an M4A, MP4 or AAC file, or the sound of an MP4 video) plays up to one AAC frame past the length its file declares. At 44.1 or 48 kHz that frame is about 0.02 seconds, inside the 0.05 seconds the charge forgives, so it changes nothing; a frame longer than that (a rate under about 20 kHz, or a rate that was not recorded) is quoted for the part the charge does not forgive: a 5-second M4A at 16 kHz is quoted, and charged, as 6 seconds, 231 credits<!-- credits: omnihuman-2-0:per-second@6 -->. A WAV, or an MP3 whose header states its length, plays its recorded length. A header-less (VBR) MP3 or a raw `.aac` file states no exact length, so the length recorded for it is an estimate it can play past: its quote reads the record, and the run charges what it decodes;
- a node that does not run in this run: the length recorded with the result it hands on;
- audio a node makes in this run at a length known before the run: that length plus a tenth of a second, since a made file runs a few hundredths past its planned length and the audio is rounded up. A 5-second clip's sound is quoted as 6 seconds, as a file a few hundredths over 5 seconds is billed; a Voice Changer, Voice Changer Pro or Adjust Volume of an 8-second recording, an Extract Audio of an 8-second video, and a Trim Audio that keeps 8 seconds (its window, at most what is left of its input after the start) are each quoted as 9 seconds. After a Dubbing or an Audio Isolation the made file is read a quarter second past its input instead, since their files were measured to run further past it: an Audio Isolation of an 8-second recording is quoted as 9 seconds too (8.25), and a Dubbing or an Audio Isolation of a 4.8-second recording as 6 seconds, where a Voice Changer of it is quoted as 5; on a model priced in length tiers, an Audio Isolation of a 14.9-second recording is read at 15.15 seconds, Kling Avatar's 30-second tier, and a Voice Changer of it at 15 seconds, the 15-second tier. A Mix Audio set to end with its voice is quoted at that voice's length; one that ends with its longest track has no length before the run.
- a voice that is made again in this run (Text to Speech, Text to Dialogue): the length of the take it holds now. That is a minimum, not the price: the new voice can be longer, and the run is charged the audio it measures. An app's listed price reads the voice by its script instead, when it can read the script.

With no audio wired, the length the node measured of its own audio at its last run is shown, never below 15 seconds: that length is kept in the node's settings, where a workflow written through the API or MCP can set it to anything, so a shorter one (a 9.5-second last run, say) is shown at the 15-second price, 578 credits<!-- credits: omnihuman-2-0:per-second@15 -->, and a longer one (20 seconds) at its own, 770 credits<!-- credits: omnihuman-2-0:per-second@20 -->. Before the audio's length is known (a voice with no take yet, a file whose length was not recorded, the sound of a step that has no length before the run), every price before a run — the node's credit chip, marked `≈`, the workflow's estimate in the editor and on the server, the credit check before a run or a continuation, and an app's listing — shows the 15-second price, 578 credits<!-- credits: omnihuman-2-0:per-second@15 -->. That is a minimum, not the price: the run measures the audio and is charged for it, so a longer audio costs more and needs that balance when the run reaches this node.

HeyGen Lipsync Precision, Sync Lipsync 2 Pro, and Sync Lipsync v3 also bill per second of output, bucketed to the same 15s / 30s / 1min / 2min / 5min tiers:

| Provider | 15s | 30s | 1min | 2min | 5min |
|----------|----:|----:|-----:|-----:|-----:|
| `volcengine-lipsync` | 330<!-- credits: volcengine-lipsync:15s --> | 660<!-- credits: volcengine-lipsync:30s --> | 1,320<!-- credits: volcengine-lipsync:60s --> | 2,640<!-- credits: volcengine-lipsync:120s --> | 6,600<!-- credits: volcengine-lipsync:300s --> |
| `heygen-lipsync-precision` | 561<!-- credits: heygen-lipsync-precision:15s --> | 1,111<!-- credits: heygen-lipsync-precision:30s --> | 2,211<!-- credits: heygen-lipsync-precision:60s --> | 4,411<!-- credits: heygen-lipsync-precision:120s --> | 11,011<!-- credits: heygen-lipsync-precision:300s --> |
| `lipsync-2-pro` | 693<!-- credits: lipsync-2-pro:15s --> | 1,375<!-- credits: lipsync-2-pro:30s --> | 2,750<!-- credits: lipsync-2-pro:60s --> | 5,500<!-- credits: lipsync-2-pro:120s --> | 13,739<!-- credits: lipsync-2-pro:300s --> |
| `sync-lipsync-v3` | 1,100<!-- credits: sync-lipsync-v3:15s --> | 2,200<!-- credits: sync-lipsync-v3:30s --> | 4,400<!-- credits: sync-lipsync-v3:60s --> | 8,800<!-- credits: sync-lipsync-v3:120s --> | 22,000<!-- credits: sync-lipsync-v3:300s --> |

#### LatentSync: held by tier, charged what the run used

`latentsync` re-animates the lips of an existing video. The work a run takes grows with the length of its audio, and also with its **Inference steps** setting and the size of the video, so it has no fixed price per tier. A run **holds** the tier of its measured audio length, and when it ends it is charged for the work it actually used:

| | 15s | 30s | 1min | 2min | 5min |
|---|----:|----:|-----:|-----:|-----:|
| `latentsync` hold | 125<!-- credits: latentsync:15s --> | 200<!-- credits: latentsync:30s --> | 350<!-- credits: latentsync:60s --> | 650<!-- credits: latentsync:120s --> | 1,550<!-- credits: latentsync:300s --> |

- A run that used **less** than its hold is charged less, and the rest of the hold is released when it ends. At the default settings this is the usual case.
- A run is **never charged more than its hold**, the price shown before it starts: one that used more (more inference steps, a large video) is charged the hold.
- A run finished by the platform's recovery after an interruption is charged the same way, for what it used, within its hold.
- A failed run is refunded in full.

The output is as long as the shorter of the video and the audio: a longer video is cut to the audio, and a video shorter than the audio ends the result where the video ends. The whole video is read either way, so a video much longer than its audio costs more than one cut to length first. Audio past 5 minutes is cut to 5 minutes and held at the 5-minute tier. The price shown before a run (the node's credit chip, the Run button, the workflow estimate, MCP) is the hold, marked `≈` in the editor and read as the other tiered models' prices are (below). `POST /v1/quote` prices a run on the audio it measures, as the run does: its `reserve` is the hold, with a `settles_to_actual` warning (the most the run can cost).

The node's credit chip and the Run button show an estimate: the tier of the audio's length once the editor knows it, and before then the model's top tier (5 minutes; 60 seconds for `omnihuman-1-5`), the most a run can be charged. The editor knows the length of the audio node the run plays: an uploaded audio at the length recorded for it, or audio a node made earlier. An AAC audio is read as OmniHuman 2.0's is (above): one AAC frame past its record, less the 0.05 seconds a tier's edge forgives, so a 15-second M4A recorded at 16 kHz (a frame of 0.064 seconds) is quoted at the 30s tier its run holds, 660 credits<!-- credits: kling-avatar:30s --> on `kling-avatar`; at 44.1 or 48 kHz it stays in the 15s tier. The sound of an MP4 video, whose rate is not recorded, is read at AAC's longest frame, so one at exactly a tier's length is quoted at the next tier. A length the Lip Sync node itself carries is never used. An app or a component whose user supplies the audio lists the top tier too.

The run itself is priced on the length Nodaro measures, which is not always the estimate's. A voice made again during the run (a Text to Speech or Text to Dialogue node that runs before the Lip Sync) is estimated at the length of its last take. If the new take comes out longer, the run is held and charged on its measured length, which can be a higher tier than the estimate.

**Which audio is priced.** When several audio nodes reach a Lip Sync, the estimate reads the audio its run plays. A workflow, app or API run plays the last wired audio, or, with none wired, the audio picked in the node's settings. The editor's own Run of the node plays the picked audio first, else the last wired one.

### How the audio's length is measured

Every model priced by the length of its audio — `kling-avatar`, `kling-avatar-pro`, `omnihuman-1-5`, `latentsync`, `heygen-lipsync-precision`, `lipsync-2-pro`, `sync-lipsync-v3`, `volcengine-lipsync` and `omnihuman-2-0` — is priced on the length Nodaro measures from the audio itself, on every path: the editor's Run, a workflow or app run, the API, the SDK and MCP. A length a request or a node carries (`audioDurationSec`, MCP's `audio_duration_sec`) is ignored. The run is held for the tier of the measured length (for `omnihuman-2-0`, its whole seconds), and the hold is the charge: nothing is refunded or added afterwards. The one exception is `latentsync`, whose hold is settled at what the run used (above).

| Audio plays | `kling-avatar` is charged |
|-------------|---------------------------|
| 12 s | the 15s tier: 330<!-- credits: kling-avatar:15s --> |
| 15 s | the 15s tier: 330<!-- credits: kling-avatar:15s --> |
| 15.03 s | the 15s tier: 330<!-- credits: kling-avatar:15s --> (sent cut to exactly 15 s) |
| 15.1 s | the 30s tier: 660<!-- credits: kling-avatar:30s --> |
| 42 s | the 1min tier: 1,320<!-- credits: kling-avatar:60s --> |
| 6 min | the 5min tier: 6,600<!-- credits: kling-avatar:300s --> (trimmed to just under 5 min) |

**A tier's edge.** Audio that plays at most 0.05 seconds past a tier's length is charged that tier, and the copy sent is cut to exactly the tier's length. Decoders disagree by a few hundredths of a second at the end of a file: an exactly 15-second M4A (AAC) file can measure 15.02 seconds. `omnihuman-2-0` forgives the same 0.05 seconds past each whole second it bills; its copy is sent whole.

The measurement is the one described under [OmniHuman 2.0](#omnihuman-20): Nodaro downloads the audio (a file under **100 MB**, in one of the formats listed there) and decodes it to count how long it actually plays, never the length its file declares. Gaps in the timeline count as silence. Before anything is held, it refuses:

- audio that does not decode to its end, as a damaged or cut-off file (`400`, `audio_unreadable`, with a message to re-export the audio as one complete, continuous file);
- a file it cannot download or decode (`400`, `audio_unreadable`);
- a file of 100 MB or more (`400`, `audio_too_large`);
- a run that finds every measuring slot busy (`429`, `lip_sync_audio_busy`, see **Busy** above): try again in a moment.

Some requests are refused before the audio is downloaded at all:

- a model your deployment does not offer (`403`, `model_not_available`);
- a request with no face input, an image or a video, or a `volcengine-lipsync` request with no video (`400`, `validation_error`);
- a balance that cannot cover even the model's cheapest run (`402`).

**The audio priced is the audio sent.** For the run, Nodaro downloads the audio again and decodes it the same way. If the file at the link changed in between and now falls in a higher tier than the run was held for, the run stops before the model is asked, and nothing is charged. Otherwise the model is sent an MP3 that Nodaro makes from exactly the audio it priced, never the link itself. Audio past the model's maximum is cut to half a second under it.

On a self-hosted install whose storage the providers cannot reach (no publicly reachable media host, as the community edition's default setup), the model is sent the audio's own link instead, as before: a copy on this install's storage would be a link the provider cannot open.

The other models differ from `omnihuman-2-0` in three ways:

- short audio is not padded;
- long audio is trimmed, not refused;
- the image is not checked.

InfiniTalk and Hailuo Avatar use flat per-call pricing (see admin → Models).

## Best Practices

- Use a clear, front-facing portrait for best lip sync accuracy
- Ensure audio is clean speech without background music or noise — use Voice Extractor first if needed
- Motion prompts like "slight head nods" or "expressive eyebrows" add realism

## Common Use Cases

- Create talking head videos from a single photo
- Generate spokesperson videos for product demos
- Animate AI-generated character portraits with voiceover
- Create multilingual video versions by lip-syncing translated audio

## Tips

- Connect a Text to Speech node upstream for a fully automated text-to-talking-head pipeline
- Per-second pricing means short clips are cheap — the legacy 14s assumption no longer applies. Watch the editor's credit chip; it updates once the audio is wired.
- Portrait quality matters more than resolution — a sharp 720p face photo works better than a blurry 4K image

### Provider cost reporting

For Lipsync 2 Pro, the recorded provider-cost estimate uses the finished video's
measured duration and the provider's output-second rate. It does not use GPU
runtime. If the output duration cannot be read, provider cost remains unknown.
Credits use the duration tier of the audio measured before generation.
