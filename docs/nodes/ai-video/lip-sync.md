# Lip Sync

> Sync audio to a character's face to create a talking head video.

## Overview

The Lip Sync node takes a portrait image and an audio track (speech/voiceover) and generates a video where the character's lips move in sync with the audio. Supports optional motion prompts for head and expression movements.

It can also **dub an existing video**: HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, and Volcengine Lip Sync take a source video plus a replacement audio track and re-animate the lips to match the new speech, billed per second of output. Volcengine is the cheapest modern dubbing option and the only one with multi-speaker scene detection + speaker ID (basic mode).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling-avatar | AI model for lip sync |
| Resolution | Select | 720p | Output resolution: 480p/720p (most KIE providers); OmniHuman 1.5 is 720p/1080p (default 1080p); OmniHuman 2.0 has no choice (always 720p, the field is hidden); the full `seedance-2` adds **1080p / 4K** and `seedance-2-5` adds **1080p** (`seedance-2-fast` and `seedance-2-mini` are 480p/720p only) |
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
| Image (required) | One image, under 30 MB, each side 300 to 6,000 pixels, width ÷ height between 0.4 and 2.5. JPEG, PNG, WebP, GIF or TIFF (an image whose size Nodaro cannot read — for example a HEIC photo or a BMP — is refused; convert it to JPEG or PNG first) |
| Audio (required) | Up to **300 seconds** (under 4 seconds is padded, below), in a file under **100 MB**, in any common audio format: MP3 (or MP2), WAV (or RF64), Wave64, AIFF, CAF, AU, M4A (or MP4/MOV), AAC, AC-3, E-AC-3, AMR, Ogg (Vorbis, Opus or FLAC), FLAC, WebM/MKA, WMA, MPEG-TS, AVI, MPG/VOB, FLV, DTS, WavPack, Monkey's Audio (APE), TTA, Musepack (MPC) or LATM AAC. A playlist, a stream manifest or other file that points at further files is refused. Every file is converted to a 44.1 kHz stereo MP3 before it is sent. The model takes audio under 15 MB, so the audio sent is held to that after conversion — an MP3 of 300 seconds is about 7 MB |

**Short audio is padded.** Audio shorter than 4 seconds is padded with silence to exactly 4 seconds before it is sent, so the video runs 4 seconds and the avatar holds still for the padded part. It is billed as 4 seconds.

**Long audio is refused, never trimmed.** Audio longer than 300 seconds is refused before anything is held — trim it first (for example with Trim Audio).

