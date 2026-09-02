/**
 * Build BullMQ job payloads for each node type from node data + resolved inputs.
 * Returns { jobName, queueName, payload } for worker-queued nodes.
 */

import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeExecutionState, WorkflowNodeData } from "./types.js"
import { normalizeCollageLabels } from "../../providers/image/collage-badges.js"

// Shared logic from packages/shared — single source of truth
import { resolveVideoRequestNorm } from "../../lib/video-request-norm.js"
import { resolveSlideshowTransition, collectAncestorRefs as sharedCollectAncestorRefs, applyDefaultVideoSelection, LOCATION_REFERENCE_PHOTO_KINDS, locationReferencePhotoKindLabel, type LocationReferencePhotoKind, characterMentionableAssetArrays, buildCreditModelIdentifier, resolveImageGenCreditIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier, applyVideoNegativePrompt, resolveVideoProviderForMode, resolveVideoModeForInputs, videoProviderRequiresImage, isVeoProvider, buildLipSyncCreditId, isPerSecondLipSyncProvider, resolveAiAvatarCreditId, resolveSwitchXCreditId, resolveCinematicCreditId, referenceSheetCreditId, buildVideoAnalysisCreditId, buildVideoAuditCreditId, resolveVideoAnalysisModel, extractReferencedLabels, combineSameLabelRefs, refHandleCategory, canonicalVarName, validateAiAvatarPayload, validateCinematicAvatarPayload, resolveNodeRefs, resolveEffectiveSourceType, PARAMETER_NODE_TYPES, characterMentionSlug, expandExtraRefsToConnectedReferences, PLATFORM_SPECS, isSeedance2Provider, isMinimaxH3Provider, isWan3Provider, isGeminiOmniProvider, PRICING_DEFAULT_RESOLUTION, supportsExtendRender, MODEL_CATALOG, hasFeature, referenceModalityForHandle, countRefModalityEdges as countRefModalityEdgesCore, type ReferenceModality, COMPOSER_PLAN_MAP, ASPECT_RATIO_DIMENSIONS, buildLlmCreditIdentifier, motionGraphicsFeature, FLUX_LORA_CHARACTER_MODEL_ID, extractCharacterLoraFields, clampSmartCutWindow, resolveGvpAnchorWire, normalizeModelInput, readPromptAffixes, findImageMentionTokens, knownImageSlugsFromRefs, findEntityMentionTokens, knownEntitySlugsFromRefs, uiAspectRatioFill, uiResolutionFill, resolveTopazUpscale, unresolvedRefTokens, classifyRefToken, parseNodeRef, NODE_REF_PATTERN, PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY } from "@nodaro/shared"
import { composeNegative, resolveTemplate, applyTemplate, computeNodePrompt, assembleImageInput, readDirectionFields, readStructuredFields, readSubjectFields, buildImagePrompt, buildScenePrompt, collectIdentityLockClause as sharedCollectIdentityLockClause, getParameterPromptHint, characterLockToRefLock, buildCharacterPrompt, buildObjectPrompt, buildCreaturePrompt, buildLocationPrompt, buildFaceTemplateInputs, appendMusicMeta, composeSoundHintFromConnections, truncateForField, appendField, assembleSunoInput, type SoundConsumerType, type SoundComposition, resolveVideoReferenceCore, applyPromptAffixes, composeVideoPromptText, isMinorAge, containsMinorAgeHint, type DirectionFields, type StructuredPromptFields, type SubjectFields, NODE_PROMPT_CANDIDATE_FIELDS } from "@nodaro/prompts"
import type { CharacterDef, ConnectedReference, SceneData, ExtraRefInput, ExtraRefCharacterContext } from "@nodaro/shared"
import type { CharacterMeta } from "@nodaro/prompts"
import { resolveEntityImageCreditIdentifier } from "../../lib/entity-credit-identifier.js"
import { backendHybridRoles } from "../../lib/reference-format.js"
import { selectLoraRoutingForMentions } from "../../lib/character-lora.js"
import { config } from "../../lib/config.js"
import { isNodeDenied, deniedNodeRejectionMessage, isModelDenied, deniedModelRejectionMessage } from "../../lib/surface-deny.js"
import { imageRequiredMessage } from "../../lib/video-image-required.js"
import { isVoiceGenderAllowed, premadeVoiceGender } from "../../lib/voice-policy.js"
import { applyPromptPolicies } from "../../lib/prompt-policy.js"
import { ltxCameraMotionFromUpstream } from "../../lib/ltx-camera-motion.js"
import { buildSeedanceExtendCreditIdentifier } from "../../lib/seedance-extend-model.js"
import { extractSavedNodeOutput, extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
import { IMAGE_SOURCE_TYPES, VIDEO_SOURCE_TYPES, AUDIO_SOURCE_TYPES, isSourceNode } from "./execution-graph.js"

// ---------------------------------------------------------------------------
// Character definitions + prompt template types (from workflow settings)
// ---------------------------------------------------------------------------

export interface CharacterDefinition {
  id: string
  name: string
  type: "reference" | "description"
  category?: "character" | "face" | "location" | "object"
  referenceImageUrl?: string
  description?: string
}

export interface WorkflowSettings {
  characterDefinitions?: CharacterDefinition[]
  flowPromptTemplates?: Record<string, string>
  /** User-level prompt templates from profiles.prompt_templates */
  userPromptTemplates?: Record<string, string>
}

/** Context passed to buildPayload for nodes that need workflow-level data. */
export interface PayloadBuildContext {
  settings?: WorkflowSettings
  nodes?: SimpleNode[]
  edges?: SimpleEdge[]
  nodeStates?: Record<string, NodeExecutionState>
  /** `node.data` as the AUTHOR left it — snapshotted by `node-executor.ts`
   *  BEFORE `resolveFieldMappings` rewrites `data.<field>` with an upstream
   *  node's output. Only the §4.6 settle pass reads it, to tell an authored
   *  prompt field from one a mapping / `{}` injection filled with DATA (see
   *  `settleAuthoredPromptFields`). Absent for direct callers (single-node
   *  parity, tests), where every field is authored by definition. */
  authoredData?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Required media inputs (B3) — DAG/single-node parity
// ---------------------------------------------------------------------------

export interface RequiredMediaInput {
  /** Resolved-input keys, in precedence order. The node's `data[key]` is
   *  checked as the fallback for each, matching the `resolvedInputs.x || data.x`
   *  shape the cases already use. Satisfied when ANY of them yields a non-empty
   *  string OR a non-empty array (the accumulate lanes — `videoUrls`,
   *  `imageUrls`, `audioUrlsWithSourceIds`, …). */
  readonly anyOf: readonly string[]
  /** Drives the error code: `<kind>_required`. */
  readonly kind: "video" | "audio" | "image"
  /** What to tell the user to connect ("a video", "an audio track", …). */
  readonly noun: string
}

/**
 * Media inputs a node cannot run without — the DAG-side twin of the frontend's
 * per-node refusals in `execute-node.ts` (`"no video input"`, `"no audio
 * input"`, `"Connect a video to edit"`, …).
 *
 * WHY A TABLE AND NOT 70-ODD EDITS. The `resolvedInputs.x || data.x` shape
 * appears at ~72 sites and `upscale-image` / `remove-background` have no
 * fallback at all. Guarding each case by hand is the drift the root CLAUDE.md
 * warns about; a table consulted ONCE before the switch means a new media node
 * is covered by adding one row, and the parity test in
 * __tests__/payload-builder-media-required.test.ts fails the build when the
 * frontend guards a node this table neither covers nor exempts by name.
 *
 * WHY BEFORE THE SWITCH. `node-executor.ts` deletes the placeholder `jobs` row
 * when buildPayload throws, and the credit reservation happens AFTER the build
 * — so a throw here costs the user nothing. The old behaviour enqueued the job,
 * reserved credits, and failed at ffmpeg with "Invalid URL" (the two 2026-08-18
 * merge-video-audio rows).
 *
 * ONE ROW PER NODE, ONE OR MORE REQUIREMENTS. A row is a single requirement or
 * an array of them (AND: every entry must be satisfied). The five two-input
 * nodes (merge-video-audio, still-to-video, speech-to-video, motion-transfer,
 * lip-sync) carry both halves, mirroring the frontend, which refuses both.
 * face-swap deliberately stays single: its face half reads only
 * `data.faceImageUrl` (no resolved-input lane), so guarding it would refuse a
 * wired handle — that is the audit-dag wiring gap, ticketed separately.
 *
 * KEYS ARE READ FROM THE CASE. Every `anyOf` key below is a source the matching
 * case actually consults, INCLUDING its non-media alternatives (`youtubeUrl`,
 * `sourceUrl`, `kieTaskId`) — a media-only row for those nodes would refuse
 * graphs that run today, the one failure mode a regression-guard must not have
 * (M-12b). Nodes whose media is assembled from a graph traversal or a mention
 * lane are deliberately absent and exempted by name in the test.
 */
export const REQUIRED_MEDIA_INPUTS: Readonly<Record<string, RequiredMediaInput | readonly RequiredMediaInput[]>> = {
  // --- Image in ---
  "upscale-image": { anyOf: ["imageUrl"], kind: "image", noun: "an image" },
  "remove-background": { anyOf: ["imageUrl"], kind: "image", noun: "an image" },
  "generate-mask": { anyOf: ["imageUrl", "generatedImageUrl"], kind: "image", noun: "an image" },
  "image-collage": { anyOf: ["imageUrls", "imageUrlsWithSourceIds"], kind: "image", noun: "at least one image" },
  "slideshow": { anyOf: ["imageUrls"], kind: "image", noun: "at least one image" },
  // BOTH halves — the still AND the audio that sets the output length.
  "still-to-video": [
    { anyOf: ["imageUrl"], kind: "image", noun: "an image" },
    { anyOf: ["audioUrl"], kind: "audio", noun: "an audio track" },
  ],
  "gif-to-video": { anyOf: ["imageUrl", "gifUrl"], kind: "image", noun: "a GIF" },
  "speech-to-video": [
    { anyOf: ["imageUrl"], kind: "image", noun: "an image" },
    { anyOf: ["audioUrl"], kind: "audio", noun: "an audio track" },
  ],
  "motion-transfer": [
    { anyOf: ["imageUrl"], kind: "image", noun: "a character image" },
    { anyOf: ["videoUrl"], kind: "video", noun: "a motion video" },
  ],
  "lip-sync": [
    { anyOf: ["imageUrl", "videoUrl"], kind: "image", noun: "a portrait image or a video" },
    { anyOf: ["audioUrl"], kind: "audio", noun: "an audio track" },
  ],

  // --- Video in ---
  // BOTH halves. The audio half names the two keys the case actually reads
  // (`resolvedInputs.audioSources` then `resolvedInputs.audioUrl`); the shared
  // predicate also accepts the node's own `data.*`, which can only be more
  // permissive, never refuse a graph the case would have built.
  "merge-video-audio": [
    { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
    { anyOf: ["audioSources", "audioUrl"], kind: "audio", noun: "an audio track" },
  ],
  "extract-audio": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "remove-audio": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "trim-video": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "extract-frame": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "resize-video": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "speed-ramp": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "loop-video": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "fade-video": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "transcode-video": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "add-captions": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "edit-video-pro": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "video-to-video": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "switchx": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "video-sfx": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "video-retake": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "face-swap": { anyOf: ["videoUrl"], kind: "video", noun: "a video" },
  "combine-videos": { anyOf: ["videoUrls", "videoUrlsWithSourceIds"], kind: "video", noun: "at least one video" },
  "assemble-narrated-video": { anyOf: ["videoUrls"], kind: "video", noun: "at least one video" },
  "split-media": { anyOf: ["videoUrl", "audioUrl"], kind: "video", noun: "a video or audio input" },
  "social-media-format": { anyOf: ["videoUrl", "imageUrl", "mediaUrl"], kind: "video", noun: "a video or image" },
  // Non-media alternative: an upstream VEO/Runway task id runs without a URL.
  "video-upscale": { anyOf: ["videoUrl", "kieTaskId"], kind: "video", noun: "a video (or an upstream VEO task)" },
  "extend-video": { anyOf: ["videoUrl", "kieTaskId"], kind: "video", noun: "a video (or an upstream VEO/Runway task)" },
  // Non-media alternative: the node's own YouTube URL.
  "video-analysis": { anyOf: ["videoUrl", "youtubeUrl"], kind: "video", noun: "a video or a YouTube URL" },

  // --- Audio in ---
  "audio-isolation": { anyOf: ["audioUrl"], kind: "audio", noun: "an audio track" },
  "audio-separation": { anyOf: ["audioUrl"], kind: "audio", noun: "an audio track" },
  "audio-fx": { anyOf: ["audioUrl"], kind: "audio", noun: "an audio track" },
  "forced-alignment": { anyOf: ["audioUrl"], kind: "audio", noun: "an audio track" },
  "trim-audio": { anyOf: ["videoUrl", "audioUrl"], kind: "audio", noun: "an audio or video track" },
  "adjust-volume": { anyOf: ["audioUrl", "videoUrl"], kind: "audio", noun: "an audio or video track" },
  "voice-changer": { anyOf: ["audioUrl", "videoUrl"], kind: "audio", noun: "an audio or video track" },
  "voice-changer-pro": { anyOf: ["audioUrl", "videoUrl"], kind: "audio", noun: "an audio or video track" },
  // Non-media alternative: a panel-set source link wins over both wires.
  "dubbing": { anyOf: ["sourceUrl", "videoUrl", "audioUrl"], kind: "audio", noun: "an audio or video input (or a source link)" },
  "mix-audio": { anyOf: ["audioUrlsWithSourceIds", "audioUrls"], kind: "audio", noun: "at least one audio track" },
  "combine-audio": { anyOf: ["audioUrlsWithSourceIds", "audioUrls"], kind: "audio", noun: "at least one audio track" },
  "suno-mashup": { anyOf: ["uploadUrlList", "audioUrl", "audioUrl2"], kind: "audio", noun: "at least one audio track" },
}

/** Throw a coded, node-named refusal when a required media input is absent on
 *  BOTH the resolved inputs and the node data. Mirrors the shape of the
 *  existing `video_required` throw at the AI Audit case. */
export function assertRequiredMediaInputs(
  type: string,
  resolvedInputs: ResolvedInputs,
  data: WorkflowNodeData,
): void {
  const req = REQUIRED_MEDIA_INPUTS[type]
  if (!req) return
  // A row is one requirement or a LIST of them. A list is an AND: every entry
  // must be satisfied, mirroring the frontend, which refuses each half of a
  // two-input node separately (merge-video-audio "no video input" AND "no audio
  // input"). Each entry's own `anyOf` stays an OR.
  const reqs: readonly RequiredMediaInput[] = Array.isArray(req) ? req : [req as RequiredMediaInput]
  const ri = (resolvedInputs ?? {}) as unknown as Record<string, unknown>
  const nd = (data ?? {}) as unknown as Record<string, unknown>
  const label = typeof nd.label === "string" && nd.label.trim() ? nd.label : type
  for (const entry of reqs) {
    // `||`, NOT `??` (M-12a): every case this mirrors writes
    // `resolvedInputs.x || data.x`, so an EMPTY-STRING resolved input must fall
    // through to the node's own value. With `??` an upstream that resolved to ""
    // would shadow a real `data.videoUrl` and the guard would refuse a graph
    // that runs fine today — a regression introduced by a regression-guard.
    const satisfied = entry.anyOf.some((key) => {
      const v = (ri[key] as unknown) || (nd[key] as unknown)
      if (typeof v === "string") return v.trim().length > 0
      return Array.isArray(v) && v.length > 0
    })
    if (satisfied) continue
    const err = new Error(
      `${entry.kind}_required: node "${label}" needs ${entry.noun} — connect one upstream, or the run will fail at the provider.`,
    ) as Error & { code?: string }
    err.code = `${entry.kind}_required`
    throw err
  }
}
/** The three cases that keep their own node-specific wording still carry the
 *  same coded shape as the table guard, so a caller can branch on `code`
 *  regardless of which of the two refusals fired. Message is unchanged. */
function codedMediaRefusal(code: `${"video" | "audio" | "image"}_required`, detail: string): Error {
  const err = new Error(`${code}: ${detail}`) as Error & { code?: string }
  err.code = code
  return err
}


// ---------------------------------------------------------------------------
// Unresolved `{Label}` references (§4.6) — DAG dispatch refusal
// ---------------------------------------------------------------------------

/** Canonical labels of EVERY node in the run's graph — the set a `{Label}`
 *  token is allowed to name. A token whose label is here passes the guard; only
 *  a label naming no node at all is a genuine authoring mistake.
 *
 *  GRAPH-DERIVED, deliberately NOT "nodes that have a nodeStates entry". The
 *  orchestrator gives a source node a state entry only `if (output)`
 *  (`orchestrator-worker.ts` — the `isSourceNode` branch of the pre-resolve
 *  pass), so a deliberately-EMPTY `text-prompt` / `list` / upload node has NO
 *  state entry at all. Keying the guard on state would therefore refuse
 *  `{Notes}` for a blank optional input — including a published app's blank
 *  input, where the app user cannot edit the prompt to add the
 *  `{name || fallback}` escape. An empty upstream resolves to empty text (or
 *  its `|| fallback`) in `finalizeRefTokens` below — never the literal, never a
 *  refusal. */
function knownGraphLabels(buildCtx: PayloadBuildContext | undefined): ReadonlySet<string> {
  const known = new Set<string>()
  for (const n of buildCtx?.nodes ?? []) {
    known.add(canonicalVarName((n.data.label as string) || n.type || n.id))
  }
  return known
}

/** Refuse to dispatch a prompt still carrying an unresolvable `{Label}` (§4.6).
 *  `resolveNodeRefs` leaves the literal token when the upstream is absent and
 *  there is no `|| fallback`, and those characters then reached the provider
 *  ({Describe Image} on gpt-image-2, {gravity flip} / {rewind} on seedance-2-5
 *  in the 2026-09-01 export) — every one of them naming a node that does not
 *  exist. Coded + node-named, and thrown from buildPayload so it lands BEFORE
 *  the credit reservation: node-executor.ts builds at :1314 (deleting the
 *  placeholder jobs row on throw) and only reserves at :1419.
 *  The reference/recast grammars (`{image:N}`, `{video:N}`, `{audio:N}`,
 *  `{slot:x}`, `{ref:id}`) are excluded by REF_TOKEN_NAMESPACE_PREFIXES — they
 *  are substituted further down the pipeline, not by resolveNodeRefs. */
function assertNoUnresolvedRefs(
  text: string | undefined,
  refMap: ReadonlyMap<string, string>,
  buildCtx: PayloadBuildContext | undefined,
  nodeLabel: string,
): void {
  if (!text) return
  const missing = unresolvedRefTokens(text, {
    resolvable: new Set(refMap.keys()),
    known: knownGraphLabels(buildCtx),
  })
  if (missing.length === 0) return
  const err = new Error(
    `unresolved_reference: node "${nodeLabel}" references ${missing.map((m) => `{${m}}`).join(", ")}, ` +
    `which no connected node provides. Connect the source node, or give the reference a default with {name || fallback}.`,
  ) as Error & { code?: string }
  err.code = "unresolved_reference"
  throw err
}

/**
 * Substitute-then-refuse, run at the two prompt-composition points (§4.6).
 *
 * `resolveNodeRefs` leaves `{Label}` LITERAL when the label has no value, and
 * `resolvePrompt`'s `rr` helper skips ref resolution entirely when the ref map
 * is EMPTY — so a `{Label}` naming a node that exists but produced nothing
 * shipped the characters `{Label}` to the provider ({Describe Image} on
 * gpt-image-2). Neither refusing it (the app user who left a blank optional
 * input cannot edit the prompt to add an escape) nor sending it is acceptable,
 * so the token resolves to EMPTY TEXT here — exactly as if the author had
 * written `{Label || }`.
 *
 * Order, and why: REFUSE first (a label naming no node at all is an authoring
 * mistake worth failing on — the only case left after this pass), then
 * SUBSTITUTE every remaining unresolved token with its `|| fallback` if it has
 * one, else "". That is `resolveNodeRefs`' own absent-value policy minus the
 * literal fall-through, applied HERE rather than in `@nodaro/shared` — the
 * shared resolver has other consumers whose policy is not ours to change.
 *
 * Whitespace is tidied only when a token was actually dropped, so a prompt that
 * needed no substitution is returned byte-identical.
 */
function finalizeRefTokens(
  text: string | undefined,
  refMap: ReadonlyMap<string, string>,
  buildCtx: PayloadBuildContext | undefined,
  nodeLabel: string,
): string | undefined {
  if (!text) return text
  assertNoUnresolvedRefs(text, refMap, buildCtx, nodeLabel)
  const resolvable = new Set(refMap.keys())
  let dropped = false
  const out = text.replace(NODE_REF_PATTERN, (match, raw: string) => {
    const { name, fallback } = parseNodeRef(typeof raw === "string" ? raw : "")
    // Only genuinely-unresolved NODE refs are touched: `skip` (the reference /
    // recast grammars), `reserved` (applyTemplate's vars) and `wired` (already
    // substituted upstream) all pass through untouched.
    if (classifyRefToken(name, resolvable) !== "missing") return match
    if (fallback !== null) return fallback
    dropped = true
    return ""
  })
  if (!dropped) return out
  // Best-effort tidy, and only on a DROP: an author-written `{X || }` keeps its
  // own spacing (nothing was dropped), while a drop also collapses double
  // spaces the prompt already had elsewhere. Legibility, not a formatter.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?)])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
}

/** The `data` keys `computeNodePrompt` reads as AUTHOR-TYPED prompt text for
 *  this node type — the only text the §4.6 pass may touch.
 *
 *  Derived from `NODE_PROMPT_CANDIDATE_FIELDS` (the SAME registry
 *  `computeNodePrompt` consults) plus the two affix keys it folds in through
 *  `applyPromptAffixes` — so a node type registered there is covered for free
 *  and this cannot drift onto a field the composer never reads.
 *  `text-to-speech` is the one branch `computeNodePrompt` hard-codes
 *  (`data.text` is a phantom field there; only `directText` is real). */
function authoredPromptFields(nodeType: string): readonly string[] {
  const typed = nodeType === "text-to-speech"
    ? ["directText"]
    : NODE_PROMPT_CANDIDATE_FIELDS[nodeType] ?? ["prompt"]
  return [...typed, PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY]
}

/** Shallow copy of `data` with every AUTHOR-TYPED prompt field settled (§4.6),
 *  ready to hand to `computeNodePrompt`.
 *
 *  Settling BEFORE composition rather than after is the whole point: the
 *  composed string also carries the WIRED / override value, and that is DATA —
 *  a `{` in it is a character the upstream node emitted, not a reference anyone
 *  authored, and `{name || fallback}` is unreachable for text nobody typed.
 *  `finalizeRefTokens` only ever rewrites tokens the shared classifier calls
 *  `missing`, so a `{Label}` that DOES resolve is left for `resolveNodeRefs`
 *  to substitute downstream exactly as before.
 *
 *  `buildCtx.authoredData` is `data` as the AUTHOR left it — the snapshot taken
 *  before `resolveFieldMappings` ran. That resolver rewrites `data.<field>`
 *  with an upstream node's output (a field mapping, a wired `field-<key>`
 *  handle, or a `{}` injection), so a field it touched holds text nobody typed
 *  and is DATA by the same rule as the wired prompt. A field whose value no
 *  longer equals its authored one is therefore skipped, not settled —
 *  otherwise JSON a mapping injected into `data.prompt` refuses with an escape
 *  no one can reach.
 *
 *  Returns `data` itself (same reference) when nothing needed settling, so an
 *  untouched node composes byte-identically to before this guard existed. */
function settleAuthoredPromptFields(
  nodeType: string,
  data: Record<string, unknown>,
  refMap: ReadonlyMap<string, string>,
  buildCtx: PayloadBuildContext | undefined,
  nodeLabel: string,
): Record<string, unknown> {
  const authored = buildCtx?.authoredData ?? data
  let settled: Record<string, unknown> | undefined
  for (const field of authoredPromptFields(nodeType)) {
    const raw = data[field]
    if (typeof raw !== "string" || raw.length === 0) continue
    if (authored[field] !== raw) continue
    const out = finalizeRefTokens(raw, refMap, buildCtx, nodeLabel)
    if (out === raw) continue
    settled ??= { ...data }
    settled[field] = out
  }
  return settled ?? data
}


// ---------------------------------------------------------------------------
// Seedance 2 frame-numbering guard (shared by the image-to-video AND
// generate-video cases — single source of truth so the semantics can't drift).
//
// `resolveVideoPromptMentions` numbers every `Image N` mention bullet against
// the FRONT of the reference list. Promoting the first mention URL into the
// frame slot (`imageUrl` → `first_frame_url`) is fine for ordinary i2v
// providers, but Seedance 2's resolver (`resolveSeedance2Inputs`) re-appends
// `first_frame_url` to the TAIL of `reference_image_urls` in reference mode and
// emits a "Use Image <tail> as the opening frame" suffix. That tail ordinal
// contradicts the mention's frozen front-of-list bullet number (and shifts
// every other bullet), so a @-mentioned character that auto-fills the empty
// start frame WHILE other references are present ends up double-numbered.
//
// Suppress the promotion ONLY for Seedance 2 / MiniMax H3 AND when other
// references will remain (→ reference mode is guaranteed): the mention then
// stays front-of-list at its bullet's number and no frame suffix is emitted. A
// lone mention with no other refs still fills the frame slot — genuine strict
// first-frame mode, a single image, nothing to collide with. (MiniMax H3 runs
// the SAME shared resolver with the same tail-fold semantics, so the guard
// applies identically.)
function keepSeedance2MentionsAsRefs(
  provider: string,
  opts: {
    remainingMentionCount: number
    baseRefCount: number
    refVideoCount: number
    refAudioCount: number
  },
): boolean {
  const otherRefsPresent =
    opts.remainingMentionCount > 1 ||
    opts.baseRefCount > 0 ||
    opts.refVideoCount > 0 ||
    opts.refAudioCount > 0
  return (isSeedance2Provider(provider) || isMinimaxH3Provider(provider)) && otherRefsPresent
}

// ---------------------------------------------------------------------------
// Ancestor reference image collection — delegates to shared implementation
// ---------------------------------------------------------------------------

/** Get image URL from execution state, falling back to saved node data (matches frontend). */
function getNodeImageUrl(
  node: SimpleNode,
  nodeStates: Record<string, NodeExecutionState>,
): string | undefined {
  return nodeStates[node.id]?.output?.imageUrl ?? extractSavedNodeOutput(node)?.imageUrl
}

function collectAncestorRefs(
  nodeId: string,
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  visited = new Set<string>(),
): string[] {
  return sharedCollectAncestorRefs(
    nodeId,
    nodes,
    edges,
    (src) => getNodeImageUrl(src, nodeStates),
    visited,
  )
}

// ---------------------------------------------------------------------------
// Character connection → `ConnectedReference[]` expansion
//
// Mirror of the frontend `execute-node.ts` expansion: each wired upstream
// Character node contributes a canonical entry plus one entry per asset
// variant (expressions / poses / motions / angles / bodyAngles / lighting),
// powering `@kira` / `@kira-smile` mention resolution in `buildImagePrompt`
// for orchestrator-driven runs (webhook / cron / MCP) where the frontend's
// `execute-node.ts` doesn't run.
//
// Returns ConnectedReference entries for ALL wired character upstreams. If
// none have a usable slug (named character), returns an empty array — the
// caller should then fall back to the legacy URL-only path. Field names use
// camelCase from the workflow JSON saved by the frontend (the canvas keeps
// CharacterNodeData in camelCase; the snake_case `characters` DB row is
// distinct and not what flows through SimpleNode.data).
// ---------------------------------------------------------------------------

/**
 * Build a complete `connectedReferences` list for an image-gen / i2i node.
 * Emits the wired-character expanded entries first (canonical + per-variant
 * for every wired Character upstream — these power `@kira-smile` resolution
 * in `buildImagePrompt`'s Phase 0), then appends any remaining URLs from the
 * ref-URL map (manual uploads, extracted refs, character-definition refs,
 * non-character wired upstream images) as plain `wired-image` entries.
 * Duplicates by URL are skipped so the canonical character URL doesn't get
 * listed twice (the existing flow keys upstream character URLs as
 * `wired_<i>` in refUrlMap — same URL as the expanded canonical entry).
 * Used only when the prompt contains an `@-mention`.
 */
function buildConnectedRefsForGenerate(
  wiredCharRefs: readonly ConnectedReference[],
  refUrlMap: ReadonlyMap<string, string>,
  orderIds: readonly string[],
  /** Wired Location upstream refs (Phase 2 #1) — emitted first so the
   *  directive builder can attach the location's canonical description to
   *  its bullet. URL-deduped against the wired-character refs and refUrlMap. */
  wiredLocRefs: readonly ConnectedReference[] = [],
  /** Wired Object / Creature (animal) upstream refs (unified-asset-references
   *  Phase 2) — auto-attach `Image N (reference)` entities, deduped by URL. */
  wiredObjCreatureRefs: readonly ConnectedReference[] = [],
  /** Canvas node id → node name, from `buildRefNameLookup`. Gives a NAMED
   *  upload-image node's label to the plain `wired-image` entries below, which
   *  is what a `@<name-slug>:<index>` mention resolves against (P3). Empty by
   *  default, in which case every entry keeps its id as its name exactly as
   *  before. */
  nameById: ReadonlyMap<string, string> = new Map(),
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const seenUrls = new Set<string>()
  for (const r of wiredLocRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (const r of wiredCharRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (const r of wiredObjCreatureRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  const addRawUrl = (id: string, url: string): void => {
    if (!url || seenUrls.has(url)) return
    seenUrls.add(url)
    out.push({
      id,
      // A ref id that IS a canvas node id resolves to that node's name; every
      // other id (`extracted_N`, `char_<id>`, `wired_N`, a manual-upload id)
      // has no node to look up and falls back to the id, byte-identically to
      // before P3.
      defaultName: nameById.get(id) ?? id,
      source: "wired-image",
      url,
    })
  }
  // Honor user-specified ordering first, then default insertion order.
  for (const id of orderIds) {
    const url = refUrlMap.get(id)
    if (url) addRawUrl(id, url)
  }
  for (const [id, url] of refUrlMap) {
    addRawUrl(id, url)
  }
  return out
}

/**
 * Node-name lookup for reference ids that ARE canvas node ids (`refUrlMap`
 * keys wired upstream images by source node id — see the `wiredSourceIds` walk
 * in the generate-image case).
 *
 * Mirrors the frontend's `defaultName: (upstreamData.label) ||
 * (upstreamData.name) || upstream.type` (`execute-node.ts:1077`) so a NAMED
 * upload-image node carries the same name into `ConnectedReference.defaultName`
 * on BOTH engines — which is what a `@<name-slug>:<index>` mention resolves
 * against (P3). Without this the orchestrator stamped `defaultName: id`
 * (`wired_0`, the raw node id) and a mention that resolved on a frontend
 * single-node Run shipped as literal text through the identical DAG run.
 *
 * An UNNAMED node falls back to its TYPE, not its id — again mirroring the
 * frontend — so an unlabelled `upload-image` node is mentionable as
 * `@upload-image:1`. That is deliberate: excluding the type fallback here would
 * make the two engines resolve different mention sets.
 *
 * Only applied when the caller's node-id → URL zip is provably 1:1; see the
 * `wiredZipIsOneToOne` guard at the `chainRefs` walk.
 */
function buildRefNameLookup(
  buildCtx: PayloadBuildContext | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const n of buildCtx?.nodes ?? []) {
    const d = n.data as Record<string, unknown> | undefined
    const label = typeof d?.label === "string" && d.label.trim() ? d.label : undefined
    const name = typeof d?.name === "string" && d.name.trim() ? d.name : undefined
    const resolved = label ?? name ?? n.type
    if (resolved) out.set(n.id, resolved)
  }
  return out
}

/**
 * Variant of `buildConnectedRefsForGenerate` for the image-to-image case
 * (and any other case that has a flat `directRefs: string[]` list rather
 * than a refUrlMap). Emits the wired-character expansion first, then any
 * remaining URLs from `directRefs` as plain `wired-image` entries, deduped
 * by URL.
 */
function buildConnectedRefsFromUrls(
  wiredCharRefs: readonly ConnectedReference[],
  directRefs: readonly string[],
  /** Wired Location upstream refs (Phase 2 #1). Same dedup contract as
   *  `buildConnectedRefsForGenerate`. */
  wiredLocRefs: readonly ConnectedReference[] = [],
  /** Wired Object / Creature (animal) upstream refs (unified-asset-references). */
  wiredObjCreatureRefs: readonly ConnectedReference[] = [],
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const seenUrls = new Set<string>()
  for (const r of wiredLocRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (const r of wiredCharRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (const r of wiredObjCreatureRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (let i = 0; i < directRefs.length; i++) {
    const url = directRefs[i]
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    out.push({
      id: `direct_${i}`,
      defaultName: `Image ${i + 1}`,
      source: "wired-image",
      url,
    })
  }
  return out
}

/**
 * Walk the incoming edges of a reference-sheet node to the upstream composable
 * entity and read its (kind, DB id). Mirrors the `expandWiredCharacterRefs`
 * upstream-walk but returns just the first character/object/location's identity
 * — a sheet composes from ONE entity. Extracted as a pure helper so the
 * upstream-walk is directly unit-testable without standing up the whole
 * payload-builder (`buildPayload` builds a ref-map + resolves @mentions first).
 *
 * `face` is intentionally NOT a candidate — it has no panel buckets and the
 * input-handle predicate already rejects it; this keeps the BE in lockstep.
 */
export function resolveSheetEntity(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): { entityKind?: "character" | "object" | "location"; entityDbId?: string } {
  if (!buildCtx?.nodes || !buildCtx.edges) return {}
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const up = nodeById.get(e.source)
    if (!up) continue
    // The entity node's "image" handle is a PLAIN image, not an identity ref —
    // resolveEffectiveSourceType maps it to "upload-image" so the condition below
    // is false for the image handle and true for *Ref handles (single source of truth
    // shared with the frontend canvas).
    const eff = resolveEffectiveSourceType(up.type, e.sourceHandle)
    if (eff === "character" || eff === "object" || eff === "location") {
      const d = up.data as Record<string, unknown>
      const idField =
        eff === "character" ? "characterDbId" : eff === "object" ? "objectDbId" : "locationDbId"
      const entityDbId = d[idField] as string | undefined
      return { entityKind: eff, entityDbId: typeof entityDbId === "string" && entityDbId.length > 0 ? entityDbId : undefined }
    }
  }
  return {}
}

/**
 * WHICH VIDEO-AUDIT CREDIT FAMILY — the frontend rule verbatim
 * (`videoAuditAnalysisWired` in workflow-editor/types.ts, which the node badge,
 * the canvas total and the run-confirm dialog all quote from): an edge into the
 * `analysis` target means the audit only re-audits, pricing under the cheaper
 * `video-audit` family; nothing wired means the node runs its own fast analysis
 * first, pricing under `video-audit:auto`.
 *
 * It is a GRAPH fact, not a node-data field, so it needs the edges. Callers
 * WITHOUT graph context get `false` — the frontend's own never-under-quoting
 * default. The orchestrator uses it only to detect the "wired but unresolved"
 * contradiction (see `case "video-audit"`); the family itself is selected by
 * whether the analysis actually RESOLVED, so the reserved id can never claim an
 * analysis the payload doesn't carry.
 */
export function videoAuditAnalysisWired(
  nodeId: string | undefined,
  edges?: ReadonlyArray<{ target: string; targetHandle?: string | null }>,
): boolean {
  if (!nodeId || !edges) return false
  return edges.some((e) => e.target === nodeId && e.targetHandle === "analysis")
}

/** Expand wired upstream Character nodes into canonical + per-variant refs. */
function expandWiredCharacterRefs(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): ConnectedReference[] {
  if (!buildCtx?.nodes || !buildCtx.edges) return []
  const out: ConnectedReference[] = []
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = nodeById.get(e.source)
    // The entity `image` handle is a PLAIN image, not an identity ref
    // (resolveEffectiveSourceType maps it to "upload-image"). The portrait still
    // routes as a plain reference via resolvedInputs.referenceImageUrls.
    if (!upstream || resolveEffectiveSourceType(upstream.type, e.sourceHandle) !== "character") continue
    const charData = upstream.data
    const charName =
      (charData.characterName as string | undefined) ??
      (charData.label as string | undefined) ??
      ""
    const characterSlug = characterMentionSlug(charName)
    if (!characterSlug) continue // unnamed character — no slug to @-mention or canonical-fold in the core

    const description = charData.description as string | undefined
    const canonicalDescription =
      (charData.canonicalDescription as string | null | undefined) ?? null
    // Propagate the character node's default usage mode into every entry —
    // `resolveCharacterMentions` reads this as the fallback when a per-mention
    // slug omits its own `:mode` override. The cast is defensive — the JSON
    // saved by the canvas already constrains this field to a `UsageMode`
    // literal, but `SimpleNode.data` is a structural `Record<string, unknown>`
    // so we narrow at the boundary. Invalid values trip the resolver into
    // returning the global `DEFAULT_USAGE_MODE`, so the failure mode is safe.
    const defaultUsageMode = charData.defaultUsageMode as
      | ConnectedReference["defaultUsageMode"]
      | undefined
    // Node-default role + mapped identity-lock (Character Node Role+Lock) —
    // read by the hybrid resolvers; inert in legacy. Same boundary-narrowing
    // rationale as `defaultUsageMode` above.
    const defaultRole = charData.defaultRole as string | undefined
    const identityLock = characterLockToRefLock(
      charData.identityLock as "off" | "soft" | "strict" | undefined,
    )
    // LoRA training fields — character-level (same across all variants).
    // Shared helper keeps backend + frontend `expand*Refs` in lockstep.
    const loraFields = extractCharacterLoraFields(
      charData as { loraReplicateVersion?: string | null; loraTriggerWord?: string | null; loraTrainingStatus?: string | null },
    )
    const canonicalUrl =
      (charData.defaultAssetUrl as string | undefined) ||
      (charData.sourceImageUrl as string | undefined)
    if (canonicalUrl) {
      out.push({
        id: `char_${upstream.id}`,
        defaultName: charName,
        source: "wired-character",
        description,
        url: canonicalUrl,
        characterSlug,
        variantSlug: undefined,
        characterCanonicalDescription: canonicalDescription,
        variantDescription: null,
        variantDisplayName: "canonical",
        defaultUsageMode,
        defaultRole,
        identityLock,
        ...loraFields,
      })
    }

    // All {name,url}[] variant buckets (incl. wardrobe + detail close-ups) —
    // single source of truth shared with the frontend expansion sites.
    const assetArrays = characterMentionableAssetArrays(charData as unknown as Record<string, unknown>)
    for (const [arrayName, items] of Object.entries(assetArrays)) {
      for (const item of items) {
        if (!item?.url) continue
        const variantSlug = characterMentionSlug(item.name ?? "")
        if (!variantSlug) continue
        out.push({
          id: `char_${upstream.id}_${arrayName}_${variantSlug}`,
          defaultName: `${charName} / ${item.name}`,
          source: "wired-character",
          description,
          url: item.url,
          characterSlug,
          variantSlug,
          characterCanonicalDescription: canonicalDescription,
          variantDescription: null,
          variantDisplayName: item.name,
          defaultUsageMode,
          defaultRole,
          identityLock,
          ...loraFields,
        })
      }
    }
  }
  // Stamp each wired character's Assets/Prompt picker elements onto its ref so
  // the shared builder weaves them into the character's identity bullet
  // downstream — covers every caller (generate-image / image-to-image /
  // modify-image / video via resolveVideoPromptMentions).
  return stampElementInjections(out, consumerNodeId, buildCtx)
}

/**
 * Map of `characterSlug → resolved element-injection fragment` for every
 * Character node wired into `consumerNodeId`. Picker-only (held-prop / styling /
 * camera, via `getNodePromptHint`) — byte-matching the frontend held-prop case.
 * (Text producers wired to a character are a known FE-only single-node behavior;
 * backend text parity in workflow runs is a follow-up — `getNodePromptHint`
 * returns "" for them.)
 *
 * REPLACES the old flat `collectCinematographyHints` character fold, which
 * appended the fragment to the prompt BODY (the global tail). Routing it through
 * the per-character ref lets the shared builder place it INSIDE the bullet.
 * Deduped per character node; merges when two nodes share a slug.
 */
function collectCharacterElementInjections(
  consumerNodeId: string,
  ctx: PayloadBuildContext | undefined,
): Map<string, string> {
  const nodes = ctx?.nodes ?? []
  const edges = ctx?.edges ?? []
  const bySlug = new Map<string, string>()
  const seen = new Set<string>()
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    const charNode = nodes.find((n) => n.id === edge.source)
    if (!charNode || charNode.type !== "character" || seen.has(charNode.id)) continue
    seen.add(charNode.id)
    const frags: string[] = []
    const elemEdges = edges
      .filter((ce) => ce.target === charNode.id && (ce.targetHandle === "assets" || ce.targetHandle === "in"))
      .sort((a, b) => a.source.localeCompare(b.source))
    for (const ce of elemEdges) {
      const elemNode = nodes.find((nd) => nd.id === ce.source)
      if (!elemNode) continue
      const hint = getNodePromptHint(elemNode)
      if (hint && hint.trim()) frags.push(hint.trim())
    }
    if (frags.length === 0) continue
    const data = charNode.data as Record<string, unknown> | undefined
    const name = (data?.characterName as string) || (data?.label as string) || ""
    const slug = characterMentionSlug(name)
    if (!slug) continue
    const joined = frags.join(", ")
    const prev = bySlug.get(slug)
    bySlug.set(slug, prev ? `${prev}, ${joined}` : joined)
  }
  return bySlug
}

/**
 * Stamp `elementInjection` onto every character `ConnectedReference` whose slug
 * has wired elements (see {@link collectCharacterElementInjections}). Non-
 * character refs and characters with no wired elements pass through unchanged.
 * Mirror of the frontend `stampElementInjections` in node-input-resolver.ts.
 */
function stampElementInjections(
  refs: ConnectedReference[],
  consumerNodeId: string,
  ctx: PayloadBuildContext | undefined,
): ConnectedReference[] {
  // "Inject Elements" off switch — mirror of the FE gate in node-input-resolver.ts.
  // Default ON: only an explicit `injectElements === false` on the CONSUMER node
  // skips character-element stamping for this consumer.
  const consumer = (ctx?.nodes ?? []).find((n) => n.id === consumerNodeId)
  if ((consumer?.data as { injectElements?: boolean } | undefined)?.injectElements === false) return refs
  const bySlug = collectCharacterElementInjections(consumerNodeId, ctx)
  if (bySlug.size === 0) return refs
  return refs.map((r) => {
    const inj = r.characterSlug ? bySlug.get(r.characterSlug) : undefined
    return inj ? { ...r, elementInjection: inj } : r
  })
}

/** Location variant buckets — kept in sync with frontend LocationNodeData. */
export const LOCATION_VARIANT_BUCKETS = [
  "timeOfDay",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "atmosphereMotions",
] as const

/**
 * Expand a wired Location upstream into a canonical ConnectedReference plus
 * one entry per variant across the 6 buckets (timeOfDay / weather / seasons
 * / angles / lighting / atmosphereMotions). Phase 2 #2 — powers
 * `@oldlibrary:1:weather/rain` mention resolution by giving the resolver
 * pre-indexed entries to match against.
 *
 * Returns an empty list when no wired-location upstream OR upstream has no
 * `sourceImageUrl` — caller falls through to the existing wired-image flow.
 */
/**
 * Common environmental terms → publisher-named variant slug. The
 * variant's own name is the primary match; synonyms catch common
 * alternatives (e.g. `"Light Rain"` matches via `rain`, `"Golden Hour"`
 * via `dusk`'s synonyms). Longest match wins so `twilight` beats `night`.
 */
const VARIANT_SYNONYMS: Record<string, ReadonlyArray<string>> = {
  night: ["night", "nighttime", "midnight"],
  dusk: ["dusk", "sunset", "twilight", "golden hour"],
  dawn: ["dawn", "sunrise", "daybreak"],
  morning: ["morning"],
  noon: ["noon", "midday"],
  afternoon: ["afternoon"],
  rain: ["rain", "rainy", "raining", "rainfall", "downpour"],
  snow: ["snow", "snowy", "snowing", "snowfall", "blizzard"],
  fog: ["fog", "foggy", "misty", "mist", "haze"],
  clear: ["clear sky", "sunny", "cloudless"],
  storm: ["storm", "stormy", "thunderstorm", "thunder", "lightning"],
  cloudy: ["cloudy", "overcast"],
  spring: ["spring"],
  summer: ["summer"],
  autumn: ["autumn", "fall foliage"],
  winter: ["winter"],
  neon: ["neon", "neon-lit", "neon lights"],
  candlelit: ["candlelit", "candle", "candlelight"],
  moonlit: ["moonlit", "moonlight"],
  cinematic: ["cinematic"],
}

// Bucket priority: timeOfDay tends to be the most semantically load-bearing
// modifier; atmosphereMotions are last because their names are usually
// action phrases that don't appear in static prompts.
const SMART_VARIANT_BUCKETS_BY_PRIORITY: ReadonlyArray<string> = [
  "timeOfDay", "weather", "seasons", "lighting", "angles", "atmosphereMotions",
]

// Precompile term → regex at module load. Word-boundary `\b` is fine for
// single-word terms; multi-word terms ("golden hour") use a relaxed
// non-word boundary because `\b` doesn't sit between letter+space.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
const SYNONYM_REGEXES: ReadonlyMap<string, RegExp> = (() => {
  const m = new Map<string, RegExp>()
  for (const terms of Object.values(VARIANT_SYNONYMS)) {
    for (const term of terms) {
      if (m.has(term)) continue
      m.set(term, term.includes(" ")
        ? new RegExp(`(^|\\W)${escapeRegex(term)}(\\W|$)`, "i")
        : new RegExp(`\\b${escapeRegex(term)}\\b`, "i"))
    }
  }
  return m
})()
function regexFor(term: string): RegExp {
  const cached = SYNONYM_REGEXES.get(term)
  if (cached) return cached
  return term.includes(" ")
    ? new RegExp(`(^|\\W)${escapeRegex(term)}(\\W|$)`, "i")
    : new RegExp(`\\b${escapeRegex(term)}\\b`, "i")
}

function pickSmartVariant(
  prompt: string | undefined,
  locData: Record<string, unknown>,
): { bucket: string; name: string; url: string } | null {
  if (!prompt) return null
  let best: { bucket: string; name: string; url: string; len: number } | null = null
  for (const bucket of SMART_VARIANT_BUCKETS_BY_PRIORITY) {
    const items = locData[bucket]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const name = (item as { name?: unknown }).name
      const url = (item as { url?: unknown }).url
      if (typeof name !== "string" || typeof url !== "string" || !url) continue
      const slug = name.toLowerCase().trim()
      const matchTerms = [slug, ...(VARIANT_SYNONYMS[slug] ?? [])]
      for (const term of matchTerms) {
        if (regexFor(term).test(prompt)) {
          if (!best || term.length > best.len) {
            best = { bucket, name, url, len: term.length }
          }
        }
      }
    }
  }
  return best
    ? { bucket: best.bucket, name: best.name, url: best.url }
    : null
}

export function expandWiredLocationRefs(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): ConnectedReference[] {
  if (!buildCtx?.nodes || !buildCtx.edges) return []
  const out: ConnectedReference[] = []
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  const consumer = nodeById.get(consumerNodeId)
  const consumerPrompt =
    (consumer?.data?.prompt as string | undefined) ??
    (consumer?.data?.motionPrompt as string | undefined) ??
    undefined
  for (const e of incoming) {
    const upstream = nodeById.get(e.source)
    if (!upstream || resolveEffectiveSourceType(upstream.type, e.sourceHandle) !== "location") continue
    const locData = upstream.data
    let sourceUrl = locData.sourceImageUrl as string | undefined
    if (!sourceUrl) continue
    const locName =
      (locData.locationName as string | undefined) ??
      (locData.label as string | undefined) ??
      "Location"
    const locationSlug = characterMentionSlug(locName) || undefined
    const description = (locData.description as string | undefined) ?? undefined
    const canonicalDescription =
      (locData.canonicalDescription as string | null | undefined) ?? null

    // Smart variant selection — only fires when the user hasn't explicitly
    // pinned a variant via `selectedVariant` (app-input override path).
    if (!(locData.selectedVariant as string | undefined)) {
      const smart = pickSmartVariant(consumerPrompt, locData)
      if (smart) sourceUrl = smart.url
    }

    // Canonical entry — the main image URL.
    out.push({
      id: upstream.id,
      defaultName: locName,
      source: "wired-location",
      description,
      url: sourceUrl,
      locationCanonicalDescription: canonicalDescription,
      locationSlug,
    })

    // Per-variant entries. Each bucket holds `{name, url}[]`; the variant
    // slug used by the mention resolver is `locationMentionSlug(name)` so
    // a stored "Light Rain" matches `@oldlibrary:1:weather/light-rain`.
    for (const bucket of LOCATION_VARIANT_BUCKETS) {
      const items = locData[bucket]
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const variantName = (item as { name?: string }).name
        const variantUrl = (item as { url?: string }).url
        if (!variantName || !variantUrl) continue
        const variantSlug = characterMentionSlug(variantName)
        if (!variantSlug) continue
        out.push({
          id: `${upstream.id}_${bucket}_${variantSlug}`,
          defaultName: `${locName} / ${variantName}`,
          source: "wired-location",
          description,
          url: variantUrl,
          locationCanonicalDescription: canonicalDescription,
          locationSlug,
          locationVariantBucket: bucket,
          locationVariantSlug: variantSlug,
          locationVariantDisplayName: variantName,
        })
      }
    }

    // Phase 2 #3: emit one ConnectedReference per user-uploaded reference photo.
    // These auto-attach (unlike per-variant entries which are mention-only) and
    // carry their `kind` so the prompt-builder can annotate the subject line.
    const refPhotos = (locData.referencePhotos as Array<{ kind?: string; url?: string }> | undefined) ?? []
    for (let idx = 0; idx < refPhotos.length; idx++) {
      const photo = refPhotos[idx]
      const photoUrl = (photo.url ?? "").trim()
      if (!photoUrl) continue
      if (!photo.kind) continue
      // Validate the kind is one of the 6 known values to avoid passing
      // arbitrary strings downstream. Cast through the union after the guard.
      if (!LOCATION_REFERENCE_PHOTO_KINDS.includes(photo.kind as LocationReferencePhotoKind)) continue
      const kind = photo.kind as LocationReferencePhotoKind
      out.push({
        id: `${upstream.id}_refphoto_${kind}_${idx}`,
        defaultName: `${locName} (${locationReferencePhotoKindLabel(kind)})`,
        source: "wired-location",
        url: photoUrl,
        locationCanonicalDescription: canonicalDescription,
        locationSlug,
        locationReferencePhotoKind: kind,
      })
    }
  }
  return out
}

/**
 * Expand wired Assets-handle ENTITIES (location / object / creature-animal) into
 * auto-attach canonical reference rows — the video parity of the image side. Each
 * attaches a single canonical image (`sourceImageUrl`) + a generic reference
 * bullet so the entity participates in the unified `{image:N}` numbering (D5 —
 * unified-asset-references spec). Walks ALL incoming edges whose EFFECTIVE source
 * type is location/object/creature (the Assets handle). Characters keep their own
 * mention/canonical machinery (`expandWiredCharacterRefs`). Phase 1 deliberately
 * uses the RAW canonical image (no location smart-variant pick) so the FE preview
 * (`expandWiredEntityExtrasForVideo`) and the BE run produce byte-identical refs.
 * Shape kept minimal (`{ url, description }`) — these are auto-attach extras, not
 * mentionable refs.
 */
export function expandWiredEntityExtraRefs(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): Array<{ url: string; description: string }> {
  if (!buildCtx?.nodes || !buildCtx.edges) return []
  const out: Array<{ url: string; description: string }> = []
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = nodeById.get(e.source)
    if (!upstream) continue
    const t = resolveEffectiveSourceType(upstream.type, e.sourceHandle)
    if (t !== "location" && t !== "object" && t !== "creature") continue
    const d = upstream.data as Record<string, unknown>
    const url =
      (d.sourceImageUrl as string | undefined) ||
      (d.generatedImageUrl as string | undefined) ||
      (d.url as string | undefined) ||
      (d.referenceImageUrl as string | undefined) ||
      ""
    if (!url) continue
    const name =
      (d.locationName as string | undefined) ||
      (d.objectName as string | undefined) ||
      (d.creatureName as string | undefined) ||
      (d.label as string | undefined) ||
      (t === "location" ? "Location" : t === "creature" ? "Creature" : "Object")
    out.push({ url, description: (d.description as string | undefined)?.trim() || name })
  }
  return out
}

/**
 * Expand wired Object / Creature (animal) upstreams into `ConnectedReference[]`
 * for the IMAGE path (generate-image / image-to-image / modify-image). Returns
 * the richer ConnectedReference shape (source `wired-object`/`wired-creature`)
 * so `buildImagePrompt` auto-attaches each with its `Image N (reference): …`
 * bullet + numbers it. Characters/locations have their own expanders
 * (`expandWiredCharacterRefs` / `expandWiredLocationRefs`); this closes the
 * object/animal gap so an entity wired to a generate-image node is referenceable
 * via `{image:N}` exactly like a character/location (Phase 2 — unified-asset-references).
 */
export function expandWiredObjectCreatureRefs(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): ConnectedReference[] {
  if (!buildCtx?.nodes || !buildCtx.edges) return []
  const out: ConnectedReference[] = []
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  for (const e of buildCtx.edges.filter((ed) => ed.target === consumerNodeId)) {
    const upstream = nodeById.get(e.source)
    if (!upstream) continue
    const t = resolveEffectiveSourceType(upstream.type, e.sourceHandle)
    if (t !== "object" && t !== "creature") continue
    const d = upstream.data as Record<string, unknown>
    const url =
      (d.sourceImageUrl as string | undefined) ||
      (d.generatedImageUrl as string | undefined) ||
      (d.url as string | undefined) ||
      (d.referenceImageUrl as string | undefined) ||
      ""
    if (!url) continue
    const name =
      (d.objectName as string | undefined) ||
      (d.creatureName as string | undefined) ||
      (d.label as string | undefined) ||
      (t === "creature" ? "Creature" : "Object")
    out.push({
      id: upstream.id,
      defaultName: name,
      source: t === "creature" ? "wired-creature" : "wired-object",
      description: d.description as string | undefined,
      url,
    })
  }
  return out
}

/**
 * Build a `slug → ExtraRefCharacterContext` lookup for character-sourced
 * extras. Mirrors the frontend `buildExtraRefCharacterContextLookup` in
 * `execute-node.ts`. Used by the extras directive emission below + by
 * `expandExtraRefsToConnectedReferences` so character-sourced extras inherit
 * `defaultUsageMode` and `canonicalDescription` from the upstream node.
 */
function buildExtraRefCharacterContextLookup(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): (slug: string) => ExtraRefCharacterContext | undefined {
  if (!buildCtx?.nodes || !buildCtx.edges) return () => undefined
  const bySlug = new Map<string, ExtraRefCharacterContext>()
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = nodeById.get(e.source)
    if (!upstream || resolveEffectiveSourceType(upstream.type, e.sourceHandle) !== "character") continue
    const charData = upstream.data
    const charName =
      (charData.characterName as string | undefined) ??
      (charData.label as string | undefined) ??
      ""
    const slug = characterMentionSlug(charName)
    if (!slug) continue
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        defaultUsageMode: charData.defaultUsageMode as ExtraRefCharacterContext["defaultUsageMode"],
        canonicalDescription: (charData.canonicalDescription as string | null | undefined) ?? null,
        displayName: charName,
        defaultRole: charData.defaultRole as string | undefined,
        identityLock: characterLockToRefLock(
          charData.identityLock as "off" | "soft" | "strict" | undefined,
        ),
      })
    }
  }
  return (slug) => bySlug.get(slug)
}

