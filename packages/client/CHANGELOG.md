# @nodaro/sdk

## 2.43.0

### Minor Changes

- fea87e4: `client.jobs.list({ source })` filters your jobs by the surface that created them (`"mcp"`, `"cli"`, `"sdk"`, `"web"`, …), one value or a list; the `JobSource` type names them.

## 2.42.0

### Minor Changes

- 7621ecf: Trends: a trend can offer only some chips on a slot. `TrendDetailSlot.chips` (always present) lists the chips you may set on that slot, in its kind's order (`[]` = none), and `defaults` covers only those; the new `TrendChipKey` type names a chip. A chip of the slot's kind that it does not list is fixed by the trend, and `estimate()` / `run()` refuse sending it with `400 chip_not_offered` (`err.details` is `{ slot, chip }`). The CLI's `--choice` help says to send only the chips `trends get` lists.

## 2.41.0

### Minor Changes

- 9ab753b: `CastSwapEstimate` gains the charge a Cast Swap run is expected to come to: `expectedCredits` (the hold with the video model's expected charge in place of its hold; never above `totalCredits`) and `breakdown.seedanceExpected` (that expected video-model charge, which takes `breakdown.seedance`'s place in `expectedCredits`). `totalCredits` is now documented as what is held when the run starts; the run is charged what it actually costs. Both new fields are optional: an older Cast Swap engine leaves them out, so read `totalCredits` then.

## 2.40.0

### Minor Changes

