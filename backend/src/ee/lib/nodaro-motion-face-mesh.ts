/**
 * A Nodaro Motion setting that draws the face mesh (`faceMesh: true`, faces
 * hidden or full depth) is saved only once every environment's engine can
 * draw it.
 *
 * The Nodaro Motion settings (`nodaro_motion_masking`, and the Motion
 * setting's own `masking`) are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare `castSwap.faceMesh` is answered the settings without the key
 * (`tk.settings`, toolkit.ts: its strict schema would refuse the whole entry),
 * so its direct runs would quietly go without the mesh. So the save is
 * refused while any environment in `TREND_PUBLISH_ENVIRONMENTS` has no
 * recorded engine, or one that does not declare it: the same rule as hiding
 * whole people (`nodaro-motion-hide-body.ts`) and as publishing a trend.
 */
import {
  engineDrawsFaceMesh,
  engineDrawsFaceMeshMinFaceHeight,
  engineDrawsFaceMeshParts,
  faceMeshMinFaceHeightSent,
  faceMeshOn,
  faceMeshPartsSent,
  type FaceMasking,
  type FaceMaskingFaceMeshParts,
} from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, listEngineEnvironments, platformOf, type EngineEnvironment } from "./engine-environments.js"

/** Whether a direct run's setting draws the face mesh: on, and `faceMesh: true` with faces hidden or full depth. */
export function drawsFaceMesh(m: Pick<FaceMasking, "mode" | "source" | "faceMesh"> | undefined): boolean {
  return !!m && m.mode !== "off" && faceMeshOn(m)
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw the face mesh: none recorded, or one that does not
 * declare it. Empty = every one can.
 */
export function environmentsThatCannotDrawFaceMesh(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineDrawsFaceMesh(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotDrawFaceMesh`). */
export function cannotDrawFaceMeshMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot draw the face mesh yet, and this setting is shared by every environment: turn the face mesh off, or wait for the engine.`
}

/**
 * The parts a direct run's setting draws its face mesh with when they are not
 * the full mesh (`faceMeshPartsSent`, the masking on): saved, like the mesh
 * itself, only once every environment's engine lists them
 * (`castSwap.faceMeshParts`); an engine that does not is answered the setting
 * without the key and would draw the full mesh.
 */
export function faceMeshPartsOfSetting(m: FaceMasking | undefined): Exclude<FaceMaskingFaceMeshParts, "full"> | undefined {
  return m && m.mode !== "off" ? faceMeshPartsSent(m) : undefined
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw every one of `parts`: none recorded, or one that does
 * not list each. Empty = every one can (and when none is asked).
 */
export function environmentsThatCannotDrawFaceMeshParts(environments: readonly EngineEnvironment[], parts: readonly FaceMaskingFaceMeshParts[]): string[] {
  if (parts.length === 0) return []
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || parts.some((p) => !engineDrawsFaceMeshParts(env.supports.castSwap, p))
  })
}

/** The words a refusal names each part by. */
const PARTS_NAME: Readonly<Record<FaceMaskingFaceMeshParts, string>> = { full: "the full mesh", features: "only the eyes and mouth", mouth: "only the mouth" }

/** The refusal's sentence, naming the parts and the environments that cannot (`environmentsThatCannotDrawFaceMeshParts`). */
export function cannotDrawFaceMeshPartsMessage(parts: readonly FaceMaskingFaceMeshParts[], envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot draw ${parts.map((p) => PARTS_NAME[p]).join(" or ")} of the face mesh yet, and this setting is shared by every environment: choose the full face mesh, or wait for the engine.`
}

/**
 * The smallest face a direct run's Full depth face mesh draws lines on, when
 * the setting sets one (`faceMeshMinFaceHeightSent`: on, Full depth, the face
 * mesh on; 0 included): saved, like the mesh itself, only once every
 * environment's engine declares it (`castSwap.faceMeshMinFaceHeightPct`); an
 * engine that does not is answered the setting without the key and would
 * draw every face it finds.
 */
export function faceMeshMinFaceHeightOfSetting(m: FaceMasking | undefined): number | undefined {
  return faceMeshMinFaceHeightSent(m)
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw the face mesh from a smallest face: none recorded, or
 * one that does not declare it. Empty = every one can.
 */
export function environmentsThatCannotDrawFaceMeshMinFaceHeight(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineDrawsFaceMeshMinFaceHeight(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotDrawFaceMeshMinFaceHeight`). */
export function cannotDrawFaceMeshMinFaceHeightMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot set the smallest face with mesh lines yet, and this setting is shared by every environment: empty it, or wait for the engine.`
}

/**
 * The platform hold (decided 2026-11-03). Staging and production share one
 * database, and a platform from before the field (its own app, whatever its
 * engine declares) cannot read a row that carries it: its strict schemas
 * refuse the key, so it drops that engine's whole Motion setting entry, and it
 * keys a trend's stored clip without it, so that trend's runs there are
 * refused `face_mask_required`. So the shared Motion setting, a trend's draft
 * and its publish take a value only while every environment's platform
 * claims that it takes the field (its platform claim, `PLATFORM_SUPPORTS`,
 * engine-environments.ts), lately: a claim counts only while its own time is
 * fresh (`platformOf`, the heartbeat's `PLATFORM_CLAIM_TTL_MS`), so one left
 * by a failed deploy, a crashed app or a rollback lapses by itself. 422
 * `platform_unsupported` otherwise. An absent field is never held, and
 * nothing read is.
 */
export const PLATFORM_UNSUPPORTED = "platform_unsupported"

/**
 * Whether a setting carries `faceMeshMinFaceHeightPct` at all: any value,
 * where it draws nothing too (the face mesh off), since an older platform's
 * strict schemas refuse the key itself.
 */
export function faceMeshMinFaceHeightCarried(m: Pick<FaceMasking, "faceMeshMinFaceHeightPct"> | undefined): boolean {
  return m?.faceMeshMinFaceHeightPct !== undefined
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * platform does not claim that it takes the field: no claim (a platform from
 * before it, however new its engine, or no row), a claim that does not say so,
 * or a claim no longer fresh (`platformOf`: its heartbeat stopped, as after a
 * failed deploy, a crash or a rollback). Empty = every one does, now.
 */
export function environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.faceMeshMinFaceHeightPct !== true)
}

/** Where a held value was going: the shared Nodaro Motion setting, a trend's draft, or a trend's publish. */
export type PlatformHoldContext = "setting" | "trend" | "publish"

/** The hold's sentence, naming the environments whose platform does not take the field yet. */
export function platformCannotTakeFaceMeshMinFaceHeightMessage(envs: readonly string[], context: PlatformHoldContext): string {
  const list = envs.join(" and ")
  const why =
    context === "setting"
      ? ", and this setting is shared by every environment"
      : context === "trend"
        ? ", and trends are shared by every environment"
        : ", so its runs of this trend would be refused"
  return `The platform in ${list} does not take the smallest face with mesh lines yet${why}: empty it, or wait until ${list} ${envs.length === 1 ? "is" : "are"} updated.`
}

/** A held save's 422 body (`error`). */
export interface PlatformHold {
  code: typeof PLATFORM_UNSUPPORTED
  message: string
  envs: string[]
}

/**
 * The hold of a save whose settings carry the field
 * (`faceMeshMinFaceHeightCarried`), or null: none carries it (the
 * environments are then not read at all), or every environment's platform
 * takes it. `environments` when the caller has read them already; else they
 * are read here, and a failed read throws, so an outage is never a save.
 */
export async function platformHoldOfFaceMeshMinFaceHeight(
  maskings: ReadonlyArray<Pick<FaceMasking, "faceMeshMinFaceHeightPct"> | undefined>,
  context: PlatformHoldContext,
  environments?: readonly EngineEnvironment[],
  now: number = Date.now(),
): Promise<PlatformHold | null> {
  if (!maskings.some(faceMeshMinFaceHeightCarried)) return null
  const lacking = environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight(environments ?? (await listEngineEnvironments()), now)
  if (lacking.length === 0) return null
  return { code: PLATFORM_UNSUPPORTED, message: platformCannotTakeFaceMeshMinFaceHeightMessage(lacking, context), envs: lacking }
}
