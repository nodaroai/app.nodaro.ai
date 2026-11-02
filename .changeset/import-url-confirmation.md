---
"@nodaro/sdk": minor
---

`uploads.importUrl(url, { confirmationId })` passes the content rights confirmation (`contentRights.confirm({ url })`) with a picture imported from a link. A `403` refusing an import of a link (`media.downloadVideo`, `uploads.importUrl`, the audio imports) is now an `ImportRefusedError` (a `ForbiddenError`) whose `code` is the server's own: `import_source_disabled` for a site an administrator disabled, or a `rights_confirmation_*` code saying what is wrong with the confirmation (`IMPORT_REFUSAL_CODES` lists them). Before, such a 403 was a plain `ForbiddenError` with `code: "forbidden"`.
