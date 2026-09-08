# Retained video snapshots

A compatible integration can retain the bytes and original submission metadata
of an approved, completed video job. The caller authorizes workflow editing;
new capture also requires the job to belong to that caller and workflow. Capture
fetches public HTTP bytes through the normal network checks, validates a bounded
MP4 or WebM file, and runs the upload policy before reserving storage. Files are
kept without transcoding, with their SHA-256, size, dimensions, and duration.

Retained videos belong to the workflow. Deleting a gallery entry, job, or
capturing collaborator does not delete a surviving workflow's snapshots. Ordinary
single and batch media deletion refuse the retained-video namespace with
`409 retained_video_in_use`. Deleting a workflow with active jobs using retained
media is refused. After workflow deletion, durable cleanup tasks remove bytes and
release storage usage once. Failed or interrupted captures also enter cleanup.

Retention uses the deployment's existing storage quota. Identical captures for
the same billing identity and workflow share a reservation. Copying to another
workflow verifies source bytes and creates independent destination storage.
Immutable copy records distinguish the original job from each copy and preserve
provenance through copies of copies and source deletion. No fake generation job,
acceptance, or generation charge is created by copying. Missing or changed source
bytes refuse the operation.

The host exposes these operations to trusted integrations through optional
storage toolkit methods. They are not public endpoints and do not authorize a
caller by themselves. Integrations must validate mapped creative context and
source/destination access before recording a copy. Studio's linked-copy routes
must explicitly consume this capability before advertising durable video copies.

The `retained-video` upload-policy lane receives captured bytes before storage
reservation. Videos have a 500 MiB capture limit; container probing and uploads
have time limits. Playlist and network container inputs are refused. Reads verify
stored bytes against the retained hash, including after copying.
