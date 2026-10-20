---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Tighten Episode can follow faces: `edit.tightenEpisode` / `edit.estimateTightenEpisode` take `framingSource` (`"auto"`, `"static"` or `"tracking"`) with a framing, and `nodaro edit tighten-episode` takes `--framing-source <source>` with `--framing`. `"static"` (the default) splits the frame evenly by speaker; `"tracking"` follows faces with Speaker Frames (charged per started block of 1,000 sampled frames; refused where Speaker Frames is not available to you); `"auto"` follows faces while Speaker Frames is available to you, else the even split.
