---
"@nodaro/sdk": minor
---

`client.castSwap` (also `@nodaro/sdk/cast-swap`): `run(params, { idempotencyKey }?)` starts a Cast Swap job (`POST /v1/cast-swap`, 202 `{ jobId }`; `idempotencyKey` is sent as the `Idempotency-Key` header, 8–200 characters or the server answers 400, and a repeat with the same key within the ~10 s dedup window answers 200 `{ jobId, deduped: true }` with an `X-Dedup-Hit` header) that replaces the people and/or location in a short video, and `estimate(params)` quotes it first (`POST /v1/cast-swap/estimate`). Types: `CastSwapParams`, `CastSwapRunOptions`, `CastSwapRole` (`CastSwapPersonRole` / `CastSwapLocationRole`), `CastSwapTraitSource`, `CastSwapEstimate`. Refusals: 400 (`validation_error`, `raw_reference_token`, `invalid_role_mention`, `unsafe_url`, `video_unreadable`, `clip_out_of_range`, `preview_out_of_range`), 401, 402, 404, 422 `job_blocked`, 503 `host_too_old` / `estimate_unavailable`. Cloud edition only.
