/**
 * Ownership by KEY FAMILY. Every deliverable this platform writes is
 * `<prefix>/<jobId>.<ext>` — `images/`, `videos/`, `audios/` (mediaObjectKey),
 * plus `thumbnails/`, `reference-sheets/` and `lottie/` — and everything a job
 * writes ALONGSIDE its deliverable suffixes that same stem: `variantJobId` is
 * `<jobId>-v<i>`, and a plugin's intermediates are `<jobId>-seg1`,
 * `<jobId>-seg3-lastframe`, `<jobId>-seg2-anchor-start`, `<jobId>-video-audio`
 * and so on. So the family is the STEM PREFIX `<jobId>-`, and it is
 * prefix-agnostic on purpose: a new deliverable prefix — or a new suffix an
 * engine invents next week — inherits the rule instead of silently leaking.
 *
 * The `-` is load-bearing twice over. It keeps `job-10` out of `job-1`'s
 * family (a bare `startsWith(jobId)` would swallow it), and because every
 * engine builds its stems from the RUNNING job's own id, a continuation's
 * `<parentJobId>-segN` stays the PARENT's object: a child's block must not
 * delete the deliverable of a job that completed. Job ids are UUIDs, so a
 * `<jobId>-` prefix cannot collide with another job's id.
 */
export function isOwnedObjectKey(jobId: string, key: string): boolean {
  if (!jobId) return false
  const stem = keyStem(key)
  return stem === jobId || stem.startsWith(`${jobId}-`)
}

/** An object key's STEM: basename, extension removed. The half of the family
 *  rule that both `isOwnedObjectKey` ("does this key belong to job X?") and
 *  `objectKeyJobIdCandidates` ("which job could have written this key?") are
 *  built from — one implementation, so the fence and the family rule cannot
 *  drift apart. */
export function keyStem(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}
