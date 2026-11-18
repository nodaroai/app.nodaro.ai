/**
 * The podcast pack's price (decided 2026-11-18): one rate per started 15
 * seconds of the ORIGINAL recording, every tool chosen in the pack included —
 * no per-tool fee, no per-step charge. The rate's row is `model_pricing`
 * `podcast-pack:per-15s` (base, marked up once over the whole run like every
 * per-unit rate), else its `STATIC_CREDIT_COSTS` row; a pack of N units is
 * quoted as `podcast-pack:per-15s:<N>u` (lib/unit-quote-rates.ts).
 */
import { USE_CASE_NODE_TYPES } from "@nodaro/render-rules"
export { PODCAST_PACK_JOB_TYPE } from "./pack-job-type.js"

/** The pack's one-unit price row. */
export const PODCAST_PACK_RATE_ID = "podcast-pack:per-15s"

/** The seconds of recording one unit prices. */
export const PODCAST_PACK_UNIT_SECONDS = 15

/**
 * The tools a pack may run: every use-case node (each works on an episode's
 * recording), in their own order — a new one joins the pack with nothing to list.
 */
export const PODCAST_PACK_TOOLS = USE_CASE_NODE_TYPES

export type PodcastPackTool = (typeof PODCAST_PACK_TOOLS)[number]

/** The units a recording of `durationSec` is charged: every started 15 seconds, at least one. */
export function podcastPackUnits(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new RangeError(`A pack needs the recording's length (got ${durationSec})`)
  // A length a hair over a whole unit through float noise (60.000000001 s) is that unit, not the next.
  return Math.max(1, Math.ceil(Math.round(durationSec * 1000) / (PODCAST_PACK_UNIT_SECONDS * 1000)))
}

/** The tools a raw request body names (the route gate reads it before the body is parsed). */
export function packToolsNamed(body: Readonly<Record<string, unknown>>): string[] {
  const tools = body.tools
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) return []
  return Object.keys(tools).filter((t) => (PODCAST_PACK_TOOLS as readonly string[]).includes(t))
}
