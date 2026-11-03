---
"@nodaro/sdk": minor
---

`ImportRefusedError` carries a new code, `imports_blocked`: imports of links are blocked on the account, or the account is closed, under the deployment's repeat-infringer policy; the message says until when. `IMPORT_REFUSAL_CODES` includes it, so a 403 with that code from any link import (`media.downloadVideo`, `uploads.importUrl`, the audio imports) is an `ImportRefusedError`, where an older SDK answers a plain `ForbiddenError`.
