---
"@nodaro/sdk": minor
"@nodaro/cli": patch
---

- `client.nodes.run("video-depth", …)` / `runAndWait("video-depth", …)` are typed: `VideoDepthParams` (`videoUrl`, `provider?`, `modelSize?`, `colormap?`, `resolution?`, `sideBySide?`), and the `VideoDepthProvider` / `VideoDepthModelSize` / `VideoDepthColormap` / `VideoDepthResolution` vocabularies are re-exported from `@nodaro/shared`.
- CLI: `nodaro nodes run --help` shows a `video-depth` example.
