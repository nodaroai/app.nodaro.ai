/**
 * The ONE gate every import of a link passes (decided 2026-11-02): the site's
 * policy (`import-source-policy.ts`) and the content rights confirmation
 * (`content-rights.ts`), in that order, read before anything else can refuse
 * the import; then the confirmation is spent right before the bytes move.
 *
 * Two halves on purpose, like the rights module beneath them:
 *  - `requireImportAllowed` READS: refuses a disabled site, a missing
 *    confirmation while the deployment requires one, or a confirmation that
 *    does not fit the link and the account. Nothing is written.
 *  - `spendImportConfirmation` WRITES: marks the confirmation used, once the
 *    download is about to start and nothing else can refuse it (slot held,
 *    address resolved), so a spent confirmation always has a download behind
 *    it. Without a confirmation id it does nothing.
 *
 * Every engine that fetches a link (`video-download.ts`, the worker's
 * `downloadAudioToR2`, `youtube-extractor.ts`) takes an `ImportRights` and
 * calls both halves itself, so a caller cannot forget: the compiler names a
 * call without one, and `import-gate-totality.test.ts` names a new yt-dlp
 * lane that does not run through an engine.
 */
import { ContentRightsError, checkRightsConfirmation, consumeRightsConfirmation, type RightsLane } from "./content-rights.js"
import { ImportSourceError, assertImportSourceAllowed } from "./import-source-policy.js"

/** Who imports, under which confirmation, from which lane. */
export interface ImportRights {
  readonly userId: string
  /** The confirmation (`POST /v1/content-rights/confirm`) this import is made under; optional until `content_rights_required` is on. */
  readonly confirmationId?: string | null
  readonly lane: RightsLane
  readonly requestId?: string | null
}

export type ImportRefusal = ImportSourceError | ContentRightsError

/** True for a refusal the gate itself made (a 403 to a client, a `failed` download to a run). */
export function isImportRefusal(e: unknown): e is ImportRefusal {
  return e instanceof ImportSourceError || e instanceof ContentRightsError
}
/** The read half: throws an `ImportRefusal` when the link may not be imported by this account now. */
export async function requireImportAllowed(url: string, rights: ImportRights): Promise<void> {
  await assertImportSourceAllowed(url)
  await checkRightsConfirmation({ url, userId: rights.userId, confirmationId: rights.confirmationId, lane: rights.lane })
}

/** The write half: spends the confirmation on the download that starts now; nothing without one. */
export async function spendImportConfirmation(url: string, rights: ImportRights): Promise<void> {
  if (!rights.confirmationId) return
  await consumeRightsConfirmation({ confirmationId: rights.confirmationId, url, lane: rights.lane, requestId: rights.requestId ?? null })
}
