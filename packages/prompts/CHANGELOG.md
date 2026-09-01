# @nodaro/prompts

## 1.13.0

### Minor Changes

- 1c2c224: Sectioned prompt shape — the LOOK clauses leave the prompt body for a trailing `[style]` block, on both surfaces. An assembled prompt is now `<body>\n\n[style]:\n<film line>\n<scene line>`: the body carries the user's prose, the subject fold, the whole MOTION direction family and the structured fragment last; the section carries every look clause, film line first. Folded inline, a broad direction buried the shot — a dozen grade/lighting/era sentences in the same register as the action, with nothing telling the model which was which. The section says it structurally instead.

  `prompt-style-section.ts` owns the grammar and exports it whole, so a client preview renders the same bytes the server does: `STYLE_SECTION_HEADER` (exactly `[style]:`, lowercase, never indented — the video reference resolver collapses 2+ horizontal spaces unanchored), `partitionStyleClauses` / `styleSlotFor` / `asBodyClauses` for the body-vs-look split, `styleSectionFromClauses` and `renderStyleSection(direction, { surface, mode })` for the block, `composeSectionedPrompt` for the whole prompt, and `sectionedClauseCosts` for the shed budget. The film/scene grouping is a `styleGroup: "film"` column on `DIRECTION_FIELDS` (`cameraFormat`, `colorLook`, `style`, `era`, `cameraFormatId`, derived as `FILM_STYLE_KEYS`) — one definition, and the line order falls out of table order. `renderDirectionHintClauses` is `renderDirectionHints` with the row attached; the plain renderer is now its `.text` projection.

  The body/section boundary IS the registry's `family` column, the same column the video verbosity policy splits on: camera motion is part of the shot prose, not the look, so the whole motion family stays inline. Coupling the two is deliberate — a row cannot be shot prose for one and look for the other.

  ZERO look clauses (none selected, all shed, or all deduped away) emits no header and no extra newline, so the verbatim-and-untrimmed no-op is byte-identical: zero hints AND zero section returns the caller's prompt unchanged, `undefined` included, which is what the routes' `composed !== prompt` guard reads. When the section IS present the prompt is trimmed even if the body gained nothing, and a blank body drops the gap with it rather than opening on a newline.

  Shedding is unchanged in ORDER — one flat list, tail-first, look clauses before subject — but list position is no longer string position, so `keepableDirectionHints` takes an optional exact per-clause cost array. A flat "clause + separator" charge under-prices the clause that holds the 11-byte header and over-sheds past it; both composers now pass composed-length deltas, computed once and only on the overflow path.

  `buildImagePrompt`'s hybrid line-initial capitalizer stops at the header, which would otherwise rewrite it to `[Style]:` and capitalize every catalog clause under it.

  THE SECTION HAS NO TERMINATOR, so every assembler downstream of the composer is section-aware or its text reads as one more look clause. Scene content is SPLICED into the body ahead of the section — `insertBeforeStyleSection` (with `splitStyleSection` and `endsInsideStyleSection` alongside it) is what the hybrid image path, the video reference resolver and the legacy character-description wrapper now use for their trailing role phrases, element directives and descriptions. The splice is length-preserving, so the shed arithmetic is untouched, and the look tail stays last. The self-labeling control lines stay at the end instead and close the header's scope with a blank line: `Style:` / `Avoid:` on the image side, and `@nodaro/shared`'s `applyVideoNegativePrompt` on the video side, through its new `videoNegativeSuffix(negativePrompt, base?)` — omit `base` for the widest form, which is what a caller reserving room before the prompt exists (the backend's `effectiveVideoPromptCeiling`) must budget. A prompt with no section keeps its exact previous bytes on every one of those paths.

### Patch Changes

- Updated dependencies [1c2c224]
  - @nodaro/shared@2.18.0

## 1.12.0

### Minor Changes

- d1b83cd: Resolve creature and object `@-mentions` inline, and suppress their trailing
  canonical fallback.

  `buildImagePrompt`'s hybrid Phase 0 gains a wired-entity pass that runs after
  the character, location and image passes — precedence `character → location →
image → creature → object`, enforced by pass order plus a creature-first slug
  map, so a name claimed by an earlier kind never reaches a later one.

  A mentioned `wired-creature` / `wired-object` renders its role phrase INLINE at
  the typed position ("the creature from reference image D"), takes its role from
  the token's 3rd segment → the node's `defaultRole` → the source default, honors
  the `~lock` / `~nolock` sentinels, and carries its identity-lock line and
  `elementInjection` exactly once. The bound URLs are fed to
  `renderObjectCreatureCanonicalHybrid`'s covered set, so the reference no longer
  renders a second time as a dangling trailing line after the style hints — the
  double-render this leg exists to remove.

  The pass is gated on token presence, so every mention-free prompt keeps its
  exact branch and byte output, and the legacy reference format is untouched
  (an `@name:N` token stays literal text and the entity attaches as it does today).

  Like the character, location and named-image resolvers, the entity pass splices
  through `spliceMentionPhrase`, so an entity chip's own trailing space cannot
  leave a doubled space at the seam where the model is being told what the
  reference is.

- fc51a97: Truncation ordering: over a provider's image-prompt cap, `assembleImageInput` now sheds its own direction-folded hint clauses — from the END of the fold order — instead of letting `buildImagePrompt`'s order-blind tail clamp decide. Reference directives and the role phrases that bind them, `@`-mention-resolved text, the user's prose, the `structured` fragment and the appended `Style:`/`Avoid:` lines all outrank a hint and now survive a maximal `direction` on a low-cap model (seedream = 3000 chars); the tail clamp remains the last resort for a body that overflows with zero hints left. Under-cap assemblies are byte-identical — the first pass folds every hint, so shedding only ever runs on an over-cap prompt, and a caller with no `direction`/`structured` still takes the exact no-op path. New export `buildImagePromptWithOverflow` returns `buildImagePrompt`'s byte-identical result plus `overflowChars`, the number of characters the cap forced off the tail.
- 2f48344: **A location mention is a PLACE, not a backdrop.** `locationModeToRole`'s `identical` branch — which is `DEFAULT_LOCATION_USAGE_MODE`, i.e. what a bare `@old-library:1` and every un-roled location mention resolve to — still hardcoded the role `"background"`. That is the exact word `DEFAULT_LABEL_BY_SOURCE["wired-location"]` stopped emitting on 2026-08-05: `roleToPhrase` renders it as `"the background from reference image B"`, and image models read that as _paste this behind the subject_. Measured on gpt-image-2 (one character + one location, 4 draws per arm, only the role word varying), every `background` draw came back a cut-out composite — an indoor-lit subject over the location, no cast shadow, no ground contact, the asked-for action ignored; with `location` the subject rendered inside the scene under one sun. The source default was fixed then, this branch was missed.

  **This changes live prompt bytes**: an identical-mode / un-roled location mention now assembles `"the location from reference image B"` where it previously assembled `"the background from reference image B"`. Both defaults now read from `defaultRoleForSource("wired-location")`, so they cannot drift apart again. Nothing else moves — `"background"` remains a curated pick in `REFERENCE_ROLE_PRESETS["wired-location"]`, an explicit `@old-library:1:background` token renders the backdrop wording unchanged, the `style` / `layout` modes are untouched, and the legacy reference format (which never emitted role phrases) is byte-identical.

  Legacy keeps its own background/setting wording ON PURPOSE, in **both** places it appears: `locationModeDirective`'s `identical` branch (`use as the background/setting — match the location exactly.`) and the unmentioned-ref path, where `buildNonCharacterDirectives` labels every `wired-location` ref `"location"` and `"location"` is a member of `BACKGROUND_LABELS`, so `buildIdentityDirective` emits `— use as the background/setting.` Legacy is the documented revert lever (`backendHybridRoles()` → false on `IMAGE_REFERENCE_FORMAT=legacy` or `NODE_ENV=test`; hybrid is the production default), so its job is to restore the previous bytes exactly — rewording it would defeat the lever. The measured harm was also narrower than the word: it was the ROLE NOUN standing alone in `"the background from reference image B"`, not a full-sentence directive that names the location in the same breath.

  **Location references now honor `ConnectedReference.defaultRole`.** The field is on the wire schema for every source, and the character and named-image mention paths have always read it (`resolveDefaultRole`) — but the location mention resolver and the location canonical-fallback renderer read only the usage mode, so a caller's ref-level role was silently dropped. It is the ONLY channel a location has for a custom default role: a location mention's 3rd segment is a bucket/variant _or_ a role, so a caller cannot pin a per-mention role and keep the canonical image. A new `resolveLocationRole` is the single source of truth for the chain — per-mention token role → per-mention token mode **when it is role-bearing** → the ref's `defaultRole` (slug-normalized, so `empty-background` still hits its special phrase) → its `defaultUsageMode` → the source default — and BOTH location paths run it, so the same wired location can no longer phrase itself one way mentioned and another way unmentioned. An explicit token role or a role-bearing token mode (`style` / `layout`) still wins; the directive-only modes fall through, because `identical` IS `DEFAULT_LOCATION_USAGE_MODE` (the un-roled state) and `none` says nothing about what the reference is — and since the location pill's `renderText` emits a mode segment whenever the attr is set, an ungated mode step would have let a round-tripped `@old-library:1:identical` suppress the ref-level role on the majority of real tokens. That is the rule the character chain already applies to its own directive-only segments, run through the same `REFERENCE_ROLE_PRESETS` membership test (`roleBearingLocationMode`), so no hardcoded mode list can drift. A reference with no `defaultRole` assembles byte-identically to the previous derivation, `:identical` and `:none` included (pinned). Hybrid only — the legacy reference format renders location mentions as display names under mode-keyed directive bullets and has no role-phrase vocabulary at all, so there is no seam for a role to land in (pinned by a byte-identical legacy guard, matching how the character `defaultRole` work treated legacy).

  **No more doubled space at a resolved mention.** An editor serializes a mention chip as its token plus its own trailing space and the prose after the chip carries the space the author typed, so `@panda:1  and @panda2:2 …` assembled to `"the person from reference image A  and reference image C …"` — the doubled space landing exactly where the model is told what the reference is. The video core never showed it because every return of `resolveVideoReferenceCore` runs `resolveReferenceTokens`, whose `[^\S\r\n]{2,}` collapse tidies the gap; the image path had no such tidy. Every hybrid image mention splice now goes through one primitive that collapses the horizontal whitespace on either side of the seam: the three `@`-mention resolvers (character, location, named image) **and** the `{image:N:label}` positional-pill expansion — `buildRefPillNodes` appends its own trailing space to every pill it builds, the positional `imageRef` node included, so `a man wearing {image:1:hat}  in the park` is the ordinary shape and expanded to `"…the hat from reference image A  in the park"` on exactly the same seam. Scoped to the seam on purpose: a run the author double-spaced elsewhere in their prose is left alone, newlines and `\n\n` block separators are never touched (the class is `[^\S\r\n]`, not `\s`), line-initial indentation is structure rather than a seam so the leading collapse is anchored behind prose on the same line (`(?<=\S)`) and a mention that opens an indented line keeps its indent verbatim, and an already-single-spaced prompt is byte-identical. The legacy resolvers are untouched — the legacy character resolver is shared verbatim with the video path.

- c3fa6a4: New `subject` prompt channel — the platform-owned counterpart of `direction` for WHO is in the shot. `subject-registry.ts` carries the ordered table (`SUBJECT_FIELDS`), the derived wire vocabulary (`SUBJECT_KEYS` — every Person and Styling field, `customAge`, and the `heldProp` / `material` / `animal` props), the exported fold order (`SUBJECT_FOLD_KEYS`), the bounds (`SUBJECT_ID_MAX_CHARS` / `SUBJECT_ARRAY_CEILING`, defined AS the direction constants so one literal governs both channels), and the renderer `renderSubjectHints(subject, { surface, mode })` — exported so a client's "will inject into prompt" preview renders the exact server output instead of re-implementing the fold. Verbosity is a threaded parameter: `SUBJECT_IMAGE_HINT_MODE_DEFAULT` = full clauses, `SUBJECT_VIDEO_HINT_MODE_DEFAULT` = compact terms.

  The wire is a FLAT bag of the platform's own field names, and the flatness is load-bearing: the styling builder reads the Person field `lipState` to suppress its `makeup-bold-lips` twin, a dedupe that only fires when both catalogs fold off ONE shared value map. The Person and Styling rows are therefore `kind: "group"` — they receive the whole normalized bag and return ONE comma-joined clause each (their builders emit fragments, which would read as "a woman. in her 30s. East Asian." through the `". "` prompt-hint join). `preText` / `postText` are deliberately off the wire in v1: both catalogs declare them, so a shared bag would emit the same prose twice.

  `normalizeSubjectFields` is what makes the channel safe to accept: the builders do NOT cap (only `buildMaterialHints` does, structurally), so it enforces the per-dimension pick limits pack-aware, drops unknown keys, collapses a single-pick dimension's one-element array to the bare string the builder actually reads, and clamps `customAge` to a whole 0..120. Unknown IDS stay inert (every getter resolves a miss to `""`), never a rejection.

  Both doors are wired. On the WIRE, `subject` joins the bodies of `/v1/generate-image`, `/v1/generate-video` and `/v1/text-to-video` (one shared `subjectSchema`; `/v1/extend-video` is excluded for the same reason `direction` is). It is a bounded `z.record` rather than direction's derived `z.object` because Person is pack-aware and a fixed key set would silently drop every deployment-registered pack dimension; it normalizes at the door, so what lands in `jobs.input_data` is the platform's own vocabulary and equals what folds. On the CANVAS, `readSubjectFields` is the persisted-node reader — derived from the registered key set, drop-never-throw, `undefined` never `{}`, bounds shared with the wire by constant — and is read at every site that already reads `readDirectionFields`.

  The fold itself: `assembleImageInput` gains a `subject` lever and `composeVideoPromptText` takes one through its options bag, both landing the subject clauses AHEAD of the direction clauses (the subject is the noun phrase the cinematography modifies). Subject clauses are shed candidates of the same class as direction clauses, on BOTH cap-aware surfaces: `assembleImageInput` and `composeVideoPromptText` each fold ONE combined list — subject first, direction second — and shed it tail-first through the one shared `keepableDirectionHints` arithmetic, so the whole direction fold leaves before the first subject clause and neither channel is ever shed ahead of the prose, the bound references (or the framing text the video resolver adds) or the `structured` fragment. Exempting the subject fold would not have saved it: a fully specified person is the largest single fold on either surface, so the overflow would simply have landed in the provider's order-blind tail clamp. The video routes therefore pass their ceiling and framing on a `subject`-only request too — the fold gate and the truncation warning are either channel, not `direction` alone. With no `subject` — every caller today — the assembled prompt is byte-identical, and the exact no-op contract (no lever at all returns the user's prompt verbatim and untrimmed) is unchanged.

