---
"@nodaro/cli": minor
---

`nodaro voice recast` takes `--v4 <indexes>` beside `--v3`: the named 1-based speakers are re-spoken on the newer Re-speak engine (any stability 0–1, `similarityBoost` honoured, each line generated with its neighbours as context). The same range and keep-slot checks as `--v3` apply, and an index named in both flags is refused. `--v3` is unchanged.
