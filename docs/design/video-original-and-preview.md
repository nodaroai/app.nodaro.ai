# Video originals and browser-safe previews

Some video models deliver a file most browsers cannot show correctly: HEVC in
10-bit, or an HDR picture (HLG or PQ). The platform used to re-encode such a
file to 8-bit H.264 and keep only that copy, so the provider's file was lost
and an HDR picture came out washed out or too dark.

Since 2026-11-22 the provider's file is kept as it was delivered, beside a copy
a browser can play.

## What is kept, and when

One store function (`backend/src/lib/video-result-store.ts`) handles every
video result a job stores, whether it is a provider's file or a file our own
mux or stitch made from one. The rule depends on the file itself, never on the
model that made it:

| The delivered file | What is stored |
|---|---|
| H.264, 8-bit 4:2:0 (`yuv420p`) | The file itself. It needs no preview, so there is no separate original. |
| Any other video in an MP4, QuickTime, WebM or Matroska file (HEVC, 10-bit, 4:2:2/4:4:4, ProRes, HDR…) | **The original**, untouched, stored first. Then **the preview**: 8-bit H.264 4:2:0. |
| A file in which the probe reads no video stream, or that it cannot read at all (an error page, a truncated file, sound alone) | No original. The file goes through the browser-safe encode as before, and the store fails when that encode fails or writes no video frame. A file with sound alone fails the store; before this change the encode wrote a sound-only MP4 and the store kept it. The probe is asked twice, so one failed probe on a healthy file changes nothing. |
| A file whose header reads but whose picture does not decode (its media data zeroed, missing or cut away, or a picture with no size) | No original. Before an original is kept, its first five frames are decoded (in a shorter clip, every frame it holds, counted from its packets: a WebM or Matroska file states no frame count); a file that fails is stored the old way, through the browser-safe encode, and the store fails when that encode fails or writes no video frame. Nothing is kept and nothing is charged. |
| Any file, on a watermarked run | Only the watermarked browser-safe file, as before. There is no original. |

The preview of an HDR original (transfer `arib-std-b67` or `smpte2084`) is
tone-mapped to SDR BT.709 and tagged that way. A 10-bit SDR original gets a
plain 8-bit preview with its colour tags kept. An upscale keeps its visually
lossless preview quality.

The original keeps its own container and content type (`.mp4`, `.mov`,
`.webm`, `.mkv`). It is stored at `videos/<id>-master.<ext>`, next to the
preview at `videos/<id>.mp4`, so it is part of the same job. Retention, an
app's expunge and the result review find it the same way they find the
preview (deleting a job for good is the exception: see Storage quota). An
original is kept only for a store with a job of its
own: a store id that names no job, or names another job than the one the
worker is running (a plugin passing some other id), keeps none.

## Storage quota