- b9864da: `GenerateVideoParams` and `TextToVideoParams` type `keepOriginalSound` (Kling 4.0: keep a reference video's own sound), and the `characterReferences` docs cover Kling 4.0's named subjects (up to 7, 2–4 images each through `bodyImageUrl` / the new `extraImageUrls`).

### Patch Changes

- Updated dependencies [b9864da]
  - @nodaro/shared@3.40.0
  - @nodaro/prompts@1.41.0

## 2.39.0

### Minor Changes

- 37ac7be: Cast Swap face masking leaves 10 % margins at the left and right of the frame by default: a face centred there (someone walking in at the edge) is not masked. `CAST_SWAP_FACE_MASKING_DEFAULTS` gains `zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }` and names the default fill, `fill: "blur"`. The SDK's `CastSwapFaceMasking.zone` documents that default and now also takes `null`, which, like all four margins 0, means no margins.

### Patch Changes

- Updated dependencies [37ac7be]
  - @nodaro/shared@3.39.0

## 2.38.0

### Minor Changes

- d20adcd: Studio operation receipts type `detail` and the ops answers type `warningDetails`: the same lines as data (`StudioOpsText`, `{ template, vars }`), for a client that words them in the person's language. `summary` and `warnings` stay the English fallback.

## 2.37.0

### Minor Changes

- 27048fa: Cast Swap (`client.castSwap`) finishes a draft at Full Quality: `fullQualityEstimate(jobId)` (`POST /v1/cast-swap/:jobId/full-quality/estimate`, free) returns `CastSwapFullQualityEstimate` (`{ totalCredits, breakdown: { castSwap, seedanceHd }, availableUntil }`; `seedanceHd` is 0 when an earlier try's 1080p render is reused), and `fullQuality(jobId, { sessionId? })` (`POST /v1/cast-swap/:jobId/full-quality`, spends credits) re-renders the draft's take at 1080p as a new job, answering `{ jobId }`, or `{ jobId, existing: true }` when this draft's Full Quality is already running or done. `jobId` is a finished draft run (a Cast Swap or trend run made as a draft), within 7 days of completing. Refusal codes are typed as `CastSwapFullQualityRefusalCode` (`unauthorized`, `not_found`, `not_completed`, `not_a_draft`, `draft_expired`, `full_quality_pending`, `full_quality_unavailable`, `insufficient_credits` and the workspace caps, `job_blocked`, `job_read_failed`, `estimate_unavailable`, `host_too_old`); `full_quality_pending` (409, `details.retryable: true`) is not final — an earlier try's 1080p render of the draft is being reviewed or has not started yet, so try again later — while `full_quality_unavailable` is final. `CastSwapParams` gains `references` (`CastSwapReference[]`, at most 5): fixed references, each 1–3 images of one thing plus the `line` that names it (`{image}` in the line stands for its first image), sent as given and counted toward the 30 images.

  Trends (`client.trends`): `TrendRunRequest` gains `origin` — on `run()`, the client app's slug (e.g. `"tools"`), stored on the run's job as `input_data.origin` so `jobs.list({ origin })` finds it.

- 45a4c2d: Errors keep more of the server's answer. Every `NodaroError` now carries `details`: the error envelope's fields other than `code` and `message`, as sent (a trend refusal's `slot`, a publish refusal's `reasons`, a validation error's `issues`, …), so a caller can act on them without an SDK release.

  A 402 keeps its own code (a behaviour change). `InsufficientCreditsError.code` now carries the server's code — the 402 envelope's `error.code` — instead of always `insufficient_credits` (for example `free_video_limit`, `insufficient_app_credits`), and a spending cap someone else set — `budget_exceeded` (a workspace's budget), `member_cap_exceeded` (your cap in a workspace), `user_allowance_exceeded` (a deployment's per-user allowance) — is the new `CreditCapExceededError`, a subclass of `InsufficientCreditsError` (so existing `instanceof` catches still catch it). `CREDIT_CAP_CODES` and the `CreditCapCode` type are exported. An allowance's `remaining` is read as `available`. Code that compared `err.code === "insufficient_credits"` to mean "any 402" should check `err instanceof InsufficientCreditsError` instead.

- 45a4c2d: `client.trends` gains `getRun(jobId)` (`GET /v1/trends/runs/:jobId`: one of your trend runs, in the same shape as `runs()`; a job that is not your own trend run is a `NotFoundError`) and `tags({ locale? })` (`GET /v1/trends/tags`: the tags in use on published trends, most used first, as `TrendTag { tag, label, count }` with the label in your language). A Full Quality version of a draft is now listed as a run of its own: `TrendRun` gains `fullQualityOf` (the draft it was made from, else `null`); only the newest Full Quality try per draft is listed (running, done, or its last failure; an older failed or cancelled try is left out of `runs()`, and `getRun()` still reads it by its id); a draft's `fullQuality` becomes a pointer only to that newest try, `{ jobId, status } | null` (its `videoUrl` is gone — read the upgrade's video from its own run). `"tags"` joins `"runs"` as a slug the slug methods refuse before any request.

## 2.36.0

### Minor Changes

- e6b7cbb: `CastSwapParams` takes `faceMasking?: CastSwapFaceMasking` (`POST /v1/cast-swap` and `/v1/cast-swap/estimate`): cover the faces in the source clip before the video model sees it, keeping their movement and lip timing. `mode` is `"off"` (as if left out), `"always"` (masked before the first attempt) or `"auto"` (retried once with the faces masked, only if the video model refuses the source clip); optional `fill` (`"blur"`, the default, or `"depth"`), `minFaceHeightPct` (default 15), `maxFaceHeightPct` (default 0 = no limit), `zone` (`CastSwapFaceMaskingZone`: frame margins, 0–49 % each, where a face is not masked), `blurStrengthPct` (default 2) and `threshold` (default 0.5). `CastSwapEstimate` gains `breakdown.masking?` (in `totalCredits` with `"always"`) and `maskingCredits?` (`"auto"`: charged only if the masked retry runs; not in `totalCredits`). With `"auto"`, `breakdown.masking` is also present (equal to `maskingCredits`) but not added to `totalCredits`. A completed job's output carries `faceMasking: { applied, reason }`.
- a62ed2b: Cast Swap (`client.castSwap`) takes pet and product roles: `CastSwapPetRole` (`{ kind: "pet", name, images, body?, coat? }`) and `CastSwapProductRole` (`{ kind: "product", name, images, shape?, finish? }`), up to 3 of each beside 6 people and 1 location, with at most 30 images in all. `CastSwapParams` gains `resolution` (`"480p"` default, `"720p"`, `"1080p"`), `draft` (on by default at 480p, refused above it) and `prepareReferences` (default `true`: each person, pet and product's images are first made into one clean reference picture, for extra credits and about a minute; `false` uses your images as they are); `quality` is deprecated in favor of `resolution` + `draft`. `CastSwapEstimate.breakdown` gains `references`, the reference-preparation cost (0 when it is off or there is nothing to prepare), and `totalCredits` includes it.
- b64cf61: `CastSwapParams` takes `prePrompt?: string` (`POST /v1/cast-swap` and `/v1/cast-swap/estimate`): your own words placed at the start of the prompt, before the role instructions, at most 4,000 characters. Mention a role as `{role:N}`, as in `postPrompt`; the same refusals apply (`invalid_role_mention`, `raw_reference_token`). Like `postPrompt`, a `prePrompt` alone is enough to run (no role needs images).
- b64cf61: Every Cast Swap role type (`CastSwapPersonRole`, `CastSwapLocationRole`, `CastSwapPetRole`, `CastSwapProductRole`) takes the preview-only settings of the new `CastSwapRolePreviewSettings`: `previewName?: string`, the name used instead of `name` when `preview` is `true`, and `inPreview?: boolean` (default `true`), where `false` leaves the role out of the preview — its images are not sent, prepared or charged. A full run ignores both. A preview with every role left out (always, even with a `prePrompt` or `postPrompt`), or with no role kept in it that has images and no `prePrompt` or `postPrompt`, answers 400 `no_roles_in_preview`. A prompt that would build too long now answers 400 `prompt_too_long` before anything is charged.
- 6ca1576: `JobErrorHint` gains a third arm, `CreditsHint` (`{ kind: "credits", code }`, exported): a job that ran out of credits partway — a step that reserves its own credits, such as the video a Cast Swap or trend run dispatches, was refused — carries it on `error_hint`. The job is refunded; `code` is the refusal's code (`insufficient_credits`, or a plan or workspace cap such as `free_video_limit`). A trend run's `error.code` is then `credits`. Code that narrows `JobErrorHint` with a two-way `if`/`else` should check `kind` explicitly.
- a7b7f73: `JobErrorHint` gains a fourth arm, `InputRefusedHint` (`{ kind: "input-refused", subject: "input_video" }`, exported): the provider refused the job's input video without naming a content-policy class. `SafetyBlockHint` gains an optional `subject: "input_video"`, present when a content-policy block (for example `copyright`) was about the input video rather than the prompt, a reference image or the output. Either way the fix is a different clip. Code that narrows `JobErrorHint` with an exhaustive `if`/`else` should check `kind` explicitly.
- da72776: `credits.modelCosts()` results carry the metered LLM estimates: `ModelCostsResult.estimates?: string[]` lists the identifiers whose figure is an estimate (show `~N`), and `ModelCostsResult.errorCodes?` says why an identifier in `errors` has no price (`llm_model_unpriced`). New `ModelCostResult` type for `GET /v1/credits/model-cost` (`estimate?: true`). Both fields are omitted for a batch of fixed-price identifiers, which answers exactly as before.
- da72776: Apps, templates and tutorials carry `estimatedCreditsIsEstimate?: true` when the listed price holds a metered LLM call's estimate (show it `~N`), and a use-case estimate (`UseCaseEstimate`) carries `estimate?: true` when a step is one.
- da72776: `NodeDescriptor.estimate?: true` (`nodes.list()` / `nodes.get()`): a metered LLM node's `creditCost` is its default model's typical-call estimate — charged its actual usage after the run, so show it `~N`. Absent for a fixed price.
- 23af759: `TextToVideoParams` takes `contentPolicyRewrite?: boolean` (`POST /v1/text-to-video`). Absent or `true` keeps today's behaviour; `false` = a copyright refusal fails the job instead of retrying once with a reworded prompt.
- e6b7cbb: `client.trends`: `TrendRunRequest.previewJobId?` (a uuid) — on a full run, the `jobId` of your own completed preview run of the same trend. When that preview showed the clip needs its faces masked, the full run masks them from the start (and `estimate()` prices it that way); any other job is ignored without an error. `TrendEstimate.maskingCredits?`: on a trend that masks faces only when needed, the credits charged on top if the video model refuses the clip and the run is retried with the faces masked. It is not part of `expectedCredits` or `holdCredits`, and `breakdown.masking`, listed beside it, is not either.
- 71f379d: `client.trends` (also `@nodaro/sdk/trends`): browse the published trend catalog and run a trend with your own pictures. `list(params?)` (`GET /v1/trends`; `q`, `tag`, `favorites: true`, `locale`, `cursor`, `limit` 1–60) and `runs(params?)` (`GET /v1/trends/runs`; `trend`, `cursor`, `limit`) return `{ data, next }` pages; `get(slug, { locale }?)` returns a `TrendDetail`; `estimate(slug, request)` returns `{ expectedCredits, holdCredits, breakdown }` and spends nothing; `run(slug, request, { idempotencyKey }?)` starts a run (202) and returns `{ jobId }` (the key is sent as the `Idempotency-Key` header); `favorite(slug)` / `unfavorite(slug)` (`PUT` / `DELETE /v1/trends/:slug/favorite`, 204). Types: `TrendCard`, `TrendDetail`, `TrendDetailSlot`, `TrendExample`, `TrendRunRequest`, `TrendRunSlot`, `TrendChips`, `TrendChoice`, `TrendSlotKind`, `TrendResolution`, `TrendEstimate`, `TrendRunOptions`, `TrendRun`, `TrendRunDisplaySlot`, `ListTrendsParams`, `ListTrendRunsParams`, `TrendPage`. Refusals: 400 (`validation_error`, `missing_slot`, `unknown_slot`, `invalid_choice`, `example_out_of_range`, `preview_unavailable`, `invalid_slot_mention`, `prompt_too_long`; slot errors carry `slot`), 401, 404 `not_found`, 502 `engine_error`, 503 `engine_unsupported` / `trend_unavailable`, 503 `not_available` (no trend catalog on this server yet). `estimate` / `run` answer the video engine's refusals with the trend routes' own codes and fixed text, never the engine's message or `issues`: 400 `trend_run_rejected` (or `clip_out_of_range`, `preview_out_of_range`, `video_unreadable`, `unsafe_url`, `raw_reference_token`), 402 as given, 413 `storage_limit_exceeded`, 422 `job_blocked`, 429 `rate_limited`, 503 `engine_unsupported` / `estimate_unavailable`, else 502 `engine_error`. `"runs"` is never a slug: `get` / `estimate` / `run` / `favorite` / `unfavorite` throw a `TypeError` for it before any request. `sessionId` and `projectId` are accepted but not yet applied (trend runs are not filed into sessions or projects yet). Cloud edition only.

### Patch Changes

- da72776: `client.jobs.cancel(id)`: `CancelJobResult` now types the `inFlight?: boolean` the server already returns. Its JSDoc (and `cancelOnAbort`'s) states how a metered LLM job is cancelled. If its call has started, the cancel answers `{ success: true, cancelled: 0, inFlight: true }`, and the job finishes and is charged only what it used. If it is stopped before its call starts, it is refunded, except for what an earlier attempt of the same job already used (a retry after a billed attempt), which is charged. A synchronous metered LLM request cancelled before its call is sent answers `409 job_cancelled`; one whose call start cannot be recorded answers `503 job_start_failed`. Neither is charged. Both arrive as a `NodaroError` with that `code`.
- da72776: `RenderFinalQuote.estimatedCreditsIsEstimate?: true` (`workflows.estimateRenderFinal()`): present when the quoted run executes an LLM node, which is charged its actual usage after the run — show the figure `~N`. The prompt helper's `advancedMode` documentation now states how a direct-lane call is billed per model (its actual usage at the vendor's direct rate), and the one-rung bump only where the server prices LLM calls by tier.
- 5730599: Mask Composite takes `fill`: `"video"` (the default — the foreground, as before), `"pixelate"` (the background itself in blocks of `pixelSizePct` % of the frame width, 0.2–10, default 1.25) or `"blur"` (the background blurred, gaussian sigma `blurStrengthPct` % of the frame width, 0.1–5, default 2) — both relative, so a setting looks the same at any resolution. Pixelate and blur take no foreground: `MaskCompositeRequest.foregroundUrl` is now optional (required for the video fill), the result follows and is priced on the background, and the result always carries the background's sound (`audioSource` is ignored for these fills). `@nodaro/shared` adds `MASK_COMPOSITE_FILLS`, the `PIXEL_SIZE_PCT_*` / `BLUR_STRENGTH_PCT_*` bounds, the new defaults and settings fields, and `maskCompositeFillOf` / `maskCompositeUsesForeground` / `maskCompositeLeadHandle` / `maskCompositeEffectiveAudioSource`. `nodaro media mask-composite` gains `--fill`, `--pixel-size-pct` and `--blur-strength-pct`; with `--fill pixelate|blur` it takes `<backgroundUrl> <maskUrl>`.
- 23af759: Mask Composite takes `opacity` (0–1, default 1): how strongly the foreground covers the background inside the mask — inside it the result is `opacity × foreground + (1 − opacity) × background`. `MASK_COMPOSITE_BOUNDS` gains `OPACITY_MIN` / `OPACITY_MAX`, `MASK_COMPOSITE_DEFAULTS` and `MaskCompositeSettings` gain `opacity`, and `resolveMaskCompositeSettings` clamps it. `client.media.maskComposite` documents the field (its `MaskCompositeRequest` carries it).
- 5730599: Video Mask takes `holdLastMask` (default false): frames where the subject is lost — a mask covering under 0.002 % of the picture (`VIDEO_MASK_LIMITS.HOLD_EMPTY_BELOW_FRACTION`) — repeat the most recent non-empty mask; frames before the first detection stay empty, and the frame count, rate and size are unchanged. `VIDEO_MASK_DEFAULTS` and `VideoMaskRequest` gain the field; the job output reports `heldFrames` when it is on. `nodaro media video-mask` gains `--hold-last-mask`.

  Video Mask also takes `minSubjectHeightPct` (0–100, default 0 = off): every connected region (8-connected) whose bounding box is shorter than that % of the frame height is dropped from each frame, before `holdLastMask` — so a frame left with only small regions is held from the last frame with a big subject. `VIDEO_MASK_LIMITS` gains `MIN_SUBJECT_HEIGHT_PCT_MIN` / `MAX`; the job output reports `droppedRegions` when it is on. `nodaro media video-mask` gains `--min-subject-height <pct>`.

  Video Mask also takes `maxSubjectHeightPct` (0–100, default 0 = off), the mirror of the minimum: regions TALLER than that % of the frame height are dropped, in the same pass and before `holdLastMask`. With both set a region is kept when min ≤ height ≤ max; min > max is refused (400). `VIDEO_MASK_LIMITS` gains `MAX_SUBJECT_HEIGHT_PCT_MIN` / `MAX`. `nodaro media video-mask` gains `--max-subject-height <pct>`.

- a7b7f73: `client.media.videoMask`: the job's output now carries `kept` (boolean) — whether any region is left on any frame after the size and zone filters (false only for an empty mask). Read it rather than `coverage`, which is rounded to 4 decimals, so a mask of a few pixels reads 0 there.
- a7b7f73: Video Mask `zone` and `perShot`, on every surface.

  - `@nodaro/shared`: `VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN` / `ZONE_MARGIN_PCT_MAX` (0–49 % a side), `VIDEO_MASK_DEFAULTS.zone` (`null`, off), `VIDEO_MASK_DEFAULTS.perShot` (`false`, off), the `VideoMaskZone` type (`{ leftPct, rightPct, topPct, bottomPct }`) and `resolveVideoMaskZone`, which reads a zone the way the region filter does (margins clamped to 0–49, anything else 0, all 0 = null).
  - `POST /v1/video-mask` accepts `zone`: only the regions whose bounding-box centre lies inside the inner rectangle the margins leave are kept, after the size cuts and before `holdLastMask`. It accepts `perShot`: the clip's scene cuts are found first and every cut starts a new model request, so the subject is detected again in every shot (a subject that appears after a cut is found) and `holdLastMask` never carries a mask across a cut; each shot's mask is fitted to that shot's exact frame count, so a clip with no cut gives the same mask, fitted to the clip's exact frame count. The job's output reports `shots`.
  - `@nodaro/sdk`: `VideoMaskRequest` (and so `client.media.videoMask`) gains `zone?: { leftPct?, rightPct?, topPct?, bottomPct? } | null` (each 0–49 % of the frame, a margin left out is 0; null = off) and `perShot?: boolean`.
  - `@nodaro/cli`: `nodaro media video-mask` gains `--zone L,R,T,B` (each margin a plain decimal — `5`, `5.`, `.5` — as the API reads it) and `--per-shot`.

- Updated dependencies [e6b7cbb]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [5730599]
- Updated dependencies [23af759]
- Updated dependencies [5730599]
- Updated dependencies [a7b7f73]
  - @nodaro/shared@3.38.0

## 2.35.0

### Minor Changes

- bab9181: Add `client.jobs.fromUpload(params)`: record an image edited in the browser (stored with `client.uploads.upload`) as a completed, private, free `image-edit` job linked to the job or upload it was made from, so it can be rated, favorited, listed and filed into a session like any image job. One upload is one job. Add `client.uploads.uploadJson(json)` to store an editor's design state and pass its url as `editStateUrl`. New types: `JobFromUploadParams`, `UploadJsonResult`.

## 2.34.0

### Minor Changes

- 22bd5d0: `client.castSwap` (also `@nodaro/sdk/cast-swap`): `run(params, { idempotencyKey }?)` starts a Cast Swap job (`POST /v1/cast-swap`, 202 `{ jobId }`; `idempotencyKey` is sent as the `Idempotency-Key` header, 8–200 characters or the server answers 400, and a repeat with the same key within the ~10 s dedup window answers 200 `{ jobId, deduped: true }` with an `X-Dedup-Hit` header) that replaces the people and/or location in a short video, and `estimate(params)` quotes it first (`POST /v1/cast-swap/estimate`). Types: `CastSwapParams`, `CastSwapRunOptions`, `CastSwapRole` (`CastSwapPersonRole` / `CastSwapLocationRole`), `CastSwapTraitSource`, `CastSwapEstimate`. Refusals: 400 (`validation_error`, `raw_reference_token`, `invalid_role_mention`, `unsafe_url`, `video_unreadable`, `clip_out_of_range`, `preview_out_of_range`), 401, 402, 404, 422 `job_blocked`, 503 `host_too_old` / `estimate_unavailable`. Cloud edition only.
- 5e6861c: `VideoToVideoParams` types a Seedance edit's `referenceImageUrls`, `referenceVideoUrls` (extra clips after the source, `{video:2}` on) and `referenceAudioUrls`, and `nodes.quote("video-upscale", VideoUpscaleParams)` is typed: a Seedance 2.5 draft's 1080p finalize can be priced before it runs.

## 2.33.0

### Minor Changes

- fbf0b82: `client.edit.clipPack` and `client.edit.estimateClipPack` take the recordings of one conversation, as Tighten Episode and Trailer do: `ClipPackInput` extends `UseCaseRecordingsInput` — `mediaUrls` (in order, instead of `mediaUrl`), an optional `masterAudioUrl` and the `cameras` settings (`{ wide, synced, speakerCameras }`); each clip then cuts to whoever is talking. Its `mediaUrl` is now optional; existing calls send the same body. Passing both `mediaUrl` and `mediaUrls`, or neither, rejects with a `TypeError` before any request. Several recordings or a Master audio need Speaker Map: where it is not available to the caller, the request is refused `403 node_not_available`. `ClipPackInput.framingSource` (`"auto" | "static" | "tracking"`) picks how a framed pack follows its speakers: `"tracking"` runs Speaker Frames once over the whole pack.

  `nodaro edit clip-pack` takes the same recordings flags as `edit tighten-episode`: repeat `--media` for the cameras of one conversation (in order), `--master-audio <url>`, and `--wide-camera <n>`, `--synced` and `--speaker-camera <speaker>=<recording>` (repeatable; 0 = the wide shot), and `--framing-source <auto|static|tracking>` (not with `--framing none`). One `--media` sends the one-recording request as before.

- b3dbb2a: Speaker Layout: frame a whole recording by speaker — the same length, nothing cut. The SDK gains `client.edit.speakerLayout(input, options?)` (`POST /v1/speaker-layout`) and `client.edit.estimateSpeakerLayout(input)` (`POST /v1/speaker-layout/estimate`), with the `SpeakerLayoutInput` type: one recording (`mediaUrl`) or the recordings of one conversation (`mediaUrls`, `masterAudioUrl`, `cameras`), `targetAspect`, `layout`, `switchType`, `emphasisStyle`, `framingSource` and `reviewBeforeRender`. `continueUseCase` continues its runs; a Render final takes no `editedEdl` (refused `400 use_case_no_plan`). The CLI gains `nodaro edit speaker-layout`, and `nodaro edit continue-use-case --type speaker-layout`. Not yet enabled on nodaro.ai.
- caf9fb6: Tighten Episode can follow faces: `edit.tightenEpisode` / `edit.estimateTightenEpisode` take `framingSource` (`"auto"`, `"static"` or `"tracking"`) with a framing, and `nodaro edit tighten-episode` takes `--framing-source <source>` with `--framing`. `"static"` (the default) splits the frame evenly by speaker; `"tracking"` follows faces with Speaker Frames (charged per started block of 1,000 sampled frames; refused where Speaker Frames is not available to you); `"auto"` follows faces while Speaker Frames is available to you, else the even split.
- 4636a3e: `client.edit.episodeTrailer` and `client.edit.estimateEpisodeTrailer` take the recordings of one conversation, as Tighten Episode does: `EpisodeTrailerInput` extends `UseCaseRecordingsInput` — `mediaUrls` (in order, instead of `mediaUrl`), an optional `masterAudioUrl` and the `cameras` settings (`{ wide, synced, speakerCameras }`). Its `mediaUrl` is now optional; existing calls send the same body. Passing both `mediaUrl` and `mediaUrls`, or neither, rejects with a `TypeError` before any request. Several recordings or a Master audio need Speaker Map: where it is not available to the caller, the request is refused `403 node_not_available`.

  `nodaro edit episode-trailer` takes the same flags as `edit tighten-episode`: repeat `--media` for the cameras of one conversation (in order), `--master-audio <url>`, and `--wide-camera <n>`, `--synced` and `--speaker-camera <speaker>=<recording>` (repeatable; 0 = the wide shot). One `--media` sends the one-recording request as before; a Cameras flag without several recordings or a Master audio exits 1 before any request.

- bc00ecf: `client.edit.tightenEpisode` and `client.edit.estimateTightenEpisode` take the recordings of one conversation: `mediaUrls` (in order, instead of `mediaUrl`), an optional `masterAudioUrl` and the `cameras` settings (`{ wide, synced, speakerCameras }`) — the new `UseCaseRecordingsInput`, merged into `TightenEpisodeInput` (its `mediaUrl` is now optional; existing calls are unchanged). Passing both `mediaUrl` and `mediaUrls`, or neither, rejects with a `TypeError` before any request. Several recordings or a Master audio need Speaker Map: where it is not available to the caller, the request is refused `403 node_not_available`.

  `nodaro edit tighten-episode` takes the same: repeat `--media` for the cameras of one conversation (in order), `--master-audio <url>`, and the Cameras flags `--wide-camera <n>`, `--synced` and `--speaker-camera <speaker>=<recording>` (repeatable; 0 = the wide shot). One `--media` sends the one-recording request as before; a Cameras flag without several recordings or a Master audio, or a malformed one, exits 1 before any request.

### Patch Changes

- Updated dependencies [fbf0b82]
- Updated dependencies [82169cf]
- Updated dependencies [fbf0b82]
- Updated dependencies [f75505f]
- Updated dependencies [b3dbb2a]
- Updated dependencies [866182e]
- Updated dependencies [bc00ecf]
- Updated dependencies [4636a3e]
  - @nodaro/shared@3.37.0

## 2.32.0

### Minor Changes

- 1f772b2: `nodes.quote(type, params)` prices a run before it starts (`POST /v1/quote`): the credits it reserves, what it is expected to cost, and why — typed for `text-to-video`, `generate-video` and `video-to-video`. `nodes.run("video-to-video", VideoToVideoParams)` is typed (Seedance 2.5 edits included), and every typed video overload takes `{ idempotencyKey }`. `GenerateMaskRequest` / `GenerateMaskOutput` are exported again.
- afcd88d: `client.credits.claimWelcomeOffer()` accepts an optional `locale` — the interface language the user answered in, the id of a language Nodaro ships such as `"en"`, `"ja"` or `"pt-BR"`. It is recorded with the consent as the language of the latest one; a value that does not match an id exactly is stored as absent, never refused.

### Patch Changes

- Updated dependencies [1f772b2]
  - @nodaro/shared@3.36.0

## 2.31.0

### Minor Changes

- 589f01a: Clip Pack (`clip-pack`) — a podcast or interview recording cut into a pack of short clips, each framed and captioned by default, in one call.

  - `@nodaro/shared`: `clip-pack` joins `FAN_OUT_EACH_HANDLES` (its `clips` output is one clip per planned clip: each on an Each wire), `DYNAMIC_PRODUCER_TYPES` (its clips are video, or audio for an audio recording) and `REVIEW_HOLDING_USE_CASE_TYPES` (a Clip Pack with Review before render on holds what follows it, like Tighten Episode). Its `json` output (the plan's clip set) is declared an EDL, and its clips present as media. New `SpeakerSwitchId` type (a Speaker View switch id: `cut`, `pan`, `zoom` or `xfade:<transition>`). New `USE_CASE_NOTHING_KEPT` (`"use_case_nothing_kept"`) and `USE_CASE_NOTHING_KEPT_MESSAGE`: a Render final whose review dropped every clip is refused 409 before anything is held or written.
  - `@nodaro/sdk`: `client.edit.clipPack` and `client.edit.estimateClipPack` (`ClipPackInput`, its `framing.switchType` a `SpeakerSwitchId` and its `emphasisStyle` a `ClipPackEmphasis`, `CLIP_PACK_MIN_TARGET_SEC`, `CLIP_PACK_MAX_TARGET_SEC`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"clip-pack"`, and `continueUseCase` continues a Clip Pack run (from where it failed, or its Render final of the kept clips) on its own route. An earlier SDK does not know `"clip-pack"`: it continues a Clip Pack run on the Tighten Episode route, which answers `not_found` — upgrade to continue Clip Pack runs.
  - `@nodaro/cli`: `nodaro edit clip-pack --media <url> [--count <n>] [--length <sec>] [--framing <aspect>|none] [--layout <layout>] [--switch <id>] [--emphasis <style>] [--no-captions | --caption-style <style>] [--review] [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints each clip when the run completes; with `--review`, how to render the kept clips); `nodaro edit continue-use-case --type` accepts `clip-pack`.

- e3da394: Speaker Map — which camera each speaker is on, from the cameras' own microphones:

  - `@nodaro/sdk`: `client.edit.speakerMap(input)` (`POST /v1/speaker-map`) with the `SpeakerMapInput` / `SpeakerMapSource` types and `SpeakerMapResult` re-exported from `@nodaro/sdk/edit`; `client.edit.cameraSwitch` takes a Speaker Map result as `speakerMapResult` and folds it into `speakerMap` (a label in `speakerMap` wins, then the result, then the n-th speaker heard gets the n-th camera).
  - `@nodaro/cli`: `nodaro edit speaker-map --source <[id=]url> … --transcript <file> [--offsets <file>] [--master <id>] [--wide <id>] [--margin-db <db>]`, and `nodaro edit switch-cameras --speaker-map-result <file>`.

  Speaker Map is not yet enabled on nodaro.ai.

### Patch Changes

- Updated dependencies [e3da394]
- Updated dependencies [589f01a]
- Updated dependencies [589f01a]
- Updated dependencies [e3da394]
  - @nodaro/shared@3.35.0

## 2.30.0

### Minor Changes

- ea9cb97: A failed run of a saved workflow can be continued from where it stopped. `client.workflows.run` takes `continueMode: "from-failed"` with `continueFromExecutionId` (the run that failed); `nodeIds` is optional with it (default: the nodes the first run of its chain was started on — every node for a run of every node — plus every node the failed run left failed or held back), and the run executes only the nodes that run did not complete — what it completed is handed on, never run or charged again (per node: a node that failed runs again in full, every list item included). When a later continuation of that run completed only part of what it left, the run builds on the newest such one, and `RunWorkflowResult.continuedFrom` names the execution it continued from. `client.workflows.run` also takes a third argument, `{ idempotencyKey }`, sent as the `Idempotency-Key` header (a retry with the same key answers the run already started, `deduped: true` on the result). A run a later continuation supersedes is refused with `continuation_superseded`: one that failed is the one to continue, and one that completed everything the run left means the work is done. The CLI's `nodaro workflows run` takes `--continue-from <executionId>`, `--from-failed` and `--idempotency-key <key>`, and says when a continuation was built on a later one. A Render final, or a run of named nodes, that continues the newest later continuation joins the chain too. When the newest later continuation stopped at a Preview review — of a render, or of a Tighten Episode with review on — the run is refused with `continuation_preview_pending`: the answer names that run, what holds it, and the one run that finishes it (`next`, to send as the body of `client.workflows.run`; for a single render it is that run's Render final). The SDK throws it as the new `ContinuationPreviewPendingError` (`@nodaro/sdk/errors`: `executionId`, `renderNodeIds`, `reviewNodeIds`, and `next`, typed `HeldFinalRun`), so `client.workflows.run(workflowId, error.next)` finishes it. A Tighten Episode or Chapters node resumes its earlier failed attempt only when its inputs and settings are still the ones that attempt ran with; otherwise it runs fresh. `@nodaro/shared`: the `continuation_not_failed` and `continuation_superseded` codes now document the saved-workflow lane too, and the new `CONTINUATION_PREVIEW_PENDING` code joins `RUN_CONTINUATION_CODES`.
- 641e2e9: Chapters (`episode-chapters`) — list a podcast recording's chapters in one call.

  - `@nodaro/shared`: its chapter list is declared a JSON output that is neither a Transcript nor an EDL, and a published app shows its show notes as text.
  - `@nodaro/sdk`: `client.edit.episodeChapters` and `client.edit.estimateEpisodeChapters` (`EpisodeChaptersInput`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"episode-chapters"`, and `continueUseCase` continues a Chapters run on its own route. An earlier SDK knows only `"tighten-episode"`: it continues a Chapters run on the Tighten Episode route, which answers `not_found` — upgrade to continue Chapters runs.
  - `@nodaro/cli`: `nodaro edit episode-chapters --media <url> [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints the show notes when the run completes); `nodaro edit continue-use-case --type` accepts `episode-chapters`.

- 25c5f17: Trailer (`episode-trailer`) — a 20–40 second trailer of a podcast recording, delivered in each chosen social format, in one call.

  - `@nodaro/shared`: `episode-trailer` joins `FAN_OUT_EACH_HANDLES` (its `media` output is one trailer per format: each on an Each wire), `VIDEO_PRODUCER_TYPES` and `REVIEW_HOLDING_USE_CASE_TYPES` (a Trailer with Review before render on holds what follows it, like Tighten Episode). Its `json` output is declared an EDL, and its `introCard` input is not a prompt lane. A client that branches on a refused review run already matches every code with `isPreviewRefusalCode`.
  - `@nodaro/sdk`: `client.edit.episodeTrailer` and `client.edit.estimateEpisodeTrailer` (`EpisodeTrailerInput`, `TRAILER_FORMATS`, `TrailerFormat`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"episode-trailer"`, and `continueUseCase` continues a Trailer run (from where it failed, or its Render final) on its own route. An earlier SDK does not know `"episode-trailer"`: it continues a Trailer run on the Tighten Episode route, which answers `not_found` — upgrade to continue Trailer runs.
  - `@nodaro/cli`: `nodaro edit episode-trailer --media <url> [--intro-card <url>] [--formats 9:16,1:1,4:5,16:9] [--review] [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints each format's trailer when the run completes, then the formats that could not be rendered; with `--review`, how to render it final); `nodaro edit continue-use-case --type` accepts `episode-trailer`.

- 447292c: Typed `subject` on generate-image: `GenerateImageParams.subject` (and `TextToVideoParams.subject`, which already took one) is the new exported `Subject` type — a flat map of picker field → catalog id(s) saying who is in the shot (the Person and Styling dimension fields plus `heldProp`, `material` and `animal`; `customAge` is the one number). The platform writes the wording and folds it in after your `prompt`; the caller never writes prompt text for it. Field names and ids come from `client.pickerCatalogs.get("person")`, `get("styling")`, `get("held-prop")`, `get("material")` and `get("animal")`. Without a preset the route validates the map (an over-long key, id or list is a `400`); with `presetId` the subject replaces the preset's own and is folded into the preset's prompt, over-long values dropped rather than rejected, and is not recorded on `input_data` (as with `direction` and `structured`). The route already accepted the field, so nothing changes on the wire: an app that passed `subject` untyped keeps working and now gets it checked at compile time; `import type { Subject } from "@nodaro/sdk"` to name it.
- 994c55a: `client.apps.resume(slug, runId, { dryRun?, version? })` retries a failed app run from where it stopped: only the steps the run did not complete run and are charged, and every step it completed hands on its result. It runs the version the run ran, with the inputs the run applied. `{ dryRun: true }` returns what the Retry would run and charge (`AppRunResumePlan`: the steps, `estimatedCredits`, `reusedClips`, `sufficient`, `available`) and starts nothing; otherwise it returns the Retry's execution (`AppRunResumeResult`). Refusal codes are typed as `AppRunResumeRefusalCode`; a Retry refused because the app is on another version throws the new `AppRunVersionChangedError` (`@nodaro/sdk/errors`), carrying `runVersion` and `appVersion` — send `{ version: runVersion }` to continue on the run's own version, or start the run over with `apps.run`. A 409 `already_running` that names the execution under way (a top-level `executionId` — from `apps.resume` or `workflows.run`) now throws the new `AlreadyRunningError` (a `NodaroError`, same `code` and `status`) carrying that `executionId`, so the caller can follow it without another read; one that names a job is still a `ContinuationRefusedError`. `AppRunResumePlan.sufficient` covers the runner's app credits as well as the balance, and the plan carries `appCreditsAllowance` when the app credits are what stops the Retry.
- cdda07e: New `NodaroClientCore` (`@nodaro/sdk/core`, also exported from the root): the client without its resources — config, auth, the request transport and `me()` / `connectedApps()` / `revokeConnectedApp()`. Extend it with only the resources you use, and the other resource modules are never loaded:

  ```ts
  import { NodaroClientCore, StaticTokenAuth } from "@nodaro/sdk/core";
  import { JobsResource } from "@nodaro/sdk/jobs";
  import { NodesResource } from "@nodaro/sdk/nodes";

  class AppClient extends NodaroClientCore {
    readonly jobs = new JobsResource(this);
    readonly nodes = new NodesResource(this); // polls through `jobs`
  }
  ```

  `NodaroClient` (what `createClient` returns) now extends it, with the same public members, types and behavior: every resource is still built when the client is. In its type declarations the transport and identity members are now inherited from `NodaroClientCore`, and `Object.keys(client)` lists `workspaceId` before the resources rather than after them. Every resource constructor now takes a `NodaroClientCore` (`NodesResource` one that also has `jobs`, `Scene3DResource` one that also has `nodes`), so a `NodaroClient` is still accepted everywhere. The auth strategies are exported by `@nodaro/sdk/core` as well as `@nodaro/sdk/client`.

  The transport and identity methods (`request`, `requestText`, `requestBytes`, `me`, `connectedApps`, `revokeConnectedApp`, the `fetch` getter) now live on `NodaroClientCore.prototype`, one level up from `NodaroClient.prototype`: `Object.getOwnPropertyNames(NodaroClient.prototype)` no longer lists them and `NodaroClient.prototype.hasOwnProperty("request")` is `false`, while calling them is unchanged; and `ConstructorParameters<typeof XResource>[0]` is now the core type (`NodaroClientCore`, or the core plus `jobs` / `nodes`) instead of `NodaroClient`.

- d1bbb43: Generate Mask from the CLI: `nodaro media generate-mask <imageUrl> <prompt> [--threshold <n>] [--watch]` selects a subject described in plain text in an image (`POST /v1/generate-mask`, Grounded SAM) and returns a job whose output carries `maskUrl` (a black-and-white mask PNG, white = the subject) and `imageUrl` (the source image, passed through unchanged). It runs through the SDK's typed `nodes.run("generate-mask", …)`, the one SDK way to start it. `@nodaro/shared/media` adds the wire contract — `GenerateMaskRequest`, `GenerateMaskOutput` and `GENERATE_MASK_LIMITS` (prompt 1–500 characters, threshold 0–1, default 0.3) — which the route now validates against.
- 345cabf: Subpath entry points: `@nodaro/sdk/<entry>` for each resource and for `client` (`createClient`, `NodaroClient`, the auth providers) and `errors` (ESM, CJS and types for each). The entries are `apps`, `audio`, `billing`, `catalogs`, `characters`, `client`, `collections`, `community`, `competitors`, `copilot`, `creatures`, `credits`, `developer-apps`, `edit`, `errors`, `executions`, `gallery`, `jobs`, `library`, `llm`, `locations`, `media`, `models`, `moodboards`, `node-presets`, `nodes`, `oauth`, `objects`, `organizations`, `palettes`, `picker-catalogs`, `pipelines`, `projects`, `prompt-helper`, `recast`, `reduce`, `saved-posts`, `scene3d`, `sessions`, `shots`, `studio`, `templates`, `tutorials`, `uploads`, `video-pro`, `voices`, `webhooks`, `workflows`, `workspaces`. Importing a subpath loads only that resource's module instead of the whole SDK. Additive: the root `@nodaro/sdk` still exports every name it did, and is the union of the subpaths; `@nodaro/sdk/supabase` and `@nodaro/sdk/signup-signals` are unchanged. The build is now split into shared chunks, so a value imported from a subpath and from the root is the same instance (`instanceof` holds across them).

  CJS only: because the CommonJS build is now split into chunks, its exports are defined as getters (enumerable, read-only) instead of writable data properties. Code that assigns to a `require()`d export or spies on it in place (for example `jest.spyOn` on the module object) must mock the module instead; ESM consumers are unaffected.

- b5f28a5: Typed image routes beside generate-image: `nodes.run` / `runAndWait` now have overloads for `image-to-image` (`ImageToImageParams`), `edit-image` (`EditImageParams` — either `imageUrl`, or `taskId` with one of the Grok task-op providers, never both), `generate-mask` (`GenerateMaskParams`; `runAndWait` resolves `GenerateMaskJobOutput`, the source `imageUrl` and its `maskUrl`) and `split-image` (`SplitImageParams` on `run` only — it is free and synchronous and answers `SplitImageResult`, the tiles as `{ name, url }[]`). The three job routes answer `ImageJobStarted`, so `result.jobId` is a `string` without a cast. `GenerateImageParams` also types the inpaint fields `baseImageUrl` and `maskUrl` (white = the area to change), plus `strength` and `guidanceScale`. The params take the platform's own vocabularies, re-exported from the SDK: `ModifyImageProvider`, `ImageEditProvider`, `TaskChainedEditProvider`, `ImageAspectRatio`, `ImageResolution`, `ImageQuality`, `ImageRenderingSpeed`, `ImageEditTargetResolution`, `TopazUpscaleFactor`, `ImageToImageAttachColumn`.

  `@nodaro/shared` exports those lever vocabularies as tuples the routes' validation is now built from — `IMAGE_RESOLUTION_VALUES`, `IMAGE_QUALITY_VALUES`, `IMAGE_RENDERING_SPEED_VALUES`, `IMAGE_EDIT_TARGET_RESOLUTION_VALUES`, `IMAGE_TO_IMAGE_ATTACH_COLUMNS` — and `TASK_CHAINED_EDIT_PROVIDER_IDS` (with its type `TaskChainedEditProvider`), from which `TASK_CHAINED_EDIT_PROVIDERS` is now built. The values are the ones the routes already accepted, so nothing changes on the wire: an app that sent these bodies untyped keeps working (the generic `run(type: string, …)` overload is unchanged). The compile-time check applies to a body typed as the params type (`const params: EditImageParams = …`, or `{ … } satisfies EditImageParams`): a body written inline that the typed overload rejects still falls through to the untyped overload and resolves the untyped `RunNodeResult`, so use `satisfies` to get the check.

- a44baa3: A generation session's cover: `sessions.update(id, { coverJobId })` picks one of the session's items to lead its previews (`null` goes back to automatic), and `GenerationSession.coverJobId` reports it — `previewUrls` then starts with the cover's image. The CLI's `nodaro sessions update` gains `--cover <jobId>` and `--auto-cover`.
- 3840a98: `USE_CASE_NODE_TYPES` is now `@nodaro/shared`'s list (`@nodaro/shared/nodes`), re-exported as before, and `continueUseCase` builds each continuation route from it (`POST /v1/<type>/continue`). `continueUseCase` rejects with `use_case_type_unknown` when the run's type cannot be read — pass `nodeType`: a key without the `jobs:read` scope, or a job that records no use-case type, no longer falls back to the Tighten Episode route, and nothing is posted. In the CLI, a key without `jobs:read` now needs `--type` on `nodaro edit continue-use-case`, and the error says so ("pass --type <node type>"; code `use_case_type_unknown`, kept under `--json`).
- b40902e: `client.edit.continueUseCase` continues a run on its own node type's route (`POST /v1/<type>/continue`). It takes an optional `nodeType`; without one it reads the job first (`GET /v1/jobs/:id`) for the type the run records, and when that read cannot tell (a token without `jobs:read`, or a job that records no use-case type) the type must be passed as `nodeType`. New exports: `UseCaseNodeType`, `USE_CASE_NODE_TYPES`, and `UseCaseJobResult` / `UseCaseEstimate` (the `TightenEpisodeJobResult` / `TightenEpisodeEstimate` shapes, which stay as aliases). The CLI's `nodaro edit continue-use-case` takes an optional `--type <type>`, passed through so the job is not read for it.
- 0541d0b: Typed welcome offer. `UserBalance` gains `welcomeOffer` (`{ popupSeen, consentPending, credits }`, present only while the deployment has the offer on), `freeGrantState` and `freeGrantNotice`; `welcomeOffer.credits` is the amount a claim grants, sent by the server, so an app shows that figure instead of a hard-coded number that goes stale when the grant changes. Two new helpers replace raw `client.request(...)` calls: `client.credits.claimWelcomeOffer({ sourceApp, browserKey, deviceKey })` (records the email consent and claims the grant; resolves `{ consent, grant, credits }`) and `client.credits.markWelcomeOfferSeen()` (the one-time popup was shown; resolves `{ ok: true }`). New exported types: `FreeGrantState`, `WelcomeOfferState`, `WelcomeOfferClaimInput`, `WelcomeOfferClaimResult`, `WelcomeOfferSeenResult`. Both routes are browser-session only: they work from a first-party web app signed in with a Supabase session and answer 403 to an API key or OAuth app token, and 409 `welcome_offer_disabled` while the offer is off. To adopt: read the amount from `balance().welcomeOffer.credits` and swap your raw calls for the two helpers; nothing else changes.

### Patch Changes

- 8686499: CLI: `nodaro workflows render-final <workflowId> --from <executionId> [--render <nodeId>]` renders the final of a run that stopped at a Preview render (the render at Final and every node after it, continuing that run); `--render` defaults to the workflow's only render, `--estimate` quotes it and runs nothing, and `--watch` follows it. `nodaro workflows run` takes `--override nodeId.field=value` (a per-node override for that run) and `--next <json|file|->`, which sends the `next` of a `continuation_preview_pending` answer exactly as given; a `--from-failed` refused with `continuation_preview_pending` now prints the exact command that finishes the held run. `--next` refuses a body that carries `continueMode` or `renderFinal` (a `next` never does), and the printed command quotes an argument that starts with `=`, which zsh would otherwise expand.

  SDK: documents that a continuation (a run of named nodes, a `renderFinal`, a `next`, or a `continueMode: "from-failed"`) its payer cannot cover throws `InsufficientCreditsError` before any execution exists.

- 87448e1: A continue-from-failed (`continueMode: "from-failed"`, `nodaro workflows run --from-failed`) counts every id in `nodeIds` / `--node` as named: a node of work no run of its chain ever ran (each only handed on its saved results) runs and is priced, while a source, trigger, parameter picker or container keeps what the run handed on and a node set to skip never runs. The SDK's `RunWorkflowParams.nodeIds` and `continueMode` docs and the CLI's `--from-failed` help say so; the `nodeIds` doc no longer says the default is every node.
- 5d9e2cd: What a continue-from-failed (`continueMode: "from-failed"`, `nodaro workflows run --from-failed`) sent no `nodeIds` / `--node` considers: the nodes the first run of its chain was started on — a run started on named nodes (the editor's Run selected, an API `nodeIds`, a Render final) is continued on those; a run of every node, or one started before the nodes were recorded, on every node — plus every node left failed or held back by the run being continued, by a newer continuation it is built on, or by an earlier run of its chain, so a failure outside those nodes is always retried. `nodeIds` you send replace those nodes, and the run is built on the chain's newest continuation when it failed or its work is done (one held at a Preview review still answers `continuation_preview_pending`), and a node they name that is still left runs. The SDK's `RunWorkflowParams.continueMode` doc and the CLI's `--from-failed` help say so. `WorkflowExecution` gains `nodeScope` (`client.executions.get`): the nodes the first run of its chain was started on, `null` for every node.
- 2caffe2: Library rows carry the originating `jobId` when known: `LibraryAsset.jobId` (optional, `string | null`) on `client.library.list()` results names the job that made the file, `null` for an upload or once that job's history was deleted. A client app can go from a generation's job id to its stored file without comparing URLs. Nothing to change in an existing app; the field is absent when talking to a server from before it.
- 8f5eec1: Node descriptors carry a per-unit rate where a node is charged per unit of its own measure: `NodeDescriptor.creditRate` (`NodeCreditRate`: `identifier`, `unit`, `creditsPerUnit`, `minUnits`, `rounding: "ceil-run-total"`, `note`) on `client.nodes.list()` / `get()`. Speaker Frames is the first: its `creditCost` stays `"per-1000-frames"`, and `creditRate.creditsPerUnit` is the exact charged credits of one block of 1,000 sampled frames — a run is charged `ceil(blocks × creditsPerUnit)` once. Nothing to change in an existing app; the field is absent when talking to a server from before it, and on editions without credits.
- b60db72: The built-in ("factory") preset catalog is readable without a token: `GET /v1/node-presets/factory` is now a public route, so `client.presets.listFactory(nodeType)` works on a tokenless client (`createClient({ baseUrl, auth: { getToken: async () => null } })`) — a client app can show the catalog (names, example pictures via `previewUrl`, how many photos a preset needs via `minReferences` / `needsImage`) to visitors who are not signed in and ask for a login only when they generate. The response is cached for 5 minutes like the model catalog, and an invalid or expired token sent with the request is ignored (an OAuth app needs no scope for it). `@nodaro/prompts`: `getFactoryPresets()` and `presetMinReferences()` answer an empty catalog / zero for a node type that is not a catalog key even when it names an `Object.prototype` member (`constructor`, `toString`), instead of throwing. Your own presets, favorites and folders still need auth exactly as before. Nothing to change in an existing app. CLI: `nodaro presets list --factory --node-type <type>` no longer needs a saved profile (`--base-url <url>` asks another instance; without `--factory`, `presets list` still needs one).
- 4f2c840: Generate Mask has one type contract: `GenerateMaskParams` is now `@nodaro/shared`'s `GenerateMaskRequest` plus the session fields (`sessionId`, `origin`), and `GenerateMaskJobOutput` is `NodeJobOutput & GenerateMaskOutput`, instead of copies of the same fields. No public name is removed and the wire is unchanged. One modifier follows the shared contract: `GenerateMaskParams`' `imageUrl`, `prompt` and `threshold` are now `readonly`, as on `GenerateMaskRequest`. Passing a body is unaffected; only assigning to those fields of a variable typed `GenerateMaskParams` after creating it stops compiling.
- Updated dependencies [ea9cb97]
- Updated dependencies [641e2e9]
- Updated dependencies [25c5f17]
- Updated dependencies [435c134]
- Updated dependencies [42001e0]
- Updated dependencies [d551823]
- Updated dependencies [b4ce8e5]
- Updated dependencies [c645465]
- Updated dependencies [8eacb99]
- Updated dependencies [5cf6e9d]
- Updated dependencies [b60db72]
- Updated dependencies [d1bbb43]
- Updated dependencies [b5f28a5]
- Updated dependencies [42001e0]
- Updated dependencies [8eacb99]
- Updated dependencies [2f89724]
- Updated dependencies [25c5f17]
- Updated dependencies [3840a98]
- Updated dependencies [aa97e61]
- Updated dependencies [3e4a5cd]
- Updated dependencies [3e4a5cd]
  - @nodaro/shared@3.34.0
  - @nodaro/prompts@1.40.0

## 2.29.0

### Minor Changes

- a4793b7: Plans and prices: `client.billing` — `plans()` lists the plans and credit packs on sale with what each costs (`GET /v1/billing/plans`, public: it works signed out, Nodaro Cloud only); `subscription()` returns the account's subscription and the tier its entitlements follow (`effectiveTier` — match it to a plan `id` to mark the current plan); `surface()` and `account()` read how the deployment bills and the caller's plan and balance in its unit. Prices are `{ amount, currency }` in the currency's major unit; each price carries what it grants (`credits: { amount, per }`, `null` when not stated), the free plan its one-time `signupCredits`; a price that cannot be stated right now is `null`, never free. Buying stays in the Nodaro app. New CLI commands: `nodaro billing plans | subscription | account | surface` — `plans` and `surface` need no sign-in (`--base-url` to ask another instance).
- dd16c1d: Connected apps and character training on the SDK, and readable errors from older routes.

  - `client.connectedApps()` lists every app with access to the signed-in user's account (`ConnectedApp`: `authorizationId`, `name`, `kind`, `homepageUrl`, `scopes`, `connectedAt`, `lastUsedAt`), and `client.revokeConnectedApp(authorizationId)` ends one app's access and every token under it. Both answer a signed-in browser session only (`supabaseAuth`); an API key or app token gets `UnauthorizedError`.
  - `client.characters.train(id, { selectedImageUrls? })`, `trainingStatus(id)` and `deleteLora(id)` train, follow and remove a character's high-fidelity model (Nodaro Cloud only; elsewhere `NotFoundError`). With an OAuth app token, `train` and `deleteLora` need the `assets:write` scope (`ForbiddenError` otherwise). New types: `TrainCharacterInput`, `TrainCharacterResult`, `CharacterTrainingStatus`, `CharacterTrainingState`, `TrainCharacterRefusalCode`.
  - `throwFromResponse` now reads the error bodies some older routes send — `{ error: "<code>", message? }`, OAuth's `{ error, error_description }` and a bare `{ message, issues }` (`validation_error`) — so those refusals carry their real `code` and `message` instead of `internal_error` / "Request failed". At HTTP 500 and above only their code is read, never text from outside the `{ error: { code, message } }` envelope. Typed classes are still chosen by status; one with no message from the server keeps its default ("Not found", "Authentication required") instead of "Request failed". `InsufficientCreditsError.required` / `.available` are now filled from the `required` / `balance` the credit guard sends beside the envelope. Nothing to change unless you matched on `code === "internal_error"` for such a route.
  - CLI: `nodaro characters train <id> [--image <url> …] [--watch]`, `nodaro characters training <id> [--watch]` (exit 0 succeeded, 2 failed or could not be started, 130 cancelled or removed; a 4xx ends the watch) and `nodaro characters delete-lora <id>`.

- f38f7f9: Search the saved characters, locations, objects and creatures by words: `q` on `characters.list()`, `locations.list()`, `objects.list()` and `creatures.list()` keeps the rows whose name or description contains every word of it (split on spaces, the first five), in any order and ignoring case — `"red car"` finds "Car, red" — and combines with every other filter and with cursor paging. `library.list()` takes the same `q` for its filename search; `search` still works and is deprecated. Each word is matched as written: `%`, `_` and `*` are not wildcards, and punctuation is kept. A blank `q` is no search. The CLI's `characters list`, `locations list` and `objects list` take `--search <words>` (or `--q <words>`). `q` needs a server from this release: an older one ignores it and returns the unfiltered list.
- 8d60d35: Several images in one generate-image call. `GenerateImageParams` types `count` (1–4 images, each its own job) and `models` (the same request on 2–4 image models instead of `provider`; with `count`, per model, at most 8 images), plus `seed` (image i gets `seed + i`) and `userPrompt` (the prompt as your user typed it — stored on the job, never sent to the model). With a literal `count` above 1 or `models`, `nodes.run("generate-image", …)` is typed to answer `GenerateImageBatchResult` — every job id grouped by model (`jobIds`, `groups` with credits and per-model corrections, `batchId`, `totalCredits`); the batch is checked against the balance and charged as a whole or not at all, and with an `idempotencyKey` each image is keyed `<key>:<i>` so a retry returns the same jobs. The new `nodes.runBatchAndWait("generate-image", params, opts)` submits once and waits for every job, resolving `{ batch, results }` with one `BatchJobOutcome` per job, so one image failing never discards the others. `runAndWait` and `runMany` now refuse a batch request before anything is sent (`batch_requires_run_batch_and_wait`) instead of silently waiting for its first job. `jobs.list({ batchId })` lists a batch's jobs. `origin` and `sessionId` (`GenerationSessionParams`) are now typed on every generation params type — video upscale / depth / narrated video, the 3D scene params and the character / object / location / creature generate inputs — since the platform stamps them on every job-creating request; an `origin` that is not a slug is refused with a 400. The CLI's `nodaro nodes run generate-image` takes `--count` and `--models`, prints the job ids grouped by model, and `--watch` follows every job of the batch.
- 7f63d32: `GenerateImageParams` types `presetId` and `presetVariables`: `POST /v1/generate-image` now applies a node preset exactly as the editor does (prompt and pre/post text, placeholder defaults, style, negative prompt, levers), so `nodes.run("generate-image", { presetId })` sends the editor's request. The CLI's `nodes run` help shows a preset example.
- 6043437: An image job's output now carries the image's pixel size: `width` and `height` of `imageUrl` as it is stored (what you download, EXIF orientation applied), and, beside `imageUrls` when a job made several images, `images` — one `{ url, width, height }` per image, in the same order. `NodeJobOutput` types all of them (and `imageUrls`), and the new `JobOutputImage` type names one entry. Present on image jobs completed after this release; older jobs, and sizes the server could not read, have none of them, so treat them as optional. Nothing to change to adopt it: upgrade, then read `output.width` / `output.height` (or `output.images`) from `nodes.runAndWait`, or cast `output_data` to `NodeJobOutput` after `jobs.get` / `jobs.getStatus`.
- 1e4e50d: Favorites, ratings and filtered job lists. `client.jobs.list()` filters by `status` (one status or a list), by several `type`s at once, by your favorites (`favorited: true | false`) and by your rating (`rating: "good" | "bad" | "rated" | "unrated"`), all combined with AND; every `Job` it or `jobs.get()` returns carries `favorited` and `rating` (left out when the server cannot read them for a moment — treat a missing field as unknown, never as `false`). `client.jobs.rate(id, "good" | "bad" | null)` rates one of your jobs (`null` clears the rating). The new `client.gallery` resource browses the public gallery (`browse()`) and keeps your favorites: `toggleFavorite(jobId)` answers `{ favorited }`, `favorites()` your favorited job ids, newest first. New types: `JobRating`, `JobRatingFilter`, `RateJobResult`, `GalleryItem`, `GalleryMediaType`, `BrowseGalleryParams`, `GalleryPage`, `ToggleFavoriteResult`.

  The CLI gains `nodaro jobs list` (the same filters; `--no-favorited` for the jobs you did not favorite), `nodaro jobs rate <id> good|bad|clear` and `nodaro gallery browse | favorite <jobId> | favorites` (`gallery browse --favorites` lists your own favorited items).

  Existing calls are unchanged. An OAuth app needs `assets:write` to rate a job or toggle a favorite, and `assets:read` or `jobs:read` to list favorites; favoriting another person's private job is a `NotFoundError`. `browse({ favoritesOnly: true })` lists your own favorites only: pass your own `userId` — another person's favorites are refused.

- 9ddf163: Every model in the catalog names the company that made it, and can carry that company's mark. `client.models.list()` (`GET /v1/models`) adds two optional fields to each `ModelSummary`, both absent on an older server: `maker` — `{ id, name }` (new exported type `ModelMaker`), the company behind the model, with a stable id per company (`"google"`, `"black-forest-labs"`) an app can key its own assets on — and `logoUrl`, the maker's official mark (an SVG) on the instance's own media CDN, or `null` when the instance publishes none. Nothing has to change to keep working. To show the marks, read `maker` and `logoUrl`, use the address as given (it carries the file's version, so a replaced mark arrives under a new address), and draw a fallback such as the maker's name or initial when either is missing or `null`, or the maker id is one you do not know. A `logoUrl` is listed only once its file is in the instance's storage, never before it is uploaded. `@nodaro/shared`: `ModelCatalogEntry` gains a required `maker`, with the `MODEL_MAKERS` registry, `ModelMakerId`, `ModelMaker`, `isModelMakerId` and `modelMakerOf` (undefined for an entry whose maker is not in the registry; code that builds its own catalog entries must add a `maker`). `nodaro models list` shows a maker column, and `--json` carries both fields.
- ab1a3f2: Outbound webhooks: register an https endpoint and your server is POSTed every `job.completed` / `job.failed` of your account instead of polling `jobs.get()` — signed, retried with backoff for about 43 hours, every attempt in a delivery log. `client.webhooks` — `create` (returns the endpoint's `whsec_…` signing secret, this once), `list`, `get`, `update` (address, events, description, switch on/off), `delete`, `rotateSecret` (a new secret; the old one keeps signing beside it for a grace period, a day by default, `gracePeriodSeconds: 0` to end it at once), `deliveries` (the log), `getDelivery` (one delivery by id) and `test` (a ping) — over the new `/v1/webhook-endpoints` routes, plus `verifyWebhookSignature` (and `WebhookSignatureError`) to check a delivery's `Nodaro-Signature` header on the raw body with Web Crypto (Node 20+, edge runtimes, browsers). Nothing changes for an app that does not register an endpoint. OAuth app tokens need `jobs:read`, and an endpoint registered with an app's token receives only the jobs that app submitted. CLI: `nodaro webhooks list | get | create | update | delete | rotate-secret [--grace <seconds>] | deliveries | test [--wait]`.

  `@nodaro/shared`: `isPrivateOrReservedIP` (and `isLocalOrPrivateHostname`) now refuse the whole of link-local `fe80::/10` (it matched only `fe80:`), site-local `fec0::/10`, local-use NAT64 `64:ff9b:1::/48`, Teredo `2001::/32` and the IPv4 `192.0.0.0/24`, and judge NAT64 `64:ff9b::/96` and 6to4 `2002::/16` addresses by the IPv4 address they reach. Anything with a colon that is not a valid IPv6 address is refused.

- e5c4123: Your own colour palettes and moodboards, usable as a generate-image direction.

  - **SDK:** `client.palettes` and `client.moodboards` (`list` / `get` / `create` / `update` / `delete`) with their types (`ColorPalette`, `Moodboard`, `MoodboardImage`, …). Use one on `nodes.run("generate-image", …)` as `direction: { colorLook: paletteDirectionId(id) }` — the palette's colours, each by an everyday name and its hex, go into the prompt — or `direction: { style: moodboardDirectionId(id) }` — the moodboard's description goes into the prompt and its images go to the model as style references, after your own references and up to the model's reference limit. `GenerateImageParams.direction` is now typed (`DirectionFields`) and documents both values; a run's answer types `warnings?: RunNodeWarning[]` (`moodboard_images_not_sent` when some images did not fit). A malformed value answers 400, one that is not yours 404 `direction_not_found`, and one beside `presetId` 400 for now. OAuth apps need `assets:read` / `assets:write` for the new resources; nothing else changes for existing callers.
  - **CLI:** `nodaro palettes list|get|create|update|delete` and `nodaro moodboards list|get|create|update|delete` (`--image <url[|caption]>`, repeatable).
  - **Prompts:** the `colorLook` and `style` direction rows take a user-owned reference (`palette:<id>`, `moodboard:<id>`; `parseUserDirectionRef`, `directionKeyForUserRef`); the fold renders the clause a caller resolved for it (`renderDirectionHints` / `partitionStyleClauses` option `refs`, `assembleImageInput`'s `directionRefs`); `assembleImageInput` takes fill-only `styleReferences` and reports `styleReferencesSent`; `renderPaletteClause`, `renderMoodboardClause`, `styleReferenceDescription` and `nearestColorName` give the wording; the catalog-curation guard leaves a user-owned reference on its own key alone. Everything is additive: a fold without them is byte-identical.

- 94478f0: Node presets can be written over the API. `client.presets` gains `create`, `update(id, patch, { expectedUpdatedAt })`, `delete`, `import`, `reorder`, `favorites`, `addFavorite`, `removeFavorite`, `createGroup`, `updateGroup` and `deleteGroup`. Your own API key may call them; an OAuth app needs the `assets:write` scope (reads still need `presets:read`); a key limited to some workflows cannot reach presets.

  Every preset now says how many connected photos it works from and shows an example picture: `minReferences` and `needsImage` (`minReferences > 0` — Reference Sheet, Portrait Transformations, Edits and every template using `{image:N}`) and `previewUrl` (an absolute URL, or `null` while a preset has none) on each factory entry (the new `FactoryPresetEntry` type) and on `NodePreset`. A preset of your own can store a picture: pass `previewUrl` on create, update or import — an image already stored on the platform (an upload or a finished result); `null` removes it. The preset keeps its own copy, so the `previewUrl` it answers with is the copy's address, not the one you sent. To use it: show `previewUrl` when it is not null, and ask for `minReferences` reference images before running a preset whose `needsImage` is true. The fields are optional in the types because older servers leave them out.

  The CLI gains `nodaro presets create`, `update`, `delete`, `import <file>` (what `presets export` writes, or a JSON list), `favorites`, `favorite`, `unfavorite`, and `presets groups create|update|delete` (bare `presets groups` still lists); `presets list --factory` shows each preset's photo count and whether it has a picture.

  `@nodaro/prompts`: `FactoryPreset` gains an optional `minReferences` declaration, with `presetMinReferences(nodeType, data, declared?)` (the count from a preset's `{image:N}` tokens and its declaration), `factoryPresetPreviewUrl(presetId, baseUrl)` and the committed picture map `FACTORY_PRESET_PREVIEW_FILES`.

  Behavior changes on the existing routes: `DELETE /v1/node-presets/:id` of a preset that is not yours, or is already gone, answers `404 not_found` (it answered `200`, as folders already did not) — `client.presets.delete` then throws, so treat a 404 as already deleted; `DELETE /v1/node-presets/:id` and `DELETE /v1/node-preset-groups/:id` answer `404 not_found` for an id that is not a uuid (it was a `500`), and `DELETE /v1/node-presets/:id?expectedUpdatedAt=…` answers `404` rather than `409 conflict` for a preset that is not yours. Each account keeps at most 5,000 presets, 500 folders and 2,000 favorites (`409 limit_reached` past that), and one reorder from an API key or an OAuth app moves at most 500 presets and 100 folders.

### Patch Changes

- Updated dependencies [9ddf163]
- Updated dependencies [ab1a3f2]
- Updated dependencies [e5c4123]
- Updated dependencies [94478f0]
  - @nodaro/shared@3.33.0
  - @nodaro/prompts@1.39.0

## 2.28.0

### Minor Changes

- 0dae8d0: Generation sessions inside projects: `client.sessions` — `create`, `list` (with `itemCount` and `previewUrls`), `get`, `update` (title, archive), `delete`, the session feed `items`, `importItems` (your own jobs, as links, all-or-nothing) and `removeItem` (the link only). Send `sessionId` on a generation request to file its job in a session; `sessionId` and `origin` are typed on `GenerateImageParams`, `GenerateVideoParams` and `TextToVideoParams` (`GenerationSessionParams`), `GenerateImageParams` also types `promptPrefix` / `promptSuffix`, and `Job` carries `session_id`.
- 9ad0760: Published apps, components and templates carry the "up to" end of their listed price range: `maxEstimatedCredits`, `maxPerMinuteCredits` and `maxPerItemCredits` on an app or component, `maxEstimatedCredits` and `maxEstimatedPerMinuteCredits` on a template — the most a run can cost over the choices its user has. Present only when they differ from the "from" figures.

## 2.27.0

### Minor Changes

- bc867a8: `Job.credits_charged` (`client.jobs.get()` / `client.jobs.list()`): what a job actually cost once its credit hold settled. It can be lower than `credits` — the amount held when the job was accepted, which never changes — because some jobs hold more than they end up using and the rest goes back to the balance; it is `0` when the hold was refunded and `null` while the job is still running. Sum `credits_charged` to total spend. Additive.
- 2019569: `client.credits.transactions({ limit?, cursor? })` reads `GET /v1/credits/transactions` — a page of the caller's credit transactions with `credits_charged` (what each run cost once settled) beside `credits_reserved` (the hold), plus `nextCursor` for paging. New exported types: `CreditTransaction`, `CreditTransactionsPage`, `CreditTransactionsOptions`.
- 38373ca: Tighten Episode — tighten a podcast recording in one call.

  - `@nodaro/sdk`: `client.edit.tightenEpisode`, `client.edit.estimateTightenEpisode` and `client.edit.continueUseCase` (with the `TightenEpisodeInput`, `TightenEpisodeJobResult`, `TightenEpisodeEstimate`, `UseCaseContinueInput` and `UseCaseRequestOptions` types; an optional `idempotencyKey` is sent as the `Idempotency-Key` header). New `ContinuationRefusedError` (a `NodaroError`): a 409 whose body names a job (`already_running`, `continuation_superseded`, `render_final_already_rendered`) now carries that `jobId`; every other 409 is unchanged. `client.audio.mix` takes `endAt` (`"longest"`, the default, or `"voice"`: the mix ends when the ducked-under voice ends).
  - `@nodaro/cli`: `nodaro edit tighten-episode --media <url> [--music <url>] [--output video|audio] [--framing <aspect> [--layout <layout>]] [--no-captions] [--review] [--plan-tier <tier>] [--instructions <text>] [--watch]`, and `nodaro edit continue-use-case <jobId> --mode from-failed|render-final [--edit <file.json>] [--idempotency-key <key>] [--watch]` — a refusal that names another job prints its code and that job.
  - `@nodaro/shared`: the `tighten-episode` node type joins `DYNAMIC_PRODUCER_TYPES` (its output is video or audio by its settings), the video output types of the presentation helpers, the JSON output kinds (its `json` is the plan's EDL) and `NON_PROMPT_TEXT_LANES` (its `music` input is never a prompt). New continuation exports: `CONTINUATION_NOT_FAILED`, `CONTINUATION_SUPERSEDED`, `CONTINUATION_SETTLING` (a retry answer, outside `RUN_CONTINUATION_CODES`), `RENDER_FINAL_ALREADY_RENDERED` and `RENDER_FINAL_ALREADY_RENDERED_MESSAGE`. `RUN_CONTINUATION_CODES` / `RunContinuationCode` widen with `continuation_not_failed` and `continuation_superseded` — an exhaustive `switch` over `RunContinuationCode` needs two new cases.
  - `@nodaro/shared` (the preview stop rule): a Tighten Episode node with Review before render on holds a run like a render at Preview. New `REVIEW_HOLDING_USE_CASE_TYPES` and `isPreviewHoldingType(type)` (a render node or such a use-case node); `rendersAsPreview(node)` widens to a review-on use-case node that is not running as its own Render final (a `useCaseContinue` render-final naming a job), so `previewStops` and everything built on it hold what follows that node. Four new refusal codes say what held a refused run — `PREVIEW_REVIEW_REQUIRED_REVIEW_ON` (`preview_review_required_review_on`), `PREVIEW_REVIEW_REQUIRED_MIXED` (`preview_review_required_mixed`), `PREVIEW_RENDER_NESTED_REVIEW_ON` (`preview_render_nested_review_on`), `PREVIEW_RENDER_NESTED_MIXED` (`preview_render_nested_mixed`) — recorded on a failed execution, a trigger's refused fire and a sub-workflow node's error; a render-held refusal keeps `preview_review_required` / `preview_render_nested`, as do the HTTP refusals. New `isPreviewRefusalCode(code)` matches all six. **Thin clients that pin `@nodaro/shared` and branch on `preview_review_required` / `preview_render_nested` should switch to `isPreviewRefusalCode`**: a run held by a review-on node otherwise reads as an unknown failure. `RENDER_FINAL_ALREADY_RENDERED` (`render_final_already_rendered`) also fails a Tighten Episode node inside a Render-final continuation run that would render an edit already rendered (nothing is charged, and its descendants do not run).
  - `@nodaro/shared`: `useCaseContinue` joins `EXECUTION_DATA_KEYS` and `TRANSIENT_RUNTIME_KEYS` — a use-case node's continuation is one run's override, so `stripTransientRuntimeData` drops it from every saved graph.
  - `@nodaro/shared`: `withRunOverrides` drops a saved `useCaseContinue` (the new `RUN_ONLY_NODE_FIELDS`) from every node before it merges the run's overrides, as the server's engine does: only the run's own override can make a use-case node continue an earlier run. A node with no override and no such field is still returned as is; apply it once, to the saved graph.

### Patch Changes

- ec1af00: Import `@nodaro/shared` and `@nodaro/prompts` by subpath entry (`@nodaro/shared/models`, `@nodaro/prompts/person`, …) instead of the package roots. No API change. These subpaths exist only from the `@nodaro/shared` and `@nodaro/prompts` minors released alongside, so this release raises both dependency ranges to those versions.
- Updated dependencies [877d84f]
- Updated dependencies [fbd36eb]
- Updated dependencies [8f6f970]
- Updated dependencies [9ec9451]
- Updated dependencies [8b88e2e]
- Updated dependencies [80ac0c8]
- Updated dependencies [8b88e2e]
- Updated dependencies [6aad69d]
- Updated dependencies [7df1ca0]
- Updated dependencies [38373ca]
- Updated dependencies [85af0b7]
- Updated dependencies [04d3831]
- Updated dependencies [0cbb622]
- Updated dependencies [7a150e4]
- Updated dependencies [5ae85ef]
- Updated dependencies [a5e47fa]
- Updated dependencies [f997550]
- Updated dependencies [6f27570]
- Updated dependencies [8db580c]
  - @nodaro/shared@3.32.0
  - @nodaro/prompts@1.38.0

## 2.26.0

### Minor Changes

- a099cbc: `client.credits.claimSignupGrant(keys)` (`POST /v1/credits/claim-signup-grant`) claims the account's free signup grant with the browser signals of the page making the claim, and the new browser-only subpath `@nodaro/sdk/signup-signals` computes them (`collectSignupKeys`, `computeDeviceKey`, `computeBrowserKey`, `sha256Hex`; `@fingerprintjs/fingerprintjs` is an optional peer dependency for the browser key). Every Nodaro surface reports the same two signals through this one implementation. Additive.
- aed3ad2: Seedance 2.5 Draft mode: `draft` on Seedance 2.5 generation (480p, same price as a 480p run) and the `seedance-2-5-hd` Video Upscale provider that finalizes a draft as the same take at 1080p (`isSeedanceDraftCapable`, `seedanceDraftFinalizeCreditId`, catalog entry; SDK `draft` + typed `VideoUpscaleParams`).
- ea015e7: Split into Chunks on the SDK and CLI. `client.media.splitMedia(input)` (`POST /v1/split-media`) cuts a video and/or an audio file into consecutive parts of at most `chunkDuration` and at least `minPartDuration` seconds (default 4), frame/sample-exact; the new `SplitMediaInput` and `SplitMediaOutput` types describe the body and the completed job's `output_data` (`videoUrls`, `audioUrls`, `chunkCount`, `partDurationsSec`, `audioPartDurationsSec`). The CLI gains `nodaro media split-media --video <url>|--audio <url> --chunk-duration <sec> [--min-part-duration <sec>] [--format mp3|wav|aac] [--watch]`. Additive.
- d46fc97: UGC video nodes (Nodaro Cloud).

  `@nodaro/shared`:

  - `ugc-node-wires` (new): the request bodies and outputs the editor and the workflow engine share for UGC Creator, UGC Script, UGC Clips, UGC Clip and UGC Cards, with UGC Creator's option reader and its pick helpers (`ugcCreatorCandidates`, `ugcCreatorCallsToRender`, `ugcCreatorCandidate`, `ugcCreatorPick`, `ugcAwaitsPick`), UGC Script's result (`ugcScriptResult`), a kept node's outputs (`ugcKeptOutputs`) and `ugcPipValue`; the readers of a saved script's length and of its screenshot cards, beat by beat (`ugcPlanLengthSec`, `ugcPlanScreenshotCount`), and the script's length bounds (`UGC_SCRIPT_DEFAULT_TARGET_SEC`, `UGC_SCRIPT_MIN_TARGET_SEC`, `UGC_SCRIPT_MAX_TARGET_SEC`); the pickers a creator reads (`UGC_CREATOR_PICKER_TYPES`); and the sentences the UGC nodes fail with, by id (`UGC_NODE_MESSAGES`, `UgcNodeMessageId`, `UGC_SCRIPT_NEEDS_CHANGES`).
  - `ugc-run-state`: the waiting-for-a-pick checks (`ugcPickPending`, `ugcRunWaitsForPick`, `UGC_PICK_FIRST_MESSAGE`, `UGC_CREATOR_CANDIDATES_KEY`). `UGC_NODE_RUN_STATE_KEYS` also lists UGC Creator's options, their note and its image, UGC Clip's takes and Re-render marks, and UGC Cards' Notes; `stripUgcRunState` also removes the fields in the new `UGC_PUBLISH_PRIVATE_FIELDS` (UGC Creator's photo).
  - `producer-types`: `ugc-clip` joins the video producers, and `ugc-clips` fans out from its Clips output only (`FAN_OUT_EACH_HANDLES`).
  - `json-kinds`: the UGC nodes' JSON outputs are declared.
  - `entity-image-handle`: an output that carries a plain medium reads as that medium to every classifier (`OUTPUT_PIP_EFFECTIVE_TYPES`, `outputPipSourceType`, read by `resolveEffectiveSourceType`): UGC Creator's image as an image, and UGC Script's category, UGC Clips' transcript and UGC Cards' Notes as one text each.
  - `node-runtime-keys`: `NODE_TYPE_EXECUTION_DATA_KEYS`, `isExecutionDataKey` and `executionDataKeysOf`: a run result a node type keeps under a generic name (UGC Clips' `quote`, UGC Clip's `durationSec` and Re-render marks, …) is execution data on that type only. `EXECUTION_DATA_KEYS` gains `__listResultMeta`. `extractPresetData` takes the node type to apply them (`node-preset-extract`; `node-preset-export` passes it), and `stripExportContent` strips them (`workflow-export`).
  - `presentation-utils`: UGC Cards' output is text (its Notes).

  `@nodaro/sdk`: `JobStatusResult.completed_at`, when the job finished on the server's clock (`null` until it has), on the lean status `jobs.getStatus` returns.

### Patch Changes

- bb9fbb6: `nodes.run(type)` now posts every node type to the route that runs it. Node types whose route is not `POST /v1/<type>` — `llm-chat`, `image-to-text`, `video-composer`, `after-effects`, `motion-graphics`, `lottie-overlay`, `3d-title`, `telegram-channel-feed`, the `suno-*` nodes and the social post nodes — used to get a 404; they now reach their real route, and a per-platform social post node (`x-post`, …) fills in its `platform` when the body leaves it out. A node type with no route of its own (`modify-image`, `paint-mask`, …) rejects with a `NodaroError` of code `node_not_runnable` naming what to run instead, without calling the API; a type that runs only inside a workflow (`upload-image`, `combine-text`, …) rejects with the same error when the API answers that it has no route for it, instead of a bare `NotFoundError`. A `404` about a missing resource is still a `NotFoundError`, which now carries the server's message when the response has no error object.

  `@nodaro/shared` exports the route table the SDK and the platform share: `NODE_RUN_ROUTES`, `NODE_TYPES_WITHOUT_RUN_ROUTE`, `nodeRunRoute(type)` and `SOCIAL_POST_NODE_PLATFORM`.

  `nodaro nodes run <type>` runs through `nodes.run`, so the CLI (standalone binaries included) picks up the same routing and the same early error.

- Updated dependencies [7ae9066]
- Updated dependencies [bb9fbb6]
- Updated dependencies [aed3ad2]
- Updated dependencies [7ec852c]
- Updated dependencies [d46fc97]
- Updated dependencies [b3cac89]
  - @nodaro/shared@3.31.0

## 2.25.0

### Minor Changes

- 1f10432: - `client.nodes.run("video-depth", …)` / `runAndWait("video-depth", …)` are typed: `VideoDepthParams` (`videoUrl`, `provider?`, `modelSize?`, `colormap?`, `resolution?`, `sideBySide?`), and the `VideoDepthProvider` / `VideoDepthModelSize` / `VideoDepthColormap` / `VideoDepthResolution` vocabularies are re-exported from `@nodaro/shared`.
  - CLI: `nodaro nodes run --help` shows a `video-depth` example.

### Patch Changes

- Updated dependencies [90e11f7]
  - @nodaro/prompts@1.37.1

## 2.24.0

### Minor Changes

- 9402962: - `client.characters.generate({ attachPortrait: false })`: a candidate-only portrait take. The job completes and lists in the character's `portraitCandidates` / `previousCandidates` like any other, but the worker never writes it to the portrait; only `approvePortrait()` does.
  - `client.characters.get(id, { candidates: "all" })` (`GetCharacterOptions`): `previousCandidates` also carries the current portrait's own take, flagged `isPortrait: true` (the alternates stay at most 5; the default still leaves the current portrait out). Every `previousCandidates` entry gains optional `provider`, `aspectRatio` and `isPortrait`.

### Patch Changes

- Updated dependencies [c82a744]
  - @nodaro/shared@3.29.0

## 2.23.0

### Minor Changes

- db3a4ed: Pitch & Tempo (`pitch-tempo`): shift pitch by semitones and change tempo without changing pitch (Rubber Band), on audio or video.

  - `@nodaro/shared`: the per-minute pricing helpers (`PITCH_TEMPO_PRICING`, `PITCH_TEMPO_LIMITS`, `pitchTempoCreditId`, `pitchTempoStartedMinutes`, `parsePitchTempoCreditId`, `pitchTempoBaseCredits`, `semitonesToPitchRatio`); `pitch-tempo` joins `DYNAMIC_PRODUCER_TYPES` and `AUDIO_PRODUCER_TYPES`.
  - `@nodaro/sdk`: `client.audio.pitchTempo({ audioUrl | videoUrl, semitones?, tempo?, preserveFormants? })` → `POST /v1/pitch-tempo`.
  - `@nodaro/cli`: `nodaro audio pitch-tempo --audio <url>|--video <url> [--semitones] [--tempo] [--no-preserve-formants]`.

- 3ddd7d7: Video Mask and Mask Composite. `@nodaro/shared` adds the wire contracts (`VideoMaskRequest`, `VIDEO_MASK_LIMITS`, `videoMaskCreditId`, `MaskCompositeRequest`, `MASK_COMPOSITE_*`, `resolveMaskCompositeSettings`); `@nodaro/sdk` adds `media.videoMask()` (`POST /v1/video-mask` — a text-prompted SAM 3 mask video) and `media.maskComposite()` (`POST /v1/mask-composite` — a foreground video over a background video through a mask); `@nodaro/cli` adds `nodaro media video-mask` and `nodaro media mask-composite`.
- 99e7ae6: Video Mask: SAM 3.1 (`provider: "sam-3.1"`, the new default) beside SAM 3, and clips up to 5 minutes (segmented in 60-second chunks); `VIDEO_MASK_DEFAULTS`, new price rows per model and length. Mask Composite is priced per started 5 seconds of its result (`maskCompositeUnits`, `MASK_COMPOSITE_UNIT_SEC`). `nodaro media video-mask --model`.

### Patch Changes

- Updated dependencies [db3a4ed]
- Updated dependencies [3ddd7d7]
- Updated dependencies [99e7ae6]
  - @nodaro/shared@3.28.0

## 2.22.0

### Minor Changes

- 63e91d0: Collection records know whether they were used, and a delete moves a record to the collection's Trash instead of removing it.

  - `usedAt` / `usedBy` and `deletedAt` on every record; `usage` (`all` / `unused` / `used`), `status` (`active` / `trash`), `until`, `order`, and numbered pages (`offset`, with the result's `total`) on the records list; `usedCount` and `trashCount` on a collection; the saving workflow's name and project on a record's `source`.
  - `PATCH /v1/collections/:id/records/:recordId` (`{ used }`) marks one; `DELETE …/records/:recordId` moves it to the Trash; `POST …/records/:recordId/restore` brings it back; `DELETE …/records/:recordId/permanent` deletes a record already in the Trash for good; `POST …/records/bulk` (`{ ids, action: "trash" | "restore" | "delete" }`) does any of those for up to 100 at once.
  - Save to Collection reads a `mediaUrl` (with `mediaKind`) into the record's media.
  - SDK: `collections.records({ usage, status, until, order, offset })`, `collections.setUsed`, `collections.deleteRecord` (to the Trash), `collections.restoreRecord`, `collections.deleteRecordForever`, `collections.bulkRecords`. CLI: `collections records --usage --status --until --order --offset`, `collections mark-used`, `collections remove [--forever]`, `collections restore`, `collections export --until --usage`.

### Patch Changes

- Updated dependencies [ea4b6ca]
- Updated dependencies [51afaf9]
- Updated dependencies [174047e]
- Updated dependencies [63e91d0]
- Updated dependencies [8e9b058]
- Updated dependencies [70ed87f]
- Updated dependencies [16d1284]
- Updated dependencies [8c9fa49]
- Updated dependencies [710f392]
- Updated dependencies [e6d25de]
- Updated dependencies [d72e045]
- Updated dependencies [dc1075b]
- Updated dependencies [d72e045]
- Updated dependencies [326978f]
  - @nodaro/shared@3.27.0
  - @nodaro/prompts@1.36.0

## 2.21.1

### Patch Changes

- b4dce5a: Image models are now chosen by role, from one table: `IMAGE_MODEL_ROLE_DEFAULTS` (characters, general text-to-image and video anchors on `gpt-image-2`; edits on `gpt-image-2-5-flare-i2i`) and `defaultImageModel(role, aspectRatio)`. A ratio the role's model can't draw moves to the next model in `IMAGE_MODEL_RATIO_FALLBACKS` that can: GPT Image 2.5 Sunburst for 21:9, 3:2, 2:3 and other wide or in-between ratios, Nano Banana Pro for 4:5 / 5:4. Nano Banana Pro is no longer a default; it remains the last ratio fallback and the safety-block retry. Decided 2026-10-08 from a blind five-model comparison, quality first.

  The catalog's quick recommendations follow the same comparison: GPT Image 2 for typography and highest fidelity, GPT Image 2.5 Flare i2i for edits. GPT Image 2 is the featured image model in place of Nano Banana Pro.

  `@nodaro/prompts`: all 97 factory presets that ran on Nano Banana Pro moved, by role, after a preset re-test:

  - GPT Image 2 for boards, character sheets, portraits from a photo, product, scenes and the Cast & Consistency grids.
  - GPT Image 2.5 Sunburst where the preset is 2:3.
  - Nano Banana 2.1 for 4:5 presets and labelled illustrated sheets.
  - GPT Image 2.5 Flare (`-i2i` on Modify Image) for the Edits and Stylized Subject presets.

  `@nodaro/cli` and `@nodaro/sdk`: help text and examples name the new default.

- 4a2d2dc: LLM calls are priced on the lane they run on. `llmServesDirect(modelId, reasoningEffort, advancedMode)` is new: a call runs on the vendor's own API when Advanced mode is on, or when it carries a reasoning effort on a model whose effort only works there (`LlmModelDef.effortRequiresDirect` — the Claude family). `buildLlmCreditIdentifier` bills such a call one rung up on the new four-rung ladder `LLM_CREDIT_RUNGS` (`economy` / `standard` / `premium` / `premium-direct`), so a premium model served direct now bills `<feature>:premium-direct`; `llmCreditIdForRung` and `llmTierCreditIds` list the ids. `supportsAdvancedMode` now also covers models with a direct Anthropic lane (Claude), and `ADVANCED_MODE_UNAVAILABLE_REASON` says so. Every Claude model is KIE-first (`preferKie`), and `gemini-3.1-pro` is no longer direct-first. `CONTENT_RECIPE_IDEAS_CREDIT_IDS` gains the `:premium-direct` ids. The SDK's prompt-helper docs and the CLI's `--advanced` help say Advanced mode covers Gemini and Claude models.
- Updated dependencies [09bd431]
- Updated dependencies [b4dce5a]
- Updated dependencies [28960d7]
- Updated dependencies [4a2d2dc]
- Updated dependencies [4a2d2dc]
- Updated dependencies [f24b666]
- Updated dependencies [8c938fa]
  - @nodaro/shared@3.26.0
  - @nodaro/prompts@1.35.0

## 2.21.0

### Minor Changes

- 0320eec: `PublishedApp.perItemCredits`: credits for each item beyond the creator's saved items of a list input the app's user fills. `PublishedAppDetail.runEstimatedCredits`, `runPerMinuteCredits` and `runPerItemCredits`: the app run alone, the listed price less its Render final part. All optional and additive. `PublishedAppDetail.editPlanPerMinute`: whether the server charges Edit Plan per started minute of the recording (otherwise in steps); optional and additive.
- 0320eec: Listing prices per minute of the recording: `TemplateBrowseCard.estimatedPerMinuteCredits`, `TutorialFlowItem.estimatedPerMinuteCredits` and `PublishedApp.perMinuteCredits` (with `PublishedApp.estimatedCredits`). When the per-minute figure is above 0 the listed price follows the length of the recording the template or app is given: the fixed `estimatedCredits` plus that many credits per minute. All optional and additive.

### Patch Changes

- 1f414c9: ElevenLabs Dialogue v4's total-character cap across lines rises from 5,000 to 10,000 (`getDialogueCapabilities("elevenlabs-dialogue-v4").maxChars`): a 10,000-character v4 dialogue was voiced whole in a live check on 2026-10-06, well inside the platform's time limit. v3 dialogue stays at 5,000. The SDK's `voices.textToDialogue()` JSDoc and `nodaro voice dialogue --help` state each model's own cap.
- Updated dependencies [b9e7c8a]
- Updated dependencies [1f414c9]
- Updated dependencies [cd26efd]
- Updated dependencies [23a9098]
- Updated dependencies [d61bff7]
- Updated dependencies [a36adeb]
- Updated dependencies [1f21d46]
- Updated dependencies [1766435]
- Updated dependencies [887bfdf]
- Updated dependencies [cec354b]
  - @nodaro/shared@3.25.0
  - @nodaro/prompts@1.34.0

## 2.20.0

### Minor Changes

- a451774: `edit.applyEdl` accepts an optional `clipKey`: the plan clip a render cuts (`edlSpanKey(clip)` from `@nodaro/shared`). The job's result carries it back as `output_data.clipKey`, beside `output_data.quality` (`"proxy"` for a preview, `"final"` otherwise), which every Apply EDL result now carries. Additive.
- c48a85e: `edit.applyEdl` accepts an optional `planBasis`: the plan value a render cuts (`renderReadBasis(value)` from `@nodaro/shared`, 16 lowercase hex digits). The job's result carries it back as `output_data.planBasis`, beside `output_data.renderBasis`, which the server stamps on every Apply EDL result (the render's output, crossfade and effective sources). Additive.
- 9d492ee: Collections — where a workflow's records live. A collection is a named set of records (a title, a text, a link, media links, extra fields, provenance) that a workflow writes to and reads back; text and links only, never files. The same link saved twice is one record; past the plan's cap the oldest records are evicted after a write.

  - `@nodaro/shared`: `Collection`, `CollectionRecord`, `CollectionMedia`, `CollectionRecordSource`, the caps by tier (`COLLECTION_TIER_CAPS`, `collectionCapsForTier`), the wire shapes (`ListCollectionsResult` with `available` and `caps`, `ListCollectionRecordsResult`, `AddCollectionRecordInput` / `AddCollectionRecordResult` with `outcome: "inserted" | "duplicate" | "replayed"` and `evicted`), and the one rule every surface renders records with: `collectionRecordHeadline`, `collectionRecordsDigest(records, "headlines" | "full")`, `ingestRecordFromJson(item)` (any JSON item — a feed post, a search result, an article object — mapped to a record), `normalizeDedupeKey`, `normalizeCollectionMedia`, `normalizeCollectionFields`, `isCollectionUrl`.
  - `@nodaro/sdk`: `client.collections` — `list`, `get`, `create`, `update`, `delete`, `records`, `addRecord` (with an `idempotencyKey`), `deleteRecord`, `export` (CSV or JSON text).
  - `@nodaro/cli`: `nodaro collections list | create | show | update | delete | records | add | remove | export`.

- 023327b: Competitors over time. Scans are kept for a window that follows the plan (`CompetitorListResult.historyMonths` on the list; `client.competitors.listWithPlan()`), every platform tally carries the account's `followers`, `client.competitors.get(id, { scan })` opens a brand as of one scan, `history(id)` (`CompetitorHistory`) is the brand's scans oldest first with what each found and read per platform, and `compare(id, { from, to, vsFrom?, vsTo? })` (`CompetitorCompareResult`) answers one or two periods: posts by publish date, usual reach, followers and their change, what worked, the best posts. The CLI gains `competitors history <id>` and `competitors compare <id> --from --to [--vs-from --vs-to]`.
- 94c1fbf: Runs that find nothing new end `completed` with `outcome: "nothing_new"` instead of failing. A text-requiring node (`llm-chat`, `generate-script`, `text-to-speech`, `generate-music`, `text-to-audio`, the legacy `ai-writer`) whose wired text came from a node that produced nothing in this run is skipped with `skipReason: "empty_input"` on its node state, and the nodes behind it are skipped with it.

  - `@nodaro/shared`: `NodeSkipReason`, `skipReason` on `NodeExecutionStateWire`, `ExecutionOutcome` + `executionOutcome(status, nodeStates)` + `countEmptyInputSkips(nodeStates)` (the one rule every surface derives the outcome with — never a stored column), `__runSkipReason` among the transient runtime keys.
  - `@nodaro/sdk`: `WorkflowExecution` / `WorkflowExecutionSummary` gain `outcome?: "succeeded" | "nothing_new"`; `nodeStates[id].skipReason`; `executionOutcome`, `countEmptyInputSkips`, `NodeSkipReason` and `ExecutionOutcome` re-exported.
  - `@nodaro/prompts`: `TEXT_REQUIRED_NODE_TYPES`, `computeNodeSendText(type, data, args)` and `computeAiWriterInput(data, args)` — what a text-requiring node would send, by its executor's own rule.

- 1d106aa: Character references on the video lanes. `@nodaro/shared`: the `VideoCharacterReference` type (portrait `imageUrl`, optional `bodyImageUrl`, `description`, optional `name`), a `characters` cap on `VIDEO_REF_LIMITS_BY_PROVIDER` (3 on `gemini-omni-video` and `gemini-omni-flash`), and the helpers that apply it: `videoCharacterRefCap`, `videoCharacterRefProviders`, `videoCharacterRefUnits` and `videoCharacterRefProblem` (provider support, the start- and end-frame limits, and the shared 7-unit input budget). `@nodaro/sdk`: `characterReferences` on `GenerateVideoParams` and `TextToVideoParams`, and the `VideoCharacterReference` type re-exported. Additive. Pinned voices: an optional `voice` on each character reference (`VideoCharacterVoice`: a `preset` from `GEMINI_OMNI_VOICE_PRESETS` / `GEMINI_OMNI_VOICE_PRESET_IDS` — the 30 Gemini voice ids with their gender / style / pitch labels, exported as data — plus an optional `description` and `exampleLine`), a `voices` cap on `VIDEO_REF_LIMITS_BY_PROVIDER`, and `videoCharacterVoiceCap` / `videoCharacterVoiceKey` / `videoCharacterDistinctVoices` / `videoCharacterVoiceProblem`. `@nodaro/sdk`: `VideoCharacterVoice` and `GeminiOmniVoicePresetId` re-exported.
- ceca5b3: `audio.mix` accepts an optional `duck`: every track except `duck.under` (the voice) dips while that track is loud and rises back in its pauses, so a music bed sits under speech. `amount` (0-100) sets how hard; `thresholdDb`, `ratio`, `attackMs` and `releaseMs` are optional fine controls. The CLI gains `nodaro audio mix --duck-under <index> [--duck-amount <0-100>]`. Additive; a mix without `duck` is unchanged.
- 989c285: Render final for agents. `workflows.renderFinal(id, { renderNodeId, continueFromExecutionId })` renders the final of an Apply EDL render whose run stopped at its preview: the render at Final for that run only, and every node after it (Camera Switch first, in multicam), continuing that execution. The server works out which nodes run, by the same rule as the editor's Render final button, so the caller sends only the render and the execution. `workflows.estimateRenderFinal(id, params)` quotes it first — the nodes it runs, the override it runs with, its estimated credits and whether the payer can cover them (`sufficient`, `available`) — without creating anything; a Render final its payer cannot cover throws `InsufficientCreditsError` before any execution exists. `@nodaro/shared` adds the stable refusal codes `RENDER_FINAL_NODE_NOT_FOUND`, `RENDER_FINAL_NOT_A_RENDER` and `RENDER_FINAL_CODES`. Additive.
- 2047248: A run can continue from an earlier execution. `workflows.run(id, { nodeIds, continueFromExecutionId })` runs only `nodeIds`; every other node hands on what that execution produced (an Edit Plan's plan with the person's review applied), never the workflow's saved results. Render final after a run that stopped at its preview is one: `{ nodeIds: [renderId, ...tail], inputOverrides: { [renderId]: { quality: "final" } }, continueFromExecutionId }`. The execution must be the caller's own completed run of the same workflow and the same version of its graph. `@nodaro/shared` adds the stable refusal codes `CONTINUATION_SUBSET_REQUIRED`, `CONTINUATION_NOT_FOUND`, `CONTINUATION_WORKFLOW_MISMATCH`, `CONTINUATION_VERSION_MISMATCH`, `CONTINUATION_NOT_COMPLETED`, and `RUN_CONTINUATION_CODES`. Additive.
- fd20c51: `voices.textToDialogue` and `nodaro voice dialogue` can choose the dialogue model (`elevenlabs-dialogue`, the default, or `elevenlabs-dialogue-v4`) and send similarity; stability is any 0–1 value on v4 and 0, 0.5 or 1 on v3. The SDK's `stability` type widens from `0 | 0.5 | 1` to `number` (source-compatible for existing callers).
- 9c2120c: `workflows.run(id, { inputOverrides })`: per-node field overrides for one run, `{ [nodeId]: { field: value } }`. A workflow whose Apply EDL render is set to Preview is refused through the API (`preview_review_required`) unless the run sets it to Final with `{ [renderNodeId]: { quality: "final" } }`.
- 7dd35ec: `nodes.run("text-to-speech", …)` and `runAndWait` are typed (`TextToSpeechParams`) and take `previousText` / `nextText` — the lines spoken just before and after the clip, so a model that stitches (ElevenLabs v4, Turbo v2.5 and Multilingual v2; not v3) keeps one continuous intonation across clips produced separately. Up to 1,000 characters each. The CLI's `nodes run` help shows the two parameters.
- 63fade1: `VoiceChangerProVoice.engine` (the per-voice setting of `voices.recast`) now also takes `"v4"`: Re-speak on the newer model — the performance is regenerated from the transcript like `"v3"`, with any `stability` from 0 to 1 and `similarityBoost` honoured (`style` / `useSpeakerBoost` ignored); each line is generated with its neighbouring lines as context for smoother joins. Priced like a `"v3"` Re-speak voice, per started 1,000 characters. `"v3"` is unchanged. Requires a Nodaro Cloud release that accepts the engine.

### Patch Changes

- 0be3860: Export `NodeSkipReason` and `ExecutionOutcome` from the package root, beside the other execution types (they were only reachable through the executions resource module).
- 68f8146: `nodaro edit apply-edl` takes `--clip-key <key>`: the plan clip a render cuts (`"<first inMs>-<last outMs>"` of a clips-mode plan clip), passed as `clipKey` and stamped back on the job's result, as `edit.applyEdl` already allowed. The SDK's `edit` resource documentation now describes the multicam flow (`audioSync` → `editPlan` → `cameraSwitch` → a Preview, then the final) and that `cameraSwitch` relays from a connected self-hosted install like `editPlan`. Additive.
- 835c6d3: `WorkflowExecution` / `WorkflowExecutionSummary` (from `client.executions.get` / `listForWorkflow`) gain `kind`: `"execution"` for an orchestrator run, `"job"` for a single-node job the list shows beside the runs. `ExecutionTriggerType` now also names the `telegram`, `telegram_account`, `api` and `mcp` lanes the server already reported. Types only: no call changed.
- ff32a3f: Document `output_data.transcript` on text-to-dialogue jobs (per-word timings and per-line speakers on every dialogue model) and the `withTimestamps` request field of text-to-speech.
- 1a11a27: `edit.editPlan` docs: a `"trailer"` plan's `output_data` is one `Edl`, like `"tighten"`, and `targetAspect` also applies to the teaser.
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [3bec25f]
- Updated dependencies [9d492ee]
- Updated dependencies [023327b]
- Updated dependencies [9cb2a0d]
- Updated dependencies [86df84c]
- Updated dependencies [8777f7b]
- Updated dependencies [1a11a27]
- Updated dependencies [8777f7b]
- Updated dependencies [1a11a27]
- Updated dependencies [fd20c51]
- Updated dependencies [94c1fbf]
- Updated dependencies [9cb2a0d]
- Updated dependencies [1d106aa]
- Updated dependencies [835c6d3]
- Updated dependencies [3b4e26c]
- Updated dependencies [c91946b]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9c2120c]
- Updated dependencies [1e1ef73]
- Updated dependencies [989c285]
- Updated dependencies [829dc76]
- Updated dependencies [c48a85e]
- Updated dependencies [c48a85e]
- Updated dependencies [a451774]
- Updated dependencies [2047248]
- Updated dependencies [7603c20]
- Updated dependencies [747151b]
- Updated dependencies [ff32a3f]
- Updated dependencies [d81639f]
- Updated dependencies [7dd35ec]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
  - @nodaro/shared@3.22.0
  - @nodaro/prompts@1.31.0

## 2.19.0

### Minor Changes

- 3fb30e4: Competitors, platform by platform. `CompetitorCardsResult.brands` gives each tracked brand's latest scan per platform (`CompetitorBrandTally`: the scan id, its time and one `CompetitorPlatformTally` per platform — the brand's own posts and posts about it there, the searches that ran and the ones that failed, its usual reach with its unit, and the strongest lesson). `CompetitorDetail.platforms` gives the same for one brand, and `TrackedCompetitor.searchPlan` lists what its next scan searches (`CompetitorSearch`). All three are optional: a server older than them leaves them out. The SDK re-exports the new types.

### Patch Changes

- Updated dependencies [3fb30e4]
- Updated dependencies [605638c]
- Updated dependencies [6e2cfac]
  - @nodaro/shared@3.20.0

## 2.18.0

### Minor Changes

- 470cbe2: Add `edit.cameraSwitch({ edl, transcript, speakerMap?, speakerNames?, minShotMs?, leadMs?, maxShotMs?, wideEvery?, layoutHints? })`: put each cut of an EDL on the camera of whoever is speaking (Cloud; flat price). A transcript with no speaker labels rejects with a `NodaroError` (`code: "no_speakers"`) before any request.
- ba1ae16: Did it work? "I did this" on an action card, and how it went. `@nodaro/shared` adds the mark types (`CardAction`, `CardActionResult`, `CardOutcome`, `CardOutcomeState`, `CardSnapshot`, `CardVerdict`, `AdviceRecord`, `AdviceFamily`, `CompetitorActionsResult`, `MarkCardInput`, `UpdateCardActionInput`, `CARD_OUTCOME_STATES`, `ADVICE_FAMILIES`), `adviceFamilyOf` and `isMeasurableCard`, and `CompetitorCardsResult.record`. `@nodaro/sdk` adds `client.competitors.tried()`, `markDone(cardId, { postUrl })`, `linkPost(markId, url | null)`, `markSeen(markId)` and `unmark(markId)` (`/v1/competitors/actions*`), and re-exports the lesson and mark types. `@nodaro/cli` adds `nodaro competitors done`, `tried`, `link` and `undo`, and `cards` shows the id to mark a card done.
- d80feff: What works for a brand (stage 4 of the research rollout): `@nodaro/shared` adds the lesson types (`BrandLesson`, `BrandPlatformLessons`, `BrandLessons`, `CompetitorLessonsResult`, `BRAND_LESSON_KINDS`); `@nodaro/sdk` adds `client.competitors.lessons(id)` (`GET /v1/competitors/:id/lessons`); `@nodaro/cli` adds `nodaro competitors lessons <id>`.

  `socialSearchPostVideo` answers `{ kind: "none" }` for an image or a text post, which has no video to analyze.

- 95523c6: Competitor tracking (Nodaro Cloud): `@nodaro/shared` adds the tracked-brand, scan and action-card shapes, the card `kind` vocabulary and the scan price (`competitor-scan:<n>`, one Social Search page per search). `@nodaro/sdk` adds `client.competitors` (`list`, `get`, `create`, `update`, `delete`, `cards`, `discover`, `scan`) and re-exports the types. `@nodaro/cli` adds `nodaro competitors` (`list`, `add`, `discover`, `scan`, `cards`, `show`, `update`, `remove`).
- 17d734b: `edit.editPlan` takes `offsets` (an `audioSync` result over the same source ids) and `transcriptSourceId`. The measured offsets are written onto the sources before the request; a source that was not measured or matched weakly, an unmeasured master, or a transcript made from a source off the master's clock rejects with a `NodaroError` (`code: "edit_plan_sources"`) before any request or charge.
- 086003b: Pipelines: `approveSubGate` could never clear Stage 6's `match_cut_break_pending`. The sub-gate routes only resolve Stage 7's gates, and that gate clears one break at a time.

  - `@nodaro/shared`: `ANIMATE_SUB_GATES` / `AnimateSubGateSchema` / `AnimateSubGate` are the sub-gates `POST /v1/pipelines/:id/sub-gates/:gate/{approve,reject}` resolves (`silent_cut_preview`, `dialogue_recheck`), and `MATCH_CUT_BREAK_GATE` names the one that clears per break. The routes answer the match-cut gate with a 400 `invalid_sub_gate` that names the helper route, instead of a 404 or 409.
  - `@nodaro/sdk`: `pipelines.acceptMatchCutBreak(id, sceneId, shotId)` accepts one break (`POST /v1/pipelines/:id/entities/:sceneId/helpers/accept_match_cut_break`) and returns how many are left. `approveSubGate` now takes an `AnimateSubGate`.
  - `@nodaro/sdk`: the entry point exports the types its resources re-export but it did not: `PipelineInput`, `PipelineStatus`, `PipelineMode`, `SubGateName`, `AnimateSubGate`, `ChatEnabledStage`, `ProposedChange` and `CommunityFullDetail`.

- df2f7b4: Saved posts, the inspiration wall: `@nodaro/shared` adds the `SavedPost` shape and the request and answer types of `/v1/saved-posts`. `@nodaro/sdk` adds `client.savedPosts` (`list`, `save`, `lookup`, `update`, `delete`) and re-exports the types. `@nodaro/cli` adds `nodaro saved-posts` (`list`, `save --file`, `update`, `delete`).
- 5b8496b: The SDK's types and docs now match the server.

  - `runAndWait` / `runMany` take `cancelOnAbort: true` to also cancel the job (and release its credit hold) when `signal` aborts. Without it, aborting stops only the waiting: the job keeps running and is charged. The `JobAbortedError` now always carries the `jobId` once the job was submitted.
  - `DeveloperAppScope` is `OAuthScope` from `@nodaro/shared`, the server's own list. It gains `presets:read`, `workspaces:read` and `workspaces:write`.
  - `recast.estimate` / `create` / `start` type `segmentSec` as `RecastSegmentPack` (`"max" | "scenes-max" | "scenes"`), the values the server accepts, and the entry point exports them as `RECAST_SEGMENT_PACKS`. It was typed as a number of seconds, which the server rejects.
  - The entry point exports `RecastSegmentPack`, plus 20 types that resource methods take or return but callers could not import: `CreatureVoice`, `GenerateLocationMotionInput`, `ModelFamilyGroup`, `ReferenceCaptionParams`, `AssembleNarratedVideoParams`, `RunNodeOptions`, `TextToPickerParams`, `TextToPickerResult`, `PipelineRecord`, `PendingApproval`, `PipelineTimeline`, the five `Pro3DRender*` types, `Collaborator`, `AddCollaboratorInput`, `SharedWorkflow` and `DroppedCollaborator`.
  - The README links nodaro.ai/docs, and its agent primer matches the raw copy again (the voice and audio section was missing; voice cloning, retired, is gone from it).

- 10d0467: Social Search (Nodaro Cloud): `@nodaro/shared` adds the node's vocabulary, the `SocialPost` shape every platform's results share, the `SocialSearchParams` request, its credit ids and the rule for which posts a run passes on. `@nodaro/sdk` types `nodes.run("social-search", …)` and `nodes.runAndWait("social-search", …)` (resolving `SocialSearchJobOutput`) and re-exports the post and request types.
- 09b138b: `StudioProductionCapabilities.operations` gains the optional `mediaSlots` and `clipSlotInputs` flags. An older host omits them; read an absent flag as `false`.
- 524c266: Transitions can declare their own options, and the wipe gains a Direction. A catalog row may now carry `options` (each `{ field, label, choices }`, `auto` first) and a `promptTemplate` with one `{<field>}` token per option; its `promptHint` is the template on every `auto` choice, so plain readers still see a finished sentence. The `wipe` row declares `WIPE_DIRECTION` (`wipeDirection`: `auto`, `left-to-right`, `right-to-left`, `top-to-bottom`, `bottom-to-top`, `top-left-to-bottom-right`, `top-right-to-bottom-left`). `composeTransitionHintFromConnections` takes the choices as `options.optionValues`, `renderTransitionBases` as a third argument, and `getTransitionPromptHint` as a second; a transition node's `wipeDirection` is read by `getParameterPromptHint`. New exports: `WIPE_DIRECTION`, `getTransitionOptions`, `TRANSITION_OPTION_FIELDS`, `readTransitionOptionValues` and the `TransitionOption` / `TransitionOptionChoice` / `TransitionOptionValues` types. The picker catalog publishes a row's options on that option as `params`, and the wire projection (`GET /v1/picker-catalogs/:nodeType`, the MCP `get_picker_catalog` tool) carries them at both detail levels — `@nodaro/shared`'s `ProjectedCatalogOption` and the SDK's `PickerOption` gain the optional `params`.

  **Prompt wording change (wipe):** the wipe's default description now reads "a clean straight edge sweeps across the frame" instead of "a clean diagonal line sweeps across the frame"; a chosen direction replaces that phrase (for example "a clean vertical edge sweeps across the frame from left to right").

  **Style (seven rows).** `debris-shower`, `garden-bloom`, `smoke-puff`, `sakura-petals`, `aurora-sweep`, `sand-storm` and `white-flash` each declare a **Style** — one `style` field shared by the styled rows, with each row's own looks as its choices. A styled row's `promptTemplate` is `{style}`: a choice's `phrase` is the row's whole description, so a style swaps the look rather than a phrase. `auto` is the row's DEFAULT look and is labelled with its name ("Full cover (default)"); every other id starts with its row's id (`debris-shower-light-sweep`), so a stored style never carries to another row, and a foreign or unknown id reads as the default. New exports: `TRANSITION_STYLE_FIELD`, `DEBRIS_SHOWER_STYLE`, `GARDEN_BLOOM_STYLE`, `SMOKE_PUFF_STYLE`, `SAKURA_PETALS_STYLE`, `AURORA_SWEEP_STYLE`, `SAND_STORM_STYLE`, `WHITE_FLASH_STYLE`. The looks (default first): debris-shower Full cover / Light sweep; garden-bloom Grow & part / Hedge doors; smoke-puff Engulf / Full cover; sakura-petals Swirling veil / Side sweep; aurora-sweep Sky glow / Veil; sand-storm Full cover / Light sweep; white-flash Flash / Overexposure. `white-flash`'s default look is a new description (a camera-flash pop to white that holds, then fades down to the second shot), so a white-flash pick with no style now renders it; its previous description is the Overexposure look. Each body is the text a tested take was generated from. On the canvas, a two-pick of two styled rows shows one Style control holding both rows' looks.

  **Prompt wording change (Style):** `debris-shower`'s default description is now its tested "Full cover" body (the old body stays available as the "Light sweep" style), and `white-flash`'s is its tested "Flash" body (the old body stays available as the "Overexposure" style). Every other styled row's default is its existing text — `aurora-sweep`'s is the body 1.26.1 already ships, and its pre-1.26.1 body returns as the "Veil" style — so picks with no style keep their words. No other row changes.

### Patch Changes

- e98ff5b: Advanced mode's help text now says its one-tier credit bump is capped at premium: a request already at the premium tier stays there.
- 8dc01f1: Listed prices are now the prices a run is charged. `GET /v1/models` (`client.models.list()`), `GET /v1/nodes` (`client.nodes.list()` / `get()`) and the MCP `list_models` tool serve the same credits as the node's Run button, where they used to list the catalog's base price. The field docs say so: `PriceVariant.credits` is the catalog's list price, and the SDK's `pricing` and `creditCost` are the charged price.
- Updated dependencies [470cbe2]
- Updated dependencies [8dc01f1]
- Updated dependencies [ba1ae16]
- Updated dependencies [d80feff]
- Updated dependencies [95523c6]
- Updated dependencies [5f14bf9]
- Updated dependencies [17d734b]
- Updated dependencies [3134831]
- Updated dependencies [bac18b7]
- Updated dependencies [ec71996]
- Updated dependencies [10054f4]
- Updated dependencies [086003b]
- Updated dependencies [3e8a8dc]
- Updated dependencies [5b8496b]
- Updated dependencies [d1c208e]
- Updated dependencies [5e636b4]
- Updated dependencies [1197130]
- Updated dependencies [df2f7b4]
- Updated dependencies [8905992]
- Updated dependencies [2a61d66]
- Updated dependencies [20edcd9]
- Updated dependencies [08c60ee]
- Updated dependencies [3d9bae0]
- Updated dependencies [10d0467]
- Updated dependencies [fa682e5]
- Updated dependencies [09b138b]
- Updated dependencies [7363396]
- Updated dependencies [420aaa2]
- Updated dependencies [028f3ef]
- Updated dependencies [00ff1cf]
- Updated dependencies [8d61db1]
- Updated dependencies [8096ebe]
- Updated dependencies [5f0cbab]
- Updated dependencies [255d9e0]
- Updated dependencies [8d1e320]
- Updated dependencies [3bae2cb]
- Updated dependencies [43ea304]
- Updated dependencies [f801037]
- Updated dependencies [9377f6e]
- Updated dependencies [693baee]
- Updated dependencies [f801037]
- Updated dependencies [778de30]
- Updated dependencies [d127205]
- Updated dependencies [524c266]
  - @nodaro/shared@3.15.0
  - @nodaro/prompts@1.28.0

## 2.17.0

### Minor Changes

- 029f594: Picker options now come with their pictures. Every option that has a picture carries an absolute `imageUrl` in `GET /v1/picker-catalogs/:nodeType`, `GET /v1/catalogs` and the MCP `get_picker_catalog` tool: the photos of the Person, Styling, Held Prop, Material and Animal pickers and the art of the music and voice pickers, served by the installation itself on its public address, plus — on Nodaro Cloud only — a still of each look picker's rendered preview from the Nodaro CDN. An option without a picture has no `imageUrl`. Person and Styling also return `sections`: the topics their settings are grouped under, in order, each with its round picture. The directory (`GET /v1/picker-catalogs`) adds `imageCount` per picker.

  - `@nodaro/shared`: `ProjectedCatalogOption.imageUrl`, `ProjectedCatalog.sections`, `ProjectedCatalogSection`.
  - `@nodaro/prompts`: the picture maps move here (`CHARACTER_ART_FILES`, `SOUND_ART`, `SOUND_ART_FILES`, `LOOK_PREVIEW_SETS`) with their path helpers, `STYLING_DIMENSION_SECTIONS`, and an `images` option on `projectPickerCatalog`, `projectAllCatalogs` and `summarizePickerCatalogs` (`imageCount` on `PickerCatalogSummary`).
  - `@nodaro/sdk`: `PickerOption.imageUrl`, `PickerCatalog.sections` (`PickerCatalogSection`), `PickerCatalogSummary.imageCount`; the same on the `catalogs` types. `client.catalogs.list()` now returns `CatalogsListResponse` — `{ curated, packs, version, data? }` — which is what the server has always sent: `data` is absent when the deployment registered no catalog packs.
  - `@nodaro/cli`: `nodaro pickers list` shows how many options of each picker have a picture.

### Patch Changes

- Updated dependencies [029f594]
- Updated dependencies [fe35884]
- Updated dependencies [6bfd179]
- Updated dependencies [9f90e8c]
- Updated dependencies [79609a9]
  - @nodaro/shared@3.14.0
  - @nodaro/prompts@1.27.0

## 2.16.0

### Minor Changes

- 0634fd8: Add `client.edit.audioSync({ sources, reference? })` (`POST /v1/audio-sync`): measure how far apart the clocks of 2–6 recordings of one conversation are, from their sound. The finished job's `output_data.json` is an `AudioSyncResult` — `{ version, reference, offsets: [{ sourceId, offsetMs, confidence, driftMsPerHour }], notes }`, with `referenceMs = sourceMs + offsetMs`. New types: `AudioSyncInput`, `AudioSyncSource`, `AudioSyncOffset`, `AudioSyncResult`.

## 2.15.0

### Minor Changes

- 7872bd7: Video Overlay: `client.media.videoOverlay(input)` (`POST /v1/video-overlay`) places 1–20 timed image layers over a video, and `nodaro media video-overlay <videoUrl> [layerUrls...]` exposes it (`--at <start[-end]>` per layer, `--preset`, `--corner`, `--layers-file`, `--aspect`, `--base-fit`, `--background-color`, `--watch`).

### Patch Changes

- Updated dependencies [161a68a]
- Updated dependencies [02a08ae]
- Updated dependencies [0e7624c]
- Updated dependencies [e379928]
- Updated dependencies [7872bd7]
  - @nodaro/shared@3.13.0
  - @nodaro/prompts@1.26.0

## 2.14.0

### Minor Changes

- d612708: Studio clip generation: `mode` accepts `"start-end"`.

  `StudioShotGenerationInput.mode` and `StudioGenerateRequest.mode` are now `"start" | "start-end" | "references"`. `start` sends only the start frame (a pinned end frame is not sent); `start-end` sends the start and the end frame; omit `mode` to let the scene's saved inputs decide. Requires a platform whose studio route accepts `start-end` — an older one refuses the value.

### Patch Changes

- Updated dependencies [0ea567d]
  - @nodaro/prompts@1.23.0

## 2.13.0

### Minor Changes

- 81be5f2: Captions: named "look" presets + a typed SDK `media.addCaptions()`.

  `@nodaro/shared` gains `CAPTION_LOOK_IDS`, `CAPTION_LOOKS`, `DEFAULT_CAPTION_LOOK`, `KINETIC_ONLY_CAPTION_LEVER_KEYS`, `autoStrokeWidth`, `resolveCaptionLook`, and the types `CaptionLookId`, `CaptionLookLevers`, `KineticOnlyCaptionLeverKey`. A look is a bundle of visual levers (font, weight, colour, outline, spoken-word colour, casing) so a kinetic caption reads well from one field: `outline` (Montserrat 900, uppercase, white on a black outline sized `max(2, round(fontSize·0.1))`px, yellow spoken word — the TikTok/CapCut read) and `clean` (Inter, soft shadow, no casing/outline). `resolveCaptionLook(look, explicit, fontSize)` merges an explicit lever over the look; an UNSET look resolves to `outline`. Structural/config vocabulary only — no creative doctrine.

  `@nodaro/sdk`: new `client.media.addCaptions(input)` — burns captions into a video via `POST /v1/add-captions`, with the `look` preset, the explicit look levers, and per-segment captions. New exported types `AddCaptionsInput`, `CaptionLookInput`, `CaptionSegmentInput`, `CaptionEntry`.

- a3e000a: `media.addCaptions()` gains `animate` (freeze per-word motion on kinetic styles).
- 65b4cdd: `media.addCaptions()` gains `maxWordsPerLine`, and `audio.transcribe()` takes
  every engine the route does.

  `maxWordsPerLine` (1-20) caps how many words one caption LINE — or one
  `tiktok-words` page — may hold, on top of the frame-width budget, sentence ends
  and pauses that already close a line; 1-2 gives the short, punchy read, and an
  unset value fits the width as before. It lives on `CaptionLookInput`, so it
  exists top-level AND on every `segments[]` entry, and a segment that does not
  name its own inherits the top-level value. It applies to `word-highlight`,
  `karaoke`, `bouncy` and `tiktok-words`, and — like the other STYLING levers — to
  the static `subtitle` style, which then renders through Remotion (the only path
  that groups lines at all). It is inert on `word-pop`, which is always one word.

  `audio.transcribe()`'s `provider` is `TranscribeProvider`, which now accepts
  `elevenlabs-stt`, `whisper` and `incredibly-fast-whisper` — the re-widened
  `/v1/transcribe` enum. Only the type moved; the capability did not, and the
  JSDoc now says which is which: `whisper` returns NO word timings whether you
  name it or reach it by omitting `provider`, so asking it for them
  (`wordTimestamps: true`) is a `400` at ingress, while `elevenlabs-stt` (always
  word-level, and the lane that honours `diarize` / `tagAudioEvents`) and
  `incredibly-fast-whisper` can answer. A word-timed caption render has to name
  one of those two.

  Additive — no existing call changes shape.

- a7774fc: Add the `edit` resource for the phase-1 editorial (podcast-editing) primitives.
  `client.edit` exposes:

  - `silenceDetect(input)` → `POST /v1/silence-detect` — detect silence ranges in
    an audio/video source (keyless ffmpeg pass).
  - `applyEdl(input)` → `POST /v1/apply-edl` — render an edit decision list into a
    video or audio cut, with optional positional source overrides, a transcript to
    remap, output/quality and a default crossfade.
  - `editPlan(input)` → `POST /v1/edit-plan` (Cloud edition) — plan a
    transcript-driven cut / clips / chapters from a timed transcript and media
    sources.
  - `remapTranscript(edl, transcript)` — a PURE client-side helper (no request)
    that runs `@nodaro/shared`'s `remapTranscriptThroughEdl`.

  The EDL / transcript / result vocabulary (`Edl`, `Transcript`, `EditPlanMode`,
  `EditPlanTier`, `EdlClipSet`, `ChapterSet`, `SilenceRanges`) and the
  `unwrapEditPlanOutput` result-normalizer are re-exported for one-dependency use.
  Additive — no existing surface changes.

  The `@nodaro/shared` patch bump carries no source change: it exists only to lift
  the SDK's `@nodaro/shared` floor to a version that ships `edl.ts`. The new
  resource static-imports `remapTranscriptThroughEdl` / `unwrapEditPlanOutput` from
  `@nodaro/shared`, so pairing this SDK with an older shared (pre-`edl.ts`) would
  fail the whole SDK at import — the changeset rewrites the dependency range so a
  consumer can never resolve that stale sibling.

- a610640: Add `client.audio.transcribe(input)` — the SDK's first way to reach
  `POST /v1/transcribe`.

  `transcribe({ audioUrl, provider?, language?, diarize?, tagAudioEvents?,
wordTimestamps? })` returns a job id to poll. `provider` is typed as
  `TranscribeProvider` (the ENABLED enum from `@nodaro/shared`), which holds all
  three engines the route serves. The types do not pick for you, so the JSDoc
  does: `elevenlabs-stt` is always word-level and is the lane that honours
  `diarize` / `tagAudioEvents`, `incredibly-fast-whisper` returns word timings when
  asked, and `whisper` returns none at all — named explicitly or reached by
  omitting `provider`, which still falls back to it. Asking `whisper` for word
  timings is a `400` at ingress, before any credit is spent.

  `TranscribeProvider` itself is re-exported from `@nodaro/shared` (same pattern
  as `AudioFxPreset`), so a consumer can name the type without a second
  dependency.

  Two new exported result types describe what comes back on the job:
  `TranscribeWord` (one word: `text`/`startMs`/`endMs`, plus `speaker` on a
  diarized run) and `TranscribeJobOutput` (`text`, `language`, `words`, `json` —
  the normalized `Transcript` — and `segments`). The units are the trap and are
  documented on both: `words` and `json` are in MILLISECONDS, the top-level
  `segments` are in SECONDS.

  `TranscribeWord` is deliberately the same shape as `media.addCaptions()`'s
  `CaptionEntry`, so a transcribe job's `output_data.words` can be handed to
  `addCaptions({ captions, autoTranscribe: false })` verbatim — correct a word's
  `text` in between and the correction is what burns in. `addCaptions`' JSDoc
  gained one sentence pointing at that composition and at the fact that a word's
  `startMs`/`endMs` is its SPOKEN window (what times the `word-highlight`
  highlight), not how long its line is on screen.

  Additive — no existing surface changes.

- 1c8b7de: Video URL node + social-video import: `@nodaro/shared` gains `video-link.ts` — the social-video host allowlist (`SOCIAL_VIDEO_HOSTS`, `YOUTUBE_HOSTS`, `INSTAGRAM_HOSTS`, `hostnameMatchesAllowlist`, `isSocialVideoUrl`, `detectVideoLinkPlatform`; exact-host matching, one list for the server's download gate and the editor), `hasUrlParserHazard` (a link carrying a backslash or a control character is one that URL parsers read differently, and is refused as a video link), the node's output rule (`resolveVideoLinkOutput`, `videoLinkDownloadedFile`, `videoLinkNeedsDownload` — a downloaded file is emitted only when it belongs to the node's current link) and `VIDEO_LINK_TOLERANT_CONSUMER_TYPES` (the node types that read a Video URL node without its file). `downloadPercent` / `downloadPhase` join `TRANSIENT_RUNTIME_KEYS`, so a download's progress ticks no longer dirty or reach a saved workflow. `@nodaro/sdk`: `media.downloadVideo()` accepts `requireAudio?: boolean` — a result with no audio stream fails by default; `false` accepts a clip that really has no sound. The route also answers `429 too_many_downloads` past 4 running downloads per account.

### Patch Changes

- 06d7acf: Expose the optional shared-wallet balance on credit balance responses.
- Updated dependencies [e37fe27]
- Updated dependencies [81be5f2]
- Updated dependencies [a3e000a]
- Updated dependencies [65b4cdd]
- Updated dependencies [f75ebfe]
- Updated dependencies [00ac720]
- Updated dependencies [d1c71f3]
- Updated dependencies [2263cf6]
- Updated dependencies [a48b462]
- Updated dependencies [a48b462]
- Updated dependencies [dcaaa20]
- Updated dependencies [a7774fc]
- Updated dependencies [d4b3145]
- Updated dependencies [2b32c90]
- Updated dependencies [f86ad38]
- Updated dependencies [a49c7c6]
- Updated dependencies [6ad3d61]
- Updated dependencies [1a89eff]
- Updated dependencies [6a69e7d]
- Updated dependencies [368e95a]
- Updated dependencies [c79489e]
- Updated dependencies [a976e32]
- Updated dependencies [1126801]
- Updated dependencies [7f5159d]
- Updated dependencies [9e25b67]
- Updated dependencies [ccb8a93]
- Updated dependencies [5b9f5ed]
- Updated dependencies [a436fab]
- Updated dependencies [8efa462]
- Updated dependencies [5c672cb]
- Updated dependencies [a610640]
- Updated dependencies [8e97188]
- Updated dependencies [ccb8a93]
- Updated dependencies [74e4373]
- Updated dependencies [d4b3145]
- Updated dependencies [1c8b7de]
  - @nodaro/shared@3.12.0
  - @nodaro/prompts@1.22.0

## 2.12.0

### Minor Changes

- e5a3719: Correct character motion catalog copy, add everyday and accessible movements, bind animal and object recipients, preserve literal reference names, and expose authored sequence diagnostics and discovery metadata. Existing motion IDs remain resolvable.
- 14ef0be: `nodes.run("generate-video", …)` gains typed `frameFit`, `frameDelivery` and `endFrameUrl` fields. `frameFit` resizes a start/end frame to the model's measured output canvas before dispatch (default), and `frameDelivery` chooses frame vs bound-reference delivery (default auto, per model).

### Patch Changes

- Updated dependencies [ed142b9]
- Updated dependencies [e5a3719]
- Updated dependencies [d552b19]
- Updated dependencies [56249e3]
- Updated dependencies [14ef0be]
  - @nodaro/prompts@1.21.0
  - @nodaro/shared@3.11.0

## 2.11.0

### Minor Changes

- 026f944: Voice cloning is retired platform-wide. `@nodaro/shared` drops the `voice-clone` catalog entry and `ModelMode` member (`VoiceClone` stays — the list route still returns it). `@nodaro/sdk` keeps `voices.createClone()` / `voices.createCloneFromFile()` for source compatibility but marks them `@deprecated`: the routes now answer `410 voice_cloning_retired`. `@nodaro/cli` removes `voice clones create`; `voice clones list` / `delete` and `voice list --clones` keep working for clones made before the retirement.
- ef42aa7: A FAILED node in a workflow execution now carries what its run RETAINED.

  `NodeExecutionState.output` was an unstated convention of the COMPLETED path:
  every consumer read it under `status === "completed"`, so a run that refused its
  result and kept what it produced had nowhere to put it. The 3D-scene authoring
  lanes are exactly that case — once the repair budget is spent and the visual
  reviewer refuses, the run has already published a real, renderable revision, and
  the job settles `failed` holding it.

  - **`@nodaro/shared`** declares the contract once: `NodeExecutionStateWire` (the
    shape the orchestrator writes and every client reads), the `NodeExecutionStatus`
    union, and `OUTPUT_BEARING_NODE_STATUSES` / `nodeStateMayCarryOutput()` — the
    rule that `completed` AND `failed` may carry `output`, and nothing else can.
  - **`@nodaro/sdk`**: `NodeExecutionState` extends that wire type, so `output` is
    a typed, documented field rather than something reachable only through the
    index signature. `NodeExecutionStatus`, `OUTPUT_BEARING_NODE_STATUSES` and
    `nodeStateMayCarryOutput` are re-exported from the package root.

  Additive on the wire — a client that does not read `output` on a failed node
  sees byte-identical behaviour. Two rules for one that does: gate on the FIELD
  rather than the status, and never read a present `output` as success. The node
  failed; it failed holding something.

### Patch Changes

- 6e53ed5: Scene3D declares the ADVISORY delivery: a scene the visual reviewer refused, but
  that passed every mandatory assertion, is delivered rather than withheld once the
  repair budget is spent. The job completes, the video is real, and the refusal
  rides along in two places the delivery contract already had.

  - `metadata.review` — the whole verdict, typed as `Scene3DReviewVerdict`:
    `{ verdict: "refused", objections: [{ category, what, correction?, frames }], observed? }`.
    There is no `severity` on an objection because severity is the FILTER — only
    blocking findings become objections — and `objections` may legitimately be
    EMPTY, which reports a refusal that named nothing actionable.
  - `validation.warnings[]` entries coded `SCENE_REVIEW_REFUSED` (exported as
    `SCENE3D_REVIEW_REFUSED_CODE`) — one per objection, carrying the `shotId` when
    every frame it cites falls inside one shot. Distinct from the `SCENE_QUALITY_*`
    codes, which appear on a job that FAILED.

  `validation.status` stays `"passed"` on an advisory delivery, so the new
  `scene3DReviewVerdictOf(output)` helper is the reader to use: testing the status,
  or counting warnings, both get it wrong.

  Also declares top-level `admissionRetries` beside `repairPasses` — pre-build
  planner retries, which re-ask a recipe the compiler would not admit without
  spending a repair pass. Optional, and absent on a run that needed none.

  Nothing changes on the wire: the reader schemas were already `.passthrough()`,
  so these fields were arriving and were simply invisible to a typed caller. The
  new `review` sub-schema is deliberately tolerant — a delivered scene with a real
  MP4 must never fail to parse over a malformed advisory.

- 0317bab: Scene3D authoring results now DECLARE the three fields an advanced engine
  already delivers, so an SDK caller can read them without casting.

  - `validation.warnings[]` entries coded `SCENE_AUTHORING_ASSUMPTION` — the
    planner's assumptions, carrying any normalization the engine applied. The new
    `SCENE3D_AUTHORING_ASSUMPTION_CODE` export is the one place that string is
    written down.
  - `metadata.summary` — the planner's one-or-two-sentence description of what it
    authored; on a repaired run, of the repair.
  - top-level `repairPasses` — repairs actually RUN, never the authoring-pass
    count, so a scene accepted first time reports `0`.

  All three are optional on `Pro3DRenderJobOutput` (and its reader schema) and on
  `Scene3DJobOutputAny` / `Scene3DJobOutputV2` via the new
  `Scene3DAuthoringDelivery` mixin. Nothing changes on the wire: the schemas were
  already `.passthrough()` and the fields were already arriving — they were simply
  invisible to a typed caller. A render-only export authored nothing and still
  reports no summary and omits `repairPasses` rather than claiming `0`; the
  deterministic Basic lane carries none of the three.

- 3147e1f: Scene3D authoring results declare two more things an advanced engine already
  delivers: `mechanicalPasses` and `restoredAssertions`.

  **`mechanicalPasses`** — repairs the engine authored ITSELF. When a mandatory
  finding that refused a build carries the compiler's own structured remedy, the
  engine applies that remedy and rebuilds, with no planner call.

  Those passes are counted **apart** from `repairPasses` and never folded into it,
  the same way `admissionRetries` is, because they buy their own quoted allowance:
  a `mechanical` line on the quote, bounded and released when unspent, rather than
  one of the caller's repairs. The pass identity the pricing keeps is
  `buildPasses === authoringPasses + repairPasses + mechanicalPasses`.

  Two consequences a reader has to know:

  - The two counts are independent, so a run may legitimately report **more**
    mechanical passes than repairs. Nothing may assert a relation between them.
  - There is one exception, and the **quote** is what discriminates it — not the
    result. A run quoted before that allowance existed has no `mechanical` quote
    line, and there the pass charged a repair, making the count a subset of
    `repairPasses`. The result reports the same field either way, so read the
    quote you were given rather than deriving the accounting from the counts.

  **`restoredAssertions`** — mandatory assertions the engine put back after a
  planner answer re-shaped one the feedback had not named, restored to the last
  admitted recipe's exact form so the run continues instead of being refused over
  a value the engine already held. Each entry is `{op, path, value?, assertionId,
reason}` (`value` is `unknown`: a restored assertion holds whatever it holds),
  and each is also an `ASSERTION_RESTORED` warning. An assertion the feedback DOES
  name is left alone.

  Both are declared on `Pro3DRenderJobOutput` (and its reader schema) and on the
  `Scene3DAuthoringDelivery` mixin, so they reach every lane that already carried
  `repairPasses`. New `SCENE3D_REMEDY_AUTO_APPLIED_CODE` and
  `SCENE3D_ASSERTION_RESTORED_CODE` exports give the two warning codes one place to
  be read from, as the assumption and review codes already have.

  Nothing changes on the wire: the reader schemas are `.passthrough()`, so these
  fields were already arriving and were simply invisible to a typed caller. The
  `restoredAssertions` sub-schema is deliberately tolerant — it rides a result with
  a real MP4, which must never fail to parse over a malformed advisory.

- 2dfaaf0: Scene3D makes the recipe a REFUSED authoring run retained retrievable.

  A 3D Render Pro run whose recipe the compiler refused on every pass publishes no
  scene revision, no poster and no `.blend` — a composition needs geometry and
  shots, and the plan is the compiler's own output. The refusal report and the
  planner's last admitted recipe are the entirety of what that run produced, and
  the recipe was retained and then served nowhere.

  - `GET /v1/3d-scene/deliveries/{jobId}` now lists a `source-json` descriptor
    (usage `checkpoint`) beside the refusal report on a `refused-authoring`
    delivery, and `/assets/{assetId}` serves its bytes as `application/json`.
    Reading it needs `edit` on the job's workflow — the same access the `.blend`
    export costs. A reader with less sees no descriptor and gets 404 on the bytes,
    never a 403 that would confirm a recipe exists. Nowhere else does a
    `source-json` become readable: a delivered scene's own recipe is pinned by its
    REVISION, and neither revision read lane lists checkpoint kinds.
  - `scene3d.retainedRecipe(jobId)` fetches and parses it in one call, answering
    `null` when the delivery lists none. Read it to see what was attempted and to
    inform the next prompt; there is no input that takes a recipe back, because a
    refused run published no revision to re-run from.
  - `Scene3DDeliveryAsset` grows the two kinds the route has always been able to
    return: `shot-still` (with its `shotIndex` / `frame` / `width` / `height`) and
    `source-json`. `deliveryAssetBytes` now checks the kind/usage PAIR against the
    exported `SCENE3D_DELIVERY_ASSET_USAGE` map instead of a hardcoded pair — which
    fixes a real refusal: the SDK rejected every shot still the route would have
    served.
  - `Scene3DAuthoringValidation.sourceRetained` is declared: the failed row's own
    flag for whether there is a recipe to fetch, so a caller can tell without a
    round trip. Present on the refused-authoring shape alone, and `false` rather
    than absent when no pass ever cleared admission.

  Reading a retained recipe is free, exactly like reading any other delivered
  evidence.

- 0af3e2d: Scene3D: a visual review its provider could not perform is now a typed verdict,
  and no longer blanks the delivered video.

  An advanced authoring run whose review never reaches its provider asks once more
  after a bounded pause and, if it is still unreachable, delivers the
  assertion-passing scene unreviewed rather than throwing it away. That result
  carries `metadata.review = { verdict: "unavailable", reason: "provider",
attempts, objections[], observed? }`, and `validation.warnings[]` leads with the
  new `SCENE_REVIEW_UNAVAILABLE` code.

  **The reader fix.** `Scene3DReviewVerdict` was declared with `verdict: "refused"`
  as a literal, and `pro3DRenderReviewVerdictSchema` matched it. So the new shape
  did not merely read as "no review": `isPro3DRenderJobOutput` returned `false`
  for the WHOLE result, blanking a real, paid, playable MP4 over an advisory
  field. The verdict is now a discriminated union — a consumer switching on
  `verdict` needs one new arm and no re-typing of the arm it has — and the
  schema's `review` degrades to absent rather than refusing the result, so a
  verdict a future engine invents costs at most itself.

  **New exports.** `SCENE3D_REVIEW_UNAVAILABLE_CODE`, the `Scene3DReviewFindings`
  / `Scene3DReviewRefused` / `Scene3DReviewUnavailable` arms, and
  `scene3DReviewNote(verdict)` — one user-safe sentence for either verdict, so a
  surface cannot report "the reviewer refused this scene" about one nobody saw.
  `scene3DReviewVerdictOf` reads both arms and clamps a nonsense `attempts` rather
  than discarding an otherwise good verdict.

  `objections` may be non-empty on the `unavailable` arm: a review is batched, and
  whichever batches answered before the outage are real evidence that is **not** a
  verdict on the scene. An empty list there is silence, not approval.

  Additive and optional throughout — a client that ignores the new verdict behaves
  as it did, except that it no longer loses the result it was already being given.

- c383883: Scene3D: an unreviewed delivery now says WHY there is no verdict, instead of
  always blaming the provider.

  `metadata.review = { verdict: "unavailable", reason, attempts, ... }` has a
  second `reason`. `"provider"` still means the review never reached its
  provider. `"unusable"` is new: the provider answered, but every asking came back
  with nothing usable — an answer that failed the review contract, one that cited
  a frame it was never shown, or a refusal that was not a transport fault. The
  engine asks such a review once more and then delivers the assertion-passing
  scene unreviewed. `verdict` is unchanged, and so is every other field.

  `pro3DRenderReviewVerdictSchema` used to rewrite `"unusable"` to `"provider"`
  on the way in, and `scene3DReviewVerdictOf` hard-coded `"provider"`, so
  `scene3DReviewNote` told the caller the review "did not reach its provider"
  about a provider that had answered. Both readers now keep `"unusable"`, and the
  note says "the visual review returned no usable verdict in N attempts; it was
  delivered unreviewed" — the same words the leading `SCENE_REVIEW_UNAVAILABLE`
  warning carries. A reason neither reader knows still falls back to
  `"provider"` rather than dropping the verdict.

  **New exports.** `SCENE3D_REVIEW_UNAVAILABLE_REASONS` (the one list every reader
  uses), the `Scene3DReviewUnavailableReason` type, and the
  `isScene3DReviewUnavailableReason` guard. `Scene3DReviewUnavailable["reason"]`
  widens from `"provider"` to `"provider" | "unusable"`. A `switch` on it that
  handled only `"provider"` still compiles, but it should add the new case.

- Updated dependencies [3086f29]
- Updated dependencies [40c4d3a]
- Updated dependencies [ae1a9e4]
- Updated dependencies [247326a]
- Updated dependencies [456aad9]
- Updated dependencies [363a5a1]
- Updated dependencies [026f944]
- Updated dependencies [6e53ed5]
- Updated dependencies [0317bab]
- Updated dependencies [ef42aa7]
- Updated dependencies [3147e1f]
- Updated dependencies [2dfaaf0]
- Updated dependencies [0af3e2d]
- Updated dependencies [c383883]
- Updated dependencies [946f71d]
- Updated dependencies [4657aef]
- Updated dependencies [834b7c5]
  - @nodaro/shared@3.10.0
  - @nodaro/prompts@1.20.0

## 2.10.0

### Minor Changes

- f79ff5d: Scene3D deliveries can now describe a Pro run whose recipe never compiled: `Scene3DDelivery` gains `sourceKind`, and `sceneRevisionId`/`sourcePlanSha256` are nullable for the `refused-authoring` kind, which retains the compiler's refusal report without a scene behind it.
- 4f4879b: `llm.structuredJob` accepts `analysisJobId`: draft from a finished `video-analysis` job you own instead of analyzing `videoUrl` again — no second analysis, no second analysis charge. A fresh movie run's row now also carries `analysisCredits` (in `input_data` and `output_data`) from the moment its analysis child is created, not only at completion.

### Patch Changes

- Updated dependencies [0114b68]
- Updated dependencies [a8e6d21]
  - @nodaro/prompts@1.19.0
  - @nodaro/shared@3.9.0

## 2.9.0

### Minor Changes

- d1cac05: `oauth.getAppInfo(clientId, redirectUri?)` — pass the redirect URI and the answer carries `redirectUriRegistered`, so a consent screen can refuse to redirect anywhere unregistered.
- dd3003b: `DeveloperApp.kind` — how the app came to exist (`user`, `dynamic_mcp`, `first_party_mcp`, `community_instance`). Only `user` apps count toward the per-user registration cap.

### Patch Changes

- 36f8d20: Document what a 3D scene render costs on `RenderScene3DParams`.

  The price follows the plan's own `width`/`height`, not any node setting, so the
  type a caller fills in is the right place to say so: up to 1920 px on the
  longest side the render settles under `render-video`, above that under
  `render-video:3d-large` (1.5x) or `render-video:3d-xlarge` (2.5x above 5.12
  megapixels). Doc comments only — no behaviour change.

- Updated dependencies [9d19c35]
- Updated dependencies [15c8b12]
- Updated dependencies [42d48e0]
- Updated dependencies [e1280b7]
- Updated dependencies [36f8d20]
- Updated dependencies [7caeaec]
  - @nodaro/shared@3.8.0
  - @nodaro/prompts@1.18.0

## 2.8.0

### Minor Changes

- 6b2de5b: Type a studio ops receipt's `impact` the way the route writes it. It is a
  dependency SCOPE — `{ keyframeIds, shotIds }`, ids the caller has to go and
  refresh — not the sentence the declaration claimed, and it rides the receipt
  projection the route builds ONCE for both answers, so it now sits on
  `StudioOpsReceipt` (an apply reports it too) rather than only on the preview.
  Exported as `StudioOpsImpact`.

  The preview's own two fields are narrowed to what is actually sent:
  `class` is the vocabulary's four-letter confirmation table (`StudioOpClass` —
  `S` safe, `D` delete, `P` publish, `$` spends), which is what makes a rule like
  "never a `D` without asking" writable; `restorable` is `true` or absent, never
  `false`, because a delete that destroys has no bin entry to name.

## 2.7.0

### Minor Changes

- ef73308: Add `media.suggestOverlayPlacement()` — ask a vision model where one overlay layer should sit on a base image (`POST /v1/image-overlay/suggest-placement`). Answers synchronously with `anchor` / `x` / `y` / `width` in `media.imageOverlay()`'s own percent units plus a one-sentence reason, so the box drops straight onto a layer. The `OverlayPlacement` type is exported too.

### Patch Changes

- Updated dependencies [ef73308]
  - @nodaro/shared@3.7.0

## 2.6.0

### Minor Changes

- c6f68c7: Preview a studio operation batch before it lands: `studio.productions.ops(id, { …, dryRun: true })` returns typed receipts of what the batch WOULD do. The flag is proved on an empty batch first, so a deployment that predates the preview cannot silently apply the caller's batch — that case throws `StudioPreviewUnavailable` with nothing sent, and a batch applied anyway by a second deployment throws `StudioPreviewAppliedError` carrying the write.

  Adds `client.copilot`: threads, and one assistant turn as a typed stream of frames. The package's SSE reading now lives in one shared reader, which `media.downloadVideoProgress` uses unchanged.

## 2.5.0

### Minor Changes

- 0fc9fee: Add `media.imageOverlay()` — place up to 4 image layers (logo, badge, cut-out) on a base image, pixel-exactly, via `POST /v1/image-overlay`.

### Patch Changes

- Updated dependencies [6cf8565]
- Updated dependencies [0fc9fee]
  - @nodaro/shared@3.5.0

## 2.4.0

### Minor Changes

- a4b5102: Add immutable 3D input selectors for advanced scene generation and Pro prompt sources. Select existing GLBs by revision and artifact ID while the server resolves permissions and byte receipts. Basic generation refuses imported geometry instead of silently ignoring it.

### Patch Changes

- Updated dependencies [a4b5102]
  - @nodaro/shared@3.4.0

## 2.3.0

### Minor Changes

- b52d08e: Add Studio production discovery, reads, semantic editing and separate manual frame generation/review methods. These are public API transport contracts; creative planning and validation remain server-side.

  Add revision-checked editor saves that preserve protected frame and job state and expose availability through production capabilities.

  Add compatible production bundle import with capability discovery and server-verified retained frame copying.

  Add revision-checked bundle append with complete frame dependencies, explicit insertion and film-look choices, and capability discovery.

  Expose manual result-rejection capability for the semantic editor without submitting generation jobs.

  Expose sequence-plan editing capability for atomic endpoint/order edits and single-segment detachment with continuous-group splitting.

  Expose exact linked-take retake requests and capability discovery, retaining explicit quote review and submission tokens.

  Add owner-controlled editable-copy permission on revisioned sharing and capability discovery for authenticated shared-plan copies.

### Patch Changes

- Updated dependencies [aace203]
  - @nodaro/shared@3.3.0

## 2.2.0

### Minor Changes

- 5a90703: Add the `pro-3d-render` ("3D Render Pro") wire contract and SDK surface.

  Generate/Edit 3D Scene share an authoring-engine resolver so connected retained
  scenes use Advanced consistently on the canvas and in headless workflows. The
  output presentation helpers also classify Pro as a video producer while keeping
  its separate composition output.

  `@nodaro/shared` gains the node type, the strict discriminated `source` union
  (`prompt` / `scene` / `local-export`), the engine, quality, style, aspect-ratio
  (including `21:9`) and correction-budget vocabularies, the request bounds, the
  `Pro3DRenderQuote` and `Pro3DRenderCapabilities` shapes, the full
  `Pro3DRenderJobOutput` reader schema (video + composition + revision, poster,
  validation, renderer and metadata), and the shared `buildPro3DRenderSource` /
  `pro3DRenderTimingOverrides` helpers both execution engines use so an in-browser
  run and a headless one mean the same thing. `pro-3d-render` also joins
  `COMPOSER_PLAN_MAP` (so a stored composition re-renders through the existing
  `render-video` lane) and `VIDEO_PRODUCER_TYPES` (so its video output connects
  downstream), and `ASPECT_RATIO_DIMENSIONS` gains `21:9` (1680x720).

  `@nodaro/sdk` gains `scene3d.quotePro()` / `scene3d.runPro()` /
  `scene3d.renderProAndWait()`, typed `nodes.run` / `runAndWait` overloads for the
  node, per-call `Idempotency-Key` plumbing on `nodes.run`/`runAndWait`, and
  `capabilities().pro` for discovering which engines, quality profiles, styles and
  aspect ratios a deployment can serve. Additive apart from the new options
  parameter: no existing method, type or route changes.

- 9109815: Add authenticated scene delivery metadata and bounded poster/report asset reads that remain scoped to both delivery and source permissions.

### Patch Changes

- Updated dependencies [5a90703]
  - @nodaro/shared@3.1.0

## 2.1.0

### Minor Changes

- a35ac60: **@nodaro/sdk** — `client.studio.productions`: the studio production document,
  from a script.

  A studio production is a workflow whose `settings.studio` holds the shots — each
  one a framed still, an optional animated clip, and the plan, looks, cast
  bindings, frames and voice that made them. Until now the only code that could
  read or write that document ran in the studio app's browser tab. This resource
  is the SDK half of `/v1/studio/productions`, so a script, an agent and the app
  work on ONE production instead of three opinions about one row.

  The read half — `skill()`, `validatePlan()`, `list()`, `get()`, `exportPlan()` —
  returns the route's envelopes typed and the production DOCUMENT as open JSON:
  `detail: "summary"` (counts and the active urls) or `"full"` (every result with
  the context that regenerates it), with `shotId` for a single shot. The
  document's field-level types ship with the studio app, the one consumer that
  narrows them; everything a caller branches on — `version`, `rebased`,
  `receipts`, `warnings`, a quote's `credits`, a run's `jobIds` — is typed here.

  The write half is `ops()`: a batch of semantic operations, applied atomically.
  Operations address by stable KEY — a shot id, a role slug, a result's job id or
  url — and never by position, which is what lets two writers hold one production
  open: a batch composed against a slightly older version still applies to the
  newest document and the response says `rebased: true`. `strict: true` refuses
  instead. `receipts` says what each operation did, in the words a change log
  would use.

  Generation is run-then-poll: `generate()` — and its `generateStill()` /
  `generateClip()` spellings, which only fill in `kind` — submit and record
  pending markers, and `reconcile()` turns finished jobs into results, no browser
  required. The request is assembled server-side from the shot's own plan, so a
  scripted run and a press of the button produce the same media. `dryRun` prices
  without writing (the reply is the quote — narrow it with
  `isStudioGenerateEstimate`), and `clientRequestId` makes a retry safe: the same
  token answers with the jobs the first call started and submits nothing.
  `describe()` turns a brief into scenes, `frame()` / `voice()` / `revoice()` /
  `music()` cover the per-shot media, and `share()` / `unshare()` / `clone()` the
  audience and copies.

  Two error mappings come with it: `409 production_busy` now maps to
  `WorkflowConflictError` (the same situation and the same remedy as
  `workflow_conflict` — its `code` says which arrived), and a 4xx carrying an
  `opIndex` maps to the new `StudioOpError`, which names the operation that was
  refused. Selected by SHAPE rather than by a list of codes, so a new refusal
  reason reaches callers without an SDK release.

## 2.0.0

### Major Changes

- 32493ee: Add named Scene3D generation, editing, render-only export, and capability discovery helpers. Preserve the existing node transport and expose explicit optional authoring-engine parameters.

### Patch Changes

- Updated dependencies [32493ee]
  - @nodaro/shared@3.0.0
  - @nodaro/prompts@1.17.2

## 1.30.1

### Patch Changes

- 33b783f: Allow scene edits to replace or clear their complete reference set explicitly.

## 1.30.0

### Minor Changes

- 2c1f0b2: Add the versioned Scene3D wire contract, deterministic edit operations, and typed SDK inputs/results for 3D scene generation, editing and composition rendering. Register scene authoring prompt fields for consistent canvas and workflow execution.

### Patch Changes

- Updated dependencies [2c1f0b2]
  - @nodaro/shared@2.27.0
  - @nodaro/prompts@1.17.1

## 1.29.0

### Minor Changes

- 88a6e05: `StructuredReferenceParams.describedReferences` — up to 10 `{ name, description }` entries for a subject you can name and describe but have no media for, on `generate-image`, `generate-video` and `text-to-video`. They attach nothing and claim no `@image_N` seat; each reaches the model as a `<Name> — <description>.` line, correlated with the prose BY NAME. `GenerateVideoParams` / `TextToVideoParams` also gain `referenceVideoCaptions` / `referenceAudioCaptions`, index-aligned with the rail url arrays. `DescribedReference` is re-exported from the SDK.

### Patch Changes

- Updated dependencies [88a6e05]
- Updated dependencies [88a6e05]
  - @nodaro/prompts@1.17.0
  - @nodaro/shared@2.23.0

## 1.28.0

### Minor Changes

- 2b5287e: `pending_review` — a job a deployment's job policy held for human review.

  **`@nodaro/sdk`**

  - `JobStatus` gains `"pending_review"`. It is **in-flight, not terminal**: the
    output exists, the credit reservation stays `"reserved"`, and a human decides
    whether it is released. It resolves to `completed` (approved), `failed`
    (rejected) or `cancelled`. Only appears on deployments that register a job
    policy. A `switch` over `JobStatus` that must stay exhaustive needs a new arm.
  - `JobErrorHint` becomes a **discriminated union** on `kind`:
    `SafetyBlockHint` (`kind: "safety-block"` — the provider's own filter, the
    previous single shape, unchanged) `| PolicyBlockHint` (`kind: "policy-block"`,
    carrying `policyId`, a user-safe `reason` and `hookPoint: "request" | "result"`).
    Code that read `error_hint.class` without first narrowing on `kind` now needs
    the check. `JobErrorHint`, `SafetyBlockHint`, `PolicyBlockHint` and
    `CreditStatus` are exported by name for the first time — they were reachable
    from `Job` / `JobStatusResult` but not nameable, so narrowing or annotating
    against them was impossible.
  - New `JobHeldError` (`code: "job_held"`, `status: 0`, carries `jobId`).
    `nodes.runAndWait` / `nodes.runMany` throw it on the **first** `pending_review`
    tick instead of polling out `maxMs` (~15 min by default) and then reporting a
    `JobTimeoutError` that misdescribes what happened. It does **not** cancel the
    job — re-fetch with `jobs.get(jobId)` later, or surface "awaiting review" and
    poll `jobs.getStatus()` yourself. Do not re-run the request: a duplicate would
    be held too.
  - New `JobBlockedError` (`code: "job_blocked"`, `status: 422`), thrown by
    `throwFromResponse` when a job policy refuses a request before it runs — no
    job created, nothing reserved, nothing charged. Selected by `code`, so any
    other 422 stays a plain `NodaroError`. `message` is the policy's user-safe
    text; show it as-is.

  **`@nodaro/shared`**

  `EXECUTION_DATA_KEYS` and `TRANSIENT_RUNTIME_KEYS` both gain
  `jobAwaitingReview` — the editor's per-tick "this node's result is under
  review" flag. Transient, so a flip into review neither marks a passive tab
  dirty nor is captured by a node preset or the save payload.

  **`@nodaro/cli`**

  `--watch` stops on `pending_review`, prints
  `awaiting review (a human decision is pending; not a failure)` and exits **3**
  (documented beside 0 / 2 / 130 in `docs/cli.md`) instead of polling until the
  process is killed. As with `failed` and `cancelled`, `--json` prints the
  payload and returns rather than setting the exit code.

- 1031ce4: `client.jobs.delete(id)` — delete a job and its private media (`DELETE /v1/jobs/:id`)
- 2d082a0: `nodes.run("text-to-video", …)` / `runAndWait` are typed — `TextToVideoParams` (prompt-only video lane; frames stay on `generate-video`)

### Patch Changes

- a3ef2c8: `jobs.list()` — `ListJobsPage.data` documents what the endpoint has always been
  free to do and now regularly does: a page may hold fewer than `limit` rows —
  even none — and still carry a `next`. The server pages off the last row the
  database returned, then drops the inner jobs of component-node runs from that
  page, so a page whose rows were all component jobs comes back empty with a live
  cursor. Page on `next`, never on `data.length`. JSDoc only; no runtime or type
  change.
- Updated dependencies [2b5287e]
- Updated dependencies [1e0206c]
  - @nodaro/shared@2.21.1

## 1.27.0

### Minor Changes

- 14f930d: `Job` and `JobStatusResult` gain `error_hint?: JobErrorHint | null` — the worker's structured content-policy verdict (`{ kind: "safety-block", class: "copyright" | "likeness" | "safety", retried, suggestedProvider? }`), present on a job the worker classified as a final safety/content-policy block — and `credit_status?: "reserved" | "committed" | "refunded" | null`, the job's credit-reservation lifecycle derived server-side from `usage_logs.status`. Both are `null`/absent when not applicable; `credits` (the reserved amount) is unchanged.

### Patch Changes

- Updated dependencies [94d22ab]
- Updated dependencies [7ba3b9e]
- Updated dependencies [bb58724]
- Updated dependencies [14f930d]
- Updated dependencies [14f930d]
- Updated dependencies [5955108]
- Updated dependencies [bb58724]
- Updated dependencies [7810119]
- Updated dependencies [bb58724]
- Updated dependencies [bb58724]
- Updated dependencies [b47bd25]
  - @nodaro/shared@2.21.0
  - @nodaro/prompts@1.16.0

## 1.26.0

### Minor Changes

- 158b2e6: Organizations: usage reports (rollout-gated). `client.organizations.usage(orgId, query)` and `client.workspaces.usage(workspaceId, query)` return credits by workspace, member, model or day for an inclusive date range (`from`/`to`, IANA `tz`), with in-flight vs settled credits split out and the platform-absorbed overrun listed separately; `usageRows` pages the underlying runs; `usageCsv` returns the same report as CSV. The CLI gains `nodaro org usage` and `nodaro workspace usage` (`--csv`). `@nodaro/shared` adds the `UsageReport`, `UsageReportRow`, `UsageVarianceRow`, `UsageLogEntry`, `UsageQuery` wire types, the `USAGE_GROUP_BYS` list and the `audit_unavailable` error code.
- dfd4fed: `client.llm.structured(body)` / `client.llm.structuredJob(body)` — the forced-schema LLM call, typed, and its asynchronous twin (`POST /v1/llm/structured/jobs`: `{ jobId }` at once; optional `label`, and `videoUrl` + `videoAnalysis` to draft from a video's analysis). `client.jobs.list({ type, origin, limit, cursor })` — your jobs, filtered on `input_data.type` / `.origin`, cursor-paginated. `client.media.process(input)` — the free, synchronous cut/crop (`POST /v1/media/process`).

### Patch Changes

- 703d5ae: Add `resolveNormalizedImageGen` (and its `NormalizedImageGen` result type) to
  the public API. It snaps an image request's catalog-governed levers
  (`aspectRatio` / `resolution` / `quality`) to a combination the model actually
  accepts via `normalizeModelInput`, applied against the post-T2I→I2I-swap model
  id, and computes the credit identifier from the **snapped** values.

  `adjustments` is the disclosure contract: one entry per lever that changed,
  each carrying `field`, `from`, `to` and a human-readable `reason`. `to` is
  `undefined` when the lever was dropped because the model has no such setting.
  The array is empty when the caller's values were already valid, and unknown
  model ids pass through untouched.

  `resolveImageGenCreditIdentifier` keeps its exact signature and return type and
  now delegates to the new primitive, so the credit identifier is identical for
  every already-valid input. Because both image routes compute the identifier
  twice — the `creditGuard` CHECK and the `reserveCreditsForJob` DEBIT — and a
  commit never collects an upward delta, putting the snap inside the primitive
  keeps those two sites and the workflow orchestrator in agreement by
  construction instead of by convention.

  Also adds `IMAGE_ASPECT_RATIO_VALUES` (and its `ImageAspectRatio` element type)
  — the ONE image aspect-ratio vocabulary the `/v1/generate-image`,
  `/v1/image-to-image` and `/v1/edit-image` Zod enums are now built from, instead
  of three literal lists that drifted. It is the union of every ratio any
  `kind: "image"` catalog entry declares, so a ratio the picker offers can no
  longer 400 at the route (that gap shipped twice — Wan 2.7's `8:1`/`1:8` and
  Nano Banana 2 Lite's `4:1`/`1:4`), and a superset test fails the build if a new
  model declares a ratio the tuple is missing. It bounds the VOCABULARY only; the
  per-model gate stays the catalog snap, which corrects and discloses rather than
  rejects.

  Widens `MODEL_PARAM_NODE_TYPES` — the node-type gate `normalizeNodeModelParams`
  reads at the workflow-JSON write boundary — to cover `modify-image` and
  `edit-image` alongside `generate-image` and `image-to-image`. A node written
  straight into workflow JSON by an agent, an import or a template never meets
  the config panel's provider-aware dropdown or its stale-value effect, so those
  two types carried the same un-healable invalid pairs the other two used to.
  `edit-image`'s `targetResolution` is an upscale target, a field the normalizer
  never reads, so its price is untouched by the widening.

  The image node routes (`generate-image`, `image-to-image`, `edit-image`) now
  return an optional `adjustments[]` alongside `jobId` when a parameter was
  corrected; `RunNodeResult` types it as `RunNodeAdjustment[]`.

- Updated dependencies [1e9e962]
- Updated dependencies [5a67501]
- Updated dependencies [158b2e6]
- Updated dependencies [c6be4ac]
- Updated dependencies [4c5dedb]
- Updated dependencies [703d5ae]
  - @nodaro/shared@2.20.0
  - @nodaro/prompts@1.15.0

## 1.25.0

### Minor Changes

- 3979aa4: Workflow export/import now carries the `@`-chips' entities. `collectAssetIds` harvests the entity ids bound in `ConnectedReference` chips (`generatedResults[].references[]`, `beats[].references[]`, anywhere else a `references` array sits in node data — and in the workflow's freeform `settings`, where an app can keep its own index of the same work), not only the four entity-node `*DbId` fields — so a graph that binds its entities through chips alone exports its characters, objects, creatures and locations instead of none of them, and imports with every chip, in the graph and in `settings` alike, re-pointed at the rows created under the importer.

  `WorkflowImportReport` gains two optional fields: `assetIdMap` (bundled entity id → the row created for it, for chips a client holds outside the graph; present whenever the bundle carried `assets`, `{}` when nothing was created) and `assetsSkipped` (`{ kind, id, name, reason }[]` — entities storage quota left uncreated; the workflow still lands). A bundled entity's images are now copied into the importer's own storage even when they already sit on the same instance, because they are the exporter's bytes; the export's `portability.unreachableMedia` covers them too. The per-import copy cap applies per HALF — the graph's media and the bundled entities' each get the full budget, so neither can starve the other.

- a6bc7bd: Dubbing full surface: video in -> dubbed VIDEO out (+ the dubbed audio track), `sourceUrl` for public links ElevenLabs fetches itself, start/end dub windows, `numSpeakers` 0=auto, resolution/profanity/accent/watermark options, and per-minute pricing of the dubbed span (max 30 minutes). `voices.dub()` accepts the new source object and options; dubbing joins the shared dual-mode producer set.
- 220ec75: Voice Changer Pro: per-voice `engine` — `"sts"` (default recast) or `"v3"` (Re-speak: the performance is regenerated from the transcript with eleven_v3, `[audio tags]` supported). Analyze results now carry per-segment transcript `text` (the paid input for a v3 speaker, editable before conversion). Requires a platform running cloud-plugins >= 0.216.0; on older platforms the fields are accepted-and-ignored.

### Patch Changes

- Updated dependencies [9193ea3]
- Updated dependencies [3979aa4]
- Updated dependencies [a6bc7bd]
- Updated dependencies [7abf3ed]
- Updated dependencies [d1b83cd]
- Updated dependencies [fc51a97]
- Updated dependencies [2f48344]
- Updated dependencies [c3fa6a4]
- Updated dependencies [d10d8b8]
  - @nodaro/shared@2.17.0
  - @nodaro/prompts@1.12.0

## 1.24.0

### Minor Changes

- a136e52: ElevenLabs v3 dialogue goes direct: the v3 TTS per-request cap rises to 5,000 characters (dialogue: 5,000 total across lines, at most 10 unique voices), the model catalog gains a dedicated `dialogue` mode, the SDK gains `voices.textToDialogue()` (multi-speaker script -> one audio file; any voice including clones, `[audio tags]`, seed + text normalization), and the CLI gains `nodaro voice dialogue --line "Voice: text"`.

### Patch Changes

- Updated dependencies [d746992]
- Updated dependencies [988ba38]
- Updated dependencies [a136e52]
- Updated dependencies [e40d384]
- Updated dependencies [df7adc4]
  - @nodaro/prompts@1.11.0
  - @nodaro/shared@2.16.0

## 1.23.0

### Minor Changes

- 9963ec5: Prompt pre & post text: `promptPrefix` / `promptSuffix` node-data fields on every AI prompt node (`PromptAffixFields`, `applyPromptAffixes`, `nodeSupportsPromptAffixes`); `apps.run(slug, inputs, { inputOverrides })`; `nodaro apps run --override nodeId.field=value`.

### Patch Changes

- Updated dependencies [db47f72]
- Updated dependencies [68d0464]
- Updated dependencies [9963ec5]
- Updated dependencies [a305fd5]
- Updated dependencies [b08b3dc]
  - @nodaro/prompts@1.9.0
  - @nodaro/shared@2.13.0

## 1.22.0

### Minor Changes

- 0ac4f4c: Image collage storyboard badges can be placed in either top corner — default is now **top-left**.

  `@nodaro/sdk`: `media.imageCollage(input)` accepts `badgePosition?: "top-left" | "top-right"`. The number/label badges default to the image's top-left corner (the storyboard convention — the shot number leads the frame in reading order); `"top-right"` keeps them clear of a subject composed left-of-centre. Existing callers that relied on the previous top-right placement should pass `badgePosition: "top-right"` explicitly.

  `@nodaro/cli`: `nodaro media collage` gains `--badge-position <top-left|top-right>` (default `top-left`); any other value is a hard error.

## 1.21.0

### Minor Changes

- 06805b8: Image collage gains storyboard badges — optional per-image sequence numbers and captions.

  `@nodaro/sdk`: `media.imageCollage(input)` accepts two new optional fields. `numbered` (boolean) stamps a 1-based sequence badge at each image's top-right, in `imageUrls` order — storyboard mode. `imageLabels` (`Array<string | null>`, index-aligned with `imageUrls`; `null`/`""`/omitted = no caption for that image) captions images after the number, rendered as `3 · Close-up`. Both are optional and default off; badges are an overlay only and never change the layout, the output size, or the credit cost.

  `@nodaro/cli`: `nodaro media collage` gains `--numbered` (stamp the sequence badges) and a repeatable `--label <text>` flag, index-aligned with the image arguments in order (pass `""` to skip one image). More `--label` values than images, or any label over 80 characters, is a hard error.

### Patch Changes

- Updated dependencies [ded5ac2]
- Updated dependencies [8802a1e]
  - @nodaro/shared@2.12.2

## 1.20.0

### Minor Changes

- ca8594e: Add `client.catalogs.list()` + `GET /v1/catalogs` — the tag-free, pack-composed catalog projection. Reflects the deployment's registered vendored packs so thin clients rendering their own pickers honor a deployment's curation.
- 74d5f37: `objects.list()`, `creatures.list()` and `locations.list()` (and their `listArchived` variants) now accept optional `limit` (cap 500) and `cursor` parameters and return `nextCursor`, mirroring `characters.list()`. Pagination is opt-in: omitting `limit` returns the full legacy listing with no `nextCursor`, exactly as before. Loop until `nextCursor` is `null` to read a library of any size.
- 5569422: Workflow sharing reaches the SDK and CLI.

  `@nodaro/sdk`: `client.workflows` gains `setVisibility(id, visibility)`, `move(id, { projectId })`, `sharedWithMe()`, and a nested `collaborators` resource — `list` / `add` / `update` / `remove` over `/v1/workflows/:id/collaborators`. The active workspace already travels on every request (`withWorkspace()`), so `list` / `get` / `run` follow it unchanged. No new `@nodaro/shared` types — `WorkflowVisibility` and `CollaboratorRole` were already exported.

  `@nodaro/cli`: `nodaro workflows share`, `move`, `shared-with-me`, and a `collaborators` subcommand group (`list` / `add` / `update` / `remove`). The global `--workspace <id>` flag already scopes `list` / `create` / `run`. A collaborator is added by user id or by any email address.

- 1096ad2: Compact professional `term` on every picker-catalog entry.

  `@nodaro/prompts`: each catalog entry can now carry a short `term` beside its long `promptHint` — the two-to-four word phrase a professional would actually write in a prompt ("whip pan left", "hard cut", "medium close-up"). `label` stays what users see, `promptHint` is what models read in verbose hint mode, `term` is what they read in compact hint mode. New `term.ts` (`deriveTerm` / `isSuspiciousDerivedTerm` / `resolveTerm` / `TERM_MAX_CHARS`) plus a `get<Name>Term(id)` getter alongside every `get<Name>PromptHint(id)`, and roughly 1,370 explicit terms authored where the lowercased label is not the trade term. A guard test walks every registered catalog and fails for a suspicious label with no authored term, for a term over the length or word cap, and for two ids in one catalog that would inject the same fragment — so the convention is enforced rather than documented. `PickerOption.term` is always present and already resolved (`""` for a no-op "auto"/"none" entry that injects nothing) — including on options added by a catalog pack, which are resolved at composition so a pack built against an older `@nodaro/prompts` still injects in compact mode. Consumers render `label` and inject `term`, never deriving one from the other.

  Where a catalog's grammar carries its meaning, the term keeps that grammar rather than leaving a consumer to re-add it: Material terms read `"made of polished gold"` (not `"polished gold"`, which would only name a material present in the scene) and Held Prop terms keep the held-in-hand verb (`"cradling a cat"`). Mood terms name the subject's expression, matching the register of their hints.

  Selecting a register: `PickerHintMode` (`"full" | "compact"`) is exported from `term.ts`, the `build*Hints` family (`buildFramingHints`, `buildPersonHints`, `buildStylingHints`, `buildLightingHints`, …) takes an optional trailing `mode: PickerHintMode = "full"` so existing calls are unchanged, and `getParameterPromptHint` reads `data.hintMode` off the node — absent or unrecognized means `"full"`. A compact Camera Motion / Transition node propagates the mode into the pickers wired to its `startState` / `endState` handles; a wired picker that declares its own `hintMode` wins over what it inherits.

  Pack authors are NOT required to supply it: `registerCatalogPack` accepts term-less options/dimensions/catalogs (`PickerOptionInput` / `PickerDimensionInput` / `PickerCatalogInput`) and resolves `term` at composition, so an existing vendored pack keeps compiling.

  `@nodaro/shared`: `ProjectedCatalogOption` gains `term?: string` — the `GET /v1/catalogs` wire shape carries it at **both** detail levels, so a thin client rendering its own pickers gets the injectable term without a second `detail=full` fetch. The four object-entity catalogs (animals / vehicles / weapons / furniture) gain the same optional `term?` field, authored only where the label is a UI compound ("Airship / Dirigible" → `airship`, "Plasma Sword / Lightsaber" → `plasma sword`); everywhere else the label _is_ the professional term and `@nodaro/prompts` derives it the same way it derives every other catalog's (lowercased, parentheticals stripped).

  `@nodaro/sdk`: `PickerOption` and `ProjectedCatalogOption` mirror the new field, so `client.pickerCatalogs.get()` and `client.catalogs.list()` are typed for it at both detail levels.

  `@nodaro/cli`: `nodaro catalog` snapshots now record an entry's `term`, and `diff-upstream`'s three-way merge counts a term-only upstream edit as a real content change — previously an upstream entry whose only edit was its `term` never reached a vendored pack's merge plan. That behaviour change is what makes this a minor rather than a patch. `nodaro pickers get` also documents `term` on its default (compact) detail level.

### Patch Changes

- Updated dependencies [18766f4]
- Updated dependencies [ca8594e]
- Updated dependencies [d7c78e5]
- Updated dependencies [5947e21]
- Updated dependencies [83c38a7]
- Updated dependencies [584d953]
- Updated dependencies [d0b73c6]
- Updated dependencies [1096ad2]
- Updated dependencies [1aacfca]
- Updated dependencies [646062e]
  - @nodaro/shared@2.11.0
  - @nodaro/prompts@1.8.0

## 1.19.0

### Minor Changes

- cdef4ed: Organizations reach the SDK.

  `@nodaro/shared` gains the RESPONSE half of the organization wire contract — `OrganizationView`, `OrgMemberView`, `WorkspaceView`, `WorkspaceMemberView`, `InvitationView`, `InvitationDelivery`, `InvitationPreview`, `JoinCodeView`, `OrgAuditEntry`, `OrgPage<T>`, and the `OrganizationSummary` / `WorkspaceSummary` / `MeOrganizations` shapes `GET /v1/me` carries. Contract only: no resolution logic, no access rules, no vocabulary.

  `@nodaro/sdk` gains `client.organizations` and `client.workspaces` covering organizations, members, workspaces, invitations, join codes and the audit log, plus `createClient({ workspaceId })` and `client.withWorkspace(id)` — which returns a NEW client rather than mutating a shared one, so two concurrent operations cannot race over which workspace they are in. `client.me()` is now typed to carry the organizations block, keeping its three states distinct: the fields absent (this instance has no organizations), present and empty (you belong to none), and `organizationsUnavailable` (the lookup failed — keep the selection you had).

  The workspace header decides SCOPE, never ACCESS: it selects which workspace a list reads from and where a create lands, and cannot widen access or move a charge.

### Patch Changes

- Updated dependencies [8c4110e]
- Updated dependencies [0134594]
- Updated dependencies [cdef4ed]
- Updated dependencies [62bb3dd]
- Updated dependencies [f14fa42]
  - @nodaro/shared@2.10.0

## 1.18.0

### Minor Changes

- 8f8099c: Expose revisioned Recast audio manifests plus typed quote and Apply methods for Music replacement and downloadable mix changes.
- b49a7ff: Slideshow: `client.media.slideshow({ imageUrls, audioUrl?, imageDurations?, ... })` and `nodaro media slideshow` — 2–100 images + one optional audio track → MP4 via `POST /v1/slideshow`, locally rendered (FFmpeg), zero credits. Audio-anchored timing (equal split / pinned rows with disclosed proportional scaling); silent output without audio. Shared adds `PICKER_TO_COMBINE_TRANSITION` + `resolveSlideshowTransition` (transition-picker → xfade vocabulary mapping).
- b49a7ff: Still to Video: `client.media.stillToVideo({ imageUrl, audioUrl, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? })` and `nodaro media still-to-video` — one still image + one audio track → MP4 via `POST /v1/still-to-video`, locally rendered (FFmpeg), zero credits. The output duration is the audio's duration (no duration field); optional motion presets (zoom / pan / ken-burns) with intensity 1–10.
- 9df6f33: Workflow bundles now carry a `portability` note when they reference media another instance cannot fetch (a private host's own storage), and `workflows.import()` returns an `importReport` describing which media was copied onto the importing instance, which was unreachable, and which was skipped.

### Patch Changes

- Updated dependencies [1606089]
- Updated dependencies [ff52285]
- Updated dependencies [d964b4d]
- Updated dependencies [d1ad395]
- Updated dependencies [c7fde04]
- Updated dependencies [4282945]
- Updated dependencies [776e7f5]
- Updated dependencies [b49a7ff]
- Updated dependencies [6b8cfab]
- Updated dependencies [3488681]
- Updated dependencies [823b629]
- Updated dependencies [9df6f33]
  - @nodaro/prompts@1.7.3
  - @nodaro/shared@2.9.0

## 1.17.0

### Minor Changes

- 6fe2aae: Surface-parity catch-up — every recent platform feature reachable through the SDK:

  - New `client.shots` resource — Cine share → remix records: `create` / `get` / `update` / `delete` over `/v1/shots` (unguessable capability ids, private-by-default visibility, signed-URL rejection documented on the types).
  - New `client.recast` resource — the authored-script lane (`authoringSkill()`, `validateScript()`, `importScript()` with its required rights attestation) and the run lane (`estimate` / `create` / `get` / `start` / `resolveGate`, including the `clientCapabilities` gate opt-in such as `["sheet-gate"]`). Cloud edition only.
  - `NodeDescriptor` catches up with what `GET /v1/nodes` actually serves: new optional `maxDurationSec`, `sparseProviders`, `providerResolutions`, `providerResolutionWire`, and `soundtrack` fields.

### Patch Changes

- 8221886: **@nodaro/shared**

  - `resolveEffectiveSourceType` now also remaps aggregate lane handles: a wire leaving `collect` / `group` on `out-image` / `out-video` / `out-audio` / `out-text` resolves to the plain producer of that lane's type (`upload-image` / `upload-video` / `upload-audio` / `list`), so lane pips connect to typed inputs exactly like the equivalent upload node. New export `AGGREGATE_LANE_SOURCE_TYPES`.
  - New `computeAggregateLanes(nodeId, wiredTypes, buckets, edges)` in the group-aggregation module — the lane set an aggregate node exposes (wired-input types ∪ bucket contents ∪ lanes referenced by outgoing edges).
  - Reduce strategy registry ("Choose Best"): labels/descriptions rewritten in plain language (`AI picks the best`, `Join into one text`, `First that has content`, `Count them`, `Most common answer`, `Merge JSON objects`); the `pick-best-llm` config schema gains optional `llmModel` (the judge model id from the LLM registry).
  - New `LlmFeature` `"pick-best-llm"` with an entry in `LLM_FEATURE_DEFAULTS`. Its credit identifiers tier by the judge model like every other LLM feature (`reduce:pick-best-llm[:economy|:premium]`).

  **@nodaro/sdk**

  - `client.reduce` docs: `pick-best-llm` accepts `strategyConfig.llmModel` (judge model; omitted = default; its tier sets the credit price).

- f86c20f: **@nodaro/sdk**

  - `ModelSummary.pricing` is now optional — `GET /v1/models` (and the MCP `list_models` twin) omit per-variant credit pricing on editions without a credit system (community/business), the same principle `/v1/nodes` applies to `creditCost`. JSDoc on `NodeDescriptor.creditCost` and on `workflows.delete()` / `developerApps.delete()` now states the edition behavior and the `NotFoundError` thrown when the id doesn't exist or isn't yours.

  **@nodaro/cli**

  - `nodaro models list` renders `-` in the credits column for models served without pricing (creditless editions) instead of crashing on the missing field.

- Updated dependencies [8221886]
- Updated dependencies [3792fbb]
- Updated dependencies [d36034c]
  - @nodaro/shared@2.6.0
  - @nodaro/prompts@1.7.1

## 1.16.0

### Minor Changes

- bbea01b: `UserBalance` gains `effectiveTier` — the derived entitlement tier ("payg" for pay-as-you-go users: no subscription, purchased credits, full model access). `tier` keeps the stored billing tier for back-compat.

### Patch Changes

- Updated dependencies [bbea01b]
  - @nodaro/shared@2.4.0

## 1.15.0

### Minor Changes

- 8c09cd5: `client.models.list({ kind?, mode?, family?, featuredOnly? })` — the new public
  `GET /v1/models` endpoint (REST twin of the MCP `list_models` tool): model
  capability sheets, per-variant credit pricing, `promptTips`, and the
  `doctrineCovered` truth flag for per-model optimizer badges.
- a066015: `client.pickerCatalogs.analyzeText({ text, targetPickers?, ... })` — the new
  `POST /v1/text-to-picker` endpoint: fill picker selections from a free-text
  scene description (same `pickerJson` + `gaps` shape as describe-to-picker;
  omit `targetPickers` to analyze against every catalog).

### Patch Changes

- Updated dependencies [8c09cd5]
- Updated dependencies [34b3b31]
- Updated dependencies [2554aea]
- Updated dependencies [a066015]
  - @nodaro/prompts@1.7.0
  - @nodaro/shared@2.2.1

## 1.14.0

### Minor Changes

- 0043047: `characters.list()` is now cursor-paginated. `ListCharactersParams` accepts an opaque `cursor`, and the result adds `nextCursor` (`string | null`) alongside `characters` — page until it is `null`.

  Previously the call returned at most `limit` rows (default 100) with no way to reach the rest, so a user with more characters than the limit could not see them at all. Existing callers reading `.characters` keep working unchanged, but a single call was never "all characters" and now says so: the new `ListCharactersResult` type is exported.

## 1.13.1

### Patch Changes

- Updated dependencies [c6487c9]
- Updated dependencies [fec478a]
  - @nodaro/shared@2.0.0

## 1.13.0

### Minor Changes

- 1cd6bc1: feat: `Job.source` / `Job.source_detail` — job provenance (which kind of caller created the job: `internal | mcp | app | cli | sdk | extension | web | api` + a narrowing detail) is now exposed on owner-facing job reads, so library views can label and filter media by origin. Browser extensions are recognized as their own source kind (extension-scheme `Origin`, optionally refined by an `X-Nodaro-Client: extension/<name>` label).
- 44b4556: feat: `LibraryAsset.source` / `sourceDetail` + a `source` filter on `client.library.list()` — media can now be labeled and filtered by the surface that produced it (browser extension, studio, CLI, MCP, …) without hydrating each item's job.
- 26c067e: feat: `UserIdentity.isAdmin` on `client.me()` (descriptive only — server-side `requireAdmin` stays the enforcement), plus public marketplace resources: `client.templates.{browse,get,clone}` and `client.tutorials.list()`. Admin/creator template surfaces stay deliberately outside the public SDK.

## 1.12.0

### Minor Changes

- 6cf8fc5: Identify the calling client to the backend, so job origin is recordable.

  Both packages now send an `X-Nodaro-Client` header — `sdk/<version>` and
  `cli/<version>` respectively — which the backend stores as the job's origin.
  Until now an operator looking at a job could not tell a CLI run from an SDK
  integration from a raw REST call: all three looked identical on the server.

  `createClient` gains a `clientLabel` option for anyone building another wrapper
  around the SDK; the CLI uses it to avoid reporting itself as plain SDK traffic.
  Both versions are injected at build time from `package.json`, so the reported
  version cannot drift from the released one.

  The header is sent only where it adds information: in a browser the `Origin`
  header already identifies the app and the backend prefers it, so the default
  label is suppressed there. That also avoids making browser apps depend on the
  header being present in the server's CORS `Access-Control-Allow-Headers` — a
  lagging or self-hosted backend would otherwise fail the preflight and break
  every call from the page.

  No behaviour changes for existing callers, and older versions keep working —
  they are simply recorded as generic API calls.

### Patch Changes

- 46e2def: Don't send `X-Nodaro-Client` from a browser, and let `Origin` identify the app.

  The header was introduced (unreleased) so the backend could tell CLI and
  server-side SDK traffic apart. In a browser it is both redundant and risky:

  - Redundant — the browser already sends `Origin`, which names the actual product
    (`studio.nodaro.ai`) rather than the library that made the call. The backend
    now prefers `Origin`, so a browser-sent header is discarded on arrival.
  - Risky — `X-Nodaro-Client` is not a CORS-safelisted request header, so sending
    it from a page requires an exact match in the server's
    `Access-Control-Allow-Headers`. Against a backend that predates that entry the
    PREFLIGHT fails, breaking every API call from the app rather than just its
    provenance. Self-hosted and lagging deployments make that a real risk.

  The default label is therefore suppressed in browsers. An explicit `clientLabel`
  is always sent — naming yourself is a deliberate act — which is how `@nodaro/cli`
  stays distinguishable.

  No action needed by browser apps: they are identified by `Origin`, which they
  already send.

- Updated dependencies [320ea3c]
- Updated dependencies [320ea3c]
  - @nodaro/shared@1.24.0

## 1.11.0

### Minor Changes

- cb52000: Expose LLM Advanced mode on every programmatic surface, and single-source the
  route defaults it seeds from.

  Advanced mode pins an LLM call to the vendor's own API — the only lane where
  `temperature`, `maxTokens` and the full reasoning-effort range actually take
  effect — and bills one credit tier up. It shipped on the canvas and the REST
  routes, but the SDK, CLI and MCP tools had no way to send it, so anything built
  on top of Nodaro was stuck on the aggregator lane with no signal that the
  sampling knobs it was passing were being ignored.

  - `@nodaro/shared` — new `LLM_ROUTE_DEFAULTS` / `llmRouteDefaults(feature)`: the
    per-feature `temperature` / `maxTokens` / `structuredOutput` each LLM route
    runs with. Previously these lived as literals inside ten separate routes while
    the config panel displayed a hardcoded 0.7/2048, so a node showed one number
    and ran another — and a single arrow-key press committed the wrong one.
  - `@nodaro/sdk` — `promptHelper.*` accepts `advancedMode` / `temperature` /
    `maxTokens`.
  - `@nodaro/cli` — `--advanced`, `--temperature`, `--max-tokens` on the prompt
    subcommands.

### Patch Changes

- Updated dependencies [cb52000]
- Updated dependencies [56d91a3]
  - @nodaro/shared@1.23.0

## 1.10.0

### Minor Changes

- e0964c1: Workflow optimistic concurrency, first-class in the SDK: `UpdateWorkflowInput` gains `expectedUpdatedAt` / `expectedVersion`, and a stale write now throws the new `WorkflowConflictError` (409 `workflow_conflict`) carrying `currentUpdatedAt`, `currentVersion`, and `currentRecord` — the full current workflow returned by the server on conflict, so callers merge-and-retry without a follow-up GET instead of last-writer-wins clobbering concurrent tabs.

### Patch Changes

- Updated dependencies [9e92137]
- Updated dependencies [4938964]
  - @nodaro/shared@1.19.0

## 1.9.0

### Minor Changes

- 1b9b784: Add `client.media.imageCollage()` — composite 2–30 images into one 2K/4K collage via `POST /v1/image-collage`, including the new per-image `imageSizes` relative size hints (`0` auto / `1` big / `2` medium / `3` small, index-aligned with `imageUrls`; smart layout only).

### Patch Changes

- Updated dependencies [72858e1]
- Updated dependencies [ee8061e]
  - @nodaro/prompts@1.5.0
  - @nodaro/shared@1.16.0

## 1.8.0

### Minor Changes

- 7370b4d: Generate Video Pro run control — `client.videoPro.stop(jobId)` (graceful stop: keep + deliver the completed segments as the final video, refund the untouched remainder; the in-flight segment is billed) and `client.videoPro.continueRun(jobId, { fromSegment? })` (a NEW job that reuses the delivered segments and regenerates from `fromSegment` on, billed only for the regenerated part; works on stopped, failed, and completed runs). CLI: `nodaro video-pro stop <jobId>` and `nodaro video-pro continue <jobId> [--from-segment N] [--watch]`.

### Patch Changes

- Updated dependencies [606997d]
- Updated dependencies [2f32c1b]
- Updated dependencies [89bee09]
- Updated dependencies [0dedf9b]
- Updated dependencies [774a2d1]
  - @nodaro/shared@1.14.0
  - @nodaro/prompts@1.4.0

## 1.7.1

### Patch Changes

- 2087527: Content-rejection hardening from the first app_reports batch: the `feature-midriff-visible` / `feature-navel-visible` prompt hints move to garment language (no "bare stomach" anatomy emphasis), `buildPersonHints` folds the pair into ONE neutral clause when both are picked, and `buildStylingHints` skips `makeup-bold-lips` when the shared value map already carries the person catalog's `lip-state-bold-red` (single-map consumers were doubling the lipstick clause). SDK: `GenerateCharacterInput` and `GenerateAssetInput` gain optional `origin` — client-app attribution for the platform's diagnostic reports.
- Updated dependencies [2087527]
  - @nodaro/prompts@1.3.1

## 1.7.0

### Minor Changes

- 87e7d64: New `@nodaro/sdk/supabase` subpath export: `createSharedSupabaseClient` — a browser Supabase client that stores the session in cookies (optionally scoped to a parent domain such as `.nodaro.ai`) instead of localStorage, enabling shared login across sibling-subdomain apps. Includes one-time adoption of an existing localStorage session. `@supabase/ssr` + `@supabase/supabase-js` are optional peer dependencies used only by this subpath.

### Patch Changes

- Updated dependencies [dca72ad]
- Updated dependencies [02cc802]
  - @nodaro/shared@1.13.0
  - @nodaro/prompts@1.2.1

## 1.6.0

### Minor Changes

- 8c019ad: `client.media.downloadVideoProgress(downloadId)` — stream a `downloadVideo` import's live progress (server-sent events) as an async iterable of `{ phase, percent, videoUrl?, thumbnailUrl?, error? }` events, ending after `completed`/`failed`. New exported `DownloadVideoProgress` type; `AudioFxPreset` is now re-exported from the package root (it types `voiceFx.preset` / `applyFx.preset`).

## 1.5.0

### Minor Changes

- 6d3c4c7: Voice adjacent ops on `client.voices`, bringing the SDK to parity with the MCP surface: adds `design()` (`POST /v1/voice-design`), `remix()` (`POST /v1/voice-remix`), `dub()` (`POST /v1/dubbing`), and `createCloneFromFile()` (`POST /v1/voice-clones`, multipart — the file counterpart to `createClone` from a URL). Also fills a param gap on the single-voice `change()`: `model`, `useSpeakerBoost`, and `seed` are now accepted (the backend already supported them). New exported types: `VoiceDesignInput`, `VoiceRemixInput`, `DubbingInput`. README `client.voices` summary corrected to reflect the full surface.
- 66dc3d5: Two new SDK namespaces for the media/audio building blocks a Voice Changer Pro flow composes. `client.media`: `downloadVideo` (social-video import, with range/section fetch), `saveToStorage` (copy a URL into storage), `trimVideo`, `trimAudio`, and `videoMetadata` (probe duration/dimensions without downloading). `client.audio`: `separate` (Demucs stems), `isolate` (denoise/voice-isolate), `applyFx` (reverb/echo/telephone/megaphone), `mix` (layer tracks), `adjustVolume`, and `combine` (concatenate segments). Each generation op returns a job id to poll; `videoMetadata` is a direct read. New exported `VideoMetadata` type.

## 1.4.0

### Minor Changes

- ad8606e: Voice Changer Pro interactive flow on `client.voices`: adds `analyze()` (detect speakers without recasting — `POST /v1/voice-changer-pro/analyze`), extends `recast()` with `output: "video" | "stems"` and `analysis` (pass a prior analyze result to skip re-detection), and adds `exportMix()` (render a mixed set of stems into the final video — `POST /v1/voice-changer-pro/export`). New exported types: `VcpAnalyzeInput`, `VcpAnalysis`, `VcpAnalysisSpeaker`, `VcpExportInput`, `VcpExportTrack`. Together these let any SDK consumer build a full VCP editor (detect → pick a voice per speaker → mix tracks → export), not just the one-shot recast.

## 1.3.0

### Minor Changes

- 774aa2d: Add reasoning-effort control and 6 new KIE LLM models (gpt-5.6-luna/terra/sol, gpt-5.5, claude-sonnet-5, claude-opus-4.8) end-to-end.

  - `@nodaro/shared`: new `LLM_REASONING_EFFORTS` (`none`/`low`/`medium`/`high`/`xhigh`/`max`) + `LlmReasoningEffort` type, `EFFORT_TIER_BUMP` set, and `effectiveReasoningEffort()` helper (clamps a requested effort down to the highest level the target model actually supports). `LLM_MODELS` gains 6 new entries plus per-model `reasoningEfforts`, `supportsTemperature`, and `preferKie` capability fields. `buildLlmCreditIdentifier()` / `resolveLlmCreditId()` take an optional `reasoningEffort` third argument — `xhigh`/`max` (after clamping) bill one credit tier up (economy→standard, standard→premium, premium stays premium); `high` is the Claude-family server default and never bumps.
  - `@nodaro/sdk`: prompt-helper wizard resources' `CommonInput` gains an optional `reasoningEffort` field, forwarded automatically by the existing request-builder spread.
  - `@nodaro/cli`: `nodaro prompt` wizard subcommands gain a `--reasoning-effort <level>` flag (model-dependent; accepts `none|low|medium|high|xhigh|max`).

  `grok-4.5` was evaluated but deferred — its KIE chat endpoint is not yet live, so no registry entry, rate row, or docs were added for it in this release.

### Patch Changes

- Updated dependencies [774aa2d]
  - @nodaro/shared@1.9.0

## 1.2.0

### Minor Changes

- de3f995: Voice Changer Pro: `VoiceChangerProInput.orderedVoices` now accepts `null` entries (keep-slots). A `null` at position i means "keep speaker i's original voice" instead of recasting it. Additive — existing non-null callers are unaffected.

## 1.1.2

### Patch Changes

- 50e2721: Documentation-only: voice changer pro JSDoc now describes behavior without implementation internals.
- Updated dependencies [910fd2d]
  - @nodaro/shared@1.5.0

## 1.1.1

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.
- Updated dependencies [8661d4a]
  - @nodaro/shared@1.4.1
  - @nodaro/prompts@1.0.1

## 1.1.0

### Minor Changes

- cd33c25: License split: creative/prompt modules (person + picker catalogs with hints, identity-lock, entity prompt builders, brand presets, prompt/reference assembly) moved from Apache-licensed `@nodaro/shared` into the new **`@nodaro/prompts`** package (FSL-1.1-Apache-2.0 — free for any non-competing use, Apache after two years per version). `@nodaro/shared` keeps the structural public contract (types, wire enums, model catalog, new `entity-asset-types` vocabulary, hint-graph types). `@nodaro/sdk` now depends on `@nodaro/prompts` and keeps its full API — `buildPersonHints`, `buildPersonSeedPrompt`, and the `PEOPLE` catalog re-exports are unchanged for consumers. Shipped as minors while the packages have no external consumers (registry copies of prior versions are being replaced).

### Patch Changes

- Updated dependencies [cd33c25]
  - @nodaro/shared@1.4.0

## 1.0.3

### Patch Changes

- 37f1805: No functional changes. Republish so the npm provenance attestations reference the repository's current (post-history-rewrite) source commits — earlier versions' attested commit links point at rewritten-away SHAs.
- Updated dependencies [37f1805]
  - @nodaro/shared@1.2.1

## 1.0.2

### Patch Changes

- 6bcdb96: README overhaul for agent-first onboarding: "LLM quick start" moved directly after the server quick start and split into a **universal primer** (reusable in any project; also published raw as `sdk-agent-primer.txt` with `curl | pbcopy` one-liners) and a separate **example project brief** ("animated postcard" — image shown immediately, live % progress via `onProgress`, cancel via `AbortSignal`). The primer names recommended models (`nano-banana-2`, `seedance-2-fast` @ 4s — the platform default) and links full model lists + runtime discovery. New "Connect via MCP" section with per-client connect badges, the Claude Code one-liner, and the MCP-delivered Skills (Film Director / Video Director). Credential cells now deep-link `app.nodaro.ai/settings/api` and `/settings/developer-apps`.
- ccc07e7: README agent primer: published as a raw copyable file (`sdk-agent-primer.txt` on the docs site) with `curl | pbcopy` one-liners, and extended with UX rules for generation apps — show intermediate results while later steps run, drive a live progress bar via `runAndWait`'s `onProgress` (or `jobs.getStatus`), and wire an `AbortSignal` for cancel.
- Updated dependencies [6bcdb96]
  - @nodaro/shared@1.2.0

## 1.0.1

### Patch Changes

- efba386: README: add a "Getting credentials" guide (personal API token vs OAuth app vs self-hosted Supabase mode — and which to use when), a "Run AI nodes directly" quick start showing `nodes.runAndWait`, the full 22-resource table, live docs links, and a "Building with an LLM" section with a paste-into-your-agent primer (auth, core pattern, a complete animated-postcard example, credit/error rules, llms.txt pointer). The hosted base URL in examples is now app.nodaro.ai.

## 1.0.0

### Major Changes

- a33d6ab: Remove the `popularIds` field from `presets.listFactory()` / `GET /v1/node-presets/factory`. The static "Popular" preset band has been removed in favor of a user-driven Favorites feature; `popularIds` is no longer returned.

### Minor Changes

- ca65d28: Add typed support for the new `assemble-narrated-video` node: `AssembleNarratedVideoParams` with typed `client.nodes.run`/`runAndWait` overloads in `@nodaro/sdk`, and the `assembleNarratedVideoCredits` credit estimator (`3 + ceil(blocks/6)`) exported from `@nodaro/shared`.
- 5585889: Admins can now share/unshare community listings via the SDK + CLI. `@nodaro/sdk`: `community.publish()`, `community.unpublish()`, `community.sharedListing()`. `@nodaro/cli`: `community publish/unpublish/shared-status`. (All require an admin token; publishing requires owning the source entity and, for characters, a likeness attestation.)
- 3e14899: Add the `community` resource: browse, get, favorites, clone, favorite, and report shared characters/locations/objects. (Publishing is admin-only via the editor and is intentionally not exposed in the SDK.)
- 5c184c3: Add an optional `duration` (seconds) field to `GenerateCreatureMotionInput` and `GenerateObjectMotionInput`, mirroring `generate-video`'s per-model i2v duration lever. The value is validated server-side against the chosen provider's allowed durations (`POST /v1/generate-creature-motion` / `/v1/generate-object-motion`) and passed through to the underlying video model; when omitted the model's own default is used, so there is no behavior change for current callers. Longer clips on duration-priced models (kling, kling-3.0, wan-i2v, seedance, …) reserve credits at the correct duration tier.
- 4909967: Add `CreaturesResource` to `@nodaro/sdk`, exposed as `client.creatures`, with 13 methods (`list` / `listArchived` / `get` / `create` / `update` / `delete` / `permanentDelete` / `restore` / `generate` / `generateAsset` / `generateMotion` / `approveMainImage` / `recaption`). Mirrors `ObjectsResource` against the deployed creature routes (`/v1/creatures*` + `/v1/generate-creature*`).

  Creature-specific deltas vs objects:

  - `species` free-text field (the creature subject) — the primary differentiator object has no equivalent of
  - `poses` asset bucket where object has `materials`
  - 4-value asset-type enum (angles / poses / variations / custom) — NO `motion` value (creature motion flows through the dedicated `generate-creature-motion` endpoint)
  - free-text `category` (a creature can be any type — not object's fixed 10-value enum)
  - `attachToCreatureId` replaces `attachToObjectId`
  - `generate-motion` reuses the object aspect-ratio enum (5-value: 1:1 / 3:4 / 16:9 / 9:16 / 4:3) and the object motion defaults (provider `kling-turbo` + aspect ratio `1:1`)

  New public exports: `Creature`, `CreatureDetail`, `CreatureReferencePhoto`, `CreatureReferencePhotoKind`, `CreateCreatureInput`, `UpdateCreatureInput`, `UpsertCreatureInput`, `Generate*` input/result types, `CreatureAssetType`, `CreatureAttachColumn`, `CreatureAspectRatio`, plus the runtime tuples `CREATURE_ASSET_TYPES` / `CREATURE_ATTACH_COLUMNS` / `CREATURE_ASPECT_OPTIONS` / `CREATURE_ASPECT_DEFAULTS`.

- ddeb67a: Initial public release.

  - `@nodaro/shared` — types, model registries, prompt helpers, presentation utils, edge/range logic, identity-lock helpers shared across the Nodaro stack.
  - `@nodaro/sdk` — typed REST client for the Nodaro API. Three auth modes (StaticTokenAuth, supabaseAuth, CallbackAuth), 7 resources (workflows, projects, jobs, executions, nodes, developerApps, oauth), typed error hierarchy.

- e6a514f: Added `client.locations` SDK resource and `nodaro locations` CLI subcommand group.

  New SDK methods: `list`, `get`, `create`, `update`, `delete` (soft), `restore`, `generate`, `generateAsset`, `approveMainImage`, `recaption`.

  New CLI subcommands: `list` (supports `--archived`), `get`, `create`, `update`, `delete`, `restore`, `generate` (supports `--watch`), `generate-asset`, `approve-main-image`, `recaption`.

  **Breaking change:** `client.locations.delete(id)` now soft-deletes (returns `{ success: true, archived: true }`). Hard-delete is no longer exposed via SDK; use the archive gallery in the editor for permanent destruction.

  Atmosphere motion clips + archive gallery + 5 environmental tabs ship in PR-2.

- 216f3bb: Added atmosphere motion clip support to Location Studio.

  New SDK method: `client.locations.generateMotion()`.

  New CLI subcommand: `nodaro locations generate-motion`.

  Other changes shipping in this release:

  - Location Studio modal now has all 7 tabs (Appearance + Time of Day + Weather + Seasons + Angles + Lighting + Motion)
  - Archive gallery at `/library/locations` with restore + permanent-delete (typed-name confirmation)
  - 11 locale catalogs for the 46 preset variant labels (English placeholders pending translator pass)
  - Full `docs/location-platform.md` and rewritten `docs/nodes/assets/location.md`
  - New MCP tool `generate_location_motion` (scope: `workflows:execute`)
  - 6th badge on canvas location node (atmosphere motions, amber tint to distinguish video from image badges)

- 9798fad: Add Object Studio surface to SDK + CLI.

  - `@nodaro/sdk`: new `ObjectsResource` exposed as `client.objects`, with 13 methods (`list` / `listArchived` / `get` / `create` / `update` / `delete` / `permanentDelete` / `restore` / `generate` / `generateAsset` / `generateMotion` / `approveMainImage` / `recaption`).
  - `@nodaro/cli`: new `objects:*` subcommand group with 11 commands. `--watch` polls completion inline.

  Object-specific deltas vs locations:

  - 10-value category enum (furniture / vehicle / weapon / food / clothing / electronics / nature / tool / animal / other)
  - 5-value asset-type enum (angles / materials / variations / motion / custom) → 4 attach columns (motion routes to `motion_clips`)
  - 5-value aspect-ratio union (adds 4:3 for product-showcase framing)
  - `generate-motion` defaults: provider `kling-turbo` + aspect ratio `1:1` (not the location `kling` / `16:9` cinematic defaults)
  - `delete --permanent` flag for hard-delete (archived rows only); mirrors SDK's `permanentDelete()`
  - `approve-main-image --expected-updated-at` for optimistic-concurrency-guarded approval
  - `--seed-prompt-hint` on `generate` / `generate-asset` / `generate-motion` (Pass 7 F-77 parameter-picker pass-through)

- acd2564: Add a facial-geometry layer to the structured Person catalog in `@nodaro/shared` and surface it through `@nodaro/sdk`.

  `@nodaro/shared`: new `PersonValue` fields + `PEOPLE` catalog options for a facial-geometry / feature-ratio control layer under the Face section — `cheekbones`, `facialFullness`, `eyelidType`, `canthalTilt`, `eyeSpacing`, `eyeSetBrow`, `noseTip`, and the split `lipFullness` + `lipShape` (the old combined `lips` is kept as a deprecated alias that still resolves). Each option contributes a precise prompt fragment via `buildPersonHints`; neutral options inject nothing. New export `migratePersonValue(value)` relocates legacy `eyeShape` / `lips` values onto the new fields. Backward compatible — option ids are stable, so existing data emits identical prompts.

  `@nodaro/sdk`: re-export `PersonValue`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and `buildPersonHints`, plus a new `buildPersonSeedPrompt(value)` helper that collapses a `PersonValue` into the comma-joined seed-prompt fragment for `characters.generate({ seedPrompt })`.

- fbcd7c8: Add picker-catalog discovery: `client.pickerCatalogs` (`list`/`get`) over the new public `/v1/picker-catalogs` endpoints, plus `summarizePickerCatalogs`/`projectPickerCatalog` helpers in `@nodaro/shared`.
- 5380a50: Add chat methods to the pipelines resource (Phase 1D.2b Guided Mode, §5.9):

  - `pipelines.chatStage(pipelineId, stage, message)` — send a refinement message to the Showrunner Refinement Director; persists user+assistant turns and returns the assistant's reply plus an optional `proposed_change`.
  - `pipelines.applyChatProposal(pipelineId, stage, turnId)` — accept a proposed `edit_artifact` change from a prior assistant turn; the backend validates the JSON Patch, inserts a new attempt, and flips the stage to approved.
  - `pipelines.getStageChat(pipelineId, stage)` — fetch the chat history for a stage (empty array when no turns exist yet).

- 55e3782: Add `client.pipelines.branch(id, { fromStage })` — create a new pipeline by re-running from a completed stage (§5.9).
- bed0093: Rename `client.collect` → `client.reduce` (BREAKING for dev). The existing fan-in reducer node was misnamed "Collect" — its function is to reduce N upstream values into one (Pick best LLM, Concat, First-non-empty, Count, Vote, Merge JSON). Renamed to "Reduce" both to fit the canonical functional-programming term AND to free the "Collect" name for a true type-bucketing aggregator landing in a parallel PR. The route is now `POST /v1/reduce`, the MCP tool is `reduce`, and the SDK exposes `client.reduce.run(...)`. Saved workflows referencing the old `"collect"` node type are auto-migrated on load via a backward-compat shim in the orchestrator (removable once all workflows are migrated; companion DB migration 151 rewrites `workflows.data` JSON + `model_pricing` rows in one pass). Type renames: `CollectStrategyId` → `ReduceStrategyId`, `CollectMeta` → `ReduceMeta`, `CollectInput` → `ReduceInput`, `CollectResult` → `ReduceResult`, `CollectResource` → `ReduceResource`.
- 93adc04: voices.recast(): per-voice recast settings (stability/similarity/style/speakerBoost/seed/volumeMode/volume) + separationQuality + node-level voiceFx (reverb/echo applied to the combined recast voices before the background is mixed back) + node-level musicVolumeMode / musicVolume (level of the preserved background music — match / normalize / manual %)
- 7f38813: Add `voices.recast()` for the multi-speaker Voice Recast capability (`POST /v1/voice-recast`). Recasts each detected speaker to the voice at its position in `orderedVoices`; speakers beyond the array keep their original voice. Accepts `audioUrl` or `videoUrl`, optional `model`, `preserveBackground`, and `removeBackgroundNoise`. Cloud-only, runs async — poll `jobs.get(jobId)`. New public export: `VoiceRecastInput`.

### Patch Changes

- c42a82f: Centralize community listing types in `@nodaro/shared` (single source of truth, re-exported by `@nodaro/sdk`), and add a `community` command group to `@nodaro/cli` (`browse`, `get`, `favorites`, `clone`, `favorite`, `report`) mirroring the SDK resource. Publishing remains admin/editor-only and is intentionally not exposed.
- 0f8bb8b: Fix: surface re-exports that tsup was tree-shaking out of `@nodaro/sdk`'s built bundle. `buildPersonSeedPrompt`, `buildPersonHints`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and the `PersonValue` type — plus the pre-existing `CHARACTER_STYLES` value and `EntityStyle` type — were declared/re-exported in the characters resource but never re-exported from `src/index.ts` (which re-exports characters symbols selectively, not `export *`). As a result they were absent from the bundle and `import { buildPersonSeedPrompt } from "@nodaro/sdk"` did not resolve. All are now re-exported from the package entry point.
- bcf5e08: Add `jobs.getStatus(id)` — a lean job-status fetch hitting `GET /v1/jobs/:id/status`. Returns only `id`, `status`, `progress`, `output_data`, and `error_message` (no `input_data`, cost columns, or timestamps), making it cheaper for poll loops than `jobs.get(id)`. Additive and non-breaking; `jobs.get(id)` is unchanged.
- e0aec7e: Correct the license statement in the `@nodaro/shared` and `@nodaro/sdk` READMEs (the packages are Apache-2.0, not the repository-root Sustainable Use License) and add `repository`/`homepage`/`bugs` metadata to all three published package.json files so npm links back to the source monorepo.
- Updated dependencies [ca65d28]
- Updated dependencies [c42a82f]
- Updated dependencies [5585889]
- Updated dependencies [4260c1e]
- Updated dependencies [64d6d81]
- Updated dependencies [ddeb67a]
- Updated dependencies [acd2564]
- Updated dependencies [7a38259]
- Updated dependencies [b3f214b]
- Updated dependencies [fbcd7c8]
- Updated dependencies [e0aec7e]
  - @nodaro/shared@1.1.0
