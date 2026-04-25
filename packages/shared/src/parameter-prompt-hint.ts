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
import { getAtmospherePromptHint } from "./atmosphere.js"
import { getStylePromptHint } from "./style.js"
import { getSettingPromptHint } from "./setting.js"
import { buildPersonHints } from "./person.js"
import { buildMoodHints } from "./mood.js"
import { buildPoseHints } from "./pose.js"
import { buildStylingHints } from "./styling.js"
import { buildTemporalHints } from "./temporal.js"
import { composeCameraMotionHintFromConnections } from "./camera-motions.js"
import { getMaterialPromptHint } from "./materials.js"
import { getAnimal } from "./animals.js"
import { getVehicle } from "./vehicles.js"
import { getWeapon } from "./weapons.js"
import { getPhotoGenrePromptHint } from "./photo-genre.js"
import { getBackdropPromptHint } from "./backdrop.js"
import { getHeldPropPromptHint } from "./held-prop.js"
import { getPhotographerPromptHint } from "./photographer.js"
import { getAestheticPromptHint } from "./aesthetic.js"
import { getEraPromptHint } from "./era.js"
import { buildExposureHints } from "./exposure-settings.js"
import { getRenderQualityPromptHint } from "./render-quality.js"
import { getCompositionEffectPromptHint } from "./composition-effects.js"
import { getPostProcessEffectPromptHint } from "./post-process-effects.js"

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

  switch (node.type) {
    case "framing":
      return buildFramingHints(data).join(", ")
    case "lighting":
      return buildLightingHints(data).join(", ")
    case "lens":
      return getLensPromptHint(asStr(data.lens))
    case "camera-format":
      return getCameraFormatPromptHint(asStr(data.cameraFormat))
    case "color-look":
      return getColorLookPromptHint(asStr(data.colorLook))
    case "atmosphere":
      return getAtmospherePromptHint(asStr(data.atmosphere))
    case "style":
      return getStylePromptHint(asStr(data.style))
    case "setting":
      return getSettingPromptHint(asStr(data.setting))
    case "material":
      return getMaterialPromptHint(asStr(data.material))
    case "animal": {
      const animal = getAnimal(asStr(data.animal))
      return animal ? `featuring a ${animal.label.toLowerCase()}, ${animal.description}` : ""
    }
    case "vehicle": {
      const vehicle = getVehicle(asStr(data.vehicle))
      return vehicle ? `featuring a ${vehicle.label.toLowerCase()}, ${vehicle.description}` : ""
    }
    case "weapon": {
      const weapon = getWeapon(asStr(data.weapon))
      return weapon ? `with a ${weapon.label.toLowerCase()}, ${weapon.description}` : ""
    }
    case "photo-genre":
      return getPhotoGenrePromptHint(asStr(data.photoGenre))
    case "backdrop":
      return getBackdropPromptHint(asStr(data.backdrop))
    case "held-prop":
      return getHeldPropPromptHint(asStr(data.heldProp))
    case "person":
      return buildPersonHints(data).join(", ")
    case "mood":
      return buildMoodHints(data).join(", ")
    case "photographer":
      return getPhotographerPromptHint(asStr(data.photographer))
    case "aesthetic":
      return getAestheticPromptHint(asStr(data.aesthetic))
    case "era":
      return getEraPromptHint(asStr(data.era))
    case "pose":
      return buildPoseHints(data).join(", ")
    case "styling":
      return buildStylingHints(data).join(", ")
    case "temporal":
      return buildTemporalHints(data).join(", ")
    case "exposure-settings":
      return buildExposureHints(data).join(", ")
    case "render-quality":
      return getRenderQualityPromptHint(asStr(data.renderQuality))
    case "composition-effects":
      return getCompositionEffectPromptHint(asStr(data.compositionEffect))
    case "post-process-effects":
      return getPostProcessEffectPromptHint(asStr(data.postProcess))
    case "tone":
      return asStr(data.tone).trim()
    case "text-prompt":
      return asStr(data.text).trim()
    default:
      return ""
  }
}
