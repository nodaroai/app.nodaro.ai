---
"@nodaro/cli": minor
---

`nodaro nodes run` gains `--reference-task-type <auto|reference|edit|extend>` for `generate-video` and `text-to-video`: it sets `referenceTaskType` on the body (what the request's reference media is for), checked against `SEEDANCE_REFERENCE_TASK_TYPES` before the API is called. It wins over the same key in `--param` / `--params-file`, and `--param referenceTaskType=…` still works. Any other node type refuses the flag, `video-to-video` included, where an edit always runs as an edit.
