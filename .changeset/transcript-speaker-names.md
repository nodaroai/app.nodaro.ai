---
"@nodaro/shared": minor
---

`Transcript` gains an optional `speakerNames` field: the raw speaker label → display name map a renamed transcript carries (Camera Switch publishes it on its named transcript), so a later node can still find a speaker's original label. `normalizeTranscript` keeps it (entries whose label and name are both non-empty strings; the field is left out when none is left), and `remapTranscriptThroughEdl` carries it through.
