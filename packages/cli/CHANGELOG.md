# @nodaro/cli

## 1.40.0

### Minor Changes

- 1999c19: Video Mask re-detection: `nodaro media video-mask --redetect-every <sec>` (0 = off, or 1–10) sends `redetectEverySec`, and `client.media.videoMask` documents it — the subject is detected again every that many seconds, so someone who walks in or turns to the camera mid-shot is masked. Slower; same price.

### Patch Changes

- 906b8ed: Estimated credit figures are marked `≈N` (was `~N`) in `nodaro nodes list`, `nodaro models cost` and `nodaro workflows` output, matching the editor and the apps. The SDK's doc comments for estimate fields say `≈N` too; no type or behaviour changes.
- 7c5daf4: `nodaro workflows render-final --estimate`: a quote the balance does not cover names what the run holds while it renders when that is more than its price.
- 2c92a8c: `seedance` (Seedance 1.5 Pro) is retired: the provider stopped serving the model on 2026-10-25. It leaves the model catalog, `IMAGE_TO_VIDEO_PROVIDERS` / `TEXT_TO_VIDEO_PROVIDERS` / `VIDEO_GEN_PROVIDERS`, `OBJECT_MOTION_PROVIDERS` (where `seedance-2-mini` takes its place), the duration and audio tables, `PIPELINE_PINNABLE_VIDEO_MODELS` and the prompt-wizard descriptions. New `RETIRED_VIDEO_PROVIDERS` + `canonicalVideoProvider()` map a retired id to the model it now runs as (`seedance` → `seedance-2-mini`), and `resolveVideoProviderForMode` applies it, so a saved or sent `seedance` keeps working. The CLI's `objects motion --provider` offers `seedance-2-mini` instead of `seedance`. Code that names the literal `"seedance"` as one of those lists' member types (`ObjectMotionProvider`, `TextToVideoProvider`, `VideoGenProvider`, `PipelinePinnableVideoModel`) no longer compiles: pass it through `canonicalVideoProvider` or use `seedance-2-mini`.
- 12f9aac: `nodaro trends get` names the trend's original among what it shows (the page now carries `original`, and a slot's `hintImageUrl`), and `--example` says to leave it out on a trend with no example, whose empty optional slots stay as in the original.
- 14402d5: Video Mask: `holdLastMask` / `--hold-last-mask` now say the mask is held for at most 1 second.
- Updated dependencies [906b8ed]
- Updated dependencies [7c5daf4]
- Updated dependencies [2c92a8c]
- Updated dependencies [12f9aac]
- Updated dependencies [14402d5]
- Updated dependencies [14402d5]
- Updated dependencies [1999c19]
- Updated dependencies [1999c19]
  - @nodaro/sdk@2.45.0
  - @nodaro/shared@3.42.0
  - @nodaro/prompts@1.42.1

## 1.39.0

### Minor Changes

- 54d4de2: List your MCP conversations — each a flow an assistant built from its steps: `client.workflows.listMcpConversations({ month, sources })` (`GET /v1/mcp-conversations`) and `nodaro workflows mcp-conversations [--month YYYY-MM] [--source claude,chatgpt]`.

### Patch Changes

- 914e157: `nodaro cast-swap full-quality estimate` says whether the Full Quality is the same take at 1080p or, for a Kling 4 run at 720p, a new take, and lists every part of the quote. `nodaro trends get` shows the trend's engine; `--resolution` takes one the trend offers (default its first: 480p, or 720p on a Kling 4 trend, which has no draft).
- Updated dependencies [914e157]
- Updated dependencies [914e157]
- Updated dependencies [54d4de2]
- Updated dependencies [a76b30a]
- Updated dependencies [dc55645]
- Updated dependencies [dc55645]
- Updated dependencies [dc55645]
  - @nodaro/sdk@2.44.0
  - @nodaro/shared@3.41.0
  - @nodaro/prompts@1.42.0

## 1.38.0

### Minor Changes

- fea87e4: `nodaro jobs list --source <s,s>` lists only the jobs the named surfaces created; `--source mcp` lists what your MCP clients (Claude, ChatGPT, …) made.

### Patch Changes

- Updated dependencies [fea87e4]
  - @nodaro/sdk@2.43.0

## 1.37.1

### Patch Changes

- 7621ecf: Trends: a trend can offer only some chips on a slot. `TrendDetailSlot.chips` (always present) lists the chips you may set on that slot, in its kind's order (`[]` = none), and `defaults` covers only those; the new `TrendChipKey` type names a chip. A chip of the slot's kind that it does not list is fixed by the trend, and `estimate()` / `run()` refuse sending it with `400 chip_not_offered` (`err.details` is `{ slot, chip }`). The CLI's `--choice` help says to send only the chips `trends get` lists.
- Updated dependencies [7621ecf]
  - @nodaro/sdk@2.42.0

## 1.37.0

### Minor Changes

- 27048fa: `nodaro cast-swap full-quality estimate <jobId>` and `nodaro cast-swap full-quality run <jobId>` (Cloud edition): finish a draft run (a Cast Swap or trend run made as a draft) at Full Quality — the same take re-rendered at 1080p, as a new job. `estimate` only quotes it (free: "about N credits", the `castSwap` / `seedanceHd` parts, and until when the draft can be finished); `run` starts it (SPENDS CREDITS) and prints the job id, or the draft's existing Full Quality job when there already is one (nothing new is charged). `run --session <id>` files the result in a generation session; `--json` prints the answer as it came.

### Patch Changes

- Updated dependencies [27048fa]
- Updated dependencies [45a4c2d]
- Updated dependencies [45a4c2d]
  - @nodaro/sdk@2.37.0

## 1.36.0

### Minor Changes

