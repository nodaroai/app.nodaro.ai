/**
 * `buildDirectingRequest` — the ONE assembly of a directing (animate) run's
 * structured inputs, shared by the studio's submit hooks and the platform's
 * `POST …/shots/:shotId/clip` route (spec D6).
 *
 * It is the pure port of two studio seams that used to sit on either side of a
 * React hook boundary:
 *
 *  - `useHandleAnimate` — the DOCUMENT half: which frames the chosen input mode
 *    sends, which reference rails ride, the frame/reference dedupe, the still
 *    seed, the scene-prompt paragraph, the beats fold, the `/`-cue render and
 *    the `{ref:<id>}` binding. Reproduced here from the production instead of
 *    from a composer draft — in Phase 3 the draft BECOMES those plan fields
 *    (D13), at which point the two readings are literally the same one.
 *  - `useStartDirecting.animate` — the WIRE half: the lane, the end-frame
 *    catalog gate, the negative-prompt gate, the audio toggle and the field set
 *    each lane accepts. That half is {@link assembleDirectingRequest} and its
 *    tests are a verbatim port of the hook's own suite (the oracle).
 *
 * THE LANE COMES FROM THE INPUTS ({@link chooseVideoLane}), never hardcoded:
 * `generate-video` is the image-to-video lane (a start frame, or references with
 * an end frame — the SERVER folds the frames into the references),
 * `text-to-video` the prompt-only / references one.
 *
 * NO PROMPT ASSEMBLY happens here and none may (CLAUDE.md): bound `@`-entity
 * chips ride as `connectedReferences`, the cinematic Look rides `direction` as
 * catalog IDS, and the routes compose the clauses server-side. What this module
 * writes into the prose is exactly the two platform grammars studio owns — the
 * id-addressed `{ref:<id>}` token at a chip's own position, and the model's
 * official audio syntax for a `/` cue.
 *
 * Browser-free: no React, no `import.meta.env`, no clock, no randomness.
 */
import type { ConnectedReference, DescribedReference } from "@nodaro/shared"
import type { DirectionFields, SubjectFields } from "@nodaro/prompts"

import { foldBeatsPrompt, withEndTransition } from "../beats"
import { bindReferenceTokens, deriveDirectingReferences } from "../directing-references"
import { VIDEO_HINT_MODE } from "../direction"
import {
  defaultDirectingModeFor,
  videoReferenceLimits,
  videoSupportsMode,
  type DirectingMode,
} from "../model-menu"
import { opError } from "../ops/errors"
import type { Production } from "../ops/production"
import type { RecastPlan } from "../recast"
import { foldScenePrompt } from "../scene-prompt"
import {
  hasDirectingReferences,
  type LookSelectionMap,
  type Shot,
  type ShotBeat,
  type ShotTransition,
} from "../shot"
import type { ShotPendingClip } from "../shot-clip"
import {
  chooseVideoLane,
  directingLaneShotInputs,
  videoProviderFoldsLoneEndFrame,
  type VideoLane,
} from "../video-lane"
import {
  beatsOwnDirection,
  renderDirectionsIntoPrompt,
  type VoiceDirection,
} from "../voice-direction"
import { resolveCatalogGates, type RequestContext } from "./context"
import { nameDescribedRoles } from "./described-prose"

/**
 * The body the two video lanes accept, as a LOCAL structural interface.
 *
 * The studio hook annotates the same object `satisfies TextToVideoParams` (the
 * SDK's type); this package cannot depend on `@nodaro/sdk` — the SDK is a
 * consumer of the platform, not a peer of it — so the shape is restated here
 * and the drift guard is the ported oracle suite plus the route's own zod
 * schemas. The two lanes' typed fields agree, so ONE shape serves both; the
 * frame fields (`imageUrl`, `endFrameUrl`) exist only on `generate-video` and
 * `workflowId` is the run's owning workflow.
 */