/** Read the `extraRefs` field from a SimpleNode's `data`, returning a typed
 *  array (cast at the boundary — the JSON schema isn't enforced server-side
 *  but the frontend type's interface is structural). */
function readExtraRefs(data: Record<string, unknown>): readonly ExtraRefInput[] | undefined {
  const raw = data.extraRefs
  if (!Array.isArray(raw)) return undefined
  return raw as readonly ExtraRefInput[]
}

/**
 * Read an unknown field from `data` as `readonly string[]`, returning
 * undefined when the field is missing or not a (non-empty) string array.
 *
 * Used for `referenceOrder` + `suppressedCanonicalCharacterIds` — both
 * additive fields the consumer node may or may not have set. The shared
 * `buildImagePrompt` already treats `[]` and `undefined` identically (no-op
 * contract), so returning undefined for either case is safe.
 */
function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const v of value) {
    if (typeof v === "string" && v.length > 0) out.push(v)
  }
  return out.length > 0 ? out : undefined
}

/**
 * Resolve `@kira:N` / `@kira:N:smile` mentions in a video-node prompt against
 * wired Character upstreams AND apply the per-character canonical fallback
 * for unmentioned wired characters. Also emits directives + appends URLs for
 * user-attached extra references (the `extraRefs` field on node data).
 *
 * Mirrors `buildImagePrompt`'s Phase 0 mention pass + canonical fallback +
 * extras pass, but lives outside the image-specific assembly pipeline (which
 * appends style hints, routes negative prompts, filters refs by model
 * support, etc.) so it can be applied to video routes that have their own
 * payload shape.
 *
 * Per-character behavior contract (parity with image-side):
 *   - wired-character with at least one `@-mention` → contribute ONLY the
 *     mentioned variant URLs (no canonical auto-attach), prepend the
 *     mention-derived directive block.
 *   - wired-character with NO `@-mention` → contribute the canonical URL
 *     + a strong identity directive. Mirrors the pre-mention behavior.
 *
 * Returns the mutated prompt + the asset URLs to slot into the worker
 * payload. The caller decides where (i2v has both `imageUrl` and
 * `referenceImageUrls`; v2v has only `referenceImageUrl`; t2v has
 * `referenceImageUrls` only).
 */
function resolveVideoPromptMentions(
  prompt: string | undefined,
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
  extraRefs?: readonly ExtraRefInput[],
  opts?: {
    /** Stable-ID reorder — see `compute-injected-refs.ts`. */
    referenceOrder?: readonly string[]
    /** Character slugs whose canonical-fallback the user has hidden. */
    suppressedCanonicalCharacterIds?: readonly string[]
    /**
     * Positional reference-handle counts the core numbers `{image:N}` /
     * `{video:N}` / `{audio:N}` body tokens against (worker-payload order). Pure
     * pass-through to the shared core — supplied by the video call sites gated on
     * provider ref-capability (Task 4.1) so the orchestrator resolves in-range
     * tokens to `@image_N` and drops out-of-range/non-ref ones to the bare label.
     * When omitted the core falls back (image → its own merged-URL count,
     * video/audio → 0).
     */
    imageRefCount?: number
    videoRefCount?: number
    audioRefCount?: number
    /**
     * Plain image-refs (Image-Refs handle) that LEAD the unified `@image_N`
     * numbering (D5 image-refs-first). The core numbers assets after them and
     * returns them prepended to `additionalUrls`; the caller uses that directly
     * (no post-hoc merge). When supplied, the image token count is the full
     * merged length (so `imageRefCount` is ignored for the image modality).
     */
    leadingRefUrls?: readonly string[]
    /**
     * Number of leading image-refs the caller owns + merges itself (EDGE count,
     * for FE↔BE parity). The core offsets asset directive ordinals + the
     * `{image:N}` count by this much WITHOUT prepending URLs (the orchestrator/
     * canvas path; the route uses `leadingRefUrls` instead). Ignored when
     * `leadingRefUrls` is set.
     */
    ordinalOffset?: number
    /**
     * Attach wired Assets-handle entities (location canonical + object/creature)
     * as auto-attach extras in the unified numbering. Set by ref-capable video
     * callers; non-ref providers leave it false (no entity refs, legacy behaviour).
     */
    includeWiredEntities?: boolean
  },
): { prompt: string | undefined; additionalUrls: string[] } {
  // ── BE-only expansion: wire upstream Character nodes → ConnectedReference[].
  // Canonical-suppression filtering lives in the shared core (single source of
  // truth) — pass the raw expansion + the suppressed set straight through. ──
  const wiredCharRefs = expandWiredCharacterRefs(consumerNodeId, buildCtx)
  // Wired Assets-handle entities (location canonical + object/creature) join the
  // unified {image:N} numbering as auto-attach extras (D5 — unified-asset-references).
  // Characters keep their mention/canonical path above; locations attach only their
  // CANONICAL image in Phase 1 (variants/refPhotos stay mention/image-side). Gated on
  // `includeWiredEntities` so the caller only attaches them for ref-capable providers
  // (non-ref providers keep their legacy no-entity behaviour).
  const wiredEntityExtras = opts?.includeWiredEntities
    ? expandWiredEntityExtraRefs(consumerNodeId, buildCtx)
    : []
  // BE-only lookup for an extra-ref's character metadata: the build-context edge
  // walk (`buildExtraRefCharacterContextLookup`) maps a character slug to its
  // `{ displayName, defaultUsageMode, canonicalDescription }`; adapt that to the
  // core's `CharacterMeta` shape (the FE supplies the same shape from
  // `nodes.find(...)`).
  const ctxLookup = buildExtraRefCharacterContextLookup(consumerNodeId, buildCtx)
  const lookupCharacterBySlug = (slug: string): CharacterMeta | undefined => {
    const ctx = ctxLookup(slug)
    if (!ctx) return undefined
    return {
      characterName: ctx.displayName,
      defaultUsageMode: ctx.defaultUsageMode,
      canonicalDescription: ctx.canonicalDescription ?? undefined,
      defaultRole: ctx.defaultRole,
      identityLock: ctx.identityLock,
    }
  }
  // First-sight character extras: surface the wired character's scene-composition
  // (held-prop / styling / text) as the extra's `elementInjection`, mirroring how
  // the mention/canonical paths derive `ConnectedReference.elementInjection` (via
  // `stampElementInjections`). Same map + "Inject Elements" off-switch as those
  // paths, so a first-sight extra whose slug has wired elements surfaces them in
  // the video hybrid output instead of silently dropping. The per-EXTRA
  // `identityLock` is still not populated (`ExtraRefInput` carries no lock
  // field) — the NODE's mapped lock reaches the extras via the
  // `lookupCharacterBySlug().identityLock` meta and the core's
  // `ex.identityLock ?? meta.identityLock` fallback (Character Node Role+Lock).
  const extraConsumer = (buildCtx?.nodes ?? []).find((n) => n.id === consumerNodeId)
  const extraElementInjections =
    (extraConsumer?.data as { injectElements?: boolean } | undefined)?.injectElements === false
      ? new Map<string, string>()
      : collectCharacterElementInjections(consumerNodeId, buildCtx)
  // All mention / numbering / canonical-fallback / extras assembly lives in the
  // shared core — the single source of truth shared with the frontend resolver.
  return resolveVideoReferenceCore({
    prompt,
    wiredCharRefs,
    extraRefs: [
      ...(extraRefs?.map((ex) => ({
        // `{ref:<id>}` slot-map key — the same row id the canvas passes.
        id: ex.id,
        // BE `ExtraRefInput.url` is optional; the core skips falsy urls exactly as
        // the old BE body's `if (!ex.url) continue` did, so `?? ""` is a
        // behavior-preserving coercion into the core's required `url: string`.
        url: ex.url ?? "",
        description: ex.description,
        characterSlug: ex.characterSlug,
        variantSlug: ex.variantSlug,
        usageMode: ex.usageMode,
        elementInjection: ex.characterSlug ? extraElementInjections.get(ex.characterSlug) : undefined,
      })) ?? []),
      // Wired Assets-handle entities auto-attach AFTER the caller's extras.
      ...wiredEntityExtras,
    ],
    lookupCharacterBySlug,
    referenceOrder: opts?.referenceOrder,
    suppressedCanonicalCharacterIds: opts?.suppressedCanonicalCharacterIds,
    leadingRefUrls: opts?.leadingRefUrls,
    ordinalOffset: opts?.ordinalOffset,
    imageRefCount: opts?.imageRefCount,
    videoRefCount: opts?.videoRefCount,
    audioRefCount: opts?.audioRefCount,
    // BE gate: same env determination as the image side (see reference-format.ts).
    // default false = legacy block (dark in prod); flips in lockstep with image.
    hybridRoles: backendHybridRoles(),
  })
}

/**
 * Count the reference-handle edges of a given reference MODALITY wired into a
 * node. Counts by modality (via the shared `referenceModalityForHandle`) rather
 * than a single handle string, so BOTH the legacy single-name ids
 * (`references` / `reference-videos` / `reference-audio`) AND the canonical
 * Generate Video ids (`imageReferences` / `videoReferences` / `audioReferences`)
 * are counted — the latter is what real generate-video nodes wire, and counting
 * only `references` left `{image:N}` tokens silently uncounted on every
 * generate-video node (the bug this closes).
 *
 * This is the EDGE count (mirrors the FE preview + run `countRefModality`), NOT
 * the resolved/list-expanded URL count — the FE can only edge-count (its preview
 * has no URL-resolution layer), so matching it keeps the two paths identical.
 * The edge-vs-resolved divergence for a reference edge that fans out to >1 URL
 * (a List producer) is a shared, documented v1 limitation.
 */
function countRefModalityEdges(
  consumerNodeId: string,
  modality: ReferenceModality,
  buildCtx: PayloadBuildContext | undefined,
): number {
  // Thin buildCtx adapter over the shared `countRefModalityEdges` (the ONE
  // modality-edge counter shared with the FE preview + run) so the orchestrator
  // and editor never drift on `{image:N}`/`{video:N}`/`{audio:N}` numbering.
  return countRefModalityEdgesCore(buildCtx?.edges ?? [], consumerNodeId, modality)
}

// ---------------------------------------------------------------------------
// Apply user-specified ordering to a list of items with IDs
// ---------------------------------------------------------------------------

function applyOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (!order.length) return [...items]
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const item = items.find((i) => i.id === id)
    if (item) {
      ordered.push(item)
      seen.add(id)
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item)
    }
  }
  return ordered
}

/** Source-node types accepted as reference images by image-to-video and
 * text-to-video. Mirrors the frontend `connectedRefImages` filter in
 * `video-configs.tsx` so the orchestrator's reorder picks up exactly the
 * upstreams the user reordered in the config panel. */
const VIDEO_REF_IMAGE_SOURCE_TYPES = new Set([
  "generate-image",
  "upload-image",
  "character",
  "object",
  "creature",
  "location",
  "edit-image",
  "image-to-image",
  "scene",
  // extract-frame outputs a still image — must be reorderable alongside
  // other image producers when wired into generate-video.imageReferences
  // (mirrors the frontend IMAGE_PRODUCER_TYPES which already includes it).
  "extract-frame",
])

