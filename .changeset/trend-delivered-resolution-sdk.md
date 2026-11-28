---
"@nodaro/sdk": minor
---

Trend runs can be asked for by the size they are delivered at. `TrendDetail` gains `deliveredResolution?: true`: where it is set, `resolutions` are the sizes a run of the trend is delivered at on this deployment (the same sizes `videoRemake.styleChoice()` lists for the trend's engine choice, e.g. `["720p", "1080p", "4k"]`), and a run's `resolution` names the size the video comes back at. `TrendResolution` adds `"4k"`, accepted only on such a trend. A completed `TrendRun`'s `resolution` is the size its video was delivered at. `draft: true` stays the Nodaro Prism 480p take whatever `resolutions` lists. New refusal: 409 `resolution_unavailable` (the size is offered but cannot be made for this run right now). Without `deliveredResolution` everything reads as before.
