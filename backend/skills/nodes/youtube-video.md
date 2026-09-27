---
node_type: youtube-video
generated_at: 2026-09-27T12:51:22.269Z
generated_from: c607aa02c
---

# Video URL

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `youtube-video`
**Category:** input
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Default data:**
```json
{
  "label": "Video URL",
  "youtubeUrl": "",
  "videoId": "",
  "title": "",
  "thumbnailUrl": ""
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

A SOURCE node: it holds a video link and emits a video. `youtubeUrl` takes any
supported link (YouTube, TikTok, Instagram, Facebook, X — the field name predates
the other hosts) or a direct video file url (`.mp4`, `.webm`, `.mov`, `.avi`).

In the EDITOR the node downloads the link by itself: a short clip the moment the
link is pasted, a long YouTube video once the person picks a part or asks for all
of it. The downloaded file is stored in `downloadedVideoUrl` (bound to its link
by `downloadedFromUrl`), and that file is what the `video` handle emits.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Nothing downloads at run time on the server.** The node is a source node — it
  is read, never executed. A workflow written through the API / MCP carries only
  the link, so its `video` handle emits the PAGE address and every video
  consumer fails on it. To feed a social video into an API-built workflow, import
  it first with `POST /v1/download-video` (follow
  `GET /v1/download-video/progress/:id` to the `videoUrl`) and put that file url
  in an `upload-video` node — or in this node's `youtubeUrl`: a direct file link
  passes through untouched.
- **Never write `downloadedVideoUrl` without `downloadedFromUrl` set to the same
  link as `youtubeUrl`**, and never change `youtubeUrl` while leaving the two
  behind. A file whose `downloadedFromUrl` differs from the current link is
  ignored (the node falls back to the link) — that is the guard against emitting
  the previous link's video.
- `downloadMode`, `sectionStartSec` / `sectionEndSec`, `downloadStatus` and
  `downloadId` are RECORDS of what the editor did, never instructions. Writing
  `downloadStatus: "downloading"` or `downloadMode: "whole"` starts nothing: the
  editor re-attaches only to a download the server still knows by an id bound to
  the same link (`downloadIdUrl`), and otherwise shows the node as not
  downloaded. Leave all of them out when authoring a node.
- The `in` handle is not an executable input: a URL wired into it is not
  downloaded at run time.
- Opening the workflow in the editor and pressing Run fetches any link that feeds
  the run first; a long YouTube video with no part chosen stops the run with a
  message instead of being downloaded whole.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "youtube-video-1",
  "type": "youtube-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Video URL",
    "youtubeUrl": "",
    "videoId": "",
    "title": "",
    "thumbnailUrl": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