/** Re-derive `referenceImageUrls` from the workflow graph in user-defined
 * order. Walks the consumer node's incoming edges (filtered by `edgeFilter`
 * to a specific `targetHandle` or accepted source types), then sorts the
 * resulting source nodes by `order` (IDs not in `order` go to the end), and
 * finally pulls each source's image URL via `getNodeImageUrl`. Used by
 * image-to-video / text-to-video so the positional Image-N letters in the
 * assembled prompt respect the user's drag-to-reorder list in
 * `connectedRefImageOrder`.
 *
 * Returns `undefined` when the order array is empty (caller should keep the
 * original `resolvedInputs.referenceImageUrls` in that case to avoid extra
 * work). */
function applyOrderToReferenceUrls(
  consumerNodeId: string,
  order: readonly string[] | undefined,
  buildCtx: PayloadBuildContext | undefined,
  edgeFilter: (edge: SimpleEdge, sourceNode: SimpleNode) => boolean,
): string[] | undefined {
  if (!order?.length) return undefined
  if (!buildCtx) return undefined
  const allNodes = buildCtx.nodes ?? []
  const allEdges = buildCtx.edges ?? []
  const states = buildCtx.nodeStates ?? {}
  const nodeById = new Map(allNodes.map((n) => [n.id, n] as const))
  const matchedSources: SimpleNode[] = []
  const seenSrcIds = new Set<string>()
  for (const e of allEdges) {
    if (e.target !== consumerNodeId) continue
    const src = nodeById.get(e.source)
    if (!src) continue
    if (!edgeFilter(e, src)) continue
    if (seenSrcIds.has(src.id)) continue
    seenSrcIds.add(src.id)
    matchedSources.push(src)
  }
  if (matchedSources.length === 0) return undefined
  const ordered = applyOrder(matchedSources, order)
  const orderedUrls = ordered
    .map((n) => getNodeImageUrl(n, states))
    .filter((u): u is string => !!u)
  return orderedUrls.length > 0 ? orderedUrls : undefined
}

interface PayloadResult {
  /** BullMQ job name (e.g., "generate-image") */
  jobName: string
  /** Queue to add to: "video-generation" or "video-render" */
  queueName: "video-generation" | "video-render"
  /** Job data payload */
  payload: Record<string, unknown>
  /** Model identifier for credit reservation */
  modelIdentifier: string
}

/** Shorthand for FFmpeg nodes that all share queueName + modelIdentifier.
 *  `modelIdentifier` defaults to `jobName`; pass an override for nodes whose
 *  credit cost varies by config (e.g. `speed-ramp:smooth`) so the orchestrator
 *  reserves the same composite the single-node route charges. */
function ffmpegResult(
  jobName: string,
  payload: Record<string, unknown>,
  modelIdentifier: string = jobName,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier,
    payload,
  }
}

/** Shorthand for nodes with a fixed model identifier and no provider selection. */
function simpleResult(
  jobName: string,
  modelIdentifier: string,
  payload: Record<string, unknown>,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier,
    payload,
  }
}

/**
 * Resolve `personaId` + `personaModel` for a Suno music node. Upstream wiring
 * (from a `suno-voice` node) wins over manual `data` fields. Returns an empty
 * object when no persona is set so spreading into a payload is a no-op.
 */
function resolvePersona(
  resolvedInputs: { personaId?: string; personaModel?: string },
  data: Record<string, unknown>,
): { personaId?: string; personaModel?: "voice_persona" | "style_persona" } {
  const personaId = resolvedInputs.personaId ?? (data.personaId as string | undefined)
  if (!personaId) return {}
  const personaModel = (resolvedInputs.personaModel ?? (data.personaModel as string | undefined)) as
    | "voice_persona" | "style_persona" | undefined
  return { personaId, personaModel: personaModel ?? "voice_persona" }
}

/**
 * Assemble the cinematic-avatar `references` array from the resolved reference
 * handle inputs (refVideoUrl/refAudioUrl/refImageUrl — one upstream producer
 * per handle) plus any pre-seeded `data.references` (single-node Run path,
 * where the orchestrator hasn't resolved handles). Wired inputs take priority
 * over a same-kind data entry; duplicate urls are dropped so a node that both
 * wires a handle and carries a stale data.references entry doesn't double-send.
 * `type` here is the INTERNAL media kind — the provider maps it to HeyGen's
 * AssetUrl shape. Caps are enforced at the route, not re-validated here.
 */
function buildCinematicReferences(
  resolvedInputs: ResolvedInputs,
  data: Record<string, unknown>,
): Array<{ type: "video" | "image" | "audio"; url: string }> {
  const refs: Array<{ type: "video" | "image" | "audio"; url: string }> = []
  const seen = new Set<string>()

  const push = (type: "video" | "image" | "audio", url: unknown) => {
    if (typeof url !== "string" || !url || seen.has(url)) return
    seen.add(url)
    refs.push({ type, url })
  }

  // Wired handle inputs first (highest priority).
  push("video", resolvedInputs.refVideoUrl)
  push("audio", resolvedInputs.refAudioUrl)
  push("image", resolvedInputs.refImageUrl)

  // Then any references carried on node data (single-node Run / manual config).
  const dataRefs = data.references
  if (Array.isArray(dataRefs)) {
    for (const r of dataRefs) {
      if (!r || typeof r !== "object") continue
      const type = (r as { type?: unknown }).type
      const url = (r as { url?: unknown }).url
      if (type === "video" || type === "image" || type === "audio") push(type, url)
    }
  }

  return refs
}

// ---------------------------------------------------------------------------
// List-like node helpers for buildNodeRefMap edge-aware output extraction
// ---------------------------------------------------------------------------

const LIST_LIKE_TYPES = new Set(["list", "split-text"])

/** Return the outputMode from connecting edges, defaulting to "each" for list-like nodes. */
function getEdgeOutputMode(
  connectingEdges: ReadonlyArray<SimpleEdge>,
): string {
  for (const edge of connectingEdges) {
    const mode = (edge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined
    if (mode) return mode
  }
  return "each"
}

/** Parse the list of items from a list/split-text node. */
function extractListItems(
  node: SimpleNode,
  states: Record<string, NodeExecutionState>,
): string[] {
  const data = node.data
  if (node.type === "list") {
    // Modern format: columns + rows. Without this, node refs like {List Name}
    // resolving to list items only saw the legacy items string; modern lists
    // returned an empty array.
    const cols = data.columns as Array<{ handleId: string }> | undefined
    if (cols) {
      const rows = data.rows as string[][] | undefined
      return (rows ?? []).map((r) => r[0]?.trim() ?? "").filter(Boolean)
    }
    // Rows-only shape (rows present, columns absent) — the loop→list rename
    // does NOT backfill columns, so a renamed rows-only loop lands here. Read
    // the first column (as the retired `loop` case did), BEFORE the legacy
    // `items` fallback, so `list` is a true superset of `loop`.
    const rowsOnly = data.rows as string[][] | undefined
    if (rowsOnly) {
      return rowsOnly.map((r) => r[0]?.trim() ?? "").filter(Boolean)
    }
    // Legacy format: newline-separated items string
    return ((data.items as string | undefined) || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }
  if (node.type === "split-text") {
    const state = states[node.id]
    if (state?.output?.splitResults) return state.output.splitResults
    return (data.splitResults as string[] | undefined) ?? []
  }
  return []
}

/** Resolve a list of items using the given output mode. */
function resolveListOutput(
  items: string[],
  mode: string,
): string | undefined {
  if (items.length === 0) return undefined
  // "last" here means the final item in a list-like source (list/loop/split-text),
  // because lists have no user-selection concept. For generic sources, "last"
  // ("Selected" in the UI) means the currently selected result via
  // activeResultIndex — handled separately in input-resolver.ts.
  if (mode === "last") return items[items.length - 1]
  if (mode.startsWith("item:")) {
    const idx = parseInt(mode.split(":")[1], 10)
    return items[idx] ?? items[0]
  }
  if (mode === "all") return items.join(", ")
  // "each" — return first item; fan-out clones get their own item via execution engine
  return items[0]
}

/**
 * Build a label→output map for resolving {Node Label} refs in text fields.
 * Uses BFS with edge tracking so list/loop/split-text nodes respect the
 * connecting edge's outputMode (e.g. "item:1", "last", "all").
 */
export function buildNodeRefMap(
  nodeId: string,
  ctx?: PayloadBuildContext,
): Map<string, string> {
  const map = new Map<string, string>()
  if (!ctx?.nodes || !ctx?.edges || !ctx?.nodeStates) return map

  const nodes = ctx.nodes
  const edges = ctx.edges
  const states = ctx.nodeStates
  // Index nodes by id and edges by target once, so the BFS below is O(N+E)
  // instead of re-scanning every node/edge on each dequeued node.
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const))
  const edgesByTarget = new Map<string, SimpleEdge[]>()
  for (const edge of edges) {
    const group = edgesByTarget.get(edge.target)
    if (group) group.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }
  const visited = new Set<string>()
  const queue: Array<{ id: string; connectingEdges: ReadonlyArray<SimpleEdge>; category: number }> = []

  // Direct-parent handle category (prompt→0, elements→1, look-family→2, else -1)
  // for same-label combination — mirror of the frontend buildNodeRefMap.
  const edgeGroupCategory = (group: ReadonlyArray<SimpleEdge>): number => {
    let cat = -1
    for (const e of group) {
      const c = refHandleCategory(e.targetHandle)
      if (c >= 0 && (cat === -1 || c < cat)) cat = c
    }
    return cat
  }

  // Seed BFS with direct parents, grouping edges by source
  const seedEdges = new Map<string, SimpleEdge[]>()
  for (const edge of edgesByTarget.get(nodeId) ?? []) {
    if (!seedEdges.has(edge.source)) seedEdges.set(edge.source, [])
    seedEdges.get(edge.source)!.push(edge)
  }
  for (const [sourceId, edgeGroup] of seedEdges) {
    visited.add(sourceId)
    queue.push({ id: sourceId, connectingEdges: edgeGroup, category: edgeGroupCategory(edgeGroup) })
  }

  // Collect results for combine + last-wins. `category` is -1 for deeper nodes.
  const results: Array<{ label: string; output: string; category: number }> = []

  while (queue.length > 0) {
    const { id: currentId, connectingEdges, category } = queue.shift()!
    const node = nodesById.get(currentId)
    if (!node) continue

    const label = (node.data.label as string) || node.type || currentId

    // List-like nodes always go through list extraction (even "each" is not
    // regular behavior — it's fan-out, so the ref should resolve via items)
    let output: string | undefined
    if (LIST_LIKE_TYPES.has(node.type)) {
      const mode = getEdgeOutputMode(connectingEdges)
      const items = extractListItems(node, states)
      output = resolveListOutput(items, mode)
    }

    // All other nodes: extract from state or node data
    if (output === undefined) {
      const state = states[currentId]
      if (state?.output?.text) {
        output = state.output.text
      } else if (state?.output?.imageUrl) {
        output = state.output.imageUrl
      } else if (state?.output?.videoUrl) {
        output = state.output.videoUrl
      } else if (state?.output?.audioUrl) {
        output = state.output.audioUrl
      } else if (PARAMETER_NODE_TYPES.has(node.type)) {
        // Parameter nodes (Animal, Setting, Style, etc.) don't have job outputs —
        // derive a text hint from their picker state so {Label} refs resolve to a
        // meaningful string. Mirrors the frontend extractNodeOutput branch at
        // execution-graph.ts:600.
        output = getNodePromptHint(node) || undefined
      } else {
        const saved = extractSavedNodeOutput(node)
        if (saved) {
          output = saved.text ?? saved.imageUrl ?? saved.videoUrl ?? saved.audioUrl
        }
      }
    }

    if (output) results.push({ label, output, category })

    // BFS: traverse to parents of current node
    const nextEdges = new Map<string, SimpleEdge[]>()
    for (const edge of edgesByTarget.get(currentId) ?? []) {
      if (!visited.has(edge.source)) {
        if (!nextEdges.has(edge.source)) nextEdges.set(edge.source, [])
        nextEdges.get(edge.source)!.push(edge)
      }
    }
    for (const [sourceId, edgeGroup] of nextEdges) {
      visited.add(sourceId)
      queue.push({ id: sourceId, connectingEdges: edgeGroup, category: -1 })
    }
  }

  // Same-label COMBINE (prompt → elements → look, inner edge order); the rest
  // keep last-wins (BE's historical behavior). Mirror of the frontend. Map is
  // CANONICAL-keyed (lowercase) so {TEXT}/{Text}/{text} all resolve.
  const combined = combineSameLabelRefs(results)
  for (const [label, value] of combined) map.set(label, value)
  for (const r of results) {
    const canon = canonicalVarName(r.label)
    if (combined.has(canon)) continue
    map.set(canon, r.output)
  }

  return map
}

/** Resolve {Node Label} refs in a text string if the map is non-empty. */
function resolveRefs(text: string | undefined, refMap: Map<string, string>): string | undefined {
  if (!text || refMap.size === 0) return text
  return resolveNodeRefs(text, refMap)
}

// ---------------------------------------------------------------------------
// Camera-motion v2 (graph-aware) — collect prompt hints from connected
// parameter nodes via the source camera-motion node's startState/endState
// input handles. Mirror of the frontend executor (execute-node.ts).
// ---------------------------------------------------------------------------

/**
 * Extract a prompt-hint string from a parameter-style node by dispatching to
 * the shared `getParameterPromptHint`. Backend parameter nodes don't execute,
 * so values come straight from the node's data record.
 *
 * The shared dispatcher is the single source of truth shared with the frontend
 * DAG executor — keep both call sites lined up by editing it instead of this
 * one-line wrapper.
 */
function getNodePromptHint(node: SimpleNode | undefined): string {
  return getParameterPromptHint(node)
}

/**
 * True when the consumer node has a connected Style parameter node on its
 * `cinematography` handle. Mirror of the frontend `hasConnectedStyleNode`.
 * Used to bypass the inline `style` field on image payloads — when a Style
 * node is wired, its richer promptHint is already appended via cinematography
 * hints, so we skip the thin inline `Style: <id>` append.
 */
function hasConnectedStyleNode(
  consumerNodeId: string,
  ctx: PayloadBuildContext | undefined,
): boolean {
  const nodes = ctx?.nodes ?? []
  const edges = ctx?.edges ?? []
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    // Generate Image v2.1 splits `style` into `look` + `elements`; accept all
    // four (legacy + v2 + v2.1) so the connected-style check stays correct
    // across the migration window.
    if (
      edge.targetHandle !== "cinematography" &&
      edge.targetHandle !== "style" &&
      edge.targetHandle !== "look" &&
      edge.targetHandle !== "elements"
    ) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (srcNode?.type === "style") return true
  }
  return false
}

/**
 * Walk the `cinematography` target handle's incoming edges on a consumer node
 * and aggregate one prompt-hint string per connected source. Camera-motion
 * sources are composed via their own startState/endState walk; all other
 * parameter nodes dispatch through `getNodePromptHint`.
 *
 * Mirror of the frontend executor (execute-node.ts:collectCinematographyHints).
 */
/** Video-only cinematography dims; callers targeting still-image consumers
 *  pass these via `options.excludeTypes` to strip incoherent hints. */
const STILL_IMAGE_EXCLUDE_TYPES: ReadonlySet<string> = new Set(["camera-motion", "character-fx", "temporal", "transition"])

function collectCinematographyHints(
  consumerNodeId: string,
  ctx: PayloadBuildContext | undefined,
  options?: { excludeTypes?: ReadonlySet<string>; excludeCharacterElements?: boolean },
): string[] {
  const hints: string[] = []
  const nodes = ctx?.nodes ?? []
  // Prompt Injection off switches (mirror of FE cinematography-hints.ts), gated
  // BY HANDLE: injectLook === false drops the Look family (look / cinematography
  // / style); injectElements === false drops the `elements` handle + character-
  // borne elements. Default ON for both (undefined/true).
  const consumerData = nodes.find((n) => n.id === consumerNodeId)?.data as
    | { injectLook?: boolean; injectElements?: boolean; prompt?: string; negativePrompt?: string }
    | undefined
  const lookOff = consumerData?.injectLook === false
  const elementsOff = consumerData?.injectElements === false
  // Used-as-variable suppression (mirror of FE): a source placed explicitly via
  // `{label}` in the prompt/negative must NOT also auto-inject (no double).
  const referenced = extractReferencedLabels(consumerData?.prompt, consumerData?.negativePrompt)
  const edges = ctx?.edges ?? []
  const exclude = options?.excludeTypes
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    // v2.1: accept `cinematography` / `style` / `look` / `elements` — all four
    // route hints through this same collector at runtime.
    if (
      edge.targetHandle !== "cinematography" &&
      edge.targetHandle !== "style" &&
      edge.targetHandle !== "look" &&
      edge.targetHandle !== "elements"
    ) continue
    // Handle-scoped injection gate: `elements` follows Inject Elements; every
    // other accepted handle is the Look family (Inject Look).
    if (edge.targetHandle === "elements" ? elementsOff : lookOff) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    if (exclude?.has(srcNode.type ?? "")) continue
    // Placed explicitly via `{label}` → skip auto-inject (no double). Canonical
    // (lowercase) so {Foo} suppresses a `foo` node (case-insensitive).
    const srcLabel = canonicalVarName(((srcNode.data as { label?: string } | undefined)?.label) || srcNode.type || srcNode.id)
    if (referenced.has(srcLabel)) continue

    if (srcNode.type === "camera-motion") {
      // Use the shared getParameterPromptHint WITH graph context so the
      // startState/endState walk runs AND the node's preText/postText is applied
      // (withCustomText). The old composeCameraMotionHintForNode bypassed custom
      // text (and dropped everything when no motion was set), so it was lost at
      // execution while the injection preview promised it.
      const composed = getParameterPromptHint(srcNode, { nodes, edges })
      if (composed) hints.push(composed)
      continue
    }

    const hint = getNodePromptHint(srcNode)
    if (hint) hints.push(hint)
  }

  // Character-borne elements: a Character wired into this consumer carries its
  // OWN Assets/Prompt elements (held-prop, styling, …) downstream. Bullet
  // consumers (generate-image / image-to-image / modify-image / video gen)
  // stamp the element onto the character's identity bullet via
  // `ConnectedReference.elementInjection` and pass `excludeCharacterElements:
  // true` so it isn't ALSO appended here (the tail dup was the reported bug).
  // Consumers WITHOUT a character bullet (edit-image, location, …) append it
  // here by DEFAULT — single source (`collectCharacterElementInjections`),
  // preserving their behavior.
  // Character-borne elements follow Inject Elements — skip when disabled.
  if (!options?.excludeCharacterElements && !elementsOff) {
    // Lazy: only resolve when a Character actually feeds this consumer (the
    // common case has none), mirroring the frontend collector.
    const hasWiredCharacter = edges.some((edge) => {
      if (edge.target !== consumerNodeId) return false
      return nodes.find((nd) => nd.id === edge.source)?.type === "character"
    })
    if (hasWiredCharacter) {
      for (const frag of collectCharacterElementInjections(consumerNodeId, ctx).values()) {
        if (frag.trim()) hints.push(frag.trim())
      }
    }
  }

  return hints
}

/**
 * Audio-style aggregator. Mirror of the frontend `collectAudioStyleHints` —
 * delegates to the shared composer so the canvas preview and orchestrator
 * runs produce byte-identical prompt enrichment for the 4 audio consumers
 * (suno-generate, generate-music, voice-design, text-to-audio).
 */
function collectAudioStyleHints(
  consumerNode: SimpleNode,
  consumerType: SoundConsumerType,
  ctx: PayloadBuildContext | undefined,
): SoundComposition {
  const allNodes = ctx?.nodes ?? []
  const allEdges = ctx?.edges ?? []
  return composeSoundHintFromConnections(
    { id: consumerNode.id, type: consumerNode.type, data: consumerNode.data },
    consumerType,
    {
      nodes: allNodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
      edges: allEdges.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    },
  )
}

/**
 * Walk upstream Character nodes and return the strongest identityLock clause
 * (or empty string). Mirror of frontend `collectIdentityLockClause` —
 * delegates to the shared implementation but adapts the `(nodeId, ctx)`
 * call signature used elsewhere in this file.
 */
function collectIdentityLockClause(consumerNodeId: string, ctx: PayloadBuildContext | undefined): string {
  if (!ctx?.nodes || !ctx?.edges) return ""
  return sharedCollectIdentityLockClause(consumerNodeId, ctx.nodes, ctx.edges)
}

/**
 * B4b: run any registered PromptPolicy over an orchestrator image-assembly
 * result (`{ prompt, nativeNegativePrompt }` from `assembleImageInput` /
 * `buildImagePrompt`). One helper at every image-assembly site keeps the
 * server-authority hook DRY and drift-resistant — hooking only some sites
 * re-opens the "server is the authority" hole for the unhooked cases. No policy
 * registered = identity, so mainline is byte-identical.
 */
function withImagePromptPolicy<T extends { prompt: string; nativeNegativePrompt?: string }>(r: T): T {
  const pp = applyPromptPolicies({ prompt: r.prompt, negativePrompt: r.nativeNegativePrompt ?? "", kind: "image" })
  return { ...r, prompt: pp.prompt, nativeNegativePrompt: pp.negativePrompt || undefined }
}

/**
 * Narrow-read a video node's STORED cinematic-direction / structured ids into
 * the two `composeVideoPrompt` levers, as a SPREADABLE object (P4b).
 *
 * ONE helper rather than a pair of `readX(data.y)` calls per case: the
 * generate-video family has FOUR fold sites in this file (image-to-video,
 * text-to-video, generate-video, and generate-video's LTX early return), and a
 * site that read only some of the three levers would silently fold part of a
 * node's stored look. `data` is untrusted persisted JSONB — the readers drop
 * junk rather than throwing, and return `undefined` (never `{}`) so the spreads
 * below omit the key entirely for a node that carries neither.
 */
