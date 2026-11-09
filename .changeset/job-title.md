---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

A name of the person's own on any result: `client.jobs.rename(id, title)`.

- `jobs.rename(id, title | null)` (`PATCH /v1/jobs/:id`): name one of your jobs — "Wedding toast, final" on a picture, a clip, a track or a speech take — or clear the name with `null` (or `""`). Trimmed; one line of plain text, 1–120 characters, any language (`validation_error` otherwise). The owner only (anyone else's job is `NotFoundError`); free; any job type and status, the Trash included; nothing else about the job changes. Answers `{ data: { jobId, title } }` (`RenameJobResult`). OAuth apps need `assets:write`. Named `rename`, like `rate`, rather than a general `update`: the route takes this one field.
- `Job.title` (`string | null`, `null` until named) wherever a job is returned — `jobs.get`, `jobs.list`, a session's items (`SessionItem.job`), `client.trash.list()` — and the same name as `title` on `GalleryItem` (public, beside the prompt) and on `LibraryAsset` (the name of the job that made the file; not its `filename`). Absent from a server older than this release. Webhook job payloads carry it too.
- CLI: `nodaro jobs rename <id> <title>` and `nodaro jobs rename <id> --clear`.
