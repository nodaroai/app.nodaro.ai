import { getApifyClient, sanitizeApifyError } from "./client.js"
import { MissingProviderKeyError } from "../provider-keys.js"
import { ACTORS, buildActorInput, extractActorOutput, type ActorArgs, type ActorOutput } from "./actors.js"
import { startOrResumeActorRun, type ApifyRunHooks } from "./run.js"

/** `hooks`: save the run as it starts, or wait on one this job already started (run.ts). */
export async function runScraper(args: ActorArgs, hooks: ApifyRunHooks = {}): Promise<ActorOutput> {
  const def = ACTORS[args.actor]
  const input = buildActorInput(args)

  try {
    const client = getApifyClient()
    const run = await startOrResumeActorRun(client, def.apifyActorId, input, {}, def.timeoutSecs, hooks)
    const { items } = await client
      .dataset((run as { defaultDatasetId: string }).defaultDatasetId)
      .listItems()
    return extractActorOutput(args.actor, items as Record<string, unknown>[])
  } catch (err) {
    // A missing-key error already says exactly what to do; the sanitizer's
    // catch-all would rewrite it to "check the URL" and send a self-hoster
    // chasing a problem that isn't theirs (community grind, 2026-08-13).
    if (err instanceof MissingProviderKeyError) throw err
    throw sanitizeApifyError(err, args.actor)
  }
}
