/**
 * A per-person face mask variant's steps (pure; the admin routes read the
 * jobs and act). A variant in the making (`TrendFaceMaskVariantJob`) is
 * recorded before anything is paid, then runs:
 *   1. the core `mask-erase` job on the approved mask's raw mask
 *      (`eraseJobId`, a child of the variant's own job), with the variant's
 *      eraseAlways, erase and keep boxes (face-mask-variants.ts). With keep or
 *      eraseAlways sent, its result must report `keptRegions`: a worker that
 *      predates them ignores them (and would erase a filled person's face),
 *      so its result is never used;
 *   2. when that left something to cover, the engine's face-mask make from
 *      the erased mask (`makeJobId`: `fromMask`, no marks — it only fills,
 *      exactly as the base was filled);
 *   3. done: the masked clip (or nothing left to cover) becomes the variant,
 *      approved as it finishes.
 * `nextVariantStep` says what comes next from what the jobs say.
 */
import type { TrendFaceMaskVariantJob } from "./types.js"

/** A job row as the steps read it (`status`, `output_data`, `error_message`). */
export interface VariantStepJob {
  status: string
  output_data?: unknown
  error_message?: unknown
}

export type VariantStep =
  /** Recorded, its erase not asked for yet: ask it (idempotently). */
  | { kind: "erase" }
  /** A job is still running. */
  | { kind: "wait" }
  /** It failed (`message` admin-facing): the variant is made again from the start. */
  | { kind: "fail"; message: string }
  /** The erase left nothing to cover: the variant runs unmasked. */
  | { kind: "nothing_left"; stats: { coverage: number; erasedRegions: number } }
  /** The erase is done: fill the erased mask (`maskUrl`). */
  | { kind: "make"; maskUrl: string }
  /** The fill is done: `maskedUrl` is the variant's clip. */
  | { kind: "done"; maskedUrl: string; stats: { coverage: number; erasedRegions: number } }

const IN_FLIGHT = new Set(["pending", "queued", "processing", "running", "pending_review"])

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)
const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null)

/** A job that did not complete: still running, or failed (with its own words, admin-facing). */
function unfinished(job: VariantStepJob | null, what: string): VariantStep | null {
  if (!job) return { kind: "fail", message: `The ${what} job is gone.` }
  if (IN_FLIGHT.has(job.status)) return { kind: "wait" }
  if (job.status !== "completed") return { kind: "fail", message: `The ${what} ${job.status}${text(job.error_message) ? `: ${text(job.error_message)}` : "."}` }
  return null
}

/** What the erase dropped and left (`coverage` of the erased mask, `droppedRegions` its erased regions). */
export function eraseStatsOf(erase: VariantStepJob | null): { coverage: number; erasedRegions: number } {
  const out = rec(erase?.output_data)
  return { coverage: count(out.coverage), erasedRegions: count(out.droppedRegions) }
}

/**
 * The variant's next step, from its erase job and (once asked for) its make
 * job; `frames` is the approved mask's frame count, which every step must
 * keep (a mark's frames are the clip's).
 */
export function nextVariantStep(
  record: Pick<TrendFaceMaskVariantJob, "eraseJobId" | "makeJobId">,
  erase: VariantStepJob | null,
  make: VariantStepJob | null,
  frames: number,
  /** Whether the erase was sent keep or eraseAlways boxes (its result must then say `keptRegions`). */
  listsSent = false,
): VariantStep {
  if (!record.eraseJobId) return { kind: "erase" }
  const notYet = unfinished(erase, "mask erase")
  if (notYet) return notYet
  const out = rec(erase!.output_data)
  const stats = eraseStatsOf(erase)
  if (listsSent && !(typeof out.keptRegions === "number" && Number.isFinite(out.keptRegions))) {
    return { kind: "fail", message: "The mask erase ran on a worker that does not keep faces: make the person masks again once it is updated." }
  }
  // Every face erased: nothing left to cover (the job says so exactly with `kept`; `coverage` is rounded).
  if (out.kept === false || (out.kept === undefined && stats.coverage === 0)) return { kind: "nothing_left", stats }
  if (out.frames !== undefined && out.frames !== frames) {
    return { kind: "fail", message: `The erased mask has ${String(out.frames)} frames, not the clip's ${frames}.` }
  }
  const maskUrl = text(out.videoUrl)
  if (!maskUrl) return { kind: "fail", message: "The mask erase returned no mask." }
  if (!record.makeJobId) return { kind: "make", maskUrl }

  const notMade = unfinished(make, "face mask fill")
  if (notMade) return notMade
  const made = rec(make!.output_data)
  const maskedUrl = text(made.maskedUrl)
  // The fill of a mask with something on it never finds "no faces"; if it does, nothing is covered.
  if (!maskedUrl) return made.reason === "no_faces" ? { kind: "nothing_left", stats } : { kind: "fail", message: "The face mask fill returned no clip." }
  if (made.frames !== frames) return { kind: "fail", message: `The person mask has ${String(made.frames)} frames, not the clip's ${frames}.` }
  return { kind: "done", maskedUrl, stats }
}