- d10d8b8: Truncation ordering, video half: `composeVideoPromptText` accepts an opt-in `opts.cap` (plus `opts.frame`) and, over that ceiling, sheds its own direction-folded hint clauses from the END of the fold order instead of letting the provider's order-blind tail clamp decide. The user's prose, the `structured` fragment and every byte the reference resolver adds — the `Use these characters:` block, the hybrid lock lines and the trailing canonical role phrases — all outrank a hint and now survive a broad `direction` on a low-cap model (kling = 1000 chars). Because the fold runs BEFORE the resolver but the resolver is what appends the binding text, the shed is decided on the FRAMED length: `frame` is the caller's reference assembly, so its additions sit inside the budget while staying un-sheddable. `cap` is a number rather than a provider id so the `/v1/generate-video` and `/v1/text-to-video` routes can pass their `effectiveVideoPromptCeiling` — the model cap minus the room the clamp reserves for a non-native `"\nAvoid: …"` suffix — without this package growing a second copy of that reservation. Opt-in throughout: a caller that passes no `cap` (the canvas executors and the workflow orchestrator included) is byte-identical, as is any capped call whose prompt already fits. New export `keepableDirectionHints`, the tail-first shed arithmetic now shared with `assembleImageInput` so the two surfaces cannot drift in which clause goes first.

