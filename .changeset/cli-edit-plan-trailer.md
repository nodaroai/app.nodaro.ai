---
"@nodaro/cli": minor
---

`nodaro edit plan --mode` accepts `trailer`. The check now reads `EDIT_PLAN_MODES` from `@nodaro/shared`, so the CLI accepts exactly the modes the SDK and MCP accept, and the `--mode` help lists them from the same source.
