import type { HintNodeLike, HintEdgeLike, HintGraphContext } from "@nodaro/shared"
export type { HintNodeLike, HintEdgeLike, HintGraphContext }
/**
 * Single source of truth for parameter-node prompt-hint text.
 *
 * Every parameter node (framing, lens, camera-format, lighting, color-look,
 * atmosphere, style, setting, person, mood, pose, styling, temporal, tone,
 * text-prompt, camera-motion) dispatches through `getParameterPromptHint` to
 * produce the descriptive clause it contributes to a consumer's prompt.
 *
 * The frontend DAG executor and backend workflow orchestrator both call this,
 * so the text injected via the `cinematography` handle is identical to the
 * text injected when the node is wired directly into a Text Prompt / LLM Chat
 * / Combine Text input.
 *
 * Camera-motion is graph-aware: when `ctx` is provided the function walks the
 * node's `startState`/`endState` incoming edges and composes a fully formed
 * sentence via `composeCameraMotionHintFromConnections`. Without `ctx` only
 * the bare motion description is returned.
 */

import { buildFramingHints } from "./framing.js"
import { buildLightingHints } from "./lighting.js"
import { getLensPromptHint, getLensTerm } from "./lens.js"
import { getCameraFormatPromptHint, getCameraFormatTerm } from "./camera-format.js"
import { getColorLookPromptHint, getColorLookTerm } from "./color-look.js"
import { buildAtmosphereHints } from "./atmosphere.js"
import { buildActionFxHints } from "./action-fx.js"
import { getStylePromptHint, getStyleTerm } from "./style.js"
import { getSettingPromptHint, getSettingTerm } from "./setting.js"
import { getLoopSubjectPromptHint, getLoopSubjectTerm } from "./loop-subject.js"
import { buildPersonHints } from "./person.js"
import { buildMoodHints } from "./mood.js"
import { buildPoseHints } from "./pose.js"
import { buildStylingHints } from "./styling.js"
import { buildTemporalHints } from "./temporal.js"
import { composeCameraMotionHintFromConnections } from "./camera-motions.js"
import { composeTransitionHintFromConnections, type TransitionDuration, type TransitionIntensity, type TransitionPosition, type TransitionTiming } from "./transitions.js"
import { composeCharacterFxHintFromConnections, type CharacterFxDuration, type CharacterFxIntensity, type CharacterFxPosition, type CharacterFxTiming } from "./character-fx.js"
import { buildMaterialHints } from "./materials.js"
import { getAnimal } from "@nodaro/shared"
import { getVehicle } from "@nodaro/shared"
import { getWeapon } from "@nodaro/shared"
import { getFurniture } from "@nodaro/shared"
import { getPhotoGenrePromptHint, getPhotoGenreTerm } from "./photo-genre.js"
import { getBackdropPromptHint, getBackdropTerm } from "./backdrop.js"
import { buildHeldPropHints } from "./held-prop.js"
import { buildPhotographerHints } from "./photographer.js"
import { buildAestheticHints } from "./aesthetic.js"
import { getEraPromptHint, getEraTerm } from "./era.js"
import { buildExposureHints } from "./exposure-settings.js"
import { getRenderQualityPromptHint, getRenderQualityTerm } from "./render-quality.js"
import { getCompositionEffectPromptHint, getCompositionEffectTerm } from "./composition-effects.js"
import { buildPostProcessHints } from "./post-process-effects.js"
import { buildMusicGenreHints } from "./music-genre.js"
import { buildMusicMoodHints } from "./music-mood.js"
import { buildInstrumentationHints } from "./instrumentation.js"
import { buildVoiceCharacterHints } from "./voice-character.js"
import { buildVoiceDeliveryHints } from "./voice-delivery.js"
import { getPickerCatalog } from "./picker-catalogs.js"
import type { PickerHintMode } from "./term.js"


function asStr(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/** Extract the display name from a character / face / object / location ref node. */
function extractCharacterRefName(node: HintNodeLike): string | undefined {
  const d = (node.data ?? {}) as Record<string, unknown>
  const candidates = [d.characterName, d.faceName, d.objectName, d.locationName]
  for (const v of candidates) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return undefined
}

/** Compose `[preText, mainHint, postText]` into a comma-joined string,
 *  honoring the user's free-text fragments around the structured hint.
 *  Helpers like `getStylePromptHint` that already include preText/postText
 *  composition (build*Hints in mood/person/etc.) bypass this — they
 *  return the fully-composed string directly. */
function withCustomText(data: Record<string, unknown>, mainHint: string): string {
  const fragments: string[] = []
  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) fragments.push(pre)
  if (mainHint) fragments.push(mainHint)
  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) fragments.push(post)
  return fragments.join(", ")
}