### Patch Changes

- 9193ea3: Animal prompt phrasing gets one owner: new `getAnimalPromptHint(id)` / `getAnimalTerm(id)` in `@nodaro/shared`, next to the `ANIMALS` catalog they read. "featuring a {label}, {description}" had two independent copies — the picker-catalog funnel's synthesized `promptHint` and `getParameterPromptHint`'s `animal` case — and both now call the getters instead of re-authoring the sentence. Output is byte-identical; the getters return `""` on an unknown, empty or absent id, exactly like every `get*PromptHint` in `@nodaro/prompts`.

  They live in `@nodaro/shared` rather than `@nodaro/prompts` because the incoming `subject` prompt channel needs a third caller, and a getter under `packages/prompts/src` that read the raw `ANIMALS` array would be a new offender against the catalog-funnel ratchet. `getAnimalTerm` therefore carries a local copy of `deriveTerm`'s mechanical label derivation (`@nodaro/prompts` depends on `@nodaro/shared`, never the reverse), pinned entry-by-entry against the original by a new parity test.

- Updated dependencies [9193ea3]
- Updated dependencies [3979aa4]
- Updated dependencies [a6bc7bd]
- Updated dependencies [7abf3ed]
  - @nodaro/shared@2.17.0

## 1.11.0

### Minor Changes

- d746992: feat(assemble-image-input): the canvas executors honor a node's stored `direction` / `structured`.

  `readDirectionFields` / `readStructuredFields` are new public exports: narrow,
  throw-free readers that turn untrusted persisted node data into the typed levers
  `assembleImageInput` already accepts. `readDirectionFields` iterates the
  direction registry, so a dimension added there is honored by construction, and
  it accepts `string | string[]` on every key, bounded by the SAME two constants
  the wire schema enforces — `DIRECTION_ID_MAX_CHARS` (also a new export) and
  `DIRECTION_ARRAY_CEILING`, imported rather than re-typed per door, so a body the
  route accepts and the same node re-run from the canvas cannot start disagreeing
  about which strings are ids. Bounding cardinality is load-bearing, not hygiene:
  node data is validated only as `z.record(z.string(), z.unknown())` on write, and
  `renderDirectionHints` de-dupes with an `includes` scan, so an unbounded stored
  array would put quadratic work in front of the per-dimension slice — for the
  orchestrator, on every payload build. `renderDirectionHints` now also stops
  scanning a key once `maxPicks` unique ids are in hand (same output, linear
  cost). `readStructuredFields` validates field by field, which is what keeps junk
  from rendering verbatim into the recorded prompt. The frontend single-node executor, the orchestrator's
  `generate-image` payload builder, and the config-panel final-prompt preview all
  read through them, so a graph that carries picker IDS (rather than baked hint
  text) folds identically on every path and stays editable on the canvas.

  No prompt text changed for a node that carries no `direction` / `structured`
  key — which is every workflow authored before this release: `composePromptText`
  still returns such a prompt verbatim and untrimmed, and the platform-caller
  parity fixtures are unchanged. A node that DOES carry them is trimmed and
  `". "`-joined, additively with the hints from any wired Framing/Lighting/Style
  picker node, and is not gated by the node's Inject Look switch (that switch
  documents wired handles; stored direction is node-local look data like `style`).

