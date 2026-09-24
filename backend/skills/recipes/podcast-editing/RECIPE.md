---
name: podcast-editing
description: Transcript-driven editing of a long recording on Nodaro — tighten a whole episode, or fan a recording out into a pack of short clips, via an EDL you can hand-tune before rendering
triggers: ["edit my podcast", "tighten my podcast", "clean up this recording", "remove the silences and filler", "cut the dead air", "make clips from my recording", "clip pack", "find shareable clips", "turn my episode into shorts", "podcast editing", "edit this interview"]
version: 1
---

# Podcast Editing

You are editing ONE long recording (a podcast episode, an interview, a webinar) by
READING ITS TRANSCRIPT, not its pixels. The whole method rests on one data shape: an
**edit decision list (EDL)** — a plain, timed list of which spans of which source play, in
what order. An analysis step writes an EDL; a render step consumes one. Because the EDL is
just data, you (or the user) can open it, hand-tune it, and only then render — nothing is
baked until `apply_edl` runs.

This recipe covers the two phase-1 components:

- **Component 1 — Tighten episode:** turn the raw recording into one clean cut with the
  silence, filler, and false starts removed.
- **Component 2 — Clip pack:** fan the same recording out into N short, self-contained
  clips ready for social.

## The tools (and where each one runs)

| Verb | Role | Availability |
|------|------|--------------|
| `transcribe` | Speech to a timed, word-level transcript | everywhere (needs a speech-provider key on a self-host) |
| `silence_detect` | Detect the silent ranges (one local ffmpeg pass, no transcript) | everywhere (CORE, keyless) |
| `plan_edit` | Read the transcript and WRITE an EDL — `mode`: `tighten` / `clips` / `chapters` | **Cloud only** |
| `apply_edl` | RENDER an EDL into a finished video or audio cut | everywhere (CORE) |

**Read the asymmetry before you start.** `silence_detect` and `apply_edl` are core verbs —
they register on every install. `plan_edit` is the editorial planner and is **Cloud only**.
On a self-host without it you do not lose the pipeline: author the EDL by hand (or with any
planner you like) to the contract below, then render it with `apply_edl`. `plan_edit`
writes the EDL for you; it is not required to render one.

Each of these verbs returns a `job_id` — poll `get_job`. `plan_edit`'s EDL is in the job's
`output_data`; `apply_edl`'s rendered file is the job result. **The `transcribe` and
`silence_detect` payloads you hand to `plan_edit` are nested under `output_data.json` — pass
that inner object, never the whole `output_data` (see the steps below; getting this wrong
silently drops the data with no error).**

---

## Component 1 — Tighten episode

1. **Transcribe the master audio.** Call `transcribe` with `word_timestamps: true` (and
   `diarize: true` for a multi-speaker recording) so the transcript carries per-word
   `startMs` / `endMs` and speaker labels — `plan_edit` reads word timings, so a transcript
   without them cannot drive a tighten. When the job completes, pass its
   **`output_data.json`** (the normalized Transcript, word timings in milliseconds) as
   `plan_edit`'s `transcript`. Do NOT pass the whole `output_data` — its top-level
   `segments` are in SECONDS, and only `output_data.json` is the ms-timed Transcript the
   planner expects.
2. **Optional — detect silence.** Call `silence_detect` on the same source. Pass its
   **`output_data.json`** (the `{ version, ranges, durationMs }` object) as `plan_edit`'s
   `silence` to sharpen where the cuts land — pass that inner object, NOT the whole
   `output_data`, or the planner finds no `ranges` and the silence is silently ignored (the
   paid step does nothing). Tune `threshold_db` (a lower, more-negative dBFS floor is
   stricter), `min_silence_ms`, and `pad_ms` (speech kept around each range) if the default
   cut is too aggressive or too loose.
