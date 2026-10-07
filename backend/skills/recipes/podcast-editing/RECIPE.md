---
name: podcast-editing
description: Transcript-driven editing of a long recording on Nodaro — tighten a whole episode, fan it out into a pack of short clips, or cut a multicam recording to whoever is speaking, via an EDL you review as a Preview before rendering the final
triggers: ["edit my podcast", "tighten my podcast", "clean up this recording", "remove the silences and filler", "cut the dead air", "make clips from my recording", "clip pack", "find shareable clips", "turn my episode into shorts", "podcast editing", "edit this interview", "multicam podcast", "cut between the cameras", "switch to whoever is speaking", "sync my cameras"]
version: 2
---

# Podcast Editing

You are editing ONE recorded conversation (a podcast episode, an interview, a webinar) by
READING ITS TRANSCRIPT, not its pixels. The whole method rests on one data shape: an
**edit decision list (EDL)** — a plain, timed list of which spans of which source play, in
what order. An analysis step writes an EDL; a render step consumes one. Because the EDL is
just data, you (or the user) can open it, review it, adjust it, and only then render the
final — nothing is delivered until `apply_edl` runs with `quality: "final"`.

This recipe covers:

- **Tighten episode:** the raw recording as one clean cut with the silence, filler and
  false starts removed.
- **Clip pack:** the same recording fanned out into N short, self-contained clips.
- **Multicam:** a conversation filmed on several cameras (plus, usually, one mic recorder),
  lined up by sound and cut to the camera of whoever is speaking.

Each of them ends the same way: **render a Preview, review it with the user, then render
the final.**

## The tools (and where each one runs)

| Verb | Role | Availability |
|------|------|--------------|
| `transcribe` | Speech to a timed, word-level transcript; `diarize: true` labels the speakers | everywhere (needs a speech-provider key on a self-host) |
| `silence_detect` | Detect the silent ranges (one local ffmpeg pass, no transcript) | everywhere (CORE, keyless) |
| `audio_sync` | Measure how far apart the clocks of 2–6 recordings of one conversation are, from their sound | everywhere (CORE, keyless) |
| `plan_edit` | Read the transcript and WRITE an EDL — `mode`: `tighten` / `clips` / `chapters`; multicam `offsets` from `audio_sync` | **Cloud only** |
| `switch_cameras` | Put each cut of an EDL on the camera of whoever is speaking; the sound never changes | **Cloud only** |
| `apply_edl` | RENDER an EDL into a video or audio file — `quality: "proxy"` for a Preview, `quality: "final"` for the delivery | everywhere (CORE) |
| `mix_audio` | Layer tracks into one file; with `duck: { under: <voice track index> }` a music bed dips under speech and rises in the pauses — run it on an `apply_edl` audio render plus the bed | everywhere (CORE) |

**Read the asymmetry before you start.** `silence_detect`, `audio_sync` and `apply_edl` are
core verbs — they register on every install. `plan_edit` and `switch_cameras` are Cloud
only. On a self-host without them you do not lose the pipeline: author the EDL by hand (or
with any planner you like) to the contract below, put each segment's `video` on the camera
you want, and render it with `apply_edl`.

Each of these verbs returns a `job_id` — poll `get_job`. **The payloads you hand from one
step to the next are nested under `output_data.json` — pass that inner object, never the
whole `output_data`** (see the steps below; getting this wrong silently drops the data with
no error). `plan_edit`'s plan is the job's `output_data`; `apply_edl`'s rendered file is the
job result.

---

## Tighten episode

1. **Transcribe the master audio.** Call `transcribe` (word timings are always on; add
   `diarize: true` for a multi-speaker recording). When the job completes, pass its
   **`output_data.json`** (the normalized Transcript, word timings in milliseconds) as
   `plan_edit`'s `transcript`. Do NOT pass the whole `output_data` — only `output_data.json`
   is the ms-timed Transcript the planner expects.
