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
import { getLensPromptHint } from "./lens.js"
import { getCameraFormatPromptHint } from "./camera-format.js"
import { getColorLookPromptHint } from "./color-look.js"
import { buildAtmosphereHints } from "./atmosphere.js"
import { buildActionFxHints } from "./action-fx.js"
import { getStylePromptHint } from "./style.js"
import { getSettingPromptHint } from "./setting.js"
import { getLoopSubjectPromptHint } from "./loop-subject.js"
import { buildPersonHints } from "./person.js"
import { buildMoodHints } from "./mood.js"
import { buildPoseHints } from "./pose.js"
import { buildStylingHints } from "./styling.js"
import { buildTemporalHints } from "./temporal.js"
import { composeCameraMotionHintFromConnections } from "./camera-motions.js"
import {
  composeTransitionHintFromConnections,
  type TransitionDuration,
  type TransitionIntensity,
  type TransitionPosition,
  type TransitionTiming,
} from "./transitions.js"
import { buildMaterialHints } from "./materials.js"
import { getAnimal } from "./animals.js"
import { getVehicle } from "./vehicles.js"
import { getWeapon } from "./weapons.js"
import { getPhotoGenrePromptHint } from "./photo-genre.js"
import { getBackdropPromptHint } from "./backdrop.js"
import { buildHeldPropHints } from "./held-prop.js"
import { buildPhotographerHints } from "./photographer.js"
import { buildAestheticHints } from "./aesthetic.js"
import { getEraPromptHint } from "./era.js"
import { buildExposureHints } from "./exposure-settings.js"
import { getRenderQualityPromptHint } from "./render-quality.js"
import { getCompositionEffectPromptHint } from "./composition-effects.js"
import { buildPostProcessHints } from "./post-process-effects.js"
import { buildMusicGenreHints } from "./music-genre.js"
import { buildMusicMoodHints } from "./music-mood.js"
import { buildInstrumentationHints } from "./instrumentation.js"
import { buildVoiceCharacterHints } from "./voice-character.js"
import { buildVoiceDeliveryHints } from "./voice-delivery.js"

export interface HintNodeLike {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}

export interface HintEdgeLike {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface HintGraphContext {
  readonly nodes: ReadonlyArray<HintNodeLike>
  readonly edges: ReadonlyArray<HintEdgeLike>
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : ""
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
    if (!ctx) return composeCameraMotionHintFromConnections(motionId, [], [])
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
    return composeCameraMotionHintFromConnections(motionId, startHints, endHints)
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
      return composeTransitionHintFromConnections(transitionId, [], [], timing)
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
    return composeTransitionHintFromConnections(transitionId, startHints, endHints, timing)
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