3. **Plan the tighten.** Call `plan_edit` with `mode: "tighten"`, the `transcript`, the
   optional `silence`, and the media `sources` (1–6). It returns one `Edl`: the kept spans
   are in `segments`, and everything it removed is recorded in `dropped[]` with a `reason`
   (`silence` / `filler` / `false-start` / …). Nothing is discarded silently — the dropped
   list is auditable.
4. **Review, then render.** Read the EDL. Hand-tune it if you want (see *Hand-editing an
   EDL* below), then call `apply_edl` with the EDL to produce the tightened cut. Use
   `output: "audio"` for an audio-only episode, `output: "video"` for a camera recording.

## Component 2 — Clip pack

1. **Transcribe** the recording the same way (step 1 above).
2. **Plan the clips.** Call `plan_edit` with `mode: "clips"`, the `transcript`, the
   `sources`, `count` (how many clips to find), and optionally `target_duration_sec` and
   `target_aspect` (e.g. `"9:16"` for vertical social). The `output_data` is an
   **`EdlClipSet`** — `{ version: 1, clips: Edl[] }` — one `Edl` per clip, each with its own
   `meta.title` / `meta.hook`.
3. **Render each clip.** Call `apply_edl` ONCE PER CLIP, passing that clip's `Edl`. A clip
   pack of N clips is N `apply_edl` calls (they can run in parallel). Deliver the rendered
   files, titled from each clip's `meta`.

`chapters` mode is available too: it returns `{ version: 1, chapters: [{ startMs, title }] }`
— chapter markers with titles, not a cut. There is nothing to render; hand the chapters to
the user (or a description field) as-is.

---

## The EDL shape (the `@nodaro/shared` `Edl` / `Transcript` contract)

The EDL and transcript types live in `@nodaro/shared` (`edl.ts`) — they are the wire
contract every editing verb shares, so learn them once. **Time is INTEGER MILLISECONDS
everywhere**; there is no seconds-vs-ms guessing, and an out-of-range value is a validation
error, not a silent rescale.

```
Edl {
  version: 1
  clock: "master"                 // segment times are on the source master clock
  sources: EdlSource[]
  segments: EdlSegment[]          // the ordered output timeline
  dropped?: EdlDropped[]          // removed spans, each with a reason (informational)
  meta?: { title?, hook?, targetAspect?, platform?, notes? }
}

EdlSource {
  id: string                      // referenced by segments; minted once, never re-derived
  url: string                     // media resolves from here
  kind: "video" | "audio"
  offsetMs?: number               // this source's origin on the master clock
  role?: "master-audio" | "camera" | "wide" | "screen"
  speakers?: string[]
}

EdlSegment {
  id: string
  inMs: number                    // on the master clock
  outMs: number                   // exclusive, MUST be > inMs
  video?: string                  // an EdlSource.id supplying picture (omit = audio-only)
  audio?: string                  // an EdlSource.id supplying sound
  speaker?: string
  transition?: { type: "cut" | "crossfade", durationMs? }   // "into" this segment
  labels?: string[]               // free tags: "hook", "chapter:2", …
}

Transcript {
  version: 1
  sourceId?: string               // which EdlSource this transcript came from
  language?: string
  words: { text, startMs, endMs, speaker?, confidence? }[]
  segments?: { startMs, endMs, text, speaker? }[]
}
```

The rendered output timeline is the `segments` in order (a crossfade shortens the total by
its overlap; a plain cut consumes no time).

---

## Hand-editing an EDL before `apply_edl`

Because the EDL is data, the user (or you) can adjust the plan and re-render without
re-planning. Common edits:

- **Cut a rambling answer:** delete its segment(s) from `segments`. Optionally record the
  span in `dropped[]` with `reason: "tangent"`.
- **Tighten a pause:** shrink a segment's `outMs` (or its `inMs`), or split one segment into
  two around the pause.
