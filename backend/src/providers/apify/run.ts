/**
 * Start an Apify actor run — or wait on one already started — and save it the
 * moment it exists. `ActorClient.call()` starts and waits in one step, so an
 * interrupted caller cannot know the run it started; this is the same two
 * steps (`start`, then `run(id).waitForFinish`) with the run's id handed to
 * the caller in between, and a caller that already has one skips the start.
 *
 * A run whose id cannot be saved is aborted (best effort) and the error
 * thrown: the job then fails, never left running unrecoverable.
 */
import type { ActorRun, ActorStartOptions, ApifyClient } from "apify-client"

export interface ApifyRunHooks {
  /** A run this job already started: wait on it, start none. */
  readonly resumeRunId?: string
  /**
   * Called with a run's id as soon as it started, before the wait. It may
   * answer another run's id — one this job saved first — which is then waited
   * on and this run aborted. A throw gives the run up.
   */
  readonly onRunStarted?: (runId: string) => Promise<string | void>
}

export async function startOrResumeActorRun(
  client: ApifyClient,
  actorId: string,
  input: unknown,
  startOptions: ActorStartOptions,
  waitSecs: number,
  hooks: ApifyRunHooks = {},
): Promise<ActorRun> {
  if (hooks.resumeRunId) return client.run(hooks.resumeRunId).waitForFinish({ waitSecs })
  const started = await client.actor(actorId).start(input, startOptions)
  let runId = started.id
  if (hooks.onRunStarted) {
    try {
      runId = (await hooks.onRunStarted(started.id)) || started.id
    } catch (err) {
      await client.run(started.id).abort().catch(() => undefined)
      throw err
    }
    // Another attempt of this job saved its run first: that one is the job's.
    if (runId !== started.id) await client.run(started.id).abort().catch(() => undefined)
  }
  return client.run(runId).waitForFinish({ waitSecs })
}
