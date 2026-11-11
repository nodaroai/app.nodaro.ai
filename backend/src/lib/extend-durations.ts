/**
 * The seconds a request may ask each Extend Video provider to add, as a list
 * of the whole seconds it takes — so a range (LTX's 1–20) and a discrete set
 * (a model that adds 6 or 10) read the same way.
 *
 * Every provider declares its own list: there is no fallback a new provider
 * could silently inherit (the table is keyed by the provider type, and
 * `__tests__/extend-durations.test.ts` holds its keys to
 * `EXTEND_VIDEO_PROVIDERS`). A provider whose extend entry in the catalog
 * declares `durations` takes exactly those — the editor offers them and the
 * price rows cover them.
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import type { ExtendVideoProvider } from "@nodaro/shared/models"
import { LTX_EXTEND_DURATION } from "@nodaro/shared/credits"

const secondsFrom = (min: number, max: number): readonly number[] =>
  Array.from({ length: max - min + 1 }, (_, i) => min + i)

/** An extend model's catalog `durations`; a build-time error when it declares none. */
function catalogDurations(provider: ExtendVideoProvider): readonly number[] {
  const durations = MODEL_CATALOG[provider]?.durations
  if (!durations?.length) throw new Error(`${provider}: its catalog entry declares no durations`)
  return durations
}

export const EXTEND_DURATION_SECONDS: Readonly<Record<ExtendVideoProvider, readonly number[]>> = {
  // VEO and Runway add a length of their own and ignore the field; they keep
  // the 1–20 the route has always accepted.
  "veo-extend": secondsFrom(1, 20),
  "runway-extend": secondsFrom(1, 20),
  // LTX's extend lengths, not its generation model's catalog 6/8/10.
  "ltx-2.3-pro": secondsFrom(LTX_EXTEND_DURATION.MIN_SEC, LTX_EXTEND_DURATION.MAX_SEC),
  "seedance-2-5-extend": catalogDurations("seedance-2-5-extend"),
  "seedance-2-0-extend": catalogDurations("seedance-2-0-extend"),
}

/** The longest any provider adds: the request schema's ceiling (each provider's own list is checked after it). */
export const EXTEND_DURATION_MAX_SEC = Math.max(...Object.values(EXTEND_DURATION_SECONDS).flat())

/** "4–15 seconds" for a run of whole seconds, "6 or 10 seconds" for a set. */
export function describeSeconds(seconds: readonly number[]): string {
  const first = seconds[0]!
  const last = seconds[seconds.length - 1]!
  if (seconds.length > 1 && last - first === seconds.length - 1) return `${first}–${last} seconds`
  if (seconds.length === 1) return `${first} seconds`
  return `${seconds.slice(0, -1).join(", ")} or ${last} seconds`
}