/**
 * The node-level hint mode a picker declares via `data.hintMode`.
 *
 * Only the two documented values count; anything else (a stale value, a typo,
 * a non-string) is treated as UNDECLARED and falls back — to the inherited
 * mode when the node is resolved as an upstream input, and to `"full"`
 * otherwise. Compact is opt-in, so an unrecognized value can never silently
 * shorten a prompt.
 */
function readHintMode(data: Record<string, unknown>): PickerHintMode | undefined {
  const raw = data.hintMode
  return raw === "compact" || raw === "full" ? raw : undefined
}

/** Pick the full-hint or the compact-term getter for the active mode. */
function byMode<T>(mode: PickerHintMode, full: T, compact: T): T {
  return mode === "compact" ? compact : full
}

/**
 * The compact fragment for an OBJECT-entity entry (animal / vehicle / weapon /
 * furniture). Those catalogs carry no `promptHint` of their own — the full
 * fragment is synthesized as "featuring a {label}, {description}" — so the
 * compact form is the authored `term` when there is one and the lowercased
 * label otherwise (a concrete object's label IS its trade term). The framing
 * verb ("featuring a", "with a") belongs to the HINT; a term drops bare into
 * whatever sentence the consumer is building.
 *
 * `term` is read structurally because it is being added to the shared entity
 * interfaces separately; this stays correct before and after that lands.
 */
function objectEntityTerm(entry: { readonly label: string }): string {
  return (entry as { term?: string }).term ?? entry.label.toLowerCase()
}

/**
 * Dispatch by parameter-node type to its prompt-hint string. For camera-motion,
 * pass `ctx` to include the composed start/end clauses; otherwise only the
 * bare motion description is returned.
 *
 * VERBOSITY — a picker node may set `data.hintMode` to `"compact"` to inject
 * its short professional `term` ("whip pan left", "hard cut") instead of the
 * long `promptHint`. Absent, or any unrecognized value, means `"full"`, whose
 * output is byte-identical to what this function returned before hint modes
 * existed. ONLY the base catalog fragment swaps: `preText`/`postText`, the
 * transition / camera-motion / character-fx timing and start-state/end-state
 * clauses, multi-pick joining and multi-dimension composition are emitted the
 * same way in both modes.
 */
export function getParameterPromptHint(
  node: HintNodeLike | undefined,
  ctx?: HintGraphContext,
): string {
  return resolveParameterHint(node, ctx)
}

/**
 * The dispatch body. `inherited` carries the mode DOWN into the nodes wired to
 * a composer's `startState` / `endState` handles, so a compact transition
 * composes compact start/end clauses rather than mixing a term with two
 * paragraphs. A node that declares its own `hintMode` still wins over what it
 * inherits.
 */
