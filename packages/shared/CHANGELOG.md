# @nodaro/shared

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

  Every `VIDEO_ANALYSIS_BUCKET_CREDITS` row rises. `smart` is now a hybrid plan (one native 6fps skeleton pass plus 2 fast + 2 pro donor rolls, always refined — `selectionMode` no longer applies to it), and every multi-roll tier now carries its own explicit judge/refine terms instead of an implicit share of a single-pass budget, trued up from a staging measurement. This is the full, Tal-approved honest reprice, including the economy tiers (`fast` 33 -> 185 credits @180s ends a below-cost combine exposure that existed at the old price).

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

  One credit is now worth $0.002 instead of $0.02, so every credit quantity in the platform is ten times larger for the same dollar value. Balances, grants and historical records were migrated ×10 in the same release; nothing changed in what anything costs in dollars.

  Anything that converts between credits and USD — or that hardcodes an assumption about a credit's worth — must be re-checked. Use `usdToCredits()` / `creditsToUsd()` rather than dividing by the constant yourself; they carry a rounding guard and will keep working across any future change.

  The motivation was rounding: at $0.02 a credit, `ceil()` charged a 1-credit minimum for work costing a fraction of that. Replayed across 12,809 real jobs, the median small job was paying 2.0× its true cost and now pays 1.20×.

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

- 56d91a3: Reprice video-analysis against MEASURED provider cost — the previous schedule was below cost.

  Job `f3ed1390` (mixed + combine, 35.9s) reported `provider_cost` **$1.353385**
  against 34 credits of revenue (**$0.68**). The run cost **1.99× what it charged**,
  where the formula intends a 2× margin — so every analysis at the old schedule was
  underwater, not merely thin.

  Two constants were wrong, both in the same direction:

  - **The per-window output-token estimate: 4,000 → 11,200.** ~11.2k is the highest
    combined thinking+answer actually observed, and Gemini bills thinking as output.
    The old value was described as carrying "deliberate headroom" while sitting below
    even the measured typical.
  - **The grader + combine-refine passes** were assumed to be "roughly a quarter" of
    roll spend and left inside `SAFETY`. Measured against this run they are **1.78×**
    of it. Now an explicit `PLAN_OVERHEAD` factor rather than an unstated hope, so
    `SAFETY` is margin again instead of silently absorbing a modelling gap.

  Per-bucket credits (≤60s · ≤180s · ≤360s · ≤600s):

  - `gemini-3-flash` — 6·7·18·30 → **21·24·68·112**
  - `gemini-3.6-flash` (`fast`) — 14·19·49·81 → **54·63·175·291**
  - `gemini-3.1-pro` (`pro`) — 21·27·72·120 → **84·96·269·448**
  - `mixed` / `mixed-fast` — 34·46·120·200 → **137·158·443·739**

  No rate changed; this is compute that was always being spent and never billed.

  **The roll plan is the real lever, not the price.** Six rolls per window is
  essentially all of this cost: one `pro` roll at 3fps prices at ~18 credits against
  137 for the 6-roll mixed plan, while seeing 3× the frames. This schedule makes the
  current plan honest; moving to a direct high-fps single pass would bring it back
  below even the old numbers, and should be repriced again when it lands.

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
  consumer that ignores them is unaffected. Credit prices are unchanged — the extra
  output tokens sit inside the existing safety margin.

- 8583134: Video-analysis credit schedule re-derived for the direct provider lane.

  The node is now pinned to the model provider's own API with no fallback, which
  is what lets it send real media rather than a link. Its credit schedule,
  however, was still generated against the aggregator's resale rates — roughly
  30% of list — so every analysis job was priced against a lane it can no longer
  reach.

  These values are the same structural formula re-run against the rates the node
  actually pays. The safety multiplier and USD-per-credit constant are unchanged;
  only the token prices moved, so the node's margin is what it always was.

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
