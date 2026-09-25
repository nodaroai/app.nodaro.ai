---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Video Overlay: `client.media.videoOverlay(input)` (`POST /v1/video-overlay`) places 1–20 timed image layers over a video, and `nodaro media video-overlay <videoUrl> [layerUrls...]` exposes it (`--at <start[-end]>` per layer, `--preset`, `--corner`, `--layers-file`, `--aspect`, `--base-fit`, `--background-color`, `--watch`).
