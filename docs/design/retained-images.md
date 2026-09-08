# Retained image snapshots

Server integrations can retain an image after authorizing its source and the
destination workflow. The toolkit receives image bytes, stores a separate copy,
and returns an asset ID, SHA-256 hash, URL and dimensions. Reads verify both the
workflow binding and the stored bytes. Gallery assets and their editable metadata
do not determine whether a snapshot is valid.
Capture applies registered upload policies to the final normalized image bytes
on the `retained-image` lane before reserving quota or writing storage. A denied
capture returns HTTP 400 with `upload_blocked`, without exposing policy IDs.

Snapshots remain available for the lifetime of their production. Deleting a
source image or removing a result from a gallery does not delete the retained
copy. Deleting the production is refused while it has active jobs using retained
images. After production deletion, durable cleanup removes the copies and releases
their storage usage. Cleanup retries failures and cannot refund the same bytes
twice.
Copies also survive a capturing collaborator's account deletion while the
destination production still exists.
Attempts to delete protected bytes or a production with active image use return
HTTP 409 with `retained_image_in_use` through the normal API error handler.

Copies count against storage under the deployment's existing quota rules. The
same owner, production and content hash reuse one copy. Supported stored formats
are PNG, JPEG and WebP, up to 25 MiB per image. Animated images are refused. EXIF
orientation and HEIC input are normalized before hashing; hashes describe the
actual stored bytes supplied to generation.

The optional toolkit members are `storage.retainImage`,
`storage.readRetainedImage`, and `storage.canRetainImages`. Integrations must check
availability before submitting jobs that require this guarantee. These methods
do not authorize a caller, fetch arbitrary URLs, or start media generation.
For authorized public HTTP sources, the optional `http.safeFetchBytes(url,
maxBytes)` helper applies SSRF checks, a 30-second deadline and a streaming byte
limit capped at 25 MiB. The limit also applies when Content-Length is missing or
incorrect; the helper supplies no storage credentials.

For an authorized video source, `media.readPublicVideoFrame({ videoUrl, timeSec })`
downloads over public HTTP to a temporary file with a 500 MiB streaming limit
and a 120-second deadline. It extracts one frame from MP4/MOV, WebM/Matroska or
AVI with a 60-second processing limit. Playlists are refused; FFmpeg receives
only a local file. Temporary files are removed on success and failure. The
returned image is limited to 25 MiB and must pass `storage.retainImage` before
being used as a retained reference. Extraction creates no generation job.

For generated results, `storage.retainJobImage` additionally checks that the job
belongs to the caller and destination workflow, has completed, and carries
server-written submission metadata. It supports the single primary result of
`generate-image` and `image-to-image`. After capture, a database recheck binds
the retained image to that job and copies its immutable submission record.
Held jobs cannot be captured. A failed capture can be retried without accepting
the image or submitting another generation.

`storage.readRetainedJobImages` reads verified images and their original
submission records within an authorized workflow. These records survive source
job deletion and are removed with the destination workflow. Workflow JSON alone
cannot attest which job produced a particular retained image.

`storage.copyRetainedImage` is a byte-copy primitive for authorized integrations.
The caller must authorize reading the source workflow and editing the destination.
It reads a ready, workflow-scoped retained image, verifies its bytes and captures
those exact bytes under the destination's retention and quota rules. A copy in
another workflow receives its own storage lifetime; it does not depend on the
source workflow continuing to exist. Reuse inside the same workflow returns the
verified existing image. Missing sources return null and changed bytes fail
before any destination reservation. Copying bytes transfers no job provenance,
review decision or execution authority; editable production cloning must handle
those records separately.

Snapshot metadata and cleanup tasks are server-only. Ordinary single and batch
object deletion refuse the reserved storage namespace. Only the cleanup worker
can physically remove an object, using a durable tombstone after the upload
window and grace period have ended.
