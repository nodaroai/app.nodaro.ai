---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

`client.credits.history()` lists every movement of the balance, newest first — runs, purchases, grants, refunds, adjustments, expiries — with the balance after each one, the model, the settled charge and the job on a usage row, filters (`kind`, `model`, `from`, `to`, `q`) and a cursor; `client.credits.exportHistory()` is the same as a CSV file. The CLI gains `nodaro billing history` (`--csv` for the file).
