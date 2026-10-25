---
"@nodaro/cli": minor
---

The Trash: `nodaro trash [--project <id|none>] [--tool <tool>] [--type <types>]` lists it; `nodaro sessions remove` now moves an item to the session's Trash (`--forever` deletes a removed one for good), `nodaro sessions restore <id> <jobId>` brings it back, `nodaro sessions move <id> --from <sessionId> --jobs <ids>` moves items between sessions, and `nodaro sessions items --removed` lists a session's Trash; `nodaro jobs delete <id>` moves a job to the Trash for 30 days (`--forever` for one already there), `nodaro jobs restore <id>` brings it back, and `nodaro jobs list` takes `--project <id|none>`, `--in-session` / `--no-in-session` (General) and `--with-sessions`. `nodaro sessions list --project none` lists the sessions with no project.