The original counts against the owner's storage. Its size is recorded with
its job, in the server-only `jobs.server_output` column, when it is stored,
and the owner is charged that size once per object: a retry that stores the
same original again is not charged twice. (A retry that stores the preview
again still charges the preview's bytes again, as every store always has.)
The size recorded is the size charged: a deployment without storage accounts
records 0, and nothing is given back for it. The owner charged is always the
job's own (`jobs.user_id`), never an account the caller names.

An original exists only if its record landed. A store whose record does not
land (the database answers that the record function or column does not exist
yet, or a read-back after repeated failed calls finds no record) deletes the
original again and stores the file as before this change. It deletes only
an object no record names: if another store of the same job recorded that
key meanwhile, it is left alone, and while the delete runs (and after it, for
any store that began before it) no store records that key. A call that failed
after it committed is simply sent again: the record is keyed on the object,
so it charges nothing more. Only when neither the calls nor the read-back
answer is the object left where it is, with no original named: it is then
recorded and charged (and found by every path below), or it was never charged.

A store that finds its job already completed (a duplicate finalizer) keeps
its upload only when the completed output names that very key, and deletes
it otherwise.

A store that cannot tell whether its record landed, or that cannot reach the
database to discard an unrecorded upload, hands the object to the existing
storage-delete retry pass, which deletes it later unless storage by then
holds a newer object at that key.

Once a job completes (or a held job is approved), every object its record
holds that the completed output does not name (an original an earlier attempt kept when the attempt
that completed kept none, one whose store could not tell it was recorded) is
claimed, deleted and given back. This is done at the completion, never in a
store: a store cannot tell an earlier attempt's object from a concurrent
attempt's. A prune that does not finish leaves a mark on the job, and the
cleanup cron's hourly sweep weighs every completed job still carrying it
(read through a small partial index of exactly those rows).

Every path that deletes a recorded object first claims it off its job's
record, under the row's lock, gives back only the bytes that claim answered,
and deletes the object only once the claim ran (a claim that did not run
deletes nothing and leaves it for the next pass). Two paths deleting the
same object (the failure write and the worker's cancel handling, or a
library delete and the retention sweep) give its bytes back once. A kept
original is never given back by any size of its own, only by its claim, even
when a library row names it (a job that completed on its original). Those
paths are (none of them claims, deletes or drops from the record an object
held as evidence, or anything on a deployment that deletes nothing; once a
claim is made, an object whose delete fails goes to the storage-delete retry
pass):

- deleting the video from the library (the original goes with its preview;
  a claim that does not run answers an error and nothing is deleted);
- the retention sweep, which reaps every object a job's record holds, whether
  or not a url names it, and leaves a job unmarked while any of them could
  not be claimed; a library row it reaps takes the original beside its
  preview with it, and a row naming an original whose job is gone still has
  its object deleted;
- an app's expunge, which claims before it clears the job's record, and stops
  before clearing anything when a claim does not run;
- not yet: deleting a job for good (below) leaves its original, as it leaves
  its preview;
- a result-gate block that deletes the job's files;
- a job that failed or was cancelled (below).

The retention sweep and an app's expunge give back only recorded bytes: a
file with no record gives nothing back.

Deleting a job for good (the Trash's "delete forever", the 30-day purge)
deletes neither its preview nor its original, as a job delete never deleted
its stored files; both stay charged.

A job that ends while its result is stored never keeps the original:

- the original is recorded only on a job still in flight (pending, queued,
  processing, or held for review). If the job was cancelled or failed by
  then, the original is deleted, nothing is charged, and the store stops as a
  cancel;
- a job that fails after the record deletes it and gives its size back (the
  failure funnel);
- a job cancelled after the record: the worker's completion misses the
  cancelled row, its cancel check finds it, or the finalize finds the row
  ended or loses its claim (every lane: worker, reconcile, webhook), and
  each deletes the original and gives its size back;
- a cancel also stops a preview encode that is already running, and the
  worker's cancel handling then deletes the original recorded before it and
  gives its size back;
- a job cancelled while no worker was alive (one died mid-encode): a stall
  re-pick of the cancelled row discards what its record holds, and on Nodaro
  Cloud the cleanup cron's hourly sweep reaps every cancelled or failed job
  whose record still holds objects (a bounded number a run, read through a
  partial index of exactly those rows).

A watermarked Extend's record names only the raw clip of the attempt that
completed (or none): each attempt clears an earlier attempt's reference
before it copies its own.

A worker shutting down does not stop a running preview encode. The job is
handed on as before; when it runs again it stores the original again and is
not charged for it twice.

A preview encode the machine stopped (the system killed it for memory, or its
log outgrew its buffer) is retried like any other failure, except on the
job's last attempt, where the job completes on its original with
`videoPreviewUnavailable`, as for an encode that failed on its own. The last
attempt is the worker's last BullMQ attempt; in a reconcile or webhook
delivery (which the reconcile sweep retries) it is the one whose next
reconcile count would give the job up.

A delete that storage refuses is retried by the existing storage-delete retry
pass. Its bytes were given back at the claim, since no later path can claim
them again.

## A video that cannot be used

This code ships only once its migration is live on the database, so it has
one behaviour. A delivered video that is empty or has no picture
that decodes fails its job and the credits are refunded at once (it is the
provider's result, not a fault in our storing of it). "No picture" means
ffprobe or ffmpeg ran and named the input as invalid or undecodable (a clean
exit with no frame, or its own refusal of the data). Any other failure — one
that names the machine (memory, disk, threads, the network), a timeout, a
kill, a launch that never started, or a message the rule does not know — is
retried as any other failure, never read as an unusable video. On the job's
last attempt a probe or decode check that could not run stores the file the
way it always was, so the job still delivers its video.

## What the API returns

A completed video job's `output_data`:

- `videoUrl` is always a file a browser can play: the preview, or the file
  itself when no preview was needed.
- `originalVideoUrl` is present only when an original was kept.
- `videoPreviewUnavailable: true` means the preview encode itself failed or
  ran out of its own time (waiting for a turn to encode does not count
  against it). The job still completes: `videoUrl` names the original, which
  some browsers cannot play, and which passed the decode check above. A
  worker shutting down, a cancel, a stopped or never-started encode, a busy
  machine (an encode the system killed for memory, a log that outgrew its
  buffer, no thread or memory to start one) or a failed upload of the preview
  is not a failed preview: each is retried or ends the job as before. A
  watermarked run never falls back this way; it keeps its old behaviour.

The SDK types this as `VideoJobOutput`. MCP's job views return it in
`outputData`, and `outputUrl` stays the playable file.

In the editor, a result with no preview copy that the browser cannot decode
or does not support (MediaError 3 or 4) shows a short message and a Download
button that saves the file under its own extension, on the
canvas nodes and the result overlay, also when the player reads the file
through the app's proxy. Any other load failure (a network error, an aborted
load), and any failure of a normal preview, keeps the node's usual handling.
A file the server no longer has is also reported as error 4, and nothing on
the element tells the two apart, so the message says only that the video
could not be played here and offers the download. The published app, the
gallery and the library players do not show the message yet.

## Download

Download should give the original when there is one. The API and MCP expose
it now. Moving the editor's Download buttons onto it is a follow-up (see
below).

## Editing nodes

Editing nodes (Combine, Trim, Loop, Add Captions, renders) still read
`videoUrl` and write 8-bit H.264 as before. Because the preview of an HDR
original is already tone-mapped, they now get SDR input with correct colour
instead of HLG or PQ squeezed into 8 bits.

## Watermarked runs

Nothing a watermarked run stores without its watermark may be readable by its
owner.

- **Extend chains.** An Extend chain keeps the raw extension (a QuickTime file)
  as the reference for the next extension. On a watermarked run that file is
  unwatermarked, so it is stored under a key that cannot be derived from the
  job id and named only in `jobs.server_output`, a column no browser role can
  read. A job's `output_data` can be read by its owner directly, so it never
  names that file. The chain still finds it, and the retention sweep and an
  app's expunge delete it. The provider's temporary URL is no longer recorded
  on a watermarked run.
- **Image-to-video post-processing.** A loop cut and Veo's sound strip now
  stay on local disk until the result is stored, and are then removed. No
  intermediate copy is stored, on any run.
- **Audio merges** read the delivered file directly and store only the merge.

## Not covered yet

- Editor Download buttons that give the original, and a guard that keeps new
  buttons on the same helper.
- Reading the original when editing: an Extend join writing 10-bit HEVC, and
  editing nodes reading the original and tone-mapping HDR input themselves.
  Today the shared audio merge (Merge Video & Audio, Generate Video's audio
  track, Lip Sync's voice line) re-encodes any picture that is not H.264
  `yuv420p`, so its result is 8-bit H.264 and keeps no original. It does not
  tone-map: an HDR source that goes through it is re-encoded with no tone
  map, and comes out as HDR pictures did before this change. A step that
  copies the picture untouched (Face Swap laying the source's sound back)
  passes a 10-bit file on, and that result does keep its original.
- Plugin outputs. A plugin keeps an original only if it calls the toolkit's
  new `media.storeVideoResult`. The older `uploadVideoMaybeWatermark` returns
  a single URL, so it keeps no original.