function resolveParameterHint(
  node: HintNodeLike | undefined,
  ctx?: HintGraphContext,
  inherited?: PickerHintMode,
): string {
  if (!node?.type) return ""
  const data = (node.data ?? {}) as Record<string, unknown>
  const mode: PickerHintMode = readHintMode(data) ?? inherited ?? "full"

  if (node.type === "camera-motion") {
    const motionId = asStr(data.cameraMotion) || undefined
    if (!ctx) return withCustomText(data, composeCameraMotionHintFromConnections(motionId, [], [], mode))
    const startHints: string[] = []
    const endHints: string[] = []
    for (const edge of ctx.edges) {
      if (edge.target !== node.id) continue
      const src = ctx.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      // Pass no ctx for nested resolution: startState/endState inputs are
      // themselves parameter nodes (framing/tone/etc.) that don't need graph
      // context, and avoiding recursion keeps the walk cycle-safe. The mode
      // rides down so the composed clause stays at one level of detail.
      const hint = resolveParameterHint(src, undefined, mode)
      if (!hint) continue
      if (edge.targetHandle === "startState") startHints.push(hint)
      else if (edge.targetHandle === "endState") endHints.push(hint)
    }
    return withCustomText(data, composeCameraMotionHintFromConnections(motionId, startHints, endHints, mode))
  }

  if (node.type === "transition") {
    const raw = data.transition
    const transitionId: string | string[] | undefined =
      Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === "string" && s.length > 0)
        : (asStr(raw) || undefined)
    const timing: TransitionTiming = {
      position:  asStr(data.position)  as TransitionPosition  | undefined,
      duration:  asStr(data.duration)  as TransitionDuration  | undefined,
      intensity: asStr(data.intensity) as TransitionIntensity | undefined,
    }
    if (!ctx) {
      return withCustomText(data, composeTransitionHintFromConnections(transitionId, [], [], timing, mode))
    }
    const startHints: string[] = []
    const endHints: string[] = []
    for (const edge of ctx.edges) {
      if (edge.target !== node.id) continue
      const src = ctx.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const hint = resolveParameterHint(src, undefined, mode) // no ctx — cycle-safe
      if (!hint) continue
      if      (edge.targetHandle === "startState") startHints.push(hint)
      else if (edge.targetHandle === "endState")   endHints.push(hint)
    }
    return withCustomText(data, composeTransitionHintFromConnections(transitionId, startHints, endHints, timing, mode))
  }

  if (node.type === "character-fx") {
    const raw = data.characterFx
    const effectId: string | string[] | undefined =
      Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === "string" && s.length > 0)
        : (asStr(raw) || undefined)
    const timing: CharacterFxTiming = {
      position:  asStr(data.position)  as CharacterFxPosition  | undefined,
      duration:  asStr(data.duration)  as CharacterFxDuration  | undefined,
      intensity: asStr(data.intensity) as CharacterFxIntensity | undefined,
    }
    if (!ctx) {
      return withCustomText(data, composeCharacterFxHintFromConnections(effectId, [], timing, mode))
    }
    const targetNames: string[] = []
    for (const edge of ctx.edges) {
      if (edge.target !== node.id) continue
      if (edge.targetHandle !== "target") continue
      const src = ctx.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const name = extractCharacterRefName(src)
      if (name) targetNames.push(name)
    }
    return withCustomText(data, composeCharacterFxHintFromConnections(effectId, targetNames, timing, mode))
  }

  const base = resolveBaseHint(node.type, data, mode)
  if (base) return base
  // Pack-extend fallback: a single-dim pack entry the per-catalog getter (which
  // reads the frozen base array) can't resolve. Resolve it against the
  // registered (pack-composed) catalog's options. `PickerOption.term` is
  // pre-resolved, so compact mode reads it directly.
  const cat = getPickerCatalog(node.type)
  if (cat?.kind === "single" && cat.valueField) {
    const id = typeof data[cat.valueField] === "string" ? (data[cat.valueField] as string) : ""
    const opt = cat.options?.find((o) => o.id === id)
    if (opt) return byMode(mode, opt.promptHint, opt.term)
  }
  return base
}

/**
 * Base (upstream) hint dispatch by node type — the per-catalog getters read the
 * frozen base arrays. Pack-added single-dim ids are resolved by the caller
 * against the registered (pack-composed) catalog.
 *
 * `mode` selects the base fragment only: the compact `get<Name>Term` getter /
 * `build<Name>Terms` builder instead of the verbose one. The `withCustomText`
 * wrapper, the builders' own pre/post composition, and the free-text node
 * types (tone / style-guide / text-prompt — user prose, not catalog copy) are
 * identical in both modes.
 */