- **Reorder:** the output timeline IS the order of `segments` — reorder the array.
- **Soften a join:** set a segment's `transition` to `{ type: "crossfade", durationMs: N }`.
- **Swap the media:** either edit each `EdlSource.url`, or pass a positional `sources` array
  to `apply_edl` that overrides the URLs in `sources` order.

`apply_edl` validates the EDL at ingress and returns a 400 that NAMES the problem rather
than failing mid-render, so keep these invariants when editing by hand:

- `clock` is `"master"`; every time is an integer in milliseconds.
- Every segment has `outMs > inMs` and `inMs >= 0`.
- Every `video` / `audio` on a segment names a real `sources[].id`. A `video` source must be
  `kind: "video"`.
- Every segment needs a SOUND source: an explicit `audio` id, OR one source with
  `role: "master-audio"` (used for every segment that omits `audio`), OR its own `video`
  source to take sound from. A segment with none of the three is rejected.
- For a **video** render (`output: "video"`) EVERY segment needs a `video` source; for an
  audio-only cut use `output: "audio"`.
- A segment carries at most one transition field. (A transition on `segments[0]` is harmless
  — it is dropped automatically, since there is no predecessor to transition from.)
- Only a `crossfade` consumes time, and its `durationMs` must be at most 0.9 × the shorter
  of the two adjacent segments (the ffmpeg crossfade limit).
- At most one source may have `role: "master-audio"`.
- One render produces at most **180 minutes** of output (the rendered length — crossfade
  overlaps subtracted, the same length the per-minute price reads). A longer edit is refused
  with a 400 naming its length and the limit; split it into parts of at most 180 minutes
  and render each with its own `apply_edl` call.
- `dropped[]` ranges must be positive (`outMs > inMs`) and must not overlap any kept
  segment.
- A segment must exist on the media it reads. Its `inMs` must be at or after the
  `offsetMs` of each source it reads (the picture source for a video render; the sound
  source always) — the render cannot reach before a source starts. And it may not run more
  than one second past the END of a track it reads (measured from the file's own
  timestamps): that can only be checked against the file itself, so it runs after the
  sources are downloaded, and a violation **fails the job immediately** (credits refunded,
  not retried) naming the segment, the source and the track. A reach of up to one second is
  treated as rounding: the segment keeps its full length, holding the picture's last frame
  and padding the sound with silence past the track's end, so later cuts stay in sync.
  MPEG-TS / program-stream sources (per-track timestamps not on the render's clock) are
  checked against the length the container declares instead, with five seconds of slack —
  unless the file's timestamps jump (two recordings joined, a reconnected stream, a
  restarted clock), in which case the declared length misstates it and the window is not
  checked.
- A segment's picture source must have a real video track — an audio file, or an mp3 whose
  only "video" is embedded cover art, fails the job the same way.
- A `layout` is accepted only when it describes what this renderer does anyway: `mode`
  `"single"`, at most one slot and that slot IS the segment's `video`, no `emphasis` other
  than `"none"`, a `cut`. Anything else (a multi-camera mode, another slot source, a
  `pan`/`zoom`/`xfade` transition, an emphasis other than `"none"`, a region crop) is
  refused rather than rendered as something the EDL does not describe.

When `apply_edl` reports an issue at ingress, it quotes the offending segment id and rule —
fix that and re-render; nothing was spent on the rejected attempt beyond the validation. The
checks that need the files themselves — a segment reaching past the end of its media, a
picture source with no video track — fail the job right after download, once, and the
credits are refunded.

## Notes

- **Media ids come from the user, never from prose.** This recipe teaches structure; wire
  the user's own recording and assets into the verbs.
- **Cost posture:** `silence_detect` is a lightweight ffmpeg step (a small flat charge);
  `plan_edit` is a metered Cloud step priced by mode, reasoning tier, and recording length;
  `apply_edl` is priced per rendered minute. Quote the plan step to the user before running
  long recordings.
- **`sync_audio` (multicam alignment) is not part of phase 1** — do not reach for it here.
