/**
 * What a share card says about a live link (card.ts): read exactly as the
 * link's public read is (`public-reads.ts`), so the card never says more than
 * the link shows, and says nothing once the link would answer 404.
 */
import { config } from "../config.js"
import { r2KeyFromPublicUrl } from "../r2-public-key.js"
import { redactPrivateJobOutput } from "../public-job-data.js"
import { findOwnerJob, isRestrictedAddress } from "./job-reads.js"
import { ownerSession, readPublicShare, sessionSummaries, sharedJobOf } from "./public-reads.js"
import { jobCardContent, projectCardContent, sessionCardContent, type CardSources, type ShareCardContent } from "./card.js"
import { cardLocaleOf } from "./card-locale.js"
import type { ShareLinkRow } from "./types.js"

/** How a card judges an address: ours when it is on this install's storage; a restricted one is never named. */
export const CARD_SOURCES: CardSources = {
  isOurs: (url) => r2KeyFromPublicUrl(url, config.R2_PUBLIC_URL) !== null,
  refuse: isRestrictedAddress,
}

/** The card of a live link, or null when its item is gone or may not be shown. */
export async function readShareCardContent(share: ShareLinkRow): Promise<ShareCardContent | null> {
  const locale = cardLocaleOf(share.locale)
  if (share.kind === "job") {
    const row = await findOwnerJob(share.owner_id, share.target_id)
    // A card never hands out references, whatever the link allows.
    const job = row ? sharedJobOf(row, false) : null
    return row && job ? jobCardContent(job, redactPrivateJobOutput(row.output_data), CARD_SOURCES, locale) : null
  }
  if (share.kind === "session") {
    const session = await ownerSession(share.owner_id, share.target_id)
    if (!session) return null
    const summary = (await sessionSummaries([session.id])).get(session.id)
    return sessionCardContent(session.title, summary?.itemCount ?? 0, summary?.previewUrls ?? [], CARD_SOURCES, locale)
  }
  const shown = await readPublicShare(share)
  if (!shown?.project) return null
  const covers = shown.project.sessions.map((s) => s.coverUrl).filter((u): u is string => !!u)
  return projectCardContent(shown.project.name, shown.project.sessions.length, covers, CARD_SOURCES, locale)
}