**The length is the length it plays.** Nodaro downloads the audio and decodes it to measure it: the run is priced on how long the audio actually plays, never on the length its file declares (a file's header can be wrong). The link must answer directly and keep sending: a download that stalls or trickles is stopped, and the run is refused before anything is held.

**The audio priced is the audio sent.** Nodaro measures the audio to price the run, then downloads it once more for the run, checks that this copy is the one it priced (no longer, under 100 MB), converts it to MP3, checks that the MP3 plays no longer than the run was priced for, and sends the model that MP3. The price and the MP3 come from the same decoding of the file, so a file that changes its sample rate or channels part-way through (MP3 or AAC clips joined together, for example) is priced on exactly the audio that is sent. If the file at the link changed in between — it now runs longer than the run was priced for — the run is stopped before the model is asked and nothing is charged; run it again to price the new audio.

**Gaps in the audio are played as silence.** When the audio's timeline has gaps — a recording that dropped packets or paused its microphone, clips joined without re-encoding — Nodaro fills the gaps with silence, the way a player plays them (time missing is filled once it adds up to a tenth of a second). The run is priced on that length, silence included (it counts toward the 300 seconds), and that is the audio the model is sent. Audio whose timestamps step back or start over is never cut, and audio that starts later than zero is not padded at its start. In some formats a very large jump is collapsed as the file is read rather than filled (MPEG-TS and MPG: a jump over 10 seconds); that audio is priced and sent without the jump.

**Audio that does not decode to its end is refused.** Rather than price a file on only the part that decodes, Nodaro refuses it before anything is held (`400`, `audio_unreadable`), with a message to re-export the audio as one complete, continuous file. That happens when:

- the file reports damage as it is read: a WebM/MKA file with a damaged block, or an Ogg file with a corrupted page. Zero bytes after the end of a WebM/MKA file's audio (as a recording recovered after a crash can have) are not damage;
- the audio decodes clearly shorter — by more than half a second — than the length the file states. The length is taken only from formats that state it exactly: WebM/MKA when the program that wrote it finished the file (a recording a browser streamed, even one whose length an app added afterwards, states none Nodaro relies on), M4A/MP4/MOV, Ogg, FLAC, WAV, Wave64, AIFF, CAF, AU, WavPack, TTA, Monkey's Audio, Musepack, and WMA when the audio is its only track. A cut-off file in one of these formats is refused this way. A file that states a shorter length than it plays is not refused: it is priced on what it plays;
- reading stops on an error part-way, for example in an Ogg file joined from parts with different channel counts or sample rates. A few stray bytes after the end of the audio (an AAC file with a broken last header, a WavPack file with a tag after its audio) do not count: nothing is lost.

Some damage cannot be told from a complete file. Such a file is priced on, and sent as, exactly the audio that decodes, with any gap filled: a file in a format that states no exact length (MP3, AAC, AC-3, DTS, MPEG-TS, MPG, AVI, FLV) that was cut off, or that joins two formats (an MP3 followed by AAC, for example); a cut-off WAV, Wave64 or CAF (their length is taken from the file's size, not stated) or Ogg (its stated length follows the cut); a WMA cut off well before its end (one cut off near its end is refused); damage that leaves only a gap in the timeline (a damaged TTA or FLAC frame), which is played as silence; and two WavPack or TTA files joined byte for byte (only the first is read).

**Busy.** Only a few audio files are downloaded and measured at once. If they are all taken for a moment, the run is refused before anything is held (`429`, `lip_sync_audio_busy`) with a message to try again in a moment. `POST /v1/lip-sync` also takes at most 30 `omnihuman-2-0` requests a minute from one caller (one signed-in session, API key or MCP user); past that it answers `429` (`rate_limit_exceeded`). Requests for the other lip-sync models are not limited this way.

### Seedance 2 (image + audio avatar)

`seedance-2`, `seedance-2-fast`, `seedance-2-mini`, and `seedance-2-5` are also offered on the lip-sync surface. They are ByteDance's multimodal video models, which do native phoneme-level lip sync in 8+ languages when fed an audio track alongside a portrait — routed through the image-to-video provider with the audio passed as `reference_audio_urls` (not the dedicated lip-sync flow). The full `seedance-2` accepts **1080p and 4K** output; `seedance-2-5` accepts **1080p** (no 4K); `seedance-2-fast` and `seedance-2-mini` are **480p/720p only** (no 1080p SKU). Full controls, durations, and per-second pricing live on the [Generate Video](./generate-video.md) page (e.g. 4K 8s = 4576 cr<!-- credits: seedance-2:8s:4k -->, 1080p 8s = 2244 cr<!-- credits: seedance-2:8s:1080p -->). `seedance-2-fast` requires each reference audio clip to be ≤ 15.2 s; `seedance-2-5` allows up to 30 s.

`minimax-h3` (MiniMax H3) rides the same audio-as-reference mechanism: portrait + voice line route through its reference-to-video endpoint with the audio as `reference_audio_urls`. Output renders at H3's **2K default** — the lip-sync surface's Resolution select never names H3's own 768P tier, so any value collapses onto the 2K-rate duration composite — audio is always on, reference audio caps at **15 s per clip**, and the reservation tier is the 8s duration composite (`minimax-h3:8s` = 803<!-- credits: minimax-h3:8s --> cr). See [Generate Video](./generate-video.md) for the full pricing formula (768P applies on the generation surfaces, not here).

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

For the KIE providers (`kling-avatar(-pro)`, `infinitalk`, `volcengine-lipsync`), audio longer than the cap is auto-trimmed before the upstream call. `omnihuman-2-0` is the exception: audio past its 5 minutes is refused before anything is held, not trimmed. Long-audio runs on `kling-avatar(-pro)` and `volcengine-lipsync` can take tens of minutes — the editor polls for up to ~1 hour before timing out.

\* For HeyGen Lipsync Precision, Sync Lipsync 2 Pro, and Sync Lipsync v3 the 5-minute figure is the **per-second credit-reservation ceiling**, not a hard trim — longer clips reserve at the 5-minute tier.

## Credit Cost

Kling AI Avatar and OmniHuman 1.5 bill per-second. Credit reservation buckets to the next supported tier; any reserved credits beyond the actual cost are refunded once the job completes.

| Provider | Per-second | 15s | 30s | 1min | 2min | 5min |
|----------|-----------:|----:|----:|-----:|-----:|-----:|
| `kling-avatar` (720p) | ~22 CR/s | 330<!-- credits: kling-avatar:15s --> | 660<!-- credits: kling-avatar:30s --> | 1,320<!-- credits: kling-avatar:60s --> | 2,640<!-- credits: kling-avatar:120s --> | 6,600<!-- credits: kling-avatar:300s --> |
| `kling-avatar-pro` (1080p) | ~44 CR/s | 660<!-- credits: kling-avatar-pro:15s --> | 1,320<!-- credits: kling-avatar-pro:30s --> | 2,640<!-- credits: kling-avatar-pro:60s --> | 5,280<!-- credits: kling-avatar-pro:120s --> | 13,200<!-- credits: kling-avatar-pro:300s --> |
| `omnihuman-1-5` (720p/1080p) | ~74 CR/s | 1,122<!-- credits: omnihuman-1-5:15s --> | 2,233<!-- credits: omnihuman-1-5:30s --> | 4,455<!-- credits: omnihuman-1-5:60s --> | — | — |

`omnihuman-1-5` is capped at 60s of audio (longer is auto-trimmed), so only the 15s / 30s / 60s tiers apply. Resolution (720p vs 1080p) does not change the price.

### OmniHuman 2.0 pricing

`omnihuman-2-0` is charged **per second of its audio**, with no tiers: 38.5<!-- credits-rate: omnihuman-2-0:per-second --> credits per second. The audio's length is rounded **up** to a whole second, at least 4 seconds, and the whole run is rounded up to a whole credit once. Nodaro measures the audio itself before it holds anything, on every path (the editor's Run, a workflow or app run, the API, the SDK and MCP); a length a request sends (`audioDurationSec`) is ignored for this model. The hold is the charge: nothing is refunded or added afterwards.

| Audio | Billed as | Credits |
|-------|-----------|--------:|
| 3.2 s (padded to 4 s) | 4 s | 154<!-- credits: omnihuman-2-0:per-second@4 --> |
| 10 s | 10 s | 385<!-- credits: omnihuman-2-0:per-second@10 --> |
| 10.04 s | 11 s | 424<!-- credits: omnihuman-2-0:per-second@11 --> |
| 15 s | 15 s | 578<!-- credits: omnihuman-2-0:per-second@15 --> |
| 1 min | 60 s | 2,310<!-- credits: omnihuman-2-0:per-second@60 --> |
| 5 min | 300 s | 11,550<!-- credits: omnihuman-2-0:per-second@300 --> |
| over 5 min | — | refused, nothing charged |

Before the audio's length is known, the node's credit chip shows the 15-second price marked `≈`; it updates once the audio is wired. An app or a component lists a run whose audio length it cannot know at the 5-minute price, the most a run can hold.

HeyGen Lipsync Precision, Sync Lipsync 2 Pro, and Sync Lipsync v3 also bill per second of output, bucketed to the same 15s / 30s / 1min / 2min / 5min tiers:

| Provider | 15s | 30s | 1min | 2min | 5min |
|----------|----:|----:|-----:|-----:|-----:|
| `volcengine-lipsync` | 330<!-- credits: volcengine-lipsync:15s --> | 660<!-- credits: volcengine-lipsync:30s --> | 1,320<!-- credits: volcengine-lipsync:60s --> | 2,640<!-- credits: volcengine-lipsync:120s --> | 6,600<!-- credits: volcengine-lipsync:300s --> |
| `heygen-lipsync-precision` | 561<!-- credits: heygen-lipsync-precision:15s --> | 1,111<!-- credits: heygen-lipsync-precision:30s --> | 2,211<!-- credits: heygen-lipsync-precision:60s --> | 4,411<!-- credits: heygen-lipsync-precision:120s --> | 11,011<!-- credits: heygen-lipsync-precision:300s --> |
| `lipsync-2-pro` | 693<!-- credits: lipsync-2-pro:15s --> | 1,375<!-- credits: lipsync-2-pro:30s --> | 2,750<!-- credits: lipsync-2-pro:60s --> | 5,500<!-- credits: lipsync-2-pro:120s --> | 13,739<!-- credits: lipsync-2-pro:300s --> |
| `sync-lipsync-v3` | 1,100<!-- credits: sync-lipsync-v3:15s --> | 2,200<!-- credits: sync-lipsync-v3:30s --> | 4,400<!-- credits: sync-lipsync-v3:60s --> | 8,800<!-- credits: sync-lipsync-v3:120s --> | 22,000<!-- credits: sync-lipsync-v3:300s --> |

The credit chip updates once the audio is wired (the node probes its duration). When the duration is unknown, the 5-minute tier is reserved.

> **Supply `audioDurationSec` for accurate pricing.** When calling `sync-lipsync-v3` or `volcengine-lipsync` via API/SDK, pass the output duration in seconds so the reservation buckets to the correct tier. If it is absent, the request is billed at the **5-minute ceiling** (sync-lipsync-v3: 22,000 CR<!-- credits: sync-lipsync-v3:300s -->; volcengine-lipsync: 6,600 CR<!-- credits: volcengine-lipsync:300s -->) with **no refund** — these per-second models commit the reserved bucket verbatim. The editor probes the duration automatically once the audio is wired.

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
Credits still use the duration tier displayed before generation.
