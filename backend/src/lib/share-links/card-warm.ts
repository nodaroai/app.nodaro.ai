/**
 * A link turned on gets its card's picture rendered at once (card-image/), so
 * the picture is usually ready before anyone pastes the link: the first
 * preview a chat keeps is then the real one. Best effort, in the background:
 * the caller never waits, and a failure is only logged.
 */
import { readShareCardContent } from "./card-reads.js"
import { startCardRender } from "./card-image/service.js"
import type { ShareLinkRow } from "./types.js"

/** Starts rendering the card picture of a live link. Resolves once done; never rejects. */
export async function warmShareCard(share: ShareLinkRow): Promise<void> {
  if (share.revoked_at !== null) return
  try {
    const content = await readShareCardContent(share)
    if (content?.picture) await startCardRender(share.token, content.picture)
  } catch (err) {
    console.error("[share-card] preparing a card picture failed:", err instanceof Error ? err.message : err)
  }
}