function readNodeDirectionLevers(data: WorkflowNodeData): {
  direction?: DirectionFields
  subject?: SubjectFields
  structured?: StructuredPromptFields
} {
  const direction = readDirectionFields(data.direction)
  const subject = readSubjectFields(data.subject)
  const structured = readStructuredFields(data.structured)
  return {
    ...(direction !== undefined ? { direction } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(structured !== undefined ? { structured } : {}),
  }
}

/**
 * Compose a video-generation prompt: merge user prompt + cinematography hints
 * + identity-lock clause. Used by both the legacy image-to-video / text-to-video
 * cases AND the new generate-video case so all three emit identical text.
 *
 * The optional `motionHint` is prepended to the cinematography hint list before
 * joining — so an i2v node with `motion="zoom"` and a connected camera hint
 * "tracking shot" emits `"<user>. zoom motion, tracking shot"` (single sentence,
 * comma-separated). Without the motion hint, behaviour matches t2v exactly:
 * `"<user>. <cine1>, <cine2>"`.
 *
 * Caller is responsible for any provider-specific motion/data fallback chains
 * (e.g. i2v's `data.motionPrompt` initial fallback) — pass them as `rawPrompt`.
 *
 * `direction` / `subject` / `structured` are the node's STORED cinematic and
 * subject ids (P4b / P6 — the video twin of the image side's node-data levers). They are OPT-IN per
 * caller, not read here: only the generate-video family (`generate-video` and
 * its two legacy modes) passes them, so `generate-video-pro` — the ONLY other
 * case that funnels through this helper — keeps its exact text. The video cases
 * that compose their prompt inline instead (v2v, s2v…) never reach this helper
 * at all, so they are untouched by construction. The frontend, which has no
 * equivalent single funnel, mirrors that set branch-for-branch.
 * Passing neither is an exact no-op (`composeVideoPromptText` hands the body
 * back verbatim, `undefined` included).
 */
function composeVideoPrompt(args: {
  rawPrompt: string | undefined
  nodeId: string
  buildCtx: PayloadBuildContext | undefined
  motionHint?: string | undefined
  direction?: DirectionFields | undefined
  subject?: SubjectFields | undefined
  structured?: StructuredPromptFields | undefined
}): string | undefined {
  let p = args.rawPrompt
  const hints: string[] = []
  if (args.motionHint) hints.push(args.motionHint)
  // Video gen is a bullet consumer (stamps character elements onto the video
  // ref) → exclude them here to avoid a prompt-tail dup.
  const cinematographyHints = collectCinematographyHints(args.nodeId, args.buildCtx, { excludeCharacterElements: true })
  for (const h of cinematographyHints) hints.push(h)
  if (hints.length > 0) {
    const joined = hints.join(", ")
    p = p ? `${p}. ${joined}` : joined
  }
  const identityClause = collectIdentityLockClause(args.nodeId, args.buildCtx)
  if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
  // Stored cinematic-direction / structured ids fold LAST — on the fully
  // graph-composed body, AFTER the wired picker hints and the identity clause
  // and BEFORE the prompt policy. That is exactly where the image side folds
  // them (`assembleImageInput` runs on the graph-composed `rawPrompt`, inside
  // `withImagePromptPolicy`), and it is before `resolveVideoPromptMentions`
  // frames the body with identity directives — see `assemble-video-input.ts`.
  p = composeVideoPromptText(p, args.direction, args.structured, {
    ...(args.subject !== undefined ? { subject: args.subject } : {}),
  })
  // B4b: apply any registered PromptPolicy at the single orchestrator video
  // funnel (i2v/t2v/generate-video/gvp all pass through here). An absent prompt stays
  // undefined — no policy on nothing. No policy registered = identity.
  if (p === undefined) return p
  return applyPromptPolicies({ prompt: p, negativePrompt: "", kind: "video" }).prompt
}

/**
 * The provider a node will ACTUALLY dispatch (and be billed for) — the single
 * place that decides "which model does this node dispatch". Only `text-to-speech`
 * diverges from `data.provider`: its case dispatches
 * `resolvedInputs.provider || data.provider || "elevenlabs-v3"`, and
 * input-resolver auto-injects a wired Character/creature node's recommended TTS
 * provider into `resolvedInputs.provider` (a FieldMapping can inject it too), so
 * a denied model reaches dispatch through an UNSET `data.provider`. The surface
 * MODEL-deny backstop must consult this same value or that path bypasses it.
 *
 * Every OTHER node type dispatches on `data.provider` alone — this deliberately
 * does NOT read `resolvedInputs.provider` for them, so a node that merely carries
 * an unrelated `resolvedInputs.provider` is never falsely denied. Uses `||` to
 * mirror the TTS case's precedence byte-for-byte (an empty-string provider must
 * fall through exactly as dispatch does). The hardcoded `"elevenlabs-v3"` default
 * is intentionally NOT folded in — see the backstop's `typeof` guard.
 *
 * Exported so B3's egress-key derivation can consume the same helper later.
 */
export function effectiveDispatchProvider(
  nodeType: string,
  data: WorkflowNodeData | undefined,
  resolvedInputs: Pick<ResolvedInputs, "provider"> | undefined,
): string | undefined {
  const raw = data?.provider
  const dataProvider = typeof raw === "string" ? raw : undefined
  if (nodeType === "text-to-speech") {
    return resolvedInputs?.provider || dataProvider
  }
  return dataProvider
}

export function buildPayload(
  node: SimpleNode,
  jobId: string,
  resolvedInputs: ResolvedInputs,
  usageLogId?: string,
  buildCtx?: PayloadBuildContext,
): PayloadResult {
  const data = node.data
  const type = node.type

  // Deployment surface deny (B1): a workflow row / import / template can reach
  // buildPayload with a denied node WITHOUT passing a write guard (write guards
  // reject new saves; discovery hides it). Reject at run time with the friendly,
  // coded error so ANY denied type fails honestly — not just the fall-through
  // cases the switch default catches.
  if (isNodeDenied(type)) {
    const err = new Error(deniedNodeRejectionMessage([type])) as Error & { code?: string }
    err.code = "node_not_available"
    throw err
  }

  // Deployment surface MODEL deny (B1): node deny has a run-time backstop above,
  // but model deny was discovery-only — a denied model still runs + bills when its
  // `provider` arrives via an imported/templated workflow row or a FieldMapping-
  // injected value (never passing a write guard). Check the EFFECTIVE dispatched
  // provider (not just `data.provider`) so the text-to-speech case — which
  // dispatches an auto-wired `resolvedInputs.provider` ahead of `data.provider` —
  // can't slip a denied model through an unset `data.provider`. Throw here too,
  // mirroring the node-deny shape exactly, so a denied model fails honestly at run.
  const dispatchProvider = effectiveDispatchProvider(type, data, resolvedInputs)
  if (typeof dispatchProvider === "string" && isModelDenied(dispatchProvider)) {
    const err = new Error(deniedModelRejectionMessage([dispatchProvider])) as Error & { code?: string }
    err.code = "model_not_available"
    throw err
  }

  // Build label→output map for resolving {Node Label} refs in text fields
  const refMap = buildNodeRefMap(node.id, buildCtx)
  // Pre-resolve refs in the upstream prompt so all downstream code sees clean text
  if (resolvedInputs.prompt && refMap.size > 0) {
    resolvedInputs.prompt = resolveRefs(resolvedInputs.prompt, refMap)
  }

  // Typed-primary prompt resolution for single-prompt nodes (precedence:
  // override > typed candidate fields > wired). Shared with the frontend
  // executor via @nodaro/shared so field-selection + precedence are
  // structurally identical. Each single-prompt case below calls promptFor(type).
  const nodeLabel = (data.label as string | undefined) || type
  const promptFor = (nodeType: string, appendWired?: boolean) => {
    // §4.6: settle the node's OWN typed fields (and its promptPrefix /
    // promptSuffix) BEFORE composing. The wired / override values below are
    // DATA and flow through untouched — see settleAuthoredPromptFields.
    return computeNodePrompt(
      nodeType,
      settleAuthoredPromptFields(nodeType, data, refMap, buildCtx, nodeLabel),
      {
        wired: resolvedInputs.prompt,
        override: resolvedInputs.overridePrompt,
        refMap,
        appendWired,
      },
    )
  }

  // Required media inputs (B3): refuse an empty upstream HERE, before the
  // credit reservation, instead of letting `undefined` reach ffmpeg / the
  // provider. Mirrors the frontend single-node engine's per-node refusals.
  assertRequiredMediaInputs(type, resolvedInputs, data)

  // §4.6 DELIBERATELY STOPS HERE for `resolvedInputs.prompt`. It arrived as
  // DATA — the wired output of an upstream node — so a `{` in it is a character
  // that node emitted, not a reference anyone typed. Running the refusal over it
  // blocked the everyday "Generate Text emits JSON -> LLM Chat reformats it"
  // flow with an escape (`{name || fallback}`) nobody could reach. Only the
  // node's OWN typed fields are settled, inside `promptFor` above — which stays
  // AFTER the media guard: a run that is both missing a required input and
  // carrying a dangling typed reference reports the missing media first (the
  // input the user must supply), and both fire before any reservation.

  switch (type) {
    // --- Image generation ---
    case "generate-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      const settings = buildCtx?.settings
      // Last-mile guard on the catalog-governed levers. The config panel snaps
      // these when the provider changes, but that only runs when the panel is
      // mounted — and `aspectRatio` / `provider` are BOTH MappableFields, so a
      // FieldMapping can inject either at run time, after every UI guard is out
      // of the picture. Normalizing here is the only place that covers that.
      // Feeds the credit identifier too, so we bill for what we actually send.
      const imageParams = normalizeModelInput(provider, {
        aspectRatio: data.aspectRatio as string | undefined,
        resolution: data.resolution as string | undefined,
        quality: data.quality as string | undefined,
      })
      if (imageParams.adjustments.length > 0) {
        console.warn(
          `[payload-builder] ${node.id} (${provider}): ` +
          imageParams.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
        )
      }

      // Build a map of all available reference images by ID
      const refUrlMap = new Map<string, string>()

      // Manual uploads (new multi-image format: ManualReferenceImage[])
      const manualRefs = data.referenceImageUrls as Array<{ id: string; url: string }> | undefined
      if (manualRefs?.length) {
        for (const img of manualRefs) {
          refUrlMap.set(img.id, img.url)
        }
      }
      // Legacy single referenceImageUrl
      const nodeRefUrl = data.referenceImageUrl as string | undefined
      if (nodeRefUrl && refUrlMap.size === 0) {
        refUrlMap.set("__legacy__", nodeRefUrl)
      }
      // Wired upstream images — use source node IDs as keys (matching frontend)
      const chainRefs = resolvedInputs.referenceImageUrls
        ?? (resolvedInputs.imageUrl ? [resolvedInputs.imageUrl] : undefined)
      // Is the `wiredSourceIds` ↔ `chainRefs` zip below actually 1:1? See the
      // long note at its assignment — it gates the NAME lookup only, never the
      // keys themselves.
      let wiredZipIsOneToOne = true
      if (chainRefs) {
        const imageSourceTypes = new Set(["upload-image", "generate-image", "edit-image", "image-to-image", "modify-image", "upscale-image", "remove-background", "extract-frame"])
        const wiredSourceIds = (buildCtx?.edges ?? [])
          .filter((e) => e.target === node.id)
          .map((e) => (buildCtx?.nodes ?? []).find((n) => n.id === e.source))
          .filter((n): n is SimpleNode => !!n && imageSourceTypes.has(n.type))
          .map((n) => n.id)
        // The zip is POSITIONAL and only correct when every URL in `chainRefs`
        // came from a DISTINCT `imageSourceTypes` upstream, in edge order. Two
        // shapes break it, both real: an upstream that contributes MORE than one
        // URL (`reference-sheet` spreads its whole `panels` set, `generate-script`
        // its whole `images` set — see input-resolver), and an upstream whose
        // type is not in the set at all (both of those, again) — either shifts
        // every later position.
        //
        // Mis-keying used to be inert: the id only fed `referenceImageOrder`
        // matching. P3 made the id carry the source node's LABEL, and the label
        // is exactly what `@<name-slug>:<index>` binds to — so a shifted zip
        // would silently bind a mention to the WRONG image, with no error.
        //
        // Guard, not repair: the keys stay byte-identical (repairing them would
        // move `referenceImageOrder` matching under every existing graph), and
        // a non-1:1 zip simply forfeits the NAME lookup below. The mention then
        // finds nothing to bind and stays literal text — pre-P3 behavior, and
        // the safe direction to fail in.
        //
        // Known bound of the heuristic: a URL-contributing NON-image upstream
        // paired with an image-type upstream that contributes ZERO URLs gives
        // equal lengths while still being misaligned. Constructible, not
        // reachable through the two confirmed multi-URL sources above.
        wiredZipIsOneToOne = wiredSourceIds.length === chainRefs.length
        for (let i = 0; i < chainRefs.length; i++) {
          const key = wiredSourceIds[i] ?? `wired_${i}`
          refUrlMap.set(key, chainRefs[i])
        }
      }
      const extractedRefs = data.extractedReferenceUrls as string[] | undefined
      if (extractedRefs) {
        for (let i = 0; i < extractedRefs.length; i++) {
          refUrlMap.set(`extracted_${i}`, extractedRefs[i])
        }
      }
      // Character reference images
      const charIds = (data.characterDefinitionIds as string[]) ?? []
      const charDefs = (settings?.characterDefinitions ?? []).filter(
        (c) => charIds.includes(c.id),
      )
      for (const c of charDefs) {
        if (c.type === "reference" && c.referenceImageUrl) {
          refUrlMap.set(`char_${c.id}`, c.referenceImageUrl)
        }
      }

      // Apply ordering: use referenceImageOrder if set, otherwise default map order
      const orderIds = (data.referenceImageOrder as string[]) ?? []
      const directRefs: string[] = []
      const seen = new Set<string>()
      for (const id of orderIds) {
        const url = refUrlMap.get(id)
        if (url) {
          directRefs.push(url)
          seen.add(id)
        }
      }
      for (const [id, url] of refUrlMap) {
        if (!seen.has(id)) directRefs.push(url)
      }

      // Ancestor refs fallback
      const ancestorRefs = directRefs.length === 0 && buildCtx?.nodes && buildCtx?.edges && buildCtx?.nodeStates
        ? collectAncestorRefs(node.id, buildCtx.nodes, buildCtx.edges, buildCtx.nodeStates)
        : []

      let rawPrompt = promptFor("generate-image", true)
      {
        // Bullet consumer (stamps character elements onto the ref) → exclude here.
        const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES, excludeCharacterElements: true })
        if (cinematographyHints.length > 0) {
          const joined = cinematographyHints.join(", ")
          rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined
        }
      }
      {
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) rawPrompt = rawPrompt ? `${rawPrompt} ${identityClause}` : identityClause
      }

      // Wired-character @-mention expansion: when an upstream Character node
      // is wired, ALWAYS route through `connectedReferences` so buildImagePrompt's
      // Phase 0 applies the per-character contract uniformly:
      //   - mentioned (`@kira:N:smile`) → variant URL only, no canonical.
      //   - unmentioned wired character → canonical URL via the default
      //     fallback (matches pre-mention behavior of "wire = use it").
      // This is the path the frontend takes too — keeping them aligned is the
      // entire point of running the workflow through the orchestrator producing
      // identical output to a frontend single-node run.
      // We ALSO route through `connectedReferences` when user-attached extras
      // exist (even without a wired character) — extras need the dedicated
      // directive emission in `buildExtraRefDirectives`.
      const wiredCharRefs = expandWiredCharacterRefs(node.id, buildCtx)
      // Phase 2 #1: location canonical-description injection. Prepend wired
      // Location refs so the directive builder emits "Image N (location —
      // <canonical>)" bullets. URL-dedupe in the connected-refs builder
      // keeps a Location's main image URL from appearing twice if it also
      // arrived via the chainRefs path.
      const wiredLocRefs = expandWiredLocationRefs(node.id, buildCtx)
      const wiredObjCreatureRefs = expandWiredObjectCreatureRefs(node.id, buildCtx)
      const extraRefEntries = expandExtraRefsToConnectedReferences(
        readExtraRefs(data),
        buildExtraRefCharacterContextLookup(node.id, buildCtx),
      )
      const hasWiredCharacter = wiredCharRefs.length > 0
      // Built UNCONDITIONALLY (in-memory, cheap) so the image-mention gate
      // below derives its slugs from the SAME reference list the assembler
      // would see — the two can never disagree about whether a prompt carries
      // a resolvable mention.
      const generateConnectedRefs = [
        ...buildConnectedRefsForGenerate(
          wiredCharRefs,
          refUrlMap,
          orderIds,
          wiredLocRefs,
          wiredObjCreatureRefs,
          // Names ONLY when the `wiredSourceIds` ↔ `chainRefs` zip is 1:1 —
          // otherwise a node id in `refUrlMap` points at another node's URL and
          // the label would bind a mention to the wrong image (see the guard's
          // note at the zip). Empty map ⇒ every entry keeps its id as its name,
          // byte-identically to before P3, and the mention stays literal.
          wiredZipIsOneToOne ? buildRefNameLookup(buildCtx) : new Map(),
        ),
        ...extraRefEntries,
      ]
      // P3 — FE/BE parity. An images-only graph (no wired character, no extras)
      // used to take the FLAT branch below, so `connectedReferences` never
      // reached `buildImagePrompt` and a named-image mention that resolves on a
      // frontend single-node Run shipped as LITERAL TEXT through the
      // orchestrator's identical DAG run. Route through the structured branch
      // when — and ONLY when — the prompt carries a resolvable image mention,
      // so every mention-free graph keeps its exact branch and byte output.
      // Hybrid-gated on the same signal as the route and the Phase-0 arm, so
      // this is always false under NODE_ENV=test / IMAGE_REFERENCE_FORMAT=legacy.
      //
      // `rawPrompt` is the right input: it is graph-composed above (hints +
      // identity clause folded in) and is exactly what is passed as
      // `userPrompt` to `assembleImageInput` below.
      const hasImageMention =
        backendHybridRoles()
        && findImageMentionTokens(rawPrompt, knownImageSlugsFromRefs(generateConnectedRefs)).length > 0
      // Same parity argument for wired-creature / wired-object mentions. A graph
      // whose only refs are entities (no wired character, no extras) takes the
      // FLAT branch, so an `@creature` mention that resolves on a frontend
      // single-node Run would ship as LITERAL TEXT through the orchestrator's
      // identical DAG run. Derived by the SAME `knownEntitySlugsFromRefs` the
      // Phase-0 arm uses, over the SAME `generateConnectedRefs`, so the two can
      // never disagree about whether the prompt carries a resolvable mention.
      const hasEntityMention =
        backendHybridRoles()
        && findEntityMentionTokens(rawPrompt, knownEntitySlugsFromRefs(generateConnectedRefs)).length > 0
      const useConnectedRefs =
        hasWiredCharacter || extraRefEntries.length > 0 || hasImageMention || hasEntityMention

      // ─── Character LoRA routing decision (see design §6.3) ─────────────
      // EXACTLY ONE distinct character mentioned AND that character has a
      // succeeded LoRA → swap to replicate/flux-lora-character, skip ref
      // injection, strip mention tokens, prepend trigger word.
      // Gated by CHARACTER_LORA_ROUTING_ENABLED (default true) — operators
      // can flip the env to "false" to disable the swap org-wide without
      // a deploy if inference quality regresses.
      const lora = config.CHARACTER_LORA_ROUTING_ENABLED
        ? selectLoraRoutingForMentions(wiredCharRefs)
        : null
      const effectiveProvider = lora ? "replicate" : provider
      const loraExtras = lora
        ? {
            lora_version: lora.loraVersion,
            lora_trigger: lora.triggerWord,
          }
        : undefined

      // Use shared prompt builder (single source of truth with frontend)
      const styleBypass = hasConnectedStyleNode(node.id, buildCtx)
      const generateRefOrder = readStringArray(data.referenceOrder)
      const generateSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
      const generateSuppressedLoc = readStringArray(data.suppressedCanonicalLocationIds)
      // Node-data cinematic direction / structured fields (spec D3): the node
      // carries picker IDS, not baked hint text — the fold happens once, inside
      // `assembleImageInput`. Narrow-read: `data` is untrusted persisted JSON.
      // NOT gated by `injectLook` — that switch documents WIRED HANDLES
      // (`collectCinematographyHints` above); stored direction is node-local
      // look data, like `data.style`, and folds regardless.
      const generateDirection = readDirectionFields(data.direction)
      const generateSubject = readSubjectFields(data.subject)
      const generateStructured = readStructuredFields(data.structured)
      // Shared node-input assembly (WI-1a) — single source of truth with the
      // frontend execute-node + Studio. `rawPrompt` is already graph-composed
      // (cinematography hints + identity clause folded above), passed as
      // `userPrompt` plus the node's STORED `direction`/`subject`/`structured` ids
      // (absent on every node authored before the canvas honored them, in which
      // case the composer is a no-op and the result is byte-identical to the
      // previous inline `buildImagePrompt` calls). No `throwOnEmpty` — the
      // orchestrator never rejected an empty prompt here.
      const rawImageResult = useConnectedRefs
        ? assembleImageInput({
            userPrompt: rawPrompt,
            provider: effectiveProvider,
            style: styleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            // Negative: typed ({label} resolved) + wired connected-negative both
            // emitted; input-resolver dropped referenced / Inject-Negative-off.
            negativePrompt: composeNegative(resolveRefs(typeof data.negativePrompt === "string" ? data.negativePrompt : undefined, refMap), resolvedInputs.negativePrompt) || undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            // BE gate: workflow-run image assembly honors hybrid roles on the
            // SAME env signal as the route (`generate-image.ts`) + video path
            // (`backendHybridRoles()` in reference-format.ts). False under
            // NODE_ENV=test/production → legacy block (dark in prod). Placed
            // before any explicit `referenceFormat` so it never overrides one.
            ...(backendHybridRoles() ? { referenceFormat: "hybrid" as const } : {}),
            connectedReferences: generateConnectedRefs,
            ancestorRefs,
            referenceOrder: generateRefOrder,
            suppressedCanonicalCharacterIds: generateSuppressed,
            suppressedCanonicalLocationIds: generateSuppressedLoc,
            ...(generateDirection !== undefined ? { direction: generateDirection } : {}),
            ...(generateSubject !== undefined ? { subject: generateSubject } : {}),
            ...(generateStructured !== undefined ? { structured: generateStructured } : {}),
            // LoRA path: skip mention machinery (trigger word + LoRA carry identity).
            skipCharacterMentions: lora !== null,
          })
        : assembleImageInput({
            userPrompt: rawPrompt,
            provider: effectiveProvider,
            style: styleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            // Negative: typed ({label} resolved) + wired connected-negative both
            // emitted; input-resolver dropped referenced / Inject-Negative-off.
            negativePrompt: composeNegative(resolveRefs(typeof data.negativePrompt === "string" ? data.negativePrompt : undefined, refMap), resolvedInputs.negativePrompt) || undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            // BE gate: same env signal as the connected-refs branch above.
            ...(backendHybridRoles() ? { referenceFormat: "hybrid" as const } : {}),
            extraReferenceImageUrls: directRefs,
            ancestorRefs,
            referenceOrder: generateRefOrder,
            suppressedCanonicalCharacterIds: generateSuppressed,
            suppressedCanonicalLocationIds: generateSuppressedLoc,
            ...(generateDirection !== undefined ? { direction: generateDirection } : {}),
            ...(generateSubject !== undefined ? { subject: generateSubject } : {}),
            ...(generateStructured !== undefined ? { structured: generateStructured } : {}),
          })
      const result = withImagePromptPolicy(rawImageResult)

      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: lora
          ? FLUX_LORA_CHARACTER_MODEL_ID
          : resolveImageGenCreditIdentifier({
              provider,
              quality: imageParams.quality,
              resolution: imageParams.resolution,
              renderingSpeed: data.renderingSpeed as string | undefined,
              // refCount = the assembled refs actually sent to the worker, and
              // swapToI2i mirrors the route's T2I→I2I auto-swap when refs attach.
              // Flux 2 bills per ref with NO metered true-up, so omitting these
              // (the old 4-arg call) under-charged every Flux 2 workflow run.
              refCount: result.referenceImageUrls?.length ?? 0,
              swapToI2i: true,
            }),
        payload: {
          jobId,
          prompt: result.prompt,
          // LoRA path emits zero refs — the trained LoRA + trigger word carry identity.
          referenceImageUrls: lora ? [] : result.referenceImageUrls,
          provider: effectiveProvider,
          // Hand the synthetic model id to the Replicate provider when LoRA is
          // active. Otherwise pass `undefined` so the worker falls back to
          // `provider` for routing — `data.model` is a frontend DISPLAY name
          // (e.g. "gemini-2.5-flash-image" for "nano-banana") and is NOT a
          // valid provider/router model identifier. Matches the single-node
          // route at `routes/generate-image.ts:288`.
          model: lora ? FLUX_LORA_CHARACTER_MODEL_ID : undefined,
          aspectRatio: imageParams.aspectRatio,
          resolution: imageParams.resolution,
          quality: imageParams.quality,
          negativePrompt: result.nativeNegativePrompt,
          seed: data.seed,
          renderingSpeed: data.renderingSpeed,
          styleType: data.styleType,
          expandPrompt: data.expandPrompt,
          // Inpaint fields — carried through identically to image-to-image so a
          // workflow run produces the same payload as the single-node
          // /v1/generate-image route (routes/generate-image.ts:636).
          baseImageUrl: resolvedInputs.baseImageUrl || (data.baseImageUrl as string | undefined),
          maskUrl: resolvedInputs.maskUrl || (data.maskUrl as string | undefined),
          strength: data.strength,
          guidanceScale: data.guidanceScale,
          // Pass lora_version + lora_trigger through to ReplicateImageProvider.buildInput.
          extraParams: loraExtras,
          usageLogId,
        },
      }
    }

    // --- Reference board: single-pass image generation (same flow as generate-image) ---
    case "reference-board": {
      const provider = (data.provider as string) ?? "nano-banana-pro"
      const rawPrompt = promptFor("reference-board")

      // Collect manual reference images
      const refUrls: string[] = []
      const manualRefs = data.referenceImageUrls as Array<{ id: string; url: string }> | undefined
      if (manualRefs?.length) {
        for (const img of manualRefs) refUrls.push(img.url)
      }
      const chainRefs = resolvedInputs.referenceImageUrls
        ?? (resolvedInputs.imageUrl ? [resolvedInputs.imageUrl] : undefined)
      if (chainRefs) {
        for (const url of chainRefs) refUrls.push(url)
      }

      return {
        jobName: "reference-board",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(
          provider,
          data.quality as string | undefined,
          data.resolution as string | undefined,
        ),
        payload: {
          jobId,
          prompt: rawPrompt,
          referenceImageUrls: refUrls,
          provider,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: data.negativePrompt,
          seed: data.seed,
          boardTemplate: data.boardTemplate,
          entityName: data.entityName,
          entityDescription: data.entityDescription,
          usageLogId,
        },
      }
    }

    case "edit-image": {
      const provider = (data.provider as string) ?? "recraft-upscale"

      // Same last-mile catalog snap as generate-image / image-to-image — see the
      // comment there. Aspect-only on this branch: `targetResolution` is an
      // UPSCALE target (a different field the catalog does not govern) and it is
      // what `buildCreditModelIdentifier` prices on, so the snap is billing-
      // neutral here. It still matters: the upscalers, remove-bg and the grok
      // task-chained ops declare NO `aspectRatios`, so a ratio a FieldMapping
      // injected at run time was forwarded upstream as `image_size` on models
      // that have no such lever. Mirrors `routes/edit-image.ts`.
      const editParams = normalizeModelInput(provider, {
        aspectRatio: data.aspectRatio as string | undefined,
      })
      if (editParams.adjustments.length > 0) {
        console.warn(
          `[payload-builder] ${node.id} (${provider}): ` +
          editParams.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
        )
      }

      // Apply connectedMediaOrder to determine main image vs references
      let mainImageUrl = resolvedInputs.imageUrl || data.imageUrl
      let editRefUrls: string[] | undefined
      const connectedOrder = data.connectedMediaOrder as string[] | undefined
      if (connectedOrder?.length && resolvedInputs.referenceImageUrls?.length) {
        const allNodes = buildCtx?.nodes ?? []
        const allEdges = buildCtx?.edges ?? []
        const states = buildCtx?.nodeStates ?? {}
        const sourceNodeIds = allEdges
          .filter((e) => e.target === node.id)
          .map((e) => e.source)
        const sourceNodes = sourceNodeIds
          .map((id) => allNodes.find((n) => n.id === id))
          .filter((n): n is SimpleNode => !!n)
        const ordered = applyOrder(sourceNodes, connectedOrder)
        const orderedUrls = ordered
          .map((n) => getNodeImageUrl(n, states))
          .filter((u): u is string => !!u)
        if (orderedUrls.length > 0) {
          mainImageUrl = orderedUrls[0]
          editRefUrls = orderedUrls.slice(1)
        }
      }

      let editPrompt = (resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)) as string | undefined
      if (provider === "nano-banana-edit" && editPrompt) {
        const charIds = (data.characterDefinitionIds as string[]) ?? []
        const charDefs = (buildCtx?.settings?.characterDefinitions ?? []).filter(
          (c: { id: string }) => charIds.includes(c.id),
        )
        if (charDefs.length > 0) {
          const descriptions = charDefs
            .map((c: { name: string; description?: string }) =>
              c.description ? `${c.name}: ${c.description}` : c.name,
            )
            .join("; ")
          editPrompt = `${editPrompt}\n\nContext: ${descriptions}`
        }
      }
      {
        const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
        if (cinematographyHints.length > 0) {
          const joined = cinematographyHints.join(", ")
          editPrompt = editPrompt ? `${editPrompt}. ${joined}` : joined
        }
      }
      {
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) editPrompt = editPrompt ? `${editPrompt} ${identityClause}` : identityClause
      }

      // B4b: fold any registered image PromptPolicy over the FINAL edit prompt +
      // negative prompt — the same server-authority hook the generate-image /
      // image-to-image / modify-image siblings run via withImagePromptPolicy.
      // edit-image was the one image-assembly site left unhooked, so a registered
      // modesty policy was cleanly bypassed by a workflow edit-image node. Applied
      // AFTER the cinematography + identity clauses (policy is the last transform,
      // as at the video funnel). No policy registered = identity (mainline byte-
      // identical); an absent prompt stays absent (no policy on nothing).
      const editNegative = typeof data.negativePrompt === "string" ? data.negativePrompt : undefined
      const editPolicied =
        editPrompt !== undefined
          ? withImagePromptPolicy({ prompt: editPrompt, nativeNegativePrompt: editNegative })
          : { prompt: editPrompt as string | undefined, nativeNegativePrompt: editNegative }
      const targetResolution = data.targetResolution as string | undefined
      // Topaz's only real quality lever is the upscale FACTOR; the legacy
      // `targetResolution` on stored node data has no provider parameter behind
      // it and is mapped forward by the same resolver the route and the worker
      // use, so the reserved tier is the tier that renders.
      const topaz = provider === "topaz-image-upscale"
        ? resolveTopazUpscale({ upscaleFactor: data.upscaleFactor as string | undefined, targetResolution })
        : undefined
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(provider, undefined, undefined, undefined, topaz ? topaz.creditTier : targetResolution),
        payload: {
          jobId,
          imageUrl: mainImageUrl,
          prompt: editPolicied.prompt,
          provider,
          upscaleFactor: topaz ? topaz.upscaleFactor : (data.upscaleFactor as string | undefined),
          targetResolution,
          aspectRatio: editParams.aspectRatio,
          negativePrompt: editPolicied.nativeNegativePrompt,
          style: hasConnectedStyleNode(node.id, buildCtx) ? undefined : data.style,
          seed: data.seed,
          referenceImageUrls: editRefUrls,
          usageLogId,
        },
      }
    }

    case "image-to-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      const settings = buildCtx?.settings
      // Same last-mile guard as generate-image — see the comment there.
      const i2iParams = normalizeModelInput(provider, {
        aspectRatio: data.aspectRatio as string | undefined,
        resolution: data.resolution as string | undefined,
        quality: data.quality as string | undefined,
      })
      if (i2iParams.adjustments.length > 0) {
        console.warn(
          `[payload-builder] ${node.id} (${provider}): ` +
          i2iParams.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
        )
      }

      // Apply connectedMediaOrder to determine main image vs references
      let i2iMainImage = resolvedInputs.imageUrl || data.imageUrl
      let i2iChainRefs = resolvedInputs.referenceImageUrls ?? []
      const i2iOrder = data.connectedMediaOrder as string[] | undefined
      if (i2iOrder?.length && i2iChainRefs.length > 0) {
        const allNodes = buildCtx?.nodes ?? []
        const allEdges = buildCtx?.edges ?? []
        const states = buildCtx?.nodeStates ?? {}
        const srcIds = allEdges.filter((e) => e.target === node.id).map((e) => e.source)
        const srcNodes = srcIds
          .map((id) => allNodes.find((n) => n.id === id))
          .filter((n): n is SimpleNode => !!n)
        const ordered = applyOrder(srcNodes, i2iOrder)
        const orderedUrls = ordered
          .map((n) => getNodeImageUrl(n, states))
          .filter((u): u is string => !!u)
        if (orderedUrls.length > 0) {
          i2iMainImage = orderedUrls[0]
          i2iChainRefs = orderedUrls.slice(1)
        }
      }

      // Collect reference images from character assets
      const charIds = (data.characterDefinitionIds as string[]) ?? []
      const charDefs = (settings?.characterDefinitions ?? []).filter(
        (c) => charIds.includes(c.id),
      )
      const charRefUrls = charDefs
        .filter((c) => c.type === "reference" && c.referenceImageUrl)
        .map((c) => c.referenceImageUrl as string)
      const nodeRefUrl = data.referenceImageUrl as string | undefined
      const directRefs = [
        ...(nodeRefUrl ? [nodeRefUrl] : []),
        ...i2iChainRefs,
        ...charRefUrls,
      ]

      let rawPrompt = resolveRefs(resolvedInputs.prompt as string | undefined, refMap)
        || resolveRefs(data.prompt as string | undefined, refMap)
        || ""
      {
        // Bullet consumer (stamps character elements onto the ref) → exclude here.
        const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES, excludeCharacterElements: true })
        if (cinematographyHints.length > 0) {
          const joined = cinematographyHints.join(", ")
          rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined
        }
      }
      {
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) rawPrompt = rawPrompt ? `${rawPrompt} ${identityClause}` : identityClause
      }

      // Wired-character @-mention expansion: see generate-image case above.
      // Same uniform-path strategy — always route through `connectedReferences`
      // when any wired character exists so the canonical fallback applies for
      // unmentioned characters and frontend/backend parity is preserved.
      const i2iWiredCharRefs = expandWiredCharacterRefs(node.id, buildCtx)
      const i2iWiredLocRefs = expandWiredLocationRefs(node.id, buildCtx)  // Phase 2 #1
      const i2iWiredObjCreatureRefs = expandWiredObjectCreatureRefs(node.id, buildCtx)
      const i2iExtraRefEntries = expandExtraRefsToConnectedReferences(
        readExtraRefs(data),
        buildExtraRefCharacterContextLookup(node.id, buildCtx),
      )
      const i2iUseConnectedRefs =
        i2iWiredCharRefs.length > 0 || i2iWiredLocRefs.length > 0 || i2iExtraRefEntries.length > 0

      // Build prompt with style + character descriptions (same as generate-image)
      const i2iStyleBypass = hasConnectedStyleNode(node.id, buildCtx)
      const i2iRefOrder = readStringArray(data.referenceOrder)
      const i2iSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
      const i2iSuppressedLoc = readStringArray(data.suppressedCanonicalLocationIds)
      const rawI2iResult = i2iUseConnectedRefs
        ? buildImagePrompt({
            prompt: rawPrompt,
            provider,
            style: i2iStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            connectedReferences: [
              ...buildConnectedRefsFromUrls(i2iWiredCharRefs, directRefs, i2iWiredLocRefs, i2iWiredObjCreatureRefs),
              ...i2iExtraRefEntries,
            ],
            ancestorRefs: [],
            referenceOrder: i2iRefOrder,
            suppressedCanonicalCharacterIds: i2iSuppressed,
            suppressedCanonicalLocationIds: i2iSuppressedLoc,
          })
        : buildImagePrompt({
            prompt: rawPrompt,
            provider,
            style: i2iStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            referenceImageUrls: directRefs,
            ancestorRefs: [],
            referenceOrder: i2iRefOrder,
            suppressedCanonicalCharacterIds: i2iSuppressed,
            suppressedCanonicalLocationIds: i2iSuppressedLoc,
          })
      const i2iResult = withImagePromptPolicy(rawI2iResult)

      return {
        jobName: "image-to-image",
        queueName: "video-generation",
        // i2i: the primary `imageUrl` always counts as one reference plus the
        // assembled extras (mirrors routes/image-to-image.ts refCount = 1 +
        // extras). Without this the Flux 2 i2i family billed the :1ref-less
        // cheapest tier in workflow runs.
        modelIdentifier: resolveImageGenCreditIdentifier({
          provider,
          quality: i2iParams.quality,
          resolution: i2iParams.resolution,
          renderingSpeed: data.renderingSpeed as string | undefined,
          refCount: 1 + (i2iResult.referenceImageUrls?.length ?? 0),
          swapToI2i: false,
        }),
        payload: {
          jobId,
          imageUrl: i2iMainImage,
          prompt: i2iResult.prompt,
          referenceImageUrls: i2iResult.referenceImageUrls,
          provider,
          strength: data.strength,
          aspectRatio: i2iParams.aspectRatio,
          resolution: i2iParams.resolution,
          quality: i2iParams.quality,
          negativePrompt: i2iResult.nativeNegativePrompt,
          seed: data.seed,
          renderingSpeed: data.renderingSpeed,
          guidanceScale: data.guidanceScale,
          maskUrl: resolvedInputs.maskUrl || (data.maskUrl as string | undefined),
          usageLogId,
        },
      }
    }

    case "modify-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      // Same last-mile catalog snap as generate-image / image-to-image — see the
      // comment there. Hoisted ABOVE the provider fork so both arms share it:
      // the nano-banana-edit arm sends `aspectRatio`, and the i2i arm feeds
      // `resolution` / `quality` into `resolveImageGenCreditIdentifier`, which
      // prices off the SNAPPED values. Handing that resolver raw data while
      // putting the same raw data in the payload reserved one tier and rendered
      // another, with no upward true-up to correct it.
      const modParams = normalizeModelInput(provider, {
        aspectRatio: data.aspectRatio as string | undefined,
        resolution: data.resolution as string | undefined,
        quality: data.quality as string | undefined,
      })
      if (modParams.adjustments.length > 0) {
        console.warn(
          `[payload-builder] ${node.id} (${provider}): ` +
          modParams.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
        )
      }
      if (provider === "nano-banana-edit") {
        // Same logic as edit-image case for nano-banana-edit

        // Apply connectedMediaOrder to determine main image vs references
        let mainImageUrl = resolvedInputs.imageUrl || data.imageUrl
        let editRefUrls: string[] | undefined
        const connectedOrder = data.connectedMediaOrder as string[] | undefined
        if (connectedOrder?.length && resolvedInputs.referenceImageUrls?.length) {
          const allNodes = buildCtx?.nodes ?? []
          const allEdges = buildCtx?.edges ?? []
          const states = buildCtx?.nodeStates ?? {}
          const sourceNodeIds = allEdges
            .filter((e) => e.target === node.id)
            .map((e) => e.source)
          const sourceNodes = sourceNodeIds
            .map((id) => allNodes.find((n) => n.id === id))
            .filter((n): n is SimpleNode => !!n)
          const ordered = applyOrder(sourceNodes, connectedOrder)
          const orderedUrls = ordered
            .map((n) => getNodeImageUrl(n, states))
            .filter((u): u is string => !!u)
          if (orderedUrls.length > 0) {
            mainImageUrl = orderedUrls[0]
            editRefUrls = orderedUrls.slice(1)
          }
        }

        let editPrompt = applyPromptAffixes((resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)) as string | undefined, readPromptAffixes(data), refMap)
        if (editPrompt) {
          const charIds = (data.characterDefinitionIds as string[]) ?? []
          const charDefs = (buildCtx?.settings?.characterDefinitions ?? []).filter(
            (c: { id: string }) => charIds.includes(c.id),
          )
          if (charDefs.length > 0) {
            const descriptions = charDefs
              .map((c: { name: string; description?: string }) =>
                c.description ? `${c.name}: ${c.description}` : c.name,
              )
              .join("; ")
            editPrompt = `${editPrompt}\n\nContext: ${descriptions}`
          }
        }
        {
          // Bullet consumer (stamps character elements onto the ref) → exclude here.
          const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES, excludeCharacterElements: true })
          if (cinematographyHints.length > 0) {
            const joined = cinematographyHints.join(", ")
            editPrompt = editPrompt ? `${editPrompt}. ${joined}` : joined
          }
        }
        {
          const identityClause = collectIdentityLockClause(node.id, buildCtx)
          if (identityClause) editPrompt = editPrompt ? `${editPrompt} ${identityClause}` : identityClause
        }

        return {
          jobName: "edit-image",
          queueName: "video-generation",
          modelIdentifier: buildCreditModelIdentifier(provider),
          payload: {
            jobId,
            imageUrl: mainImageUrl,
            prompt: editPrompt,
            provider,
            aspectRatio: modParams.aspectRatio,
            negativePrompt: data.negativePrompt,
            style: hasConnectedStyleNode(node.id, buildCtx) ? undefined : data.style,
            seed: data.seed,
            referenceImageUrls: editRefUrls,
            usageLogId,
          },
        }
      } else {
        // All other providers route through image-to-image
        const settings = buildCtx?.settings

        // Apply connectedMediaOrder to determine main image vs references
        let i2iMainImage = resolvedInputs.imageUrl || data.imageUrl
        let i2iChainRefs = resolvedInputs.referenceImageUrls ?? []
        const i2iOrder = data.connectedMediaOrder as string[] | undefined
        if (i2iOrder?.length && i2iChainRefs.length > 0) {
          const allNodes = buildCtx?.nodes ?? []
          const allEdges = buildCtx?.edges ?? []
          const states = buildCtx?.nodeStates ?? {}
          const srcIds = allEdges.filter((e) => e.target === node.id).map((e) => e.source)
          const srcNodes = srcIds
            .map((id) => allNodes.find((n) => n.id === id))
            .filter((n): n is SimpleNode => !!n)
          const ordered = applyOrder(srcNodes, i2iOrder)
          const orderedUrls = ordered
            .map((n) => getNodeImageUrl(n, states))
            .filter((u): u is string => !!u)
          if (orderedUrls.length > 0) {
            i2iMainImage = orderedUrls[0]
            i2iChainRefs = orderedUrls.slice(1)
          }
        }

        // Collect reference images from character assets
        const charIds = (data.characterDefinitionIds as string[]) ?? []
        const charDefs = (settings?.characterDefinitions ?? []).filter(
          (c) => charIds.includes(c.id),
        )
        const charRefUrls = charDefs
          .filter((c) => c.type === "reference" && c.referenceImageUrl)
          .map((c) => c.referenceImageUrl as string)
        const nodeRefUrl = data.referenceImageUrl as string | undefined
        const directRefs = [
          ...(nodeRefUrl ? [nodeRefUrl] : []),
          ...i2iChainRefs,
          ...charRefUrls,
        ]

        let rawPrompt = applyPromptAffixes(
          resolveRefs(resolvedInputs.prompt as string | undefined, refMap)
            || resolveRefs(data.prompt as string | undefined, refMap),
          readPromptAffixes(data), refMap) || ""
        {
          // Bullet consumer (stamps character elements onto the ref) → exclude here.
          const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES, excludeCharacterElements: true })
          if (cinematographyHints.length > 0) {
            const joined = cinematographyHints.join(", ")
            rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined
          }
        }
        {
          const identityClause = collectIdentityLockClause(node.id, buildCtx)
          if (identityClause) rawPrompt = rawPrompt ? `${rawPrompt} ${identityClause}` : identityClause
        }

        // Wired-character @-mention expansion: see generate-image case above.
        // Uniform-path: always use `connectedReferences` when any wired
        // character exists so the per-character contract (mentioned → variant
        // only / unmentioned → canonical fallback) applies in both paths.
        const modWiredCharRefs = expandWiredCharacterRefs(node.id, buildCtx)
        const modWiredLocRefs = expandWiredLocationRefs(node.id, buildCtx)  // Phase 2 #1
        const modWiredObjCreatureRefs = expandWiredObjectCreatureRefs(node.id, buildCtx)
        const modExtraRefEntries = expandExtraRefsToConnectedReferences(
          readExtraRefs(data),
          buildExtraRefCharacterContextLookup(node.id, buildCtx),
        )
        const modUseConnectedRefs =
          modWiredCharRefs.length > 0 || modWiredLocRefs.length > 0 || modExtraRefEntries.length > 0

        const modStyleBypass = hasConnectedStyleNode(node.id, buildCtx)
        const modRefOrder = readStringArray(data.referenceOrder)
        const modSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
        const modSuppressedLoc = readStringArray(data.suppressedCanonicalLocationIds)
        const rawModResult = modUseConnectedRefs
          ? buildImagePrompt({
              prompt: rawPrompt,
              provider,
              style: modStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
              negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
              characterDefs: charDefs as CharacterDef[],
              userTemplates: settings?.userPromptTemplates,
              flowTemplates: settings?.flowPromptTemplates,
              connectedReferences: [
                ...buildConnectedRefsFromUrls(modWiredCharRefs, directRefs, modWiredLocRefs, modWiredObjCreatureRefs),
                ...modExtraRefEntries,
              ],
              ancestorRefs: [],
              referenceOrder: modRefOrder,
              suppressedCanonicalCharacterIds: modSuppressed,
              suppressedCanonicalLocationIds: modSuppressedLoc,
            })
          : buildImagePrompt({
              prompt: rawPrompt,
              provider,
              style: modStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
              negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
              characterDefs: charDefs as CharacterDef[],
              userTemplates: settings?.userPromptTemplates,
              flowTemplates: settings?.flowPromptTemplates,
              referenceImageUrls: directRefs,
              ancestorRefs: [],
              referenceOrder: modRefOrder,
              suppressedCanonicalCharacterIds: modSuppressed,
              suppressedCanonicalLocationIds: modSuppressedLoc,
            })
        const i2iResult = withImagePromptPolicy(rawModResult)

        return {
          jobName: "image-to-image",
          queueName: "video-generation",
          // Same ref-aware identifier as the image-to-image case: primary image
          // + assembled extras (modify-image routes through /v1/image-to-image).
          modelIdentifier: resolveImageGenCreditIdentifier({
            provider,
            quality: modParams.quality,
            resolution: modParams.resolution,
            renderingSpeed: data.renderingSpeed as string | undefined,
            refCount: 1 + (i2iResult.referenceImageUrls?.length ?? 0),
            swapToI2i: false,
          }),
          payload: {
            jobId,
            imageUrl: i2iMainImage,
            prompt: i2iResult.prompt,
            referenceImageUrls: i2iResult.referenceImageUrls,
            provider,
            strength: data.strength,
            aspectRatio: modParams.aspectRatio,
            resolution: modParams.resolution,
            quality: modParams.quality,
            negativePrompt: i2iResult.nativeNegativePrompt,
            seed: data.seed,
            renderingSpeed: data.renderingSpeed,
            guidanceScale: data.guidanceScale,
            maskUrl: resolvedInputs.maskUrl || (data.maskUrl as string | undefined),
            usageLogId,
          },
        }
      }
    }

    case "upscale-image": {
      const provider = (data.provider as string) ?? "recraft-upscale"
      const targetResolution = data.targetResolution as string | undefined
      // Topaz's only real quality lever is the upscale FACTOR; the legacy
      // `targetResolution` on stored node data has no provider parameter behind
      // it and is mapped forward by the same resolver the route and the worker
      // use, so the reserved tier is the tier that renders.
      const topaz = provider === "topaz-image-upscale"
        ? resolveTopazUpscale({ upscaleFactor: data.upscaleFactor as string | undefined, targetResolution })
        : undefined
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(provider, undefined, undefined, undefined, topaz ? topaz.creditTier : targetResolution),
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl,
          provider,
          upscaleFactor: topaz ? topaz.upscaleFactor : (data.upscaleFactor as string | undefined),
          targetResolution,
          usageLogId,
        },
      }
    }

    case "remove-background": {
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: "recraft-remove-bg",
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl,
          provider: "recraft-remove-bg",
          usageLogId,
        },
      }
    }

    // --- Video generation ---
    case "image-to-video": {
      const provider = (data.provider as string) ?? "kling"
      const hasVideoRef = (resolvedInputs.referenceVideoUrls?.length ?? 0) > 0
      // Compose the prompt first so we can run @-mention resolution against
      // it before the worker sees the final string. The mention pass swaps
      // `@kira-smile` for "Kira" + prepends a "Use these characters:" block
      // + returns variant/canonical URLs to slot into the worker payload.
      const i2vRawPrompt = promptFor("image-to-video")
      let i2vPrompt = composeVideoPrompt({
        rawPrompt: i2vRawPrompt,
        nodeId: node.id,
        buildCtx,
        motionHint: data.motionEnabled && data.motion ? `${data.motion} motion` : undefined,
        // Node-data cinematic direction / structured ids (P4b). Narrow-read:
        // `data` is untrusted persisted JSON. A generate-video node re-typed to
        // i2v by the FE lands in THIS case's frontend twin, so the legacy
        // standalone node must honor the same stored ids or the two diverge.
        ...readNodeDirectionLevers(data),
      })
      // Resolve `{image:N}` body tokens for ref-capable providers (FE↔BE parity
      // with execute-node.ts / video-prompt-assembly.ts). Pass the per-handle
      // EDGE count so in-range tokens bind to `@image_N`; non-ref → 0 so the core
      // bare-labels (the parity-equivalent of the FE's `stripVideoImageTokens`,
      // without a BE strip). 0 (not undefined) also forces bare-label when a
      // character is wired, matching the FE strip.
      const i2vSupportsRefs = !!provider && hasFeature(provider, "reference-image")
      // i2v has two slots: (1) `imageUrl` is the primary input frame, (2)
      // `referenceImageUrls` is an additional pool that maxRefImages-aware
      // providers consume. Existing frames/refs from upstream win — mentions
      // augment, never overwrite. When no `imageUrl` is wired yet, the first
      // resolved mention URL fills that slot. The base frame + leading plain refs
      // are computed BEFORE the resolver so the asset directive ordinals can be
      // offset past the leading refs (D5). i2v OWNS the URL merge (frame-promotion
      // below), so the core only OFFSETS the numbering (`ordinalOffset`) — it does
      // NOT prepend the leading refs. The reorder walks the image-reference edges
      // via the shared `referenceModalityForHandle` SoT (honoring BOTH the legacy
      // `references` handle AND the canonical `imageReferences` one a generate-video
      // re-typed to i2v wires) — frame (start/end) connections (modality null) are
      // never touched.
      const i2vBaseImage = resolvedInputs.startFrameUrl || resolvedInputs.imageUrl || data.imageUrl as string | undefined
      const i2vOrderedRefs = applyOrderToReferenceUrls(
        node.id,
        data.connectedRefImageOrder as string[] | undefined,
        buildCtx,
        (e) => referenceModalityForHandle(e.targetHandle) === "image",
      )
      const i2vBaseRefs = i2vOrderedRefs ?? resolvedInputs.referenceImageUrls
      const i2vMention = resolveVideoPromptMentions(i2vPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
        // Ref-capable: assets number AFTER the leading image-refs (ordinalOffset =
        // EDGE count, for FE↔BE parity) + entities attach. Non-ref: legacy
        // (imageRefCount 0 → tokens bare-label).
        ...(i2vSupportsRefs
          ? { ordinalOffset: countRefModalityEdges(node.id, "image", buildCtx), includeWiredEntities: true }
          : { imageRefCount: 0 }),
        videoRefCount: i2vSupportsRefs ? countRefModalityEdges(node.id, "video", buildCtx) : 0,
        audioRefCount: i2vSupportsRefs ? countRefModalityEdges(node.id, "audio", buildCtx) : 0,
      })
      i2vPrompt = i2vMention.prompt
      let i2vImageUrl = i2vBaseImage
      let i2vReferenceImageUrls = i2vBaseRefs
      if (i2vMention.additionalUrls.length > 0) {
        let remainingMentionUrls = i2vMention.additionalUrls
        // Seedance 2 frame-numbering guard (shared helper — see
        // keepSeedance2MentionsAsRefs). Keep a @-mention front-of-list as a plain
        // reference (no frame promotion) when other references will remain, so the
        // resolver's tail "Use Image <tail>" suffix can't contradict the mention's
        // frozen bullet ordinal. A lone mention with no other refs still fills the
        // frame slot.
        const keepMentionsAsRefs = keepSeedance2MentionsAsRefs(provider, {
          remainingMentionCount: remainingMentionUrls.length,
          baseRefCount: i2vBaseRefs?.length ?? 0,
          refVideoCount: resolvedInputs.referenceVideoUrls?.length ?? 0,
          refAudioCount: resolvedInputs.referenceAudioUrls?.length ?? 0,
        })
        if (!i2vImageUrl && !keepMentionsAsRefs) {
          i2vImageUrl = remainingMentionUrls[0]
          remainingMentionUrls = remainingMentionUrls.slice(1)
        }
        if (remainingMentionUrls.length > 0) {
          const existing = i2vReferenceImageUrls ?? []
          const merged: string[] = []
          const seen = new Set<string>()
          for (const u of existing) {
            if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          }
          for (const u of remainingMentionUrls) {
            if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          }
          i2vReferenceImageUrls = merged
        }
      }
      // Normalize the SAME values the branch already emits — the ui-fill is the
      // effective request for an untouched node (video-ui-defaults.ts), so
      // normalizing raw `data.*` would erase it (R5).
      const i2vNorm = resolveVideoRequestNorm({
        provider,
        aspectRatio: (data.aspectRatio as string | undefined) ?? uiAspectRatioFill(provider),
        resolution: (data.resolution as string | undefined) ?? uiResolutionFill(provider),
        duration: data.duration as number | string | undefined,
      })
      if (i2vNorm.adjustments.length > 0) {
        console.warn(
          `[payload-builder] ${node.id} (${provider}): ` +
          i2vNorm.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
        )
      }
      return {
        jobName: "image-to-video",
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          provider,
          i2vNorm.duration ?? (data.duration as number | string | undefined),
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          "image-to-video",
          (data.videoSize as string | undefined) ?? (data.mode ?? data.kling3Mode) as string | undefined,
          i2vNorm.resolution,
          hasVideoRef,
        ),
        payload: {
          jobId,
          imageUrl: i2vImageUrl,
          endFrameUrl: resolvedInputs.endFrameUrl,
          audioUrl: resolvedInputs.audioUrl,
          prompt: i2vPrompt,
          provider,
          duration: i2vNorm.duration ?? data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          generateAudio: data.generateAudio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          // Seedance 2 / MiniMax H3 config pickers render defaults in the UI
          // without persisting them to data until the user explicitly picks,
          // so untouched nodes submitted aspectRatio / resolution undefined.
          // Fill the defaults here so the request matches the UI. (H3 has no
          // resolution lever — its catalog declares no resolutions, so the
          // resolution fallback stays undefined by construction.)
          aspectRatio: i2vNorm.aspectRatio,
          resolution: i2vNorm.resolution,
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          grokMode: data.grokMode,
          videoSize: data.videoSize,
          removeWatermark: data.removeWatermark,
          // ≤10s trim window (Seedance 2 selects which slice of the driving
          // audio/video to use). The worker reads videoTrimStart/videoTrimEnd;
          // dropping them produced the un-trimmed full clip in workflow runs.
          videoTrimStart: data.videoTrimStart,
          videoTrimEnd: data.videoTrimEnd,
          referenceImageUrls: i2vReferenceImageUrls,
          referenceVideoUrls: resolvedInputs.referenceVideoUrls,
          referenceAudioUrls: resolvedInputs.referenceAudioUrls,
          webSearch: data.webSearch,
          nsfwChecker: data.nsfwChecker,
          // VEO uses its REFERENCE_2_VIDEO endpoint when the user picked
          // reference mode OR when reference images are wired (without this
          // refs-present arm, refs attached to a VEO i2v node were silently
          // dropped). Non-VEO providers ignore generationType. Mirrors the
          // canvas-run path in execute-node.ts.
          generationType:
            isVeoProvider(provider) && (data.veoMode === "reference" || (i2vReferenceImageUrls?.length ?? 0) > 0)
              ? "REFERENCE_2_VIDEO"
              : undefined,
          // Generic smart-loop-cut post-process. Worker reads loopTrim.enabled.
          // Legacy autoLoopTrim is normalized at the route level; orchestrator
          // path sees it migrated by the frontend already (use-workflow-store).
          loopTrim: data.loopTrim,
          enableTranslation: data.enableTranslation,
          usageLogId,
        },
      }
    }

    case "text-to-video": {
      const provider = (data.provider as string) ?? "kling"
      const hasVideoRef = (resolvedInputs.referenceVideoUrls?.length ?? 0) > 0
      // Resolve @-mentions in the t2v prompt (see i2v case for the rationale).
      // t2v has no `imageUrl` slot — all resolved URLs become entries in
      // `referenceImageUrls`, merged with whatever upstream already provided.
      const t2vRawPrompt = promptFor("text-to-video")
      // Node-data cinematic direction / structured ids (P4b) — see the i2v case.
      let t2vPrompt = composeVideoPrompt({ rawPrompt: t2vRawPrompt, nodeId: node.id, buildCtx, ...readNodeDirectionLevers(data) })
      // `{image:N}` token resolution — see i2v note. Same gate + edge counts.
      const t2vSupportsRefs = !!provider && hasFeature(provider, "reference-image")
      // Plain image-refs LEAD the unified @image_N numbering (D5) — computed BEFORE
      // the resolver so they can be passed in as `leadingRefUrls`. t2v has no
      // startFrame handle, so the reorder filter accepts any wired image/character/
      // entity upstream (matches the `connectedRefImages` filter in TextToVideoConfig).
      const t2vOrderedRefs = applyOrderToReferenceUrls(
        node.id,
        data.connectedRefImageOrder as string[] | undefined,
        buildCtx,
        (_e, src) => VIDEO_REF_IMAGE_SOURCE_TYPES.has(src.type),
      )
      const t2vLeadingRefs = t2vOrderedRefs ?? resolvedInputs.referenceImageUrls
      const t2vMention = resolveVideoPromptMentions(t2vPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
        // Ref-capable: asset directives number AFTER the leading image-refs
        // (ordinalOffset = the EDGE count, for FE↔BE parity — the FE preview has no
        // URL layer) + entities attach (D5). The caller owns the URL merge below.
        // Non-ref: legacy (imageRefCount 0 → tokens drop, no entities).
        ...(t2vSupportsRefs
          ? { ordinalOffset: countRefModalityEdges(node.id, "image", buildCtx), includeWiredEntities: true }
          : { imageRefCount: 0 }),
        videoRefCount: t2vSupportsRefs ? countRefModalityEdges(node.id, "video", buildCtx) : 0,
        audioRefCount: t2vSupportsRefs ? countRefModalityEdges(node.id, "audio", buildCtx) : 0,
      })
      t2vPrompt = t2vMention.prompt
      // image-refs-first (D5): leading plain refs, then the asset URLs (deduped).
      let t2vReferenceImageUrls = t2vLeadingRefs
      if (t2vMention.additionalUrls.length > 0) {
        const merged: string[] = []
        const seen = new Set<string>()
        for (const u of [...(t2vLeadingRefs ?? []), ...t2vMention.additionalUrls]) {
          if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
        }
        t2vReferenceImageUrls = merged
      }
      // See the i2v note above (R5): the ui-fill is the effective request for an
      // untouched node, so it is what gets normalized — never raw `data.*`.
      const t2vNorm = resolveVideoRequestNorm({
        provider,
        aspectRatio: (data.aspectRatio as string | undefined) ?? uiAspectRatioFill(provider),
        resolution: (data.resolution as string | undefined) ?? uiResolutionFill(provider),
        duration: data.duration as number | string | undefined,
      })
      if (t2vNorm.adjustments.length > 0) {
        console.warn(
          `[payload-builder] ${node.id} (${provider}): ` +
          t2vNorm.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
        )
      }
      return {
        jobName: "text-to-video",
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          provider,
          t2vNorm.duration ?? (data.duration as number | string | undefined),
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          "text-to-video",
          (data.mode ?? data.kling3Mode ?? data.videoSize) as string | undefined,
          t2vNorm.resolution,
          hasVideoRef,
        ),
        payload: {
          jobId,
          prompt: t2vPrompt,
          provider,
          duration: t2vNorm.duration ?? data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          // See i2v note above — Seedance 2 / MiniMax H3 UI default fallbacks.
          aspectRatio: t2vNorm.aspectRatio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          removeWatermark: data.removeWatermark,
          seed: data.seed,
          resolution: t2vNorm.resolution,
          generateAudio: data.generateAudio,
          referenceImageUrls: t2vReferenceImageUrls,
          referenceVideoUrls: resolvedInputs.referenceVideoUrls,
          referenceAudioUrls: resolvedInputs.referenceAudioUrls,
          webSearch: data.webSearch,
          nsfwChecker: data.nsfwChecker,
          enableTranslation: data.enableTranslation,
          usageLogId,
        },
      }
    }

    // Unified video node — dispatches `jobName` dynamically based on whether
    // any image input is wired. Reuses the existing i2v + t2v worker handlers
    // and credit pricing without modifying them. The case lives next to its
    // legacy siblings so future provider routing tweaks stay co-located.
    case "generate-video": {
      // Same default helper as the routes — the DAG default previously
      // disagreed with the single-node default ("kling" vs "minimax").
      const gvSel = applyDefaultVideoSelection({ provider: data.provider as string | undefined, duration: data.duration as number | string | undefined })
      const provider = gvSel.provider
      // Node-data cinematic direction / structured ids (P4b): the node carries
      // picker IDS, not baked hint text — the fold happens once, server-side,
      // at the model call. Hoisted above the LTX early return so BOTH exits of
      // this case honor the same stored look. Narrow-read (untrusted persisted
      // JSON). NOT gated by any injectLook switch — that governs WIRED handles
      // (`collectCinematographyHints`); stored direction is node-local look
      // data and folds regardless, additively, exactly like the image side.
      const gvDirectionLevers = readNodeDirectionLevers(data)

      // ─── LTX 2.3 task dispatch ───────────────────────────────────────────
      // LTX has a single Replicate endpoint per variant that switches behavior
      // via a `task` discriminator in the input. Dispatch the right task based
      // on which input handles are wired, emit a flat snake_case payload that
      // mirrors the LTX provider's input shape (so the worker can forward
      // directly to `runLtxTextToVideo` / `runLtxImageToVideo` /
      // `runLtxAudioToVideo` without re-deriving the task).
      //
      // Fast variant lacks audio_to_video — wiring audio against Fast falls
      // back to text_to_video (Task 1.3 already disables the audio handle in
      // the UI, but the orchestrator may still receive payloads from older
      // workflows or webhook triggers, so we degrade gracefully here).
      if (provider === "ltx-2.3-pro" || provider === "ltx-2.3-fast") {
        const hasAudio = !!resolvedInputs.audioUrl && provider === "ltx-2.3-pro"
        const hasStart = !!resolvedInputs.startFrameUrl
        const hasEnd = !!resolvedInputs.endFrameUrl

        let task: "text_to_video" | "image_to_video" | "audio_to_video"
        if (hasAudio) task = "audio_to_video"
        else if (hasStart) task = "image_to_video"
        else task = "text_to_video"

        // Walk incoming edges to derive the LTX camera_motion enum. Mirrors
        // the upstream-hint shape `ltxCameraMotionFromUpstream` expects.
        const incomingNodes = (buildCtx?.edges ?? [])
          .filter((e) => e.target === node.id)
          .map((e) => (buildCtx?.nodes ?? []).find((n) => n.id === e.source))
          .filter((n): n is SimpleNode => !!n)
        const hints = incomingNodes.map((n) => ({
          nodeType: n.type,
          data: { cameraMotion: (n.data as Record<string, unknown>).cameraMotion as string | undefined },
        }))
        const cameraMotion = ltxCameraMotionFromUpstream(hints) ?? "none"

        // The LTX exit has no ui-fill, so this normalizes raw `data.*`. It
        // REPLACES the raw resolution that used to reach the identifier, keeping
        // the priced tier and `payload.resolution`/`duration` one value — and it
        // fills the 1080p band the identifier assumes for an omitted resolution,
        // which the wire previously left unset for Replicate to guess at.
        const ltxNorm = resolveVideoRequestNorm({
          provider,
          aspectRatio: data.aspectRatio as string | undefined,
          resolution: data.resolution as string | undefined,
          duration: gvSel.duration as number | string | undefined,
        })
        if (ltxNorm.adjustments.length > 0) {
          console.warn(
            `[payload-builder] ${node.id} (${provider}): ` +
            ltxNorm.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
          )
        }

        return {
          jobName: task === "audio_to_video" ? "text-to-video" : (task === "image_to_video" ? "image-to-video" : "text-to-video"),
          queueName: "video-generation",
          // Price the tier we are about to RENDER. The bare provider id is the
          // cheapest band (1080p:6s) and `commit_credits` never collects an
          // upward delta, so reserving it against a 4k:10s run under-charged by
          // up to 6.7× (app-reports triage §4.2). Both direct routes already
          // call this helper; the orchestrator was the only lane that didn't.
          // `buildVideoCreditModelIdentifier` snaps an unknown band to 1080p and
          // an off-tier duration to the nearest seeded one, so the id always prices.
          // The band lookup is CASE-SENSITIVE with lowercase keys — never
          // upper-case `resolution` on the way in (see Task 6, ruling R3).
          modelIdentifier: buildVideoCreditModelIdentifier(
            provider,
            ltxNorm.duration ?? (gvSel.duration as number | string | undefined),
            undefined,
            task === "image_to_video" ? "image-to-video" : "text-to-video",
            undefined,
            ltxNorm.resolution,
            false,
          ),
          payload: {
            jobId,
            provider,
            task,
            // The LTX exit composes NO graph hints (no wired-picker fold, no
            // identity clause) — deliberately minimal, unchanged here. The
            // node's OWN stored ids still fold, so an LTX generate-video node
            // keeps the look the frontend single-node run already sends.
            prompt: composeVideoPromptText(
              promptFor("generate-video", true),
              gvDirectionLevers.direction,
              gvDirectionLevers.structured,
              {
                ...(gvDirectionLevers.subject !== undefined
                  ? { subject: gvDirectionLevers.subject }
                  : {}),
              },
            ),
            ...(task === "image_to_video" && {
              image: resolvedInputs.startFrameUrl,
              ...(hasEnd && { last_frame_image: resolvedInputs.endFrameUrl }),
            }),
            ...(task === "audio_to_video" && { audio: resolvedInputs.audioUrl }),
            resolution: ltxNorm.resolution,
            duration: (ltxNorm.duration ?? gvSel.duration) as number | undefined,
            aspect_ratio: ltxNorm.aspectRatio,
            fps: data.fps as number | undefined,
            generate_audio: (data.generateAudio as boolean | undefined) ?? true,
            camera_motion: cameraMotion,
            usageLogId,
          },
        }
      }

      // EndFrame-only swap: if user wired endFrame but no startFrame, use
      // endFrame as the start so providers (veo3, minimax, kling-turbo, etc.)
      // get at least one image in their primary slot. We then clear
      // endFrameUrl to avoid the worker repeating the same image twice.
      const startFrameUrl = resolvedInputs.startFrameUrl ?? resolvedInputs.imageUrl ?? resolvedInputs.endFrameUrl
      const endFrameUrl = (resolvedInputs.startFrameUrl || resolvedInputs.imageUrl)
        ? resolvedInputs.endFrameUrl
        : undefined
      const hasStart = !!startFrameUrl
      const hasImageRef = (resolvedInputs.referenceImageUrls?.length ?? 0) > 0
      const hasVideoRef = (resolvedInputs.referenceVideoUrls?.length ?? 0) > 0

      // Mode dispatch — decides BOTH jobName and credit identifier so the
      // existing worker handlers + STATIC_CREDIT_COSTS entries keep working
      // without modification. Shared with the frontend executor: a start
      // frame is i2v; refs alone are i2v only for a split-id model whose t2v
      // twin cannot carry them (Grok Imagine 1, #861).
      const mode = resolveVideoModeForInputs(provider, { hasStartFrame: hasStart, hasImageRefs: hasImageRef })

      // Gemini Omni family (video + flash): a connected source video is a
      // video-edit (V2V) job, routed through the image-to-video worker path (one
      // handler serves all modes). Family predicate, never a literal id — a new
      // Omni SKU inherits the V2V routing (and the vref credit row) for free.
      const effectiveMode: "image-to-video" | "text-to-video" =
        (isGeminiOmniProvider(provider) && hasVideoRef) ? "image-to-video" : mode

      // Split-id video models (Grok Imagine 1, Wan 2.6/2.7) use a different KIE
      // id per mode but are one user-facing model in the unified picker. Remap
      // the stored id to the concrete id for the chosen mode so BOTH the worker
      // model lookup (payload.provider) AND the credit identifier are correct.
      // No-op for single-id providers. Mirrors the frontend executor
      // (execute-node.ts) — shared source of truth in @nodaro/shared.
      const resolvedProvider = resolveVideoProviderForMode(provider, effectiveMode)

      // i2v-only providers (kling-3-omni, kling-master, happyhorse-ref2v, …)
      // cannot run the t2v path — fail with the same clear message the
      // /v1/text-to-video route returns, BEFORE a job row is created and
      // credits are reserved, instead of a provider-lookup error mid-run.
      if (effectiveMode === "text-to-video" && videoProviderRequiresImage(resolvedProvider)) {
        throw new Error(imageRequiredMessage(resolvedProvider))
      }

      // Prompt composition (typed-primary, via the shared helper): list-override
      // → data.prompt → data.motionPrompt (legacy field still emitted by the
      // inline picker) → upstream wire. composeVideoPrompt appends cinematography
      // hints + optional motion-hint + identity-lock.
      const rawPrompt = promptFor("generate-video", true)
      const motionHint = data.motionEnabled && typeof data.motion === "string" && data.motion
        ? `${data.motion} motion`
        : undefined
      let composedPrompt = composeVideoPrompt({ rawPrompt, motionHint, nodeId: node.id, buildCtx, ...gvDirectionLevers })

      // Mention resolution + ref-image merging (mirrors i2v case). Extras /
      // suppressed-canonicals stay opt-in via the same node-data fields.
      // `{image:N}` token resolution — see i2v note. Gate on `resolvedProvider`
      // (the mode-resolved id) to mirror the FE, which re-types generate-video to
      // i2v/t2v and reads the re-typed `data.provider` (= resolvedProvider for
      // split-id models). Counts are MODALITY-based (shared
      // `referenceModalityForHandle`), so the `imageReferences` /
      // `videoReferences` / `audioReferences` handles real generate-video nodes
      // wire are counted alongside the legacy `references` ids — fixing the prior
      // gap where `{image:N}` resolved only for the legacy handle.
      const gvSupportsRefs = !!resolvedProvider && hasFeature(resolvedProvider, "reference-image")
      // Leading plain refs computed BEFORE the resolver so asset ordinals number
      // AFTER them (D5). generate-video OWNS the URL merge (frame-promotion below),
      // so the core only OFFSETS the numbering (`ordinalOffset`) — no URL prepend.
      // Drag-to-reorder writes referenceImageOrder on the new node (the rename
      // migration normalizes the legacy connectedRefImageOrder field). The handle
      // filter accepts all three typed-handle ids the new node exposes for images.
      const orderedRefs = applyOrderToReferenceUrls(
        node.id,
        data.referenceImageOrder as string[] | undefined,
        buildCtx,
        (e) => e.targetHandle === "imageReferences" || e.targetHandle === "references" || e.targetHandle === "reference-images",
      )
      let referenceImageUrls = orderedRefs ?? resolvedInputs.referenceImageUrls
      let imageUrl = startFrameUrl
      const mentionResult = resolveVideoPromptMentions(
        composedPrompt,
        node.id,
        buildCtx,
        readExtraRefs(data),
        {
          referenceOrder: readStringArray(data.referenceImageOrder),
          suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
          // Ref-capable: assets number AFTER the leading image-refs (ordinalOffset =
          // EDGE count, for FE↔BE parity) + entities attach. Non-ref: legacy
          // (imageRefCount 0 → tokens bare-label).
          ...(gvSupportsRefs
            ? { ordinalOffset: countRefModalityEdges(node.id, "image", buildCtx), includeWiredEntities: true }
            : { imageRefCount: 0 }),
          videoRefCount: gvSupportsRefs ? countRefModalityEdges(node.id, "video", buildCtx) : 0,
          audioRefCount: gvSupportsRefs ? countRefModalityEdges(node.id, "audio", buildCtx) : 0,
        },
      )
      composedPrompt = mentionResult.prompt
      if (mentionResult.additionalUrls.length > 0) {
        let remaining = mentionResult.additionalUrls
        // Seedance 2 frame-numbering guard (shared helper — see
        // keepSeedance2MentionsAsRefs). generate-video is the PRIMARY path (only
        // creatable video node + migration target), so the same mention→frame
        // promotion that desynced `Image N` in the i2v case must be suppressed
        // here too: don't promote a mention into `imageUrl` when other refs will
        // remain. A lone mention with no other refs still fills the frame slot.
        const keepMentionsAsRefs = keepSeedance2MentionsAsRefs(provider, {
          remainingMentionCount: remaining.length,
          baseRefCount: referenceImageUrls?.length ?? 0,
          refVideoCount: resolvedInputs.referenceVideoUrls?.length ?? 0,
          refAudioCount: resolvedInputs.referenceAudioUrls?.length ?? 0,
        })
        if (!imageUrl && !keepMentionsAsRefs) {
          imageUrl = remaining[0]
          remaining = remaining.slice(1)
        }
        if (remaining.length > 0) {
          const existing = referenceImageUrls ?? []
          const merged: string[] = []
          const seen = new Set<string>()
          for (const u of existing) if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          for (const u of remaining) if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          referenceImageUrls = merged
        }
      }

      // VEO-specific generationType hint — derived from the wiring shape so
      // the worker doesn't have to inspect the resolved inputs itself.
      let generationType: "TEXT_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO" | "REFERENCE_2_VIDEO" | undefined
      if (!hasStart && !hasImageRef && !hasVideoRef) generationType = "TEXT_2_VIDEO"
      else if (hasStart && !!endFrameUrl) generationType = "FIRST_AND_LAST_FRAMES_2_VIDEO"
      else if (hasImageRef || hasVideoRef) generationType = "REFERENCE_2_VIDEO"

      // R5: the identifier already used `resolvedProvider` while the ui-fills
      // used the stored `provider` — a pre-existing disagreement. Both now read
      // `resolvedProvider`: it is the id whose catalog governs the request that
      // will actually run. Behaviour change, small but real, for the split-id
      // models (Grok Imagine 1, Wan 2.6/2.7) whose mode variants could declare
      // different lists. And the fill is what gets normalized, never raw
      // `data.*` — normalizing raw data would erase the fill (R5).
      const gvNorm = resolveVideoRequestNorm({
        provider: resolvedProvider,
        aspectRatio: (data.aspectRatio as string | undefined) ?? uiAspectRatioFill(resolvedProvider),
        resolution: (data.resolution as string | undefined) ?? uiResolutionFill(resolvedProvider),
        duration: data.duration as number | string | undefined,
      })
      if (gvNorm.adjustments.length > 0) {
        console.warn(
          `[payload-builder] ${node.id} (${resolvedProvider}): ` +
          gvNorm.adjustments.map((a) => `${a.field} "${a.from}" → ${a.to ?? "removed"}`).join("; "),
        )
      }
      return {
        jobName: effectiveMode,
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          resolvedProvider,
          gvNorm.duration ?? (data.duration as number | string | undefined),
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          effectiveMode,
          (data.videoSize as string | undefined) ?? (data.mode ?? data.kling3Mode) as string | undefined,
          gvNorm.resolution,
          hasVideoRef,
        ),
        payload: {
          jobId,
          provider: resolvedProvider,
          prompt: composedPrompt,
          // Negative: typed ({label} resolved) + wired connected-negative both
          // emitted (composeNegative). The input-resolver dropped any referenced
          // / Inject-Negative-off source from resolvedInputs.negativePrompt.
          negativePrompt: composeNegative(resolveRefs(data.negativePrompt as string | undefined, refMap), resolvedInputs.negativePrompt) || undefined,
          imageUrl,            // swap-aware
          endFrameUrl,         // gated on having a startFrame to pair with
          referenceImageUrls,
          referenceVideoUrls: resolvedInputs.referenceVideoUrls,
          videoTrimStart: data.videoTrimStart,
          videoTrimEnd: data.videoTrimEnd,
          referenceAudioUrls: resolvedInputs.referenceAudioUrls,
          audioUrl: resolvedInputs.audioUrl,
          duration: gvNorm.duration ?? data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          generateAudio: data.generateAudio,
          cfgScale: data.cfgScale,
          // Seedance 2 config pickers render defaults in the UI without
          // persisting them to data until the user explicitly picks; fill
          // them in here so the worker request matches the visible UI state.
          aspectRatio: gvNorm.aspectRatio,
          resolution: gvNorm.resolution,
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          grokMode: data.grokMode,
          videoSize: data.videoSize,
          removeWatermark: data.removeWatermark,
          webSearch: data.webSearch,
          nsfwChecker: data.nsfwChecker,
          generationType,
          loopTrim: data.loopTrim,
          enableTranslation: data.enableTranslation,
          usageLogId,
        },
      }
    }

    // Replicate MMAudio — generates synchronized SFX/foley/ambient audio for a
    // video clip and merges it into the original. Three typed input handles:
    // `video` (required, the clip to score), `prompt` (text describing the
    // sound — text-prompt source or literal data field), `negative` (sounds
    // to suppress; defaults to "music" so MMAudio doesn't synthesize a
    // soundtrack instead of foley).
    //
    // `versions` (1-4) is the multi-take batch knob. The standalone route
    // (`POST /v1/video-sfx`) fans this out into N jobs rows up front; here in
    // the orchestrator we keep it in the payload so the worker layer can
    // honor it the same way the standalone route does once orchestrator-side
    // batching lands. node-executor creates ONE job per node — the worker
    // re-reads `input_data` from the row, so writing `versions` into the
    // payload propagates it via the input_data backfill in node-executor.
    case "video-sfx": {
      return {
        jobName: "video-sfx",
        queueName: "video-generation",
        modelIdentifier: "replicate-mmaudio",
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl ?? (data.videoUrl as string | undefined),
          prompt: applyPromptAffixes(resolvedInputs.prompt ?? (data.prompt as string | undefined), readPromptAffixes(data), refMap),
          // `negative` handle takes precedence over the config field; default
          // to "music" so MMAudio synthesizes SFX/foley rather than a score
          // (mirrors the route's Zod default at `routes/video-sfx.ts:18`).
          negativePrompt:
            resolvedInputs.negativePrompt
            ?? (data.negativePrompt as string | undefined)
            ?? "music",
          cfgStrength: (data.cfgStrength as number | undefined) ?? 4.5,
          numSteps: (data.numSteps as number | undefined) ?? 25,
          seed: data.seed as number | undefined,
          versions: (data.versions as number | undefined) ?? 1,
          usageLogId,
        },
      }
    }

    case "video-analysis": {
      // Duration-bucketed pricing is a client-writable billing input, so the
      // reserved credit id is derived from the SAME 3-step resolution the route
      // uses (single source of truth — orchestrated runs bypass the route):
      //   1. resolvedInputs.videoDuration    — trusted upstream video metadata
      //   2. data.probedYoutube.durationSec  — ONLY when URL-bound to the
      //                                        effective youtubeUrl (exact match)
      //   3. unknown → <model>:600s ceiling  — the only silent-ceiling path
      // videoUrl wins over youtubeUrl (mirrors the video-analysis route, now in
      // @nodaroai/cloud-plugins), so a wired/config clip nulls youtubeUrl downstream.
      const videoUrl = resolvedInputs.videoUrl ?? (data.videoUrl as string | undefined)
      const youtubeUrl = videoUrl ? undefined : (data.youtubeUrl as string | undefined)
      const probed = data.probedYoutube as { url: string; durationSec: number } | undefined
      const durationSec =
        resolvedInputs.videoDuration ??
        (youtubeUrl && probed && probed.url === youtubeUrl ? probed.durationSec : undefined)
      // Resolve the tier ("fast"/"pro") or raw model to the internal model
      // (default pro); worker payload + credit id carry the resolved model.
      const model = resolveVideoAnalysisModel(data.llmModel as string | undefined)
      const creditId = buildVideoAnalysisCreditId(model, durationSec)
      return simpleResult("video-analysis", creditId, {
        jobId,
        videoUrl,
        youtubeUrl,
        llmModel: model,
        // best-of-N strategy — fail-safe narrowed: anything but the literal
        // "combine" is omitted (worker defaults to "choose").
        selectionMode: data.selectionMode === "combine" ? "combine" : undefined,
        // Cast-variations opt-in — same literal-true narrowing; omitted keeps
        // the plugin's pre-variations shape (route parity: the plugin route
        // narrows identically before enqueueing).
        variations: data.variations === true ? true : undefined,
        // Output language — same fail-safe narrowing, per lever: only a literal
        // true translates, so a stale truthy value in saved node data can never
        // silently flip an orchestrated run into English.
        translateSpeechToEnglish: data.translateSpeechToEnglish === true ? true : undefined,
        translateOnScreenTextToEnglish: data.translateOnScreenTextToEnglish === true ? true : undefined,
        analysisFocus: applyPromptAffixes(data.analysisFocus as string | undefined, readPromptAffixes(data), refMap),
        reservedCreditId: creditId,
        // nodeId echoes the route's payload key (node.id == the canvas node id the
        // route reads from req.body). workflowId is route-only — buildPayload has
        // no execution context and the worker consumes neither field.
        nodeId: node.id,
        usageLogId,
      })
    }

    // AI Audit — re-watches a clip against an analysis and returns the CORRECTED
    // analysis (`json`) plus its disclosure `report`. Sibling of video-analysis
    // above and priced off the SAME duration-bucket ladder, but the family comes
    // from whether an analysis was provided rather than from a model pick.
    case "video-audit": {
      // The clip is mandatory — the audit re-WATCHES the footage, and there is
      // no YouTube alternative on this node (unlike video-analysis). Fail fast
      // (mirrors reference-sheet's `entity_not_ready` and the frontend's
      // "connect a video to audit" refusal) so the orchestrator deletes the
      // pending job row and never reserves credits for a run that can't work.
      const videoUrl = resolvedInputs.videoUrl ?? (data.videoUrl as string | undefined)
      if (!videoUrl) {
        throw codedMediaRefusal("video_required", "connect a video to the AI Audit node")
      }
      // The upstream analysis, resolved by input-resolver's `analysis`-handle
      // interceptor (a video-analysis OR video-audit source — an audited
      // analysis is still an analysis). Passed through VERBATIM: the plugin
      // parses it with the canonical schema. `undefined` is meaningful — it is
      // what selects the auto family, so it is never coerced to null/{}.
      const analysis = resolvedInputs.analysis
      // Wired but unresolved (the upstream analysis has neither a live result
      // nor a saved one): refusing beats running. Running would SILENTLY bill
      // the auto family — strictly more than the price the canvas badge, the
      // workflow total and the run-confirm dialog all quoted from that same
      // wired edge. Same rule, same reason as the frontend executor's refusal.
      if (analysis === undefined && videoAuditAnalysisWired(node.id, buildCtx?.edges)) {
        throw new Error(
          "analysis_not_ready: the connected analysis has no result yet — run it first, or disconnect it to let the AI Audit node analyse the clip itself",
        )
      }
      // Duration → credit bucket. Same trust order as video-analysis minus its
      // YouTube leg (this node has no youtubeUrl):
      //   1. resolvedInputs.videoDuration     — trusted upstream video metadata
      //   2. data.probedVideo.durationSec     — ONLY when URL-bound to the
      //                                         effective videoUrl (exact match),
      //                                         the node's own documented trust
      //                                         rule and the value the canvas
      //                                         badge quotes from
      //   3. unknown → the 600s ceiling composite (buildVideoAuditCreditId's own
      //      fallback — over-reserves, never under)
      const probed = data.probedVideo as { url: string; durationSec: number } | undefined
      const durationSec =
        resolvedInputs.videoDuration ??
        (probed && probed.url === videoUrl ? probed.durationSec : undefined)
      // ONE rule for the family, shared with the frontend badge/estimate:
      // analysis present → `video-audit:<bucket>s`, absent → `video-audit:auto:<bucket>s`.
      const creditId = buildVideoAuditCreditId({ analysisProvided: analysis !== undefined, durationSec })
      return simpleResult("video-audit", creditId, {
        jobId,
        videoUrl,
        // Omitted (not `undefined`) when nothing resolved — the wire shape must
        // mean exactly what the graph meant, since the plugin's family switch
        // keys off presence.
        ...(analysis !== undefined ? { analysis } : {}),
        reservedCreditId: creditId,
        // nodeId echoes the route's payload key (node.id == the canvas node id
        // the route reads from req.body); the worker consumes neither it nor a
        // workflowId, but keeping it matches the video-analysis payload shape.
        nodeId: node.id,
        usageLogId,
      })
    }

    case "reference-sheet": {
      // Compose-only: resolve the connected entity's (kind, DB id) by walking the
      // incoming edge. The worker (`workers/handlers/reference-sheet.ts`) reads
      // job.data.{type, skin, flavour, entityKind, entityDbId} — `type` is the
      // SHEET type (data.type), NOT the queue discriminator (`jobName`). Keys here
      // MUST match the route's `videoQueue.add("reference-sheet", { ...body })`
      // shape so workflow-run + single-node Run hit the same handler.
      const { entityKind, entityDbId } = resolveSheetEntity(node.id, buildCtx)
      // Compose-only nodes have no raw-image path in a workflow run — the only
      // valid source is a SAVED upstream entity. An unsaved/unwired entity
      // resolves to an empty DbId; fail fast (spec §13 `entity_not_ready`) so the
      // orchestrator deletes the pending job and never reserves the assembly fee,
      // instead of the worker defaulting entityKind to "character" and composing a
      // blank, credit-charged sheet. Single-node Run guards the same case in
      // execute-node.ts ("Connect a character/object/location with a main image").
      if (!entityKind || !entityDbId) {
        throw new Error("entity_not_ready")
      }
      return {
        jobName: "reference-sheet",
        queueName: "video-generation",
        // Flavour-aware so a motion sheet reserves the same id the route's
        // single-node path uses (`sheetCreditId` in routes/reference-sheet.ts):
        // motion → 6cr assembly, still → 4cr. Resolving different ids at the two
        // sites would under-bill workflow runs (was hardcoded to the still id).
        // Shared single source of truth (mirrors the route + node display).
        modelIdentifier: referenceSheetCreditId(data.flavour as { outputFormat?: string } | undefined),
        payload: {
          jobId,
          type: data.type,
          skin: data.skin,
          flavour: data.flavour,
          entityKind,
          entityDbId,
          usageLogId,
        },
      }
    }

    case "video-to-video": {
      const v2vProvider = (data.provider as string) ?? "wan"
      // Resolve @-mentions in the v2v prompt. v2v has only a single
      // `referenceImageUrl` slot — when an upstream ref image is wired we
      // keep it; otherwise the first resolved mention URL fills it. Extra
      // mention URLs beyond slot 0 are dropped: v2v providers (Wan 2.6 et al)
      // accept exactly one reference image and silently ignore the rest, so
      // there's no payload key to plumb them into. Prompt token replacement
      // still happens so the LLM sees the character names regardless.
      let v2vPrompt: string | undefined = (() => {
        let p: string | undefined = promptFor("video-to-video")
        {
          // Bullet consumer (stamps character elements onto the video ref) → exclude here.
          const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeCharacterElements: true })
          if (cinematographyHints.length > 0) {
            const joined = cinematographyHints.join(", ")
            p = p ? `${p}. ${joined}` : joined
          }
        }
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
        return p
      })()
      // `{image:N}` token resolution — see i2v note. Mirrors the FE v2v run
      // (execute-node.ts: `v2vProviderSupportsRefs` gate). Wan 2.6 et al. are
      // non-ref → 0 → bare-label (the FE strips for the same case).
      const v2vSupportsRefs = !!v2vProvider && hasFeature(v2vProvider, "reference-image")
      const v2vMention = resolveVideoPromptMentions(v2vPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
        imageRefCount: v2vSupportsRefs ? countRefModalityEdges(node.id, "image", buildCtx) : 0,
        videoRefCount: v2vSupportsRefs ? countRefModalityEdges(node.id, "video", buildCtx) : 0,
        audioRefCount: v2vSupportsRefs ? countRefModalityEdges(node.id, "audio", buildCtx) : 0,
      })
      v2vPrompt = v2vMention.prompt
      const v2vUpstreamRef = (typeof resolvedInputs.referenceImageUrls === "string"
        ? resolvedInputs.referenceImageUrls
        : Array.isArray(resolvedInputs.referenceImageUrls)
          ? resolvedInputs.referenceImageUrls[0]
          : undefined) as string | undefined
      const v2vReferenceImageUrl = v2vUpstreamRef ?? v2vMention.additionalUrls[0]
      return {
        jobName: "video-to-video",
        queueName: "video-generation",
        modelIdentifier: v2vProvider,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          prompt: v2vPrompt,
          provider: v2vProvider,
          duration: data.v2vDuration as string | undefined,
          resolution: data.v2vResolution as string | undefined,
          audio: data.audio as boolean | undefined,
          multiShots: data.multiShots as boolean | undefined,
          aspectRatio: data.aspectRatio as string | undefined,
          seed: data.seed as number | undefined,
          referenceImageUrl: v2vReferenceImageUrl,
          negativePrompt: resolvedInputs.negativePrompt || (data.negativePrompt as string | undefined),
          videoEditDuration: data.videoEditDuration as string | undefined,
          audioSetting: data.audioSetting as string | undefined,
          promptExtend: data.promptExtend as boolean | undefined,
          usageLogId,
        },
      }
    }

    case "switchx": {
      const sxPrompt = (() => {
        let p: string | undefined = promptFor("switchx")
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
        return p
      })()
      // SwitchX has no ref-capable token mode — the FE run ALWAYS strips
      // `{image:N}` here (execute-node.ts: unconditional `stripVideoImageTokens`).
      // Mirror that with a flat 0 (always bare-label), independent of provider.
      const sxMention = resolveVideoPromptMentions(sxPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
        imageRefCount: 0,
        videoRefCount: 0,
        audioRefCount: 0,
      })
      const sxUpstreamRef = (typeof resolvedInputs.referenceImageUrls === "string"
        ? resolvedInputs.referenceImageUrls
        : Array.isArray(resolvedInputs.referenceImageUrls)
          ? resolvedInputs.referenceImageUrls[0]
          : undefined) as string | undefined
      const sxMaxRes = data.maxResolution === 720 ? 720 : 1080
      return {
        jobName: "switchx",
        queueName: "video-generation",
        // No ffprobe in the orchestrator path → reserve the worst-case frame tier
        // for the resolution (resolveSwitchXCreditId defaults to 240f). Over-reserve is safe.
        modelIdentifier: resolveSwitchXCreditId({ maxResolution: sxMaxRes }),
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          referenceImageUrl: sxUpstreamRef ?? sxMention.additionalUrls[0],
          prompt: sxMention.prompt,
          alphaMode: (data.alphaMode as string) ?? "auto",
          maskUrl: (resolvedInputs.maskUrl as string | undefined) ?? (data.maskUrl as string | undefined),
          alphaKeyframeIndex: data.alphaKeyframeIndex as number | undefined,
          maxResolution: sxMaxRes,
          seed: data.seed as number | undefined,
          usageLogId,
        },
      }
    }

    case "generate-mask": {
      return {
        jobName: "generate-mask",
        queueName: "video-generation",
        modelIdentifier: "generate-mask",
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || (data.generatedImageUrl as string | undefined),
          prompt: applyPromptAffixes(data.prompt as string | undefined, readPromptAffixes(data), refMap) as string,
          threshold: (data.threshold as number | undefined) ?? 0.3,
          usageLogId,
        },
      }
    }

    case "face-swap": {
      return {
        jobName: "face-swap",
        queueName: "video-generation",
        modelIdentifier: "roop-face-swap",
        payload: {
          jobId,
          faceImageUrl: data.faceImageUrl,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          provider: (data.provider as string) ?? "roop",
          usageLogId,
        },
      }
    }

    case "lip-sync": {
      const provider = (data.provider as string) ?? "kling-avatar"
      // infinitalk is tier-priced by resolution. Per-second providers
      // (kling-avatar(-pro), heygen-lipsync-precision, lipsync-2-pro) bucket by
      // the persisted audio duration when it's known — mirroring the route's
      // resolveLipSyncIdentifier. When the duration is unknown (e.g. audio is
      // produced by an upstream node at runtime), fall back to the bare provider
      // id: for HeyGen/Sync that bare entry is the 5-min ceiling (billing-safe),
      // and kling-avatar(-pro) keep their existing bare reservation unchanged.
      const lipSyncResolution = (data.resolution as string | undefined) ?? "720p"
      const audioDurationSec = typeof data.audioDurationSec === "number" ? data.audioDurationSec : undefined
      const lipSyncIdentifier =
        provider === "infinitalk"
          ? `infinitalk:${lipSyncResolution}`
          : isPerSecondLipSyncProvider(provider) && audioDurationSec !== undefined
            ? buildLipSyncCreditId(provider, audioDurationSec)
            : provider
      return {
        jobName: "lip-sync",
        queueName: "video-generation",
        modelIdentifier: lipSyncIdentifier,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          audioUrl: resolvedInputs.audioUrl || data.audioUrl,
          prompt: applyPromptAffixes((resolvedInputs.prompt || data.prompt) as string | undefined, readPromptAffixes(data), refMap) || "A person talking naturally",
          provider,
          resolution: data.resolution,
          audioDurationSec,
          guidanceScale: data.guidanceScale,
          inferenceSteps: data.inferenceSteps,
          seed: data.seed,
          pads: data.pads,
          smooth: data.smooth,
          fps: data.fps,
          resizeFactor: data.resizeFactor,
          enhancer: data.enhancer,
          preprocess: data.preprocess,
          still: data.still,
          poseStyle: data.poseStyle,
          expressionScale: data.expressionScale,
          enableDynamicDuration: data.enableDynamicDuration,
          disableMusicTrack: data.disableMusicTrack,
          enableSpeechEnhancement: data.enableSpeechEnhancement,
          syncMode: data.syncMode,
          temperature: data.temperature,
          activeSpeaker: data.activeSpeaker,
          // Volcengine video-to-video dubbing
          mode: data.mode,
          separateVocal: data.separateVocal,
          openScenedet: data.openScenedet,
          alignAudio: data.alignAudio,
          alignAudioReverse: data.alignAudioReverse,
          templStartSeconds: data.templStartSeconds,
          usageLogId,
        },
      }
    }

    case "speech-to-video": {
      const s2vResolution = (data.resolution as string) ?? "480p"
      const s2vModelId = s2vResolution === "720p"
        ? "speech-to-video:720p"
        : s2vResolution === "580p"
          ? "speech-to-video:580p"
          : "speech-to-video"
      return {
        jobName: "speech-to-video",
        queueName: "video-generation",
        modelIdentifier: s2vModelId,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          audioUrl: resolvedInputs.audioUrl || data.audioUrl,
          prompt: (() => {
            let p: string | undefined = promptFor("speech-to-video")
            {
              const cinematographyHints = collectCinematographyHints(node.id, buildCtx)
              if (cinematographyHints.length > 0) {
                const joined = cinematographyHints.join(", ")
                p = p ? `${p}. ${joined}` : joined
              }
            }
            const identityClause = collectIdentityLockClause(node.id, buildCtx)
            if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
            return p
          })(),
          resolution: s2vResolution,
          negativePrompt: data.negativePrompt,
          seed: data.seed,
          numFrames: data.numFrames,
          fps: data.fps,
          inferenceSteps: data.inferenceSteps,
          guidanceScale: data.guidanceScale,
          shift: data.shift,
          usageLogId,
        },
      }
    }

    case "ai-avatar": {
      // The `script` field is verbatim TTS — do NOT fold cinematography or
      // identity hints into it (unlike the speech-to-video case). The avatar
      // reads it aloud exactly as written.
      const aiAvatarEngine = (data.engine as string) ?? "avatar-iv"
      const aiAvatarResolution = (data.resolution as string) ?? "720p"
      // Credit identifier MUST come from resolveAiAvatarCreditId (the single
      // source of truth shared with the route's creditGuard) so that:
      //  (a) it is always one of the SEEDED duration-bucket ids (5/10/15/30/60/
      //      120/240/360/600/900s) — never an unseeded bucket that would hard-fail
      //      with 503 price_not_configured at reserve time, and
      //  (b) image-source mode pins the rate engine to avatar-iv (image is
      //      IV-class), matching the route's reservation exactly.
      // The data shape here carries the same fields the route body does
      // (engine/resolution/speechMode/voiceSpeed/script/avatarSource).
      //
      // CRITICAL: bucket the reserve on the SAME script that will be SENT, not
      // on raw node data. In text mode the script can be WIRED from an upstream
      // text producer (text-prompt/generate-script/ai-writer → `script` handle)
      // while `data.script` is empty. resolveAiAvatarCreditId buckets by script
      // LENGTH; if we passed raw `data` here the reserve would estimate from the
      // empty data.script (→ 30s bucket, ~135cr) while the payload sends the long
      // wired script (a multi-minute clip). The metered true-up at commit can
      // ONLY refund a surplus — it never charges an overage — so that mismatch
      // silently undercharges by the full overage (refund-only invariant
      // violation). Note ai-avatar is NOT in NODE_MAPPABLE_FIELDS, so
      // FieldMappings never backfills data.script — the merge below is the only
      // place the wired script reaches the bucket. Single-node Run already
      // resolves script-first before reserving, so this aligns both paths.
      const aiAvatarResolvedScript =
        resolvedInputs.script ?? (data.script as string | undefined)
      const aiAvatarCreditBody = { ...(data as Record<string, unknown>), script: aiAvatarResolvedScript }
      const aiAvatarCreditId = resolveAiAvatarCreditId(aiAvatarCreditBody)
      const aiAvatarPayload: Record<string, unknown> = {
        jobId,
        avatarSource: (data.avatarSource as string | undefined) ?? "avatar",
        engine: aiAvatarEngine,
        avatarId: data.avatarId,
        imageUrl: resolvedInputs.imageUrl || (data.imageUrl as string | undefined),
        speechMode: data.speechMode ?? "text",
        script: aiAvatarResolvedScript,
        voiceId: data.voiceId,
        voiceSpeed: data.voiceSpeed,
        pitch: data.pitch,
        volume: data.volume,
        locale: data.locale,
        ttsEngine: data.ttsEngine,
        audioUrl: resolvedInputs.audioUrl || (data.audioUrl as string | undefined),
        resolution: aiAvatarResolution,
        aspectRatio: data.aspectRatio ?? "16:9",
        fit: data.fit,
        outputFormat: data.outputFormat,
        caption: data.caption,
        captionStyle: data.captionStyle,
        background: data.background,
        removeBackground: data.removeBackground,
        motionPrompt: data.motionPrompt,
        expressiveness: data.expressiveness,
        usageLogId,
      }
      // Structural validation on the ASSEMBLED payload — the orchestrator/app/MCP
      // paths bypass the route Zod (`aiAvatarBody`). Throws BEFORE reserve/enqueue
      // (node-executor deletes the orphaned pending job on throw). Single source
      // of truth shared with the route via @nodaro/shared.
      validateAiAvatarPayload(aiAvatarPayload)
      return {
        jobName: "ai-avatar",
        queueName: "video-generation",
        modelIdentifier: aiAvatarCreditId,
        payload: aiAvatarPayload,
      }
    }

    case "cinematic-avatar": {
      // Credit identifier MUST come from resolveCinematicCreditId (the single
      // source of truth shared with the route's creditGuard) so that:
      //  (a) it is always one of the 24 SEEDED exact-duration ids — never an
      //      unseeded id that would hard-fail with 503 price_not_configured, and
      //  (b) out-of-range durations are clamped to 4–15s exactly as the route does.
      const cinematicCreditId = resolveCinematicCreditId(data as Record<string, unknown>)
      // Assemble the references array from the resolved reference handle inputs
      // (the orchestrator routes ref-video/ref-audio/ref-image →
      // refVideoUrl/refAudioUrl/refImageUrl) plus any pre-seeded data.references
      // (single-node Run path). Wired inputs take priority over a same-kind
      // data entry; duplicate urls are dropped. Empty → references omitted.
      const cinematicReferences = buildCinematicReferences(resolvedInputs, data)
      const cinematicPayload: Record<string, unknown> = {
        jobId,
        prompt: promptFor("cinematic-avatar"),
        avatarLooks: data.avatarLooks,
        duration: data.duration,
        autoDuration: data.autoDuration,
        aspectRatio: data.aspectRatio ?? "16:9",
        resolution: (data.resolution as string) ?? "720p",
        enhancePrompt: data.enhancePrompt,
        ...(cinematicReferences.length > 0 ? { references: cinematicReferences } : {}),
        usageLogId,
      }
      // Structural validation on the ASSEMBLED payload — the orchestrator/app/MCP
      // paths bypass the route Zod (`cinematicAvatarBody`). Enforces avatarLooks
      // count (1–3), enum bounds, and the combined reference caps (≤3 videos;
      // avatarLooks + image refs ≤ 9) that cinematic.ts forwards to HeyGen
      // unvalidated. Throws BEFORE reserve/enqueue (node-executor deletes the
      // orphaned pending job on throw). Single source of truth shared with the
      // route via @nodaro/shared.
      validateCinematicAvatarPayload(cinematicPayload)
      return {
        jobName: "cinematic-avatar",
        queueName: "video-generation",
        modelIdentifier: cinematicCreditId,
        payload: cinematicPayload,
      }
    }

    case "motion-transfer": {
      const mtProvider = (data.provider as string) ?? "kling"
      const mtResolution = (data.resolution as string) ?? "720p"
      const mtVideoDuration = data.videoDuration as number | undefined
      const mtModelId = buildMotionCreditModelIdentifier(mtProvider, mtResolution, mtVideoDuration)
      return {
        jobName: "motion-transfer",
        queueName: "video-generation",
        modelIdentifier: mtModelId,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          prompt: applyPromptAffixes(resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap), readPromptAffixes(data), refMap),
          negativePrompt: resolvedInputs.negativePrompt || (data.negativePrompt as string | undefined),
          provider: mtProvider,
          backgroundSource: data.backgroundSource,
          characterOrientation: data.characterOrientation,
          resolution: mtResolution,
          videoDuration: mtVideoDuration,
          usageLogId,
        },
      }
    }

    case "video-upscale": {
      const vuProvider = (data.provider as string) ?? "topaz"
      const vuModel = vuProvider === "veo-1080p" ? "veo-1080p"
        : vuProvider === "veo-4k" ? "veo-4k"
        : "topaz-video"
      return {
        jobName: "video-upscale",
        queueName: "video-generation",
        modelIdentifier: vuModel,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          upscaleFactor: data.upscaleFactor,
          provider: vuProvider,
          kieTaskId: resolvedInputs.kieTaskId || data.kieTaskId,
          usageLogId,
        },
      }
    }

    case "extend-video": {
      const evProvider = (data.provider as string) ?? "veo-extend"

      // ─── LTX 2.3 Pro extend ──────────────────────────────────────────────
      // LTX extend operates on the source video URL (no KIE taskId — Replicate
      // accepts any HTTPS-reachable video). Webhook-driven completion via the
      // standard Replicate prediction reconcile path. `duration` is the number
      // of seconds to ADD (1–20); `extendMode` is "start" or "end" (defaults
      // to "end" — append).
      if (evProvider === "ltx-2.3-pro") {
        return {
          jobName: "extend-video",
          queueName: "video-generation",
          modelIdentifier: evProvider,
          payload: {
            jobId,
            provider: evProvider,
            video: resolvedInputs.videoUrl || data.videoUrl,
            duration: data.duration,
            extend_mode: (data.extendMode as string | undefined) ?? "end",
            usageLogId,
          },
        }
      }

      // Shared by the prompt-consuming branches (seedance + KIE): manual
      // prompt + cinematography hints + identity lock + "Avoid: …" negative
      // injection (no extend provider accepts native negative_prompt).
      // Mirrors the /v1/extend-video route's behavior.
      const buildExtendPrompt = (): string | undefined => {
        let p: string | undefined = promptFor("extend-video")
        {
          const cinematographyHints = collectCinematographyHints(node.id, buildCtx)
          if (cinematographyHints.length > 0) {
            const joined = cinematographyHints.join(", ")
            p = p ? `${p}. ${joined}` : joined
          }
        }
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
        const neg = (resolvedInputs.negativePrompt || (data.negativePrompt as string | undefined))
        const { prompt: pWithNeg } = applyVideoNegativePrompt(p, neg, evProvider)
        return pWithNeg
      }

      // ─── Seedance 2 trim-stitch extend ───────────────────────────────────
      // URL-based like LTX, but the continuation CONTENT is required — the
      // worker wraps it in the spike-proven bare temporal template and then
      // trim-stitches source+extension. Composite credits (duration tier ×
      // resolution) via the same shared builder the HTTP route uses, so
      // orchestrator and single-node runs reserve identically.
      if (evProvider === "seedance-2-extend") {
        return {
          jobName: "extend-video",
          queueName: "video-generation",
          // Priced for the model SEEDANCE_EXTEND_GENERATION_MODEL actually
          // dispatches on — the orchestrator reserves for real, and
          // commit_credits only ever refunds a surplus, so a 2.0 reservation
          // against a 2.5 generation would be a permanent shortfall.
          modelIdentifier: buildSeedanceExtendCreditIdentifier(
            data.duration as number | undefined,
            data.resolution as string | undefined,
          ),
          payload: {
            jobId,
            provider: evProvider,
            video: resolvedInputs.videoUrl || data.videoUrl,
            prompt: buildExtendPrompt(),
            duration: data.duration,
            resolution: data.resolution,
            generateAudio: data.generateAudio,
            usageLogId,
          },
        }
      }

      const evModel = evProvider === "veo-extend"
        ? (evProvider + (data.model === "quality" ? ":quality" : ""))
        : evProvider
      return {
        jobName: "extend-video",
        queueName: "video-generation",
        modelIdentifier: evModel,
        payload: {
          jobId,
          kieTaskId: resolvedInputs.kieTaskId || data.kieTaskId,
          prompt: buildExtendPrompt(),
          provider: evProvider,
          model: evProvider === "veo-extend" ? (data.model ?? "fast") : undefined,
          quality: evProvider === "runway-extend" ? (data.quality ?? "720p") : undefined,
          seeds: evProvider === "veo-extend" ? data.seeds : undefined,
          usageLogId,
        },
      }
    }

    // ─── LTX 2.3 Pro Retake ───────────────────────────────────────────────
    // Replace a portion of a video — audio only / video only / both —
    // using LTX 2.3 Pro's `retake` task on Replicate. Webhook-driven
    // completion via the standard Replicate reconcile path. Credit math is
    // `ltx-2.3-pro-retake:per-second × retakeDuration` (the route hook
    // applies the multiplication on the single-node path; the orchestrator
    // path also bills `:per-second` here so reconciliation sums match).
    case "video-retake": {
      // Walk incoming edges to derive the LTX camera_motion enum. Mirror of
      // the LTX generate-video case — `ltxCameraMotionFromUpstream` consumes
      // the same `{ nodeType, data: { cameraMotion } }[]` shape.
      const incomingNodes = (buildCtx?.edges ?? [])
        .filter((e) => e.target === node.id)
        .map((e) => (buildCtx?.nodes ?? []).find((n) => n.id === e.source))
        .filter((n): n is SimpleNode => !!n)
      const hints = incomingNodes.map((n) => ({
        nodeType: n.type,
        data: { cameraMotion: (n.data as Record<string, unknown>).cameraMotion as string | undefined },
      }))
      const cameraMotion = ltxCameraMotionFromUpstream(hints) ?? "none"

      return {
        jobName: "video-retake",
        queueName: "video-generation",
        // Orchestrator path uses the static `video-retake` fallback (100cr,
        // ~2s worth). Single-node route uses `computeCredits` with the actual
        // `ltx-2.3-pro-retake:per-second × retakeDuration` math — mirrors the
        // extend-video LTX pattern where orchestrator reserves the base rate
        // and reconciliation refunds the diff once Replicate reports actual.
        modelIdentifier: "video-retake",
        payload: {
          jobId,
          provider: "ltx-2.3-pro",
          video: resolvedInputs.videoUrl || (data.videoUrl as string | undefined),
          prompt: promptFor("video-retake"),
          retake_start_time: data.retakeStartTime as number | undefined,
          retake_duration: data.retakeDuration as number | undefined,
          retake_mode: data.retakeMode as string | undefined,
          resolution: "1080p",
          aspect_ratio: (data.aspectRatio as string | undefined) ?? "16:9",
          fps: (data.fps as number | undefined) ?? 25,
          generate_audio: (data.generateAudio as boolean | undefined) ?? true,
          camera_motion: cameraMotion,
          usageLogId,
        },
      }
    }

    // --- Audio ---
    case "text-to-speech": {
      // An upstream Character node's voice (resolvedInputs.voice/.provider/.voiceType,
      // auto-wired in input-resolver) wins over the node's own config when present —
      // the character is the source of truth for "this character's voice".
      //
      // Single source of truth with the surface model-deny check above
      // (effectiveDispatchProvider, :1656): the deny check and the egress
      // modelKey (worker → ttsModelKey(job.data.provider)) must read ONE helper
      // so a future edit to one cannot desync the other. §5.3 hard gate. The
      // helper's `||` precedence mirrors the old inline byte-for-byte.
      const provider = effectiveDispatchProvider(type, data, resolvedInputs) || "elevenlabs-v3"
      // Frontend reads text from directText field when textSource is "direct"
      const ttsText = promptFor("text-to-speech")
      // The EFFECTIVE voice + type this node will DISPATCH — computed once with
      // the same precedence the payload below uses, so the value we vet is byte-
      // identical to the value we send.
      const effectiveVoice = resolvedInputs.voice || data.voiceId || data.voice
      const effectiveVoiceType = resolvedInputs.voiceType || data.voiceType || "premade"
      // B4c: voice-gender dispatch backstop. `voice.allowedGenders` was enforced
      // ONLY at the direct /v1/text-to-speech route — the orchestrator/worker TTS
      // path had NO backstop, so an auto-wired Character voice (input-resolver) or
      // an imported/MCP-authored premade voice of a DISALLOWED gender reached the
      // provider under a gender lock. This is the B1 model-deny bypass class:
      // vet the EFFECTIVE voice (not just data.voiceId) and reject a disallowed
      // premade gender at run time, mirroring model-deny's thrown shape. Custom /
      // library / unknown-gender voices pass (clone/design/remix are gated by
      // nodes.deny). Inert by default: isVoiceGenderAllowed returns true when
      // allowedGenders is [].
      if (effectiveVoiceType !== "custom" && effectiveVoiceType !== "library") {
        const g = premadeVoiceGender(typeof effectiveVoice === "string" ? effectiveVoice : undefined)
        if (g !== undefined && !isVoiceGenderAllowed(g)) {
          const err = new Error("The selected voice is not available on this deployment.") as Error & { code?: string }
          err.code = "voice_not_available"
          throw err
        }
      }
      return {
        jobName: "text-to-speech",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          text: ttsText,
          voice: effectiveVoice,
          provider,
          voiceType: effectiveVoiceType,
          stability: data.stability,
          similarityBoost: data.similarityBoost,
          style: data.style,
          speed: data.speed,
          languageCode: data.languageCode,
          usageLogId,
        },
      }
    }

    case "generate-music": {
      const provider = (data.provider as string) ?? "musicgen"
      const audioStyle = collectAudioStyleHints(node, "generate-music", buildCtx)
      const userPrompt = promptFor("generate-music")
      const composed = truncateForField(audioStyle.text, userPrompt, 2000)
      const finalPrompt = appendField(userPrompt, composed)
      // composeSoundHintFromConnections already gates fields.{genre,mood,instrumental}
      // on consumer.data.provider === "minimax" — they're undefined for other
      // providers, so a flat `data.x || audioStyle.fields.x` short-circuits
      // correctly without an outer isMinimax ternary.
      const musicGenre = (data.genre as string | undefined) || audioStyle.fields.genre
      const musicMood = (data.mood as string | undefined) || audioStyle.fields.mood
      const musicInstrumental = Boolean(data.instrumental || audioStyle.fields.instrumental)
      // Fold genre/mood/instrumental INTO the prompt the same way the single-node
      // route does (appendMusicMeta). The music worker only reads `prompt`, so
      // without this those three controls were silently ignored in workflow runs.
      const enrichedMusicPrompt = appendMusicMeta(finalPrompt, {
        genre: musicGenre,
        mood: musicMood,
        instrumental: musicInstrumental,
      })
      return {
        jobName: "generate-music",
        queueName: "video-generation",
        modelIdentifier: "generate-music",
        payload: {
          jobId,
          prompt: enrichedMusicPrompt,
          provider,
          duration: data.duration,
          genre: musicGenre,
          mood: musicMood,
          instrumental: musicInstrumental,
          lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
          referenceAudioUrl: resolvedInputs.audioUrl || data.referenceAudioUrl,
          // modelVersion is an optional Suno-family field (v4/v5/v4.5); forward
          // so orchestrator runs respect the user's model selection.
          modelVersion: data.modelVersion,
          usageLogId,
        },
      }
    }

    case "text-to-audio": {
      const t2aProvider = (data.provider as string) ?? "elevenlabs-sfx"
      const audioStyle = collectAudioStyleHints(node, "text-to-audio", buildCtx)
      const userPrompt = promptFor("text-to-audio")
      const composed = truncateForField(audioStyle.text, userPrompt, 2000)
      const finalPrompt = appendField(userPrompt, composed)
      return simpleResult("text-to-audio", "elevenlabs-sfx", {
        jobId,
        prompt: finalPrompt,
        provider: t2aProvider,
        duration: data.duration,
        // Only send SFX-specific options for elevenlabs-sfx (matches frontend)
        ...(t2aProvider === "elevenlabs-sfx" ? {
          loop: data.loop,
          promptInfluence: data.promptInfluence,
        } : {}),
        usageLogId,
      })
    }

    case "audio-isolation":
      return simpleResult("audio-isolation", "elevenlabs-isolation", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        usageLogId,
      })

    case "audio-separation": {
      // Mirror the route's creditGuard (audioSeparationCreditId) so orchestrated
      // runs don't under-charge: full-stems (auto/best) → htdemucs_6s tier,
      // "best" vocal/instrumental → htdemucs_ft tier, else base.
      const sepQuality = (data.quality as string | undefined) || "auto"
      const sepMode = (data.mode as string | undefined) || "vocal_instrumental"
      const sepIdentifier =
        sepMode === "stems" && sepQuality !== "fast"
          ? "audio-separation:stems"
          : sepQuality === "best"
            ? "audio-separation:best"
            : "audio-separation"
      return simpleResult("audio-separation", sepIdentifier, {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        mode: (data.mode as string | undefined) || "vocal_instrumental",
        quality: sepQuality,
        usageLogId,
      })
    }

    case "text-to-dialogue": {
      // Filter empty dialogue lines (matches frontend behavior)
      const rawDialogue = (data.dialogue ?? data.script) as Array<{ text: string; voice?: string }> | undefined
      const filteredDialogue = rawDialogue?.filter((l) => l.text?.trim())
      // Fail HONESTLY before dispatch when nothing is left to voice. The route
      // Zod can't cover this seam (orchestrator enqueues directly), and letting
      // it through means a raw provider 422 mid-run after credits reserve —
      // mirrors the frontend engine's "no dialogue lines" rejection.
      if (!filteredDialogue || filteredDialogue.length === 0) {
        throw new Error("Text to Dialogue has no dialogue lines — add at least one line with text before running")
      }
      // B4c: per-line voice-gender backstop, mirroring the TTS case above —
      // the orchestrator path must vet what it dispatches, not trust the
      // route. Dialogue lines carry no voiceType, so vet by name resolution
      // alone: custom/library UUIDs resolve to `undefined` gender and pass.
      for (const line of filteredDialogue) {
        const g = premadeVoiceGender(typeof line.voice === "string" ? line.voice : undefined)
        if (g !== undefined && !isVoiceGenderAllowed(g)) {
          const err = new Error("A selected voice is not available on this deployment.") as Error & { code?: string }
          err.code = "voice_not_available"
          throw err
        }
      }
      return simpleResult("text-to-dialogue", "elevenlabs-dialogue", {
        jobId,
        dialogue: filteredDialogue,
        stability: data.stability,
        languageCode: data.languageCode,
        seed: data.seed,
        applyTextNormalization: data.applyTextNormalization,
        usageLogId,
      })
    }

    case "voice-changer":
      // Dual-mode: a wired video input switches the worker to video mode
      // (demux → STS → remux). Video wins over audio when both are present.
      return simpleResult("voice-changer", "elevenlabs-voice-changer", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        voiceId: data.voiceId || data.voice,
        model: data.model,
        stability: data.stability,
        similarityBoost: data.similarityBoost,
        style: data.style,
        removeBackgroundNoise: data.removeBackgroundNoise,
        usageLogId,
      })

    case "voice-changer-pro": {
      // Multi-speaker recast: orderedVoices is an array of { voiceId, ... }
      // objects on the node data. The worker expects a string[] of voice ids
      // (one per speaker, in first-appearance order). Unmapped speakers pass
      // through unchanged when the array is shorter than the detected count.
      // NOTE: the orchestrator reserves credits via a flat model-identifier
      // lookup ("voice-changer-pro" → 4 credits in STATIC_CREDIT_COSTS / model_pricing).
      // The single-node route reserves credits dynamically, scaled to the
      // number of mapped speakers. The orchestrator path has no equivalent
      // per-node hook, so it reserves the flat base cost regardless of
      // speaker count — under-reserving relative to what the worker
      // actually commits on multi-speaker (>1 voice) runs. Follow-up: wire
      // a dynamic per-node credit override into the orchestrator (same
      // class of fix as the route's).
      // A null entry means "keep this speaker's original voice" (cloud-plugins
      // orderedVoices contract) — preserve it positionally.
      //
      // OBJECTS PASS THROUGH WHOLE. This used to flatten each entry to its
      // bare voiceId — which silently dropped every per-voice lever the node
      // stored (stability, similarityBoost, style, useSpeakerBoost, seed —
      // a LIVE latent bug: the Run button honoured them, a workflow run did
      // not) and would have dropped the new `engine` ("v3" re-speak) with
      // them. The plugin route's wire schema accepts the object form
      // natively (recastVoice union), so pass the node's own objects.
      const rawVoices = (data.orderedVoices ?? []) as Array<{ voiceId: string } | null>
      const orderedVoices = rawVoices.map((v) =>
        v === null ? null : (typeof v === "string" ? v : { ...v }),
      )
      // Fail fast BEFORE a job row is created and credits are reserved — same
      // ≥1-non-null contract the route enforces with a 400 and the editor's
      // executeNode enforces with a toast. This path dispatches straight to
      // the worker (no route), so without this guard an all-keep node ships a
      // recast-nothing job to the pipeline mid-execution.
      if (orderedVoices.length === 0) {
        throw new Error("Voice Changer Pro: add at least one voice.")
      }
      if (orderedVoices.every((v) => v === null)) {
        throw new Error(
          "Voice Changer Pro: at least one speaker needs a new voice — every entry is a keep-original slot.",
        )
      }
      return simpleResult("voice-changer-pro", "voice-changer-pro", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        orderedVoices,
        model: data.model,
        preserveBackground: data.preserveBackground,
        removeBackgroundNoise: data.removeBackgroundNoise,
        usageLogId,
      })
    }

    case "generate-video-pro": {
      // Multi-segment Seedance-2-family stitch (private-plugin engine — see
      // ee/billing/generate-video-pro-credits.ts). Deliberately THIN: no
      // reservation logic here (see the voice-changer-pro NOTE above this
      // case for why a flat model-identifier reservation would under-reserve
      // a dynamically-priced node — the same class of gap, fixed here via
      // node-executor's computeGenerateVideoProCreditOverride instead of left
      // open). The node-input-resolver mapping for a dedicated image/video
      // handle set lands in a later task; until then this reads the same
      // generic resolvedInputs fields the unified generate-video case reads
      // (resolvedInputs.startFrameUrl / .imageUrl / .referenceImageUrls),
      // falling back to pre-seeded node data (single-node Run path), mirrored
      // minimally rather than the full mention/frame-promotion machinery
      // generate-video needs for its many providers.
      //
      // `type: "generate-video-pro"` is a deliberate marker stamped onto the
      // PAYLOAD itself (not just the outer jobName/modelIdentifier returned
      // alongside it) so node-executor's computeGenerateVideoProCreditOverride
      // can recognize this dispatch from the payload object alone — the same
      // object it also mutates in place (duration clamp + proPricing stamp)
      // before the credit reservation call.
      const gvpProvider = (data.provider as string | undefined) ?? "seedance-2"
      // FULL generate-video prompt assembly (parity by construction): user
      // prompt + look/elements cinematography hints + identity-lock clause,
      // then @mention/assets resolution numbering AFTER the leading image
      // refs (D5) with wired entities attached — the same calls the unified
      // generate-video case above makes, minus its per-provider dispatch.
      let gvpPrompt = composeVideoPrompt({
        rawPrompt: promptFor("generate-video-pro", true),
        nodeId: node.id,
        buildCtx,
      })
      let gvpRefs = resolvedInputs.referenceImageUrls
      const gvpMention = resolveVideoPromptMentions(gvpPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceImageOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
        ordinalOffset: countRefModalityEdges(node.id, "image", buildCtx),
        includeWiredEntities: true,
        videoRefCount: countRefModalityEdges(node.id, "video", buildCtx),
        audioRefCount: countRefModalityEdges(node.id, "audio", buildCtx),
      })
      gvpPrompt = gvpMention.prompt
      if (gvpMention.additionalUrls.length > 0) {
        // DELIBERATE parity delta (no mention→frame promotion, unlike
        // generate-video): the pro engine sends the reference array with
        // EVERY segment, so identity/style persist across the whole stitched
        // video — promoting a lone mention into the seg1-only start-frame
        // slot would LOSE the identity from segment 2 onward.
        const existing = gvpRefs ?? []
        const merged: string[] = []
        const seen = new Set<string>()
        for (const u of existing) if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
        for (const u of gvpMention.additionalUrls) if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
        gvpRefs = merged
      }
      return simpleResult("generate-video-pro", "generate-video-pro", {
        jobId,
        type: "generate-video-pro",
        prompt: gvpPrompt,
        provider: gvpProvider,
        duration: data.duration as number | undefined,
        aspectRatio: (data.aspectRatio as string | undefined) ?? "adaptive",
        resolution: (data.resolution as string | undefined) ?? "720p",
        generateAudio: data.generateAudio as boolean | undefined,
        noBackgroundMusic: typeof data.noBackgroundMusic === "boolean" ? data.noBackgroundMusic : undefined,
        startFrameUrl: resolvedInputs.startFrameUrl || resolvedInputs.imageUrl || (data.startFrameUrl as string | undefined),
        referenceImageUrls: gvpRefs || (data.referenceImageUrls as string[] | undefined),
        // Typed-handle levers (resolved generically by targetHandle in
        // input-resolver.ts): panel-typed + wired negative composed exactly
        // like generate-video; the final segment's closing frame; the Extend
        // Source (limit 1); the post-gen audio overlay; per-segment r2v
        // reference audio. Inert on plugin versions predating their
        // consumption (extra payload keys are ignored by the handler).
        negativePrompt: composeNegative(resolveRefs(data.negativePrompt as string | undefined, refMap), resolvedInputs.negativePrompt) || undefined,
        endFrameUrl: resolvedInputs.endFrameUrl,
        extendVideoUrl: resolvedInputs.referenceVideoUrls?.[0],
        audioUrl: resolvedInputs.audioUrl,
        referenceAudioUrls: resolvedInputs.referenceAudioUrls,
        // Planner override + PLAN-ONLY mode — fail-safe narrowed; inert on
        // plugin versions predating them (extra keys ignored by the handler).
        plannerModel: typeof data.plannerModel === "string" && data.plannerModel ? data.plannerModel : undefined,
        planOnly: data.planOnly === true ? true : undefined,
        contextTailSec: typeof data.contextTailSec === "number" ? data.contextTailSec : undefined,
        autoCastFromAnalysis: data.autoCastFromAnalysis === true ? true : undefined,
        plannerMode: data.plannerMode === "fidelity" || data.plannerMode === "condense" || data.plannerMode === "anchored" || data.plannerMode === "hybrid" || data.plannerMode === "hybrid-plus" || data.plannerMode === "hybrid-max" ? data.plannerMode : undefined,
        rollingRefs: data.rollingRefs === true ? true : undefined,
        wordCut: data.wordCut === true ? true : undefined,
        shotTimestamps: data.shotTimestamps === true ? true : undefined,
        preferredSegmentSec: typeof data.preferredSegmentSec === "number" ? data.preferredSegmentSec : undefined,
        // EXPLICIT scene-aligned durations (2026-08-03) — passed VERBATIM; the
        // reserve (node-executor override) and the plugin route both validate
        // the same array, so quote/reserve/plan cannot drift. Non-number
        // entries are left for the money-side validator to reject loudly.
        segmentDurations:
          Array.isArray(data.segmentDurations) && data.segmentDurations.length > 0
            ? (data.segmentDurations as number[])
            : undefined,
        // Render method (2026-08-03): only the "keyframes" opt-in rides the
        // wire — absent/"extend" emits undefined (dropped by JSON
        // serialization), keeping pre-renderMethod payloads byte-identical.
        // COERCE, don't fail (2026-08-05): `renderMethod` defaults to "extend",
        // but extend sends the previous segment's tail as a reference VIDEO,
        // which only the r2v family accepts — pricing refuses the combination
        // rather than reserve credits for a run that cannot render. A provider
        // that cannot extend has exactly ONE method available, so an ABSENT
        // choice resolves to it here, at the single point where node data
        // becomes the wire payload. Without this, every workflow using a
        // provider blessed on 2026-08-05 fails on first run unless its panel
        // happened to be opened (the editor's fail-safe snap) — imported
        // workflows and API callers had no such chance.
        //
        // An EXPLICIT "extend" is still rejected downstream: that is a stated
        // user choice the provider cannot honour, and silently changing it
        // would bill a different run from the one requested.
        renderMethod:
          data.renderMethod === "keyframes" || !supportsExtendRender(gvpProvider)
            ? "keyframes"
            : undefined,
        // ANCHOR MODE — how much a keyframes run pins its shots to
        // pre-generated stills. Goes through the SAME shared resolver the
        // canvas Run path uses, so a workflow run and the Run button request
        // the identical mode. "auto"/absent → undefined (dropped by JSON
        // serialization), keeping pre-anchorMode payloads byte-identical.
        anchorMode: resolveGvpAnchorWire(typeof data.anchorMode === "string" ? data.anchorMode : undefined),
        audioTail: data.audioTail === true ? true : undefined,
        overlapAnchor: data.overlapAnchor === true ? true : undefined,
        overlapAnchorMode: data.overlapAnchor === true && data.overlapAnchorMode === "last-frame" ? "last-frame" : undefined,
        smartCutMode: data.smartCutMode === "preroll-keep-prev" || data.smartCutMode === "preroll-keep-next" ? data.smartCutMode : undefined,
        smartCutAudio: data.smartCutAudio === true ? true : undefined,
        // Best-pair search windows — clamped through the SAME shared helper the
        // canvas Run path uses, so the two send paths can't disagree about what
        // the engine accepts. Absent/garbage → undefined → engine default 8/8.
        smartCutFramesPrev: clampSmartCutWindow(data.smartCutFramesPrev),
        smartCutFramesNext: clampSmartCutWindow(data.smartCutFramesNext),
        usageLogId,
      })
    }

    case "edit-video-pro": {
      // Replace-span Seedance-2 bridge (private-plugin engine — see
      // ee/billing/edit-video-pro-credits.ts). Deliberately THIN: no
      // reservation logic here (same reasoning as generate-video-pro above);
      // node-executor's computeEditVideoProCreditOverride probes + clamps +
      // stamps proPricing on this same payload object before reserving.
      // `type: "edit-video-pro"` is the payload marker that override gates on.
      return simpleResult("edit-video-pro", "edit-video-pro", {
        jobId,
        type: "edit-video-pro",
        mode: (data.mode as string | undefined) ?? "replace",
        videoUrl: resolvedInputs.videoUrl || (data.videoUrl as string | undefined),
        spanStart: data.spanStart as number | undefined,
        spanEnd: data.spanEnd as number | undefined,
        prompt: promptFor("edit-video-pro", true),
        provider: (data.provider as string | undefined) ?? "seedance-2",
        generateAudio: data.generateAudio as boolean | undefined,
        referenceImageUrls: resolvedInputs.referenceImageUrls || (data.referenceImageUrls as string[] | undefined),
        usageLogId,
      })
    }

    case "dubbing": {
      // Source precedence mirrors the frontend engine: a panel sourceUrl
      // (ElevenLabs fetches the link) wins over wired inputs; among wired
      // inputs video wins over audio. Exactly one source reaches the worker.
      const dubSourceUrl = typeof data.sourceUrl === "string" && data.sourceUrl.trim() ? data.sourceUrl.trim() : undefined
      const dubVideoUrl = dubSourceUrl ? undefined : (resolvedInputs.videoUrl || (data.videoUrl as string | undefined))
      const dubAudioUrl = dubSourceUrl || dubVideoUrl ? undefined : (resolvedInputs.audioUrl || (data.audioUrl as string | undefined))
      return simpleResult("dubbing", "elevenlabs-dubbing", {
        jobId,
        audioUrl: dubAudioUrl,
        videoUrl: dubVideoUrl,
        sourceUrl: dubSourceUrl,
        targetLanguage: data.targetLanguage,
        sourceLanguage: data.sourceLanguage,
        numSpeakers: data.numSpeakers,
        disableVoiceCloning: data.disableVoiceCloning,
        dropBackgroundAudio: data.dropBackgroundAudio,
        startTime: data.startTime,
        endTime: data.endTime,
        highestResolution: data.highestResolution,
        useProfanityFilter: data.useProfanityFilter,
        targetAccent: data.targetAccent,
        watermark: data.watermark,
        usageLogId,
      })
    }

    case "voice-remix":
      return simpleResult("voice-remix", "elevenlabs-voice-remix", {
        jobId,
        voiceDescription: applyPromptAffixes(data.voiceDescription as string | undefined, readPromptAffixes(data), refMap),
        text: resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap),
        usageLogId,
      })

    case "voice-design": {
      const audioStyle = collectAudioStyleHints(node, "voice-design", buildCtx)
      const userVoiceDesc = applyPromptAffixes(data.voiceDescription as string | undefined, readPromptAffixes(data), refMap) ?? ""
      const composed = truncateForField(audioStyle.text, userVoiceDesc, 1000)
      const finalVoiceDescription = appendField(userVoiceDesc, composed)
      return simpleResult("voice-design", "elevenlabs-voice-design", {
        jobId,
        text: resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap),
        voiceDescription: finalVoiceDescription,
        model: data.model,
        loudness: data.loudness,
        guidanceScale: data.guidanceScale,
        seed: data.seed,
        quality: data.quality,
        shouldEnhance: data.shouldEnhance,
        usageLogId,
      })
    }

    case "forced-alignment":
      return simpleResult("forced-alignment", "elevenlabs-forced-alignment", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        transcript: applyPromptAffixes(resolvedInputs.prompt || resolveRefs(data.transcript as string | undefined, refMap), readPromptAffixes(data), refMap),
        usageLogId,
      })

    // --- Suno ---
    case "suno-generate": {
      const sunoGenCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-generate"
      // Delegate the custom-mode / connected-picker fold to the shared
      // assembler — the single source of truth shared with the FE run +
      // editor preview. `throwOnEmpty: false`: the orchestrator never rejects
      // an empty prompt here (an empty payload surfaces as a provider error
      // downstream, as before). This reconciles the prior BE divergences
      // toward the FE: skip truncation when the user field is empty (B),
      // `||`-precedence vocalGender (D), and `|| undefined` normalization of
      // model/style/title/negativeStyle/lyrics (E).
      const result = assembleSunoInput({
        node,
        graph: { nodes: buildCtx?.nodes ?? [], edges: buildCtx?.edges ?? [] },
        userPrompt: applyPromptAffixes(
          resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          readPromptAffixes(data), refMap) || "",
        lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
        persona: resolvePersona(resolvedInputs, data),
        throwOnEmpty: false,
      })
      return simpleResult("suno-generate", sunoGenCreditId, { jobId, ...result, usageLogId })
    }

    case "suno-cover": {
      const hasCoverCustomFields = !!(data.style || data.title || data.lyrics)
      const sunoCoverCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-cover"
      // The source track is mandatory — Suno Cover has nothing to cover
      // without it, and KIE's own validator rejects an absent/empty
      // uploadUrl outright ("uploadUrl cannot be null", spec §11.3). Fail
      // fast before reserving credits (mirrors AI Audit's video_required
      // above) instead of letting an orchestrated run with nothing wired
      // reach KIE with `undefined` (the node's own defaultData seeds
      // uploadUrl: "", which is equally falsy here).
      const coverUploadUrl =
        resolvedInputs.uploadUrl || resolvedInputs.audioUrl || data.uploadUrl || data.audioUrl
      if (!coverUploadUrl) {
        throw codedMediaRefusal("audio_required", "connect an audio track to the Suno Cover node")
      }
      return simpleResult("suno-cover", sunoCoverCreditId, {
        jobId,
        prompt: applyPromptAffixes(resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap), readPromptAffixes(data), refMap),
        uploadUrl: coverUploadUrl,
        model: data.model,
        lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        customMode: data.customMode ?? hasCoverCustomFields,
        instrumental: data.instrumental ?? false,
        ...resolvePersona(resolvedInputs, data),
        usageLogId,
      })
    }

    case "suno-extend": {
      // Suno consumer ids (here and the cases below): a wired connection, then
      // the node's MANUAL field — the same two-step rule the canvas applies and
      // the config panel states. `data.sunoTrackId` / `data.sunoTaskId` on a
      // consumer are the ids of its OWN last output (stamped after a run for
      // the next hop), never an input: reading them before the manual field
      // made a stale self-stamp shadow a hand-typed id on orchestrator runs
      // (#819 review).
      const sunoExtCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-extend"
      return simpleResult("suno-extend", sunoExtCreditId, {
        jobId,
        audioId: resolvedInputs.sunoTrackId || data.audioId,
        defaultParamFlag: data.defaultParamFlag ?? true,
        prompt: applyPromptAffixes(resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap), readPromptAffixes(data), refMap),
        model: data.model,
        style: data.style,
        title: data.title,
        continueAt: data.continueAt ?? data.continueFrom,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        styleWeight: data.styleWeight,
        weirdnessConstraint: data.weirdnessConstraint,
        audioWeight: data.audioWeight,
        ...resolvePersona(resolvedInputs, data),
        usageLogId,
      })
    }

    case "suno-lyrics":
      return simpleResult("suno-lyrics", "suno-lyrics", {
        jobId,
        prompt: applyPromptAffixes(resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap), readPromptAffixes(data), refMap),
        usageLogId,
      })

    case "suno-separate": {
      // `split_stem` is ~3x more expensive than `separate_vocal` — the route's
      // creditGuard switches identifiers based on `type`. Mirror that here so
      // orchestrated split_stem runs don't under-charge the user.
      const separateType = (data.type as string | undefined) || "separate_vocal"
      const separateIdentifier =
        separateType === "split_stem" ? "suno-separate-stem" : "suno-separate"
      return simpleResult("suno-separate", separateIdentifier, {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.audioId,
        type: separateType,
        usageLogId,
      })
    }

    case "suno-music-video":
      return simpleResult("suno-music-video", "suno-music-video", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.audioId,
        usageLogId,
      })

    case "suno-mashup":
      return simpleResult("suno-mashup", "suno-mashup", {
        jobId,
        uploadUrlList: resolvedInputs.uploadUrlList || [
          resolvedInputs.audioUrl,
          resolvedInputs.audioUrl2,
        ].filter(Boolean),
        model: data.model,
        customMode: data.customMode ?? false,
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        usageLogId,
      })

    case "suno-replace-section":
      return simpleResult("suno-replace-section", "suno-replace-section", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.audioId,
        infillStartS: data.infillStartS ?? 0,
        infillEndS: data.infillEndS ?? 30,
        prompt: promptFor("suno-replace-section"),
        tags: data.tags,
        title: data.title,
        fullLyrics: data.fullLyrics || undefined,
        negativeTags: data.negativeTags || undefined,
        usageLogId,
      })

    case "suno-add-instrumental":
      return simpleResult("suno-add-instrumental", "suno-add-instrumental", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.audioId,
        model: data.model,
        usageLogId,
      })

    case "suno-add-vocals":
      return simpleResult("suno-add-vocals", "suno-add-vocals", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.audioId,
        model: data.model,
        usageLogId,
      })

    case "suno-convert-wav":
      return simpleResult("suno-convert-wav", "suno-convert-wav", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.audioId,
        usageLogId,
      })

    case "suno-upload-extend": {
      // Same requirement as suno-cover above — Suno Upload Extend has no
      // Suno-side fallback (unlike suno-extend's audioId), so an absent
      // uploadUrl is fatal. This node's own defaultData has no `uploadUrl`
      // key at all, so an unwired orchestrated run resolves straight to
      // `undefined` and hits the identical KIE "uploadUrl cannot be null"
      // (spec §11.3). Fail fast before reserving credits rather than let
      // the request reach KIE.
      const uploadExtendUrl = resolvedInputs.audioUrl || data.uploadUrl || data.audioUrl
      if (!uploadExtendUrl) {
        throw codedMediaRefusal("audio_required", "connect an audio track to the Suno Upload Extend node")
      }
      return simpleResult("suno-upload-extend", "suno-upload-extend", {
        jobId,
        uploadUrl: uploadExtendUrl,
        prompt: applyPromptAffixes(resolveRefs(data.prompt as string | undefined, refMap), readPromptAffixes(data), refMap),
        // Route schema requires continueAt as a non-negative number; default to
        // 0 (extend from start) to match the frontend single-node behaviour.
        continueAt: (data.continueAt as number | undefined) ?? 0,
        defaultParamFlag: data.defaultParamFlag ?? true,
        instrumental: (data.instrumental as boolean | undefined) ?? false,
        model: data.model,
        style: resolvedInputs.prompt || data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        usageLogId,
      })
    }

    // --- Transcription / OCR ---
    case "transcribe": {
      const provider = (data.provider as string) ?? "elevenlabs-stt"
      let transcribeAudioUrl = resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl

      // If the audio source is a youtube-video node, prefer its downloadedAudioUrl
      // (matches frontend logic that calls downloadYouTubeAudio before transcribing)
      if (buildCtx?.edges && buildCtx?.nodes && buildCtx?.nodeStates) {
        const transcribeInEdges = buildCtx.edges.filter((e) => e.target === node.id)
        for (const edge of transcribeInEdges) {
          const srcNode = buildCtx.nodes.find((n) => n.id === edge.source)
          if (!srcNode || srcNode.type !== "youtube-video") continue
          const ytAudio = (srcNode.data.downloadedAudioUrl as string | undefined)?.trim()
          if (ytAudio) {
            transcribeAudioUrl = ytAudio
            break
          }
        }
      }

      return {
        jobName: "transcribe",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          audioUrl: transcribeAudioUrl,
          provider,
          language: data.language,
          diarize: data.diarize,
          tagAudioEvents: data.tagAudioEvents,
          usageLogId,
        },
      }
    }

    // --- FFmpeg processing (0 credits) ---
    case "combine-videos": {
      let combineVideoUrls = resolvedInputs.videoUrls || data.videoUrls || []
      // Apply user-configured clip ordering if available (matches frontend logic)
      const clipOrder = data.clipOrder as string[] | undefined
      const sourceEntries = resolvedInputs.videoUrlsWithSourceIds
      let upstreamDurations: Array<number | undefined> | undefined
      if (clipOrder?.length && sourceEntries?.length) {
        const ordered: string[] = []
        const orderedDurations: Array<number | undefined> = []
        for (const nodeId of clipOrder) {
          const entry = sourceEntries.find((e) => e.nodeId === nodeId)
          if (entry) {
            ordered.push(entry.url)
            orderedDurations.push(entry.duration)
          }
        }
        if (ordered.length >= 2) {
          combineVideoUrls = ordered
          upstreamDurations = orderedDurations
        }
      } else if (sourceEntries?.length) {
        upstreamDurations = sourceEntries.map((e) => e.duration)
      }
      return ffmpegResult("combine-videos", {
        jobId,
        videoUrls: combineVideoUrls,
        transition: data.transition ?? "cut",
        transitionDuration: data.transitionDuration ?? 0.5,
        audioMode: data.audioMode ?? "crossfade",
        // Worker reads audioCrossfadeCurve (resolveAudioCrossfadeCurve); dropping
        // it forced every workflow run back to the linear curve.
        audioCrossfadeCurve: data.audioCrossfadeCurve,
        // Audio-only crossfade length; undefined → provider falls back to
        // transitionDuration (pre-split workflows).
        audioCrossfadeDuration: data.audioCrossfadeDuration as number | undefined,
        smartCutEnabled: (data.smartCutEnabled as boolean) ?? false,
        // Cut-point algorithm; unknown/legacy values degrade to best-pair
        // (the pre-mode behavior) at the worker's ?? fallback.
        smartCutMode: data.smartCutMode === "preroll-keep-prev" || data.smartCutMode === "preroll-keep-next" ? data.smartCutMode : undefined,
        smartCutFramesPrev: data.smartCutFramesPrev as number | undefined,
        smartCutFramesNext: data.smartCutFramesNext as number | undefined,
        // Unset trims default to start 1 / end 2 (the user-validated
        // continuation recipe) — same defaults as the route's Zod.
        trimStartFrames: (data.trimStartFrames as number) ?? 1,
        trimEndFrames: (data.trimEndFrames as number) ?? 2,
        upstreamDurations,
        usageLogId,
      })
    }

    case "assemble-narrated-video": {
      const videoUrls = (resolvedInputs.videoUrls || (data.videoUrls as string[] | undefined) || []) as string[]
      const audioUrls = (resolvedInputs.audioUrls || (data.audioUrls as string[] | undefined) || []) as string[]
      // Pairing semantics mirror the frontend executor (execute-node.ts): block i
      // = video[i] + audio[i], index-paired by the "video"/"audio" target
      // handles' connection order (routed via input-resolver's routeVideoOutput /
      // routeAudioOutput, same accumulator combine-videos / mix-audio use). Audio
      // SHORTER than video is valid — trailing blocks are video-only passthrough
      // (assembleNarratedVideo keeps the clip's own audio when no voice is
      // paired). Audio LONGER than video is a pre-flight error: fail before
      // enqueuing instead of silently dropping the extra voice clips.
      if (audioUrls.length > videoUrls.length) {
        throw new Error(
          `Assemble Narrated Video: ${audioUrls.length} voice clips but only ${videoUrls.length} video clips — connect at most one voice clip per video clip`,
        )
      }
      const blocks = videoUrls.map((videoUrl, i) => {
        const audioUrl = audioUrls[i]
        return audioUrl ? { videoUrl, audioUrl } : { videoUrl }
      })
      return ffmpegResult("assemble-narrated-video", {
        jobId,
        blocks,
        voiceVolume: (data.voiceVolume as number | undefined) ?? 100,
        clipAudioVolume: (data.clipAudioVolume as number | undefined) ?? 40,
        maxSlowdown: (data.maxSlowdown as number | undefined) ?? 1.5,
        trimStartFrames: (data.trimStartFrames as number | undefined) ?? 0,
        trimEndFrames: (data.trimEndFrames as number | undefined) ?? 0,
        usageLogId,
      })
    }

    case "image-collage": {
      let collageImageUrls =
        resolvedInputs.imageUrls || (data.imageUrls as string[] | undefined) || []
      const resolution = (data.resolution as string | undefined) === "4K" ? "4K" : "2K"
      let withSourceIds = resolvedInputs.imageUrlsWithSourceIds
      // User-configured input ordering (config-panel drag list). Unlike
      // combine-videos' clipOrder .find() lookup, a collage source can
      // contribute SEVERAL images through one edge (a List) — so each listed
      // source moves ALL its entries as a contiguous block, and unlisted
      // sources append in edge order. Mirrors frontend execute-node.ts.
      const collageImageOrder = data.imageOrder as string[] | undefined
      if (collageImageOrder?.length && withSourceIds?.length === collageImageUrls.length) {
        const listed = new Set(collageImageOrder)
        const ordered = [
          ...collageImageOrder.flatMap((nodeId) => withSourceIds!.filter((e) => e.nodeId === nodeId)),
          ...withSourceIds!.filter((e) => !listed.has(e.nodeId)),
        ]
        if (ordered.length === collageImageUrls.length) {
          withSourceIds = ordered
          collageImageUrls = ordered.map((e) => e.url)
        }
      }
      // Per-image size hints (0 auto / 1 big / 2 medium / 3 small). Editor
      // workflows key them by SOURCE NODE ID (data.imageSizeBySource) — align
      // to the accumulated wire order via imageUrlsWithSourceIds (pushed in
      // lockstep with imageUrls). API-authored workflows may instead carry a
      // raw index-aligned data.imageSizes array next to data.imageUrls.
      const clampSize = (v: unknown): number =>
        typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : 0
      const sizeBySource = data.imageSizeBySource as Record<string, number> | undefined
      let collageImageSizes: number[] | undefined
      if (sizeBySource && withSourceIds && withSourceIds.length === collageImageUrls.length) {
        collageImageSizes = withSourceIds.map((e) => clampSize(sizeBySource[e.nodeId]))
      } else if (Array.isArray(data.imageSizes)) {
        collageImageSizes = (data.imageSizes as unknown[])
          .slice(0, collageImageUrls.length)
          .map(clampSize)
      }
      // All-auto is a no-op — omit so the layout takes its unhinted path.
      if (collageImageSizes && collageImageSizes.every((s) => s === 0)) {
        collageImageSizes = undefined
      }
      // Storyboard mode: 1-based sequence numbers stamped in the FINAL wire
      // order. Only forwarded when explicitly on (a stamped `false` would
      // surface as a real "Numbered: off" setting downstream).
      const numbered = data.numbered === true
      // Per-image captions — the EXACT mirror of the size-hint dual path above,
      // aligned to the SAME post-`imageOrder` `withSourceIds` so a label follows
      // its source through the reorder and a List source's label duplicates onto
      // every image it contributes. Editor workflows key by SOURCE NODE ID
      // (data.imageLabelBySource); API-authored workflows carry a raw
      // index-aligned data.imageLabels. Both go through the SAME sanitizer the
      // HTTP route uses (trim, control/bidi strip, 80-code-point cap, "" → null;
      // all-empty → undefined so the key is omitted) — this path bypasses route
      // Zod, and the result lands in jobs.input_data (JSONB rejects a NUL).
      const labelBySource = data.imageLabelBySource as Record<string, string> | undefined
      let collageImageLabels: (string | null)[] | undefined
      if (labelBySource && withSourceIds && withSourceIds.length === collageImageUrls.length) {
        collageImageLabels = normalizeCollageLabels(withSourceIds.map((e) => labelBySource[e.nodeId]))
      } else if (Array.isArray(data.imageLabels)) {
        collageImageLabels = normalizeCollageLabels(data.imageLabels as unknown[], collageImageUrls.length)
      }
      return ffmpegResult(
        "image-collage",
        {
          jobId,
          imageUrls: collageImageUrls,
          ...(collageImageSizes ? { imageSizes: collageImageSizes } : {}),
          ...(numbered ? { numbered: true } : {}),
          ...(collageImageLabels ? { imageLabels: collageImageLabels } : {}),
          // Badge corner: forwarded only when it is a known value (this path
          // bypasses route Zod); the renderer defaults anything else to top-left.
          ...(data.badgePosition === "top-left" || data.badgePosition === "top-right"
            ? { badgePosition: data.badgePosition }
            : {}),
          layout: (data.layout as string | undefined) ?? "smart",
          resolution,
          aspectRatio: (data.aspectRatio as string | undefined) ?? "1:1",
          gap: (data.gap as number | undefined) ?? 24,
          backgroundColor: (data.backgroundColor as string | undefined) ?? "#ffffff",
          usageLogId,
        },
        // Composite id so workflow-run reservations price 4K correctly (the
        // single-node route uses the creditGuard computeCredits hook instead).
        `image-collage:${resolution}`,
      )
    }

    case "merge-video-audio": {
      // Build audioTracks from resolved audioSources (matches frontend mergeVideoAudioApi shape)
      const trackSettings = (data.trackSettings as Record<string, Record<string, unknown>> | undefined) ?? {}
      const voiceoverVol = (data.voiceoverVolume as number | undefined) ?? 100
      const audioTracks = (resolvedInputs.audioSources ?? []).map((s) => {
        const settings = trackSettings[s.sourceNodeId]
        return {
          url: s.url,
          startTime: (settings?.startTime as number | undefined) ?? 0,
          volume: (settings?.volume as number | undefined) ?? voiceoverVol,
          sourceType: s.sourceType ?? (settings?.sourceType as "audio" | "video" | undefined),
        }
      })
      // If only a single audioUrl was resolved (no audioSources), add it as a track
      if (audioTracks.length === 0 && resolvedInputs.audioUrl) {
        audioTracks.push({
          url: resolvedInputs.audioUrl,
          startTime: 0,
          volume: voiceoverVol,
          sourceType: "audio" as const,
        })
      }
      return ffmpegResult("merge-video-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        audioTracks,
        voiceoverVolume: voiceoverVol,
        backgroundVolume: (data.originalAudioVolume as number | undefined) ?? (data.backgroundVolume as number | undefined) ?? 30,
        keepOriginalAudio: data.keepOriginalAudio ?? true,
        usageLogId,
      })
    }

    case "trim-audio":
      return ffmpegResult("trim-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || resolvedInputs.audioUrl || data.videoUrl,
        audioFormat: data.audioFormat,
        startTime: data.startTime,
        endTime: data.endTime,
        usageLogId,
      })

    case "split-media":
      return ffmpegResult("split-media", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        chunkDuration: data.chunkDuration,
        audioFormat: data.audioFormat,
        usageLogId,
      })

    case "extract-audio":
      return ffmpegResult("extract-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        usageLogId,
      })

    case "remove-audio":
      return ffmpegResult("remove-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        usageLogId,
      })

    case "trim-video": {
      const trimMode = (data.trimMode as string | undefined) ?? "time"
      return ffmpegResult("trim-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        startTime: trimMode === "time" ? data.startTime : 0,
        endTime: trimMode === "time" ? data.endTime : undefined,
        // outputSilentVideo: when true, the main trimmed clip is encoded
        // with `-an` (no audio).
        outputSilentVideo: data.outputSilentVideo,
        // Frame-based trim — worker probes source fps and converts.
        trimStartFrames: trimMode === "frames" ? data.trimStartFrames : undefined,
        trimEndFrames: trimMode === "frames" ? data.trimEndFrames : undefined,
        // Seconds + keep-first/keep-last modes — the worker reads these fields;
        // dropping them passed the video through UNTRIMMED in those modes.
        trimStartSeconds: trimMode === "seconds" ? data.trimStartSeconds : undefined,
        trimEndSeconds: trimMode === "seconds" ? data.trimEndSeconds : undefined,
        keepFirstSeconds: trimMode === "keep-first-seconds" ? data.keepFirstSeconds : undefined,
        keepLastSeconds: trimMode === "keep-last-seconds" ? data.keepLastSeconds : undefined,
        // Smart loop cut — worker picks the trailing frame closest to frame 0.
        smartLoopCut: trimMode === "smart-loop-cut",
        smartLoopCutLookback: trimMode === "smart-loop-cut" ? data.smartLoopCutLookback : undefined,
        losslessKeyframe: trimMode !== "smart-loop-cut" && data.losslessKeyframe === true ? true : undefined,
        // Pass through trimMode + upstream duration for accurate credit estimation
        // (frame and smart-loop-cut modes need source length to derive output duration).
        trimMode,
        upstreamDuration: resolvedInputs.videoDuration,
        usageLogId,
      })
    }

    case "extract-frame":
      return ffmpegResult("extract-frame", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        mode: data.mode || "first",
        timestamp: data.timestamp,
        // Index modes — worker reads frameIndex (frame-index) / framesFromEnd
        // (frame-from-end); dropping them returned the first/last frame
        // regardless of the chosen index in workflow runs.
        frameIndex: data.mode === "frame-index" ? data.frameIndex : undefined,
        framesFromEnd: data.mode === "frame-from-end" ? data.framesFromEnd : undefined,
        usageLogId,
      })

    case "resize-video":
      return ffmpegResult("resize-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        targetAspect: data.targetAspect ?? data.aspectRatio,
        // Default "pad" matches the route's Zod schema; sending "fit" (an
        // unsupported enum value) would make the worker silently no-op.
        method: data.method ?? "pad",
        padColor: data.padColor,
        usageLogId,
      })

    case "social-media-format": {
      const mediaUrl = resolvedInputs.videoUrl || resolvedInputs.imageUrl || data.mediaUrl
      const mediaType = resolvedInputs.videoUrl ? "video" : "image"
      const specKey = (data.specKey as string) || "instagram:feed-square"
      const spec = PLATFORM_SPECS[specKey]
      return ffmpegResult("social-media-format", {
        jobId,
        mediaUrl,
        mediaType,
        specKey,
        width: spec?.width ?? 1080,
        height: spec?.height ?? 1080,
        method: data.method || "pad",
        padColor: data.padColor || "#000000",
        usageLogId,
      })
    }

    case "speed-ramp":
      return ffmpegResult(
        "speed-ramp",
        {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          speed: data.speed,
          adjustAudio: data.adjustAudio,
          reverse: data.reverse,
          audioMode: data.audioMode,
          quality: data.quality,
          ramps: data.ramps,
          usageLogId,
        },
        // Motion-compensated interpolation (minterpolate) costs more; mirror the
        // route's buildSpeedRampCreditId so DAG runs reserve the same tier.
        data.quality === "smooth" ? "speed-ramp:smooth" : "speed-ramp",
      )

    case "loop-video":
      return ffmpegResult("loop-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        mode: data.mode ?? "repeat",
        repeatCount: data.repeatCount ?? data.loops,
        targetDuration: data.targetDuration,
        smartLoopCutBeforeRepeat: data.smartLoopCutBeforeRepeat,
        smartLoopCutLookback: data.smartLoopCutLookback,
        // Pass through upstream duration for accurate credit estimation
        // (repeat mode multiplies upstream duration by repeatCount to derive cost).
        upstreamDuration: resolvedInputs.videoDuration,
        usageLogId,
      })

    case "fade-video":
      return ffmpegResult("fade-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        fadeIn: data.fadeIn ?? true,
        fadeInDuration: data.fadeInDuration ?? 0.5,
        fadeOut: data.fadeOut ?? true,
        fadeOutDuration: data.fadeOutDuration ?? 0.5,
        color: data.color ?? "black",
        usageLogId,
      })

    case "slideshow": {
      // Zero-credit local ffmpeg render. Images arrive ACCUMULATED (the
      // image-collage lane: multi-edge + list "all" expansion, wire order
      // preserved); the transition TYPE comes from a wired transition
      // parameter node (resolved to the xfade vocabulary — unwired = cut).
      const slideshowImages = (resolvedInputs.imageUrls as string[] | undefined) ?? []
      return ffmpegResult("slideshow", {
        jobId,
        imageUrls: slideshowImages,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        imageDurations: data.imageDurations,
        perImageDuration: data.perImageDuration ?? 3,
        transition: resolveSlideshowTransition(
          (resolvedInputs.transition as string | undefined) ?? (data.transition as string | undefined),
        ),
        transitionDuration: data.transitionDuration ?? 0.5,
        motion: data.motion ?? "none",
        intensity: data.intensity ?? 3,
        resolution: data.resolution ?? "1080p",
        aspectRatio: data.aspectRatio ?? "16:9",
        fps: data.fps ?? 30,
        fit: data.fit ?? "cover",
        padColor: data.padColor ?? "#000000",
        usageLogId,
      })
    }

    case "still-to-video":
      // Zero-credit local ffmpeg render — duration comes from the audio
      // (resolved by the worker via ffprobe; there is no duration field).
      return ffmpegResult("still-to-video", {
        jobId,
        imageUrl: resolvedInputs.imageUrl || data.imageUrl,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        motion: data.motion ?? "none",
        intensity: data.intensity ?? 3,
        resolution: data.resolution ?? "1080p",
        aspectRatio: data.aspectRatio ?? "16:9",
        fps: data.fps ?? 30,
        fit: data.fit ?? "cover",
        padColor: data.padColor ?? "#000000",
        usageLogId,
      })

    case "gif-to-video":
      // Zero-credit local ffmpeg conversion — the GIF arrives as an image
      // input (an uploaded .gif) or from the node's own upload (data.gifUrl).
      return ffmpegResult("gif-to-video", {
        jobId,
        gifUrl: resolvedInputs.imageUrl || data.gifUrl,
        loopToMinimum: data.loopToMinimum ?? true,
        targetDuration: data.targetDuration ?? 3,
        interpolate: data.interpolate ?? true,
        alphaBackground: data.alphaBackground ?? "white",
        usageLogId,
      })

    case "transcode-video":
      return ffmpegResult("transcode-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        codec: data.codec,
        crf: data.crf,
        resolution: data.resolution,
        audioBitrate: data.audioBitrate,
        usageLogId,
      })

    case "add-captions": {
      const captionsValue = data.captions
      const isCaptionArray = Array.isArray(captionsValue) && captionsValue.length > 0 && typeof (captionsValue[0] as { startMs?: number })?.startMs === "number"
      return ffmpegResult("add-captions", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        text: !isCaptionArray ? (resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap)) : undefined,
        captions: isCaptionArray ? captionsValue : (resolvedInputs.captions ?? undefined),
        // Node data stores camelCase (AddCaptionsData.autoTranscribe / .transcribeProvider);
        // the worker payload uses snake_case. Reading data.auto_transcribe (snake) was
        // always undefined → an explicit autoTranscribe:false and any transcribeProvider
        // choice were silently dropped in workflow runs. Snake fallback kept for safety.
        auto_transcribe: (data.autoTranscribe ?? data.auto_transcribe) as boolean | undefined,
        transcribe_provider: (data.transcribeProvider ?? data.transcribe_provider) as string | undefined,
        style: data.captionStyle ?? data.style,
        position: data.captionPosition ?? data.position,
        fontSize: data.fontSize,
        color: data.color,
        backgroundColor: data.backgroundColor,
        usageLogId,
      })
    }

    case "mix-audio": {
      // Build ordered [{nodeId, url}] so we can key trackVolumes by nodeId and
      // emit them in the same order as audioUrls (the worker expects a plain
      // number[] aligned with audioUrls indexing).
      const sourceEntries = resolvedInputs.audioUrlsWithSourceIds ?? []
      let orderedEntries: Array<{ nodeId: string; url: string }> = sourceEntries
      const trackOrder = data.trackOrder as string[] | undefined
      if (trackOrder?.length && sourceEntries.length) {
        const ordered: Array<{ nodeId: string; url: string }> = []
        for (const nodeId of trackOrder) {
          const entry = sourceEntries.find((e) => e.nodeId === nodeId)
          if (entry) ordered.push(entry)
        }
        if (ordered.length >= 2) orderedEntries = ordered
      }

      // If the frontend only gave us raw audioUrls (no source IDs), fall back.
      const fallbackUrls = resolvedInputs.audioUrls || (data.audioUrls as string[] | undefined) || []
      const mixAudioUrls: string[] = orderedEntries.length > 0
        ? orderedEntries.map((e) => e.url)
        : fallbackUrls

      // trackVolumes on the node data is stored as Record<nodeId, number>, but
      // the worker (backend/src/workers/handlers/ffmpeg.ts) expects number[]
      // aligned with audioUrls. Convert here so orchestrated runs honour
      // user-configured per-track volumes. Legacy `volumes` array is kept as
      // a fallback for direct API callers.
      const rawVolumes = data.trackVolumes as Record<string, number> | undefined
      let trackVolumes: number[] | undefined
      if (orderedEntries.length > 0 && rawVolumes && typeof rawVolumes === "object") {
        trackVolumes = orderedEntries.map((e) => rawVolumes[e.nodeId] ?? 100)
      } else if (Array.isArray(data.volumes)) {
        trackVolumes = data.volumes as number[]
      }

      return ffmpegResult("mix-audio", {
        jobId,
        audioUrls: mixAudioUrls,
        trackVolumes,
        usageLogId,
      })
    }

    case "combine-audio": {
      const segmentOrder = data.segmentOrder as string[] | undefined
      // Source entries keyed by nodeId so per-segment settings + ordering work.
      let sourceEntries: Array<{ nodeId: string; url: string }> =
        resolvedInputs.audioUrlsWithSourceIds
        ?? (resolvedInputs.audioUrls ?? (Array.isArray(data.audioUrls) ? data.audioUrls as string[] : []))
            .map((url) => ({ nodeId: "", url }))
      // Honour the user-arranged segmentOrder (mirrors the frontend executor's
      // applyMediaOrder: ordered entries first, then any unlisted appended). The
      // previous code reordered a THROWAWAY url array and then built segments
      // from the unordered source list — so a workflow run concatenated segments
      // in edge-arrival order instead of the user's chosen order.
      if (segmentOrder?.length && resolvedInputs.audioUrlsWithSourceIds?.length) {
        const entries = resolvedInputs.audioUrlsWithSourceIds
        const ordered: Array<{ nodeId: string; url: string }> = []
        const seen = new Set<string>()
        for (const nodeId of segmentOrder) {
          const entry = entries.find((e) => e.nodeId === nodeId)
          if (entry && !seen.has(nodeId)) { ordered.push(entry); seen.add(nodeId) }
        }
        for (const entry of entries) {
          if (!seen.has(entry.nodeId)) ordered.push(entry)
        }
        if (ordered.length >= 1) sourceEntries = ordered
      }
      const segmentSettings = (data.segmentSettings ?? {}) as Record<string, { startTime?: number; endTime?: number }>
      const segments = sourceEntries.map((entry) => {
        const settings = segmentSettings[entry.nodeId] ?? {}
        return {
          url: entry.url,
          ...(settings.startTime != null ? { startTime: settings.startTime } : {}),
          ...(settings.endTime != null ? { endTime: settings.endTime } : {}),
        }
      })
      return ffmpegResult("combine-audio", {
        jobId,
        segments,
        usageLogId,
      })
    }

    case "adjust-volume": {
      const avInputUrl = resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl || data.videoUrl
      const avVideoUrl = resolvedInputs.videoUrl || data.videoUrl
      return ffmpegResult("adjust-volume", {
        jobId,
        audioUrl: avInputUrl,
        videoUrl: avVideoUrl,
        volume: data.volume,
        normalize: data.normalize,
        fadeIn: data.fadeIn,
        fadeOut: data.fadeOut,
        usageLogId,
      })
    }

    case "audio-fx":
      return ffmpegResult("audio-fx", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        preset: data.preset,
        mix: data.mix,
        delayMs: data.delayMs,
        decay: data.decay,
        eqLow: data.eqLow,
        eqHigh: data.eqHigh,
        usageLogId,
      })

    // --- Entity generation (character, face, object, location) ---
    // IMPORTANT: build the same prompt the route would produce. A single-node
    // HTTP call hits /v1/generate-{character,face,object,location} which enriches
    // the prompt from name/gender/style/baseOutfit/category. The orchestrator
    // enqueues directly to the worker, bypassing that enrichment — so we must
    // construct the prompt ourselves using the shared builders.
    case "character": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      const entityPrompt = name
        ? buildCharacterPrompt({
            name,
            description: data.description as string | undefined,
            gender: data.gender as string | undefined,
            style: data.style as string | undefined,
            baseOutfit: data.baseOutfit as string | undefined,
          })
        : resolveRefs(data.description as string | undefined, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      return {
        jobName: "generate-character",
        queueName: "video-generation",
        // Ref-aware identifier: `sourceImageUrl` doubles as one reference image,
        // so Flux 2 character generations price the correct :Nref tier. Mirrors
        // generate-character.ts; the entity worker commits NON-metered, so the
        // reserved id IS the final charge (bare `provider` mischarged Flux 2).
        modelIdentifier: resolveEntityImageCreditIdentifier(data),
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          // W1-a minor-age floor: the DAG lane's age decision, made once from
          // the node's `person` picker value — the same input the route reads
          // off the character row — OR from the assembled text when there is no
          // picker value (a node written straight into workflow JSON by an
          // agent / import / template carries prompt text and nothing else).
          // Here the detector runs on `entityPrompt` itself rather than on a
          // field list: this lane assembles via `buildCharacterPrompt` with no
          // scaffolding function, so nothing feeds back into assembly and the
          // exact text the provider will see is already in hand. That also makes
          // the policy at the entity image chokepoint this lane's only Layer-2
          // point, and this flag is what arms it.
          subjectMinor:
            isMinorAge((data as { person?: { age?: string; customAge?: number; type?: string } }).person ?? null) ||
            containsMinorAgeHint(entityPrompt),
          usageLogId,
        },
      }
    }
    case "face": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      let entityPrompt: string | undefined
      if (name) {
        const templateInputs = buildFaceTemplateInputs({
          name,
          description: data.description as string | undefined,
          style: data.style as string | undefined,
        })
        const template = resolveTemplate(
          "face-generation",
          buildCtx?.settings?.userPromptTemplates,
          buildCtx?.settings?.flowPromptTemplates,
        )
        entityPrompt = applyTemplate(template, templateInputs)
      } else {
        entityPrompt = resolveRefs(data.description as string | undefined, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      }
      return {
        jobName: "generate-face",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          // W1-a — the DAG twin of POST /v1/generate-face. Same entity-image
          // handler, same chokepoint, so it must make the same age decision.
          // A face node carries no `person` picker value (FaceNodeData has no
          // such field), so the text signal is the whole signal. Unlike
          // `case "character"`, the raw fields are read alongside the assembled
          // prompt: the "face-generation" template is user- and flow-overridable
          // and an override that drops `{description}` would otherwise hide the
          // age from the detector. Joined with a sentence break so no needle can
          // be formed across a field boundary.
          subjectMinor: containsMinorAgeHint(
            [entityPrompt, name, data.description, data.prompt]
              .filter((t): t is string => typeof t === "string" && t.length > 0)
              .join(". "),
          ),
          usageLogId,
        },
      }
    }
    case "object": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      const entityPrompt = name
        ? buildObjectPrompt({
            name,
            description: data.description as string | undefined,
            category: data.category as string | undefined,
            style: data.style as string | undefined,
          })
        : resolveRefs(data.description as string | undefined, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      return {
        jobName: "generate-object",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }
    case "creature": {
      // Mirrors `case "object"` — the creature delta is the free-text `species`
      // (a dragon/wolf IS the subject), which buildCreaturePrompt leads with.
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      const entityPrompt = name
        ? buildCreaturePrompt({
            name,
            description: data.description as string | undefined,
            species: data.species as string | undefined,
            category: data.category as string | undefined,
            style: data.style as string | undefined,
          })
        : resolveRefs(data.description as string | undefined, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      return {
        jobName: "generate-creature",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }
    case "location": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
      const cineSuffix = cinematographyHints.length > 0 ? cinematographyHints.join(", ") : ""
      const baseDescription = (data.description as string | undefined) ?? ""
      const augmentedDescription = cineSuffix
        ? (baseDescription ? `${baseDescription}. ${cineSuffix}` : cineSuffix)
        : (baseDescription || undefined)
      const entityPrompt = name
        ? buildLocationPrompt({
            name,
            description: augmentedDescription,
            category: data.category as string | undefined,
            style: data.style as string | undefined,
          })
        : resolveRefs(augmentedDescription, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      return {
        jobName: "generate-location",
        queueName: "video-generation",
        // Ref-aware identifier (see generate-character above) — `sourceImageUrl`
        // counts as one reference so Flux 2 locations hit the correct :Nref tier.
        modelIdentifier: resolveEntityImageCreditIdentifier(data),
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }

    case "scene": {
      const provider = (data.provider as string) ?? "nano-banana"
      const sceneSettings = buildCtx?.settings
      const charDefs = sceneSettings?.characterDefinitions ?? []
      const userTpl = sceneSettings?.userPromptTemplates
      const flowTpl = sceneSettings?.flowPromptTemplates

      // Build the rich scene prompt (matches frontend execute-node.ts logic).
      // Wrapped in try/catch because node data is cast from Record<string, unknown>
      // and may be missing required SceneData fields on older/malformed nodes.
      let scenePrompt: string
      const sceneRefUrls = [...(resolvedInputs.referenceImageUrls ?? [])]
      try {
        const sceneStylePrompt = buildScenePrompt(data as unknown as SceneData, charDefs as CharacterDef[])
        const upstreamPrompt = resolvedInputs.prompt ?? ""
        scenePrompt = upstreamPrompt
          ? `${upstreamPrompt}. ${sceneStylePrompt}`
          : sceneStylePrompt

        // Append character description templates (matches frontend charDescs logic).
        // buildScenePrompt adds compositional info (name + mood + action);
        // this loop adds full description text via templates for the image generator.
        const allAssetIds = [
          ...((data.characters as Array<{ assetId: string }>) ?? []).map((c) => c.assetId),
          ...((data.locations as Array<{ assetId: string }>) ?? []).map((l) => l.assetId),
          ...((data.objects as Array<{ assetId: string }>) ?? []).map((o) => o.assetId),
        ].filter(Boolean)
        const sceneCharDescs: string[] = []
        for (const assetId of allAssetIds) {
          const asset = charDefs.find((a) => a.id === assetId)
          if (!asset) continue
          if (asset.referenceImageUrl) sceneRefUrls.push(asset.referenceImageUrl)
          if (asset.type === "description" && asset.description) {
            const templateKey =
              asset.category === "face" ? "face-description"
                : asset.category === "location" ? "location-description"
                  : asset.category === "object" ? "object-description"
                    : "character-description"
            const template = resolveTemplate(templateKey, userTpl, flowTpl)
            sceneCharDescs.push(applyTemplate(template, { name: asset.name, description: asset.description }))
          }
        }
        if (sceneCharDescs.length > 0) {
          scenePrompt = `${scenePrompt}\n${sceneCharDescs.join(" ")}`
        }
      } catch {
        // Malformed scene data — fall back to raw prompt fields
        scenePrompt = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap) || ""
      }

      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: scenePrompt,
          provider,
          referenceImageUrls: sceneRefUrls.length > 0 ? sceneRefUrls : undefined,
          aspectRatio: data.aspectRatio,
          usageLogId,
        },
      }
    }

    case "generate-script": {
      // Credit ID is tier-based when an LLM model is selected (e.g.
      // `generate-script:economy`). Must also forward `llmModel` so the worker
      // routes to the user's chosen model instead of the default. Reasoning
      // effort further bumps the tier on clamped xhigh/max (same as the
      // single-node route) and rides along in the payload for the worker.
      const scriptLlmModel = data.llmModel as string | undefined
      const scriptEffort = data.reasoningEffort as string | undefined
      return {
        jobName: "generate-script",
        queueName: "video-generation",
        modelIdentifier: buildLlmCreditIdentifier("generate-script", scriptLlmModel, scriptEffort, data.advancedMode === true),
        payload: {
          jobId,
          prompt: applyPromptAffixes(resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap), readPromptAffixes(data), refMap),
          sceneCount: data.sceneCount,
          tone: data.tone ?? data.style,
          targetDuration: data.targetDuration ?? data.targetLength,
          provider: data.provider,
          llmModel: scriptLlmModel,
          reasoningEffort: scriptEffort,
          advanced: { advancedMode: data.advancedMode as boolean | undefined, temperature: data.temperature as number | undefined, maxTokens: data.maxTokens as number | undefined },
          usageLogId,
        },
      }
    }

    case "motion-graphics": {
      // Only the lottie engine is worker-queued; elements executes via sync HTTP
      // and never reaches buildPayload.
      if ((data.engine as string | undefined) !== "lottie") {
        throw new Error("motion-graphics (elements engine) executes via sync HTTP, not the worker queue")
      }
      const mgLlmModel = data.llmModel as string | undefined
      const mgEffort = data.reasoningEffort as string | undefined
      const fps = (data.fps as number) ?? 30
      const aspectRatio = (data.aspectRatio as string) ?? "16:9"
      const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? { width: 1920, height: 1080 }
      return {
        jobName: "motion-graphics-lottie",
        queueName: "video-generation",
        modelIdentifier: buildLlmCreditIdentifier(motionGraphicsFeature(data.engine as string | undefined), mgLlmModel, mgEffort, data.advancedMode === true),
        payload: {
          jobId,
          prompt: applyPromptAffixes(resolvedInputs.prompt || resolveRefs(data.motionPrompt as string | undefined, refMap), readPromptAffixes(data), refMap),
          fps,
          width: (data.width as number) ?? dims.width,
          height: (data.height as number) ?? dims.height,
          durationInFrames: Math.round(((data.durationSeconds as number) ?? 5) * fps),
          backgroundColor: (data.backgroundColor as string) ?? "#00000000",
          llmModel: mgLlmModel,
          reasoningEffort: mgEffort,
          advanced: { advancedMode: data.advancedMode as boolean | undefined, temperature: data.temperature as number | undefined, maxTokens: data.maxTokens as number | undefined },
          usageLogId,
        },
      }
    }

    // --- Render video (goes to render queue) ---
    case "render-video": {
      // Resolve plan from upstream composer nodes (matches frontend execute-node.ts logic)
      let resolvedPlanType = data.planType as string | undefined
      let resolvedPlan = data.plan as Record<string, unknown> | undefined
      let resolvedSceneGraph = data.sceneGraph as Record<string, unknown> | undefined

      // Search upstream nodes for plan output (matches frontend logic)
      if (!resolvedPlan && !resolvedSceneGraph && buildCtx?.edges && buildCtx?.nodes && buildCtx?.nodeStates) {
        const incomingEdges = buildCtx.edges.filter((e) => e.target === node.id)
        for (const edge of incomingEdges) {
          const srcNode = buildCtx.nodes.find((n) => n.id === edge.source)
          if (!srcNode) continue
          const mapping = COMPOSER_PLAN_MAP[srcNode.type]
          if (!mapping) continue
          // Check execution state output first (current run), then saved node data
          const foundPlan =
            (buildCtx.nodeStates?.[srcNode.id]?.output?.plan as Record<string, unknown> | undefined) ??
            (srcNode.data[mapping.planField] as Record<string, unknown> | undefined)
          if (foundPlan) {
            const planDeclaredType = (foundPlan as Record<string, unknown>).planType as string | undefined
            resolvedPlanType = planDeclaredType ?? mapping.planType
            if (resolvedPlanType === "scene-graph") {
              resolvedSceneGraph = foundPlan
            } else {
              resolvedPlan = foundPlan
            }
            break
          }
        }

        // Auto-composition fallback: if no plan found, collect media assets and
        // build a simple scene graph (matches frontend buildAutoComposition)
        if (!resolvedPlan && !resolvedSceneGraph) {
          const assets = collectMediaAssetsForRender(node, buildCtx.edges, buildCtx.nodes, buildCtx.nodeStates)
          if (assets.length > 0) {
            const renderFps = (data.fps as number) ?? 30
            const renderDuration = (data.durationSeconds as number) ?? 10
            const renderAspect = (data.aspectRatio as string) ?? "16:9"
            const renderBg = (data.backgroundColor as string) ?? "#000000"
            resolvedSceneGraph = buildAutoCompositionForRender(assets, renderFps, renderDuration, renderAspect, renderBg)
          }
        }
      }

      return {
        jobName: "render-video",
        queueName: "video-render",
        modelIdentifier: "render-video",
        payload: {
          jobId,
          planType: resolvedPlanType,
          plan: resolvedPlan,
          sceneGraph: resolvedSceneGraph,
          template: data.template,
          usageLogId,
        },
      }
    }

    default:
      throw new Error(`[payload-builder] Unknown node type: ${type}`)
  }
}