2. **Optional — detect silence.** Call `silence_detect` on the same source. Pass its
   **`output_data.json`** (the `{ version, ranges, durationMs }` object) as `plan_edit`'s
   `silence` to sharpen where the cuts land — NOT the whole `output_data`, or the planner
   finds no `ranges` and the silence is silently ignored (the paid step does nothing). Tune
   `threshold_db` (a lower, more-negative dBFS floor is stricter), `min_silence_ms`, and
   `pad_ms` (speech kept around each range) if the default cut is too aggressive or too
   loose.
3. **Plan the tighten.** Call `plan_edit` with `mode: "tighten"`, the `transcript`, the
   optional `silence`, and the media `sources` (1–6). It returns one `Edl`: the kept spans
   are in `segments`, and everything it removed is recorded in `dropped[]` with a `reason`
   (`silence` / `filler` / `false-start` / …). Nothing is discarded silently.
4. **Preview, review, render final** — see *Review: Preview first, then the final* below.
   Use `output: "audio"` for an audio-only episode, `output: "video"` for a camera
   recording.

## Clip pack

1. **Transcribe** the recording the same way (step 1 above).
2. **Plan the clips.** Call `plan_edit` with `mode: "clips"`, the `transcript`, the
   `sources`, `count` (how many clips to find), and optionally `target_duration_sec` and
   `target_aspect` (e.g. `"9:16"` for vertical social). The `output_data` is an
   **`EdlClipSet`** — `{ version: 1, clips: Edl[] }` — one `Edl` per clip, each with its own
   `meta.title` / `meta.hook`.
3. **Render each clip** — one `apply_edl` call PER CLIP, passing that clip's `Edl` (they can
   run in parallel). Pass `clip_key` — the clip's span on the master clock,
   `"<earliest inMs>-<latest outMs>"` of that clip's segments in the PLAN (also when the
   render is of a camera-switched clip: switching can move the edges inward) — and each
   render's result carries it back as `output_data.clipKey`, so you can match every file to
   its clip. Preview the pack first
   (below), drop the clips the user does not want, then render the kept ones at final.
   Deliver the files, titled from each clip's `meta`.

`chapters` mode is available too: it returns `{ version: 1, chapters: [{ startMs, title }] }`
— chapter markers with titles, not a cut. There is nothing to render; hand the chapters to
the user (or a description field) as-is.

## Multicam (several cameras, one conversation)

Each device started recording at a different moment, so the files are on different
clocks. The plan is always timed on ONE clock — the **master**: the source with
`role: "master-audio"` (usually the mic recorder), else the first source.

1. **Name the recordings once.** Give every recording an id (e.g. `mic`, `cam-a`, `cam-b`)
   and use the SAME ids in `audio_sync`, in `plan_edit`'s `sources`, and in
   `switch_cameras`' `speaker_map`. Offsets are matched to sources by id.
2. **Line them up.** Call `audio_sync` with `sources: [{ id, url }]` for every recording and
   `reference` set to the master's id. Its `output_data.json` is
   `{ reference, offsets: [{ sourceId, offsetMs, confidence, driftMsPerHour }], notes }`.
   Read `notes` to the user: low confidence and clock drift are reported there, never
   corrected.
3. **Transcribe the master** with `diarize: true` — `switch_cameras` needs speaker labels,
   and the transcript must be on the master's clock (transcribe the master recording, not a
   camera). Pass the master's id as `plan_edit`'s `transcript_source_id`.
4. **Plan with the offsets.** Call `plan_edit` with the sources — the master as
   `kind: "audio"`, `role: "master-audio"`; each camera as `kind: "video"`,
   `role: "camera"` (or `"wide"` for a wide shot) — and the `audio_sync` result as
   `offsets`. Each measured offset is written onto its source before the request. It is
   **refused before any charge** when a source was not measured or matched weakly
   (confidence below 0.5 — set that source's `offset_ms` by hand, `0` if it started with
   the master), or the master was not measured. Each cut goes on the first camera with
   picture for it; a stretch no camera filmed is dropped with the reason `no-picture`.
