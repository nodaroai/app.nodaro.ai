---
"@nodaro/shared": minor
---

Seedance 2.5 Extend (`seedance-2-5-extend`) is charged per second of the video it sends the model (the source's last 10 seconds, or all of a shorter source) plus the seconds it adds, rounded up once, on three rate rows, one per resolution, each the price of two seconds: `seedance-2-5-extend:720p:per-2s`, `seedance-2-5-extend:480p:per-2s` and `seedance-2-5-extend:1080p:per-2s`.

- `tailExtendCreditId("seedance-2-5-extend", …)` and `buildVideoCreditModelIdentifier("seedance-2-5-extend" | "seedance-2-extend", …)` now return the whole-run quote id of the most a run of that length costs — the whole 10-second window sent: `seedance-2-5-extend:<resolution>:per-2s:<units>u`, units = (10 + seconds added) ÷ 2 (`seedance-2-5-extend:720p:per-2s:9u` for 8 seconds at 720p). The price lookups answer it at the rate row's current price, so a quote built on it is never below the charge. Seedance 2.0 Extend and Kling 4 Extend keep their per-length rows.
- New exports in `@nodaro/shared/credits`: `seedanceExtendFullWindowCreditId`, `seedanceExtendRateCreditId`, `isSeedanceExtendPricedBySecondsSent`, `isSeedanceExtendRateCreditId`, `SEEDANCE_EXTEND_SENT_PRICED_PROVIDER`, `SEEDANCE_EXTEND_CONTEXT_MAX_SEC`, `SEEDANCE_EXTEND_RATE_SECONDS`, `SEEDANCE_EXTEND_RATE_CREDIT_IDS` and the type `SentPricedSeedanceExtendProvider` — the rate rows and quote ids a client prices an extend with.
- The model-catalog price rows of Seedance 2.5 Extend list its default run (8 seconds added to a source of 10 seconds or more) at each resolution as whole-run quote ids, `seedance-2-5-extend:<resolution>:per-2s:9u`; `PriceVariant.identifier` may now be such an id (a rate's row × the units, as the price table prices it).
- The earlier per-length ids (`seedance-2-5-extend:<N>s:<resolution>`) price no run; they are priced at the most a run of that length costs, so a client still naming them never quotes below the charge.