// ---------------------------------------------------------------------------
// Auto-composition helpers for render-video fallback (matches frontend)
// ---------------------------------------------------------------------------

/** Collect image/video/audio assets from upstream nodes (matches frontend collectMediaAssets). */
function collectMediaAssetsForRender(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): Array<{ id: string; type: "image" | "video" | "audio"; url: string }> {
  const assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string }> = []
  const seen = new Set<string>()
  const incomingEdges = edges.filter((e) => e.target === node.id)

  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const srcType = srcNode.type
    // Skip plan nodes — they're handled by the plan resolution path
    if (COMPOSER_PLAN_MAP[srcType]) continue

    let output: string | undefined
    const state = nodeStates[srcNode.id]
    if (state?.output) {
      output = getPrimaryOutput(state.output, srcType, edge.sourceHandle)
    } else if (isSourceNode(srcType)) {
      const srcOutput = extractSourceNodeOutput(srcNode)
      if (srcOutput) output = getPrimaryOutput(srcOutput, srcType, edge.sourceHandle)
    }
    if (!output || output === "plan-ready" || seen.has(srcNode.id)) continue
    seen.add(srcNode.id)

    let assetType: "image" | "video" | "audio" | undefined
    if (IMAGE_SOURCE_TYPES.has(srcType)) assetType = "image"
    else if (VIDEO_SOURCE_TYPES.has(srcType)) assetType = "video"
    else if (AUDIO_SOURCE_TYPES.has(srcType)) assetType = "audio"

    if (assetType) {
      assets.push({ id: srcNode.id, type: assetType, url: output })
    }
  }

  return assets
}

