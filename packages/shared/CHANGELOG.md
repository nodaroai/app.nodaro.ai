# @nodaro/shared

## 3.12.1

### Patch Changes

- e9fe83a: Correct the Hebrew picker-catalog translations: fix mistranslated labels and descriptions (for example tiger, leopard and cheetah, hips versus waist, assault rifle, compound bow, mirrorless camera), translate ordinary words that were left in English, and bring the Character Motion catalog to one grammatical form. Catalog ids and English copy are unchanged.

## 3.12.0

### Minor Changes

- e37fe27: `apply-edl` joins the producer/output classifiers: it is added to `DYNAMIC_PRODUCER_TYPES` (a node whose media output type is decided at runtime) and to the `VIDEO_OUTPUT_TYPES` set so `getOutputType` classifies its default handle as video (not the DYNAMIC→"data" fallback). Additive — existing members are unchanged; consumers that iterate these sets now see `apply-edl`.
- 81be5f2: Captions: named "look" presets + a typed SDK `media.addCaptions()`.

  `@nodaro/shared` gains `CAPTION_LOOK_IDS`, `CAPTION_LOOKS`, `DEFAULT_CAPTION_LOOK`, `KINETIC_ONLY_CAPTION_LEVER_KEYS`, `autoStrokeWidth`, `resolveCaptionLook`, and the types `CaptionLookId`, `CaptionLookLevers`, `KineticOnlyCaptionLeverKey`. A look is a bundle of visual levers (font, weight, colour, outline, spoken-word colour, casing) so a kinetic caption reads well from one field: `outline` (Montserrat 900, uppercase, white on a black outline sized `max(2, round(fontSize·0.1))`px, yellow spoken word — the TikTok/CapCut read) and `clean` (Inter, soft shadow, no casing/outline). `resolveCaptionLook(look, explicit, fontSize)` merges an explicit lever over the look; an UNSET look resolves to `outline`. Structural/config vocabulary only — no creative doctrine.

  `@nodaro/sdk`: new `client.media.addCaptions(input)` — burns captions into a video via `POST /v1/add-captions`, with the `look` preset, the explicit look levers, and per-segment captions. New exported types `AddCaptionsInput`, `CaptionLookInput`, `CaptionSegmentInput`, `CaptionEntry`.

- a3e000a: Captions: add `captionRoutesToRemotion()` and `resolveCaptionLevers()` (bare-subtitle-stays-plain rule, single-sourced across the render/segment/panel sites); narrow `KINETIC_ONLY_CAPTION_LEVER_KEYS` to `[highlightColor, animate]` so `subtitle` accepts the styling levers.

  A `null` lever is unset: `captionRoutesToRemotion()` treats a `null` styling
  lever exactly like an omitted one (stored node JSON carries nulls, and a null
  must not buy the Remotion renderer or its price), and
  `normalizeCaptionNumericLevers()` drops a null numeric lever instead of carrying
  it into the render plan.

- 65b4cdd: Captions: a words-per-line cap, and the pre-run checks for a transcript that
  carries no word timings.

  `CAPTION_MAX_WORDS_PER_LINE_MIN` / `CAPTION_MAX_WORDS_PER_LINE_MAX` (1-20) are
  the single source for the new `maxWordsPerLine` lever's bounds — the route Zod,
  the render plan, the MCP schema, the CLI and the canvas panel all read them
  here rather than repeating a pair of numbers. The lever caps how many words one
  caption LINE (or `tiktok-words` page) may hold, on TOP of the frame-width
  budget, sentence ends and pauses that already close a line; 1-2 gives the short,
  punchy read. It applies to `word-highlight`, `karaoke`, `bouncy`, `tiktok-words`
  and to a Remotion-rendered `subtitle`, and is inert on `word-pop`, which is
  always one word. It is a STYLING lever, not a kinetic-only one, so
  `captionRoutesToRemotion()` now counts it alongside `look` / `fontFamily` /
  `fontWeight` / `strokeColor` / `strokeWidth` / `uppercase` / `positionY`: a
  `subtitle` carrying it renders through Remotion, which is the only path that can
  group lines at all.

  `TRANSCRIBE_PROVIDERS` is `["elevenlabs-stt", "whisper",
"incredibly-fast-whisper"]` again — all three lanes are served, and the canvas
  picker had re-offered the two Replicate ones while this enum still hid them, so
  a single-node Run on Whisper 400'd where the same node in a workflow Run worked.
  Capabilities are unchanged and still answered by
  `TRANSCRIBE_PROVIDER_CAPABILITIES`: `whisper` returns NO per-word timings,
  `incredibly-fast-whisper` and `elevenlabs-stt` do. A wider enum is not a wider
  capability, and nothing should match on a provider name to decide.

  Two new helpers make the word-timing gap visible BEFORE a run instead of after a
  paid transcription:

  - `transcribeWordTimestampsRefusal(provider)` — the one refusal message for a
    lane that cannot return word timings, `null` for a lane that can. An absent
    provider resolves to the transcribe node's default (`elevenlabs-stt`), so the
    helper answers for node data as honestly as for a wire body.
  - `findWordlessTranscriptFeeds(nodes, edges)` — a GRAPH check: it finds every
    transcribe node sitting on a word-incapable lane whose `json` output reaches an
    add-captions `transcript` input, directly or through an apply-edl hop. Each hit
    names `{ transcribeNodeId, consumerNodeId, provider, message }`, so a canvas,
    an import or an agent-authored workflow can say which two nodes disagree
    before the run starts.

  Structural vocabulary only — no creative content, no behaviour change inside the
  package.

- 2263cf6: New `EDIT_PLAN_DEFAULT_CLIP_COUNT` (8), `EDIT_PLAN_MAX_CLIP_COUNT` (50) and `clampEditPlanClipCount(count)`: one source for how many clips an Edit Plan `clips` run returns by default and the most it may be asked for. `clampEditPlanClipCount` floors and clamps a positive number into `[1, 50]` and returns `undefined` for anything else, so a caller can pass a raw setting straight through. Additive — no existing export changes.
- a48b462: `edit-plan` (podcast editing) support in the shared contract. All additive —
  existing members are unchanged.

  `edl.ts` gains:

  - `unwrapEditPlanOutput(outputData)` — normalizes an edit-plan job's `output_data`
    into the value stored on the node's `data.generatedJson` (clips → bare `Edl[]`,
    chapters → `{version, chapters}`, tighten → the `Edl`).
  - `ChapterSet` type (the `chapters` mode output shape).
  - The credit-id STRUCTURE (values live app-side): `EDIT_PLAN_MODES`,
    `EDIT_PLAN_TIERS`, `EDIT_PLAN_BUCKET_MINUTES`, `EDIT_PLAN_MAX_MINUTES`,
    `EDIT_PLAN_BASE_CREDIT_ID`, `editPlanBucketMinutes`, `buildEditPlanCreditId`,
    `asEditPlanMode`, `asEditPlanTier`, and the `EditPlanMode` / `EditPlanTier`
    types — the same structural credit-id vocabulary as `buildVideoAnalysisCreditId`
    (no pricing values; those stay in the app + migration).

  `producer-types.ts`: `edit-plan` joins `FAN_OUT_EACH_TYPES` so a `clips` edge
  fans out one downstream execution per clip.

- dcaaa20: `edl.ts` gains `transcriptDurationSec(transcript)` — the latest `endMs` across a
  transcript's words AND segments, in seconds (the max over both, mirroring the
  plugin's own `transcriptDurationMs`). Additive; returns `undefined` for any
  shape it can't measure. It is the edit-plan reserve's duration fallback beneath
  the master-source ffprobe: a URL/reference-audio master exposes no length on its
  node data, so an orchestrated reserve that cannot probe the media buckets the
  credit hold on this transcript clock instead of the 180-minute ceiling.
