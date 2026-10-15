---
"@nodaro/sdk": minor
---

An image job's output now carries the image's pixel size: `width` and `height` of `imageUrl` as it is stored (what you download, EXIF orientation applied), and, beside `imageUrls` when a job made several images, `images` — one `{ url, width, height }` per image, in the same order. `NodeJobOutput` types all of them (and `imageUrls`), and the new `JobOutputImage` type names one entry. Present on image jobs completed after this release; older jobs, and sizes the server could not read, have none of them, so treat them as optional. Nothing to change to adopt it: upgrade, then read `output.width` / `output.height` (or `output.images`) from `nodes.runAndWait`, or cast `output_data` to `NodeJobOutput` after `jobs.get` / `jobs.getStatus`.