/** Build a simple scene graph from media assets (matches frontend buildAutoComposition). */
function buildAutoCompositionForRender(
  assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string }>,
  fps: number,
  totalDuration: number,
  aspectRatio: string,
  backgroundColor: string,
): Record<string, unknown> {
  const visualAssets = assets.filter((a) => a.type !== "audio")
  const audioAssets = assets.filter((a) => a.type === "audio")

  const perAssetDuration = visualAssets.length > 0 ? totalDuration / visualAssets.length : totalDuration
  const perAssetFrames = Math.round(perAssetDuration * fps)
  const transitionFrames = 15
  const lastIndex = Math.max(visualAssets.length - 1, 0)

  const tracks: unknown[] = []

  if (visualAssets.length > 0) {
    const mediaSegments = visualAssets.map((asset, i) => ({
      id: `seg_${i}`,
      src: asset.url,
      mediaType: asset.type as "image" | "video",
      startFrame: i * perAssetFrames,
      durationInFrames: perAssetFrames,
      layout: { mode: "fullscreen" as const },
      transitionIn: i > 0 ? { type: "fade", durationFrames: transitionFrames } : undefined,
      transitionOut: i < lastIndex ? { type: "fade", durationFrames: transitionFrames } : undefined,
      effects: asset.type === "image" ? [{ type: "ken-burns", startValue: 1.0, endValue: 1.1 }] : [],
    }))
    tracks.push({
      id: "track_media",
      type: "media",
      zIndex: 0,
      segments: mediaSegments,
    })
  }

  for (let i = 0; i < audioAssets.length; i++) {
    tracks.push({
      id: `track_audio_${i}`,
      type: "audio",
      src: audioAssets[i].url,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      startFrame: 0,
    })
  }

  const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["16:9"]

  return {
    fps,
    width: dimensions.width,
    height: dimensions.height,
    durationInFrames: Math.round(totalDuration * fps),
    backgroundColor,
    tracks,
  }
}
