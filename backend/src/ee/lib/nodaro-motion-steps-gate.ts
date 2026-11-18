/**
 * A Video Remake steps setting is saved, and a trend that sets `steps` is
 * published, only once every environment's engine takes steps
 * (`castSwap.steps`).
 *
 * The Video Remake settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare `castSwap.steps` is answered no steps setting (`tk.settings`,
 * toolkit.ts), so its direct runs would quietly run as today. So the save is
 * refused while any environment in `TREND_PUBLISH_ENVIRONMENTS` has no
 * recorded engine, or one that does not declare it: the face mesh's rule
 * (`nodaro-motion-face-mesh.ts`).
 */
import {
  engineTakesClipBodySheet,
  engineTakesShotList,
  engineTakesShotListSpeech,
  engineTakesSteps,
  engineTakesStyleRefs,
  shotListOnlyClipModelSet,
  shotListSpeechKey,
  shotListSpeechSet,
  type CastSwapSteps,
} from "../../lib/cast-swap-steps.js"
import { TREND_PUBLISH_ENVIRONMENTS, platformOf, type EngineEnvironment } from "./engine-environments.js"
import { PLATFORM_UNSUPPORTED, type PlatformHold, type PlatformHoldContext } from "./nodaro-motion-face-mesh.js"

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take steps: none recorded, or one that does not declare it.
 * Empty = every one can.
 */
export function environmentsThatCannotTakeSteps(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesSteps(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotTakeSteps`). */
export function cannotTakeStepsMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot take preparation steps yet, and this setting is shared by every environment: clear the steps, or wait for the engine.`
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take "Body from the clip" (`steps.clipBody`): none recorded,
 * or one that does not declare `castSwap.steps` and `castSwap.clipBodySheet`.
 * An engine with steps but without it is never sent the field, so a shared
 * setting that sets it On with a prompt of its own would quietly run that
 * engine's default there (Off needs nothing: it is safe on every engine).
 */
export function environmentsThatCannotTakeClipBody(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesClipBodySheet(env.supports.castSwap)
  })
}

/** The refusal's sentence for "Body from the clip" (`environmentsThatCannotTakeClipBody`). */
export function cannotTakeClipBodyMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot take the Body from the clip step yet, and this setting is shared by every environment: leave that step unset, or wait for the engine.`
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take the shot list (`steps.shotList`): none recorded, or one
 * that does not declare `castSwap.steps` and `castSwap.shotList`. An engine
 * without it is never sent the field, so a shared setting that sets it away
 * from its defaults (`shotListNeedsEngine`) would quietly run without it there.
 */
export function environmentsThatCannotTakeShotList(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesShotList(env.supports.castSwap)
  })
}

/** The refusal's sentence for the shot list (`environmentsThatCannotTakeShotList`). */
export function cannotTakeShotListMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot take the shot list step yet, and this setting is shared by every environment: leave that step at its defaults, or wait for the engine.`
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take "Style the role pictures" (`steps.styleRefs`): none
 * recorded, or one that does not declare `castSwap.steps` and
 * `castSwap.styleRefs`. An engine without it is never sent the field, so a
 * shared setting that turns it On (`styleRefsNeedsEngine`) would quietly run
 * without it there (Off needs nothing: it is the default on every engine).
 */
export function environmentsThatCannotTakeStyleRefs(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesStyleRefs(env.supports.castSwap)
  })
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take the shot list's speech (`steps.shotList.<style>.speech`,
 * decided 2026-11-18): none recorded, or one that does not declare
 * `castSwap.steps`, `castSwap.shotList` and `castSwap.shotListSpeech`. Such an
 * engine is sent the shot list without the key, so a shared setting that asks
 * for speech would quietly run without it there.
 */
export function environmentsThatCannotTakeShotListSpeech(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesShotListSpeech(env.supports.castSwap)
  })
}

/** How a refusal says why every environment must take it. */
const SHARED_BY: Readonly<Record<Exclude<PlatformHoldContext, "publish">, string>> = {
  setting: "this setting is shared by every environment",
  trend: "trends are shared by every environment",
}

