/**
 * A dub's `sourceUrl` is handed to the dubbing service, which fetches it
 * itself: an import of that link, held to the content rights gate like the
 * Video URL node's own download (which holds a video's page and a direct
 * video file alike). Only a file of this install's own storage is not
 * someone else's link. Not a rule by the look of the link: a page on a
 * platform can end in `.mp4` and still be fetched as that platform's page.
 * One rule for the route and for a run.
 */
import { hasUrlParserHazard } from "@nodaro/shared/video"
import { isOwnStoredFileUrl } from "./own-storage-url.js"
import { isImportRefusal, requireImportAllowed } from "./import-gate.js"
import type { ImportVia } from "./content-rights.js"
import { UNUSABLE_LINK_MESSAGE } from "./unusable-link.js"
import { PROJECT_DUBBING_NEEDS_UPLOAD, dubsAsProject } from "./dubbing-model.js"

/** True when a dub's source link is an import the gate holds: every link but a file of our own storage. */
export function dubbingSourceIsImport(sourceUrl: string): boolean {
  return !isOwnStoredFileUrl(sourceUrl)
}

/**
 * The request a run's dub of a link spends its confirmation under: the run and
 * the node. A repeated node dubs its one link (its own Source link, the same
 * in every iteration) once per iteration, all under the one confirmation the
 * run carries for the node, and a retry of any of them is the same request.
 * Null for a dub with no link of its own.
 */
export function dubbingRunImportRequest(jobName: string, payload: Record<string, unknown>, executionId: string, nodeId: string): string | null {
  if (jobName !== "dubbing" || typeof payload.sourceUrl !== "string" || !payload.sourceUrl) return null
  return `${executionId}:${nodeId}`
}

/**
 * A run's dub of a link (node-executor), answered before the link is probed:
 * a link two URL parsers would read differently is refused, and a link that
 * is not a file of ours is held to the gate (read) with the confirmation the
 * run's own request put on the node and the run's way in; the worker spends
 * it right before the service is asked. The refusal, or null when the source
 * may be handed on.
 */
export async function dubbingSourceRefusal(
  jobName: string,
  payload: Record<string, unknown>,
  account: { readonly userId: string; readonly via: ImportVia | null },
): Promise<{ code: string; message: string } | null> {
  if (jobName !== "dubbing") return null
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl : ""
  if (!sourceUrl) return null
  if (hasUrlParserHazard(sourceUrl)) return { code: "validation_error", message: UNUSABLE_LINK_MESSAGE }
  // A dub into Hebrew takes an uploaded file only: refused before the gate, so
  // no confirmation is read or spent for a dub that cannot start.
  if (dubsAsProject(payload.targetLanguage)) return { code: "unsupported_dubbing_settings", message: PROJECT_DUBBING_NEEDS_UPLOAD }
  if (!dubbingSourceIsImport(sourceUrl)) return null
  try {
    await requireImportAllowed(sourceUrl, {
      userId: account.userId,
      confirmationId: typeof payload.confirmationId === "string" ? payload.confirmationId : null,
      lane: "run",
      via: account.via,
    })
    return null
  } catch (e) {
    if (isImportRefusal(e)) return { code: e.code, message: e.message }
    throw e
  }
}