- 988ba38: feat(prompts): the direction registry — one ordered table for every cinematic dimension the `direction` channel carries.

  `assembleImageInput` accepted exactly five cinematic ids — `framingId`, `framingAngleId`, `lightingId`, `lensId`, `cameraFormatId` — folded by five hardcoded `get*PromptHint` calls. Every other dimension a client offers (style, mood, aesthetic, the five lighting categories, the three exposure categories, photographer, atmosphere, post-process, setting, era, backdrop, …) had nowhere to ride, so each client baked those clauses into the prompt TEXT itself. A production copied between clients therefore froze whatever wording was current the day it was written, and the platform could not improve a hint for anyone who had already generated. `DIRECTION_FIELDS` is the replacement: a 42-row table where the wire carries ids and the platform renders the clauses.

  - **The wire vocabulary is the platform's own field names** — `shotSize`, `lightingStyle`, `isoValue`, `style`, `mood`, `cameraMotion`, the names `SINGLE_PICKER_WIRING[].valueField` and the four `*_FIELD_BY_CATEGORY` maps already use. A Studio-emitted graph and a hand-built canvas node speak ONE vocabulary for one catalog.
  - **`DIRECTION_KEYS` exports the canonical fold order**, so a client's "will inject into prompt" preview can render the exact server output instead of re-implementing the fold and drifting from it.
  - **Multi-pick is honored per dimension** (`maxPicks`), and the three BLEND catalogs go through their own builders: two moods become the single `buildMoodHints` clause, not two paragraphs — likewise `buildAestheticHints` and `buildPhotographerHints`.
  - **`renderDirectionHints(direction, { surface, mode })` is the one renderer.** It iterates the TABLE, never the caller's object, so unknown wire keys are ignored, off-surface dimensions are inert, and unknown ids are silently skipped (every `get*PromptHint` returns `""` on a miss) rather than rejected. `joinPromptHints` is extracted beside it so the image and video composers share one measured join.
  - **De-dupe by exact clause, first occurrence wins.** This is what lets the five legacy WHOLE-catalog keys coexist with their canonical counterparts without an alias table: `framingId` + `shotSize` carrying the same id emits one clause, while `lightingId: "dawn"` beside `lightingStyle: "rembrandt"` correctly emits both — they are different ids in the same catalog, and an alias table would have wrongly suppressed one.
  - **`/v1/generate-image`'s `direction` schema is now derived from the table** (`backend/src/lib/direction-schema.ts`), deliberately tolerant: non-strict (an unknown key is stripped, never a 400), `string | string[]` to a flat ceiling with the per-dimension cap applied at render, and no `.min(1)` — the previous schema accepted the empty string. Two bounds are deliberately NOT tolerant, and both are a new 400 relative to the previous unbounded `z.string().optional()` ids: more than 8 entries in one key's array, and an id longer than 100 characters (previously parsed fine, rendered no clause, and returned 200). The asymmetry with `.min(1)` is the point — an empty string is realistic legacy input a client actually stores, a 101-character "catalog id" is not an id, and the channel lands verbatim in `jobs.input_data`.
  - **`DirectionFields` widens from `string` to `string | readonly string[]`** on every key. Safe, and the reason for a minor rather than a patch: the only reader was `composePromptText` itself.

  Clause text is unchanged for every key, AND the five pre-existing keys keep their exact fold order (the legacy block is placed LAST in the table), so every existing caller whose input the schema still accepts (see the two new bounds above) is byte-identical — with one degenerate exception: a caller that sent the SAME id on two keys of one catalog (e.g. `framingId` and `framingAngleId` both `"wide-shot"`) emitted that clause twice and now emits it once. New keys are inert until a client sends them.

  Two things to know before adopting: a client that renders mood / aesthetic / photographer by flat-mapping per id will see ONE blended clause where it used to see several (that is the platform doctrine, now applied server-side); and `get*PromptHint` reads the frozen base arrays, so ids added by a deployment-registered catalog pack resolve to `""` and contribute no clause — identical to the behavior of the five keys that shipped before this table, not a new limitation.

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

- df7adc4: feat(video): the video routes gain a structured `direction` channel — picker ids on the wire, hint text rendered server-side.

  `/v1/generate-video` had no structured direction channel at all, so every client that offered a look or a motion baked the catalog hint TEXT into the prompt itself. Three consequences, all of them permanent for the user: a scene copied between clients froze whatever wording was current the day it was written; a re-generate re-baked the same clauses on top of the already-baked ones; and the platform could never improve a hint for anyone who had already generated. `composeVideoPromptText` moves the fold to where the model call is.

  - **New `composeVideoPromptText(userPrompt, direction, structured?, opts?)`** (`assemble-video-input.ts`) — the video twin of the image side's `composePromptText`. It folds catalog ids into the prompt BODY through the shared `renderDirectionHints` on `surface: "video"`, so the two surfaces cannot drift; the dimension table, the fold order and the dedupe stay in the direction registry.
  - **The verbosity policy moves server-side.** `VIDEO_HINT_MODE_DEFAULT = { look: "full", motion: "compact" }` — motion dimensions inject their short professional term (`"cross-dissolve"`), look dimensions their full clause. It is a threaded parameter with a pure default, overridable per call via `opts.hintMode`, never deployment state.
  - **`/v1/generate-video` and `/v1/text-to-video` accept `direction`**, the same registry-derived schema `/v1/generate-image` already uses — 35 dimensions on the video surface, `cameraMotion` first. Surface is a rendering concern, not a validation one: a stills-only key (`aperture`, `photographer`, …) is accepted here and simply contributes no clause, so one client-side look map serves both surfaces unchanged.
  - **`/v1/extend-video` deliberately gets no channel** — its prompt continues an existing clip, where re-stating the look is the wrong lever.
  - **The fold runs before reference assembly.** `resolveVideoReferenceCore` frames the body — the legacy format prepends its `Use these characters:` block, hybrid appends the canonical role phrases — so folding afterwards would strand the scene description past the identity directives. Both framings are pinned by test.
  - **`jobs.input_data` keeps the source and the render apart**: `prompt` is what the model received, `userPrompt` is what the caller submitted (the empty string on a direction-only run with no prompt), and `direction` is the submitted ids verbatim.
  - **A composed prompt over the provider's ceiling now logs a warning.** The provider clamp cuts the TAIL and video ceilings are tight (kling: 1000 characters); the truncation was always there and is no longer silent. The threshold is the EFFECTIVE ceiling, not the raw model cap: for a provider without a native negative param the clamp folds the negative in as a `"\nAvoid: …"` suffix and reserves its room first, so the base prompt is cut at `cap - suffix`. Budget-aware verbosity degradation is a deliberate follow-up, not part of this change.
  - **New total guard `direction-hint-token-safety.test.ts`** proves no registered catalog's `promptHint`, `term` or `label` contains `{image:N}` / `{video:N}` / `{audio:N}`, `{ref:` or an `@slug:N` mention (case-insensitively, matching the `i`-flagged passes; `label` is in scope because the multi-pick blend renderers weave labels verbatim into the clause). Those three patterns are INPUT grammar the reference passes rewrite — ruling them out is what makes folding ahead of the reference resolver legal, and it closes the one path from this text-only fold to the assembled reference count that MiniMax-H3 credit prediction reserves against, so pricing is provably untouched. The guard also rejects the resolver's OUTPUT binding form `@image_N` for hygiene; nothing re-parses that shape, so it carries no pricing weight either way.

  No prompt text changed for any caller that sends no `direction`: with no direction and no structured fields the composer returns the caller's prompt verbatim and untrimmed, `undefined` included, so both routes are byte-identical on the flat path.

  One tolerance boundary worth stating plainly, because the schema's tolerance is otherwise total: unknown KEYS inside a `direction` object are stripped and unknown IDS are skipped, never 400'd — but a non-object `direction` VALUE (`"left"`, `0`, `true`, `null`, `[]`) is now a `validation_error` on both video routes, where before it was an unknown body key and was silently dropped. No caller in the platform, the SDK, the MCP verbs or studio sends `direction` on a video route at all, and `/v1/generate-image` set the identical precedent when its channel shipped.

  One thing to know before adopting: a client MOVING an existing client-side fold onto this channel will see its wording change. The platform joins clauses with `". "` in the registry's canonical dimension order, blends mood / aesthetic into one clause rather than flat-mapping per id, and renders motion compact — where a client typically joined its own way in its own order. That is the point of the change. Import `renderDirectionHints` + `joinPromptHints` for a "will inject into prompt" preview that renders exactly what the server will.

### Patch Changes

- Updated dependencies [a136e52]
- Updated dependencies [e40d384]
  - @nodaro/shared@2.16.0

## 1.10.0

### Minor Changes

