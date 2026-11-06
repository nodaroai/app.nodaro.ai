/**
 * The Motion setting's face mesh layers (`faceMasking.faceMeshLayers`,
 * lib/cast-swap-face-mesh-layers.ts) are saved only once every environment
 * can take them, as the mesh's parts are (`nodaro-motion-face-mesh.ts`):
 *   - its ENGINE draws them (`castSwap.faceMeshLayers`): one that does not is
 *     answered the setting without the key and would draw the full mesh
 *     (409 `engine_unsupported`);
 *   - its PLATFORM takes them (`PlatformSupports.faceMeshLayers`, fresh): the
 *     row is shared, and an older app's strict schema refuses the key — it
 *     would drop the engine's whole Motion entry (422 `platform_unsupported`).
 * Only a set no `faceMeshParts` value names counts: the save stores any other
 * as that value (`withCanonicalFaceMeshLayers`), which every environment takes.
 */
import type { VideoFaceMeshLayers } from "@nodaro/shared/media"
import type { FaceMasking } from "../../lib/cast-swap-face-masking.js"
import { engineDrawsFaceMeshLayers, faceMeshLayersSent } from "../../lib/cast-swap-face-mesh-layers.js"
import { TREND_PUBLISH_ENVIRONMENTS, platformOf, type EngineEnvironment } from "./engine-environments.js"
import { PLATFORM_UNSUPPORTED } from "./nodaro-motion-face-mesh.js"
import type { PlatformHold } from "./nodaro-motion-face-mesh.js"

/** The layers a direct run's setting draws its face mesh with (`faceMeshLayersSent`, the masking on), or undefined. */
export function faceMeshLayersOfSetting(m: FaceMasking | undefined): VideoFaceMeshLayers | undefined {
  return m && m.mode !== "off" ? faceMeshLayersSent(m) : undefined
}

/** Whether a setting, as saved, carries the key at all (where it draws nothing too): an older platform refuses it either way. */
export function faceMeshLayersCarried(m: Pick<FaceMasking, "faceMeshLayers"> | undefined): boolean {
  return m?.faceMeshLayers !== undefined
}

/** The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose engine does not draw face mesh layers: none recorded, or one that does not declare them. */
export function environmentsThatCannotDrawFaceMeshLayers(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineDrawsFaceMeshLayers(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments whose engine cannot (`environmentsThatCannotDrawFaceMeshLayers`). */
export function cannotDrawFaceMeshLayersMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot draw these face mesh layers yet, and this setting is shared by every environment: choose the full mesh, the eyes and lips, or the lips alone, or wait for the engine.`
}

/** The environments whose platform does not claim (fresh, `platformOf`) that it takes face mesh layers. Empty = every one does, now. */
export function environmentsWhosePlatformCannotTakeFaceMeshLayers(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.faceMeshLayers !== true)
}

/** The hold of a save whose settings carry the key (`faceMeshLayersCarried`) while an environment's platform does not take it, or null. */
export function platformHoldOfFaceMeshLayers(
  maskings: ReadonlyArray<Pick<FaceMasking, "faceMeshLayers"> | undefined>,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): PlatformHold | null {
  if (!maskings.some(faceMeshLayersCarried)) return null
  const lacking = environmentsWhosePlatformCannotTakeFaceMeshLayers(environments, now)
  if (lacking.length === 0) return null
  const list = lacking.join(" and ")
  return {
    code: PLATFORM_UNSUPPORTED,
    message: `The platform in ${list} does not take face mesh layers yet, and this setting is shared by every environment: choose the full mesh, the eyes and lips, or the lips alone, or wait until ${list} ${lacking.length === 1 ? "is" : "are"} updated.`,
    envs: lacking,
  }
}
