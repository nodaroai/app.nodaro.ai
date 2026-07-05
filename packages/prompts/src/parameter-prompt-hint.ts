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

import { buildFramingHints } from "@nodaro/shared"
import { buildLightingHints } from "@nodaro/shared"
import { getLensPromptHint } from "@nodaro/shared"
import { getCameraFormatPromptHint } from "@nodaro/shared"
import { getColorLookPromptHint } from "@nodaro/shared"
import { buildAtmosphereHints } from "@nodaro/shared"
import { buildActionFxHints } from "@nodaro/shared"
import { getStylePromptHint } from "@nodaro/shared"
import { getSettingPromptHint } from "@nodaro/shared"
import { getLoopSubjectPromptHint } from "@nodaro/shared"
import { buildPersonHints } from "./person.js"
import { buildMoodHints } from "@nodaro/shared"
import { buildPoseHints } from "@nodaro/shared"
import { buildStylingHints } from "@nodaro/shared"
import { buildTemporalHints } from "@nodaro/shared"
import { composeCameraMotionHintFromConnections } from "@nodaro/shared"
import { composeTransitionHintFromConnections, type TransitionDuration, type TransitionIntensity, type TransitionPosition, type TransitionTiming } from "@nodaro/shared"
import { composeCharacterFxHintFromConnections, type CharacterFxDuration, type CharacterFxIntensity, type CharacterFxPosition, type CharacterFxTiming } from "@nodaro/shared"
import { buildMaterialHints } from "@nodaro/shared"
import { getAnimal } from "@nodaro/shared"
import { getVehicle } from "@nodaro/shared"
import { getWeapon } from "@nodaro/shared"
import { getFurniture } from "@nodaro/shared"
import { getPhotoGenrePromptHint } from "@nodaro/shared"
import { getBackdropPromptHint } from "@nodaro/shared"
import { buildHeldPropHints } from "@nodaro/shared"
import { buildPhotographerHints } from "@nodaro/shared"
import { buildAestheticHints } from "@nodaro/shared"
import { getEraPromptHint } from "@nodaro/shared"
import { buildExposureHints } from "@nodaro/shared"
import { getRenderQualityPromptHint } from "@nodaro/shared"
import { getCompositionEffectPromptHint } from "@nodaro/shared"
import { buildPostProcessHints } from "@nodaro/shared"
import { buildMusicGenreHints } from "@nodaro/shared"
import { buildMusicMoodHints } from "@nodaro/shared"
import { buildInstrumentationHints } from "@nodaro/shared"
import { buildVoiceCharacterHints } from "@nodaro/shared"
import { buildVoiceDeliveryHints } from "@nodaro/shared"


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
 * Dispatch by parameter-node type to its prompt-hint string. For camera-motion,
 * pass `ctx` to include the composed start/end clauses; otherwise only the
 * bare motion description is returned.
 */