- b07cb56: feat(character-fx): expose the character-fx node's position / duration / intensity as catalog dimensions.

  The character-fx node has always had three timing parameters beside its 57-effect picker, and the platform has always owned their wording — `POSITION_CLAUSES` / `DURATION_CLAUSES` / `INTENSITY_CLAUSES` were composed into the hint at runtime. What was missing is that no consumer could _enumerate_ them, so an id-only client (Studio, the SDK, MCP) had no way to offer the controls without inventing prompt text of its own. The transition node's identical gap was closed in the previous minor; character-fx was the last node with these three fields that a catalog consumer could not see.

  - New exports `CHARACTER_FX_POSITIONS`, `CHARACTER_FX_DURATIONS`, `CHARACTER_FX_INTENSITIES` — graded scales in the same shape as every other catalog (id, label, description, `promptHint`, `term`), each led by a no-op `auto` whose hint is empty.
  - The three clause tables AND the `CharacterFxPosition` / `CharacterFxDuration` / `CharacterFxIntensity` unions are now DERIVED from those arrays, so the clause the composer injects, the option list the API serves, and the type a consumer writes against all come from one place. The unions resolve to exactly the same members as before — no consumer change — but a step can no longer exist in one of the three and not the others.
  - The `character-fx` catalog carries them as `dimensions` (the same additive shape `transition` already uses), so `GET /v1/catalogs`, `GET /v1/picker-catalogs/character-fx`, the MCP `get_picker_catalog` tool and `client.pickerCatalogs.get("character-fx")` all return the three option lists at both detail levels. A consumer reading only `options` is unaffected.
  - These are the character-fx scales, not the transition ones: the ids match, but the wording is deliberately different (an effect _manifests_ and _persists_; a transition _occurs_ and _spans_). Read each node's own rows.

  No prompt text changed: every hint is byte-identical to the clause that was already being injected.

- 7ca2869: feat(video): `{ref:<id>}` / `{ref:<id>:<label>}` — address a video reference by its own id.

  A caller that passes `connectedReferences` to the video routes can now name a reference in the `prompt` by the `id` it gave that entry, and the platform substitutes the `@image_N` seat after it has numbered the references. Until now a client that wanted the binding inline had to compute `N` itself — a client-side mirror of the platform's numbering walk (flat refs → mentioned characters → unmentioned wired characters → the rest, bounded by the provider's image cap) that silently misbound pictures the moment the walk changed.

  - `resolveVideoReferenceCore` records each reference's seat as it numbers (`id → @image_N`) and resolves `{ref:<id>}` tokens against that map — before the `referenceOrder` reorder, so the binding follows the reference to its final seat. `{image:N}` / `{video:N}` / `{audio:N}` are unchanged: still resolved after the reorder, still keeping the author's literal `N`.
  - Ids are opaque and may contain `:` and `/`; they are matched by identity against the known ids, never parsed by character class. The optional `:<label>` uses the same label class as `{image:N:label}` and renders `the <label> from @image_N`.
  - A token never ships raw: an unknown id, a reference the walk skipped, one the provider cap dropped, or a provider without image-reference support degrades to the label, else the reference's display name, else nothing. New core input `refNamesById` lets a caller supply names for references it capped out before the walk; new exported `resolveRefIdTokens` is the standalone resolver.
  - `VideoExtraRef.id` (prompts) and `ExtraRefInput.id` (shared) carry the row id through to the slot map. Additive: extras without an id number exactly as before.
  - No output changes for prompts that carry no `{ref:` token.

### Patch Changes

- Updated dependencies [9915a46]
- Updated dependencies [7ca2869]
  - @nodaro/shared@2.14.0

## 1.9.0

### Minor Changes

- 68d0464: Factory presets whose text is a complete instruction (Reference Sheet boards, Character Reference Grid, Label Elements / Apply Named Edit, Face Privacy, Portrait Transformations, Stylized Subject & Edits, SwitchX operations, Restyle Looks) now ship it as `promptPrefix` / `promptSuffix` instead of `prompt`, so applying them keeps your prompt. `presetApplyClearKeys` (shared): a preset that ships prompt content clears stale pre/post text on apply.
- 9963ec5: Prompt pre & post text: `promptPrefix` / `promptSuffix` node-data fields on every AI prompt node (`PromptAffixFields`, `applyPromptAffixes`, `nodeSupportsPromptAffixes`); `apps.run(slug, inputs, { inputOverrides })`; `nodaro apps run --override nodeId.field=value`.
- a305fd5: feat(transitions): expose the transition node's position / duration / intensity as catalog dimensions.

  The transition node has always had three timing parameters beside its 82-entry picker, and the platform has always owned their wording — `POSITION_CLAUSES` / `DURATION_CLAUSES` / `INTENSITY_CLAUSES` were composed into the hint at runtime. What was missing is that no consumer could _enumerate_ them, so an id-only client (Studio, the SDK, MCP) had no way to offer the controls without inventing prompt text of its own.

  - New exports `TRANSITION_POSITIONS`, `TRANSITION_DURATIONS`, `TRANSITION_INTENSITIES` — graded scales in the same shape as every other catalog (id, label, description, `promptHint`), each led by a no-op `auto` whose hint is empty.
  - The three clause tables AND the `TransitionPosition` / `TransitionDuration` / `TransitionIntensity` unions are now DERIVED from those arrays, so the clause the composer injects, the option list the API serves, and the type a consumer writes against all come from one place. The unions resolve to exactly the same members as before — no consumer change — but a step can no longer exist in one of the three and not the others.
  - The `transition` catalog carries them as `dimensions`, and `projectPickerCatalog` now keeps `dimensions` on a single-dim catalog instead of dropping them — additive, so a consumer reading only `options` is unaffected. The catalog-summary `optionCount` counts both, and the CLI's `catalog-snapshot` includes them so `diff-upstream` can see them change.
  - The editor's transition panel now renders these dropdowns from the catalogs instead of a hand-written copy that had already drifted (it showed `Short (~1s)` where the catalog said `Short`). The precision moved into the catalog labels, so the editor and an id-only client show the same text.

  No prompt text changed: every hint is byte-identical to the clause that was already being injected, which the parameter-hint golden fixture verifies.

### Patch Changes

- db47f72: fix(composition-effects): add a neutral `none` default and de-duplicate `3x3-grid-collage`.

  - The `composition-effects` picker defaulted to `bursting-through-frame`, a heavy 3D paper-tear, so every unconfigured node injected a dramatic subject transform the user never asked for. The catalog now leads with a neutral `none` entry (empty `promptHint`) and defaults to it — the same no-op-entry convention `transitions` and `character-fx` use for their `auto` default, which keeps the advertised `defaultValue` a real member of the option list every consumer enumerates. Changed in both `@nodaro/prompts` sources that carry it (`PICKER_CATALOGS` and `ALL_PICKER_WIRING`), and localized in all 11 locales (`@nodaro/shared`).
  - `3x3-grid-collage` existed under the same id in both `framing/composition` and `composition-effects`. It is removed from the composition-effects catalog (`@nodaro/prompts`) and all 11 i18n locales (`@nodaro/shared`); the `framing` entry stays as the canonical one.

- Updated dependencies [db47f72]
- Updated dependencies [68d0464]
- Updated dependencies [9963ec5]
- Updated dependencies [b08b3dc]
  - @nodaro/shared@2.13.0

## 1.8.1

### Patch Changes

