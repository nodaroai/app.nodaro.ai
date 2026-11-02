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
 *    it. An import through a key or an agent (`via`) that carries no
 *    confirmation spends one DERIVED from the account's standing authorization
 *    (migration 579) — the one the read half found — so every such import is
 *    recorded like a ticked box. It answers the confirmation the download runs
 *    under (the derived one included), for the file's record; null when none.
 *
 * Every engine that fetches a link (`video-download.ts`, the worker's
 * `downloadAudioToR2`, `youtube-extractor.ts`) takes an `ImportRights` and
 * calls both halves itself, so a caller cannot forget: the compiler names a
 * call without one, and `import-gate-totality.test.ts` names a new yt-dlp
 * lane that does not run through an engine.
 */
import {
  ContentRightsError,
  checkRightsConfirmation,
  consumeRightsConfirmation,
  contentRightsRequired,
  coversStandingAuthorization,
  deriveAndConsumeConfirmation,
  type ImportVia,
  type RightsLane,
} from "./content-rights.js"
import { ImportSourceError, assertImportSourceAllowed } from "./import-source-policy.js"

/** Who imports, under which confirmation, from which lane. */
export interface ImportRights {
  readonly userId: string
  /** The confirmation (`POST /v1/content-rights/confirm`) this import is made under; optional until `content_rights_required` is on. */
  readonly confirmationId?: string | null
  readonly lane: RightsLane
  readonly requestId?: string | null
  /** How the import was reached (`lib/import-via.ts`): a key's or an agent's import stands on a standing authorization. */
  readonly via?: ImportVia | null
  /** The connected app and its grant, when the import came through one: recorded on a derived confirmation. */
  readonly appId?: string | null
  readonly authorizationId?: string | null
}

export type ImportRefusal = ImportSourceError | ContentRightsError

/** True for a refusal the gate itself made (a 403 to a client, a `failed` download to a run). */
export function isImportRefusal(e: unknown): e is ImportRefusal {
  return e instanceof ImportSourceError || e instanceof ContentRightsError
}
/** The read half: throws an `ImportRefusal` when the link may not be imported by this account now. */
export async function requireImportAllowed(url: string, rights: ImportRights): Promise<void> {
  await assertImportSourceAllowed(url)
  await checkRightsConfirmation({ url, userId: rights.userId, confirmationId: rights.confirmationId, lane: rights.lane, via: rights.via ?? null })
}

/**
 * The write half: spends the confirmation on the download that starts now —
 * the one sent, or one derived from a standing authorization for a key's or
 * an agent's import — and answers it; null when the download runs under none.
 */
export async function spendImportConfirmation(url: string, rights: ImportRights): Promise<string | null> {
  if (rights.confirmationId) {
    await consumeRightsConfirmation({ confirmationId: rights.confirmationId, url, lane: rights.lane, requestId: rights.requestId ?? null })
    return rights.confirmationId
  }
  if (!coversStandingAuthorization(rights.via)) return null
  const derived = await deriveAndConsumeConfirmation({
    userId: rights.userId,
    url,
    via: rights.via as ImportVia,
    requestId: rights.requestId ?? null,
    appId: rights.appId ?? null,
    authorizationId: rights.authorizationId ?? null,
  })
  // The authorization the read half found is gone (revoked, or the declaration
  // changed, while the download waited for its slot): the write half refuses
  // what the read half would now refuse, so no import runs unrecorded.
  if (derived === null && (await contentRightsRequired())) {
    throw new ContentRightsError(
      "rights_authorization_required",
      "Imports through API keys and agents need a standing authorization of the content rights declaration: authorize them in Settings, or confirm the link first.",
    )
  }
  return derived
}
