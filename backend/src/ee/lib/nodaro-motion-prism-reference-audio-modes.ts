/**
 * What a Prism reference audio save needs of every environment (staging and
 * production share one database: `engine-environments.ts`).
 *
 * A setting that needs more of an engine than the reference audio itself
 * (`prismReferenceAudioRequirementsOf`: "one-tone" or "octave", which an engine
 * lists in `castSwap.prismReferenceAudioModes`, or a value no id says, which
 * needs `castSwap.prismReferenceAudioPitch` and, for a one-tone mode, that mode
 * listed) is saved only once every environment's engine meets it. The direct
 * runs' setting (`nodaro_motion_prism_reference_audio`) is one row. An engine
 * that does not take a value is sent the full audio for it
 * (`prismReferenceAudioWire`), so its direct runs would quietly carry the song.
 * So the save is refused while any environment in `TREND_PUBLISH_ENVIRONMENTS`
 * has no recorded engine, or one that does not meet it: the depth colormap's
 * rule (`nodaro-motion-depth-colormap.ts`) and publishing a trend's
 * (`prismReferenceAudioNeedOf`, publish-check.ts).
 *
 * The platform hold (the same as `platformHoldOfFaceMeshMinFaceHeight`'s, with
 * its claim). A value no id says is what older code cannot read: a build from
 * before it reads a setting or a trend version holding one as never saved, so
 * every resolution there sends the full audio (where silence or the vocals
 * alone were asked for too), and its schema refuses that draft on every save.
 * An engine record proves nothing of this: an older app running a newer plugin
 * records the plugin's flag as it is. So until every environment's PLATFORM
 * claims that it takes it (`PlatformSupports.prismReferenceAudioPitch`, fresh:
 * `platformOf`), such a value is held, 422 `platform_unsupported`, before the
 * engine is looked at.
 *
 * Both only where a save CHANGES a resolution (`prismReferenceAudioChangedFrom`,
 * the caller's): what a setting or a draft already holds is never a reason to
 * refuse its save, and a value an id says is never held at all.
 */
import {
  engineMeetsPrismReferenceAudioRequirement,
  type PrismReferenceAudioRequirement,
} from "../../lib/cast-swap-prism-reference-audio.js"
import { TREND_PUBLISH_ENVIRONMENTS, platformOf, type EngineEnvironment } from "./engine-environments.js"
import { PLATFORM_UNSUPPORTED, type PlatformHold, type PlatformHoldContext } from "./nodaro-motion-face-mesh.js"

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot meet every one of `requirements`: none recorded, or one that
 * does not meet each. Empty = every one can (and when none is asked).
 */
export function environmentsThatCannotTakePrismReferenceAudio(
  environments: readonly EngineEnvironment[],
  requirements: readonly PrismReferenceAudioRequirement[],
): string[] {
  if (requirements.length === 0) return []
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || requirements.some((r) => !engineMeetsPrismReferenceAudioRequirement(env.supports.castSwap, r))
  })
}

/** How a refusal says why every environment must take it. */
const SHARED: Readonly<Record<Exclude<PlatformHoldContext, "publish">, string>> = {
  setting: "this setting is shared by every environment",
  trend: "trends are shared by every environment",
}

/** The refusal's sentence, naming what is asked (the ids or modes, and the pitch shift) and the environments that cannot take it. */
export function cannotTakePrismReferenceAudioMessage(
  requirements: readonly PrismReferenceAudioRequirement[],
  envs: readonly string[],
  context: Exclude<PlatformHoldContext, "publish"> = "setting",
): string {
  const names = requirements.filter((r) => r !== "pitch")
  const pitch = requirements.includes("pitch")
  const as = `as ${names.join(" or ")}`
  const what = names.length === 0 ? "with that pitch shift" : pitch ? `${as}, or with that pitch shift,` : as
  return `The Cast Swap engine in ${envs.join(" and ")} cannot send the Prism reference audio ${what} yet, and ${SHARED[context]}: choose another ${pitch ? "mode or pitch shift" : "mode"}, or wait for the engine.`
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * platform does not claim that it reads a value no id says: no claim (an app
 * from before it, however new its engine, or no row), one that does not say
 * so, or one no longer fresh (`platformOf`: its heartbeat stopped, as after a
 * failed deploy, a crash or a rollback). Empty = every one does, now.
 */
export function environmentsWhosePlatformCannotTakePrismReferenceAudioPitch(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.prismReferenceAudioPitch !== true)
}

/** The hold's sentence, naming the environments whose platform does not read it yet, and what the screens can still set meanwhile (their pitch field closed). */
function platformCannotTakeMessage(envs: readonly string[], context: PlatformHoldContext): string {
  const list = envs.join(" and ")
  const why = context === "publish" ? ", so its runs of this trend would send the full audio" : `, and ${SHARED[context]}`
  return `The platform in ${list} does not take this Prism reference audio yet${why}: choose No audio, Full mix at +4, Voice only at +4, or Full mix, one tone at 0, or wait until ${list} ${envs.length === 1 ? "is" : "are"} updated.`
}

/**
 * The platform hold of what a save changed (`requirements`: its changed
 * resolutions'), or null: no value no id says among them, or every
 * environment's platform claims it, now.
 */
export function prismReferenceAudioPlatformHold(
  requirements: readonly PrismReferenceAudioRequirement[],
  context: PlatformHoldContext,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): PlatformHold | null {
  if (!requirements.includes("pitch")) return null
  const lacking = environmentsWhosePlatformCannotTakePrismReferenceAudioPitch(environments, now)
  if (lacking.length === 0) return null
  return { code: PLATFORM_UNSUPPORTED, message: platformCannotTakeMessage(lacking, context), envs: lacking }
}

/** A refused save's answer. */
export interface PrismReferenceAudioRefusal {
  status: 409 | 422
  error: PlatformHold | { code: "engine_unsupported"; message: string; envs: string[] }
}

/**
 * The refusal of a save of what it changed (`requirements`: its changed
 * resolutions'), or null: every environment's platform claim and engine take
 * it. The platform first: while it cannot read the value, what its engine
 * declares says nothing.
 */
export function prismReferenceAudioRefusalOf(
  requirements: readonly PrismReferenceAudioRequirement[],
  context: Exclude<PlatformHoldContext, "publish">,
  environments: readonly EngineEnvironment[],
  now: number = Date.now(),
): PrismReferenceAudioRefusal | null {
  const held = prismReferenceAudioPlatformHold(requirements, context, environments, now)
  if (held) return { status: 422, error: held }
  const missing = environmentsThatCannotTakePrismReferenceAudio(environments, requirements)
  if (missing.length === 0) return null
  return { status: 409, error: { code: "engine_unsupported", message: cannotTakePrismReferenceAudioMessage(requirements, missing, context), envs: missing } }
}
