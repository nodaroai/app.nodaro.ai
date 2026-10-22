---
'@nodaro/cli': minor
---

`nodaro cast-swap full-quality estimate <jobId>` and `nodaro cast-swap full-quality run <jobId>` (Cloud edition): finish a draft run (a Cast Swap or trend run made as a draft) at Full Quality — the same take re-rendered at 1080p, as a new job. `estimate` only quotes it (free: "about N credits", the `castSwap` / `seedanceHd` parts, and until when the draft can be finished); `run` starts it (SPENDS CREDITS) and prints the job id, or the draft's existing Full Quality job when there already is one (nothing new is charged). `run --session <id>` files the result in a generation session; `--json` prints the answer as it came.