5. **Switch cameras.** Call `switch_cameras` with the plan's `edl` (one EDL — for a clip
   pack, one call per clip), the diarized `transcript`, and `speaker_map` (speaker label →
   the id of that speaker's camera; a speaker left out of `speaker_map` goes to the source
   whose `speakers` list names them, else the `wide` camera, else any camera with picture;
   one mapped to `""` skips the `speakers` list). `speaker_names` renames the speakers on the segments and in the
   returned transcript. Leave `layout_hints` off: `apply_edl` renders cut-only edits and
   refuses a layout-hinted one. Its `output_data.json` is the switched EDL for `apply_edl`;
   `output_data.transcript` is the named transcript (wire it to captions).
6. **Preview, review, render final** — below. The sound never switches: every cut keeps
   the master's sound, whichever camera it shows.

---

## Review: Preview first, then the final

A final render is billed per output minute at the final rate; a Preview at its own, lower
rate. So the order is always: **Preview → review → Render final.**

1. **Render a Preview.** Call `apply_edl` with the EDL and `quality: "proxy"`. A Preview
   is the same edit on the same frames — at most 720p, lighter mono sound — always private
   (never in the public gallery) and labelled Preview (`preview: true` from `get_job`).
2. **Review it with the user.** Show the Preview, and from the EDL tell them what was cut
   and why: each `dropped[]` entry has a `reason` and a span. Ask what to restore, what else
   to drop, which clips to keep.
3. **Apply their decisions to the PLAN's EDL** (the `plan_edit` result), never re-planning:
   restore a dropped span by removing its `dropped[]` entry and adding a segment for it (a
   new `id`, the same `video` / `audio` sources as its neighbours) in time order; drop a
   span by shrinking or removing its segment and recording it in `dropped[]`; drop a clip by
   not rendering it. Keep the invariants under *Hand-editing an EDL*. A re-run of
   `plan_edit` is billed again and plans afresh — the user's review would be lost.
   **Multicam:** keep the edits on the plan and run `switch_cameras` again on the edited
   plan (billed again, flat), the same rule the editor follows — the camera choice is
   re-made for the new cut. You can preview the new cut before the final.
4. **Render final.** Call `apply_edl` with the reviewed EDL (for multicam: the new
   switched EDL) and `quality: "final"`. For a clip pack, one final per kept clip, each
   with its `clip_key`. Every result's `output_data.quality` says which it is.

**In a workflow (the editor's Tighten Episode / Clip Pack templates).** There the Apply
EDL node's **Quality** set to **Proxy** renders a Preview, and its **Render final** button
renders the final from the saved plan without re-running it. A deployment can turn on the
**preview stop rule** with `PREVIEW_STOP_RULE_ENABLED` (off by default; where it is off,
nothing below applies): a run then stops at a render set to Proxy — nothing after it runs
or is billed until Render final — and a run started anywhere but the editor (including
`run_workflow`) that would execute such a render is refused with
`preview_review_required`, because nobody is there to review it. To run it anyway from
MCP, override the render for that run: `inputs: { "<render node id>": { "quality": "final" } }`.
Once the user has reviewed a preview their editor run stopped at, `render_final(workflow_id,
render_node_id, execution_id)` runs the editor's Render final for them — the render at Final
and every node after it, continuing that run; the server picks the nodes. Call it once for
the price, and again with `confirm: true` once the user accepts it.
A sub-workflow or component holding a Proxy render is refused with `preview_render_nested`.

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
  the user's own recordings and assets into the verbs.
- **Cost posture:** `silence_detect` is a lightweight ffmpeg step (a small flat charge);
  `audio_sync` is a small charge per extra recording; `plan_edit` is a metered Cloud step
  priced by mode, reasoning tier and recording length; `switch_cameras` is a flat charge per
  run; `apply_edl` is priced per rendered minute, a Preview at its own lower rate. Quote the
  plan step to the user before running long recordings, and preview before the final.
