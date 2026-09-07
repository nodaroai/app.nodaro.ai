---
"@nodaro/shared": minor
---

Remove the studio production wire and op types; the studio codec now lives in a private package.

`studio-production-wire.ts` and `studio-production-ops.ts` typed the envelope and
the write protocol of a route family that is no longer served from this repo.
They shipped in 2.24.0 and nothing consumes them — the SDK never referenced
either module, and no other client app's types were ever declared here.