function resolveBaseHint(
  type: string,
  data: Record<string, unknown>,
  mode: PickerHintMode = "full",
): string {
  switch (type) {
    case "framing":
      return withCustomText(data, buildFramingHints(data, false, mode).join(", "))
    case "lighting":
      return withCustomText(data, buildLightingHints(data, mode).join(", "))
    case "lens":
      return withCustomText(data, byMode(mode, getLensPromptHint, getLensTerm)(asStr(data.lens)))
    case "camera-format":
      return withCustomText(data, byMode(mode, getCameraFormatPromptHint, getCameraFormatTerm)(asStr(data.cameraFormat)))
    case "color-look":
      return withCustomText(data, byMode(mode, getColorLookPromptHint, getColorLookTerm)(asStr(data.colorLook)))

    // build*Hints in music-* / voice-* / mood / person / etc. compose
    // preText/postText internally — bypass the wrapper to avoid double-
    // composition.
    case "music-genre":
      return buildMusicGenreHints((data ?? {}) as Parameters<typeof buildMusicGenreHints>[0], mode)
    case "music-mood":
      return buildMusicMoodHints((data ?? {}) as Parameters<typeof buildMusicMoodHints>[0], mode)
    case "instrumentation":
      return buildInstrumentationHints((data ?? {}) as Parameters<typeof buildInstrumentationHints>[0], mode)
    case "voice-character":
      return buildVoiceCharacterHints((data ?? {}) as Parameters<typeof buildVoiceCharacterHints>[0], mode)
    case "voice-delivery":
      return buildVoiceDeliveryHints((data ?? {}) as Parameters<typeof buildVoiceDeliveryHints>[0], mode)
    case "person":
      return buildPersonHints(data, mode).join(", ")
    case "mood":
      return buildMoodHints(data, mode).join(", ")
    case "pose":
      return buildPoseHints(data, mode).join(", ")
    case "styling":
      return buildStylingHints(data, mode).join(", ")

    case "atmosphere":
      return withCustomText(data, buildAtmosphereHints(data.atmosphere, mode).join(", "))
    case "action-fx":
      return withCustomText(data, buildActionFxHints(data.actionFx, mode).join(", "))
    case "style":
      return withCustomText(data, byMode(mode, getStylePromptHint, getStyleTerm)(asStr(data.style)))
    case "setting":
      return withCustomText(data, byMode(mode, getSettingPromptHint, getSettingTerm)(asStr(data.setting)))
    case "loop-subject":
      return withCustomText(data, byMode(mode, getLoopSubjectPromptHint, getLoopSubjectTerm)(asStr(data.loopSubject)))
    case "material":
      return withCustomText(data, buildMaterialHints(data.material, mode))
    case "animal": {
      const animal = getAnimal(asStr(data.animal))
      return withCustomText(
        data,
        animal
          ? byMode(mode, `featuring a ${animal.label.toLowerCase()}, ${animal.description}`, objectEntityTerm(animal))
          : "",
      )
    }
    case "vehicle": {
      const vehicle = getVehicle(asStr(data.vehicle))
      return withCustomText(
        data,
        vehicle
          ? byMode(mode, `featuring a ${vehicle.label.toLowerCase()}, ${vehicle.description}`, objectEntityTerm(vehicle))
          : "",
      )
    }
    case "weapon": {
      const weapon = getWeapon(asStr(data.weapon))
      return withCustomText(
        data,
        weapon
          ? byMode(mode, `with a ${weapon.label.toLowerCase()}, ${weapon.description}`, objectEntityTerm(weapon))
          : "",
      )
    }
    case "furniture": {
      const furniture = getFurniture(asStr(data.furniture))
      return withCustomText(
        data,
        furniture
          ? byMode(mode, `including a ${furniture.label.toLowerCase()}, ${furniture.description}`, objectEntityTerm(furniture))
          : "",
      )
    }
    case "photo-genre":
      return withCustomText(data, byMode(mode, getPhotoGenrePromptHint, getPhotoGenreTerm)(asStr(data.photoGenre)))
    case "backdrop":
      return withCustomText(data, byMode(mode, getBackdropPromptHint, getBackdropTerm)(asStr(data.backdrop)))
    case "held-prop":
      return withCustomText(data, buildHeldPropHints(data.heldProp, mode).join(", "))
    case "photographer":
      return withCustomText(data, buildPhotographerHints(data.photographer, mode))
    case "aesthetic":
      return withCustomText(data, buildAestheticHints(data.aesthetic, mode))
    case "era":
      return withCustomText(data, byMode(mode, getEraPromptHint, getEraTerm)(asStr(data.era)))
    case "temporal":
      return withCustomText(data, buildTemporalHints(data, mode).join(", "))
    case "exposure-settings":
      return withCustomText(data, buildExposureHints(data, mode).join(", "))
    case "render-quality":
      return withCustomText(data, byMode(mode, getRenderQualityPromptHint, getRenderQualityTerm)(asStr(data.renderQuality)))
    case "composition-effects":
      return withCustomText(data, byMode(mode, getCompositionEffectPromptHint, getCompositionEffectTerm)(asStr(data.compositionEffect)))
    case "post-process-effects":
      return withCustomText(data, buildPostProcessHints(data.postProcess, mode).join(", "))

    // Free text authored by the user, not catalog copy — there is no shorter
    // professional form to swap in, so these are identical in both modes.
    case "tone":
      return asStr(data.tone).trim()
    case "style-guide":
      // The node's whole purpose is injecting its style text into consumer
      // prompts; without this case, {Style Guide} refs stayed as literal
      // brace text and direct wires injected nothing (only fieldMappings
      // worked, via getParameterValue).
      return asStr(data.text).trim()
    case "text-prompt":
      return asStr(data.text).trim()
    default:
      return ""
  }
}