- f0d39b9: fix(catalogs): stop four prompt hints from injecting content outside their own dimension (same class as the earlier cowboy-shot holster).

  - `framing/composition/magazine-spread`: drop the fabricated typography ("bold display typography… headline and pull quotes integrated with the photograph") — a composition picker arranges the frame, it shouldn't invent headlines and quotes in a language the user never chose. The two-page layout + gutter remain.
  - `framing/composition/cutaway-cross-section`: reworded from a building-specific hint ("the building's near wall peeled away… the subject inhabiting one of the rooms") to a generic cross-section, so it no longer conjures a building for portrait/desert/space shots.
  - `lens/macro` vs `framing/shot-size/macro` were the same instruction twice. `lens/macro` now describes the OPTICS only (close focus, life-size magnification, shallow DOF); `framing/macro` keeps the magnification/framing. Picking both no longer duplicates.
  - `lens/anamorphic`: dropped the "cinematic widescreen feel" format claim (overlaps `camera-film/anamorphic-scope`'s 2.39:1); the lens hint now describes optics only (oval bokeh, horizontal flares).

- c089b33: fix(framing): drop the "holster visible" wardrobe clause from the `cowboy-shot` prompt hint (Shot Size must describe the frame only), and remove the `head-to-knees` entry — a duplicate crop of `medium-wide-shot` with no way for a user to tell them apart. `head-to-knees` is dropped from the framing catalog (`@nodaro/prompts`) and all 11 i18n locales (`@nodaro/shared`); `medium-wide-shot` stays as the canonical term.
- 5f67ce2: Published manifest now declares `@nodaro/shared` as a real semver range (`^2.11.0`) instead of the workspace wildcard `*`. With `*`, a consumer's lockfile kept whatever older `@nodaro/shared` it already had and `@nodaro/prompts` 1.8.0 failed at import time (`does not provide an export named registerCatalogSidecars`); npm now resolves the matching `@nodaro/shared` automatically. A repo guard (`tools/check-published-manifests.mjs`) runs in CI and in the pre-publish gate so no published package can regress to a wildcard.
- Updated dependencies [c089b33]
  - @nodaro/shared@2.12.1

## 1.8.0

### Minor Changes

- 18766f4: Person-pack curation is now enforced in the app UI, not only in `/v1/catalogs`.

  `@nodaro/prompts`: `getRegisteredPeople()` — read directly by the picker-ui person grids — becomes the composed funnel, folding the same `CatalogPack` registry `composePickerCatalogs` folds (deny/replace/extend on `catalogId:"person"`, in registration order). A deny/replace pack now hides base person entries in the picker grids, not just in the catalogs projection. A guard test pins the grid's person id-set equal to the composed catalog's forever.

  `@nodaro/shared`: two generic, content-free registration slots that `@nodaro/prompts` populates at pack-registration time (shared never imports prompts):

  - `setRegisteredPersonPackFields([...])` so `getParameterValue(data, "person")` resolves a pack dimension in the `{PersonLabel}` field-mapping fallback.
  - `registerCatalogSidecars(catalog, sidecars)` / `resetCatalogSidecars()` so a pack's localized sidecars resolve through `resolveLabel`/`resolveDescription`/`entryMatchesQuery` in the app UI.

  All three are inert on mainline (empty registries = byte-identical behavior). No deployment-specific content enters either package.

- ca8594e: Catalog replacement/extend pack seam. `@nodaro/prompts` gains a vendored catalog-pack registry (`registerCatalogPack` with `replace`/`extend`/`deny` modes) composed at the picker-catalog root — `getRegisteredPickerCatalogs()` is the single funnel every enumerating consumer reads (funnel getters, `projectAllCatalogs`, completeness). The base `PICKER_CATALOGS` is frozen and never mutated in place; curation is additive-by-registration. Also adds pack sidecar-coverage reporting (`computePackSidecarCoverage`) and a single-dim promptHint fallback so pack-added ids resolve.

  `@nodaro/shared` gains exactly one thing: the tag-free `ProjectedCatalog` / `ProjectedCatalogOption` / `ProjectedCatalogDimension` wire shape for `GET /v1/catalogs`. No tags, no policy field — the deferred `CatalogPolicy` never crosses the Apache boundary.

- 1096ad2: Compact professional `term` on every picker-catalog entry.

  `@nodaro/prompts`: each catalog entry can now carry a short `term` beside its long `promptHint` — the two-to-four word phrase a professional would actually write in a prompt ("whip pan left", "hard cut", "medium close-up"). `label` stays what users see, `promptHint` is what models read in verbose hint mode, `term` is what they read in compact hint mode. New `term.ts` (`deriveTerm` / `isSuspiciousDerivedTerm` / `resolveTerm` / `TERM_MAX_CHARS`) plus a `get<Name>Term(id)` getter alongside every `get<Name>PromptHint(id)`, and roughly 1,370 explicit terms authored where the lowercased label is not the trade term. A guard test walks every registered catalog and fails for a suspicious label with no authored term, for a term over the length or word cap, and for two ids in one catalog that would inject the same fragment — so the convention is enforced rather than documented. `PickerOption.term` is always present and already resolved (`""` for a no-op "auto"/"none" entry that injects nothing) — including on options added by a catalog pack, which are resolved at composition so a pack built against an older `@nodaro/prompts` still injects in compact mode. Consumers render `label` and inject `term`, never deriving one from the other.

  Where a catalog's grammar carries its meaning, the term keeps that grammar rather than leaving a consumer to re-add it: Material terms read `"made of polished gold"` (not `"polished gold"`, which would only name a material present in the scene) and Held Prop terms keep the held-in-hand verb (`"cradling a cat"`). Mood terms name the subject's expression, matching the register of their hints.

  Selecting a register: `PickerHintMode` (`"full" | "compact"`) is exported from `term.ts`, the `build*Hints` family (`buildFramingHints`, `buildPersonHints`, `buildStylingHints`, `buildLightingHints`, …) takes an optional trailing `mode: PickerHintMode = "full"` so existing calls are unchanged, and `getParameterPromptHint` reads `data.hintMode` off the node — absent or unrecognized means `"full"`. A compact Camera Motion / Transition node propagates the mode into the pickers wired to its `startState` / `endState` handles; a wired picker that declares its own `hintMode` wins over what it inherits.

  Pack authors are NOT required to supply it: `registerCatalogPack` accepts term-less options/dimensions/catalogs (`PickerOptionInput` / `PickerDimensionInput` / `PickerCatalogInput`) and resolves `term` at composition, so an existing vendored pack keeps compiling.

  `@nodaro/shared`: `ProjectedCatalogOption` gains `term?: string` — the `GET /v1/catalogs` wire shape carries it at **both** detail levels, so a thin client rendering its own pickers gets the injectable term without a second `detail=full` fetch. The four object-entity catalogs (animals / vehicles / weapons / furniture) gain the same optional `term?` field, authored only where the label is a UI compound ("Airship / Dirigible" → `airship`, "Plasma Sword / Lightsaber" → `plasma sword`); everywhere else the label _is_ the professional term and `@nodaro/prompts` derives it the same way it derives every other catalog's (lowercased, parentheticals stripped).

  `@nodaro/sdk`: `PickerOption` and `ProjectedCatalogOption` mirror the new field, so `client.pickerCatalogs.get()` and `client.catalogs.list()` are typed for it at both detail levels.

  `@nodaro/cli`: `nodaro catalog` snapshots now record an entry's `term`, and `diff-upstream`'s three-way merge counts a term-only upstream edit as a real content change — previously an upstream entry whose only edit was its `term` never reached a vendored pack's merge plan. That behaviour change is what makes this a minor rather than a patch. `nodaro pickers get` also documents `term` on its default (compact) detail level.

### Patch Changes

- d7c78e5: `DEFAULT_IDENTITY_LOCK` changes from `"soft"` to `"off"` — characters now default to no identity lock (users opt in to soft/strict for facial-likeness preservation).

  This is the single source of truth the app reads for every unset identity-lock fallback (canvas node, config panel, Character Studio display; backend create defaults and asset generation), so a Character node/entity with no explicit `identityLock` now emits no lock line. Consumers that pass an explicit `"off"/"soft"/"strict"` are unaffected.

- 584d953: New `IMAGE_REFERENCE_PROMPT_DOCTRINE` — the `{image:N:label}` reference-token idiom for image generation (token grammar, connection-order numbering, composition patterns), rendered into the generate-image node skill by gen-skills the same way the per-provider video doctrines are.
- d0b73c6: getRegisteredPeople() returns the base PEOPLE reference itself when no person packs are registered (mainline identity on the empty path, matching the sibling getters), instead of an unconditional copy.
- 1aacfca: Add a content-free contract guard test: the package source must not read
  `process.env`. Deployment-gated prompt content (fixed clauses, forced vocal
  gender) belongs in a deployment's registered `PromptPolicy`, never in this
  published package.
- 646062e: The provider image-reference cap now slices connected references by attach priority (canonicals, manual and extra refs before unmentioned variants) instead of raw list order, so a variant-rich character can no longer evict a character wired after it.
- Updated dependencies [18766f4]
- Updated dependencies [ca8594e]
- Updated dependencies [5947e21]
- Updated dependencies [83c38a7]
- Updated dependencies [1096ad2]
  - @nodaro/shared@2.11.0

## 1.7.3

### Patch Changes

- 1606089: Editorial cleanup of a doctrine section header.
- ff52285: Comment tidy-up in the featured-entity catalog and style presets.
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
  - @nodaro/shared@2.9.0

## 1.7.2

### Patch Changes

- 034ac61: **@nodaro/shared**

  - New Grok Imagine Image 2.0 model ids in `MODEL_CATALOG` and the provider enums: `grok-2` (t2i, in `IMAGE_GEN_PROVIDERS`), `grok-2-edit` and `grok-2-segment` (in `IMAGE_EDIT_PROVIDERS`). The edit and segment ops reference a prior grok-2 generation's KIE task id (the generation job's `kieTaskId` output) instead of an image URL; `grok-2-edit` optionally takes 1-based segment `maskIndexes` for region-targeted edits, and `grok-2-segment` is free.
  - New export `TASK_CHAINED_EDIT_PROVIDERS` — the set of edit providers that take a prior Grok task id instead of an image URL (`grok-upscale`, `grok-2-edit`, `grok-2-segment`); single source of truth for the route/worker/MCP taskId-vs-imageUrl branching.

  **@nodaro/prompts**

  - Prompt-wizard image capabilities gain a `grok-2` entry.

