/**
 * Seedance 2.5 Draft mode — the single source of truth for which models offer a
 * draft, what a draft renders at, and how its 1080p finalize is priced.
 *
 * A DRAFT is an ordinary Seedance 2.5 run with the provider's draft flag set: it
 * renders at 480p only and costs exactly what a normal 480p run of the same
 * shape costs. The FINALIZE ("Seedance 2.5 HD (from draft)", a Video Upscale
 * provider) re-renders that same take — same seed, prompt, references and
 * timing — at 1080p, frame for frame, at the draft's own length. Nothing
 * creative is re-sent: the finalize names the draft's provider task and nothing
 * else.
 *
 * Every surface (generation routes, the workflow engine, MCP, the editor's
 * toggle) gates on {@link isSeedanceDraftCapable}; never hand-list the model.
 */

/** Models that accept the draft flag. */
export const SEEDANCE_DRAFT_MODELS = ["seedance-2-5"] as const
export type SeedanceDraftModel = typeof SEEDANCE_DRAFT_MODELS[number]

export function isSeedanceDraftCapable(provider: string | undefined): provider is SeedanceDraftModel {
  return !!provider && (SEEDANCE_DRAFT_MODELS as readonly string[]).includes(provider)
}

/** The only resolution a draft renders at. Any other value is coerced to it. */
export const SEEDANCE_DRAFT_RESOLUTION = "480p"

/** The Video Upscale provider that finalizes a draft. */
export const SEEDANCE_DRAFT_FINALIZE_PROVIDER = "seedance-2-5-hd"

/** The only resolution a finalize renders at. */
export const SEEDANCE_DRAFT_FINALIZE_RESOLUTION = "1080p"

/** Shortest / longest output the finalize price ladder is seeded for. */
export const SEEDANCE_DRAFT_FINALIZE_MIN_SEC = 4
export const SEEDANCE_DRAFT_FINALIZE_MAX_SEC = 30

/**
 * Whole seconds the finalize bills for a measured draft length.
 *
 * A container reports a hair over the nominal length (4.04 s for a 4 s clip), so
 * the seconds round UP only past a quarter second — the same rule the Seedance
 * auto-duration settlement uses — and land on the seeded ladder (4–30 s).
 */
export function seedanceDraftFinalizeBillableSec(measuredSec: number): number {
  const whole = Math.max(1, Math.ceil(measuredSec - 0.25))
  return Math.min(SEEDANCE_DRAFT_FINALIZE_MAX_SEC, Math.max(SEEDANCE_DRAFT_FINALIZE_MIN_SEC, whole))
}

/**
 * The credit identifier a finalize reserves under.
 *
 * Same encoding as the Seedance 2.5 generation ladder: one row per OUTPUT second
 * (`seedance-2-5-hd:{N}s`), and a `-ref` twin for a draft that had a reference
 * VIDEO. As on the generation lane, the `-ref` row encodes the per-second rate
 * only; a reference run bills `rate × (input + output)` seconds, which the
 * reservation computes from the 8 s `-ref` row (see the backend's
 * `seedanceDraftFinalizeRefBaseCredits`). Reference IMAGES do not change the
 * rate — only a reference video does.
 */
export function seedanceDraftFinalizeCreditId(durationSec: number, hasRefVideo: boolean): string {
  const n = seedanceDraftFinalizeBillableSec(durationSec)
  return `${SEEDANCE_DRAFT_FINALIZE_PROVIDER}:${n}s${hasRefVideo ? "-ref" : ""}`
}
