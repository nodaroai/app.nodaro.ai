---
"@nodaro/shared": minor
---

Speech models declare whether they condition on neighbouring text: `TtsCapabilities.stitching` and `ttsSupportsStitching(provider)`. ElevenLabs v4, Turbo v2.5 and Multilingual v2 do; v3 does not (it rejects the fields). The Text to Speech node's `previousText` and `nextText` fields join its mappable fields, so a wired text node can supply what is spoken before and after a clip.

`TTS_NEIGHBOUR_TEXT_MAX_CHARS` (1,000) and `normalizeTtsNeighbourText` are exported too: the cap and the trim rule are already public (documented on the API), and the editor's run must apply the same rule the server does, so a request the editor sends is one the route accepts.
