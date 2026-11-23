/**
 * What a view link's preview card says (card.ts), read from the public
 * projection only, and the warm-up that renders its picture when the link is
 * turned on, so it is usually ready before anyone pastes the link.
 */
import { CARD_SOURCES } from "../share-links/card-reads.js"
import { workflowCardContent, type ShareCardContent } from "../share-links/card.js"
import { cardLocaleOf } from "../share-links/card-locale.js"
import { startCardRender } from "../share-links/card-image/service.js"
import { projectWorkflowView } from "./project.js"
import { viewCardPictures, viewCardText, viewStepCount } from "./card.js"
import type { LiveViewLink } from "./store.js"

export interface ViewCardRead {
  readonly content: ShareCardContent
  readonly text: readonly string[]
}

/** The key the card's rendered picture is stored under: its own namespace, never a share link's token. */
export function viewCardKeyToken(token: string): string {
  return `workflow-view:${token}`
}

export async function readViewCard(live: LiveViewLink): Promise<ViewCardRead> {
  const { workflow, link } = live
  const projection = await projectWorkflowView({ nodes: workflow.nodes, edges: workflow.edges, settings: workflow.settings, ownerId: workflow.user_id })
  // Only files on our own storage: the server never fetches an address the owner typed to draw a card.
  const pictures = viewCardPictures(projection.nodes).filter((url) => CARD_SOURCES.isOurs(url))
  const content = workflowCardContent(workflow.name, viewStepCount(projection.nodes), pictures, CARD_SOURCES, cardLocaleOf(link.locale))
  return { content, text: viewCardText(projection.nodes) }
}

/** Renders the card's picture in the background. Never throws. */
export async function warmViewCard(live: LiveViewLink): Promise<void> {
  try {
    const { content } = await readViewCard(live)
    if (content.picture) await startCardRender(viewCardKeyToken(live.link.token), content.picture)
  } catch (err) {
    console.error("[workflow-view] warming the card failed:", err instanceof Error ? err.message : err)
  }
}
