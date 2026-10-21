---
'@nodaro/cli': minor
---

`nodaro trends` (Cloud edition): `list` (`--search`, `--tag`, `--favorites`, `--locale`, `--limit`, `--cursor`), `get <slug>`, `estimate <slug>` (free quote: "about N credits", and the hold when it differs), `run <slug>` (SPENDS CREDITS; prints the job id; `--session`, `--idempotency-key`), `runs` (`--trend`), `favorite <slug>` and `unfavorite <slug>`. `estimate` and `run` take repeatable `--slot key=url[,url]` (a slot's pictures) and `--choice key.chip=new|original` (e.g. `person.outfit=original`), plus `--example <n>`, `--details <text>`, `--preview`, `--resolution 480p|720p|1080p` and `--no-draft`. A slot key is checked locally (1–32 of a–z, 0–9 and `_`, never `__proto__`) before anything is sent; `--slot` pictures are split only where a new http(s) URL starts, so a URL holding commas stays whole; `--limit` is checked locally (1–60). `--session` is accepted but not yet applied: trend runs are not filed into sessions yet.
