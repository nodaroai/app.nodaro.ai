---
"@nodaro/cli": minor
---

`nodaro models cost <ids…>`: the credits each identifier is charged, from `POST /v1/credits/model-costs` — a model id, a credit id, or a metered LLM price key (`<feature>:<model>[:direct]`). A metered LLM call is charged for the tokens it uses, so its figure is an estimate and prints as `~N`; an identifier the server cannot price prints `-` with the reason. `--json` passes the answer through whole (`estimates`, `errorCodes` included).
