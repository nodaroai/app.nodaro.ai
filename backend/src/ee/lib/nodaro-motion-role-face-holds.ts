/**
 * What storing a trend's Face chip needs of every environment (decided
 * 2026-11-20; staging and production share one database:
 * `engine-environments.ts`). The shot list's speech holds
 * (nodaro-motion-steps-gate.ts), for a person slot's `face` (its default and
 * its place in `chips`, trends/role-face.ts `faceChipKey`).
 *
 * A draft save or a publish that changes what the trend stores of the Face
 * chip to something (`faceChipKey`, the caller compares it) is held while
 * any environment in `TREND_PUBLISH_ENVIRONMENTS` cannot take it:
 *  - first its PLATFORM: a build from before the chip refuses the key in its
 *    strict slot schema, and with it the whole trend version, whatever the
 *    value (so any stored Face chip, "new" too, waits). Until every
 *    environment's platform claims it (`PlatformSupports.roleFace`, fresh:
 *    `platformOf`), 422 `platform_unsupported`;
 *  - then, on a draft save, its ENGINE, when the trend's runs can keep a face
 *    (`trendMayKeepFaces`: a default of "original", or the chip offered): one
 *    that does not declare `castSwap.roleFace` (or none recorded) would ignore
 *    `face` and hide the face, 409 `engine_unsupported`. A publish holds the
 *    engine by its own checks (`ROLE_FACE_NEED`, publish-check.ts).
 * What a draft already stores is never a reason to refuse its save, and
 * taking the chip away is never held.
 */
import { engineTakesRoleFace } from "../../lib/cast-swap-role-face.js"
import { TREND_PUBLISH_ENVIRONMENTS, platformOf, type EngineEnvironment } from "./engine-environments.js"
import { PLATFORM_UNSUPPORTED, type PlatformHold } from "./nodaro-motion-face-mesh.js"
import { faceChipKey, faceChipStored, trendMayKeepFaces } from "./trends/role-face.js"
import type { TrendVersionData } from "./trends/types.js"

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot keep a person's own face: none recorded, or one that does not
 * declare `castSwap.roleFace`. Empty = every one can.
 */
export function environmentsThatCannotTakeRoleFace(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesRoleFace(env.supports.castSwap)
  })
}

/**
 * The environments whose platform does not claim (fresh, `platformOf`) that
 * it takes the Face chip (`PlatformSupports.roleFace`). Empty = every one
 * does, now.
 */
export function environmentsWhosePlatformCannotTakeRoleFace(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.roleFace !== true)
}

/** The engine refusal's sentence, naming the environments whose engine cannot keep a face. */
export function cannotTakeRoleFaceMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot keep a person's own face yet, and trends are shared by every environment: set Face to new and hide it, or wait for the engine.`
}

/**
 * The platform hold of a trend draft or publish that stores the Face chip
 * (the caller decides that it changes it), or null: every environment's
 * platform takes it, now.
 */
export function roleFacePlatformHold(
  context: "trend" | "publish",
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): PlatformHold | null {
  const lacking = environmentsWhosePlatformCannotTakeRoleFace(environments, now)
  if (lacking.length === 0) return null
  const list = lacking.join(" and ")
  const why = context === "publish" ? ", so it could not read this trend" : ", and trends are shared by every environment"
  return {
    code: PLATFORM_UNSUPPORTED,
    message: `The platform in ${list} does not take the Face chip yet${why}: remove it from the person slots, or wait until ${list} ${lacking.length === 1 ? "is" : "are"} updated.`,
    envs: lacking,
  }
}

/** Whether `next` changes what `before` stores of the Face chip to something (taking it away is no change to hold). */
export function faceChipChanged(next: Pick<TrendVersionData, "slots">, before: Pick<TrendVersionData, "slots"> | undefined): boolean {
  return faceChipStored(next) && faceChipKey(next) !== faceChipKey(before)
}

/**
 * A trend draft's save that changes its Face chip (`faceChipChanged`): held
 * first while any environment's platform does not take it (422), then, when
 * the draft's runs can keep a face, while any environment's engine cannot
 * (409). Null: saved.
 */
export function roleFaceTrendRefusal(
  next: Pick<TrendVersionData, "slots">,
  before: Pick<TrendVersionData, "slots"> | undefined,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): { status: 409 | 422; error: PlatformHold | { code: "engine_unsupported"; message: string; envs: string[] } } | null {
  if (!faceChipChanged(next, before)) return null
  const held = roleFacePlatformHold("trend", environments, now)
  if (held) return { status: 422, error: held }
  if (!trendMayKeepFaces(next)) return null
  const lacking = environmentsThatCannotTakeRoleFace(environments)
  if (lacking.length > 0) return { status: 409, error: { code: "engine_unsupported", message: cannotTakeRoleFaceMessage(lacking), envs: lacking } }
  return null
}
