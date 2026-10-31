// backend/src/lib/concurrency-lanes/handoff.ts — a job hands its slot over
// before another worker takes the same job over (the add-captions burn
// enqueues a `render` job under the SAME jobs.id). The lease is released with
// outcome `handoff` BEFORE the other job is enqueued: the gate keeps one lease
// per job id and line, so a render picked up while the video job still held
// its lease would be handed that lease, and the video job's own release would
// then free the slot the render is running in.
//
// No imports: the handlers reach it without pulling in the admission module.

type HandOff = () => Promise<void>

/** jobId → the running admission's hand-off, in this process. */
const running = new Map<string, HandOff>()

/** For the admission: while `jobId` runs here, `handOff` releases its slot as `handoff`. Returns the unregister. */
export function registerSlotHandOff(jobId: string, handOff: HandOff): () => void {
  running.set(jobId, handOff)
  return () => {
    if (running.get(jobId) === handOff) running.delete(jobId)
  }
}

/**
 * Release the slot `jobId` runs under, as handed over to another worker. A
 * no-op when the job holds no slot in this process (it runs ungated, borrows
 * its parent's, or holds none). Never throws; the job's own release later is a
 * no-op.
 */
export async function handOffConcurrencySlot(jobId: string): Promise<void> {
  const handOff = running.get(jobId)
  if (!handOff) return
  try {
    await handOff()
  } catch (err) {
    console.warn(`[concurrency-lanes] could not hand over the slot of job ${jobId}: ${(err as Error)?.message ?? String(err)}`)
  }
}
