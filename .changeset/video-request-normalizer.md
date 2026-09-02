---
"@nodaro/shared": minor
---

Two new video-lane helpers that make the tier we RESERVE the tier we SEND.

`normalizeVideoRequestParams(modelId, { aspectRatio, resolution })` — the video
lane's limited catalog snap. Unlike `normalizeModelInput` it never drops a lever
(on the video lane `resolution` is a pricing input, and dropping it would
under-reserve), it passes `Auto` / `adaptive` through for the provider adapter to
resolve, and it snaps to the NEAREST supported option rather than the first — so
the route, the orchestrator, the provider adapters and the MCP normalizer all
give one answer. Case is canonicalised to the catalog's spelling, which the
credit identifiers key on.

`pricedVideoSelection({ provider, resolution, duration })` — what the credit
identifier actually PRICES for a request: the resolution band it assumes when
the request omits one (only where the platform declares that band as the
provider's own default), and the seeded LTX duration tier it snaps onto. Callers
carry those to the wire so a reservation can never be made at one resolution and
rendered at another.

Both are pure, so every credit-identifier site and the payload build can call
them and cannot disagree.

`ModelCatalogEntry.unlistedResolutionRendersAs` lets a model declare that it
COLLAPSES an unrecognised resolution to a fixed default (MiniMax H3 → 2K, Wan
3.0 → 720p) rather than honouring the nearest band. For those models the nearest
band is wrong in the expensive direction — snapping a stale "720p" to H3's cheap
768P would send a value the provider ignores and bill the cheap tier against a 2K
render. A guard test pins each declaration to what the provider's own normalizer
returns.
