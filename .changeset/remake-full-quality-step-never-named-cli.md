---
"@nodaro/cli": patch
---

`nodaro video-remake full-quality estimate` and `nodaro trends estimate`: a server that still answers a separate line for the step that makes a render larger has its credits shown in the engine's line (the 1080p render, else the video, else the job's own steps), in the text and in `--json`; the total is unchanged and the step is not named. "An earlier try's 1080p render is reused" is still said when it is. The reused render is read from the server's `renderReused` where it answers one, else from a render line of 0.
