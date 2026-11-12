---
"@nodaro/cli": minor
---

`nodaro media split-layers <imageUrl>` splits one image into a base picture and separate layers, each element on its own transparent PNG (`client.media.splitIntoLayers`). `--max-layers <1-99>` (default 9) caps the layers, `--size 1K|1.5K|2K|auto` (default 1K) sets each image's pixel budget, and `--prompt <text>` names what to separate; `--watch`, `--poll-interval` and `--json` work as on the other media commands. A bad flag is refused before anything is sent.
