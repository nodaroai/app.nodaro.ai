---
"@nodaro/sdk": minor
---

Add `client.jobs.fromUpload(params)`: record an image edited in the browser (stored with `client.uploads.upload`) as a completed, private, free `image-edit` job linked to the job or upload it was made from, so it can be rated, favorited, listed and filed into a session like any image job. One upload is one job. Add `client.uploads.uploadJson(json)` to store an editor's design state and pass its url as `editStateUrl`. New types: `JobFromUploadParams`, `UploadJsonResult`.