- 2b32c90: Add the EDL (edit decision list) contract — the shared data shape the podcast-editing primitives compose on. New exports from `@nodaro/shared`: `Edl`, `EdlSource`, `EdlSegment`, `EdlLayout`, `EdlRegion`, `EdlClipSet`, `EdlDropped`, `Transcript`, `EDL_VERSION`, and the pure functions `edlDurationMs`, `validateEdl`, `validateEdlClipSet`, `remapMsThroughEdl`, `remapTranscriptThroughEdl`, `speakerTurns`, `normalizeEdl`, `normalizeTranscript`. Structural vocabulary only — no creative content. Times are integer milliseconds; a crossfade overlaps (compresses the timeline); the contract carries a clock, per-source offsets and a per-slot weight so the multicam and speaker-view work can extend it additively.
- f86ad38: EDL phase-2 structural contract (multicam + speaker view). New exports: the source-role registry `EDL_SOURCE_ROLES` / `EdlSourceRole` (`EdlSource.role` is now open — `EdlSourceRole | (string & {})` — so an EDL from a newer producer still type-checks); the speaker-view registries `EDL_TARGET_ASPECTS` / `EdlTargetAspect` (`Edl.meta.targetAspect` is now open the same way as `role` — `EdlTargetAspect | (string & {})`, an unknown aspect is a warning; `isEdlTargetAspect` narrows it), `SPEAKER_LAYOUTS` / `SpeakerLayoutSheet` / `SPEAKER_LAYOUT_IDS` / `getSpeakerLayout` / `speakerLayoutAllows` (slot-count range and the output aspects each layout is drawn for), `SPEAKER_SWITCHES` / `SpeakerSwitchSheet` / `SPEAKER_SWITCH_IDS` / `getSpeakerSwitch` / `speakerSwitchOverlaps` (`cut`, `pan`, `zoom`, plus an `xfade:<id>` switch derived from every combine-videos xfade transition; only the `xfade:*` family consumes output time), and `SPEAKER_EMPHASIS_STYLES` / `SpeakerEmphasisStyle` / `parseSpeakerEmphasisStyle` / `isKnownSpeakerEmphasisStyle` (atomic styles, joined with `+`); `speakerPresentationWarnings`; `mergeEdlSourceOffsets` (folds audio-sync offsets into an EDL as an anchored, idempotent SET on the master clock, reporting what it applied and ignored); and the D20 region resolver `resolveEdlSegmentSlots` with `EdlResolvedSlot`, `ResolveEdlSlotsOptions` and `EDL_FULL_FRAME`. `EdlValidation` gains a required `warnings` list: `validateEdl` / `validateEdlClipSet` now report registry judgements (an unknown role, layout, switch, emphasis style or target aspect, a slot count outside a layout's range, a layout not drawn for the target aspect, a `pan` between two different picture sources) as warnings that never flip `ok`, so an older validator never rejects a newer EDL. The edit-plan credit-id helpers and `unwrapEditPlanOutput` moved to their own module; they are still exported from the package root unchanged.
- a49c7c6: Fan-out pairs by row. New `fan-out-rows` helpers, all additive — existing
  members are unchanged — shared by the backend orchestrator and the in-browser
  executor so the two cannot disagree on how a list fan-out is planned:

  - `resolveListFanOut(candidates, nodeType)` — turns the list wires that reach a
    node into one fan-out (`ListFanOut`: the driving items, the row each came from,
    and the handle the driving list is wired to). The list holding the most values
    sets the rows; among lists with the same number of rows, the one that feeds the
    prompt drives, and a row runs when any of them has a value in it. Nothing
    depends on the order the wires were created in.
  - `planFanOut(fanOut, nodeType, nodeData)` — expands a fan-out into its
    iterations (wraps `expandItemsWithRepeat`) and pins every iteration to the row
    it reads, so Repeat xN keeps each copy on its own row (`FanOutPlan`).
  - `fanOutTextFeedsPrompt(nodeType, targetHandle)` / `NON_PROMPT_TEXT_LANES` —
    whether a text list wired to that handle of that node type is the node's
    prompt, or is routed to another text input (`negative`, `system-prompt`, …).
  - `liveRowColumn(rows, colIndex)`, `compactWithRows(aligned)` — row-aligned
    column extraction: an empty cell stays in its row.
  - `alignedFieldList(value, path)` — one entry per element of a root JSON array
    ("" where the element has no value), used by Extract Field's list output.
  - `isFanOutUrlItem(item)` — the single "is this list item a media URL" guess.
  - `EXECUTION_DATA_KEYS` gains `__alignedListResults` (the row-aligned twin of a
    node's list output — runtime state, never configuration).

- 6ad3d61: Instagram scraper node: shared vocabulary (`instagram-scrape.ts` — modes, tiered credit ids reusing the analysis multiples, featured text/image/video outputs, target splitter, `instagramScrapeCreditIdFromNode`), the shared scraper handle-typing branch now covers `instagram-scrape`, and `@nodaro/prompts` adds `POST_CONTENT_ANALYSIS_SYSTEM_PROMPT` (the organic-content twin of the ad-analyst prompt, same output shape) so scraper nodes can run a content-analyst pass.
- 1a89eff: LLM registry: add `reasoningOutputFloor` — the per-model output cap a reasoning call is floored to — with `REASONING_OUTPUT_FLOOR` (the default) and `reasoningOutputFloor(model)`. The Gemini 3 models now declare `thinkingDefaultOn`, floored at the cap every lane serving them accepts: 8192 for Gemini 3 Flash / 3.6 Flash / 3.7 Flash, 16384 for Gemini 3.8 Flash and Gemini 3.1 Pro.
- 368e95a: Meta Ads: node-side advertiser mode vocabulary — `META_ADS_NODE_MODES` / `metaAdsNodeMode`, the `MetaAdsAdvertiser` pick shape with `metaAdsAdvertisersFrom` / `isFacebookPageUrl`, and the two single-source helpers every engine and quote read: `metaAdsScrapeSources` (billable source count) and `metaAdsScrapeWireSources` (node data → the search / pages wire request).
- c79489e: Meta Ads: optional per-ad AI analysis vocabulary — the analysis tier helpers (`metaAdsAnalysisTier`, `metaAdsAnalysisTierFrom`, `metaAdsAnalysisCreditId`), the `AdCreativeAnalysis` shape with a defensive `adCreativeAnalysisFrom` reader, the `meta-ads-analysis` LLM feature, and one node→identifier helper `metaAdsScrapeCreditIdFromNode` so the card badge, run total, pre-run estimator and backend quote all price count × sources × analysis through the same builder. `buildMetaAdsScrapeCreditId` gains an `analysis` tier input; `META_ADS_SCRAPE_CREDIT_COSTS` now carries the analysis SKUs.
- a976e32: Meta Ads: advertiser mode can be driven by the `in` input — `metaAdsScrapeWireSources` emits `advertiserNames` (resolved to Page urls server-side) when advertiser mode has no picks but upstream text, `splitMetaAdsAdvertiserNames` parses one-name-per-line/comma input, and `resolveMetaAdsScrapeCreditId` counts those names as billable sources.
- 1126801: Meta Ads: creative-format vocabulary (`META_ADS_FORMATS`, `classifyCreativeFormat`), featured-ad output helpers (`featuredMetaAdOutputs`, `clampMetaAdsFeaturedIndex`), and the node's typed `text` / `image` / `video` output handles resolve as the canonical single-media producers in `resolveEffectiveSourceType`.
- 7f5159d: Add the Meta Ads scraper node vocabulary: `META_ADS_SCRAPE_*` constants (modes, periods, statuses, count/source ceilings, credit tiers), `splitMetaAdsPageUrls`, and the credit identifier builders `buildMetaAdsScrapeCreditId` / `resolveMetaAdsScrapeCreditId` shared by the backend guard, the reservation and the editor's credit badge.
- 9e25b67: New `PROJECTED_TRIGGER_NODE_TYPES` (with `SCHEDULE_TRIGGER_NODE_TYPE`, `WEBHOOK_TRIGGER_NODE_TYPE` and `isProjectedTriggerNodeType`): the node types a Nodaro server projects onto real trigger rows when a workflow is saved. Additive.
- 5b9f5ed: New `schedule-rules` module: the Schedule Trigger's rule model (`ScheduleRule` — every N minutes / hours / days / weeks / months, or a cron expression — with `ScheduleSpec` carrying the rules, an IANA timezone and a max-execution count), plus the functions both the editor and a Nodaro server evaluate it with: `normalizeScheduleRules`, `legacyScheduleToRules`, `scheduleMatchesAt`, `scheduleOccurrences` / `nextScheduleRuns` (preview), `isValidTimezone`, `localTimeIn`. Additive: `workflow_triggers.config.rules` is the trigger config wire contract, and the editor's preview must agree with the server's clock.
- 5c672cb: `telegram-trigger` is a projected trigger node type.

  `TELEGRAM_TRIGGER_NODE_TYPE` joins `SCHEDULE_TRIGGER_NODE_TYPE` and
  `WEBHOOK_TRIGGER_NODE_TYPE` in `PROJECTED_TRIGGER_NODE_TYPES`, so
  `isProjectedTriggerNodeType("telegram-trigger")` is now `true`. The set is the
  one vocabulary both sides read: the server projects these node types onto
  `workflow_triggers` rows when a workflow is saved, and the editor asks for that
  projection after its own saves. A Telegram Trigger placed in the editor used to
  be decorative — its Activate button wrote `isActive` onto node data and nothing
  registered the bot with Telegram — and adding the type here is what makes a
  saved graph the thing that arms it.

  The comment claiming `telegram-trigger` "registers its own row through the
  Telegram webhook" is gone; it was never true.

  Structural vocabulary only — no creative content, no behaviour change inside
  the package beyond the set's third member.

- 8e97188: Transcribe: a capability table for word timestamps.

  `@nodaro/shared` gains `TRANSCRIBE_LANES`, `TranscribeLane`, `TRANSCRIBE_PROVIDER_CAPABILITIES`, `transcribeProvidersWithWordTimestamps()`, `transcribeLaneSupportsWordTimestamps()`, `DEFAULT_TRANSCRIBE_PROVIDER`, and `DEFAULT_TRANSCRIBE_NODE_PROVIDER`. `TRANSCRIBE_LANES` is the superset of `TRANSCRIBE_PROVIDERS` covering every transcription lane the platform implements (including the two Replicate lanes hidden from the user-facing enum but still reachable through the route default and add-captions' internal auto-transcribe). The capability table records which lanes return per-word timings: `openai/whisper` does not (it has no `word_timestamps` input in any published version, so the key is silently dropped), while `incredibly-fast-whisper` and `elevenlabs-stt` do. Callers ask the table instead of matching on a provider name — `transcribeLaneSupportsWordTimestamps(lane)` answers it for an UNTRUSTED lane id (node data, an imported workflow, a wire body), returning `false` for anything it has never heard of rather than throwing.

  `DEFAULT_TRANSCRIBE_NODE_PROVIDER` is the lane a transcribe NODE with no `provider` resolves to (`elevenlabs-stt`), deliberately distinct from `DEFAULT_TRANSCRIBE_PROVIDER`, which is the `/v1/transcribe` route's legacy fallback for an absent `provider` (`whisper`) and is kept only so a pre-existing REST caller keeps billing the same id.

  Structural vocabulary only — no creative content, no pricing, no behaviour change inside the package.

- ccb8a93: New `buildFeedMaps` / `nodeFeedsAnything`: the one definition of "node A feeds node B" (a live edge, Group membership, a field mapping) that a Nodaro server's triggered-run scope and the editor's "is this trigger wired?" both read from. Additive.
- 74e4373: Seedance video EDIT contract for the Video to Video node. Seedance has no video-to-video endpoint — it edits a video handed to it as a _reference_ when the prompt reads as an edit instruction — so every surface dispatches that lane as a text-to-video request in edit shape, with the source clip as reference video 1.

  `@nodaro/shared` adds:

  - `SEEDANCE_VIDEO_EDIT_PROVIDERS` + `isSeedanceVideoEditProvider(provider)` — the models that behave this way (`seedance-2-5` today), and the type `SeedanceVideoEditProvider`.
  - `VIDEO_TO_VIDEO_NODE_PROVIDERS` + `VideoToVideoNodeProvider` — every model the Video to Video NODE offers, i.e. `VIDEO_TO_VIDEO_PROVIDERS` plus the edit providers. `VIDEO_TO_VIDEO_PROVIDERS` (the `/v1/video-to-video` route enum) is deliberately UNCHANGED: that endpoint cannot serve these models, so a client must keep validating route requests against it.
  - `SEEDANCE_VIDEO_EDIT_SHAPE` — the `{ aspectRatio: "adaptive", duration: -1 }` pair the edit request sends up front, so the output keeps the source clip's own ratio and length.
  - `seedanceVideoEditCreditId(provider, resolution?)` — the credit identifier that lane reserves under (the reference-video ladder at the model's longest clip, settled down to the delivered length). One builder, so a quote can never disagree with the reservation.

  `@nodaro/prompts` adds:

  - `SEEDANCE_VIDEO_EDIT_PREFIX` — the `edit {video:1} as follows:\n` instruction, written with the editor reference token so it resolves through the normal reference resolver.
  - `buildSeedanceVideoEditPrompt(prompt)` — frames a prompt as an edit of the source clip. Idempotent: a prompt that already opens with the instruction (either token spelling) is returned unchanged.

  All additive — no existing export changes shape or behaviour.

- d4b3145: Auto video duration. `VIDEO_DURATION_AUTO` (`-1`), `isAutoVideoDuration`, `supportsAutoVideoDuration` and `maxVideoDurationSec` are new exports, and `MODEL_CATALOG` entries gain an optional `autoDuration` capability (declared on the Seedance 2 family) — the model picks the clip length. `pricedOutputDurationSec` prices Auto at the model's longest clip, so `buildVideoCreditModelIdentifier(provider, -1, …)` returns the top duration tier instead of the cheapest one; `normalizeModelInput` / `validateModelInput` accept `-1` for a model that declares the capability. Additive — every existing duration behaves as before.
- 1c8b7de: Video URL node + social-video import: `@nodaro/shared` gains `video-link.ts` — the social-video host allowlist (`SOCIAL_VIDEO_HOSTS`, `YOUTUBE_HOSTS`, `INSTAGRAM_HOSTS`, `hostnameMatchesAllowlist`, `isSocialVideoUrl`, `detectVideoLinkPlatform`; exact-host matching, one list for the server's download gate and the editor), `hasUrlParserHazard` (a link carrying a backslash or a control character is one that URL parsers read differently, and is refused as a video link), the node's output rule (`resolveVideoLinkOutput`, `videoLinkDownloadedFile`, `videoLinkNeedsDownload` — a downloaded file is emitted only when it belongs to the node's current link) and `VIDEO_LINK_TOLERANT_CONSUMER_TYPES` (the node types that read a Video URL node without its file). `downloadPercent` / `downloadPhase` join `TRANSIENT_RUNTIME_KEYS`, so a download's progress ticks no longer dirty or reach a saved workflow. `@nodaro/sdk`: `media.downloadVideo()` accepts `requireAudio?: boolean` — a result with no audio stream fails by default; `false` accepts a clip that really has no sound. The route also answers `429 too_many_downloads` past 4 running downloads per account.

### Patch Changes

- f75ebfe: Captions: an unset `look` on the static `subtitle` style now resolves the `clean` preset (`DEFAULT_SUBTITLE_LOOK`) — a pinned sans — instead of no face at all, which rendered as the browser-default serif once a subtitle routed to Remotion.
- 00ac720: `EXECUTION_DATA_KEYS` gains `resultsClearedAt` — the time the editor's "Clear results" last emptied a node. It is runtime bookkeeping (kept out of presets, template exports and the copilot's view of a node like every other key in the set) and is NOT transient: it persists so the next load knows the node is empty on purpose and does not repaint the previous run onto it.
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

- 6a69e7d: New `mergeNodeInputOverrides(nodeType, data, overrides)`: the shallow merge of run-time input overrides over a node's saved data that every override lane should use. When the override swaps the node's primary media (its `INPUT_FIELD_MAP` field is a media url and the value changes) the saved `metadata` — facts measured from the old media, such as its length — is dropped unless the override supplies its own, so it can never describe a file that is no longer there. Additive; no existing export changes.

  `editPlanSourceDurationSec` now honours an optional `metadata.mediaUrl` stamp: a `metadata.durationSeconds` stamped with the media it was measured from is returned only while that url is still the node's media (`extractedAudioUrl` or `url`); on a mismatch it returns `undefined`. Unstamped lengths behave exactly as before.

- ccb8a93: `stripExportContent` drops a Schedule Trigger's `active` switch from a template export: an imported schedule always starts paused, whatever the exporter's was doing. The rules, timezone and max-execution count still travel.
- a436fab: `EXECUTION_DATA_KEYS` now lists the Webhook Output delivery receipt (`webhookSuccess`, `webhookStatusCode`, `webhookResponseBody`), so a reflected response body is stripped from template exports, skipped by undo, and never captured into a node preset. New `stripUnownedRefs(nodes)`: clears the references an importer cannot own — a Webhook Output's `credentialId` and a social publisher's `connectionId` — and is applied by `stripExportContent` and by asset-bundle exports alike.
- 8efa462: Serve `gpt-5.6-sol` over KIE's collapsed streaming wire (`kieCollapseStream`). KIE's non-streaming responses endpoint returned `500 server_error` for it on 2026-09-17, retiring the 2026-07-14 reading that the GPT-5.6 family is reliable non-stream; this is the same lane failure and the same remedy `gpt-6-astra` already carries.
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

## 3.11.0

### Minor Changes

- e5a3719: Correct character motion catalog copy, add everyday and accessible movements, bind animal and object recipients, preserve literal reference names, and expose authored sequence diagnostics and discovery metadata. Existing motion IDs remain resolvable.
- d552b19: Transition and Character FX now read the nodes wired into them when their text is injected into a prompt, on every path — not just in the editor preview.

  Wire a Setting, Tone or Lighting picker into a Transition node's **Start state** / **End state** and the generated prompt now says what the shot starts from and ends at ("…, starting from warm golden morning light, ending at deep blue moonlit night"). Wire a Character, Face, Object or Location into a Character FX node's **Target** and the effect is written about that subject by name ("Aria Voss transforms into a werewolf…") instead of "the subject".

  This is the text the node's own injection preview and canvas card already showed. Until now the two executors dropped it, so a run disagreed with the preview; both now compose it, whether the picker feeds a consumer's cinematography handle directly or is placed by `{Label}`.

  **Existing workflows that wire those handles will produce different prompts** — that is the point of the change, and the new text is what the preview promised. A Transition or Character FX node with nothing wired into its own handles is byte-identical to before.

  `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES` (exported from `@nodaro/shared`) gains `transition` and `character-fx`.

- 56249e3: `entitySlotSchema` gains an optional `owner: { slotId, relation }` — whose an object slot is (worn by, held by, driven by a cast person or creature), so a shirt described on the man and wired as its own slot is one shirt, not two.
- 14ef0be: Add the measured video output-canvas table and the start/end frame fit math: `VIDEO_OUTPUT_CANVAS` / `resolveOutputCanvas` (real pixel sizes per model, resolution and ratio, harvested from production renders), plus `computeFrameFitPlan`, `resolveFrameFitAspect` and `resolveFrameDelivery` with the `FrameFit` / `FrameDelivery` vocabularies.

## 3.10.0

### Minor Changes

- 3086f29: New **Character Motion** parameter picker (`character-motion`): what the subject does across a clip — entrances, turns, head and hand gestures, walks, runway, dance, expressions, camera interaction, stylized combat, athletics, falls, posture shifts, everyday actions, vehicles and animals, two-person moves, idle life, stage performance and uncanny movement. Up to three picks compose an ordered sequence joined with "then"; a wired `target` names the subject and a wired `partner` names the second person ("another person" when unwired); `position` and `pace` add timing. `@nodaro/prompts` exports the catalog, its timing scales and `composeCharacterMotionHintFromConnections`; `@nodaro/shared` adds the node type, its app-input field, its i18n catalog id, `VIDEO_ONLY_PARAMETER_NODE_TYPES` and `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`.
- 247326a: `groupByKindAndFamily` — the Image / Video / Audio envelope `GET /v1/models` and MCP `list_models` render, filing every model under its own kind before grouping by vendor family. An unfiltered call used to file every VEO, Seedance, Wan and ByteDance video model under the image section (the family's first model decided the whole vendor). `MODEL_KINDS` is exported alongside it, and the lone `ByteDance` family spelling is now `Bytedance` like the other 15 entries.
- 456aad9: `pricedOutputDurationSec(provider, requested)` — the output seconds a video request is priced at when the caller omits `duration`: the provider's own default render length from `PRICING_DEFAULT_DURATION_SEC`, else 5. `seedance-2-5` and `grok-imagine-video-1.5` join that map at 8 s (their KIE default), so an omitted duration is priced under their `:8s:` tier instead of the 5 s one, and a Seedance reference-video reservation counts 8 output seconds.
- 363a5a1: `ideogram-reframe` is retired: the provider stopped serving the model (every task failed upstream), so it leaves the model catalog, `IMAGE_I2I_PROVIDERS` / `MODELS_WITH_REFERENCE_IMAGE_SUPPORT` / `IDEOGRAM_PROVIDERS` / `SEED_SUPPORT` / `RENDERING_SPEED_SUPPORT`, and the prompt-wizard category descriptions. For an aspect-ratio change with AI fill use `nano-banana-edit` with the target `aspectRatio`.
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

- 946f71d: Marketplace template categories: `TEMPLATE_CATEGORIES` — the eight use cases a template is filed under (product-imagery, static-ads, user-generated-content, video-ads, brand-assets, automations, campaign-concepts, social-creatives) — with the previous values resolving to their new homes (`resolveTemplateCategory`, `normalizeTemplateCategory`).

### Patch Changes

- 40c4d3a: `buildCreditModelIdentifier` no longer emits an off-grid Flux 2 identifier. Flux 2 is the only family whose credit id interpolates `resolution` rather than matching it, and callers legitimately pass another model's value space — the multi-provider cost preview prices one node's data against every selected provider, and node data written straight into workflow JSON never ran the editor's provider-change fail-safe. A resolution such as `"2K"` used to build `flux-2-pro:2KMP:0ref`, which no pricing row carries. Any value off the megapixel grid now snaps to the model's default tier (the same `preferred` value `normalizeModelInput` uses, so the preview asks for exactly the id the route reserves), and an on-grid value is emitted in the grid's own spelling (`"2.0 MP"` → `:2MP:`). An absent resolution is unchanged.
- ae1a9e4: Add the separately priced Hebrew dubbing model to the model catalog.
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

- 4657aef: VEO 3.1 Quality no longer claims reference-to-video support.

  `MODEL_CATALOG["veo3"]` declared `features: [… "reference-image"]`, and
  `VIDEO_REF_LIMITS_BY_PROVIDER["veo3"]` gave it a 3-image cap. KIE serves
  reference-to-video on the Fast and Lite SKUs only, and says so in its own
  words on a rejected production job: _"Reference to video only supports the Veo
  Fast model and Veo Lite model."_ So every reference-carrying Quality run
  advertised a capability, sent `generationType: "REFERENCE_2_VIDEO"`, and came
  back 422 — after the credits were reserved.

  - **`@nodaro/shared`**: `veo3` drops the `reference-image` feature and its
    `VIDEO_REF_LIMITS_BY_PROVIDER` row (the drift guard binds the two 1:1, and
    the catalog is the single authority on _which_ models carry references).
    Everything derived from that flag follows on its own: `modelsWithFeature`,
    the `{image:N}` token gate, the server-side `connectedReferences` assembly,
    and `GVP_SUPPORTED_PROVIDERS` — so VEO 3.1 Quality also leaves the Generate
    Video Pro model list, whose stated bar is "takes a start still **and** can
    carry reference images". `veo3.1` (Fast) and `veo3_lite` (Lite) are
    unchanged and keep the 3-image cap.
  - **`@nodaro/prompts`**: the VEO prompt doctrine's "Frames & references"
    section now says reference ingredients are a Fast/Lite capability.

  Nothing else moves: Quality keeps every mode it actually has (t2v, i2v,
  first+last frame, native audio) at the same price.

- 834b7c5: Correct Z-Image's prompt-length cap to the 1000 characters its KIE schema states (it was listed as the 5000-char default, so a longer prompt was sent and refused upstream).

## 3.9.0

### Minor Changes

- a8e6d21: Suno V6 family (V6, V6 Wild, V6 Mini) — the new default generation.

  `SUNO_MODELS` is now V6-first: new exports `SUNO_ACTIVE_MODELS`
  (`V6` / `V6_WILD` / `V6_MINI`), `SUNO_LEGACY_MODELS` (the earlier
  generations, still offered and accepted everywhere), `DEFAULT_SUNO_MODEL`
  (`V6`), `SUNO_DURATION_MODELS`, `isLegacySunoModel`, `sunoModelHonoursDuration`
  and `SUNO_VERSION_CREDIT_KEYS`. Three catalog capability sheets — `suno-v6`,
  `suno-v6_wild`, `suno-v6_mini` — at 30 credits per generation, the same price
  as every earlier version.

  `duration` (custom mode) is honoured only by the V6 family; ask
  `sunoModelHonoursDuration(model)` rather than testing a version string.

  Every earlier version (`V5_5` and older) remains a first-class choice; only the
  default moves to V6.

  The built-in music presets (`@nodaro/prompts`) now default to Suno V6.

### Patch Changes

- 0114b68: Camera Motion picker: tested physical-geometry injections for 31 options.

  The `camera-motions` catalog's `promptHint` for 31 options is replaced with the
  studio-approved v2 injections — a description of what the camera physically
  does (travel and/or rotation, what stays constant, explicit parallax, the end
  state) instead of a cinematic label. Covered: orbit / arc / full orbit, pan and
  whip pan, tilt, zoom / crash zoom / match-cut zoom, the dolly speed ladder
  (creep / dolly / push / pull), breathing camera and push-pull, dolly zoom,
  truck, pedestal and crane. Injections are multi-sentence and end in a period.

  `joinHintFragments` (new export) joins hint fragments with a comma after a
  clause-style fragment and a space after one that already closes a sentence;
  `getParameterPromptHint`'s preText/postText wrap and the camera-motion
  start/end composer use it, so a sentence-style hint no longer produces `".,"`.
  Clause-style hints compose byte-identically.

  Terms and descriptions that contradicted the tested hints are aligned:
  `push-in` / `pull-out` are the fast end of the dolly ladder (term `fast
push-in` / `fast pull-out`), `orbit-left` / `orbit-right` are large partial
  orbits, `orbit-360`'s term no longer carries a degree count, and
  `match-cut-zoom` describes a two-shot match cut. `@nodaro/shared` locale
  sidecars for those five ids are updated in all 11 locales.

## 3.8.0

### Minor Changes

- 9d19c35: Add GPT Image 2.5 Flare and Sunburst (text-to-image and image-to-image).

  Four new model ids — `gpt-image-2-5-flare`, `gpt-image-2-5-flare-i2i`,
  `gpt-image-2-5-sunburst`, `gpt-image-2-5-sunburst-i2i` — with catalog capability
  sheets, pricing rows (15 / 25 / 40 credits at 1K / 2K / 4K), the t2i→i2i
  auto-route siblings, a 20000-char prompt ceiling and a 16-image reference cap.

  The image aspect-ratio vocabulary gains `27:16`, `16:27`, `9:8` and `8:9`, so
  `normalizeModelInput` now snaps to (rather than rejects) the widest GPT ratio
  set. Existing models are unaffected — the per-model gate is the catalog snap,
  not this vocabulary bound.

- 15c8b12: 3D Render Pro: one still per shot alongside the MP4.

  `Pro3DRenderJobOutput` gains an optional `shotStills` — `{ shotIndex, frame,
assetId, url }[]`, ordered by `shotIndex` — and `pro3DRenderShotStills(output)`
  is the tolerant reader every surface uses to get it in shot order.

  `shotIndex` is the 0-based position in the v2 composition's `shots` array and
  `frame` is that shot's own first frame in the composition's frame space, so a
  still can be lined up against the exported video without re-deriving shot
  boundaries. A v1 (single-shot) scene has exactly one still, index 0 at frame 0.

  The field is OPTIONAL and the reader schema is passthrough, so a result
  produced before shot stills existed still parses as a complete result; a
  consumer should read `output.shotStills ?? []`.

- 42d48e0: Scene3D: raise the dimension cap to 2560px and document the baked-rig boundary.

  `SCENE3D_LIMITS.maxDimensionPx` and `SCENE3D_V2_LIMITS.maxDimensionPx` go from 1920
  to **2560**, on both axes. The widening is additive — every previously valid plan
  stays valid — and it is backed by a measurement rather than a guess: on the
  `swangle` software path a production-representative render costs 65 ms/frame at
  1920×1080, 97 ms at 2560×1440 and 154 ms at the square 2560×2560 worst case. At
  the contract's 3600-frame ceiling that squares to ~9.2 minutes against the render
  worker's 25-minute budget, and peaks at 3.1 GB against a 32 GB container limit.

  2560 covers true 21:9 at 1097 and the DCI-adjacent widths that 1920 excluded.

  The module docstring now also states, next to the existing determinism rule, that
  camera and object RIGS — spline rails, follow-path and track-to constraints, and
  procedural noise — are deliberately absent from this contract. They are authored
  upstream and arrive baked (v1 as keyframes, v2 as one camera sample per frame).
  The format carries no constraint or noise vocabulary on purpose, because a rig
  evaluated in two different renderers cannot be guaranteed to agree frame for
  frame. The absence is a boundary, not an unfinished TODO.

- 36f8d20: Scene3D: price a render by its frame size.

  New `scene3d-render-pricing` module — `scene3DRenderTier`,
  `scene3DRenderTierCredits`, `renderVideoCreditId` and `pro3DRenderFrameUnit`,
  plus the `SCENE3D_RENDER_TIERS` vocabulary and its two constants.

  A render's work is per pixel per frame, and raising the frame cap from 1920 to
  2560 px made frames renderable that measure ~97 ms/frame (2560×1440) and
  ~154 ms/frame (2560×2560) against ~65 ms at 1920×1080. One flat price across
  that range is either an overcharge on the small frame everyone renders or a
  giveaway on the large one. So a `3d-scene` render now resolves to one of three
  tiers: **base** (longest side ≤ 1920 px, 1×), **large** (longer, up to 5.12
  megapixels, 1.5×) and **xlarge** (longer, above 5.12 megapixels, 2.5×) — the
  measured ratios rounded to halves, with the boundary at the midpoint of the two
  measured frames.

  Nothing gets more expensive: a frame whose longest side is at most 1920 px
  keeps the bare `render-video` identifier and its existing price, whatever its
  area, so every workflow that ran before the cap moved costs exactly what it
  did. The two new identifiers describe only frames that could not be rendered at
  all until it moved. Non-`3d-scene` renders are untouched.

  `pro3DRenderFrameUnit` names the per-frame unit a 3D Render Pro render stage
  reads, with the same tier suffix and the same base-keeps-its-spelling rule. The
  tier RATES are deployment configuration (`model_pricing` rows); this module
  carries only the shape of the price.

## 3.7.0

### Minor Changes

- ef73308: Export `OVERLAY_ANCHORS` / `OverlayAnchor` — the nine points an Image Overlay layer attaches to. One definition for the route's validation, the compositor, the canvas, the SDK and the CLI (it used to be spelled out separately in each).

## 3.6.0

### Minor Changes

- f7a157d: Add the clay-studio-v2 lighting preset for matching shadows in Scene3D v2 previews and exports. Existing lighting presets retain their appearance.

## 3.5.0

### Minor Changes

- 6cf8565: Allow Scene3D v2 anchors to bind to an owned GLB node using node-local coordinates. The shared reader validates ownership and resolves animated world positions while preserving existing entity-local anchors.
- 0fc9fee: Image Overlay layer kinds: the shared wire contract for text (bundled fonts, weight, size as % of the base, outline, background box), QR and shape layers (eleven flat shapes with one geometry shared by the editor and the server), plus image finishing effects (circle mask, feather, stroke, glow), and platform presets with safe areas and per-device zones (the YouTube banner's TV / desktop / all-devices viewports).

## 3.4.0

### Minor Changes

- a4b5102: Add immutable 3D input selectors for advanced scene generation and Pro prompt sources. Select existing GLBs by revision and artifact ID while the server resolves permissions and byte receipts. Basic generation refuses imported geometry instead of silently ignoring it.

## 3.3.0

### Minor Changes

- aace203: Expose the dependency capability and structured execution refusal for workflow nodes that require reviewed Studio inputs.

## 3.2.0

### Minor Changes

- ea23572: Add optional baked entity visibility to the Scene3D v2 wire contract. Omitted visibility preserves the existing visible default; manual visibility overlays take precedence.

## 3.1.0

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

## 3.0.0

### Major Changes

- 32493ee: Add the Scene3D v2 wire contract: a strict discriminated `Scene3DPlan = Scene3DPlanV1 | Scene3DPlanV2` keyed on `schemaVersion`, GLB-backed semantic entities with anchors and material-role bindings, opaque asset references with SHA-256 digests, explicit contiguous shots, a dense one-sample-per-frame camera sidecar with perspective-projection validation, deterministic overlays, provenance and a canonical revision content hash — plus admission and post-decode resource gates.

  V1 parsing is unchanged: same fields, same limits, same messages. `Scene3DPlan` is now the union, so a consumer that reads v1-specific fields must first narrow with `isScene3DPlanV1` / `isScene3DPlanV2`; `scene3DPlanSchema` remains a v1-only deprecated alias of `scene3DPlanV1Schema`.

## 2.27.0

### Minor Changes

- 2c1f0b2: Add the versioned Scene3D wire contract, deterministic edit operations, and typed SDK inputs/results for 3D scene generation, editing and composition rendering. Register scene authoring prompt fields for consistent canvas and workflow execution.

## 2.26.0

### Minor Changes

- c2a939e: Adds the transient-key list the public share read strips: `STUDIO_TRANSIENT_KEYS`, `STUDIO_SHOT_TRANSIENT_KEYS` and the pure `stripStudioTransientSettings`.

  The list has two readers — the public share read of a workflow, and the production writer's own bundle projection — and a second copy of it does not stay equal: it goes one key stale, and the stale side is the one that publishes. So it lives here, once.

## 2.25.0

### Minor Changes

- 04411f2: Remove the studio production wire and op types; the studio codec now lives in a private package.

  `studio-production-wire.ts` and `studio-production-ops.ts` typed the envelope and
  the write protocol of a route family that is no longer served from this repo.
  They shipped in 2.24.0 and nothing consumes them — the SDK never referenced
  either module, and no other client app's types were ever declared here.

## 2.24.0

### Minor Changes

- 15d2086: **@nodaro/shared**

  - LLM catalog gains `gemini-3.8-flash` (KIE `gemini-3-8-flash-openai` chat-completions + direct `gemini-3.8-flash`; economy tier; reasoning low|high on KIE, full minimal→high ladder in Advanced mode; enforced `response_format` json_schema; 16384 output cap — measured on the KIE lane rather than inherited from its 8192-capped 3.6/3.7 siblings). Image-only modality caps by decision: it stays out of the video-analysis picker until the 3.8-vs-3.7 analysis A/B concludes.
  - LLM catalog gains `gpt-6-astra` (KIE responses dialect on the OpenAI family path; premium tier; reasoning low|medium|high|xhigh, on by default with no reasoning param sent; enforced `text.format` json_schema; `temperature` silently ignored, so the registry does not offer it). Image-only inputs.
  - `gemini-3.7-flash` and `gpt-5.6-sol` descriptions lose their superlatives — those belong to the current top model of each family, and a stale one steers quality-critical work backwards in every picker.

- e846720: **@nodaro/shared** — the wire contract of `/v1/studio/productions`, as types.

  `StudioProductionView` is the one read shape every studio production route and
  every studio MCP tool returns: the production's identity and audience, its
  film look, cast, folders, cuts and bin, what is in flight, and its shots in
  timeline order. `detail: "summary"` carries counts and the active urls;
  `detail: "full"` adds every result with the context that regenerates it.
  `ResultKey` is how a result is ADDRESSED — its job id when it has one, its url
  otherwise, never a position, because two writers hold a production open by
  design and an index is stale the moment either inserts.

  The document's own sub-objects (`Cast`, `ScenePlan`, `LookSelectionMap`, …) are
  named JSON aliases rather than re-declared shapes: their definition lives in
  `@nodaro/studio-production` and re-declaring it here would be a second
  definition of the document, which is exactly the disagreement this contract
  exists to end.

  **@nodaro/studio-production** — `toProductionView` / `toProductionSummary`
  (a pure projection of `parseProduction`: no reconciling, no writes) and
  `resultKey` / `findResult`. A build-time pin holds the projection assignable to
  the shared contract, so the two cannot drift in silence.

### Patch Changes

- 055b122: **@nodaro/shared**

  - `VIDEO_ANALYSIS_BUCKET_CREDITS` and `VIDEO_AUDIT_BUCKET_CREDITS` regenerated for the analyser's 9_434-token system-prompt pin (cloud-plugins 0.221.7): 17 of 20 analysis rows and 6 of 8 audit rows tick up by 1–5 credits.

## 2.23.0

### Minor Changes

- 88a6e05: Two additive reference shapes for describing a subject the model has no picture of. `DescribedReference { name, description }` is a reference you can NAME and DESCRIBE but have no media for — an un-bound cast role, a character that exists only in the script; it carries no url, so it attaches nothing and claims no `@image_N` seat. `ConnectedReference.descriptionOverride` is the PER-USE identity description for a reference you DO have a picture for: it fills the assembled directive's description slot ahead of the entity's stored canonical description, while `description` keeps its own label semantics.

## 2.22.0

### Minor Changes

- 60eb55d: `videoProviderFoldsLoneEndFrame(provider)` — the models whose worker folds a lone last frame into the references (Seedance 2.x / MiniMax Hailuo 3 / Wan 3). Exported so a client can gate its own end-frame-only run the way `/v1/generate-video` does, instead of hand-mirroring the family list

## 2.21.1

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

- 1e0206c: `gpt-image-2-i2i` (the id a referenced gpt-image-2 request runs under) declares the same `safetyFilter` policy as `gpt-image-2`, so the one automatic retry and the nano-banana-pro fallback offer apply to reference-image requests — the case the policy exists for. A guard test now requires every `T2I_TO_I2I_VARIANT` pair to carry the same policy on both sides.

## 2.21.0

### Minor Changes

- 94d22ab: Three gaps a third-party consumer of the analysis contract ran into.

  `clipLookSchema` gains `styleId` — the Style catalog id the analyzer PICKED, beside the prose in `style` it corresponds to (`{ styleId: "pixar-3d", style: "3D stylized animation" }`). The analyzer has emitted it for months, but a `z.object` drops what it does not declare, so anything reading an analysis back through this schema lost the pick and fell back to re-interpreting a sentence. It is a free `string`, not an enum: the producer already validates against the catalog, and a second copy of the vocabulary here would drift — and would reject a catalog entry newer than the installed package, which is exactly the analysis a consumer most wants to read. `mergeClipLook` folds it like every other field.

  `AudioLayer` gains the `ambience` mode and a name-keyed `speaker`. Ambience and sfx are different layers of a real mix, recreated by different means — a continuous bed (room tone, distant traffic) versus a discrete hit (a door slam) — and folding them onto `sfx` handed anything recreating the mix a guess. `speaker` is the second way to say who is talking: the plain cast name, for a document that keys its cast by name rather than by a slot id of this analysis; `speakerSlot` is unchanged and a layer may carry both. `dropUnknownSpeakers` remains the SLOT channel's sanitizer — it now strips slot attribution from an `ambience` layer as it always did from `music`/`sfx`, and leaves the name alone, since a name has no id space to be unknown in. The mode vocabulary is exported as `VIDEO_ANALYSIS_AUDIO_MODES` so a consumer imports it instead of restating it.

  `VIDEO_AUDIO_CAPABILITY` finally declares the two Gemini Omni SKUs, `gemini-omni-video` and `gemini-omni-flash`, as `{ mode: "ambient", alwaysOn: true }`. They were unlisted, so `getVideoAudioCapability` reported them as silent while `MODEL_CATALOG` had described both as native audio since they landed — anything reading the map told authors those models make no sound. Settled from Google's own documentation: the model generates an audio track by default and the request schema carries no on/off lever (hence `alwaysOn`, no toggle field), while spoken dialogue is documented only for multi-turn extension via `previous_interaction_id`, a path our transport does not expose — so they are held to the same bar as the Wan 3.0 family and classified ambient rather than `native_speech`, with an upgrade reserved for a live probe. No dialogue routing changes: `videoModelCanSpeakDialogue` still answers `false` for both.

- bb58724: `MODEL_CATALOG` now carries `ltx-2.3-pro` and `ltx-2.3-fast` (modes, aspect ratios, resolutions, durations and the full pricing table). They were the last two `VIDEO_GEN_PROVIDERS` members outside the catalog, which meant `/v1/models`, MCP `list_models` and every catalog-driven normalizer skipped them and the frontend option menus were hand-spliced. A new totality test fails the build if another video provider is added without an entry.
- 14f930d: `ModelCatalogEntry` gains an optional `safetyFilter: { stochastic: true; fallback?: string }` flag for models whose provider safety filter is known to be non-deterministic — a benign prompt can trip it once and pass on an identical retry. `gpt-image-2` now declares it with `fallback: "nano-banana-pro"`.

  New `safetyRetryPolicy(modelId)` reads the flag and returns `{ maxAttempts: 2, fallback }` for a flagged model (fallback omitted unless it resolves to a real catalog entry) and `{ maxAttempts: 1 }` for everything else, including unknown ids. A catalog-wide guard test requires every declared `fallback` to point at an entry that actually covers the flagged model: it must produce an image, support every mode the flagged model supports, and accept a reference image.

- bb58724: `resolveTopazUpscale()` collapses the Topaz image-upscale node's two levers onto the one parameter KIE accepts (`upscale_factor` ∈ 1/2/4) and returns the credit tier that matches what is actually sent. The legacy `targetResolution` (2K/4K/8K) is accepted and mapped forward (8K → the 4x tier, with an adjustment; an invalid factor falls through to a legacy tier rather than freezing the default first). A valid `upscaleFactor` overriding a disagreeing stored `targetResolution` is disclosed via an informational adjustment rather than dropped silently. Consumers must pass the returned `creditTier` — not the raw request value — into `buildCreditModelIdentifier`.

  The `topaz-image-upscale` `MODEL_CATALOG` entry follows: it no longer declares `resolutions` (the 2K/4K/8K menu had no provider parameter behind it) and its `pricing[]` drops the `:8K` row, which nothing can reserve any more. The `:8K` price key stays in the platform's static/DB pricing so historical usage still resolves. `MODEL_RECOMMENDATIONS` stops advertising an 8K Topaz tier.

- 7810119: Add `classifyRefToken`, `unresolvedRefTokens` and `REF_TOKEN_NAMESPACE_PREFIXES`: the shared `{Label}` token classifier the execution engine uses to refuse dispatching a prompt that still carries an unresolvable reference.

  The namespace exclusion set widens from `image:` to `image:` / `video:` / `audio:` / `slot:` / `ref:` (matched case-insensitively, as the resolvers themselves match), so reference-handle (`{video:1}`, `{audio:1}`), id-addressed reference (`{ref:hero}`) and recast (`{slot:x}`) tokens are no longer classified as missing node refs. This also changes the editor: such tokens stop rendering as missing-reference warnings and stop suppressing auto-injection of a connected node.

  Runtime behaviour the backend engine builds on this classifier: a `{Label}` naming a node that EXISTS in the workflow but produced nothing now resolves to empty text (or to its `|| fallback`) instead of shipping the literal token to the provider. That includes a `{Label}` naming a node that is not connected to the consumer — it resolves to empty text rather than refusing or shipping the literal, so an unconnected reference produces no visible signal. Only a `{Label}` naming no node at all refuses.

- bb58724: `VIDEO_REF_VIDEO_DURATION_LIMITS` + `checkRefVideoDurations(provider, durationsSec)` — per-provider reference-video duration bounds, alongside the existing reference-COUNT caps in `VIDEO_REF_LIMITS_BY_PROVIDER`. Both video routes already ffprobe reference videos to price a run; the durations are now checked against the provider's limits so an out-of-bounds clip is a 400 before the job exists instead of a post-payment provider reject ("Each reference video must be between 2 and 30 seconds"). Data-driven like the reference-audio cap: only providers with a verified documented limit are listed, so an unknown provider is never false-rejected, and a failed probe (a non-finite or non-positive duration) is ignored rather than turned into a user-facing rejection. Two providers are declared: `seedance-2-5` (2–30s per clip, ≤30s total) and `minimax-h3` (2–15s per clip, ≤15s total — the bound behind "video duration 52838 ms, expected [2000, 15000] ms").
- bb58724: Two new video-lane helpers that make the tier we RESERVE the tier we SEND.

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

### Patch Changes

- 14f930d: `EXECUTION_DATA_KEYS` now includes `errorHint` — the structured safety-block
  detail a node carries alongside `errorMessage` on a failed run (editor-side
  `JobErrorHint`). Keeps it in the runtime/result key set: excluded from node
  presets, exempt from undo capture like every other execution-state field, but
  (unlike `TRANSIENT_RUNTIME_KEYS`) persisted across reload the same as
  `errorMessage`.

## 2.20.0

### Minor Changes

- 1e9e962: `stripDerivedAnalysisFields(json)` — a video analysis with its server-derived fields removed (top-level `warnings` / `variationFolds`; per-scene `visualResolved` / `slotRefs` / `oversized`; `refImageUrl` kept): the compact form an LLM is handed when the analysis is the brief. One strip list for the async structured-draft worker (`POST /v1/llm/structured/jobs` with `videoUrl`) and the Nodaro Studio job-id loader.
- 158b2e6: Organizations: usage reports (rollout-gated). `client.organizations.usage(orgId, query)` and `client.workspaces.usage(workspaceId, query)` return credits by workspace, member, model or day for an inclusive date range (`from`/`to`, IANA `tz`), with in-flight vs settled credits split out and the platform-absorbed overrun listed separately; `usageRows` pages the underlying runs; `usageCsv` returns the same report as CSV. The CLI gains `nodaro org usage` and `nodaro workspace usage` (`--csv`). `@nodaro/shared` adds the `UsageReport`, `UsageReportRow`, `UsageVarianceRow`, `UsageLogEntry`, `UsageQuery` wire types, the `USAGE_GROUP_BYS` list and the `audit_unavailable` error code.
- c6be4ac: `sunoCreditType(model, operation)`, `SUNO_VERSION_PRICED_OPERATIONS`, and `SUNO_SELECT_OPERATIONS` are now public. This is the single implementation of the Suno credit-key contract: `/v1/suno/generate|cover|extend` are priced by model version (`V5_5` → `suno-v5_5`, `V5` → `suno-v5`), and every other Suno operation charges a flat per-operation key regardless of version. `SUNO_SELECT_OPERATIONS` is the readonly tuple of the seven Suno operations that appear behind a select/dropdown UI (model pickers, node badges, the credit estimator), so those call sites can iterate or count the full set without redeclaring it and drifting from this one. Previously a private backend helper, `sunoCreditType` is exported because the editor's model dropdowns, node badges and workflow-credit estimator all have to quote the key the route actually charges — quoting a bare Suno version instead made every Suno model dropdown ask for an unpriced identifier and render no price at all.
- 4c5dedb: New `SUNO_HARD_CEILING` (30000) — the absolute Zod bound for Suno text fields on the `/v1/suno/*` routes. The per-version caps (`getMaxSunoPromptChars` / `getMaxSunoStyleChars`) still decide what reaches the provider; the routes clamp to them. Previously the routes bounded these fields at `SUNO_TEXT_MAX` (5000), so a programmatically-set prompt was hard-rejected with a 400 before the clamp could trim it. Deliberately separate from `PROMPT_HARD_CEILING`, which is an image/video budget with its own drift guard.
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

## 2.19.0

### Minor Changes

- d693fbe: Three new KIE video models in the catalog: **Wan 3.0** (`wan-3`), **Wan 3.0 Prime** (`wan-3-prime` — the high-speed variant, faster turnaround at a higher per-second price, not a higher-quality tier) and **Gemini Omni Flash** (`gemini-omni-flash` — the cheaper, faster sibling of `gemini-omni-video` on an identical request shape).

  `@nodaro/shared`:

  - Catalog entries for all three, each joining `IMAGE_TO_VIDEO_PROVIDERS` and `TEXT_TO_VIDEO_PROVIDERS` (one id per SKU serves both modes — no `VIDEO_MODE_ALIASES` twin, no `VIDEO_PROVIDERS_REQUIRING_IMAGE` gate). All three derive into `GVP_SUPPORTED_PROVIDERS`; Wan 3.0 also derives into `GVP_END_FRAME_PROVIDERS` via its `end-frame` feature, and none of them joins `GVP_EXTEND_PROVIDERS` (`video-reference` is deliberately not declared — the provider's `input + output ≤ 30 s` ceiling cannot be expressed in the engine's segment bounds).
  - Wan 3.0: 2–30 s in whole seconds, `480p` / `720p` / `1080p`, aspect `adaptive` (default) / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` (no `21:9`), reference limits 10 images / 5 videos / 5 audio (each clip 1–15 s, ≤ 15 s combined per type). Its reference arrays are **mutually exclusive** with the first/last frame parameters on the provider's wire, so a wired start/last frame folds into the reference pool — appended after the caller's own images and bound in the prompt — exactly as on Seedance 2 and Hailuo 3; the pair is never sent together.
  - New exports: `WAN_3_PROVIDERS` / `isWan3Provider()` and `GEMINI_OMNI_PROVIDERS` / `isGeminiOmniProvider()` — exact-membership family predicates that replace the literal id comparisons deciding V2V routing, the reference quota, the mode swap and the resolution/aspect panels, so a new SKU inherits the behaviour instead of silently diverging. Plus `WAN_3_DEFAULT_RESOLUTION` and `normalizeWan3Resolution()`, the single place the provider's uppercase wire spelling is produced (everything internal stays lowercase).
  - New exports `uiAspectRatioFill` / `uiResolutionFill` / `uiDurationFill` — the catalog-derived UI defaults for the unified video nodes, previously private to the backend DAG payload builder. Wan 3.0 is the first provider whose declared default (720p, 5s) is not index 0 of its ascending catalog ladders, so the run strip, the config-panel fail-safe and the enqueued payload all read the one helper instead of `resolutions[0]` / `durations[0]` and cannot drift apart.
  - `VideoAudioCapability.field` widens to `"generateAudio" | "sound" | "audio"` and `applyVideoAudioToggle` gains the matching branch, so Wan 3.0's own boolean audio lever (ambient track, on by default) is written to the right key. Wan 3.0 is classified `ambient`, not `audio_driven`.
  - Credit identifiers: Wan 3.0 bills per second on a duration × resolution composite `<id>:<N>s:<resolution>`, and an omitted or unsupported resolution now collapses to the model's declared default tier rather than the first tier in the list, so the composite that is billed always matches the tier that renders. Gemini Omni Flash uses the sibling's shape — `gemini-omni-flash:<duration>`, `:4k:<duration>` and the flat `:vref` / `:4k:vref` video-edit rows — with an omitted duration falling back to the 8 s tier.

  `@nodaro/prompts`:

  - A new `WAN_3_DOCTRINE` entry, kept separate from the Wan 2.x doctrine on purpose: Wan 2.x teaches `Image 1` with a space, while Wan 3.0 binds references as `Image1` / `Video1` / `Audio1` without one. Content is provider-stated fact only (token format, the 10 / 5 / 5 caps and their duration windows, the wire-level frames-vs-references exclusivity, the 20,000-character prompt limit).
  - `GEMINI_OMNI_DOCTRINE` now covers both SKUs, and the Gemini Omni i2v input resolver reads its quota per provider instead of assuming the Pro id.

### Patch Changes

- e11c818: Close analyzer-reported picker-catalog gaps: add a Central Asia regional-aesthetic group (person), workwear-overalls / chapan / caftan outfits (styling), a held work-gloves prop, an early-color-photo (autochrome) style, and an open-air-market setting. Enable layered headwear (single-select → up to 2, e.g. a sun hat over a turban). Each new entry ships full label + description translations across all 11 non-English locale sidecars.

## 2.18.0

### Minor Changes

- 1c2c224: Sectioned prompt shape — the LOOK clauses leave the prompt body for a trailing `[style]` block, on both surfaces. An assembled prompt is now `<body>\n\n[style]:\n<film line>\n<scene line>`: the body carries the user's prose, the subject fold, the whole MOTION direction family and the structured fragment last; the section carries every look clause, film line first. Folded inline, a broad direction buried the shot — a dozen grade/lighting/era sentences in the same register as the action, with nothing telling the model which was which. The section says it structurally instead.

  `prompt-style-section.ts` owns the grammar and exports it whole, so a client preview renders the same bytes the server does: `STYLE_SECTION_HEADER` (exactly `[style]:`, lowercase, never indented — the video reference resolver collapses 2+ horizontal spaces unanchored), `partitionStyleClauses` / `styleSlotFor` / `asBodyClauses` for the body-vs-look split, `styleSectionFromClauses` and `renderStyleSection(direction, { surface, mode })` for the block, `composeSectionedPrompt` for the whole prompt, and `sectionedClauseCosts` for the shed budget. The film/scene grouping is a `styleGroup: "film"` column on `DIRECTION_FIELDS` (`cameraFormat`, `colorLook`, `style`, `era`, `cameraFormatId`, derived as `FILM_STYLE_KEYS`) — one definition, and the line order falls out of table order. `renderDirectionHintClauses` is `renderDirectionHints` with the row attached; the plain renderer is now its `.text` projection.

  The body/section boundary IS the registry's `family` column, the same column the video verbosity policy splits on: camera motion is part of the shot prose, not the look, so the whole motion family stays inline. Coupling the two is deliberate — a row cannot be shot prose for one and look for the other.

  ZERO look clauses (none selected, all shed, or all deduped away) emits no header and no extra newline, so the verbatim-and-untrimmed no-op is byte-identical: zero hints AND zero section returns the caller's prompt unchanged, `undefined` included, which is what the routes' `composed !== prompt` guard reads. When the section IS present the prompt is trimmed even if the body gained nothing, and a blank body drops the gap with it rather than opening on a newline.

  Shedding is unchanged in ORDER — one flat list, tail-first, look clauses before subject — but list position is no longer string position, so `keepableDirectionHints` takes an optional exact per-clause cost array. A flat "clause + separator" charge under-prices the clause that holds the 11-byte header and over-sheds past it; both composers now pass composed-length deltas, computed once and only on the overflow path.

  `buildImagePrompt`'s hybrid line-initial capitalizer stops at the header, which would otherwise rewrite it to `[Style]:` and capitalize every catalog clause under it.

  THE SECTION HAS NO TERMINATOR, so every assembler downstream of the composer is section-aware or its text reads as one more look clause. Scene content is SPLICED into the body ahead of the section — `insertBeforeStyleSection` (with `splitStyleSection` and `endsInsideStyleSection` alongside it) is what the hybrid image path, the video reference resolver and the legacy character-description wrapper now use for their trailing role phrases, element directives and descriptions. The splice is length-preserving, so the shed arithmetic is untouched, and the look tail stays last. The self-labeling control lines stay at the end instead and close the header's scope with a blank line: `Style:` / `Avoid:` on the image side, and `@nodaro/shared`'s `applyVideoNegativePrompt` on the video side, through its new `videoNegativeSuffix(negativePrompt, base?)` — omit `base` for the widest form, which is what a caller reserving room before the prompt exists (the backend's `effectiveVideoPromptCeiling`) must budget. A prompt with no section keeps its exact previous bytes on every one of those paths.

## 2.17.0

### Minor Changes

- 9193ea3: Animal prompt phrasing gets one owner: new `getAnimalPromptHint(id)` / `getAnimalTerm(id)` in `@nodaro/shared`, next to the `ANIMALS` catalog they read. "featuring a {label}, {description}" had two independent copies — the picker-catalog funnel's synthesized `promptHint` and `getParameterPromptHint`'s `animal` case — and both now call the getters instead of re-authoring the sentence. Output is byte-identical; the getters return `""` on an unknown, empty or absent id, exactly like every `get*PromptHint` in `@nodaro/prompts`.

  They live in `@nodaro/shared` rather than `@nodaro/prompts` because the incoming `subject` prompt channel needs a third caller, and a getter under `packages/prompts/src` that read the raw `ANIMALS` array would be a new offender against the catalog-funnel ratchet. `getAnimalTerm` therefore carries a local copy of `deriveTerm`'s mechanical label derivation (`@nodaro/prompts` depends on `@nodaro/shared`, never the reverse), pinned entry-by-entry against the original by a new parity test.

- 3979aa4: Workflow export/import now carries the `@`-chips' entities. `collectAssetIds` harvests the entity ids bound in `ConnectedReference` chips (`generatedResults[].references[]`, `beats[].references[]`, anywhere else a `references` array sits in node data — and in the workflow's freeform `settings`, where an app can keep its own index of the same work), not only the four entity-node `*DbId` fields — so a graph that binds its entities through chips alone exports its characters, objects, creatures and locations instead of none of them, and imports with every chip, in the graph and in `settings` alike, re-pointed at the rows created under the importer.

  `WorkflowImportReport` gains two optional fields: `assetIdMap` (bundled entity id → the row created for it, for chips a client holds outside the graph; present whenever the bundle carried `assets`, `{}` when nothing was created) and `assetsSkipped` (`{ kind, id, name, reason }[]` — entities storage quota left uncreated; the workflow still lands). A bundled entity's images are now copied into the importer's own storage even when they already sit on the same instance, because they are the exporter's bytes; the export's `portability.unreachableMedia` covers them too. The per-import copy cap applies per HALF — the graph's media and the bundled entities' each get the full budget, so neither can starve the other.

- a6bc7bd: Dubbing full surface: video in -> dubbed VIDEO out (+ the dubbed audio track), `sourceUrl` for public links ElevenLabs fetches itself, start/end dub windows, `numSpeakers` 0=auto, resolution/profanity/accent/watermark options, and per-minute pricing of the dubbed span (max 30 minutes). `voices.dub()` accepts the new source object and options; dubbing joins the shared dual-mode producer set.
- 7abf3ed: Creature and object `@-mention` grammar.

  `wired-creature` and `wired-object` references gain the same name-addressed
  mention grammar the named-image reference already had —
  `@<name-slug>:<index>[:<role>][~lock|~nolock]` — through a new
  `entity-mention-slug` surface: `entityMentionSlug`, `parseEntityMentionToken`,
  `findEntityMentionTokens`, `entityMentionSlugForRef`, `knownEntitySlugsFromRefs`
  and the `EntityMentionTokenInfo` type.

  The grammar itself — slug shape, parser, finder and both collision guards (the
  4-part trailing reject that stops a character token being mis-claimed, and the
  slash guard that stops a location bucket token being spliced as a truncated
  prefix) — is factored into one internal core shared with the named-image
  grammar, so those guards exist in exactly one place. Every existing
  image-mention export keeps its signature and behavior.

## 2.16.0

### Minor Changes

- a136e52: ElevenLabs v3 dialogue goes direct: the v3 TTS per-request cap rises to 5,000 characters (dialogue: 5,000 total across lines, at most 10 unique voices), the model catalog gains a dedicated `dialogue` mode, the SDK gains `voices.textToDialogue()` (multi-speaker script -> one audio file; any voice including clones, `[audio tags]`, seed + text normalization), and the CLI gains `nodaro voice dialogue --line "Voice: text"`.
- e40d384: feat(prompts,shared): named-image mentions — `@<name-slug>:<index>[:<role>]`

  A wired image (`wired-image` / `manual` reference) can now be addressed inline by
  the slug of its name — an upload node's label on the canvas, or the name a thin
  client puts on the reference — the same way characters and locations already are.
  `@town:3` renders the reference's binding at the position it was typed
  (`reference image C`); `@town:3:background` renders the role phrase
  (`the background from reference image C`). Model-facing rendering is unchanged:
  lettered bindings on the image path.

  - `@nodaro/shared` gains `imageMentionSlug`, `parseImageMentionToken`,
    `findImageMentionTokens`, `knownImageSlugsFromRefs`, `imageMentionSlugForRef`
    and the `ImageMentionTokenInfo` type. This is a DELIBERATE give-away to the public
    tier: the SDK and every thin client must share one grammar with the resolver,
    so the parser lives in `shared` while all prompt-assembly logic stays in
    `@nodaro/prompts`. Grammar is 2–3 segments (no variants, no buckets, no usage
    modes) plus the additive `~lock` / `~nolock` sentinel; a 4-part token is never
    claimed, so an unresolved character mention (`@kira:1:smile:face`) can never be
    mis-captured as a 3-part image mention with `:face` left dangling. The same
    guard covers the location grammar's `/` separator: `@lib:1:weather/rain` is
    never claimed as the truncated `@lib:1:weather`, while `@town:1/@barn:2` still
    resolves both. No new `ConnectedReference` field — the slug derives from
    `defaultName`, so nothing changes on the wire and the reference schema is
    untouched.
  - `toConnectedReference` gains `kind: "image"`, the SDK interface point for a
    thin client binding an uploaded image.
  - `buildImagePrompt` resolves image mentions as Phase-0 pass 3, after characters
    and locations. Pass order is precedence: a name shared with a character
    resolves as the character. Duplicate image slugs bind first-wins, matching
    `buildTileIdForUrl` — every unrenamed upload node shares its default label, so
    ties are the common case rather than an edge.
  - HYBRID only. Under the legacy reference format an `@name:N` token stays literal
    text and the reference attaches exactly as before, so
    `IMAGE_REFERENCE_FORMAT=legacy` reverts the feature entirely.

  No prompt text changed for any prompt that carries no `@<image-name>` mention:
  the Phase-0 arm is gated on TOKEN presence rather than slug presence, so an
  unmentioned graph never enters the mention path and its prompt and
  `referenceImageUrls` are byte-identical. Prompts that DO carry a mention
  intentionally re-seat that reference's letter — its URL moves from the trailing
  auto-attach block into the mention block, which re-letters everything after it.
  That is the point of the feature, not a regression.

  A capped-out reference degrades silently: `imageReferenceLimit(provider)`
  truncates `connectedReferences` before Phase 0, so a mention whose reference was
  capped out falls through as literal text — matching how a capped character
  mention behaves today.

## 2.15.0

### Minor Changes

- 1899a97: video-analysis: a scene may carry a free-text `transition` (the edit into the next scene in the analyser's own words, ≤ 120 chars); the closed `transitionOut` vocabulary becomes legacy — still parsed, never emitted again.

## 2.14.0

### Minor Changes

- 7ca2869: feat(video): `{ref:<id>}` / `{ref:<id>:<label>}` — address a video reference by its own id.

  A caller that passes `connectedReferences` to the video routes can now name a reference in the `prompt` by the `id` it gave that entry, and the platform substitutes the `@image_N` seat after it has numbered the references. Until now a client that wanted the binding inline had to compute `N` itself — a client-side mirror of the platform's numbering walk (flat refs → mentioned characters → unmentioned wired characters → the rest, bounded by the provider's image cap) that silently misbound pictures the moment the walk changed.

  - `resolveVideoReferenceCore` records each reference's seat as it numbers (`id → @image_N`) and resolves `{ref:<id>}` tokens against that map — before the `referenceOrder` reorder, so the binding follows the reference to its final seat. `{image:N}` / `{video:N}` / `{audio:N}` are unchanged: still resolved after the reorder, still keeping the author's literal `N`.
  - Ids are opaque and may contain `:` and `/`; they are matched by identity against the known ids, never parsed by character class. The optional `:<label>` uses the same label class as `{image:N:label}` and renders `the <label> from @image_N`.
  - A token never ships raw: an unknown id, a reference the walk skipped, one the provider cap dropped, or a provider without image-reference support degrades to the label, else the reference's display name, else nothing. New core input `refNamesById` lets a caller supply names for references it capped out before the walk; new exported `resolveRefIdTokens` is the standalone resolver.
  - `VideoExtraRef.id` (prompts) and `ExtraRefInput.id` (shared) carry the row id through to the slot map. Additive: extras without an id number exactly as before.
  - No output changes for prompts that carry no `{ref:` token.

### Patch Changes

- 9915a46: video-analysis / video-audit pricing regenerated for the transition vocabulary v2 doctrine (system-prompt pin 8_706 → 9_082, cloud-plugins 0.212.0): 15 of 20 analysis rows and 6 of 8 audit rows tick up by 1–5 credits, and this round the legacy `gemini-3-flash` family moves too; bare-id ceilings follow (`video-analysis` 2071 → 2076). Migration 357 writes the same numbers.

## 2.13.0

### Minor Changes

- 9963ec5: Prompt pre & post text: `promptPrefix` / `promptSuffix` node-data fields on every AI prompt node (`PromptAffixFields`, `applyPromptAffixes`, `nodeSupportsPromptAffixes`); `apps.run(slug, inputs, { inputOverrides })`; `nodaro apps run --override nodeId.field=value`.
- b08b3dc: video-analysis: transition vocabulary v2 — `VIDEO_ANALYSIS_TRANSITIONS` gains `zoom`, `slide`, `white-flash`, `digital-glitch`, `morph`, `match`, `jump` (twelve values); an ABSENT `transitionOut` now means nothing asserted (the video model decides) and `cut` is an explicit assertion, never a default.

### Patch Changes

- db47f72: fix(composition-effects): add a neutral `none` default and de-duplicate `3x3-grid-collage`.

  - The `composition-effects` picker defaulted to `bursting-through-frame`, a heavy 3D paper-tear, so every unconfigured node injected a dramatic subject transform the user never asked for. The catalog now leads with a neutral `none` entry (empty `promptHint`) and defaults to it — the same no-op-entry convention `transitions` and `character-fx` use for their `auto` default, which keeps the advertised `defaultValue` a real member of the option list every consumer enumerates. Changed in both `@nodaro/prompts` sources that carry it (`PICKER_CATALOGS` and `ALL_PICKER_WIRING`), and localized in all 11 locales (`@nodaro/shared`).
  - `3x3-grid-collage` existed under the same id in both `framing/composition` and `composition-effects`. It is removed from the composition-effects catalog (`@nodaro/prompts`) and all 11 i18n locales (`@nodaro/shared`); the `framing` entry stays as the canonical one.

- 68d0464: Factory presets whose text is a complete instruction (Reference Sheet boards, Character Reference Grid, Label Elements / Apply Named Edit, Face Privacy, Portrait Transformations, Stylized Subject & Edits, SwitchX operations, Restyle Looks) now ship it as `promptPrefix` / `promptSuffix` instead of `prompt`, so applying them keeps your prompt. `presetApplyClearKeys` (shared): a preset that ships prompt content clears stale pre/post text on apply.

## 2.12.2

### Patch Changes

- ded5ac2: video-analysis / video-audit pricing regenerated for the recast shot-craft Stage-1 doctrine (system-prompt pin 8_203 → 8_482): 21 of 28 analysis rows and 6 of 8 audit rows tick up by 1–4 credits; bare-id ceilings follow (`video-analysis` 2064 → 2068). Migration 355 writes the same numbers.
- 8802a1e: video-analysis / video-audit pricing regenerated for the recast shot-craft Stage 1.3 doctrine (system-prompt pin 8_482 → 8_706, cloud-plugins 0.209.0): 12 of 20 analysis rows and 6 of 8 audit rows tick up by 1–3 credits, and the legacy `gemini-3-flash` family is unchanged; bare-id ceilings follow (`video-analysis` 2068 → 2071). Migration 356 writes the same numbers.

## 2.12.1

### Patch Changes

- c089b33: fix(framing): drop the "holster visible" wardrobe clause from the `cowboy-shot` prompt hint (Shot Size must describe the frame only), and remove the `head-to-knees` entry — a duplicate crop of `medium-wide-shot` with no way for a user to tell them apart. `head-to-knees` is dropped from the framing catalog (`@nodaro/prompts`) and all 11 i18n locales (`@nodaro/shared`); `medium-wide-shot` stays as the canonical term.

## 2.12.0

### Minor Changes

- 47200ef: video-analysis: `onScreenTextKind` on scenes, clip-level `transitionIn`, and the `VIDEO_ANALYSIS_TEXT_KINDS` / `VIDEO_ANALYSIS_CLIP_TRANSITIONS_IN` vocabularies (keys only — no existing enum widened).

## 2.11.0

### Minor Changes

- 18766f4: Person-pack curation is now enforced in the app UI, not only in `/v1/catalogs`.

  `@nodaro/prompts`: `getRegisteredPeople()` — read directly by the picker-ui person grids — becomes the composed funnel, folding the same `CatalogPack` registry `composePickerCatalogs` folds (deny/replace/extend on `catalogId:"person"`, in registration order). A deny/replace pack now hides base person entries in the picker grids, not just in the catalogs projection. A guard test pins the grid's person id-set equal to the composed catalog's forever.

  `@nodaro/shared`: two generic, content-free registration slots that `@nodaro/prompts` populates at pack-registration time (shared never imports prompts):

  - `setRegisteredPersonPackFields([...])` so `getParameterValue(data, "person")` resolves a pack dimension in the `{PersonLabel}` field-mapping fallback.
  - `registerCatalogSidecars(catalog, sidecars)` / `resetCatalogSidecars()` so a pack's localized sidecars resolve through `resolveLabel`/`resolveDescription`/`entryMatchesQuery` in the app UI.

  All three are inert on mainline (empty registries = byte-identical behavior). No deployment-specific content enters either package.

- ca8594e: Catalog replacement/extend pack seam. `@nodaro/prompts` gains a vendored catalog-pack registry (`registerCatalogPack` with `replace`/`extend`/`deny` modes) composed at the picker-catalog root — `getRegisteredPickerCatalogs()` is the single funnel every enumerating consumer reads (funnel getters, `projectAllCatalogs`, completeness). The base `PICKER_CATALOGS` is frozen and never mutated in place; curation is additive-by-registration. Also adds pack sidecar-coverage reporting (`computePackSidecarCoverage`) and a single-dim promptHint fallback so pack-added ids resolve.

  `@nodaro/shared` gains exactly one thing: the tag-free `ProjectedCatalog` / `ProjectedCatalogOption` / `ProjectedCatalogDimension` wire shape for `GET /v1/catalogs`. No tags, no policy field — the deferred `CatalogPolicy` never crosses the Apache boundary.

- 5947e21: Add `ENTITY_NODE_KINDS` and the entity-node field vocabulary — `ENTITY_DB_ID_FIELD`, `ENTITY_NAME_FIELD`, `ENTITY_TABLE`, `ENTITY_BUCKET_FIELDS`, `ENTITY_SCALAR_FIELDS`, `ENTITY_KIND_SCALAR_FIELDS`, `entityScalarFields()` and `entityHydrationColumns()`.

  Which columns of a saved character / object / creature / location land on its canvas node, per kind. Four surfaces copy an entity row onto a node — the browser's load-time hydrator, its library picker, the server's run-time hydration, and the `@` mention picker — and they were four hand-written lists that drifted exactly as you would expect. This is the field NAMES only; merge behaviour stays with each caller, because a browser node and a server row disagree about nulls.

  Public because the run contract needs it: an entity node's shape is part of what a workflow JSON means, so anything authoring one through the API has to know which fields carry the entity's media.

- 1096ad2: Compact professional `term` on every picker-catalog entry.

  `@nodaro/prompts`: each catalog entry can now carry a short `term` beside its long `promptHint` — the two-to-four word phrase a professional would actually write in a prompt ("whip pan left", "hard cut", "medium close-up"). `label` stays what users see, `promptHint` is what models read in verbose hint mode, `term` is what they read in compact hint mode. New `term.ts` (`deriveTerm` / `isSuspiciousDerivedTerm` / `resolveTerm` / `TERM_MAX_CHARS`) plus a `get<Name>Term(id)` getter alongside every `get<Name>PromptHint(id)`, and roughly 1,370 explicit terms authored where the lowercased label is not the trade term. A guard test walks every registered catalog and fails for a suspicious label with no authored term, for a term over the length or word cap, and for two ids in one catalog that would inject the same fragment — so the convention is enforced rather than documented. `PickerOption.term` is always present and already resolved (`""` for a no-op "auto"/"none" entry that injects nothing) — including on options added by a catalog pack, which are resolved at composition so a pack built against an older `@nodaro/prompts` still injects in compact mode. Consumers render `label` and inject `term`, never deriving one from the other.

  Where a catalog's grammar carries its meaning, the term keeps that grammar rather than leaving a consumer to re-add it: Material terms read `"made of polished gold"` (not `"polished gold"`, which would only name a material present in the scene) and Held Prop terms keep the held-in-hand verb (`"cradling a cat"`). Mood terms name the subject's expression, matching the register of their hints.

  Selecting a register: `PickerHintMode` (`"full" | "compact"`) is exported from `term.ts`, the `build*Hints` family (`buildFramingHints`, `buildPersonHints`, `buildStylingHints`, `buildLightingHints`, …) takes an optional trailing `mode: PickerHintMode = "full"` so existing calls are unchanged, and `getParameterPromptHint` reads `data.hintMode` off the node — absent or unrecognized means `"full"`. A compact Camera Motion / Transition node propagates the mode into the pickers wired to its `startState` / `endState` handles; a wired picker that declares its own `hintMode` wins over what it inherits.

  Pack authors are NOT required to supply it: `registerCatalogPack` accepts term-less options/dimensions/catalogs (`PickerOptionInput` / `PickerDimensionInput` / `PickerCatalogInput`) and resolves `term` at composition, so an existing vendored pack keeps compiling.

  `@nodaro/shared`: `ProjectedCatalogOption` gains `term?: string` — the `GET /v1/catalogs` wire shape carries it at **both** detail levels, so a thin client rendering its own pickers gets the injectable term without a second `detail=full` fetch. The four object-entity catalogs (animals / vehicles / weapons / furniture) gain the same optional `term?` field, authored only where the label is a UI compound ("Airship / Dirigible" → `airship`, "Plasma Sword / Lightsaber" → `plasma sword`); everywhere else the label _is_ the professional term and `@nodaro/prompts` derives it the same way it derives every other catalog's (lowercased, parentheticals stripped).

  `@nodaro/sdk`: `PickerOption` and `ProjectedCatalogOption` mirror the new field, so `client.pickerCatalogs.get()` and `client.catalogs.list()` are typed for it at both detail levels.

  `@nodaro/cli`: `nodaro catalog` snapshots now record an entry's `term`, and `diff-upstream`'s three-way merge counts a term-only upstream edit as a real content change — previously an upstream entry whose only edit was its `term` never reached a vendored pack's merge plan. That behaviour change is what makes this a minor rather than a patch. `nodaro pickers get` also documents `term` on its default (compact) detail level.

### Patch Changes

- 83c38a7: `@nodaro/shared`: `VIDEO_PRODUCER_TYPES` gains `gif-to-video` so the new GIF→MP4 node's output is accepted as a video by every downstream consumer (canvas validators + backend asset-typing read this one set).

## 2.10.0

### Minor Changes

- 8c4110e: The language registry drops the `flag` emoji field. Flags are countries, languages are not: the mapping is many-to-many and politically loaded — Arabic is spoken across ~25 countries (which flag?), English carries the UK-vs-US problem, and pinning Hebrew to a national flag beside Arabic reads as a statement rather than a convenience. Flag emoji also render inconsistently across platforms and mean nothing to a screen reader.

  Each language is now identified by its endonym (native name) plus its English name — unambiguous, self-identifying (a Hebrew reader finds עברית without reading English), and neutral. `LanguageDefinition.flag` and the per-entry values are removed; the language switcher and editor locale picker no longer render a flag.

- 0134594: Organizations: a ninth preset setting, `policy_survives_suspension`.

  It answers whether an organization's content rules still bind its members
  while the organization is SUSPENDED. Default `false` in both kind presets,
  which is the existing behaviour — a stopped organization stops binding, and
  its members work independently until it resumes.

  An organization whose reason for restricting its members is contractual —
  work made here belongs to the institution — turns it on, because an unpaid
  invoice does not void a contract. Today it governs exactly one rule
  (`personal_space_enabled`); every other preset key governs behaviour inside a
  workspace, which a suspended organization grants no context for anyway.

- cdef4ed: Organizations reach the SDK.

  `@nodaro/shared` gains the RESPONSE half of the organization wire contract — `OrganizationView`, `OrgMemberView`, `WorkspaceView`, `WorkspaceMemberView`, `InvitationView`, `InvitationDelivery`, `InvitationPreview`, `JoinCodeView`, `OrgAuditEntry`, `OrgPage<T>`, and the `OrganizationSummary` / `WorkspaceSummary` / `MeOrganizations` shapes `GET /v1/me` carries. Contract only: no resolution logic, no access rules, no vocabulary.

  `@nodaro/sdk` gains `client.organizations` and `client.workspaces` covering organizations, members, workspaces, invitations, join codes and the audit log, plus `createClient({ workspaceId })` and `client.withWorkspace(id)` — which returns a NEW client rather than mutating a shared one, so two concurrent operations cannot race over which workspace they are in. `client.me()` is now typed to carry the organizations block, keeping its three states distinct: the fields absent (this instance has no organizations), present and empty (you belong to none), and `organizationsUnavailable` (the lookup failed — keep the selection you had).

  The workspace header decides SCOPE, never ACCESS: it selects which workspace a list reads from and where a create lands, and cannot widen access or move a charge.

- 62bb3dd: Add `SUNO_TRACK_SOURCE_TYPES` — the node types whose output carries Suno chaining ids (`sunoTrackId` / `sunoTaskId`), shared by the canvas resolver, the orchestrator resolver and the editor's "Inherited" hint.
- f14fa42: Add `workflow-copilot` to the `LlmFeature` union and its default model, so the in-app Workflow Copilot's turns resolve a model and a credit identifier the same way every other LLM feature does.

## 2.9.0

### Minor Changes

- c7fde04: Organizations wire contract: role / kind / status enums, settings request schemas, error codes.
- b49a7ff: Slideshow: `client.media.slideshow({ imageUrls, audioUrl?, imageDurations?, ... })` and `nodaro media slideshow` — 2–100 images + one optional audio track → MP4 via `POST /v1/slideshow`, locally rendered (FFmpeg), zero credits. Audio-anchored timing (equal split / pinned rows with disclosed proportional scaling); silent output without audio. Shared adds `PICKER_TO_COMBINE_TRANSITION` + `resolveSlideshowTransition` (transition-picker → xfade vocabulary mapping).
- 3488681: The surround fill-prompt builder moves out of this package. `SURROUND_DIRECTIONS`, the carried-fraction defaults, `isTiltDirection`, and `defaultCarriedFraction` are unchanged; `buildSurroundFillPrompt` is no longer exported (it was never part of the SDK surface).
- 9df6f33: Workflow bundles now carry a `portability` note when they reference media another instance cannot fetch (a private host's own storage), and `workflows.import()` returns an `importReport` describing which media was copied onto the importing instance, which was unreachable, and which was skipped.

### Patch Changes

- ff52285: Comment tidy-up in the featured-entity catalog and style presets.
- d964b4d: grok-2 reference-image support: attaching a reference auto-routes to the new `grok-2-i2i` chain (segment-map mints a task id from the reference URL, image-edit consumes it) — `T2I_TO_I2I_VARIANT`, `MODELS_WITH_REFERENCE_IMAGE_SUPPORT`, `REF_IMAGE_MAX_LIMITS` (single reference), and a `grok-2-i2i` catalog entry.
- d1ad395: Organizations wire contract: add the error codes the organization, workspace, membership, invitation and join-code endpoints return (`terms_required`, `not_org_member`, `already_a_member`, `owner_cannot_leave`, `has_active_workspaces`, `invitation_not_found`, `invitation_accepted`, `bulk_invite_cap_exceeded`).
- 4282945: Add the workspace request-header constant (`WORKSPACE_HEADER`, plus its lower-case form for server-side header lookups) to the organizations wire contract.
- 776e7f5: Comment tidy-up in credit constants and estimators.
- 6b8cfab: Suno's non-custom prompt cap is 3000, not 500. `getMaxSunoPromptChars(model, false)` returned 500 — six times under the provider's documented limit — and the suno route truncates rather than rejects, so a 950-character score brief reached Suno cut to exactly 500 characters mid-word, with nothing in the job record to show it.
- 823b629: Comment tidy-up in the video-analysis pricing table.

## 2.8.0

### Minor Changes

- 5fa889d: **@nodaro/shared**

  - LLM catalog gains `gemini-3.7-flash` (KIE `gemini-3-7-flash-openai` chat-completions + direct `gemini-3.7-flash`; economy tier; reasoning low|high on KIE, full ladder direct; 8192 output cap at the KIE-safe intersection). Not yet offered as a video-analysis picker tier — registered for internal model routing (the smart-family A/B lever).

- 6a06b17: Add the `grok-4.6` LLM (KIE responses dialect on the grok family path, vendor `xai`, standard tier, vision + structured output + reasoning efforts low–xhigh, live-verified 2026-08-18) and the vendor-grouping helpers every LLM model menu now renders from: `LLM_VENDOR_ORDER`, `LLM_VENDOR_LABELS`, `groupLlmModelsByVendor`, `orderedLlmModels`, plus the `LlmVendor`/`LlmModelGroup` types.

### Patch Changes

- db9274a: gemini-3.7-flash: explicit image-only modality caps. Video/audio are deliberately withheld (full caps would auto-enroll the model in `VIDEO_ANALYSIS_LLM_MODELS` and force a video-analysis tier/pricing decision that is deferred while the smart-family A/B routes it internally), so the Generate Text reference gate now reads a stated capability instead of the unknown-model fallback. Guarded by a registry test.

## 2.7.0

### Minor Changes

- 01a9716: **@nodaro/shared**

  - Video analysis scenes gain two optional CHRONICLE TIME fields (window and merged layers alike, both enum-validated and congruence-safe for the window decode grammar): `timeOfDay` (`dawn|day|dusk|night|ambiguous`) and `storyJump` (`continuous|same-day|another-day|years-later|unclear`) — the story clock as data, so continuity/variations/keyframes consumers can judge "same look or different" by narrative time first, location second. New exports `VIDEO_ANALYSIS_TIMES_OF_DAY`, `VIDEO_ANALYSIS_STORY_JUMPS`. Absent on every pre-2.6.0 analysis by design.
  - New `inferMusicVideo(analysis)` — deterministic, throw-proof music-video inference over an analysis' scenes (≥4 scenes, ≥80% carrying a music layer, at least one non-negated sung-vocal evidence). Shared because the recast server's `music.mode` derivation and the client's prep pricing + generate-time mode guard must agree byte-for-byte; callers use `flag === true || inferMusicVideo(analysis)`.

- 034ac61: **@nodaro/shared**

  - New Grok Imagine Image 2.0 model ids in `MODEL_CATALOG` and the provider enums: `grok-2` (t2i, in `IMAGE_GEN_PROVIDERS`), `grok-2-edit` and `grok-2-segment` (in `IMAGE_EDIT_PROVIDERS`). The edit and segment ops reference a prior grok-2 generation's KIE task id (the generation job's `kieTaskId` output) instead of an image URL; `grok-2-edit` optionally takes 1-based segment `maskIndexes` for region-targeted edits, and `grok-2-segment` is free.
  - New export `TASK_CHAINED_EDIT_PROVIDERS` — the set of edit providers that take a prior Grok task id instead of an image URL (`grok-upscale`, `grok-2-edit`, `grok-2-segment`); single source of truth for the route/worker/MCP taskId-vs-imageUrl branching.

  **@nodaro/prompts**

  - Prompt-wizard image capabilities gain a `grok-2` entry.

## 2.6.0

### Minor Changes

- 8221886: **@nodaro/shared**

  - `resolveEffectiveSourceType` now also remaps aggregate lane handles: a wire leaving `collect` / `group` on `out-image` / `out-video` / `out-audio` / `out-text` resolves to the plain producer of that lane's type (`upload-image` / `upload-video` / `upload-audio` / `list`), so lane pips connect to typed inputs exactly like the equivalent upload node. New export `AGGREGATE_LANE_SOURCE_TYPES`.
  - New `computeAggregateLanes(nodeId, wiredTypes, buckets, edges)` in the group-aggregation module — the lane set an aggregate node exposes (wired-input types ∪ bucket contents ∪ lanes referenced by outgoing edges).
  - Reduce strategy registry ("Choose Best"): labels/descriptions rewritten in plain language (`AI picks the best`, `Join into one text`, `First that has content`, `Count them`, `Most common answer`, `Merge JSON objects`); the `pick-best-llm` config schema gains optional `llmModel` (the judge model id from the LLM registry).
  - New `LlmFeature` `"pick-best-llm"` with an entry in `LLM_FEATURE_DEFAULTS`. Its credit identifiers tier by the judge model like every other LLM feature (`reduce:pick-best-llm[:economy|:premium]`).

  **@nodaro/sdk**

  - `client.reduce` docs: `pick-best-llm` accepts `strategyConfig.llmModel` (judge model; omitted = default; its tier sets the credit price).

- d36034c: **@nodaro/shared**

  - Seedance 2.5 (`seedance-2-5`) gains the **1080p** resolution tier (KIE "Seedance 2.5 now supports 1080P", probe-verified 2026-08-17 — 4k/2k/1440p are still rejected). `MODEL_CATALOG` `resolutions` is now `["480p", "720p", "1080p"]`, catalog pricing rows carry the 8s/30s 1080p anchors (2280/8550 no-ref, 1370 with-ref at 8s), and the `QUALITY_MAP` `high` rung maps to `1080p` (was `720p`). Everything derived from the catalog — credit identifier clamping, `/v1/nodes` `providerResolutions`, GVP/EVP tier clamps, resolution dropdowns — picks the new tier up automatically.

  **@nodaro/prompts**

  - Seedance 2.5 doctrine and wizard capability strings updated for the 1080p tier (routing advice now sends only 4K jobs to `seedance-2`).

### Patch Changes

- 3792fbb: **@nodaro/shared**

  - Reduce strategy registry: `ReduceStrategy` gains an optional `usesLlm` flag, set on `pick-best-llm` (the AI judge). Anything that treats "an LLM strategy" specially — such as a self-hosted install forwarding the judge to its nodaro.ai connection — reads this flag instead of matching on the strategy id, so a future LLM strategy is covered by declaring it.

## 2.5.0

### Minor Changes

- 5a48d4c: Add `flux-fill` (BFL FLUX Fill Pro via Replicate) to the image-to-image provider catalog and to `I2I_MASK_SUPPORT` — a second mask-capable inpainting provider alongside `ideogram-edit`. White = edit area, matching the painter / generate-mask polarity.

### Patch Changes

- 32664fe: Complete the `flux-fill` rollout: the provider is now actually listed in `IMAGE_I2I_PROVIDERS` (the paint-mask release declared it but the enum entry was missing, so route validation rejected the model and frontend type-check failed).

## 2.4.0

### Minor Changes

- bbea01b: New `effective-tier` module: `resolveStoredTier`, `resolveEffectiveTier` (a stored-free profile with net lifetime top-up credits derives the `payg` tier), `isPaygRetentionActive` + `PAYG_RETENTION_DAYS`. Pipeline tier maps gain `payg` keys.

## 2.3.0

### Minor Changes

- ee43530: Add `normalizeModelInput` / `normalizeNodeModelParams` — the correcting twin of the existing `validateModelInput`.

  Validation is the right answer when a caller is composing a single request and can retry, which is why the MCP verb tools use it. It is the wrong answer at a persistence or execution boundary: rejecting there turns a fixable parameter into a failed workflow run, and an aborted run takes every already-generated, already-billed sibling node down with it.

  `normalizeModelInput(modelId, input)` coerces `aspectRatio` / `resolution` / `quality` / `duration` into a combination the model actually accepts and reports every correction in an `adjustments` array so callers can disclose what changed instead of silently substituting. The rules mirror the editor's provider-change snap: a lever the model doesn't expose is dropped, an out-of-range value snaps to the model's default (`defaultResolutionFor`, also newly exported) or its first valid option, and model-specific cross-field constraints are applied last. Equivalent spellings of the same setting canonicalize rather than snap — Flux 2 stores a bare megapixel count (`"1"`) against the catalog's display form (`"1 MP"`), and treating that as invalid would move a correctly-configured node to a different pricing tier.

  `normalizeNodeModelParams(nodes)` applies the same rules across a React Flow graph, immutably: untouched nodes come back by reference so a delta/CAS save sees no spurious change. Multi-provider nodes are skipped deliberately — the valid set there is an intersection with no single defensible replacement.

  Both derive entirely from `MODEL_CATALOG`, so declaring `aspectRatios` / `resolutions` / `qualities` honestly on a new model entry is all that is needed for it to be covered. A catalog-wide invariant test pins that normalizer output always satisfies `validateModelInput`.

## 2.2.1

### Patch Changes

- 34b3b31: Rename the minimax-h3 display label from "Hailuo 3 (H3)" to "minimax-h3" (label-only; id unchanged).

## 2.2.0

### Minor Changes

- fae3b40: New `GVP_ANCHOR_CHOICES` + `resolveGvpAnchorWire` (with the `GvpAnchorChoice` / `GvpAnchorWireMode` types) — the Generate Video Pro keyframes anchor lever. Translates the node's product vocabulary (`auto` / `start-end` / `start-only` / `reference`) into the engine's chain mode (`upfront` / `progressive` / `none`), with `auto` and any unknown value resolving to `undefined` so the field stays off the wire and the engine default stays in charge. One resolver shared by every send path, so callers cannot disagree about which mode a run requested.
- 3a71fc5: GVP_SUPPORTED_PROVIDERS gains `minimax-h3` — the Generate Video Pro engine's first non-Seedance SKU (full transport analog: shared Seedance-2 input resolver, 9/3/3 reference caps, per-second 4–15s durations, native audio, fixed 2K output).
- 89ea2c0: Generate Video Pro provider selection is now DERIVED from catalog capability instead of a hand-kept list: `GVP_SUPPORTED_PROVIDERS` is every catalogued video model that does `i2v`, carries the `reference-image` feature, declares segment durations, and has a working dispatch path — 10 SKUs, up from 3.

  New exports:

  - `GVP_EXTEND_PROVIDERS` / `supportsExtendRender()` — the subset whose transport supports the `extend` render method (a continuation tail sent as a reference video), derived from a new `"video-reference"` catalog feature. Resolves to exactly the family the previous hardcoded gate admitted, so the swap is behaviour-neutral.
  - `GVP_END_FRAME_PROVIDERS` / `supportsEndAnchor()` — derived from the `"end-frame"` feature; the keyframes engine's end-anchor gate, replacing a provider-family name check that omitted `minimax-h3`.
  - `segmentDurationsFor()`, `minSegmentSecFor()`, `maxSegmentSecFor()`, `hasContiguousSegmentDurations()`, `maxSegmentsFor()` — catalog readers for per-provider segment bounds, replacing the hardcoded `{minSeg: 4, maxSeg: 15}` that was only ever correct for the Seedance 2 family.
  - `VIDEO_PROVIDERS_WITHOUT_DISPATCH` — catalogued, priced models with no working dispatch path (`kling-3-omni`). Capability alone is not sufficient to offer a model; this keeps a model that passes every capability check from being advertised when it would fail at the router.
  - `GVP_DEFAULT_PROVIDER` — the SKU stale selections snap back to.

  `MODEL_CATALOG` gains the `"video-reference"` feature on the Seedance 2 family and `minimax-h3`.

- e264214: A wired location reference now defaults to the role `location`, not `background`.

  `DEFAULT_LABEL_BY_SOURCE["wired-location"]` was `"background"`, which `roleToPhrase` renders as `"the background from reference image B"`. Image models read that phrasing as _paste this behind the subject_, so a character + location pair came back as a composite rather than a photograph — an indoor-lit subject over the location, with no shared light and no ground contact.

  Measured on gpt-image-2 (2K, 16:9, one character + one location, 4 draws per arm, only the role word varying): with `background` all four draws were cut-outs — no cast shadow at the subject's feet and the action the prompt asked for ignored. With `location` the subject rendered inside the scene, full-length, with ground contact, a cast shadow, and one sun lighting subject and location alike.

  `"location"` is added to `REFERENCE_ROLE_PRESETS["wired-location"]` (second, mirroring `wired-character`'s `ref-only`/`person` order). `"background"` remains a curated pick for the genuine backdrop case — it is simply no longer what every location silently gets.

  Existing references are unaffected: `resolveDefaultRole` prefers an explicitly stored role, so only new or defaulted references change. `normalizeRoleSlug` is data-driven from the preset list, so the new role needs no extra wiring.

- d086c0f: MiniMax Hailuo 3 (`minimax-h3`) gains KIE's new resolution lever: `768P | 2K` (default 2K) on all three endpoints (text/image/reference-to-video).

  `@nodaro/shared`: the catalog entry declares `resolutions: ["2K", "768P"]` (first entry = UI default; uppercase = the exact KIE wire enum) and its `VIDEO_VARIABLE_PRICING` axis becomes `duration+resolution`. New exports: `MINIMAX_H3_DEFAULT_RESOLUTION` and `normalizeMinimaxH3Resolution` — the single collapse rule shared by billing and provider forwarding (only a case-insensitive `768p` selects the cheaper tier; anything else renders AND bills as 2K, matching KIE's omitted-param behavior). `buildVideoCreditModelIdentifier` appends `:768p` for a verified 768P selection; bare duration composites stay the 2K rate, byte-identical to the pre-lever identifiers, so existing workflows and admin price overrides keep their ids. KIE rates: 36.5 cr/s @2K (unchanged), 22.5 cr/s @768P; reference-video input seconds bill at the selected tier's rate.

  `@nodaro/prompts`: doctrine tip and prompt-wizard capability lines updated from "fixed 2K" to the two-tier output.

- 7162e62: Add MiniMax Hailuo 3 (`minimax-h3`) — a Seedance-2-class multimodal video model.

  `@nodaro/shared`: `minimax-h3` joins the model catalog and every video provider registry (t2v + i2v arrays, reference limits 9 images / 3 videos / 3 audio, always-on `audio_driven` capability, adaptive default aspect, per-second duration tiers 4–15s, the reference-audio lip-sync surface, and the 7000-char prompt cap). New exports: `MINIMAX_H3_PROVIDERS`, `isMinimaxH3Provider`, and `PRICING_DEFAULT_DURATION_SEC` (prices a duration-less request at the model's own default duration — 6s for minimax-h3 — instead of the global 5s fallback, which `buildVideoCreditModelIdentifier` now consults). The model has a FIXED 2K output: no `resolutions` entry, and its credit identifier is duration-only (`minimax-h3:8s`) with no resolution or `-ref` dimension.

  `@nodaro/prompts`: new provider prompt doctrine for `minimax-h3` (modes, ordinal reference conventions, always-on audio, per-second pricing guidance) and prompt-wizard capability lines for text-to-video and image-to-video. The existing `resolveSeedance2Inputs` resolver is reused by the new provider unchanged — same caps, same frames-fold-into-references semantics.

- 49f1aa4: Add `seedance-2-5` (Seedance 2.5) as a video model alongside the Seedance 2.0 family — text-to-video, image-to-video, first+last frame, multimodal references, and the reference-audio lip-sync surface.

  It joins `SEEDANCE_2_PROVIDERS`, so it inherits the family's capability gating (adaptive aspect, the shared input resolver, per-second `resolution × video-ref` pricing) and derives into `GVP_SUPPORTED_PROVIDERS` / `GVP_EXTEND_PROVIDERS` / `GVP_END_FRAME_PROVIDERS` and the Edit Video Pro subset automatically.

  Where 2.5 differs from the 2.0 SKUs, the difference is carried by per-provider data rather than by branching on the family set:

  - **4–30s** in a single generation (2.0 caps at 15s), with one seeded price tier per second so no duration rounds up to a coarser rung.
  - **480p / 720p only** — no 1080p or 4K tier.
  - Reference caps of **30 images / 10 videos / 10 audio** (`SEEDANCE_2_5_REF_LIMITS`) vs the family's 9/3/3, and reference audio up to 30s per clip.
  - Prompt limit of 30000 chars, which raises `PROMPT_HARD_CEILING` from 20000 to 30000 so the route can't reject a prompt the model accepts.

  The resolution ceiling and duration ceiling were established by a live capability probe against KIE, not from the published schema: `1080p`/`4k`/`2k` are rejected identically to a nonsense value, and 31s+ is rejected, so ByteDance's native 4K and 180s ultra-long modes are not reachable through the KIE proxy.

  Two new mechanisms ship with it, both additive:

  - `PRICING_DEFAULT_RESOLUTION` — the resolution twin of `PRICING_DEFAULT_DURATION_SEC`. When a request omits `resolution`, the credit identifier now prices the model's real provider-side default instead of falling back to the cheapest tier. Only `seedance-2-5` is registered, so no existing model is repriced.
  - `FRAME_MODE_ADAPTIVE_ONLY_ASPECT` — models that accept only `adaptive` aspect once a start frame is wired. Seedance 2.5 hard-rejects any explicit ratio in frame mode (undocumented; probe-verified), so the payload builder coerces it. Lossless: with a start frame, `adaptive` is that frame's own aspect.

- 0cd2a29: Suno V5_5 custom duration + replace-section field additions.

  `@nodaro/prompts`: `AssembleSunoResult` gains an optional `duration` (seconds), passed through verbatim from `data.duration` — the provider client is the single send-gate (KIE honors it only when `customMode` is true and the model is `V5_5`), so the assembler stays a faithful field carrier for the FE run, the orchestrator, and the editor preview alike.

  `@nodaro/shared`: `NODE_MAPPABLE_FIELDS["suno-replace-section"]` gains `fullLyrics` (the complete post-edit lyric sheet the current KIE spec lists as required) and `negativeTags`, so both fields can be wired from upstream text producers.

- 5d66f2a: Add `video-audit` pricing for the new AI Audit node: `VIDEO_AUDIT_BUCKET_CREDITS` (both credit families — `video-audit` and `video-audit:auto`), the `buildVideoAuditCreditId` / `videoAuditCreditsForBucket` / `bucketSecondsFromAuditCreditId` helpers, and model-catalog rows (`AI Audit` / `AI Audit (with analysis run)`).
- 18d9cde: video-analysis bucket reprice — hybrid smart plan + measured judge/refine terms

  Every `VIDEO_ANALYSIS_BUCKET_CREDITS` row rises. `smart` is now a multi-roll plan that always refines its merged result (`selectionMode` no longer applies to it), and every multi-roll tier now carries its own explicit judge/refine terms instead of an implicit share of a single-pass budget. The economy tiers rise too (`fast` 33 -> 185 credits @180s).

- c19c3ad: Video-analysis mixed family reprice: `mixed`/`mixed-fast` now run the cross-scene continuity review (previously smart-only) and the bucket table rises a flat +40 credits per bucket (268/289/724/1169 @60/180/360/600s).

### Patch Changes

- 270545c: `isOversizedScene` no longer flags a scene that sits exactly on the 8s cap.

  Scene length is derived by subtracting two decimal timecodes, which does not land on the cap exactly — a real job produced a `12.67 → 20.67` scene whose computed length is `8.000000000000002`, so an in-spec scene was marked `oversized: true` and carried that defect marker into every downstream consumer (the merge layer sets it at `pipeline/merge.ts`, and the recast planner reads it).

  The comparison now allows a 1µs tolerance. That is orders of magnitude below any boundary precision the analyzer can resolve, so it cannot mask a genuinely oversized scene — the smallest real overshoot is still ~10000x larger than the tolerance.

## 2.1.1

### Patch Changes

- bff87d1: Correct the advertised Flux 2 Klein and Pro default-resolution prices in the model catalog.

  The catalog listed the bare `flux-2-klein` / `flux-2-pro` identifiers at prices that disagreed with the per-megapixel grid entries for the very same resolution sitting on the adjacent line — the bare default said one thing, `flux-2-klein:1MP:0ref` said another. The grid values are the ones that bill, and the seeded pricing rows agree with them, so the bare defaults were the outlier: they were rounded up at the old coarse credit scale and then carried along by the x10 re-denomination, which amplified the rounding error.

  Both now read the same value as their own grid entry, so the catalog no longer advertises a price no request can produce.

## 2.1.0

### Minor Changes

- 301eb50: Video-analysis pricing schedule re-derived. The `smart` tier's video sampling was re-based after a measurement campaign found equal analysis quality with more consistent casting at a much lower sampling cost — its per-bucket prices drop 27–47%. The remaining tiers move +3–6% from a re-measurement of fixed analysis overhead. Scene results now always carry a camera `angle`.

## 2.0.3

### Patch Changes

- b30ff85: Re-denominate the credit tables the ×10 migration missed

  `SCRAPER_CREDIT_COSTS` was left at the old credit base — every scraper SKU published a tenth of the real price. Values now come from `model_pricing`, and a backend guard (`shared-credit-table-sync.test.ts`) pins them equal to `STATIC_CREDIT_COSTS` so "must stay in sync" is a mechanism rather than a comment.

  `TIER_MAX_PIPELINE_COST_CREDITS` was likewise left behind. Because those caps are a share of the tier's grant and the grants moved ×10, the caps had silently tightened tenfold — a basic-tier pipeline would abort at 300 credits out of a 4,500-credit grant. The guard now pins the ratio, not the number.

- ca3ed3b: Stop restating credit prices in `MODEL_RECOMMENDATIONS` notes

  Two recommendation notes quoted a price ("Z-Image is the cheapest at 1 credit", "1 credit, no prompt needed") that the generated table directly beneath them already gives — so they were a second copy, and they rotted: both still said 1 credit after the values became 2 and 3. The notes now name the ranking, not the number.

## 2.0.2

### Patch Changes

- ffc89fe: Re-derive the video-analysis SENTINEL credit rows (`mixed:*`, `smart:*`)

  The credit re-denomination re-derived the 12 per-model buckets from the pricing formula but left the 8 sentinel buckets as a mechanical ×10, on the reasoning that sentinels sit outside the plugin's cross-check loop. Being outside the loop makes a row unguarded, not exempt — the same formula computes the sentinels, and a formula that rounds up to a whole credit does not commute with scaling.

  These rows were over-charging by 0.1%–5.8%:

  | id           | was  | now  |
  | ------------ | ---- | ---- |
  | `mixed:60s`  | 110  | 104  |
  | `mixed:180s` | 150  | 142  |
  | `mixed:360s` | 380  | 372  |
  | `mixed:600s` | 630  | 621  |
  | `smart:60s`  | 460  | 454  |
  | `smart:180s` | 980  | 975  |
  | `smart:360s` | 2110 | 2105 |
  | `smart:600s` | 3500 | 3496 |

  The bare `video-analysis` id (the unknown-model/unknown-duration ceiling) follows the table max: 3500 → 3496. `MODEL_CATALOG` and the published docs table are updated to match, and the plugin's cross-check now spans sentinels as well as models so this class of drift fails CI instead of shipping.

## 2.0.1

### Patch Changes

- 71c2984: fix: `VIDEO_ANALYSIS_BUCKET_CREDITS` re-derived at the current credit base rather than scaled.

  The generating formula ceils USD into credits, so a finer base rounds less — the 60s `gemini-3-flash` bucket is 23, where a mechanical ×10 of the previous 3 would have given 30. Every formula-covered bucket moves the same way. Values now come from the generator itself, which a CI cross-check pins.

## 2.0.0

### Major Changes

- fec478a: **BREAKING: `CREDIT_BASE_USD` changes from `0.02` to `0.002`.**

  One credit is now worth a tenth of its previous dollar value, so every credit quantity in the platform is ten times larger for the same dollar value. Balances, grants and historical records were migrated ×10 in the same release; nothing changed in what anything costs in dollars.

  Anything that converts between credits and USD — or that hardcodes an assumption about a credit's worth — must be re-checked. Use `usdToCredits()` / `creditsToUsd()` rather than dividing by the constant yourself; they carry a rounding guard and will keep working across any future change.

  The motivation was rounding: at the old credit size, `ceil()` charged a 1-credit minimum even for very small work items. The finer unit makes small jobs round much closer to their computed cost.

### Minor Changes

- c6487c9: feat: `usdToCredits(usd)` / `creditsToUsd(credits)` — the single place credit⇄USD arithmetic is written, derived from the existing `CREDIT_BASE_USD`.

  Additive only; `CREDIT_BASE_USD` itself is unchanged at `$0.02`, so no consumer behaviour moves. Both helpers carry a milli-credit intermediate rounding guard: a bare `Math.ceil(usd / base)` over-charges a full credit whenever IEEE-754 division lands just above an integer (`0.14 / 0.02 = 7.000000000000001`).

  Prefer these over dividing by the constant yourself — the conversion then stays correct and defined in one place.

## 1.24.1

### Patch Changes

- 393016e: Video analysis: the `smart` tier now runs a continuity review over the finished shot list

  Every analyzer pass reads one window and describes each shot in isolation, which it does well. Nothing in the pipeline has ever compared shot 4 with shot 11 — so a shot list could be locally correct and globally impossible. That is the failure class behind the reports of characters stepping onto an airless surface without helmets and wearing them in the next shot, props appearing from nowhere, a character asleep then awake then asleep, and dialogue attributed to whichever character was named most recently.

  `smart` now adds one reasoning pass over the finished list that emits targeted corrections — scene, field, new value, reason — rather than rewriting it. Corrections are constrained: only descriptive fields can change (never timings, never the scene count), a speaker reassignment must name a character that scene already references, and a rewritten shot description must keep every character reference it had. Every correction, applied or refused, is recorded in the result's `warnings`, so the output is never silently different from what the analyzer produced.

  It also consumes the cast-reference refusals added alongside it: when the vision pass looked at a character's own shots and saw somebody who does not match their description, the review is told so.

  `smart` rises by 4 credits per duration bucket (**46 / 98 / 211 / 350**). **No other tier changes.** The pass costs the same regardless of tier or video length, and on the economy tiers that flat cost exceeds the entire analysis it would check — charging for it there would have more than doubled them and defeated the reason they exist. It belongs on the tier chosen when the shot list will drive regeneration, where an impossible shot becomes an expensive wrong render rather than a note in a transcript.

  Failure posture is enrichment: any failure leaves the analysis exactly as the analyzer produced it.

## 1.24.0

### Minor Changes

- 320ea3c: Video analysis: a frame-sampling-rate lever, and cast diagnostics that reach the caller

  **Sampling rate is now expressible.** A video content block carries an optional
  `fps`, forwarded into the direct Google lane's per-part video metadata. Gemini
  samples at 1 frame per second by default and this is the only way to ask for
  more. Validated against Google's documented `(0, 24]` range before the clip is
  uploaded, rather than after. The proxied lane cannot represent a sampling rate at
  all, so it now throws on such a block instead of quietly analysing at the default
  — a silent downgrade there is indistinguishable from success.

  The rate stays at 1 for analysis, deliberately. Measured across three runs per
  rate on a reference clip: raising it produced more scenes but read fine on-screen
  detail _worse_, garbling the name tags on two characters' uniforms at 3 fps and
  swapping the two characters outright at 6 fps, where every run at 1 fps agreed.
  Scene count going up while scene accuracy went down is why the lever ships as a
  documented knob rather than a raised default. Source resolution and bitrate turn
  out not to affect the token bill at all — a 13× pixel-count range produced
  identical counts — so downscaling before analysis is worth doing for upload
  latency, never for cost.

  **Cast reference refusals are no longer discarded.** `EntitySlot` gains
  `refRejectedReason`, present only when the analyzer's vision pass actively
  refused every candidate reference frame. The case that matters reads like "the
  shots bound to this slot show someone else — cast as X, but on screen: Y": the
  analyzer telling you a character's description and their own footage disagree.
  That finding previously existed only inside a worker log line, indistinguishable
  from five benign reasons a slot has no reference, even though it is the strongest
  available signal that a character has been misidentified — and a wrong identity
  propagates into every regenerated shot.

  **Analysis results can carry diagnostics.** `VideoAnalysisResult` gains an
  optional `warnings` array. There was previously no channel for these at all: the
  merge layer has always produced warnings and the cast pass has always had
  findings, and all of them died in worker logs the caller cannot see. A run that
  dropped a duplicated line, folded a cast look, or concluded a character is not
  who their description names looked identical to a clean one.

  All three fields are additive and optional; existing producers and consumers are
  unaffected.

- 320ea3c: Video analysis: new `smart` tier, and the existing tiers get much cheaper

  The analysis tiers now split across two serving transports, which turns a single
  quality/price compromise into an actual choice.

  **The existing tiers move to the cheaper transport and the cheaper model
  generation.** That transport bills 3–4× less per token and additionally performs no
  deep reasoning, so its passes emit roughly a quarter of the output tokens — the two
  together drop these tiers by 10–18×. They are also less accurate, which is the
  trade being made deliberately: several cheap passes with a grader picking between
  them, rather than one expensive good one. Because roughly a third of calls on that
  transport come back unusable, the multi-pass structure is what makes them reliable
  rather than an extravagance.

  **`smart` is new** — a single pass on the native transport with reasoning and frame
  sampling turned all the way up. It is the only tier whose accuracy was measured
  against a hand-counted edit list, and the only one that does not depend on voting
  to be usable. On a reference clip with 18 real shots it reported 16–17 scenes with
  **every** scene start landing on a real cut, with no boundary list supplied, and
  identified the cast by appearance in every run. Validated across three clips
  totalling 138 seconds, two of them at roughly one cut per second.

  | tier                   | ≤60s | ≤180s | ≤360s | ≤600s |
  | ---------------------- | ---- | ----- | ----- | ----- |
  | `fast`                 | 3    | 4     | 9     | 14    |
  | `pro`                  | 9    | 12    | 30    | 49    |
  | `mixed` / `mixed-fast` | 11   | 15    | 38    | 63    |
  | `smart`                | 42   | 94    | 207   | 346   |

  **The measured shot-boundary detector is no longer used by any tier.** It was
  over-reporting by 60% on real footage — 29 shots against a hand-counted 18 —
  because it read periodic motion as edits: the clip is two figures bounding across a
  surface at about one stride per 0.8 s and every footfall registered as a cut. Its
  boundaries had a spacing coefficient of variation of 0.06 against 0.85 for the real
  edits, a metronome rather than an edit list. That was not cosmetic: told 29 shots
  existed when 18 did, a pass exhausted its whole output budget describing shots that
  are not there, returned unparseable output, and cost roughly four times normal
  before retrying. Removing it is a quality fix for every tier.

  **Cast identity now comes from appearance, never from on-screen text.** Reading
  name badges off uniforms was the source of a field defect where a character shipped
  under a misread name. Across ten configurations exactly one read both badges
  correctly; describing the same people by appearance was correct in all ten.

  Also: `EntitySlot.refRejectedReason` and `VideoAnalysisResult.warnings` are new and
  optional. The vision pass that picks a cast reference frame can refuse every
  candidate because the people on screen do not match the casting description — the
  strongest available signal that a character has been misidentified, which
  previously existed only inside a worker log.

## 1.23.0

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

- 56d91a3: Reprice video-analysis. New per-bucket credits (≤60s · ≤180s · ≤360s · ≤600s):

  - `gemini-3-flash` — 21·24·68·112
  - `gemini-3.6-flash` (`fast`) — 54·63·175·291
  - `gemini-3.1-pro` (`pro`) — 84·96·269·448
  - `mixed` / `mixed-fast` — 137·158·443·739

## 1.22.0

### Minor Changes

- 8c2bb72: LLM model registry can now declare a direct Google Gemini serving lane.

  `LlmModelDef` gains two optional fields, so which upstream serves a Gemini
  model is registry data rather than a decision baked into the client:

  - `directGeminiModel` — the model's id on Google's own API. Stated, never
    derived: Google carries `-preview` suffixes on unreleased models, so the id
    routinely differs from both `id` and `kieSlugOrModel` (`gemini-3.1-pro` →
    `gemini-3.1-pro-preview`).
  - `preferDirect` — try the direct lane first, with KIE as the fallback. Absent
    (while `directGeminiModel` is set) means KIE first and direct only on
    failure. Mutually exclusive with `preferKie`.

  Lane choice is a cost decision, not just a routing one: the two lanes bill the
  same model at materially different unit rates. `gemini-3.1-pro` is declared
  direct-first (premium tier, lowest call volume); `gemini-3-flash` and
  `gemini-3.6-flash` stay KIE-first with direct as a reliability backstop,
  because `gemini-3.6-flash` backs five feature defaults plus the
  video-analysis fast tier and so carries the highest volume.

  `getLlmModel` also resolves a model by its direct Google id, so cost and usage
  reconciliation can look models up by whichever id appeared on the wire.

  Both fields are optional and unset on every non-Google model, so existing
  consumers are unaffected.

- 96b3c84: Video-analysis captures camera angle, time manipulation, on-screen text, and the clip-level look.

  Four gaps in the scene contract, all of them things a recreation needs and could
  not read:

  - **`angle`** (per scene, optional enum) — the camera VIEWPOINT axis, which
    nothing carried. Vertical placement and roll (`eye-level`, `low`, `high`,
    `overhead`, `worms-eye`, `dutch`) plus the relational viewpoints
    (`over-the-shoulder`, `pov`, `profile`, `from-behind`). Two failures it fixes:
    a true angle had nowhere to live and was improvised into the MOVEMENT field
    (`"camera": "low angle static"` shipped on a real job, hiding the angle from
    anything reading `camera`); and the relational viewpoints were conventions
    inside the `shotType` SIZE list, competing for one slot, so an
    over-the-shoulder _medium_ had to discard one of the two. Now both are
    statable: `shotType: "Medium"` + `angle: "over-the-shoulder"`. A closed enum
    precisely because improvisation is the failure being fixed; absent means
    eye-level. `VIDEO_ANALYSIS_FACELESS_ANGLES` marks the viewpoints where no face
    is visible, which auto-cast reads before choosing an identity reference.

  - **`speed`** (per scene, optional enum) — `slow-motion` / `ramp-in` /
    `ramp-out` / `timelapse` / `freeze` / `reverse`. Previously unrepresentable
    anywhere, so a recreation rendered every shot at normal speed regardless of what
    the footage did. There is deliberately no `normal` member: absence is normal, so
    the field costs nothing on the majority of shots.

  - **`onScreenText`** (per scene, optional) — titles, captions, lower-thirds and
    subtitles burned into the picture, verbatim. Doctrine already asked for these
    inside `visual` prose, but a recreation needs to know discretely whether to
    render text, and `translateOnScreenTextToEnglish` had no structured field to
    land in.

  - **`look`** (clip-level, optional) — `style`, `grade`, `format`, `lens`,
    `lighting`, `genre`, `influence`. These belong to the whole piece, and as prose-per-scene a 40-scene
    analysis re-decided the grade forty independent times with nothing holding the
    answers consistent. Stated once, applied everywhere — the drift problem entity
    slots already solve for people. A sibling of `meta` rather than a member,
    because `meta` is measured fact and this is the model's reading of the
    photography. `mergeClipLook` folds each window's reading field-by-field.

    `look.influence` closes the one gap an audit against the product's own Look /
    Camera pickers turned up: everything else there already had a home (setting →
    location slots, color-look → grade, lens/camera-format → lens/format,
    camera-motion → camera, transition → transitionOut, mood → mandated in
    `visual`), but the Photographer / Artist picker — whose catalog ships
    `in the style of …` prompt hints — had no analysis counterpart. It is the
    highest-leverage field of the set, since a couple of words carry an aesthetic
    that would take a paragraph of grade and lighting prose to approximate.

    `look.style` is the rendering MEDIUM — live-action / anime / claymation / 3D /
    oil painting. The Style picker's own catalog defines this axis and states its
    independence from lighting, colour-look, atmosphere and lens, and it is the
    most consequential field of the object: two shots with identical grade, lens,
    lighting and framing look nothing alike when one is live action and the other
    a painting, and no correct grade rescues a recreation rendered in the wrong
    medium. It was the last clip-level axis with no home.

  - **`effects`** (per scene, optional enum array) — `blur`, `pixelate`, `glitch`,
    `grain`, `vignette`, `flash`, `distortion`, `double-exposure`. An array because
    a shot can be grainy AND vignetted. Scoped deliberately to things done to the
    IMAGE and NOT to compositing that asserts what is in the shot
    (picture-in-picture, split screen): a real job invented
    `{slot:creator} overlay talking to camera` across nine scenes for a man who is
    never seen, so a field for "there is an inset of a person here" would hand that
    fabrication a legitimate home. An effect is verifiable in the pixels; a claim
    about who is inset is not.

  - **`transitionOut` gains `dissolve`.** A cross-fade between two images and a fade
    through black look nothing alike, and collapsing both onto `fade` made a
    recreation render the wrong edit. Additive — every previously valid value still
    validates.

  All of these are optional and additive: an older producer still validates, and a
  consumer that ignores them is unaffected. Credit prices are unchanged.

- 8583134: Video-analysis credit schedule re-derived for the direct provider lane.

  The node is now pinned to the model provider's own API with no fallback, which
  is what lets it send real media rather than a link. Its credit schedule is
  re-derived for that lane with the same structural formula.

  Per-bucket credits (≤60s · ≤180s · ≤360s · ≤600s):

  - `fast` — 5·6·15·25 → 14·19·49·81
  - `pro` — 6·8·20·33 → 21·27·72·120
  - `mixed` / `mixed-fast` — 10·13·35·57 → 34·46·120·200

  Consumers read this table for cost previews and credit reservation, so
  displayed and charged costs both rise. On cloud the charged price comes from
  the `model_pricing` table, which migration 276 updates to match.

  Also adds a guard test cross-checking the model catalog's hand-copied pricing
  rows against this table — they could previously drift silently, and the catalog
  is what a user sees before running anything.

## 1.21.0

### Minor Changes

- 09edb96: Video-analysis speech layers can name the on-screen speaker.

  `AudioLayer` gains an optional `speakerSlot` — the `slotId` of the character
  saying the words. `voice` already carried a casting note ("male, proud
  triumphant shouting") but nothing said whose voice it was, so a recreation had to
  guess. Usually one person speaks per scene and the guess is right, which is
  exactly why the scenes with two speakers across one cut failed silently.

  Additive and optional: consumers that ignore it are unaffected, and it is absent
  whenever the analyzer cannot attribute a line — including two cases where it is
  deliberately never set. An unseen narrator is never a slot (a slot is something
  you see), so its casting stays in `voice`; a visible one-off speaker has no slot
  to reference.

  Two sanitizers ship with it, mirroring the existing binding pair:
  `rewriteSpeakerSlots` follows attribution through cross-window slot unification
  (the counterpart to `rewriteSceneBindings`), and `dropUnknownSpeakers` strips
  attribution naming a slot that no longer exists or riding a `music`/`sfx` layer
  (the counterpart to `dropUnknownBindings`). Attribution deliberately does NOT
  count as a slot reference for the orphan sweep — a slot reachable only as a
  speaker is a voice with no body, the phantom-narrator defect that sweep exists to
  kill.

## 1.20.0

### Minor Changes

- 1576569: Video-analysis credit schedule now reflects the real best-of-N roll plan.

  `VIDEO_ANALYSIS_BUCKET_CREDITS` was generated from a formula that modelled ONE
  provider call per window, while the engine has run several independent passes per
  window for many releases and kept the best. Every pass beyond the first was
  therefore missing from the published prices, and the `mixed` rows had no formula
  behind them at all. The generator now prices the same roll plan the engine
  dispatches, so the table is derived end-to-end and a plan change moves the price
  with it.

  Per-bucket credits (≤60s · ≤180s · ≤360s · ≤600s):

  - `gemini-3-flash` — 1·1·2·3 → 2·3·6·9
  - `gemini-3.6-flash` — 2·2·5·9 → 5·6·15·25
  - `gemini-3.1-pro` — 2·3·7·11 → 6·8·20·33
  - `mixed` / `mixed-fast` — 3·4·9·14 → 10·13·35·57

  No pricing constants changed; the difference is compute that was always being
  spent. Consumers read this table for cost previews and credit reservation, so
  displayed and charged costs both rise accordingly.

## 1.19.0

### Minor Changes

- 9e92137: New `smart-cut-windows` module: `clampSmartCutWindow()` plus the `SMART_CUT_WINDOW_MIN` / `_MAX` / `_DEFAULT` bounds for generate-video-pro's best-pair search windows. The canvas Run path and the workflow orchestrator are two independent senders into the same engine route, so both narrow the node's `smartCutFramesPrev` / `smartCutFramesNext` through this one function — a stale or hand-edited node value degrades to a legal request instead of failing a multi-segment run at finalize time, and the two paths cannot drift apart.
- 4938964: LLM registry: new `thinkingDefaultOn` capability flag on `LlmModelDef`, set on `claude-opus-5`. It marks a model that reasons even when NO `thinking` parameter is sent, so its reasoning tokens share the `max_tokens` budget on **every** call rather than only effort-bearing ones (Claude Opus 5 flipped this vendor default; Opus 4.8/4.7 and Sonnet 5 still mean "no thinking" when the param is omitted). Consumers floor their output cap on the flag instead of on the requested effort level, which is what keeps Effort=Auto calls from truncating. Also: `claude-opus-4.7`'s description no longer claims "Highest quality, complex tasks" — that superlative rendered in every model picker and steered quality-critical work to the oldest of three Opus entries.

## 1.18.0

### Minor Changes

- 66630ab: LLM registry: add **Claude Opus 5** (`claude-opus-5`, KIE messages endpoint, premium tier, full reasoning ladder `low`–`max`, temperature-less, preferKie with direct-Anthropic fallback). It joins every registry-derived surface automatically (model pickers, route Zod enums, `STRUCTURED_VISION_MODELS`, modality caps). Behind-the-scenes older-Opus defaults move to it: `LLM_FEATURE_DEFAULTS["describe-to-picker"]` is now `claude-opus-5` (was `claude-opus-4.7`), and `PIPELINE_PINNABLE_SCRIPT_LLMS` gains `claude-opus-5` as a pinnable film-pipeline script model.

## 1.17.0

### Minor Changes

- d75e8dd: Add optional `videoName` to `NodaroLoadVideoPayload` — display/file name for the primary clip in the FreeCut `NODARO_LOAD_VIDEO` load payload (e.g. "Shot 1.mp4"). Absent keeps the current URL-derived naming, so existing senders are unaffected. Lets Studio's whole-production "Edit in FreeCut" name the primary clip the same way `additionalFiles` entries already carry names for clips 2..N.

### Patch Changes

- 7b7101a: Default the qa-check feature to Gemini 3.6 Flash (`LLM_FEATURE_DEFAULTS["qa-check"]`), replacing Claude Sonnet 4.6. Explicit `llmModel` selections are unaffected; the default now bills the economy tier id `qa-check:economy` (still 1 credit).

## 1.16.0

### Minor Changes

- ee8061e: LLM registry: add **Gemini 3.6 Flash** (`gemini-3.6-flash`, KIE OpenAI-compat endpoint `gemini-3-6-flash-openai`, economy tier, image+video+audio, `low`/`high` reasoning levels) and **Claude Fable 5** (`claude-fable-5`, KIE messages endpoint, premium tier, full reasoning ladder, temperature-less). Feature defaults for `llm-chat`, `prompt-helper`, `generate-script`, and `translate` move to `gemini-3.6-flash`. Video-analysis `fast` tier is now backed by `gemini-3.6-flash` (bucket credits 2/2/5/9); `gemini-3-flash` becomes an explicit legacy model (`VIDEO_ANALYSIS_LEGACY_MODELS`, new export) so stored raw-model configs keep resolving and pricing unchanged.

## 1.15.0

### Minor Changes

- 936b9d4: video-analysis: `variationFolds` on `videoAnalysisResultSchema` — the analyzer's cap-fold record (`{slotId, variationId, label}[]`, optional). Folds were already persisted on the raw analysis (outside the schema); adding the field makes them survive strip-mode parses, so validated views (the recast client's blueprint) can render the "folded into default look" note the cast-variations spec (§6) requires as the user's pre-pay defense.

## 1.14.0

### Minor Changes

- 606997d: New `GVP_SUPPORTED_PROVIDERS` + `isGvpSupportedProvider` — the Generate/Edit Video Pro support subset (`seedance-2`, `seedance-2-fast`). Deliberately distinct from the `SEEDANCE_2_PROVIDERS` capability family (mini keeps its capability gating everywhere else); the pro nodes' selection UIs, node definitions, and generated skill docs all derive from this list.
- 0dedf9b: video-analysis: per-slot appearance variations + scene bindings (cast-variations spec stage 1) — `slotVariationSchema` (non-default looks only, reserved `"default"` rejected, `refImageUrl` carried from day one), `entitySlotSchema.variations` capped at `VIDEO_ANALYSIS_MAX_VARIATIONS`, `windowSceneBase.slotVariations` (out-of-band scene→look bindings inherited by both the window layer and `analyzedSceneSchema`), the closed variation slug vocabulary (`VIDEO_ANALYSIS_VARIATION_SLUGS`), and the merge-side binding helpers `rewriteSceneBindings` / `dropUnknownBindings`.
- 774a2d1: Video-analysis entity slots gain an optional `refImageUrl` — a hosted reference frame from the analyzed footage where the entity is clearly visible. Producers may omit it; consumers use it as an identity reference when recreating the video.

### Patch Changes

- 2f32c1b: Add `publish-social` to `SOCIAL_POST_NODE_TYPES` — the unified Publish-to-Social node's type, so shared-set-driven routing (carousel accumulation, caption, refMap gate) covers it in both the frontend DAG executor and the backend orchestrator.

## 1.13.1

### Patch Changes

- c7d3d25: Seven new styling catalog items closing out the first `/admin/picker-gaps` report batch: `outfit-sundress` (halter sundress / patterned maxi), `outfit-soccer-jersey` (national-team jersey with crest), `outfit-pharaoh` (ancient-Egyptian regalia — usekh collar, pectoral, shendyt kilt), `headwear-nemes` (striped pharaonic nemes with uraeus), `face-paint-flag` (national flag on cheeks, sports-fan), and `state-halter-neck` / `state-plunging-neck` (wardrobe-state neckline coverage). `@nodaro/shared` carries the matching label+description translations for all 11 locales. Items only — analyzer legends, prompt hints, and picker UIs derive from the catalog with no structural change.

## 1.13.0

### Minor Changes

- 02cc802: `getParameterPromptHint` gains a `style-guide` case (returns the node's `text`), so `{Style Guide}` refs resolve at execution time and prompt-handle wires inject the style text instead of leaving literal `{Style Guide}` in the outgoing prompt. New `HINT_EXEMPT_PARAMETER_TYPES` export in `@nodaro/shared` — the canonical set of parameter types that intentionally produce no prompt hint (`motion`, `scene-count`, `duration`, `aspect-ratio`); consumers that treat parameter nodes as text producers (e.g. `{Label}` auto-fill sets) should derive from `PARAMETER_NODE_TYPES` minus this set.

### Patch Changes

- dca72ad: `getLlmModel` now resolves dash-form model aliases (e.g. `claude-sonnet-4-6`) to their canonical dot-form ids (`claude-sonnet-4.6`), and accepts provider slugs as historical aliases. Fixes runtime `Unknown LLM model` for callers holding dash-form ids from wire contracts (`PIPELINE_PINNABLE_SCRIPT_LLMS`, persisted pipeline configs, plugin model pins).

## 1.12.0

### Minor Changes

- bc58993: Video-analysis mixed tiers: `VIDEO_ANALYSIS_MIXED_TIERS` (`mixed`, `mixed-fast` — advanced multi-engine analysis tiers), 4-tier `VIDEO_ANALYSIS_TIER_ORDER` + widened `VideoAnalysisTier` union (model-backed keys now `VideoAnalysisModelTier`), `isVideoAnalysisMixedTier`, sentinel-aware `resolveVideoAnalysisModel`, `videoAnalysisCreditSegment` (both mixed tiers price under one `video-analysis:mixed:*` family), mixed pricing ladder rows in `VIDEO_ANALYSIS_BUCKET_CREDITS` (3/4/9/14), and a `Video Analysis (Mixed)` model-catalog entry.

### Patch Changes

- 366e9ae: Video-analysis tier label wording: `Mixed` / `Mixed (consistent)`; catalog description and doc-comment cleanups for the mixed analysis tiers.

## 1.11.0

### Minor Changes

- 9993861: Kling native dialogue: `VIDEO_AUDIO_CAPABILITY` upgrades `kling` (2.6) and `kling-3.0` from `ambient` to `native_speech` (probe-verified on the KIE path: scripted quoted dialogue is spoken verbatim with lip sync behind the `sound` toggle) and adds a `kling-3-omni` entry (`native_speech`, `generateAudio` lever). New optional `VideoAudioCapability.defaultOn` flag mirrors each model's own audio default; `buildVideoCreditModelIdentifier` now falls back to it when `sound` is omitted, so intent-less kling-3.0 requests bill the `:audio` tier their generation actually produces (pass `sound: false` for the silent tier). `@nodaro/prompts` gains a Kling 2.6/3.0/Omni audio-prompting doctrine (dialogue labeling, voice/tone control, Audio block, element refs, limits).

## 1.10.0

### Minor Changes

- 1686b80: New `LLM_TEXT_INPUT_MAX` (100,000) — the input ceiling for LLM text-generation nodes (Generate Text / llm-chat, AI Writer, Generate Script). Their `systemPrompt` / `userInput` / `prompt` fields were capped at a flat 10,000 chars, which falsely blocked pasting a long document to summarize or rewrite; LLM contexts are far larger (Claude 200K / GPT 128K+ / Gemini 1M tokens), so the routes now accept up to 100K input chars (output stays bounded by each route's `maxTokens`).
- f23dd98: New `structuredOutputMode: "responses-json-schema"` — KIE's `codex/v1/responses` endpoint natively enforces `text.format` JSON schemas (live-verified 2026-07-14, text and vision inputs). Applied to `gpt-5.4`, `gpt-5.5`, and the GPT-5.6 family (`gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-5.6-sol`), which therefore now appear in `STRUCTURED_VISION_MODELS` (guaranteed-structured vision models, e.g. the describe-to-picker model gate).
- c971db1: Video-analysis robustness: quality tiers + layered audio.

  - **Quality tiers** — new `VIDEO_ANALYSIS_TIERS` (`fast`/`pro`), `resolveVideoAnalysisModel`, `VIDEO_ANALYSIS_TIER_LABELS/ORDER`, and `DEFAULT_VIDEO_ANALYSIS_*` (default `pro`). Users select a tier; the underlying model is never surfaced. `resolveVideoAnalysisModel` accepts a tier or a raw model id (back-compat) and falls back to the default.
  - **Layered audio (breaking shape change to `WindowAnalysis`/`VideoAnalysisResult`)** — a scene's `audio` is now an ARRAY of concurrent layers (`AudioLayer[]`) instead of a single `{mode,content,voice}` object, so simultaneous music + speech + sfx are all captured; an empty array means silence and the `silence` mode is removed. All in-repo consumers are updated; external consumers of `VideoAnalysisResult.audio` must read it as an array.

### Patch Changes

- 44cc24d: Seedance 2 continuation references are now 2 seconds — KIE rejects r2v reference videos shorter than 1.8s for the seedance-2 family ("video duration … must be greater than or equal to 1.8 … in r2v"), which made every 1-second continuation tail fail deterministically.

  - New exports: `SEEDANCE_2_CONTINUATION_REF_SEC` (2 — the reference length every Seedance-2 chaining feature cuts and bills) and `SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC` (1.8 — the verified provider floor).
  - `SEEDANCE_2_EXTEND_STITCH.referenceTailSeconds` is now `SEEDANCE_2_CONTINUATION_REF_SEC` (was 1).

## 1.9.0

### Minor Changes

- 774aa2d: Add reasoning-effort control and 6 new KIE LLM models (gpt-5.6-luna/terra/sol, gpt-5.5, claude-sonnet-5, claude-opus-4.8) end-to-end.

  - `@nodaro/shared`: new `LLM_REASONING_EFFORTS` (`none`/`low`/`medium`/`high`/`xhigh`/`max`) + `LlmReasoningEffort` type, `EFFORT_TIER_BUMP` set, and `effectiveReasoningEffort()` helper (clamps a requested effort down to the highest level the target model actually supports). `LLM_MODELS` gains 6 new entries plus per-model `reasoningEfforts`, `supportsTemperature`, and `preferKie` capability fields. `buildLlmCreditIdentifier()` / `resolveLlmCreditId()` take an optional `reasoningEffort` third argument — `xhigh`/`max` (after clamping) bill one credit tier up (economy→standard, standard→premium, premium stays premium); `high` is the Claude-family server default and never bumps.
  - `@nodaro/sdk`: prompt-helper wizard resources' `CommonInput` gains an optional `reasoningEffort` field, forwarded automatically by the existing request-builder spread.
  - `@nodaro/cli`: `nodaro prompt` wizard subcommands gain a `--reasoning-effort <level>` flag (model-dependent; accepts `none|low|medium|high|xhigh|max`).

  `grok-4.5` was evaluated but deferred — its KIE chat endpoint is not yet live, so no registry entry, rate row, or docs were added for it in this release.

## 1.8.0

### Minor Changes

- 39bdbd7: Add `edit-video-pro` to `VIDEO_PRODUCER_TYPES` — the new replace-span node outputs video, so canvas validators and backend asset-typing accept its output anywhere a video is accepted.
- da6af59: `SEEDANCE_2_EXTEND_STITCH` gains `referenceTailSeconds` (1) — the extend-video worker now passes only the source's last second as the `@video_1` reference (with the source's last frame as the i2v first-frame anchor), and the existing `trimTailFrames`/`trimHeadFrames` are documented as the smart-cut fallback trims.

## 1.7.0

### Minor Changes

- aac8660: HappyHorse 1.1: the `happyhorse` / `happyhorse-i2v` / `happyhorse-ref2v` ids now target KIE's `happyhorse-1-1/*` endpoints (1.0 was delisted; identical parameter surface, so existing workflows keep working). Catalog gains the model's full 9-ratio aspect set (adds `4:5`, `5:4`, `21:9`, `9:21` for T2V/Ref2V) and per-second pricing tiers (`<id>:<N>s:<720p|1080p>`, N = 3–15) in `DURATION_PRICED_PROVIDERS` / `VIDEO_DURATION_TIERS` / `RESOLUTION_DURATION_PRICING`. Prompt-wizard capability blurbs updated accordingly.

## 1.6.0

### Minor Changes

- 4e9f1b2: Add `boards` to `CHARACTER_ATTACH_COLUMNS` (worker auto-attach of identity boards), the `CHARACTER_PICKER_DISPLAY_ORDER` display constant + `characterBucketDisplayRank` / `sortCharacterEntriesForDisplay` helpers (boards-first picker menus), and an optional display-only `bucket` field on `ConnectedReference`.
- 254e7ef: Add a **ref-only** reference role that injects only the bare reference pointer — `reference image A` on image nodes, `@image_1` / `@video_1` / `@audio_1` on video nodes — with no `the {label} from …` phrase.

  - `roleToPhrase("ref-only", binding)` returns the bare binding; `ref-only` is now the first curated preset for `wired-character` / `wired-location`.
  - Plain image / video / audio references now **default** to ref-only (`DEFAULT_LABEL_BY_SOURCE` manual/wired-image → empty label). Character / location / object / animal asset defaults are unchanged.
  - Video/audio label-less body tokens resolve to the bare `@kind_N` (was `the subject in @kind_N`).

- 7ea3412: Variant + Role Separation for mention tokens: a non-mode 4th segment now parses as a per-mention **role** coexisting with the variant — `@kira:1:walking:clothes` attaches the walking image and injects "the clothes from …" (image and video resolvers; `@lib:1:weather/rain:lighting` for locations). Any role works, curated, custom, or `ref-only`. Every pre-existing token shape parses byte-identically; `CharacterMentionTokenInfo` gains an optional `role` field (mirroring the location parser's).
- da90853: Migrate to zod 4 (4.4.x). No API changes — schema exports and their parse
  behavior are unchanged. `@nodaro/shared` now declares `zod: ^4.4.0`;
  `@nodaro/prompts`'s bundled zod moves 3.25 → 4.4 and its schema-builder
  types use zod-4 generics (`z.ZodType<Output, Input>`).

### Patch Changes

- 269d1b6: Fix reference chips when an entity node feeds one generate node via both its identity handle and its plain `image` handle. New `sourceRefKey()` scopes an entity's image-handle ref to `${nodeId}::image` so the identity ref and the plain-image ref no longer collide on the node-id-keyed assembly maps (which previously dropped one non-deterministically — a literal `@name:N` token + lost character, or the image missing from the picker).

## 1.5.0

### Minor Changes

- 910fd2d: Relocate provider-rate derivation internals out of the published package (they now live server-side). Wire enums, ids, and credit-price tables are unchanged; if you imported the removed derivation helpers, fetch display costs from the API instead.

## 1.4.1

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.

## 1.4.0

### Minor Changes

- cd33c25: License split: creative/prompt modules (person + picker catalogs with hints, identity-lock, entity prompt builders, brand presets, prompt/reference assembly) moved from Apache-licensed `@nodaro/shared` into the new **`@nodaro/prompts`** package (FSL-1.1-Apache-2.0 — free for any non-competing use, Apache after two years per version). `@nodaro/shared` keeps the structural public contract (types, wire enums, model catalog, new `entity-asset-types` vocabulary, hint-graph types). `@nodaro/sdk` now depends on `@nodaro/prompts` and keeps its full API — `buildPersonHints`, `buildPersonSeedPrompt`, and the `PEOPLE` catalog re-exports are unchanged for consumers. Shipped as minors while the packages have no external consumers (registry copies of prior versions are being replaced).

## 1.3.0

### Minor Changes

- 3879557: Add optional `logo.image` and `logo.imageBackdrop` fields to `BrandLogo`, letting a brand supply an uploaded logo image (an https URL on the Nodaro CDN) that renders in shot-sequence brand lockups, with an optional hex backdrop panel. Backward-compatible: text-only logos are unchanged.

## 1.2.1

### Patch Changes

- 37f1805: No functional changes. Republish so the npm provenance attestations reference the repository's current (post-history-rewrite) source commits — earlier versions' attested commit links point at rewritten-away SHAs.

## 1.2.0

### Minor Changes

- 6bcdb96: Add the platform's single-source video default: `DEFAULT_VIDEO_PROVIDER` (`seedance-2-fast`), `DEFAULT_VIDEO_DURATION_SEC` (4), and `applyDefaultVideoSelection()` — used by the generate-video/text-to-video routes, the DAG payload builder, and the KIE provider fallback. Previously the route default (`minimax`) and the DAG default (`kling`) disagreed; a nothing-specified request now resolves to `seedance-2-fast:4s:480p` (16 credits), guarded by tests in shared + billing.

## 1.1.0

### Minor Changes

- ca65d28: Add typed support for the new `assemble-narrated-video` node: `AssembleNarratedVideoParams` with typed `client.nodes.run`/`runAndWait` overloads in `@nodaro/sdk`, and the `assembleNarratedVideoCredits` credit estimator (`3 + ceil(blocks/6)`) exported from `@nodaro/shared`.
- c42a82f: Centralize community listing types in `@nodaro/shared` (single source of truth, re-exported by `@nodaro/sdk`), and add a `community` command group to `@nodaro/cli` (`browse`, `get`, `favorites`, `clone`, `favorite`, `report`) mirroring the SDK resource. Publishing remains admin/editor-only and is intentionally not exposed.
- 5585889: Admins can now share/unshare community listings via the SDK + CLI. `@nodaro/sdk`: `community.publish()`, `community.unpublish()`, `community.sharedListing()`. `@nodaro/cli`: `community publish/unpublish/shared-status`. (All require an admin token; publishing requires owning the source entity and, for characters, a likeness attestation.)
- 4260c1e: Add `resolveEffectiveSourceType` and `ENTITY_IMAGE_HANDLE_TYPES` — the single source of truth for treating an entity node's `image` source handle as a plain image producer (vs. its identity `*Ref` handle).
- 64d6d81: Add `imageReferenceLimit(provider)` — a per-image-model reference-image cap reader (the scalar image analogue of the video side's `videoReferenceLimits`). Returns `0` when a model accepts no reference images (so `> 0` doubles as a supports-references gate), else the per-model cap from `REF_IMAGE_MAX_LIMITS` (fallback `DEFAULT_REF_IMAGE_MAX`).

  The reader resolves text-to-image ids through their auto-routed i2i sibling (`T2I_TO_I2I_VARIANT`), matching the generate-image route's `resolveEffectiveProvider`, so the advertised count reflects what a user actually gets: `gpt-image-2` → 16, `seedream-5-lite` → 16, `grok`/`qwen` → 1, `nano-banana-pro`/`flux-2-max` → 8, `wan-2.7` → 9. Values mirror the existing product cap (`REF_IMAGE_MAX_LIMITS`), which is intentionally tighter than some raw provider schemas (e.g. `flux-2-pro` = 4) — no caps were changed. Lets the Studio Framing picker surface a real per-model "References" count instead of support-only.

- ddeb67a: Initial public release.

  - `@nodaro/shared` — types, model registries, prompt helpers, presentation utils, edge/range logic, identity-lock helpers shared across the Nodaro stack.
  - `@nodaro/sdk` — typed REST client for the Nodaro API. Three auth modes (StaticTokenAuth, supabaseAuth, CallbackAuth), 7 resources (workflows, projects, jobs, executions, nodes, developerApps, oauth), typed error hierarchy.

- acd2564: Add a facial-geometry layer to the structured Person catalog in `@nodaro/shared` and surface it through `@nodaro/sdk`.

  `@nodaro/shared`: new `PersonValue` fields + `PEOPLE` catalog options for a facial-geometry / feature-ratio control layer under the Face section — `cheekbones`, `facialFullness`, `eyelidType`, `canthalTilt`, `eyeSpacing`, `eyeSetBrow`, `noseTip`, and the split `lipFullness` + `lipShape` (the old combined `lips` is kept as a deprecated alias that still resolves). Each option contributes a precise prompt fragment via `buildPersonHints`; neutral options inject nothing. New export `migratePersonValue(value)` relocates legacy `eyeShape` / `lips` values onto the new fields. Backward compatible — option ids are stable, so existing data emits identical prompts.

  `@nodaro/sdk`: re-export `PersonValue`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and `buildPersonHints`, plus a new `buildPersonSeedPrompt(value)` helper that collapses a `PersonValue` into the comma-joined seed-prompt fragment for `characters.generate({ seedPrompt })`.

- 7a38259: Add the brand-token authoring layer: `BrandTokens`/`BrandPalette`/`BrandFonts`/`BrandLogo` types, the 8-preset `BRAND_PRESETS` library (`BRAND_PRESET_IDS`, `BRAND_PRESET_META`), and `resolveBrandInput()`. Powers the video-director "brand layer" — motion-graphics videos render on-brand (palette + heading/body fonts) via an optional `brandTokens` on the shot-sequence brief/plan, with an LLM auto-select + `list_brand_presets` MCP tool.
- b3f214b: Add brand typography ramp tokens: `BrandCasing`, `BrandTypeSpec` ({weight, casing, tracking}), and `BrandFonts.headingType`/`bodyType`. The 8 brand presets now declare heading/body weight (and uppercase/tracking where intentional), completing the video-director brand layer's typography.
- fbcd7c8: Add picker-catalog discovery: `client.pickerCatalogs` (`list`/`get`) over the new public `/v1/picker-catalogs` endpoints, plus `summarizePickerCatalogs`/`projectPickerCatalog` helpers in `@nodaro/shared`.

### Patch Changes

- e0aec7e: Correct the license statement in the `@nodaro/shared` and `@nodaro/sdk` READMEs (the packages are Apache-2.0, not the repository-root Sustainable Use License) and add `repository`/`homepage`/`bugs` metadata to all three published package.json files so npm links back to the source monorepo.