export interface DirectingWireParams {
  readonly prompt: string
  readonly provider: string
  readonly duration?: number
  readonly aspectRatio?: string
  readonly resolution?: string
  /** Image-to-video lane only — the start keyframe. */
  readonly imageUrl?: string
  /** Image-to-video lane only, and only for end-frame-capable models. */
  readonly endFrameUrl?: string
  readonly referenceImageUrls?: ReadonlyArray<string>
  readonly referenceVideoUrls?: ReadonlyArray<string>
  readonly referenceAudioUrls?: ReadonlyArray<string>
  readonly connectedReferences?: ReadonlyArray<ConnectedReference>
  readonly describedReferences?: ReadonlyArray<DescribedReference>
  readonly direction?: DirectionFields
  // NO `subject` / `structured`: the video routes do not read them today
  // (`useStartDirecting` sends neither), and adding a field the oracle does not
  // send would be a silent behaviour change. The clip's own `subject` rides the
  // MARKER instead, which is where the studio submit puts it.
  readonly negativePrompt?: string
  /** The CANONICAL native-audio lever; the server maps it per model. */
  readonly sound?: boolean
  readonly workflowId?: string
}

/** What the caller supplies for ONE animate — the port of `AnimateOptions`. */
export interface DirectingRunInputs {
  /** The framed still the clip animates FROM. Optional: a references-mode run
   *  has no start frame, and a t2v-capable model can run prompt-only. */
  readonly imageUrl?: string
  readonly aspectRatio?: string
  readonly resolution?: string
  readonly duration?: number
  /** End-frame target — forwarded only for end-frame-capable models, and only
   *  on the `generate-video` lane. Beside references it PICKS that lane. */
  readonly endFrameUrl?: string
  readonly referenceImageUrls?: ReadonlyArray<string>
  readonly referenceVideoUrls?: ReadonlyArray<string>
  readonly referenceAudioUrls?: ReadonlyArray<string>
  /** Bound `@`-entity chips. Count as a reference for the LANE decision. */
  readonly connectedReferences?: ReadonlyArray<ConnectedReference>
  /** Named roles with words and no face. Their own channel: they attach
   *  nothing, so they do NOT count as a reference for the lane decision. */
  readonly describedReferences?: ReadonlyArray<DescribedReference>
  /** Forwarded only when the model natively accepts one. */
  readonly negativePrompt?: string
  /** Cinematic direction as catalog IDS. Omitted when empty — an empty object
   *  is a structured-mode signal on the sibling image route. */
  readonly direction?: DirectionFields
  /** Native model audio; only sent for toggleable models. */
  readonly sound?: boolean
}

/** The model-level settings a run inherits from the composer's own levers. */
export interface DirectingModelSettings {
  readonly provider: string
  readonly duration?: number
  readonly aspectRatio?: string
  readonly workflowId?: string
}

/** Where the run goes and what it carries. */
export interface DirectingRequest {
  readonly lane: VideoLane
  readonly params: DirectingWireParams
}

/**
 * The resume marker minus the two things only the SUBMIT knows: the `jobId` the
 * route's response carries, and `startedAt` — a clock read, which an operation
 * takes from `ctx.now` instead (the `add_pending_clip` op stamps it). Everything
 * else a reload-resumed render needs is decided here, at build time.
 */
export type DirectingMarkerDraft = Omit<ShotPendingClip, "jobId" | "startedAt">

/** A built directing run: the wire, plus the marker to persist beside it. */
export interface BuiltDirectingRequest extends DirectingRequest {
  readonly marker: DirectingMarkerDraft
}

/**
 * The overrides ONE call owns — the levers the document does not (spec D6:
 * a value the document holds is read from the production; a value the CALL
 * holds rides here).
 */
