---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

Extend Video runs Seedance as two providers, one per model: `seedance-2-5-extend` (Seedance 2.5, 4–30 s added) and `seedance-2-0-extend` (Seedance 2.0, 4–15 s added). Both are in `EXTEND_VIDEO_PROVIDERS` and in `MODEL_CATALOG` with their own durations, resolutions and price rows. The earlier single id `seedance-2-extend` is retired (`RETIRED_VIDEO_PROVIDERS`): `canonicalVideoProvider` maps it to `seedance-2-5-extend`, so a saved or sent `seedance-2-extend` keeps working and runs, and is priced, as Seedance 2.5. Code that names the literal `"seedance-2-extend"` as an `ExtendVideoProvider` no longer compiles: pass it through `canonicalVideoProvider` or use `seedance-2-5-extend`.

New in `@nodaro/shared/models`: `SeedanceExtendProvider` and `isSeedanceExtendProvider`. New in `@nodaro/shared/credits`: `seedanceExtendCreditId(provider, duration?, resolution?)`, the credit identifier a Seedance extend is priced at — one row per second added and resolution for each model (`seedance-2-5-extend:<N>s:<res>`, `seedance-2-0-extend:<N>s:<res>`) — and `seedanceExtendResolution(provider, resolution?)`, the resolution that row is priced at and the run renders at (the requested one when the model offers it, else 720p). `buildVideoCreditModelIdentifier` prices both Seedance extend providers, and the retired id, through it, so it never returns a bare, unpriced extend id. Seedance 2.0 Extend is no longer priced on the `seedance-2-extend:<tier>:<res>` length tiers. `DURATION_PRICED_PROVIDERS` and `RESOLUTION_DURATION_PRICING` no longer list `seedance-2-extend` (no price is read through those keys); `VIDEO_DURATION_TIERS["seedance-2-extend"]` stays, unread, beside the earlier rows it describes.

`@nodaro/prompts`: the prompt wizard's Extend Video capabilities list both Seedance providers.