- da72776: `nodaro models cost <ids…>`: the credits each identifier is charged, from `POST /v1/credits/model-costs` — a model id, a credit id, or a metered LLM price key (`<feature>:<model>[:direct]`). A metered LLM call is charged for the tokens it uses, so its figure is an estimate and prints as `~N`; an identifier the server cannot price prints `-` with the reason. `--json` passes the answer through whole (`estimates`, `errorCodes` included).
- 5730599: Mask Composite takes `fill`: `"video"` (the default — the foreground, as before), `"pixelate"` (the background itself in blocks of `pixelSizePct` % of the frame width, 0.2–10, default 1.25) or `"blur"` (the background blurred, gaussian sigma `blurStrengthPct` % of the frame width, 0.1–5, default 2) — both relative, so a setting looks the same at any resolution. Pixelate and blur take no foreground: `MaskCompositeRequest.foregroundUrl` is now optional (required for the video fill), the result follows and is priced on the background, and the result always carries the background's sound (`audioSource` is ignored for these fills). `@nodaro/shared` adds `MASK_COMPOSITE_FILLS`, the `PIXEL_SIZE_PCT_*` / `BLUR_STRENGTH_PCT_*` bounds, the new defaults and settings fields, and `maskCompositeFillOf` / `maskCompositeUsesForeground` / `maskCompositeLeadHandle` / `maskCompositeEffectiveAudioSource`. `nodaro media mask-composite` gains `--fill`, `--pixel-size-pct` and `--blur-strength-pct`; with `--fill pixelate|blur` it takes `<backgroundUrl> <maskUrl>`.
- 71f379d: `nodaro trends` (Cloud edition): `list` (`--search`, `--tag`, `--favorites`, `--locale`, `--limit`, `--cursor`), `get <slug>`, `estimate <slug>` (free quote: "about N credits", and the hold when it differs), `run <slug>` (SPENDS CREDITS; prints the job id; `--session`, `--idempotency-key`), `runs` (`--trend`), `favorite <slug>` and `unfavorite <slug>`. `estimate` and `run` take repeatable `--slot key=url[,url]` (a slot's pictures) and `--choice key.chip=new|original` (e.g. `person.outfit=original`), plus `--example <n>`, `--details <text>`, `--preview`, `--resolution 480p|720p|1080p` and `--no-draft`. A slot key is checked locally (1–32 of a–z, 0–9 and `_`, never `__proto__`) before anything is sent; `--slot` pictures are split only where a new http(s) URL starts, so a URL holding commas stays whole; `--limit` is checked locally (1–60). `--session` is accepted but not yet applied: trend runs are not filed into sessions yet.
- 5730599: Video Mask takes `holdLastMask` (default false): frames where the subject is lost — a mask covering under 0.002 % of the picture (`VIDEO_MASK_LIMITS.HOLD_EMPTY_BELOW_FRACTION`) — repeat the most recent non-empty mask; frames before the first detection stay empty, and the frame count, rate and size are unchanged. `VIDEO_MASK_DEFAULTS` and `VideoMaskRequest` gain the field; the job output reports `heldFrames` when it is on. `nodaro media video-mask` gains `--hold-last-mask`.

  Video Mask also takes `minSubjectHeightPct` (0–100, default 0 = off): every connected region (8-connected) whose bounding box is shorter than that % of the frame height is dropped from each frame, before `holdLastMask` — so a frame left with only small regions is held from the last frame with a big subject. `VIDEO_MASK_LIMITS` gains `MIN_SUBJECT_HEIGHT_PCT_MIN` / `MAX`; the job output reports `droppedRegions` when it is on. `nodaro media video-mask` gains `--min-subject-height <pct>`.

  Video Mask also takes `maxSubjectHeightPct` (0–100, default 0 = off), the mirror of the minimum: regions TALLER than that % of the frame height are dropped, in the same pass and before `holdLastMask`. With both set a region is kept when min ≤ height ≤ max; min > max is refused (400). `VIDEO_MASK_LIMITS` gains `MAX_SUBJECT_HEIGHT_PCT_MIN` / `MAX`. `nodaro media video-mask` gains `--max-subject-height <pct>`.

- a7b7f73: Video Mask `zone` and `perShot`, on every surface.

  - `@nodaro/shared`: `VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN` / `ZONE_MARGIN_PCT_MAX` (0–49 % a side), `VIDEO_MASK_DEFAULTS.zone` (`null`, off), `VIDEO_MASK_DEFAULTS.perShot` (`false`, off), the `VideoMaskZone` type (`{ leftPct, rightPct, topPct, bottomPct }`) and `resolveVideoMaskZone`, which reads a zone the way the region filter does (margins clamped to 0–49, anything else 0, all 0 = null).
  - `POST /v1/video-mask` accepts `zone`: only the regions whose bounding-box centre lies inside the inner rectangle the margins leave are kept, after the size cuts and before `holdLastMask`. It accepts `perShot`: the clip's scene cuts are found first and every cut starts a new model request, so the subject is detected again in every shot (a subject that appears after a cut is found) and `holdLastMask` never carries a mask across a cut; each shot's mask is fitted to that shot's exact frame count, so a clip with no cut gives the same mask, fitted to the clip's exact frame count. The job's output reports `shots`.
  - `@nodaro/sdk`: `VideoMaskRequest` (and so `client.media.videoMask`) gains `zone?: { leftPct?, rightPct?, topPct?, bottomPct? } | null` (each 0–49 % of the frame, a margin left out is 0; null = off) and `perShot?: boolean`.
  - `@nodaro/cli`: `nodaro media video-mask` gains `--zone L,R,T,B` (each margin a plain decimal — `5`, `5.`, `.5` — as the API reads it) and `--per-shot`.

### Patch Changes

- da72776: `nodaro nodes list` (and the node picker) show a metered LLM node's credit figure as `~N`: its default model's typical-call estimate, charged its actual usage after the run. A node whose default model has no price yet shows `unpriced`.
- da72776: `nodaro workflows render-final --estimate` prints the estimate as `~N` when the run executes an LLM node (the quote's `estimatedCreditsIsEstimate`), which is charged its actual usage.
- Updated dependencies [e6b7cbb]
- Updated dependencies [e6b7cbb]
- Updated dependencies [a62ed2b]
- Updated dependencies [b64cf61]
- Updated dependencies [b64cf61]
- Updated dependencies [6ca1576]
- Updated dependencies [a7b7f73]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [da72776]
- Updated dependencies [5730599]
- Updated dependencies [23af759]
- Updated dependencies [23af759]
- Updated dependencies [e6b7cbb]
- Updated dependencies [71f379d]
- Updated dependencies [5730599]
- Updated dependencies [a7b7f73]
- Updated dependencies [a7b7f73]
  - @nodaro/sdk@2.36.0
  - @nodaro/shared@3.38.0

## 1.35.0

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
- Updated dependencies [fbf0b82]
- Updated dependencies [82169cf]
- Updated dependencies [fbf0b82]
- Updated dependencies [f75505f]
- Updated dependencies [b3dbb2a]
- Updated dependencies [b3dbb2a]
- Updated dependencies [866182e]
- Updated dependencies [caf9fb6]
- Updated dependencies [bc00ecf]
- Updated dependencies [4636a3e]
- Updated dependencies [4636a3e]
- Updated dependencies [bc00ecf]
  - @nodaro/shared@3.37.0
  - @nodaro/sdk@2.33.0

## 1.34.0

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
- Updated dependencies [e3da394]
  - @nodaro/shared@3.35.0
  - @nodaro/sdk@2.31.0

## 1.33.0

### Minor Changes

- 994c55a: `nodaro apps run-retry <slug> <runId> [--dry-run] [--app-version <n>] [--watch] [--json]` retries a failed app run from where it stopped: only the steps the run did not complete run, and only those are charged. `--dry-run` lists the steps it would run and what it would charge, and starts nothing. When the Retry is refused because the app changed since the run, the CLI prints both ways on: start the run over with `nodaro apps run`, or continue on the run's own version with `--app-version`.
- 8686499: CLI: `nodaro workflows render-final <workflowId> --from <executionId> [--render <nodeId>]` renders the final of a run that stopped at a Preview render (the render at Final and every node after it, continuing that run); `--render` defaults to the workflow's only render, `--estimate` quotes it and runs nothing, and `--watch` follows it. `nodaro workflows run` takes `--override nodeId.field=value` (a per-node override for that run) and `--next <json|file|->`, which sends the `next` of a `continuation_preview_pending` answer exactly as given; a `--from-failed` refused with `continuation_preview_pending` now prints the exact command that finishes the held run. `--next` refuses a body that carries `continueMode` or `renderFinal` (a `next` never does), and the printed command quotes an argument that starts with `=`, which zsh would otherwise expand.

  SDK: documents that a continuation (a run of named nodes, a `renderFinal`, a `next`, or a `continueMode: "from-failed"`) its payer cannot cover throws `InsufficientCreditsError` before any execution exists.

- ea9cb97: A failed run of a saved workflow can be continued from where it stopped. `client.workflows.run` takes `continueMode: "from-failed"` with `continueFromExecutionId` (the run that failed); `nodeIds` is optional with it (default: the nodes the first run of its chain was started on — every node for a run of every node — plus every node the failed run left failed or held back), and the run executes only the nodes that run did not complete — what it completed is handed on, never run or charged again (per node: a node that failed runs again in full, every list item included). When a later continuation of that run completed only part of what it left, the run builds on the newest such one, and `RunWorkflowResult.continuedFrom` names the execution it continued from. `client.workflows.run` also takes a third argument, `{ idempotencyKey }`, sent as the `Idempotency-Key` header (a retry with the same key answers the run already started, `deduped: true` on the result). A run a later continuation supersedes is refused with `continuation_superseded`: one that failed is the one to continue, and one that completed everything the run left means the work is done. The CLI's `nodaro workflows run` takes `--continue-from <executionId>`, `--from-failed` and `--idempotency-key <key>`, and says when a continuation was built on a later one. A Render final, or a run of named nodes, that continues the newest later continuation joins the chain too. When the newest later continuation stopped at a Preview review — of a render, or of a Tighten Episode with review on — the run is refused with `continuation_preview_pending`: the answer names that run, what holds it, and the one run that finishes it (`next`, to send as the body of `client.workflows.run`; for a single render it is that run's Render final). The SDK throws it as the new `ContinuationPreviewPendingError` (`@nodaro/sdk/errors`: `executionId`, `renderNodeIds`, `reviewNodeIds`, and `next`, typed `HeldFinalRun`), so `client.workflows.run(workflowId, error.next)` finishes it. A Tighten Episode or Chapters node resumes its earlier failed attempt only when its inputs and settings are still the ones that attempt ran with; otherwise it runs fresh. `@nodaro/shared`: the `continuation_not_failed` and `continuation_superseded` codes now document the saved-workflow lane too, and the new `CONTINUATION_PREVIEW_PENDING` code joins `RUN_CONTINUATION_CODES`.
- 641e2e9: Chapters (`episode-chapters`) — list a podcast recording's chapters in one call.

  - `@nodaro/shared`: its chapter list is declared a JSON output that is neither a Transcript nor an EDL, and a published app shows its show notes as text.
  - `@nodaro/sdk`: `client.edit.episodeChapters` and `client.edit.estimateEpisodeChapters` (`EpisodeChaptersInput`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"episode-chapters"`, and `continueUseCase` continues a Chapters run on its own route. An earlier SDK knows only `"tighten-episode"`: it continues a Chapters run on the Tighten Episode route, which answers `not_found` — upgrade to continue Chapters runs.
  - `@nodaro/cli`: `nodaro edit episode-chapters --media <url> [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints the show notes when the run completes); `nodaro edit continue-use-case --type` accepts `episode-chapters`.

- 25c5f17: Trailer (`episode-trailer`) — a 20–40 second trailer of a podcast recording, delivered in each chosen social format, in one call.

  - `@nodaro/shared`: `episode-trailer` joins `FAN_OUT_EACH_HANDLES` (its `media` output is one trailer per format: each on an Each wire), `VIDEO_PRODUCER_TYPES` and `REVIEW_HOLDING_USE_CASE_TYPES` (a Trailer with Review before render on holds what follows it, like Tighten Episode). Its `json` output is declared an EDL, and its `introCard` input is not a prompt lane. A client that branches on a refused review run already matches every code with `isPreviewRefusalCode`.
  - `@nodaro/sdk`: `client.edit.episodeTrailer` and `client.edit.estimateEpisodeTrailer` (`EpisodeTrailerInput`, `TRAILER_FORMATS`, `TrailerFormat`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"episode-trailer"`, and `continueUseCase` continues a Trailer run (from where it failed, or its Render final) on its own route. An earlier SDK does not know `"episode-trailer"`: it continues a Trailer run on the Tighten Episode route, which answers `not_found` — upgrade to continue Trailer runs.
  - `@nodaro/cli`: `nodaro edit episode-trailer --media <url> [--intro-card <url>] [--formats 9:16,1:1,4:5,16:9] [--review] [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints each format's trailer when the run completes, then the formats that could not be rendered; with `--review`, how to render it final); `nodaro edit continue-use-case --type` accepts `episode-trailer`.

- d1bbb43: Generate Mask from the CLI: `nodaro media generate-mask <imageUrl> <prompt> [--threshold <n>] [--watch]` selects a subject described in plain text in an image (`POST /v1/generate-mask`, Grounded SAM) and returns a job whose output carries `maskUrl` (a black-and-white mask PNG, white = the subject) and `imageUrl` (the source image, passed through unchanged). It runs through the SDK's typed `nodes.run("generate-mask", …)`, the one SDK way to start it. `@nodaro/shared/media` adds the wire contract — `GenerateMaskRequest`, `GenerateMaskOutput` and `GENERATE_MASK_LIMITS` (prompt 1–500 characters, threshold 0–1, default 0.3) — which the route now validates against.
- a44baa3: A generation session's cover: `sessions.update(id, { coverJobId })` picks one of the session's items to lead its previews (`null` goes back to automatic), and `GenerationSession.coverJobId` reports it — `previewUrls` then starts with the cover's image. The CLI's `nodaro sessions update` gains `--cover <jobId>` and `--auto-cover`.
- b40902e: `client.edit.continueUseCase` continues a run on its own node type's route (`POST /v1/<type>/continue`). It takes an optional `nodeType`; without one it reads the job first (`GET /v1/jobs/:id`) for the type the run records, and when that read cannot tell (a token without `jobs:read`, or a job that records no use-case type) the type must be passed as `nodeType`. New exports: `UseCaseNodeType`, `USE_CASE_NODE_TYPES`, and `UseCaseJobResult` / `UseCaseEstimate` (the `TightenEpisodeJobResult` / `TightenEpisodeEstimate` shapes, which stay as aliases). The CLI's `nodaro edit continue-use-case` takes an optional `--type <type>`, passed through so the job is not read for it.

### Patch Changes

- 345cabf: Import `@nodaro/sdk` by subpath entry (`@nodaro/sdk/client`, `@nodaro/sdk/errors`, …) instead of the package root. No CLI change. These subpaths exist only from the `@nodaro/sdk` minor released alongside, so this release raises the `@nodaro/sdk` dependency range to that version.
- 87448e1: A continue-from-failed (`continueMode: "from-failed"`, `nodaro workflows run --from-failed`) counts every id in `nodeIds` / `--node` as named: a node of work no run of its chain ever ran (each only handed on its saved results) runs and is priced, while a source, trigger, parameter picker or container keeps what the run handed on and a node set to skip never runs. The SDK's `RunWorkflowParams.nodeIds` and `continueMode` docs and the CLI's `--from-failed` help say so; the `nodeIds` doc no longer says the default is every node.
- 5d9e2cd: What a continue-from-failed (`continueMode: "from-failed"`, `nodaro workflows run --from-failed`) sent no `nodeIds` / `--node` considers: the nodes the first run of its chain was started on — a run started on named nodes (the editor's Run selected, an API `nodeIds`, a Render final) is continued on those; a run of every node, or one started before the nodes were recorded, on every node — plus every node left failed or held back by the run being continued, by a newer continuation it is built on, or by an earlier run of its chain, so a failure outside those nodes is always retried. `nodeIds` you send replace those nodes, and the run is built on the chain's newest continuation when it failed or its work is done (one held at a Preview review still answers `continuation_preview_pending`), and a node they name that is still left runs. The SDK's `RunWorkflowParams.continueMode` doc and the CLI's `--from-failed` help say so. `WorkflowExecution` gains `nodeScope` (`client.executions.get`): the nodes the first run of its chain was started on, `null` for every node.
- b60db72: The built-in ("factory") preset catalog is readable without a token: `GET /v1/node-presets/factory` is now a public route, so `client.presets.listFactory(nodeType)` works on a tokenless client (`createClient({ baseUrl, auth: { getToken: async () => null } })`) — a client app can show the catalog (names, example pictures via `previewUrl`, how many photos a preset needs via `minReferences` / `needsImage`) to visitors who are not signed in and ask for a login only when they generate. The response is cached for 5 minutes like the model catalog, and an invalid or expired token sent with the request is ignored (an OAuth app needs no scope for it). `@nodaro/prompts`: `getFactoryPresets()` and `presetMinReferences()` answer an empty catalog / zero for a node type that is not a catalog key even when it names an `Object.prototype` member (`constructor`, `toString`), instead of throwing. Your own presets, favorites and folders still need auth exactly as before. Nothing to change in an existing app. CLI: `nodaro presets list --factory --node-type <type>` no longer needs a saved profile (`--base-url <url>` asks another instance; without `--factory`, `presets list` still needs one).
- 3840a98: `USE_CASE_NODE_TYPES` is now `@nodaro/shared`'s list (`@nodaro/shared/nodes`), re-exported as before, and `continueUseCase` builds each continuation route from it (`POST /v1/<type>/continue`). `continueUseCase` rejects with `use_case_type_unknown` when the run's type cannot be read — pass `nodeType`: a key without the `jobs:read` scope, or a job that records no use-case type, no longer falls back to the Tighten Episode route, and nothing is posted. In the CLI, a key without `jobs:read` now needs `--type` on `nodaro edit continue-use-case`, and the error says so ("pass --type <node type>"; code `use_case_type_unknown`, kept under `--json`).
- Updated dependencies [8686499]
- Updated dependencies [87448e1]
- Updated dependencies [5d9e2cd]
- Updated dependencies [ea9cb97]
- Updated dependencies [641e2e9]
- Updated dependencies [25c5f17]
- Updated dependencies [435c134]
- Updated dependencies [42001e0]
- Updated dependencies [447292c]
- Updated dependencies [2caffe2]
- Updated dependencies [8f5eec1]
- Updated dependencies [d551823]
- Updated dependencies [b4ce8e5]
- Updated dependencies [c645465]
- Updated dependencies [8eacb99]
- Updated dependencies [5cf6e9d]
- Updated dependencies [b60db72]
- Updated dependencies [994c55a]
- Updated dependencies [cdda07e]
- Updated dependencies [4f2c840]
- Updated dependencies [d1bbb43]
- Updated dependencies [345cabf]
- Updated dependencies [b5f28a5]
- Updated dependencies [a44baa3]
- Updated dependencies [42001e0]
- Updated dependencies [8eacb99]
- Updated dependencies [2f89724]
- Updated dependencies [25c5f17]
- Updated dependencies [3840a98]
- Updated dependencies [3840a98]
- Updated dependencies [b40902e]
- Updated dependencies [aa97e61]
- Updated dependencies [3e4a5cd]
- Updated dependencies [3e4a5cd]
- Updated dependencies [0541d0b]
  - @nodaro/sdk@2.30.0
  - @nodaro/shared@3.34.0
  - @nodaro/prompts@1.40.0

## 1.32.0

### Minor Changes

- a4793b7: Plans and prices: `client.billing` — `plans()` lists the plans and credit packs on sale with what each costs (`GET /v1/billing/plans`, public: it works signed out, Nodaro Cloud only); `subscription()` returns the account's subscription and the tier its entitlements follow (`effectiveTier` — match it to a plan `id` to mark the current plan); `surface()` and `account()` read how the deployment bills and the caller's plan and balance in its unit. Prices are `{ amount, currency }` in the currency's major unit; each price carries what it grants (`credits: { amount, per }`, `null` when not stated), the free plan its one-time `signupCredits`; a price that cannot be stated right now is `null`, never free. Buying stays in the Nodaro app. New CLI commands: `nodaro billing plans | subscription | account | surface` — `plans` and `surface` need no sign-in (`--base-url` to ask another instance).
- dd16c1d: Connected apps and character training on the SDK, and readable errors from older routes.

  - `client.connectedApps()` lists every app with access to the signed-in user's account (`ConnectedApp`: `authorizationId`, `name`, `kind`, `homepageUrl`, `scopes`, `connectedAt`, `lastUsedAt`), and `client.revokeConnectedApp(authorizationId)` ends one app's access and every token under it. Both answer a signed-in browser session only (`supabaseAuth`); an API key or app token gets `UnauthorizedError`.
  - `client.characters.train(id, { selectedImageUrls? })`, `trainingStatus(id)` and `deleteLora(id)` train, follow and remove a character's high-fidelity model (Nodaro Cloud only; elsewhere `NotFoundError`). With an OAuth app token, `train` and `deleteLora` need the `assets:write` scope (`ForbiddenError` otherwise). New types: `TrainCharacterInput`, `TrainCharacterResult`, `CharacterTrainingStatus`, `CharacterTrainingState`, `TrainCharacterRefusalCode`.
  - `throwFromResponse` now reads the error bodies some older routes send — `{ error: "<code>", message? }`, OAuth's `{ error, error_description }` and a bare `{ message, issues }` (`validation_error`) — so those refusals carry their real `code` and `message` instead of `internal_error` / "Request failed". At HTTP 500 and above only their code is read, never text from outside the `{ error: { code, message } }` envelope. Typed classes are still chosen by status; one with no message from the server keeps its default ("Not found", "Authentication required") instead of "Request failed". `InsufficientCreditsError.required` / `.available` are now filled from the `required` / `balance` the credit guard sends beside the envelope. Nothing to change unless you matched on `code === "internal_error"` for such a route.
  - CLI: `nodaro characters train <id> [--image <url> …] [--watch]`, `nodaro characters training <id> [--watch]` (exit 0 succeeded, 2 failed or could not be started, 130 cancelled or removed; a 4xx ends the watch) and `nodaro characters delete-lora <id>`.

- f38f7f9: Search the saved characters, locations, objects and creatures by words: `q` on `characters.list()`, `locations.list()`, `objects.list()` and `creatures.list()` keeps the rows whose name or description contains every word of it (split on spaces, the first five), in any order and ignoring case — `"red car"` finds "Car, red" — and combines with every other filter and with cursor paging. `library.list()` takes the same `q` for its filename search; `search` still works and is deprecated. Each word is matched as written: `%`, `_` and `*` are not wildcards, and punctuation is kept. A blank `q` is no search. The CLI's `characters list`, `locations list` and `objects list` take `--search <words>` (or `--q <words>`). `q` needs a server from this release: an older one ignores it and returns the unfiltered list.
- 8d60d35: Several images in one generate-image call. `GenerateImageParams` types `count` (1–4 images, each its own job) and `models` (the same request on 2–4 image models instead of `provider`; with `count`, per model, at most 8 images), plus `seed` (image i gets `seed + i`) and `userPrompt` (the prompt as your user typed it — stored on the job, never sent to the model). With a literal `count` above 1 or `models`, `nodes.run("generate-image", …)` is typed to answer `GenerateImageBatchResult` — every job id grouped by model (`jobIds`, `groups` with credits and per-model corrections, `batchId`, `totalCredits`); the batch is checked against the balance and charged as a whole or not at all, and with an `idempotencyKey` each image is keyed `<key>:<i>` so a retry returns the same jobs. The new `nodes.runBatchAndWait("generate-image", params, opts)` submits once and waits for every job, resolving `{ batch, results }` with one `BatchJobOutcome` per job, so one image failing never discards the others. `runAndWait` and `runMany` now refuse a batch request before anything is sent (`batch_requires_run_batch_and_wait`) instead of silently waiting for its first job. `jobs.list({ batchId })` lists a batch's jobs. `origin` and `sessionId` (`GenerationSessionParams`) are now typed on every generation params type — video upscale / depth / narrated video, the 3D scene params and the character / object / location / creature generate inputs — since the platform stamps them on every job-creating request; an `origin` that is not a slug is refused with a 400. The CLI's `nodaro nodes run generate-image` takes `--count` and `--models`, prints the job ids grouped by model, and `--watch` follows every job of the batch.
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

- 7f63d32: `GenerateImageParams` types `presetId` and `presetVariables`: `POST /v1/generate-image` now applies a node preset exactly as the editor does (prompt and pre/post text, placeholder defaults, style, negative prompt, levers), so `nodes.run("generate-image", { presetId })` sends the editor's request. The CLI's `nodes run` help shows a preset example.
- Updated dependencies [a4793b7]
- Updated dependencies [dd16c1d]
- Updated dependencies [f38f7f9]
- Updated dependencies [8d60d35]
- Updated dependencies [7f63d32]
- Updated dependencies [6043437]
- Updated dependencies [1e4e50d]
- Updated dependencies [9ddf163]
- Updated dependencies [ab1a3f2]
- Updated dependencies [e5c4123]
- Updated dependencies [94478f0]
  - @nodaro/sdk@2.29.0
  - @nodaro/shared@3.33.0
  - @nodaro/prompts@1.39.0

## 1.31.0

### Minor Changes

- 0dae8d0: `nodaro sessions` — generation sessions inside projects: `list`, `get`, `items`, `create`, `update` (title, archive), `import` (your own jobs, as links, all-or-nothing), `remove` (the link only) and `delete` (its jobs are kept).

### Patch Changes

- Updated dependencies [0dae8d0]
- Updated dependencies [9ad0760]
  - @nodaro/sdk@2.28.0

## 1.30.0

### Minor Changes

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
- Updated dependencies [bc867a8]
- Updated dependencies [8b88e2e]
- Updated dependencies [80ac0c8]
- Updated dependencies [ec1af00]
- Updated dependencies [2019569]
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
  - @nodaro/sdk@2.27.0

## 1.29.0

### Minor Changes

- ea015e7: Split into Chunks on the SDK and CLI. `client.media.splitMedia(input)` (`POST /v1/split-media`) cuts a video and/or an audio file into consecutive parts of at most `chunkDuration` and at least `minPartDuration` seconds (default 4), frame/sample-exact; the new `SplitMediaInput` and `SplitMediaOutput` types describe the body and the completed job's `output_data` (`videoUrls`, `audioUrls`, `chunkCount`, `partDurationsSec`, `audioPartDurationsSec`). The CLI gains `nodaro media split-media --video <url>|--audio <url> --chunk-duration <sec> [--min-part-duration <sec>] [--format mp3|wav|aac] [--watch]`. Additive.

### Patch Changes

- bb9fbb6: `nodes.run(type)` now posts every node type to the route that runs it. Node types whose route is not `POST /v1/<type>` — `llm-chat`, `image-to-text`, `video-composer`, `after-effects`, `motion-graphics`, `lottie-overlay`, `3d-title`, `telegram-channel-feed`, the `suno-*` nodes and the social post nodes — used to get a 404; they now reach their real route, and a per-platform social post node (`x-post`, …) fills in its `platform` when the body leaves it out. A node type with no route of its own (`modify-image`, `paint-mask`, …) rejects with a `NodaroError` of code `node_not_runnable` naming what to run instead, without calling the API; a type that runs only inside a workflow (`upload-image`, `combine-text`, …) rejects with the same error when the API answers that it has no route for it, instead of a bare `NotFoundError`. A `404` about a missing resource is still a `NotFoundError`, which now carries the server's message when the response has no error object.

  `@nodaro/shared` exports the route table the SDK and the platform share: `NODE_RUN_ROUTES`, `NODE_TYPES_WITHOUT_RUN_ROUTE`, `nodeRunRoute(type)` and `SOCIAL_POST_NODE_PLATFORM`.

  `nodaro nodes run <type>` runs through `nodes.run`, so the CLI (standalone binaries included) picks up the same routing and the same early error.

- Updated dependencies [7ae9066]
- Updated dependencies [bb9fbb6]
- Updated dependencies [a099cbc]
- Updated dependencies [aed3ad2]
- Updated dependencies [ea015e7]
- Updated dependencies [7ec852c]
- Updated dependencies [d46fc97]
- Updated dependencies [b3cac89]
  - @nodaro/shared@3.31.0
  - @nodaro/sdk@2.26.0

## 1.28.1

### Patch Changes

- 1f10432: - `client.nodes.run("video-depth", …)` / `runAndWait("video-depth", …)` are typed: `VideoDepthParams` (`videoUrl`, `provider?`, `modelSize?`, `colormap?`, `resolution?`, `sideBySide?`), and the `VideoDepthProvider` / `VideoDepthModelSize` / `VideoDepthColormap` / `VideoDepthResolution` vocabularies are re-exported from `@nodaro/shared`.
  - CLI: `nodaro nodes run --help` shows a `video-depth` example.
- Updated dependencies [90e11f7]
- Updated dependencies [1f10432]
  - @nodaro/prompts@1.37.1
  - @nodaro/sdk@2.25.0

## 1.28.0

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
  - @nodaro/sdk@2.23.0

## 1.27.0

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
  - @nodaro/sdk@2.22.0
  - @nodaro/prompts@1.36.0

## 1.26.2

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
  - @nodaro/sdk@2.21.1

## 1.26.1

### Patch Changes

- 1f414c9: ElevenLabs Dialogue v4's total-character cap across lines rises from 5,000 to 10,000 (`getDialogueCapabilities("elevenlabs-dialogue-v4").maxChars`): a 10,000-character v4 dialogue was voiced whole in a live check on 2026-10-06, well inside the platform's time limit. v3 dialogue stays at 5,000. The SDK's `voices.textToDialogue()` JSDoc and `nodaro voice dialogue --help` state each model's own cap.
- Updated dependencies [0320eec]
- Updated dependencies [b9e7c8a]
- Updated dependencies [1f414c9]
- Updated dependencies [cd26efd]
- Updated dependencies [23a9098]
- Updated dependencies [d61bff7]
- Updated dependencies [0320eec]
- Updated dependencies [a36adeb]
- Updated dependencies [1f21d46]
- Updated dependencies [1766435]
- Updated dependencies [887bfdf]
- Updated dependencies [cec354b]
  - @nodaro/sdk@2.21.0
  - @nodaro/shared@3.25.0
  - @nodaro/prompts@1.34.0

## 1.26.0

### Minor Changes

- 1a11a27: `nodaro edit plan --mode` accepts `trailer`. The check now reads `EDIT_PLAN_MODES` from `@nodaro/shared`, so the CLI accepts exactly the modes the SDK and MCP accept, and the `--mode` help lists them from the same source.
- 9d492ee: Collections — where a workflow's records live. A collection is a named set of records (a title, a text, a link, media links, extra fields, provenance) that a workflow writes to and reads back; text and links only, never files. The same link saved twice is one record; past the plan's cap the oldest records are evicted after a write.

  - `@nodaro/shared`: `Collection`, `CollectionRecord`, `CollectionMedia`, `CollectionRecordSource`, the caps by tier (`COLLECTION_TIER_CAPS`, `collectionCapsForTier`), the wire shapes (`ListCollectionsResult` with `available` and `caps`, `ListCollectionRecordsResult`, `AddCollectionRecordInput` / `AddCollectionRecordResult` with `outcome: "inserted" | "duplicate" | "replayed"` and `evicted`), and the one rule every surface renders records with: `collectionRecordHeadline`, `collectionRecordsDigest(records, "headlines" | "full")`, `ingestRecordFromJson(item)` (any JSON item — a feed post, a search result, an article object — mapped to a record), `normalizeDedupeKey`, `normalizeCollectionMedia`, `normalizeCollectionFields`, `isCollectionUrl`.
  - `@nodaro/sdk`: `client.collections` — `list`, `get`, `create`, `update`, `delete`, `records`, `addRecord` (with an `idempotencyKey`), `deleteRecord`, `export` (CSV or JSON text).
  - `@nodaro/cli`: `nodaro collections list | create | show | update | delete | records | add | remove | export`.

- 023327b: Competitors over time. Scans are kept for a window that follows the plan (`CompetitorListResult.historyMonths` on the list; `client.competitors.listWithPlan()`), every platform tally carries the account's `followers`, `client.competitors.get(id, { scan })` opens a brand as of one scan, `history(id)` (`CompetitorHistory`) is the brand's scans oldest first with what each found and read per platform, and `compare(id, { from, to, vsFrom?, vsTo? })` (`CompetitorCompareResult`) answers one or two periods: posts by publish date, usual reach, followers and their change, what worked, the best posts. The CLI gains `competitors history <id>` and `competitors compare <id> --from --to [--vs-from --vs-to]`.
- 68f8146: `nodaro edit apply-edl` takes `--clip-key <key>`: the plan clip a render cuts (`"<first inMs>-<last outMs>"` of a clips-mode plan clip), passed as `clipKey` and stamped back on the job's result, as `edit.applyEdl` already allowed. The SDK's `edit` resource documentation now describes the multicam flow (`audioSync` → `editPlan` → `cameraSwitch` → a Preview, then the final) and that `cameraSwitch` relays from a connected self-hosted install like `editPlan`. Additive.
- ceca5b3: `audio.mix` accepts an optional `duck`: every track except `duck.under` (the voice) dips while that track is loud and rises back in its pauses, so a music bed sits under speech. `amount` (0-100) sets how hard; `thresholdDb`, `ratio`, `attackMs` and `releaseMs` are optional fine controls. The CLI gains `nodaro audio mix --duck-under <index> [--duck-amount <0-100>]`. Additive; a mix without `duck` is unchanged.
- fd20c51: `voices.textToDialogue` and `nodaro voice dialogue` can choose the dialogue model (`elevenlabs-dialogue`, the default, or `elevenlabs-dialogue-v4`) and send similarity; stability is any 0–1 value on v4 and 0, 0.5 or 1 on v3. The SDK's `stability` type widens from `0 | 0.5 | 1` to `number` (source-compatible for existing callers).
- 63fade1: `nodaro voice recast` takes `--v4 <indexes>` beside `--v3`: the named 1-based speakers are re-spoken on the newer Re-speak engine (any stability 0–1, `similarityBoost` honoured, each line generated with its neighbours as context). The same range and keep-slot checks as `--v3` apply, and an index named in both flags is refused. `--v3` is unchanged.

### Patch Changes

- 7dd35ec: `nodes.run("text-to-speech", …)` and `runAndWait` are typed (`TextToSpeechParams`) and take `previousText` / `nextText` — the lines spoken just before and after the clip, so a model that stitches (ElevenLabs v4, Turbo v2.5 and Multilingual v2; not v3) keeps one continuous intonation across clips produced separately. Up to 1,000 characters each. The CLI's `nodes run` help shows the two parameters.
- Updated dependencies [9cb2a0d]
- Updated dependencies [a451774]
- Updated dependencies [c48a85e]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [0be3860]
- Updated dependencies [3bec25f]
- Updated dependencies [9d492ee]
- Updated dependencies [023327b]
- Updated dependencies [9cb2a0d]
- Updated dependencies [86df84c]
- Updated dependencies [68f8146]
- Updated dependencies [8777f7b]
- Updated dependencies [1a11a27]
- Updated dependencies [8777f7b]
- Updated dependencies [1a11a27]
- Updated dependencies [fd20c51]
- Updated dependencies [94c1fbf]
- Updated dependencies [835c6d3]
- Updated dependencies [9cb2a0d]
- Updated dependencies [1d106aa]
- Updated dependencies [835c6d3]
- Updated dependencies [3b4e26c]
- Updated dependencies [ceca5b3]
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
- Updated dependencies [fd20c51]
- Updated dependencies [ff32a3f]
- Updated dependencies [1a11a27]
- Updated dependencies [9c2120c]
- Updated dependencies [7dd35ec]
- Updated dependencies [7603c20]
- Updated dependencies [747151b]
- Updated dependencies [ff32a3f]
- Updated dependencies [d81639f]
- Updated dependencies [7dd35ec]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [9cb2a0d]
- Updated dependencies [63fade1]
- Updated dependencies [9cb2a0d]
  - @nodaro/shared@3.22.0
  - @nodaro/sdk@2.20.0
  - @nodaro/prompts@1.31.0

## 1.25.1

### Patch Changes

- 5b63574: A LinkedIn account can be a person's profile (`linkedin.com/in/…`) as well as a company page: the `SocialSearchMode` and `SocialSearchRequest.query` docs say so, and `nodaro competitors add --linkedin` describes the field as a company page or person's profile. No types change.
- Updated dependencies [5b63574]
- Updated dependencies [4a6fd02]
  - @nodaro/shared@3.17.1

## 1.25.0

### Minor Changes

- 470cbe2: Add `nodaro edit switch-cameras --edl <file> --transcript <file> [--speaker-map <file>] [--speaker-names <file>] [--min-shot-ms] [--lead-ms] [--max-shot-ms] [--wide-every] [--layout-hints]`: put each cut of an edit on the camera of whoever is speaking.
- 5b8496b: - `nodaro recast estimate` / `create` / `start` take `--segment-pack scenes-max|scenes|max` in place of `--segment-sec <n>`. The API takes a pack name there, so the old option sent a number of seconds that the server rejected.
  - The README links the command reference on nodaro.ai/docs instead of the old GitHub Pages copy.
- ba1ae16: Did it work? "I did this" on an action card, and how it went. `@nodaro/shared` adds the mark types (`CardAction`, `CardActionResult`, `CardOutcome`, `CardOutcomeState`, `CardSnapshot`, `CardVerdict`, `AdviceRecord`, `AdviceFamily`, `CompetitorActionsResult`, `MarkCardInput`, `UpdateCardActionInput`, `CARD_OUTCOME_STATES`, `ADVICE_FAMILIES`), `adviceFamilyOf` and `isMeasurableCard`, and `CompetitorCardsResult.record`. `@nodaro/sdk` adds `client.competitors.tried()`, `markDone(cardId, { postUrl })`, `linkPost(markId, url | null)`, `markSeen(markId)` and `unmark(markId)` (`/v1/competitors/actions*`), and re-exports the lesson and mark types. `@nodaro/cli` adds `nodaro competitors done`, `tried`, `link` and `undo`, and `cards` shows the id to mark a card done.
- d80feff: What works for a brand (stage 4 of the research rollout): `@nodaro/shared` adds the lesson types (`BrandLesson`, `BrandPlatformLessons`, `BrandLessons`, `CompetitorLessonsResult`, `BRAND_LESSON_KINDS`); `@nodaro/sdk` adds `client.competitors.lessons(id)` (`GET /v1/competitors/:id/lessons`); `@nodaro/cli` adds `nodaro competitors lessons <id>`.

  `socialSearchPostVideo` answers `{ kind: "none" }` for an image or a text post, which has no video to analyze.

- 95523c6: Competitor tracking (Nodaro Cloud): `@nodaro/shared` adds the tracked-brand, scan and action-card shapes, the card `kind` vocabulary and the scan price (`competitor-scan:<n>`, one Social Search page per search). `@nodaro/sdk` adds `client.competitors` (`list`, `get`, `create`, `update`, `delete`, `cards`, `discover`, `scan`) and re-exports the types. `@nodaro/cli` adds `nodaro competitors` (`list`, `add`, `discover`, `scan`, `cards`, `show`, `update`, `remove`).
- 17d734b: `nodaro edit plan` takes `--offsets <file>` (an `edit audio-sync` job's `output_data.json` over the same source ids) and `--transcript-source <id>`, and `--source` accepts `id=url[@kind]` to name a source the way `edit audio-sync` does.
- df2f7b4: Saved posts, the inspiration wall: `@nodaro/shared` adds the `SavedPost` shape and the request and answer types of `/v1/saved-posts`. `@nodaro/sdk` adds `client.savedPosts` (`list`, `save`, `lookup`, `update`, `delete`) and re-exports the types. `@nodaro/cli` adds `nodaro saved-posts` (`list`, `save --file`, `update`, `delete`).

### Patch Changes

- e98ff5b: Advanced mode's help text now says its one-tier credit bump is capped at premium: a request already at the premium tier stays there.
- Updated dependencies [e98ff5b]
- Updated dependencies [470cbe2]
- Updated dependencies [470cbe2]
- Updated dependencies [8dc01f1]
- Updated dependencies [ba1ae16]
- Updated dependencies [d80feff]
- Updated dependencies [95523c6]
- Updated dependencies [5f14bf9]
- Updated dependencies [17d734b]
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
- Updated dependencies [5b8496b]
- Updated dependencies [2a61d66]
- Updated dependencies [20edcd9]
- Updated dependencies [08c60ee]
- Updated dependencies [3d9bae0]
- Updated dependencies [10d0467]
- Updated dependencies [fa682e5]
- Updated dependencies [09b138b]
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
  - @nodaro/sdk@2.18.0
  - @nodaro/shared@3.15.0
  - @nodaro/prompts@1.28.0

## 1.24.0

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
  - @nodaro/sdk@2.17.0

## 1.23.0

### Minor Changes

- 0634fd8: Add `nodaro edit audio-sync --source <[id=]url> … [--sources-file <file>] [--reference <id>]`: measure how far apart the clocks of 2–6 recordings of one conversation are, from their sound (keyless on every edition).

### Patch Changes

- Updated dependencies [0634fd8]
  - @nodaro/sdk@2.16.0

## 1.22.0

### Minor Changes

- 7872bd7: Video Overlay: `client.media.videoOverlay(input)` (`POST /v1/video-overlay`) places 1–20 timed image layers over a video, and `nodaro media video-overlay <videoUrl> [layerUrls...]` exposes it (`--at <start[-end]>` per layer, `--preset`, `--corner`, `--layers-file`, `--aspect`, `--base-fit`, `--background-color`, `--watch`).

### Patch Changes

- Updated dependencies [161a68a]
- Updated dependencies [02a08ae]
- Updated dependencies [0e7624c]
- Updated dependencies [e379928]
- Updated dependencies [7872bd7]
- Updated dependencies [7872bd7]
  - @nodaro/shared@3.13.0
  - @nodaro/prompts@1.26.0
  - @nodaro/sdk@2.15.0

## 1.21.0

### Minor Changes

- a3e000a: `nodaro media add-captions` gains `--animate/--no-animate`.
- 65b4cdd: `nodaro media add-captions` gains `--max-words-per-line <n>`, and `nodaro audio
transcribe --provider` offers every engine the route accepts.

  `--max-words-per-line` caps the words on one caption line (or `tiktok-words`
  page) on top of the width budget, sentence ends and pauses that already close
  one. The bounds come from `@nodaro/shared`
  (`CAPTION_MAX_WORDS_PER_LINE_MIN`/`_MAX`, 1-20) rather than a pair of numbers
  repeated here, and the flag is validated before anything is read or sent: a
  value outside the range, or one that is not a whole number, is refused locally
  with a message quoting what was typed — `--max-words-per-line 2.5` says 2.5
  rather than silently running as 2. An omitted flag sends nothing, so the server
  default still decides. It works on the static `subtitle` style too, and a
  `--segments-file` entry naming its own cap overrides it for that range.

  `--provider` on `audio transcribe` reads the re-widened `TRANSCRIBE_PROVIDERS`,
  so all three lanes are offered. The `--word-timestamps` refusal is unchanged in
  shape and still asks the shared capability table rather than matching on a
  provider name — but now that `whisper` is an accepted provider again, it is the
  CAPABILITY that refuses it, and the message names both lanes that can answer
  (`elevenlabs-stt`, `incredibly-fast-whisper`). The flag's help text says the
  same: `whisper` returns no word timings whether it is named or reached by
  omitting the flag.

- a7774fc: Add the `edit` command group over the phase-1 editorial primitives:

  - `nodaro edit silence-detect <audioUrl>` — detect silence ranges (`--threshold-db`,
    `--min-silence-ms`, `--pad-ms`).
  - `nodaro edit apply-edl --edl <file>` — render an EDL into a video/audio cut
    (`--transcript`, repeatable `--source` overrides, `--output`, `--quality`,
    `--crossfade-ms`).
  - `nodaro edit plan --mode <m> --plan-tier <t> --transcript <file>` — plan a
    transcript-driven cut / clips / chapters (repeatable `--source url[@kind]` or a
    full `--sources-file`, plus `--silence`, `--instructions`, `--style-guide`,
    `--count`, `--target-duration-sec`, `--target-aspect`, `--platform`).

  Each is a thin wrapper over the SDK `client.edit.*` methods and honors the
  CLI's multi-profile auth, `--json` and `--watch` conventions.

- a610640: Add the two commands that make the transcribe → captions path runnable from a
  terminal:

  - `nodaro audio transcribe --audio <url>` — speech to text (`--provider`,
    `--language`, `--diarize`, `--tag-audio-events`, `--word-timestamps`). The
    flag shape follows the rest of the `audio` group, which takes its source as
    `--audio <url>`. `--word-timestamps` on a lane that cannot produce them is
    refused locally with the same verdict the route gives, and the message names
    only providers this command would itself accept.
  - `nodaro media add-captions <videoUrl>` — burn captions in (`--text`,
    `--captions-file`, `--style`, `--look`, `--position`, `--position-y`,
    `--font-size`, `--font-family`, `--font-weight`, `--color`,
    `--background-color`, `--stroke-color`, `--stroke-width`,
    `--highlight-color`, `--uppercase`, `--no-auto-transcribe`,
    `--transcribe-provider`, `--segments-file`). `--captions-file` takes a JSON
    array of word-timed entries — an `audio transcribe` job's `output_data.words`
    drops in verbatim — and `--segments-file` gives non-overlapping ranges their
    own treatment. Both file inputs are array-guarded with a friendly message
    naming the flag, like `edit plan --sources-file`.

  Each is a thin wrapper over the SDK (`client.audio.transcribe` /
  `client.media.addCaptions`) and honours the CLI's multi-profile auth, `--json`
  and `--watch` conventions. Every enum a flag validates against is read from
  `@nodaro/shared` (`ALL_CAPTION_STYLES`, `CAPTION_LOOK_IDS`,
  `SUPPORTED_FONT_NAMES`, `TRANSCRIBE_PROVIDERS`, `TRANSCRIBE_LANES`) rather than
  re-listed here, so a new style, look, face or lane needs no CLI edit. The two
  provider flags read DIFFERENT enums on purpose — `--provider` on transcribe the
  caller-facing `TRANSCRIBE_PROVIDERS`, add-captions' `--transcribe-provider` every
  `TRANSCRIBE_LANES` member — each matching what its own route's Zod accepts. The
  two sets hold the same three lanes today; they have diverged before, and reading
  them separately is what lets them diverge again with no CLI edit.

  The `@nodaro/shared` patch bump carries no source change: it exists only to lift
  the CLI's `@nodaro/shared` floor to a version that ships `TRANSCRIBE_LANES` and
  the capability helpers. The commands VALUE-import those symbols, so pairing this
  CLI with an older shared would make the validation read `undefined` at runtime —
  the bump rewrites the dependency range so a consumer can never resolve that
  stale sibling.

### Patch Changes

- b839ceb: README: the standalone-binary install commands reach a binary again. Every `releases/latest/download/…` link answered 404 — the repository's "latest" release is the app's, and the CLI binaries are attached to `cli-vX.Y.Z` releases. The commands now resolve the newest `cli-v*` tag when they run and download from it (with `curl -f`, so an HTTP error is an error and not a page saved as the binary), and Windows gets a PowerShell equivalent.
- Updated dependencies [e37fe27]
- Updated dependencies [81be5f2]
- Updated dependencies [a3e000a]
- Updated dependencies [a3e000a]
- Updated dependencies [65b4cdd]
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
- Updated dependencies [06d7acf]
- Updated dependencies [a436fab]
- Updated dependencies [8efa462]
- Updated dependencies [5c672cb]
- Updated dependencies [a610640]
- Updated dependencies [a610640]
- Updated dependencies [8e97188]
- Updated dependencies [ccb8a93]
- Updated dependencies [74e4373]
- Updated dependencies [d4b3145]
- Updated dependencies [1c8b7de]
  - @nodaro/shared@3.12.0
  - @nodaro/sdk@2.13.0
  - @nodaro/prompts@1.22.0

## 1.20.0

### Minor Changes

- 026f944: Voice cloning is retired platform-wide. `@nodaro/shared` drops the `voice-clone` catalog entry and `ModelMode` member (`VoiceClone` stays — the list route still returns it). `@nodaro/sdk` keeps `voices.createClone()` / `voices.createCloneFromFile()` for source compatibility but marks them `@deprecated`: the routes now answer `410 voice_cloning_retired`. `@nodaro/cli` removes `voice clones create`; `voice clones list` / `delete` and `voice list --clones` keep working for clones made before the retirement.

### Patch Changes

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
  - @nodaro/sdk@2.11.0

## 1.19.0

### Minor Changes

- ef73308: Add `nodaro media overlay` — place layers on a base image, pixel-exactly. Positional URLs are image layers sharing `--anchor` / `--x` / `--y` / `--width` / `--opacity` (the watermark case); `--layers-file` takes the full JSON array for the text, QR and shape kinds. Platform renders (`--platform`, repeatable), the QR link (`--qr-text`), the mask controls and an output `--canvas` are all wired.

  Add `nodaro media overlay-placement` — asks a vision model where one layer should go and prints the answer in those same percent units, with the `media overlay` command to apply it.

### Patch Changes

- Updated dependencies [ef73308]
- Updated dependencies [ef73308]
  - @nodaro/shared@3.7.0
  - @nodaro/sdk@2.7.0

## 1.18.2

### Patch Changes

- Updated dependencies [32493ee]
- Updated dependencies [32493ee]
  - @nodaro/sdk@2.0.0
  - @nodaro/shared@3.0.0
  - @nodaro/prompts@1.17.2

## 1.18.1

### Patch Changes

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

- Updated dependencies [2b5287e]
- Updated dependencies [a3ef2c8]
- Updated dependencies [1e0206c]
- Updated dependencies [1031ce4]
- Updated dependencies [2d082a0]
  - @nodaro/sdk@1.28.0
  - @nodaro/shared@2.21.1

## 1.18.0

### Minor Changes

- 158b2e6: Organizations: usage reports (rollout-gated). `client.organizations.usage(orgId, query)` and `client.workspaces.usage(workspaceId, query)` return credits by workspace, member, model or day for an inclusive date range (`from`/`to`, IANA `tz`), with in-flight vs settled credits split out and the platform-absorbed overrun listed separately; `usageRows` pages the underlying runs; `usageCsv` returns the same report as CSV. The CLI gains `nodaro org usage` and `nodaro workspace usage` (`--csv`). `@nodaro/shared` adds the `UsageReport`, `UsageReportRow`, `UsageVarianceRow`, `UsageLogEntry`, `UsageQuery` wire types, the `USAGE_GROUP_BYS` list and the `audit_unavailable` error code.

### Patch Changes

- Updated dependencies [1e9e962]
- Updated dependencies [5a67501]
- Updated dependencies [158b2e6]
- Updated dependencies [dfd4fed]
- Updated dependencies [c6be4ac]
- Updated dependencies [4c5dedb]
- Updated dependencies [703d5ae]
  - @nodaro/shared@2.20.0
  - @nodaro/prompts@1.15.0
  - @nodaro/sdk@1.26.0

## 1.17.0

### Minor Changes

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
- Updated dependencies [220ec75]
- Updated dependencies [d10d8b8]
  - @nodaro/shared@2.17.0
  - @nodaro/prompts@1.12.0
  - @nodaro/sdk@1.25.0

## 1.16.0

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
  - @nodaro/sdk@1.24.0

## 1.15.0

### Minor Changes

- 9963ec5: Prompt pre & post text: `promptPrefix` / `promptSuffix` node-data fields on every AI prompt node (`PromptAffixFields`, `applyPromptAffixes`, `nodeSupportsPromptAffixes`); `apps.run(slug, inputs, { inputOverrides })`; `nodaro apps run --override nodeId.field=value`.

### Patch Changes

- a305fd5: feat(transitions): expose the transition node's position / duration / intensity as catalog dimensions.

  The transition node has always had three timing parameters beside its 82-entry picker, and the platform has always owned their wording — `POSITION_CLAUSES` / `DURATION_CLAUSES` / `INTENSITY_CLAUSES` were composed into the hint at runtime. What was missing is that no consumer could _enumerate_ them, so an id-only client (Studio, the SDK, MCP) had no way to offer the controls without inventing prompt text of its own.

  - New exports `TRANSITION_POSITIONS`, `TRANSITION_DURATIONS`, `TRANSITION_INTENSITIES` — graded scales in the same shape as every other catalog (id, label, description, `promptHint`), each led by a no-op `auto` whose hint is empty.
  - The three clause tables AND the `TransitionPosition` / `TransitionDuration` / `TransitionIntensity` unions are now DERIVED from those arrays, so the clause the composer injects, the option list the API serves, and the type a consumer writes against all come from one place. The unions resolve to exactly the same members as before — no consumer change — but a step can no longer exist in one of the three and not the others.
  - The `transition` catalog carries them as `dimensions`, and `projectPickerCatalog` now keeps `dimensions` on a single-dim catalog instead of dropping them — additive, so a consumer reading only `options` is unaffected. The catalog-summary `optionCount` counts both, and the CLI's `catalog-snapshot` includes them so `diff-upstream` can see them change.
  - The editor's transition panel now renders these dropdowns from the catalogs instead of a hand-written copy that had already drifted (it showed `Short (~1s)` where the catalog said `Short`). The precision moved into the catalog labels, so the editor and an id-only client show the same text.

  No prompt text changed: every hint is byte-identical to the clause that was already being injected, which the parameter-hint golden fixture verifies.

- Updated dependencies [db47f72]
- Updated dependencies [68d0464]
- Updated dependencies [9963ec5]
- Updated dependencies [a305fd5]
- Updated dependencies [b08b3dc]
  - @nodaro/prompts@1.9.0
  - @nodaro/shared@2.13.0
  - @nodaro/sdk@1.23.0

## 1.14.0

### Minor Changes

- 0ac4f4c: Image collage storyboard badges can be placed in either top corner — default is now **top-left**.

  `@nodaro/sdk`: `media.imageCollage(input)` accepts `badgePosition?: "top-left" | "top-right"`. The number/label badges default to the image's top-left corner (the storyboard convention — the shot number leads the frame in reading order); `"top-right"` keeps them clear of a subject composed left-of-centre. Existing callers that relied on the previous top-right placement should pass `badgePosition: "top-right"` explicitly.

  `@nodaro/cli`: `nodaro media collage` gains `--badge-position <top-left|top-right>` (default `top-left`); any other value is a hard error.

### Patch Changes

- Updated dependencies [0ac4f4c]
  - @nodaro/sdk@1.22.0

## 1.13.0

### Minor Changes

- 06805b8: Image collage gains storyboard badges — optional per-image sequence numbers and captions.

  `@nodaro/sdk`: `media.imageCollage(input)` accepts two new optional fields. `numbered` (boolean) stamps a 1-based sequence badge at each image's top-right, in `imageUrls` order — storyboard mode. `imageLabels` (`Array<string | null>`, index-aligned with `imageUrls`; `null`/`""`/omitted = no caption for that image) captions images after the number, rendered as `3 · Close-up`. Both are optional and default off; badges are an overlay only and never change the layout, the output size, or the credit cost.

  `@nodaro/cli`: `nodaro media collage` gains `--numbered` (stamp the sequence badges) and a repeatable `--label <text>` flag, index-aligned with the image arguments in order (pass `""` to skip one image). More `--label` values than images, or any label over 80 characters, is a hard error.

### Patch Changes

- Updated dependencies [06805b8]
- Updated dependencies [ded5ac2]
- Updated dependencies [8802a1e]
  - @nodaro/sdk@1.21.0
  - @nodaro/shared@2.12.2

## 1.12.0

### Minor Changes

- ca8594e: Add `nodaro catalog` — offline vendored-pack maintenance (snapshot, diff-upstream three-way merge, sidecar validate).
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
- Updated dependencies [ca8594e]
- Updated dependencies [d7c78e5]
- Updated dependencies [5947e21]
- Updated dependencies [74d5f37]
- Updated dependencies [83c38a7]
- Updated dependencies [584d953]
- Updated dependencies [5569422]
- Updated dependencies [d0b73c6]
- Updated dependencies [1096ad2]
- Updated dependencies [1aacfca]
- Updated dependencies [646062e]
  - @nodaro/shared@2.11.0
  - @nodaro/prompts@1.8.0
  - @nodaro/sdk@1.20.0

## 1.11.0

### Minor Changes

- cdef4ed: `nodaro org` and `nodaro workspace`: organizations, members, invitations, join codes and the audit log from a terminal — and, the part that matters, a way to say which workspace a command acts in.

  Three ways to say it, each beating the one below: `--workspace <id>` for one command, `NODARO_WORKSPACE` for a shell or a CI job, and `nodaro workspace use <id>` saved on the profile. `nodaro workspace current` reports which of the three decided, because an inherited environment variable otherwise looks exactly like a saved selection.

  `nodaro org invite` prints one line per address and shows the invitation LINK for every address that could not be emailed — an install with no mail provider delivers nothing, and an invitation nobody can reach is worse than none.

### Patch Changes

- Updated dependencies [8c4110e]
- Updated dependencies [0134594]
- Updated dependencies [cdef4ed]
- Updated dependencies [62bb3dd]
- Updated dependencies [f14fa42]
  - @nodaro/shared@2.10.0
  - @nodaro/sdk@1.19.0

## 1.10.0

### Minor Changes

- b49a7ff: Slideshow: `client.media.slideshow({ imageUrls, audioUrl?, imageDurations?, ... })` and `nodaro media slideshow` — 2–100 images + one optional audio track → MP4 via `POST /v1/slideshow`, locally rendered (FFmpeg), zero credits. Audio-anchored timing (equal split / pinned rows with disclosed proportional scaling); silent output without audio. Shared adds `PICKER_TO_COMBINE_TRANSITION` + `resolveSlideshowTransition` (transition-picker → xfade vocabulary mapping).
- b49a7ff: Still to Video: `client.media.stillToVideo({ imageUrl, audioUrl, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? })` and `nodaro media still-to-video` — one still image + one audio track → MP4 via `POST /v1/still-to-video`, locally rendered (FFmpeg), zero credits. The output duration is the audio's duration (no duration field); optional motion presets (zoom / pan / ken-burns) with intensity 1–10.

### Patch Changes

- Updated dependencies [1606089]
- Updated dependencies [ff52285]
- Updated dependencies [d964b4d]
- Updated dependencies [d1ad395]
- Updated dependencies [c7fde04]
- Updated dependencies [4282945]
- Updated dependencies [8f8099c]
- Updated dependencies [776e7f5]
- Updated dependencies [b49a7ff]
- Updated dependencies [b49a7ff]
- Updated dependencies [6b8cfab]
- Updated dependencies [3488681]
- Updated dependencies [823b629]
- Updated dependencies [9df6f33]
  - @nodaro/prompts@1.7.3
  - @nodaro/shared@2.9.0
  - @nodaro/sdk@1.18.0

## 1.9.0

### Minor Changes

- 6fe2aae: Surface-parity catch-up — four new command groups/subcommands:

  - `nodaro models list` — browse the model catalog: capability sheets, per-variant credit tiers, featured ★ and the `doctrineCovered` ✓ flag, filterable by `--kind` / `--mode` / `--family` / `--featured`.
  - `nodaro shots` — Cine share → remix records: `get` / `create` / `update` (visibility toggle) / `delete`.
  - `nodaro recast` — the authored-script lane (`skill` / `validate` / `import --rights-attested`) plus headless run control (`estimate` / `create` / `start` / `status`). Cloud edition only.
  - `nodaro pickers analyze "<text>"` — AI Fill: choose picker values from a free-text description (credit-billed).

### Patch Changes

- f86c20f: **@nodaro/sdk**

  - `ModelSummary.pricing` is now optional — `GET /v1/models` (and the MCP `list_models` twin) omit per-variant credit pricing on editions without a credit system (community/business), the same principle `/v1/nodes` applies to `creditCost`. JSDoc on `NodeDescriptor.creditCost` and on `workflows.delete()` / `developerApps.delete()` now states the edition behavior and the `NotFoundError` thrown when the id doesn't exist or isn't yours.

  **@nodaro/cli**

  - `nodaro models list` renders `-` in the credits column for models served without pricing (creditless editions) instead of crashing on the missing field.

- Updated dependencies [8221886]
- Updated dependencies [f86c20f]
- Updated dependencies [3792fbb]
- Updated dependencies [d36034c]
- Updated dependencies [6fe2aae]
  - @nodaro/shared@2.6.0
  - @nodaro/sdk@1.17.0
  - @nodaro/prompts@1.7.1

## 1.8.1

### Patch Changes

- Updated dependencies [c6487c9]
- Updated dependencies [fec478a]
  - @nodaro/shared@2.0.0
  - @nodaro/sdk@1.13.1

## 1.8.0

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

- Updated dependencies [6cf8fc5]
- Updated dependencies [46e2def]
- Updated dependencies [320ea3c]
- Updated dependencies [320ea3c]
  - @nodaro/sdk@1.12.0
  - @nodaro/shared@1.24.0

## 1.7.0

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
  - @nodaro/sdk@1.11.0

## 1.6.0

### Minor Changes

- ee974ef: New `nodaro media collage <imageUrls...>` command — composite 2–30 images into one 2K/4K collage via `POST /v1/image-collage`, including `--sizes` per-image relative size hints (0 auto / 1 big / 2 medium / 3 small, aligned by position; smart layout only), plus `--layout`, `--resolution`, `--aspect-ratio`, `--gap`, and `--background-color`.

### Patch Changes

- 731eced: Docs: correct the production `--base-url` example from `https://api.nodaro.ai` (a domain that does not exist) to `https://app.nodaro.ai`. The wrong example has misled users into configuring MCP connectors and CLI profiles against an unresolvable host.
- Updated dependencies [1b9b784]
- Updated dependencies [72858e1]
- Updated dependencies [ee8061e]
  - @nodaro/sdk@1.9.0
  - @nodaro/prompts@1.5.0
  - @nodaro/shared@1.16.0

## 1.5.0

### Minor Changes

- 7370b4d: Generate Video Pro run control — `client.videoPro.stop(jobId)` (graceful stop: keep + deliver the completed segments as the final video, refund the untouched remainder; the in-flight segment is billed) and `client.videoPro.continueRun(jobId, { fromSegment? })` (a NEW job that reuses the delivered segments and regenerates from `fromSegment` on, billed only for the regenerated part; works on stopped, failed, and completed runs). CLI: `nodaro video-pro stop <jobId>` and `nodaro video-pro continue <jobId> [--from-segment N] [--watch]`.

### Patch Changes

- Updated dependencies [7370b4d]
- Updated dependencies [606997d]
- Updated dependencies [2f32c1b]
- Updated dependencies [89bee09]
- Updated dependencies [0dedf9b]
- Updated dependencies [774a2d1]
  - @nodaro/sdk@1.8.0
  - @nodaro/shared@1.14.0
  - @nodaro/prompts@1.4.0

## 1.4.0

### Minor Changes

- 8c019ad: Full voice/media/audio command surface. `nodaro voice` gains the interactive Voice Changer Pro flow — `analyze` (detect speakers, prints the list), `recast --output video|stems` + `--analysis-json/--analysis-file` (reuse an analyze result, skip re-detection), and `export` (render a mixed track set, `--tracks-json/--tracks-file`) — plus `design`, `remix`, `dub`, `list [--clones]`, and `clones list|create|delete` (create from an uploaded URL or a local file); `voice changer` gains `--model`, `--use-speaker-boost`, `--seed`. New `nodaro media` group: `download` (social-video import with live `--watch` progress), `metadata`, `trim-video`, `trim-audio`, `save`. New `nodaro audio` group: `separate`, `isolate`, `fx`, `mix`, `adjust-volume`, `combine`.

### Patch Changes

- Updated dependencies [8c019ad]
  - @nodaro/sdk@1.6.0

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
  - @nodaro/sdk@1.3.0

## 1.2.0

### Minor Changes

- d53614b: Add `nodaro voice recast` (alias `voice pro`) — multi-speaker Voice Changer Pro from the CLI. `--voices` maps speakers in detection order (`--voices Rachel,keep,Aria`); the literal `keep` is a keep-slot — that speaker's original voice is kept (sent as a `null` entry, SDK ≥ 1.2.0). `--voices-json` accepts the raw SDK array (per-voice settings objects and `null` keep-slots), plus flags for model, background preservation, separation quality, music volume, noise removal, voice FX, and `--watch` polling.

### Patch Changes

- Updated dependencies [39bdbd7]
- Updated dependencies [da6af59]
  - @nodaro/shared@1.8.0

## 1.1.2

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.
- Updated dependencies [8661d4a]
  - @nodaro/shared@1.4.1
  - @nodaro/prompts@1.0.1
  - @nodaro/sdk@1.1.1

## 1.1.1

### Patch Changes

- 37f1805: No functional changes. Republish so the npm provenance attestations reference the repository's current (post-history-rewrite) source commits — earlier versions' attested commit links point at rewritten-away SHAs.
- Updated dependencies [37f1805]
  - @nodaro/shared@1.2.1
  - @nodaro/sdk@1.0.3

## 1.1.0

### Minor Changes

- b9c84a0: `--param` / `--input` now accept JSON values: a value starting with `[`, `{`, or `"` is parsed as JSON (e.g. `--param 'targetPickers=["person"]'` sends a real array; `--param 'seed="123"'` forces a string). Bracket-leading values that are not valid JSON still pass through as plain strings, so prompts like `[cinematic] a leopard` are unaffected. Previously array/object parameters required `--params-file`.

### Patch Changes

- Updated dependencies [6bcdb96]
- Updated dependencies [6bcdb96]
- Updated dependencies [ccc07e7]
  - @nodaro/shared@1.2.0
  - @nodaro/sdk@1.0.2

## 1.0.0

### Major Changes

- a33d6ab: Remove the `popularIds` field from `presets.listFactory()` / `GET /v1/node-presets/factory`. The static "Popular" preset band has been removed in favor of a user-driven Favorites feature; `popularIds` is no longer returned.

### Minor Changes

- 5ab57c6: Add `nodaro projects create`, `nodaro projects update`, and `nodaro projects delete` subcommands. Projects now have full CRUD from the CLI, matching the `@nodaro/sdk` `projects` resource.
- c42a82f: Centralize community listing types in `@nodaro/shared` (single source of truth, re-exported by `@nodaro/sdk`), and add a `community` command group to `@nodaro/cli` (`browse`, `get`, `favorites`, `clone`, `favorite`, `report`) mirroring the SDK resource. Publishing remains admin/editor-only and is intentionally not exposed.
- 5585889: Admins can now share/unshare community listings via the SDK + CLI. `@nodaro/sdk`: `community.publish()`, `community.unpublish()`, `community.sharedListing()`. `@nodaro/cli`: `community publish/unpublish/shared-status`. (All require an admin token; publishing requires owning the source entity and, for characters, a likeness attestation.)
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

### Patch Changes

- e0aec7e: Correct the license statement in the `@nodaro/shared` and `@nodaro/sdk` READMEs (the packages are Apache-2.0, not the repository-root Sustainable Use License) and add `repository`/`homepage`/`bugs` metadata to all three published package.json files so npm links back to the source monorepo.
- Updated dependencies [ca65d28]
- Updated dependencies [c42a82f]
- Updated dependencies [5585889]
- Updated dependencies [3e14899]
- Updated dependencies [5c184c3]
- Updated dependencies [4909967]
- Updated dependencies [4260c1e]
- Updated dependencies [0f8bb8b]
- Updated dependencies [64d6d81]
- Updated dependencies [ddeb67a]
- Updated dependencies [bcf5e08]
- Updated dependencies [e6a514f]
- Updated dependencies [216f3bb]
- Updated dependencies [9798fad]
- Updated dependencies [acd2564]
- Updated dependencies [7a38259]
- Updated dependencies [b3f214b]
- Updated dependencies [fbcd7c8]
- Updated dependencies [5380a50]
- Updated dependencies [55e3782]
- Updated dependencies [bed0093]
- Updated dependencies [a33d6ab]
- Updated dependencies [e0aec7e]
- Updated dependencies [93adc04]
- Updated dependencies [7f38813]
  - @nodaro/sdk@1.0.0
  - @nodaro/shared@1.1.0