export interface DirectingOverrides {
  /** The video model. Falls back to the shot's plan; required by one or other. */
  readonly provider?: string
  /** Directing prose. Falls back to the shot's `plan.motion.prompt`. */
  readonly prompt?: string
  readonly aspectRatio?: string
  readonly resolution?: string
  readonly duration?: number
  readonly negativePrompt?: string
  readonly direction?: DirectionFields
  /** Recorded on the MARKER (and so on the finished take); not a wire field on
   *  either video lane — see {@link DirectingWireParams}. */
  readonly subject?: SubjectFields
  readonly sound?: boolean
  /** Overrides the shot's sticky end frame (still model- and mode-gated). */
  readonly endFrameUrl?: string
  readonly workflowId?: string
  /** Character-Voice intent recorded on the marker for the completion chain. */
  readonly revoice?: RecastPlan
  readonly promptFormat?: 2
  readonly look?: LookSelectionMap
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
}

/**
 * The chips a scene's BEATS bind, as one set — deduped by id, first use wins,
 * in beat order (`useComposerSubmit`'s `beatReferences`, verbatim).
 *
 * Derived on every build, never a stored copy: a beat owns its references, so
 * deleting the beat must take them with it.
 */
function beatReferences(
  beats: ReadonlyArray<ShotBeat>,
): ReadonlyArray<ConnectedReference> {
  const seen = new Set<string>()
  const out: ConnectedReference[] = []
  for (const beat of beats) {
    for (const ref of beat.references ?? []) {
      if (seen.has(ref.id)) continue
      seen.add(ref.id)
      out.push(ref)
    }
  }
  return out
}

/**
 * Whether THIS model supports a start+end-frame animate (catalog-derived) — the
 * gate the end frame rides through and the one the UI's End slot shows on.
 */
export function directingEndFrameSupported(
  provider: string,
  ctx?: RequestContext,
): boolean {
  return resolveCatalogGates(ctx)
    .allowlistedModelsWithFeature("video", "end-frame")
    .includes(provider)
}

/**
 * THE DESCRIBED CHANNEL AT THE DOOR — a described reference exists to tell the
 * model who a name is, and one with nothing to say renders `<Name> — .`, which
 * is noise the model has to interpret. So only the roles that have words ride.
 *
 * A local pure helper on purpose: studio's `wireDescribedReferences` did not
 * move with the codec (it reads nothing but its argument), and the contract for
 * this leg is that a builder needing the filter carries its own rather than
 * reaching into the app. The name is not lost by the filter — every role, with
 * words or without, is untokenized into the prose upstream.
 */
function wireDescribedReferences(
  described: ReadonlyArray<DescribedReference> | undefined,
): DescribedReference[] | undefined {
  const out = described?.filter((d) => d.description.trim()) ?? []
  // Omit-when-empty, like every other optional channel: an empty array is a key
  // on the wire, and the route's gates read presence.
  return out.length ? out : undefined
}

/**
 * The WIRE half — the pure port of `useStartDirecting.animate`'s body.
 *
 * Returns `null` where the hook returns null: when {@link chooseVideoLane} says
 * the platform would accept no run at all (which is also the Animate CTA's
 * disabled state, so an enabled button can never reach a refused lane).
 *
 * END FRAME is model-gated: forwarded only when the active model declares the
 * catalog `"end-frame"` feature, so a stale URL from a previously-selected
 * end-frame model can never reach an unsupporting one. The negative prompt
 * rides the same kind of gate, and the native-audio toggle a third.
 */
