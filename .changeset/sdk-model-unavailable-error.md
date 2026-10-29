---
"@nodaro/sdk": minor
---

New `ModelUnavailableError` (a `ForbiddenError`): a 403 refusing the MODEL rather than the caller — a model this deployment does not offer (`code: "model_not_available"`) or one an admin switched off (`code: "model_disabled"`). It is answered by the credit guard before any credits are held, and `code` keeps the server's own code, so a client can tell it from every other 403 and show its own sentence without reading the English message. `MODEL_UNAVAILABLE_CODES` lists the two codes. A 403 with `insufficient_scope`, any other code or none stays a plain `ForbiddenError` with `code: "forbidden"`.

A behaviour change for code that compared `err.code === "forbidden"` to mean "any 403": check `err instanceof ForbiddenError` instead, which still catches both.
