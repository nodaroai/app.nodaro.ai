# Camera Switch

> Choose which camera shows each cut of an edit by who is speaking — a multicam edit from one diarized transcript. The sound never changes.

**Cloud feature.** Camera Switch runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node relays to the cloud; without a connection the node saves on the canvas but cannot run.

## Overview

A podcast or interview recorded on several cameras ends up as one edit (an [Edit Plan](./edit-plan.md) EDL) that shows a single camera throughout. Camera Switch reads the **transcript with speaker labels** and puts each stretch of the edit on the **camera of whoever is talking**, then hands the switched edit to [Apply EDL](./apply-edl.md) to render. It is deterministic — the same edit, transcript and settings always give the same cuts — and it never touches the sound: every cut keeps the sound its segment already had (the master recording).

A typical multicam chain: **Audio Sync** (lines the recordings up) → **Transcribe** with speaker detection → **Edit Plan** (with Audio Sync's offsets) → **Camera Switch** → **Apply EDL**.

The **Multicam Cut** template in the template marketplace is this chain, ready to fill: two close-up cameras, a wide camera and a master audio track (marked *master audio* in Edit Plan, and the reference Audio Sync measures against), with Layout hints **off** so the edit stays cut-only and Apply EDL renders it. Add or delete camera nodes for 2–6 recordings in all, wiring each into both Audio Sync's and Edit Plan's Sources.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| EDL | json | **Yes** | One edit — wire Edit Plan's EDL output (Tighten mode, or Clips mode: each clip fans out to its own Camera Switch run). A chapters plan is refused. |
| Transcript | json | **Yes** | The word transcript **with speaker labels** — a Transcribe node run with speaker detection on. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Switched edit (EDL) | json | The edit with each cut on the speaker's camera. Wire it into Apply EDL. After a Clips-mode run it holds one switched edit per clip, and its edge **defaults to Each** — one Apply EDL render per clip. |
| Transcript (named) | json | The transcript with your speaker names applied — wire it into Apply EDL's or Add Captions' Transcript input so captions show the names. It is the same for every clip, so this edge always delivers the one transcript, whatever mode it is set to. |

## How it switches

- **A speaker's turn cuts to their camera** a moment (0.2 s) before they start, but only when the turn is at least the **shortest shot** long (2.5 s). Someone talking for less — a quick "yeah" — **never causes a cut**: the current camera holds. A listener's "mhm" in the middle of someone's long answer does not interrupt it either.
- **Speakers and cameras.** The settings panel lists the transcript's speakers. Give each a name and a camera; the table is **pre-filled in order** (speaker 1 → the first camera, speaker 2 → the second …), so a run works without opening it. Several speakers may share one camera (a two-shot). A speaker set to *No camera of their own* — or a speaker past the last camera — is shown on the **wide** camera (a source marked *Wide* in Edit Plan), else on any camera that filmed them.
- **Every cut names who is speaking** (the segment's `speaker`, with your names applied). When the speaker changes but the camera does not — a two-shot, the wide showing two speakers, or a fallback camera showing someone else's turn — the edit is still split there: nothing visible changes, and each piece names its own speaker. A cut held back by the shortest shot keeps the current shot's name until it lands — the name is whom the shot is for.
- **When the speaker's camera has no picture** (it started late or stopped early), that stretch shows the wide camera if it has picture, else the first camera that does. A stretch **no camera filmed** is left out and listed in the edit's dropped cuts as `no-picture`; a gap of up to half a second right after a camera stops is held on its last frame instead.
- **With a wide camera:** after **20 s** on one camera the edit cuts to the wide for one shortest shot, then back (*Wide break after*); *Wide every N cuts* sends every N-th cut to the wide.
- **The sound stays put.** Each cut keeps the sound its segment had in the edit — usually the master recording — so the soundtrack never switches mics with the picture.
- **One speaker, or fewer than 2 cameras:** the edit comes back unchanged, with a note in the edit's notes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Speakers | Table | pre-filled in order | Per speaker label: a display name and a camera (or *No camera of their own*). |
| Shortest shot (s) | Number | 2.5 | A turn shorter than this never causes a cut. 0.5–60 s. |
| Cut early (s) | Number | 0.2 | Cut this long before the new speaker starts. 0–5 s. |
| Wide break after (s) | Number | 20 | With a Wide camera: break to it after this long on one camera (0 = never). Up to 600 s. |
| Wide every N cuts | Number | 0 (off) | With a Wide camera: every N-th cut goes to the wide. 0–20. |
| Layout hints | Toggle | off | When two people talk over each other for more than 1.2 s, suggest a side-by-side (or stacked, for portrait) layout on those cuts. Apply EDL renders cut-only edits today and refuses a layout-hinted one — leave this off unless the edit goes to a layout-aware renderer. |

A value outside its range snaps to the nearest end when you leave the field. Speaker names are up to 80 characters.

## Credit Cost

A **flat 10 credits** per run, whatever the length or the number of cameras. In Edit Plan's Clips mode the node runs once per clip, so 8 clips cost 80 credits.

| Example | Runs | Credits |
|---------|------|---------|
| A tightened 60-minute episode, 3 cameras | 1 | 10 |
| 8 clips from Clips mode | 8 | 80 |

**Refused before charging:** a transcript with **no speaker labels at all** (transcribed without speaker detection) — turn on speaker detection in Transcribe and run it again. A missing EDL or transcript is refused the same way, and so is an EDL that is not one edit on the recording's clock: a whole clip set (wire Edit Plan straight in so it fans out per clip), a chapters plan, or a rendered output's EDL.

## API

`POST /v1/camera-switch` with `{ edl, transcript, speakerMap?, speakerNames?, minShotMs?, leadMs?, maxShotMs?, wideEvery?, layoutHints? }` — `edl` is one EDL (object or JSON string; a clip set, a chapters plan or an output-clock EDL is refused, `400 invalid_edl`), `speakerMap` maps a speaker label to an EDL source id — `""` means *no camera of their own* (a speaker left out uses the source whose `speakers` list names them; either way, else the wide, else any camera with picture). The settings must be in the ranges above (`400` otherwise); `speakerNames` values are 1–80 characters. A transcript with no speaker labels is refused before charging (`422 no_speakers`). The finished job's `output_data.json` is the switched EDL and `output_data.transcript` the named transcript. SDK: `client.edit.cameraSwitch` ([SDK Reference](../../sdk-reference.md)); CLI: `nodaro edit switch-cameras` ([CLI](../../cli.md)); MCP: `switch_cameras`.

## Tips

- Run **Audio Sync** into Edit Plan's Offsets first — Camera Switch needs to know where each camera sits on the master's clock to show the right moment.
- Mark the wide shot's source as **Wide** in Edit Plan's source table; it becomes the fallback and the break shot.
- Name the speakers in the panel and wire the named Transcript output into Add Captions to caption with real names.