export function getParameterPromptHint(
  node: HintNodeLike | undefined,
  ctx?: HintGraphContext,
): string {
  if (!node?.type) return ""
  const data = (node.data ?? {}) as Record<string, unknown>

  if (node.type === "camera-motion") {
    const motionId = asStr(data.cameraMotion) || undefined
    if (!ctx) return withCustomText(data, composeCameraMotionHintFromConnections(motionId, [], []))
    const startHints: string[] = []
    const endHints: string[] = []
    for (const edge of ctx.edges) {
      if (edge.target !== node.id) continue
      const src = ctx.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      // Pass no ctx for nested resolution: startState/endState inputs are
      // themselves parameter nodes (framing/tone/etc.) that don't need graph
      // context, and avoiding recursion keeps the walk cycle-safe.
      const hint = getParameterPromptHint(src)
      if (!hint) continue
      if (edge.targetHandle === "startState") startHints.push(hint)
      else if (edge.targetHandle === "endState") endHints.push(hint)
    }
    return withCustomText(data, composeCameraMotionHintFromConnections(motionId, startHints, endHints))
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
      return withCustomText(data, composeTransitionHintFromConnections(transitionId, [], [], timing))
    }
    const startHints: string[] = []
    const endHints: string[] = []
    for (const edge of ctx.edges) {
      if (edge.target !== node.id) continue
      const src = ctx.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const hint = getParameterPromptHint(src) // no ctx — cycle-safe
      if (!hint) continue
      if      (edge.targetHandle === "startState") startHints.push(hint)
      else if (edge.targetHandle === "endState")   endHints.push(hint)
    }
    return withCustomText(data, composeTransitionHintFromConnections(transitionId, startHints, endHints, timing))
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
      return withCustomText(data, composeCharacterFxHintFromConnections(effectId, [], timing))
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
    return withCustomText(data, composeCharacterFxHintFromConnections(effectId, targetNames, timing))
  }

  switch (node.type) {
    case "framing":
      return withCustomText(data, buildFramingHints(data).join(", "))
    case "lighting":
      return withCustomText(data, buildLightingHints(data).join(", "))
    case "lens":
      return withCustomText(data, getLensPromptHint(asStr(data.lens)))
    case "camera-format":
      return withCustomText(data, getCameraFormatPromptHint(asStr(data.cameraFormat)))
    case "color-look":
      return withCustomText(data, getColorLookPromptHint(asStr(data.colorLook)))

    // build*Hints in music-* / voice-* / mood / person / etc. compose
    // preText/postText internally — bypass the wrapper to avoid double-
    // composition.
    case "music-genre":
      return buildMusicGenreHints((data ?? {}) as Parameters<typeof buildMusicGenreHints>[0])
    case "music-mood":
      return buildMusicMoodHints((data ?? {}) as Parameters<typeof buildMusicMoodHints>[0])
    case "instrumentation":
      return buildInstrumentationHints((data ?? {}) as Parameters<typeof buildInstrumentationHints>[0])
    case "voice-character":
      return buildVoiceCharacterHints((data ?? {}) as Parameters<typeof buildVoiceCharacterHints>[0])
    case "voice-delivery":
      return buildVoiceDeliveryHints((data ?? {}) as Parameters<typeof buildVoiceDeliveryHints>[0])
    case "person":
      return buildPersonHints(data).join(", ")
    case "mood":
      return buildMoodHints(data).join(", ")
    case "pose":
      return buildPoseHints(data).join(", ")
    case "styling":
      return buildStylingHints(data).join(", ")

    case "atmosphere":
      return withCustomText(data, buildAtmosphereHints(data.atmosphere).join(", "))
    case "action-fx":
      return withCustomText(data, buildActionFxHints(data.actionFx).join(", "))
    case "style":
      return withCustomText(data, getStylePromptHint(asStr(data.style)))
    case "setting":
      return withCustomText(data, getSettingPromptHint(asStr(data.setting)))
    case "loop-subject":
      return withCustomText(data, getLoopSubjectPromptHint(asStr(data.loopSubject)))
    case "material":
      return withCustomText(data, buildMaterialHints(data.material))
    case "animal": {
      const animal = getAnimal(asStr(data.animal))
      return withCustomText(
        data,
        animal ? `featuring a ${animal.label.toLowerCase()}, ${animal.description}` : "",
      )
    }
    case "vehicle": {
      const vehicle = getVehicle(asStr(data.vehicle))
      return withCustomText(
        data,
        vehicle ? `featuring a ${vehicle.label.toLowerCase()}, ${vehicle.description}` : "",
      )
    }
    case "weapon": {
      const weapon = getWeapon(asStr(data.weapon))
      return withCustomText(
        data,
        weapon ? `with a ${weapon.label.toLowerCase()}, ${weapon.description}` : "",
      )
    }
    case "furniture": {
      const furniture = getFurniture(asStr(data.furniture))
      return withCustomText(
        data,
        furniture ? `including a ${furniture.label.toLowerCase()}, ${furniture.description}` : "",
      )
    }
    case "photo-genre":
      return withCustomText(data, getPhotoGenrePromptHint(asStr(data.photoGenre)))
    case "backdrop":
      return withCustomText(data, getBackdropPromptHint(asStr(data.backdrop)))
    case "held-prop":
      return withCustomText(data, buildHeldPropHints(data.heldProp).join(", "))
    case "photographer":
      return withCustomText(data, buildPhotographerHints(data.photographer))
    case "aesthetic":
      return withCustomText(data, buildAestheticHints(data.aesthetic))
    case "era":
      return withCustomText(data, getEraPromptHint(asStr(data.era)))
    case "temporal":
      return withCustomText(data, buildTemporalHints(data).join(", "))
    case "exposure-settings":
      return withCustomText(data, buildExposureHints(data).join(", "))
    case "render-quality":
      return withCustomText(data, getRenderQualityPromptHint(asStr(data.renderQuality)))
    case "composition-effects":
      return withCustomText(data, getCompositionEffectPromptHint(asStr(data.compositionEffect)))
    case "post-process-effects":
      return withCustomText(data, buildPostProcessHints(data.postProcess).join(", "))

    case "tone":
      return asStr(data.tone).trim()
    case "text-prompt":
      return asStr(data.text).trim()
    default:
      return ""
  }
}
