import { r2KeyFromOurUrl } from "../../storage.js"
import { importImageFromUrl } from "../../media-import.js"
import type { ImportedInput } from "./flow-graph.js"
import type { FlowNodeInput } from "./node-mappers.js"

/** At most this many outside images are stored per call (a call carries a few references at most). */
const MAX_IMPORTS_PER_CALL = 8

/**
 * Store the outside images a call used in the user's files, so the flow's
 * upload nodes keep working when the original link dies. An image already on
 * Nodaro's storage, a video or audio link, or an import that fails is left as
 * the link it was: the node still shows it, and the generation is never
 * affected (it already ran with the link).
 */
export async function importOutsideImages(
  userId: string,
  inputs: readonly FlowNodeInput[],
): Promise<Map<string, ImportedInput>> {
  const outside = inputs.filter((i) => i.kind === "image" && r2KeyFromOurUrl(i.url) === null).slice(0, MAX_IMPORTS_PER_CALL)
  const results = await Promise.all(
    outside.map(async (input) => {
      try {
        const imported = await importImageFromUrl(userId, input.url)
        return imported.ok
          ? ([input.url, { url: imported.url, assetId: imported.assetId, thumbnailUrl: imported.thumbnailUrl }] as const)
          : null
      } catch {
        return null
      }
    }),
  )
  return new Map(results.filter((r): r is NonNullable<typeof r> => r !== null))
}
