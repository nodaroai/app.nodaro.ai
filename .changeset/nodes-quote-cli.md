---
"@nodaro/cli": minor
---

`nodaro nodes quote <type> --param k=v …`: the price of a run before it starts, with the same inputs `nodes run` takes. Nothing is started and nothing is charged. It prints the credits the run holds, the expected charge when that is lower, and the quote's notes (`--json` prints the quote as it is). Works for every type the platform can quote, including `switchx` (Relight & Switch) and, on Nodaro Cloud, `edit-video-pro`.