/** The refusal's sentence for the shot list's speech (`environmentsThatCannotTakeShotListSpeech`). */
export function cannotTakeShotListSpeechMessage(envs: readonly string[], context: Exclude<PlatformHoldContext, "publish"> = "setting"): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot write who speaks into the shot list yet, and ${SHARED_BY[context]}: set Speech in the script to Off, or wait for the engine.`
}

/**
 * The environments whose platform does not claim (fresh, `platformOf`) that it
 * takes the shot list's speech (`PlatformSupports.shotListSpeech`). Empty =
 * every one does, now.
 */
export function environmentsWhosePlatformCannotTakeShotListSpeech(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.shotListSpeech !== true)
}

/**
 * The platform hold of a save (decided 2026-11-18, the face mesh's rule,
 * `nodaro-motion-face-mesh.ts`): settings in which any shot list asks for
 * speech ("who" or "words"; "off" is never stored, and its mouths value is
 * stored only beside it) are saved only while every environment's platform
 * takes the keys. A platform from before them refuses the keys when it reads
 * the shared row (and drops that engine's whole steps entry), or a trend draft
 * that holds them. `context`: the shared Video Remake setting (the default), a
 * trend's draft, or its publish. Null when none asks for speech, or every
 * platform takes it.
 */
export function platformHoldOfShotListSpeech(
  entries: ReadonlyArray<Pick<CastSwapSteps, "shotList"> | undefined>,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
  context: PlatformHoldContext = "setting",
): PlatformHold | null {
  if (!entries.some((entry) => shotListSpeechSet(entry?.shotList))) return null
  const lacking = environmentsWhosePlatformCannotTakeShotListSpeech(environments, now)
  if (lacking.length === 0) return null
  const list = lacking.join(" and ")
  const why = context === "publish" ? ", so its runs of this trend would be made without it" : `, and ${SHARED_BY[context]}`
  return {
    code: PLATFORM_UNSUPPORTED,
    message: `The platform in ${list} does not take Speech in the script yet${why}: set it to Off, or wait until ${list} ${lacking.length === 1 ? "is" : "are"} updated.`,
    envs: lacking,
  }
}

/**
 * The platform hold of a Video Remake steps save whose shot list (either style) is shown the clip by a model only the
 * shot list may use (`shotListOnlyClipModelSet`: Gemini 4 Hydrogen, decided 2026-11-18). A platform from before that
 * choice refuses such a model (`model_cannot_read_clip`) in the shared row, so every steps save there would be refused,
 * an unrelated one too. It ships in the same platform release as the shot list's speech, so the speech claim
 * (`PlatformSupports.shotListSpeech`, fresh) stands for it: no claim of its own. Held on PRESENCE, as the speech hold
 * on the same route is: while the setting holds the model and any platform lacks the claim. Null otherwise.
 */
export function platformHoldOfShotListModels(
  entries: ReadonlyArray<Pick<CastSwapSteps, "shotList"> | undefined>,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): PlatformHold | null {
  if (!entries.some((entry) => shotListOnlyClipModelSet(entry?.shotList))) return null
  const lacking = environmentsWhosePlatformCannotTakeShotListSpeech(environments, now)
  if (lacking.length === 0) return null
  const list = lacking.join(" and ")
  return {
    code: PLATFORM_UNSUPPORTED,
    message: `The platform in ${list} does not take Gemini 4 Hydrogen for the shot list yet, and this setting is shared by every environment: choose another model, or wait until ${list} ${lacking.length === 1 ? "is" : "are"} updated.`,
    envs: lacking,
  }
}

/**
 * A trend draft's save that changes its shot list's speech (`shotListSpeechKey`) to one that asks for some: held
 * first while any environment's platform does not take it (422), then while any environment's engine does not
 * (409). The draft's own speech left as it is, or turned Off, is never held. Null: saved.
 */
export function shotListSpeechTrendRefusal(
  next: Pick<CastSwapSteps, "shotList"> | undefined,
  before: Pick<CastSwapSteps, "shotList"> | undefined,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): { status: 409 | 422; error: PlatformHold | { code: "engine_unsupported"; message: string; envs: string[] } } | null {
  if (!shotListSpeechSet(next?.shotList) || shotListSpeechKey(next?.shotList) === shotListSpeechKey(before?.shotList)) return null
  const held = platformHoldOfShotListSpeech([next], environments, now, "trend")
  if (held) return { status: 422, error: held }
  const lacking = environmentsThatCannotTakeShotListSpeech(environments)
  if (lacking.length > 0) return { status: 409, error: { code: "engine_unsupported", message: cannotTakeShotListSpeechMessage(lacking, "trend"), envs: lacking } }
  return null
}

/** The refusal's sentence for "Style the role pictures" (`environmentsThatCannotTakeStyleRefs`). */
export function cannotTakeStyleRefsMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot take the Style the role pictures step yet, and this setting is shared by every environment: leave that step off, or wait for the engine.`
}
