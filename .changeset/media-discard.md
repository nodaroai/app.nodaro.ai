---
"@nodaro/sdk": minor
---

`client.media.discard({ url })` (`POST /v1/media/discard`) throws away a file you just made and no longer need — a link download replaced before use, a cut superseded by a newer one, a picture imported then cancelled. Not a general delete: the file goes only when it is your own, was made by `downloadVideo`, `process` or a URL import, is under 24 hours old, and no job of yours uses it (output or input); otherwise 409 `not_discardable` and nothing is touched. `discarded: false` = nothing of yours at that address. New type `MediaDiscardResult`. `downloadVideo` gains `exactSection` (cut the section at exactly its range). `media.process(input, { timeoutMs, signal })` takes per-call options, so a client can wait out a long cut (the platform allows 300 s); the core's request options gain `timeoutMs` for that.
