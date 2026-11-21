/**
 * When the shot lock (`nodaro_motion_shot_lock` "on" for any engine) may be
 * saved.
 *
 * The Video Remake settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). The shot lock's row is one
 * only an engine that declares `castSwap.shotLock` reads: an engine without
 * the flag never reads it and writes no such line, so the row cannot change a
 * run there. A change that turns an engine on is therefore saved once AT LEAST
 * ONE environment in `TREND_PUBLISH_ENVIRONMENTS` has a recorded engine that
 * declares it (`noEnvironmentWritesShotLock`): one reader is enough, the
 * style-only row's rule (`nodaro-motion-style-only-gate.ts`). Until an
 * environment's engine declares it, that environment's direct runs stay
 * without the line, and get it the day its engine does.
 *
 * Off everywhere needs nothing: it is what every engine does today.
 *
 * An entry BY RUN TYPE (the three switches and the per-style exceptions) is
 * read only by an engine that declares `castSwap.shotLockRunTypes`; any other
 * engine that writes the line reads only `"on"` and is answered nothing for
 * such an entry (off there). The same rule holds for it: saved once at least
 * one environment's engine declares it (`noEnvironmentReadsShotLockRunTypes`).
 */
import { engineTakesShotLock, engineTakesShotLockRunTypes } from "../../lib/nodaro-motion-shot-lock.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

function writesShotLock(environments: readonly EngineEnvironment[], name: string): boolean {
  const env = environments.find((e) => e.env === name)
  return !!env && engineTakesShotLock(env.supports.castSwap)
}

/**
 * True when no environment of `TREND_PUBLISH_ENVIRONMENTS` has a recorded
 * engine declaring `castSwap.shotLock` (an environment outside that list
 * never counts).
 */
export function noEnvironmentWritesShotLock(environments: readonly EngineEnvironment[]): boolean {
  return !TREND_PUBLISH_ENVIRONMENTS.some((name) => writesShotLock(environments, name))
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine does not write the shot lock's line: none recorded, or one that does
 * not declare `castSwap.shotLock`. Empty = every one does. For the admin
 * screen to say where an "on" is not read yet.
 */
export function environmentsThatCannotWriteShotLock(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => !writesShotLock(environments, name))
}

function readsRunTypes(environments: readonly EngineEnvironment[], name: string): boolean {
  const env = environments.find((e) => e.env === name)
  return !!env && engineTakesShotLock(env.supports.castSwap) && engineTakesShotLockRunTypes(env.supports.castSwap)
}

/** True when no environment of `TREND_PUBLISH_ENVIRONMENTS` has a recorded engine that reads an entry by run type. */
export function noEnvironmentReadsShotLockRunTypes(environments: readonly EngineEnvironment[]): boolean {
  return !TREND_PUBLISH_ENVIRONMENTS.some((name) => readsRunTypes(environments, name))
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine does not read an entry by run type: there such an entry is off.
 * Empty = every one does.
 */
export function environmentsThatCannotReadShotLockRunTypes(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => !readsRunTypes(environments, name))
}

/** The refusal's sentence while `noEnvironmentReadsShotLockRunTypes`. */
export const NO_ENGINE_READS_SHOT_LOCK_RUN_TYPES_MESSAGE =
  "No Cast Swap engine reads the shot lock by run type yet: turn Ordinary run and Art style + roles on together with nothing else, or wait for the engine."

/** The refusal's sentence while `noEnvironmentWritesShotLock`. */
export const NO_ENGINE_WRITES_SHOT_LOCK_MESSAGE = "No Cast Swap engine writes the shot lock yet: keep it off, or wait for the engine."
