---
"@nodaro/cli": minor
---

`nodaro apps run-retry <slug> <runId> [--dry-run] [--app-version <n>] [--watch] [--json]` retries a failed app run from where it stopped: only the steps the run did not complete run, and only those are charged. `--dry-run` lists the steps it would run and what it would charge, and starts nothing. When the Retry is refused because the app changed since the run, the CLI prints both ways on: start the run over with `nodaro apps run`, or continue on the run's own version with `--app-version`.