export function assembleDirectingRequest(
  directingPrompt: string,
  inputs: DirectingRunInputs,
  settings: DirectingModelSettings,
  ctx?: RequestContext,
): DirectingRequest | null {
  const gates = resolveCatalogGates(ctx)
  const { provider, workflowId } = settings
  const trimmed = directingPrompt.trim()
  const { imageUrl } = inputs
  // The reference channels ride whichever lane is chosen below. They no longer
  // displace the end frame: with frames present the server folds both into the
  // references and writes the first/last-frame note itself.
  const refImages = inputs.referenceImageUrls?.length
    ? [...inputs.referenceImageUrls]
    : undefined
  const refVideos = inputs.referenceVideoUrls?.length
    ? [...inputs.referenceVideoUrls]
    : undefined
  const refAudio = inputs.referenceAudioUrls?.length
    ? [...inputs.referenceAudioUrls]
    : undefined
  const connectedReferences = inputs.connectedReferences?.length
    ? [...inputs.connectedReferences]
    : undefined
  const describedReferences = wireDescribedReferences(inputs.describedReferences)
  // Bound chips count as references too, so a chips-only run (no start frame,
  // no flat refs) still animates from them.
  const hasRefs = Boolean(refImages || refVideos || refAudio || connectedReferences)
  // Read BEFORE the lane because it helps choose it: with references but no
  // start frame, an end frame is what keeps the run on the image-to-video lane
  // (the only one with the field) instead of losing it to the frame-less one.
  const effectiveEndFrame =
    directingEndFrameSupported(provider, ctx) && inputs.endFrameUrl
      ? inputs.endFrameUrl
      : undefined
  const lane = chooseVideoLane({
    provider,
    hasStartFrame: !!imageUrl,
    hasRefs,
    hasEndFrame: !!effectiveEndFrame,
    hasPrompt: !!trimmed,
  })
  if (!lane) return null
  const effectiveAspect = inputs.aspectRatio ?? settings.aspectRatio
  const effectiveDuration = inputs.duration ?? settings.duration
  // Negative prompt rides only to models that natively accept it (the catalog
  // gate) — a stale value never reaches an unsupporting model.
  const negativePrompt =
    gates.negativePromptSupported("video", provider) && inputs.negativePrompt?.trim()
      ? inputs.negativePrompt.trim()
      : undefined
  // Whether this model's native audio is TOGGLEABLE (catalog-derived field).
  // `undefined` ⇒ no toggle (always-on, or a silent model) → send nothing; the
  // wire key itself is always the canonical `sound`.
  const audioField = gates.videoAudioField(provider)

  const params: DirectingWireParams = {
    // The frame fields exist ONLY on the image-to-video lane.
    ...(lane === "generate-video"
      ? {
          ...(imageUrl ? { imageUrl } : {}),
          endFrameUrl: effectiveEndFrame,
        }
      : {}),
    prompt: trimmed,
    provider,
    duration: effectiveDuration,
    aspectRatio: effectiveAspect,
    ...(inputs.resolution ? { resolution: inputs.resolution } : {}),
    // Bound chips ride the structured channel; the route binds each to its
    // `@image_N` attachment + identity directive server-side (canvas-parity).
    ...(connectedReferences ? { connectedReferences } : {}),
    ...(describedReferences ? { describedReferences } : {}),
    // Cinematic ids — never an empty object (an empty one is a structured-mode
    // signal on the sibling image route, so omit-when-empty is the contract).
    ...(inputs.direction && Object.keys(inputs.direction).length
      ? { direction: inputs.direction }
      : {}),
    ...(refImages ? { referenceImageUrls: refImages } : {}),
    ...(refVideos ? { referenceVideoUrls: refVideos } : {}),
    ...(refAudio ? { referenceAudioUrls: refAudio } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    // Native model audio rides the CANONICAL `sound` lever — the server's
    // `applyVideoAudioToggle` maps it onto each model's own field, and billing
    // keys off the SAME flag. Sent EXPLICITLY both ways whenever the model is
    // toggleable: with `defaultOn` models an OMITTED flag means audio ON + the
    // `:audio` credit tier, so "voice off" must reach the wire as `sound: false`.
    ...(audioField && inputs.sound !== undefined ? { sound: inputs.sound } : {}),
    ...(workflowId ? { workflowId } : {}),
  }
  return { lane, params }
}

/** The scene's whole directing body: the shots fold (or the plain prose), closed
 *  by the scene's way OUT, led by the scene's generic prompt as its own
 *  paragraph. ONE reading, exactly as the composer assembles it. */
function directingBody(
  shot: Shot,
  prose: string,
  durationSeconds: number,
): string {
  const beats = shot.beats ?? []
  return foldScenePrompt(
    shot.scenePrompt,
    beats.length > 0
      ? foldBeatsPrompt(beats, VIDEO_HINT_MODE, shot.endTransition)
      : withEndTransition(prose, shot.endTransition, durationSeconds),
  )
}

/**
 * The DOCUMENT half — a directing run for one shot of one production.
 *
 * Reads the shot the way the studio's render seam does: the input mode picks
 * which frames and rails ride, the references are split into the structured and
 * flat channels, a picture already riding as a frame is deduped out of the
 * rail, and a references run with nothing attached seeds itself with the shot's
 * own still. Then the `/` cues render into the model's own audio syntax and
 * each bound chip's name is bound to the chip with `{ref:<id>}`.
 *
 * WIRE-ONLY, both of those: the returned {@link BuiltDirectingRequest.marker}
 * keeps the NEUTRAL prose (bare names, `[text]` cues, no scene paragraph), so a
 * restore rebuilds the chips and the fold cannot happen twice.
 *
 * Returns `null` when the platform would accept no run — the CTA's disabled
 * state. Throws `op_target_missing` for a shot id the production does not have,
 * and `op_invalid` when neither the call nor the plan names a model.
 */
export function buildDirectingRequest(
  production: Production,
  shotId: string,
  overrides: DirectingOverrides = {},
  ctx?: RequestContext,
): BuiltDirectingRequest | null {
  const shot = production.shots.find((s) => s.id === shotId)
  if (!shot) {
    throw opError("op_target_missing", `No shot ${shotId} in this production`)
  }
  const motion = shot.plan?.motion
  const provider = overrides.provider ?? motion?.provider
  if (!provider) {
    throw opError(
      "op_invalid",
      `No video model for shot ${shotId}: pass one in the overrides or set the scene's motion plan`,
    )
  }
  // THE MODE, CLAMPED TO THE MODEL. A stored `input` and a caller's `mode` are
  // both a claim about a model that may since have changed — a plan authored on
  // a references-capable model, a provider override on the clip route — and a
  // mode the active model has no lane for is not a mode. The studio clamps the
  // same way and from the same catalog readers (`Studio.tsx`'s
  // `videoSupportsMode(videoProvider, directingMode)` →
  // `defaultDirectingModeFor(videoProvider)`), and its DEFAULT is the model's
  // own rather than a hardcoded "start": on a references-default model the
  // plain "frame → Animate" drives the still AS A REFERENCE, not as a locked
  // start keyframe.
  const requested: DirectingMode =
    ctx?.mode ?? motion?.input ?? defaultDirectingModeFor(provider)
  const mode: DirectingMode = videoSupportsMode(provider, requested)
    ? requested
    : defaultDirectingModeFor(provider)
  const referencesActive = mode === "references"
  const aspectRatio = overrides.aspectRatio ?? motion?.aspectRatio
  const resolution = overrides.resolution ?? motion?.resolution
  const duration = overrides.duration ?? motion?.duration
  const negativePrompt = overrides.negativePrompt ?? motion?.negativePrompt
  const prose = overrides.prompt ?? motion?.prompt ?? ""
  // The scene's paragraph, its shots fold and its way out — the ONE body the
  // composer's previews and its submit both read (`directingBaseText`), and the
  // string a take STORES: the restore paths take the paragraph and the way-out
  // clause back off (`stripScenePrompt` / `stripEndTransition`), so a marker
  // holding only the authored fragment would seed a shorter prompt than the one
  // the clip was made from. Computed HERE, before the lane, because it is also
  // what `hasPrompt` MEANS — a beats-only scene with no authored prose still has
  // plenty to say, and the two lane reads must not disagree about that.
  const body = directingBody(shot, prose, duration ?? 0)

  // The start frame this mode sends, derived by the SAME helper the Animate CTA
  // gates on so the button and the submit cannot disagree.
  const laneShot = directingLaneShotInputs({
    mode,
    provider,
    startFrame: shot.startFrame,
    stillUrl: shot.still?.url,
    hasRailReferences: hasDirectingReferences(shot),
  })
  const effectiveStartUrl = laneShot.startFrameUrl
  // The end frame rides the Start + End frame mode AND references mode — in
  // both the user set it explicitly ("Set as end frame", sticky). Never in
  // "start" (that mode's meaning is a single frame) or Text.
  //
  // AND never on a model with no end-frame feature — the catalog gate belongs
  // HERE, before the lane and the frame dedupe below, exactly where the
  // composer puts it (`useComposerSubmit`'s `endFrameSupported && endFrameUrl`,
  // fed by `videoSupportsEndFrame(videoProvider)`). `shot.endFrame` is STICKY
  // document state and switching models is routine, so an ungated read let a
  // stale frame define the dedupe scope and then get dropped at the wire: a
  // rail image equal to that frame was removed as "already riding as a frame"
  // and the frame rode nowhere — the user's attached reference silently
  // replaced by the still, or a references run degraded to prompt-only.
  const endFrameUrl =
    (mode === "start-end" || referencesActive) &&
    directingEndFrameSupported(provider, ctx)
      ? (overrides.endFrameUrl ?? shot.endFrame)
      : undefined

  // References mode: the per-kind rails are the input (dropped in the frames
  // modes so they never ride alongside the start frame).
  const railImageUrls = referencesActive ? shot.directingReferenceUrls : undefined
  const referenceVideoUrls =
    referencesActive && shot.directingReferenceVideoUrls?.length
      ? shot.directingReferenceVideoUrls
      : undefined
  const referenceAudioUrls =
    referencesActive && shot.directingReferenceAudioUrls?.length
      ? shot.directingReferenceAudioUrls
      : undefined
  // The bound chips ride the STRUCTURED channel; the manual rail images ride
  // the flat one, reserved-and-deduped against the chips so the server's
  // `@image_N` numbering stays aligned with its directives. References mode
  // ONLY: in the frames modes the start still already carries the identity, so
  // chips deliberately contribute nothing to the wire (they still name their
  // own tokens in the prose below).
  // BEATS OWN THEIR CHIPS. The composer switches the prose fold and the chip
  // set on ONE predicate (`references: beatsActive ? beatReferences :
  // directingRefs`, `useComposerSubmit`), because a beat STORES the references
  // its own prose names. This builder already folds the beats into `body`; the
  // chips have to move with them, or the wire sends a beat's name with nobody's
  // face, `{ref:}` binds nothing, and the marker persists the SCENE's chips —
  // so a reload lands the clip wearing someone else's references.
  const beatsActive = (shot.beats ?? []).length > 0
  const chips = beatsActive
    ? beatReferences(shot.beats ?? [])
    : (ctx?.chips ?? motion?.references ?? [])
  const { connectedReferences, referenceImageUrls: railReferenceImageUrls } =
    referencesActive
      ? deriveDirectingReferences({
          references: chips,
          railImageUrls,
          imageLimit: videoReferenceLimits(provider).images,
        })
      : { connectedReferences: undefined, referenceImageUrls: undefined }

  // References mode with NO visual reference attached: the framed still seeds
  // the run as its one reference image — the plain "frame → Animate" flow on a
  // references-default model drives the shot AS A REFERENCE rather than a locked
  // start keyframe. Never beside an EXPLICIT start frame: that frame is the
  // run's `imageUrl`, so seeding it too would send the same picture twice.
  const startUrl = shot.startFrame ?? shot.still?.url
  const stillSeedUrl =
    referencesActive &&
    !effectiveStartUrl &&
    !connectedReferences &&
    !referenceVideoUrls &&
    startUrl
      ? startUrl
      : undefined
  // Read from what the user ATTACHED, before the frame dedupe below — that
  // dedupe is scoped BY this lane, and the still seed keeps a references run
  // that the dedupe empties from reaching the platform with nothing.
  const dedupeLane = chooseVideoLane({
    provider,
    hasStartFrame: !!effectiveStartUrl,
    hasRefs: !!(
      connectedReferences ||
      railReferenceImageUrls?.length ||
      referenceVideoUrls ||
      referenceAudioUrls ||
      stillSeedUrl
    ),
    hasEndFrame: !!endFrameUrl,
    hasPrompt: body.trim().length > 0,
  })
  if (!dedupeLane) return null
  // …minus any picture already riding as a FRAME on the lane this run takes —
  // only `generate-video` has frame fields, so only there can a picture be in
  // two channels at once. Without this the same image would go out twice and the
  // server would fold the frame in beside its own copy.
  const frameUrls = new Set(
    (dedupeLane === "generate-video" ? [effectiveStartUrl, endFrameUrl] : []).filter(
      (u): u is string => !!u,
    ),
  )
  const deduped = railReferenceImageUrls?.filter((u) => !frameUrls.has(u))
  const railImages = deduped?.length ? deduped : undefined
  // The seed can only ever collide with the END frame — an explicit start frame
  // suppresses it upstream — so its dedupe IS the fold question: on a provider
  // that folds a lone last frame the picture no longer has to ride back as a
  // reference to get past the image-required gate.
  const stillReferenceSeed =
    stillSeedUrl &&
    !railImages &&
    !(frameUrls.has(stillSeedUrl) && videoProviderFoldsLoneEndFrame(provider))
      ? [stillSeedUrl]
      : undefined
  const referenceImageUrls = railImages ?? stillReferenceSeed

  // The `/` voice-direction chips: render each neutral `[text]` into the ACTIVE
  // model's official audio syntax. Directions the model can't honor are removed
  // (the shell reports them); the MARKER keeps the neutral text, so a restore
  // rebuilds the chips and survives a model switch.
  // The cue list is the direction TWIN of the body above: both read the same
  // beats, so the prose and its cues cannot disagree about which shots are in
  // the send. The scene's chips MINUS any a shot now owns, then every shot's own
  // in shot order — ownership is the shot's own CHIP, never its prose, so a
  // token a legacy split left behind with nothing to render it keeps the
  // scene's entry.
  const sceneDirections = motion?.directions ?? []
  const directions = beatsActive
    ? [
        ...sceneDirections.filter((d) => !beatsOwnDirection(shot.beats ?? [], d)),
        ...(shot.beats ?? []).flatMap((beat) => beat.directions ?? []),
      ]
    : sceneDirections
  const rendered = renderDirectionsIntoPrompt(body, directions, provider)
  // Bind each chip's NAME in the prose to the chip itself — the platform's
  // id-addressed `{ref:<id>}`, which the route substitutes with the chip's
  // `@image_N` seat AFTER it has numbered the references (studio assembles
  // nothing and computes no seat). The frames modes send no chip, so nothing
  // binds — but the prose still SAYS them (a cast chip serializes as
  // `@<role-slug>`), so they ride along as `chipReferences` purely to name their
  // own tokens.
  //
  // …and then every DESCRIBED role's token becomes its human word (R7): that
  // channel correlates with the prose BY NAME, so a wire saying `@natalie`
  // beside an identity line saying "Natalie" names nobody. Studio does it
  // INSIDE `bindReferenceTokens`, as its `describedReferences` channel; the
  // codec snapshot here predates that parameter, so the pass runs on the
  // binder's OUTPUT — the same composition, since it is the last thing to touch
  // the prose either way (`./described-prose`). The list is the UNFILTERED one:
  // a wordless role is dropped from the CHANNEL and still named in the PROSE.
  const wirePrompt = nameDescribedRoles(
    bindReferenceTokens(rendered.prompt, {
      connectedReferences,
      referenceImageUrls,
      imageLimit: videoReferenceLimits(provider).images,
      chipReferences: chips,
    }),
    ctx?.describedReferences,
  )

  const request = assembleDirectingRequest(
    wirePrompt,
    {
      ...(effectiveStartUrl ? { imageUrl: effectiveStartUrl } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(endFrameUrl ? { endFrameUrl } : {}),
      ...(negativePrompt ? { negativePrompt } : {}),
      ...(overrides.direction ? { direction: overrides.direction } : {}),
      ...(connectedReferences ? { connectedReferences } : {}),
      ...(ctx?.describedReferences
        ? { describedReferences: ctx.describedReferences }
        : {}),
      ...(referenceImageUrls ? { referenceImageUrls } : {}),
      ...(referenceVideoUrls ? { referenceVideoUrls } : {}),
      ...(referenceAudioUrls ? { referenceAudioUrls } : {}),
      ...(overrides.sound !== undefined ? { sound: overrides.sound } : {}),
    },
    { provider, duration, aspectRatio, workflowId: overrides.workflowId },
    ctx,
  )
  if (!request) return null

  return {
    ...request,
    marker: buildDirectingMarker(shot, overrides, request, body.trim(), chips),
  }
}

/**
 * The resume context this render survives a reload on — everything the finished
 * clip has to be stamped with, captured at BUILD time rather than read off the
 * shot at completion: the editor is non-blocking, so the shots, the scene
 * paragraph, the way out and the levers can all be rewritten while the clip
 * renders, and the take would then come back claiming what it was never made
 * from.
 *
 * The prompt is the NEUTRAL body — the folded prose a take STORES, but without
 * the rendered `/` cues and the `{ref:}` bindings, which are wire grammar: a
 * clip-select rebuilds the chips from the neutral `[text]` and the bare names,
 * and a model switch re-renders the cues for the new family.
 *
 * `chips` is the SAME list the wire used, never re-read from the plan: without
 * that, a render finishing after a reload lands a clip with no references and
 * the chips degrade to plain text.
 */
function buildDirectingMarker(
  shot: Shot,
  overrides: DirectingOverrides,
  request: DirectingRequest,
  neutralPrompt: string,
  chips: ReadonlyArray<ConnectedReference>,
): DirectingMarkerDraft {
  const motion = shot.plan?.motion
  const beats: ReadonlyArray<ShotBeat> = shot.beats ?? []
  const endTransition: ShotTransition | undefined = shot.endTransition
  const sceneDirections: ReadonlyArray<VoiceDirection> = motion?.directions ?? []
  return {
    provider: request.params.provider,
    prompt: neutralPrompt,
    ...(request.params.negativePrompt
      ? { negativePrompt: request.params.negativePrompt }
      : {}),
    ...(request.params.duration !== undefined
      ? { duration: request.params.duration }
      : {}),
    ...(overrides.revoice ? { revoiceTo: overrides.revoice } : {}),
    ...(sceneDirections.length > 0 ? { directions: sceneDirections } : {}),
    ...(chips.length > 0 ? { references: chips } : {}),
    ...(beats.length > 0 ? { beats } : {}),
    ...(shot.scenePrompt ? { scenePrompt: shot.scenePrompt } : {}),
    ...(endTransition ? { endTransition } : {}),
    ...(request.params.aspectRatio
      ? { aspectRatio: request.params.aspectRatio }
      : {}),
    ...(request.params.resolution ? { resolution: request.params.resolution } : {}),
    ...(overrides.promptFormat ? { promptFormat: overrides.promptFormat } : {}),
    ...(overrides.look ? { look: overrides.look } : {}),
    ...(overrides.filmLook ? { filmLook: overrides.filmLook } : {}),
    ...(overrides.sceneLook ? { sceneLook: overrides.sceneLook } : {}),
    ...(overrides.subject ? { subject: overrides.subject } : {}),
  }
}
