import { getApifyClient, sanitizeApifyError } from "./client.js"
import { ACTORS, buildActorInput, extractActorOutput, type ActorArgs, type ActorOutput } from "./actors.js"

export async function runScraper(args: ActorArgs): Promise<ActorOutput> {
  const def = ACTORS[args.actor]
  const input = buildActorInput(args)

  try {
    const client = getApifyClient()
    const run = await client
      .actor(def.apifyActorId)
      .call(input, { waitSecs: def.timeoutSecs })
    const { items } = await client
      .dataset((run as { defaultDatasetId: string }).defaultDatasetId)
      .listItems()
    return extractActorOutput(args.actor, items as Record<string, unknown>[])
  } catch (err) {
    throw sanitizeApifyError(err, args.actor)
  }
}
