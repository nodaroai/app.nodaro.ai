---
"@nodaro/cli": minor
---

`nodaro edit podcast-pack` runs several podcast tools on one recording for one price, set by the recording's length: `--tool` picks each tool (repeat it, or comma-separate tools that take their defaults), `--tool <tool>=<json or file>` gives a tool its own settings, the recording flags are those of `edit tighten-episode`, and `--estimate` quotes the pack with nothing created or charged. It prints the pack's job, each tool's job and any tool that did not start. `nodaro edit podcast-pack-start <packJobId> <tool>` starts, free and once per tool, a tool the pack paid for that did not start.