- Updated dependencies [01a9716]
- Updated dependencies [034ac61]
  - @nodaro/shared@2.7.0

## 1.7.1

### Patch Changes

- d36034c: **@nodaro/shared**

  - Seedance 2.5 (`seedance-2-5`) gains the **1080p** resolution tier (KIE "Seedance 2.5 now supports 1080P", probe-verified 2026-08-17 — 4k/2k/1440p are still rejected). `MODEL_CATALOG` `resolutions` is now `["480p", "720p", "1080p"]`, catalog pricing rows carry the 8s/30s 1080p anchors (2280/8550 no-ref, 1370 with-ref at 8s), and the `QUALITY_MAP` `high` rung maps to `1080p` (was `720p`). Everything derived from the catalog — credit identifier clamping, `/v1/nodes` `providerResolutions`, GVP/EVP tier clamps, resolution dropdowns — picks the new tier up automatically.

  **@nodaro/prompts**

  - Seedance 2.5 doctrine and wizard capability strings updated for the 1080p tier (routing advice now sends only 4K jobs to `seedance-2`).

- Updated dependencies [8221886]
- Updated dependencies [3792fbb]
- Updated dependencies [d36034c]
  - @nodaro/shared@2.6.0

## 1.7.0

### Minor Changes

- 8c09cd5: Provider prompt doctrine covers the full video roster: six new sourced+dated
  family entries — VEO 3.1 (Google's official five-part formula, dialogue/SFX
  syntax, timestamp multi-shot), Gemini Omni, Grok Imagine (incl. video-1.5),
  Wan 2.x (Alibaba's official formulas + anti-patterns), HappyHorse 1.1, and
  Runway-via-KIE. Kling doctrine now also covers the silent kling-turbo /
  kling-master tiers (with a variant note). The Seedance doctrine gains the
  auto-path six-step formula (subject→action→environment→camera→style→
  constraints, 60-100 words, camera/subject motion separation) and the
  magenta-line camera-path method for the manual pro path. bytedance-lite/pro
  and hailuo-2.3 stay deliberately uncovered (different engines — mapping the
  family doctrine would overclaim; pinned by test).
- 2554aea: Add `picker-wiring.ts` — the parameter-picker wiring vocabulary as data:
  `SINGLE_PICKER_WIRING` / `MULTI_PICKER_WIRING` / `getPickerWiring` with each
  picker node type's value field(s), default, catalog id, entries, grouping, and
  per-field option lists (`fieldOptions`) for multi-dim pickers. Extracted from
  the app's parameter-picker registry so the app's community fallback, the
  first-party rich picker package, and Nodaro Cine all share one definition.
  Renderers are deliberately excluded — this is vocabulary, not presentation.
- a066015: Extend `PICKER_ANALYZER_REGISTRY` from 5 to all 38 picker catalogs — 25 new
  flat descriptors (setting, atmosphere, style, mood, color-look, photographer,
  aesthetic, era, photo-genre, backdrop, render-quality, composition-effects,
  post-process-effects, action-fx, loop-subject, transition, character-fx, pose,
  material, held-prop, camera-motion, animal, vehicle, weapon, furniture) and 8
  new discriminated ones (lighting, temporal, exposure-settings, music-genre,
  music-mood, instrumentation, voice-character, voice-delivery; the sound/voice
  pickers synthesize entries across their per-field catalogs with an explicit
  dimension tag). Adds `PICKER_ANALYZER_FAMILIES` — the 6-family partition
  (scene/look/camera/character/elements/audio) the text-to-picker route uses to
  batch analysis calls (a single all-38 legend measures ~53k tokens).

### Patch Changes

- Updated dependencies [34b3b31]
  - @nodaro/shared@2.2.1

## 1.6.0

### Minor Changes

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

### Patch Changes

- d086c0f: MiniMax Hailuo 3 (`minimax-h3`) gains KIE's new resolution lever: `768P | 2K` (default 2K) on all three endpoints (text/image/reference-to-video).

  `@nodaro/shared`: the catalog entry declares `resolutions: ["2K", "768P"]` (first entry = UI default; uppercase = the exact KIE wire enum) and its `VIDEO_VARIABLE_PRICING` axis becomes `duration+resolution`. New exports: `MINIMAX_H3_DEFAULT_RESOLUTION` and `normalizeMinimaxH3Resolution` — the single collapse rule shared by billing and provider forwarding (only a case-insensitive `768p` selects the cheaper tier; anything else renders AND bills as 2K, matching KIE's omitted-param behavior). `buildVideoCreditModelIdentifier` appends `:768p` for a verified 768P selection; bare duration composites stay the 2K rate, byte-identical to the pre-lever identifiers, so existing workflows and admin price overrides keep their ids. KIE rates: 36.5 cr/s @2K (unchanged), 22.5 cr/s @768P; reference-video input seconds bill at the selected tier's rate.

  `@nodaro/prompts`: doctrine tip and prompt-wizard capability lines updated from "fixed 2K" to the two-tier output.

- Updated dependencies [fae3b40]
- Updated dependencies [3a71fc5]
- Updated dependencies [89ea2c0]
- Updated dependencies [e264214]
- Updated dependencies [d086c0f]
- Updated dependencies [7162e62]
- Updated dependencies [49f1aa4]
- Updated dependencies [0cd2a29]
- Updated dependencies [5d66f2a]
- Updated dependencies [18d9cde]
- Updated dependencies [c19c3ad]
- Updated dependencies [270545c]
  - @nodaro/shared@2.2.0

## 1.5.0

### Minor Changes

- 72858e1: New "Face Privacy" factory-preset group for generate-image (gpt-image-2, auto aspect): Faceless · 3D Blank Head, Remove Faces, and Transparent Faces — one-click `{image:1}` edits that anonymize people while keeping the rest of the photo untouched.

### Patch Changes

- Updated dependencies [ee8061e]
  - @nodaro/shared@1.16.0

## 1.4.0

### Minor Changes

- 89bee09: `resolveSeedance2Inputs` accepts an optional `prompt` and suppresses the trailing "Use @image_N as the opening (first) frame" sentence when the prompt already binds a first frame itself (new `promptBindsFirstFrame` export). Field finding: the first-frame directive only reliably steers Seedance when adjacent to the extend colon; a duplicate sentence at the end dilutes it. The frame image still rides the reference list.

### Patch Changes

- Updated dependencies [606997d]
- Updated dependencies [2f32c1b]
- Updated dependencies [0dedf9b]
- Updated dependencies [774a2d1]
  - @nodaro/shared@1.14.0

## 1.3.1

### Patch Changes

- 2087527: Content-rejection hardening from the first app_reports batch: the `feature-midriff-visible` / `feature-navel-visible` prompt hints move to garment language (no "bare stomach" anatomy emphasis), `buildPersonHints` folds the pair into ONE neutral clause when both are picked, and `buildStylingHints` skips `makeup-bold-lips` when the shared value map already carries the person catalog's `lip-state-bold-red` (single-map consumers were doubling the lipstick clause). SDK: `GenerateCharacterInput` and `GenerateAssetInput` gain optional `origin` — client-app attribution for the platform's diagnostic reports.

## 1.3.0

### Minor Changes

- c7d3d25: Seven new styling catalog items closing out the first `/admin/picker-gaps` report batch: `outfit-sundress` (halter sundress / patterned maxi), `outfit-soccer-jersey` (national-team jersey with crest), `outfit-pharaoh` (ancient-Egyptian regalia — usekh collar, pectoral, shendyt kilt), `headwear-nemes` (striped pharaonic nemes with uraeus), `face-paint-flag` (national flag on cheeks, sports-fan), and `state-halter-neck` / `state-plunging-neck` (wardrobe-state neckline coverage). `@nodaro/shared` carries the matching label+description translations for all 11 locales. Items only — analyzer legends, prompt hints, and picker UIs derive from the catalog with no structural change.

### Patch Changes

- Updated dependencies [c7d3d25]
  - @nodaro/shared@1.13.1

## 1.2.1

### Patch Changes

- 02cc802: `getParameterPromptHint` gains a `style-guide` case (returns the node's `text`), so `{Style Guide}` refs resolve at execution time and prompt-handle wires inject the style text instead of leaving literal `{Style Guide}` in the outgoing prompt. New `HINT_EXEMPT_PARAMETER_TYPES` export in `@nodaro/shared` — the canonical set of parameter types that intentionally produce no prompt hint (`motion`, `scene-count`, `duration`, `aspect-ratio`); consumers that treat parameter nodes as text producers (e.g. `{Label}` auto-fill sets) should derive from `PARAMETER_NODE_TYPES` minus this set.
- Updated dependencies [dca72ad]
- Updated dependencies [02cc802]
  - @nodaro/shared@1.13.0

## 1.2.0

### Minor Changes

- 9993861: Kling native dialogue: `VIDEO_AUDIO_CAPABILITY` upgrades `kling` (2.6) and `kling-3.0` from `ambient` to `native_speech` (probe-verified on the KIE path: scripted quoted dialogue is spoken verbatim with lip sync behind the `sound` toggle) and adds a `kling-3-omni` entry (`native_speech`, `generateAudio` lever). New optional `VideoAudioCapability.defaultOn` flag mirrors each model's own audio default; `buildVideoCreditModelIdentifier` now falls back to it when `sound` is omitted, so intent-less kling-3.0 requests bill the `:audio` tier their generation actually produces (pass `sound: false` for the silent tier). `@nodaro/prompts` gains a Kling 2.6/3.0/Omni audio-prompting doctrine (dialogue labeling, voice/tone control, Audio block, element refs, limits).

### Patch Changes

- Updated dependencies [9993861]
  - @nodaro/shared@1.11.0

## 1.1.1

### Patch Changes

- aac8660: HappyHorse 1.1: the `happyhorse` / `happyhorse-i2v` / `happyhorse-ref2v` ids now target KIE's `happyhorse-1-1/*` endpoints (1.0 was delisted; identical parameter surface, so existing workflows keep working). Catalog gains the model's full 9-ratio aspect set (adds `4:5`, `5:4`, `21:9`, `9:21` for T2V/Ref2V) and per-second pricing tiers (`<id>:<N>s:<720p|1080p>`, N = 3–15) in `DURATION_PRICED_PROVIDERS` / `VIDEO_DURATION_TIERS` / `RESOLUTION_DURATION_PRICING`. Prompt-wizard capability blurbs updated accordingly.
- Updated dependencies [aac8660]
  - @nodaro/shared@1.7.0

## 1.1.0

### Minor Changes

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

- Updated dependencies [4e9f1b2]
- Updated dependencies [254e7ef]
- Updated dependencies [269d1b6]
- Updated dependencies [7ea3412]
- Updated dependencies [da90853]
  - @nodaro/shared@1.6.0

## 1.0.1

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.
- Updated dependencies [8661d4a]
  - @nodaro/shared@1.4.1
