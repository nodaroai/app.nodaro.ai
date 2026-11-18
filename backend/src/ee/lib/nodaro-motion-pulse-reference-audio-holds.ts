/**
 * What a Pulse reference audio save needs of every environment (staging and
 * production share one database: `engine-environments.ts`). The Prism
 * reference audio's holds (nodaro-motion-prism-reference-audio-modes.ts), with
 * one requirement: the setting itself.
 *
 * A save that changes a resolution to a value off the default of its audio out
 * (`pulseReferenceAudioChangedFrom`, the caller's) is held while any
 * environment in `TREND_PUBLISH_ENVIRONMENTS` cannot take it:
 *  - first its PLATFORM: a build from before the setting reads the row (or a
 *    trend version holding the field) as never saved, so every run there sends
 *    the default, and its strict trend schema refuses the draft on every save.
 *    An engine record proves nothing of this (an older app running a newer
 *    plugin records the plugin's flag as it is), so until every environment's
 *    platform claims it (`PlatformSupports.pulseReferenceAudio`, fresh:
 *    `platformOf`) the save is 422 `platform_unsupported`;
 *  - then its ENGINE: one that does not declare `castSwap.pulseReferenceAudio`
 *    (or none recorded) is never sent the key, so its runs would quietly keep
 *    the default: 409 `engine_unsupported`.
 * What a setting or a draft already holds is never a reason to refuse its
 * save, and a value taken back to the default is never held.
 */
import { engineTakesPulseReferenceAudioIn } from "../../lib/cast-swap-pulse-reference-audio.js"
import { TREND_PUBLISH_ENVIRONMENTS, platformOf, type EngineEnvironment } from "./engine-environments.js"
import { PLATFORM_UNSUPPORTED, type PlatformHold, type PlatformHoldContext } from "./nodaro-motion-face-mesh.js"

/** How a refusal says why every environment must take it. */
const SHARED: Readonly<Record<Exclude<PlatformHoldContext, "publish">, string>> = {
  setting: "this setting is shared by every environment",
  trend: "trends are shared by every environment",
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine does not take the Pulse reference audio: none recorded, or one that
 * does not declare `castSwap.pulseReferenceAudio`. Empty = every one does.
 */
export function environmentsThatCannotTakePulseReferenceAudio(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesPulseReferenceAudioIn(env.supports.castSwap)
  })
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * platform does not claim the Pulse reference audio: no claim (an app from
 * before it, however new its engine, or no row), one that does not say so, or
 * one no longer fresh (`platformOf`). Empty = every one does, now.
 */
export function environmentsWhosePlatformCannotTakePulseReferenceAudio(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.pulseReferenceAudio !== true)
}

/** The engine refusal's sentence, naming the environments whose engine cannot send it. */
export function cannotTakePulseReferenceAudioMessage(envs: readonly string[], context: Exclude<PlatformHoldContext, "publish"> = "setting"): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot send the Pulse reference audio yet, and ${SHARED[context]}: keep the default for the audio out, or wait for the engine.`
}

/** The hold's sentence, naming the environments whose platform does not read it yet. */
function platformCannotTakeMessage(envs: readonly string[], context: PlatformHoldContext): string {
  const list = envs.join(" and ")
  const why = context === "publish" ? ", so its runs of this trend would send the default" : `, and ${SHARED[context]}`
  return `The platform in ${list} does not take the Pulse reference audio yet${why}: keep the default for the audio out, or wait until ${list} ${envs.length === 1 ? "is" : "are"} updated.`
}

/**
 * The platform hold of a save that changes a resolution to a value off the
 * default (the caller decides that), or null: every environment's platform
 * claims it, now.
 */
export function pulseReferenceAudioPlatformHold(
  context: PlatformHoldContext,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): PlatformHold | null {
  const lacking = environmentsWhosePlatformCannotTakePulseReferenceAudio(environments, now)
  if (lacking.length === 0) return null
  return { code: PLATFORM_UNSUPPORTED, message: platformCannotTakeMessage(lacking, context), envs: lacking }
}

/** A refused save's answer. */
export interface PulseReferenceAudioRefusal {
  status: 409 | 422
  error: PlatformHold | { code: "engine_unsupported"; message: string; envs: string[] }
}

/**
 * The refusal of a save that changes a resolution to a value off the default
 * (the caller decides that), or null: every environment's platform claim and
 * engine take it. The platform first: while it cannot read the value, what its
 * engine declares says nothing.
 */
export function pulseReferenceAudioRefusalOf(
  context: Exclude<PlatformHoldContext, "publish">,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): PulseReferenceAudioRefusal | null {
  const held = pulseReferenceAudioPlatformHold(context, environments, now)
  if (held) return { status: 422, error: held }
  const missing = environmentsThatCannotTakePulseReferenceAudio(environments)
  if (missing.length === 0) return null
  return { status: 409, error: { code: "engine_unsupported", message: cannotTakePulseReferenceAudioMessage(missing, context), envs: missing } }
}
