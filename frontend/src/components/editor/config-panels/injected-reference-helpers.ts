/**
 * Helpers used by the 10 consumer config panels to wire the unified
 * `<InjectedReferenceList>` into the workflow store + node data.
 *
 * Each helper is a pure function that produces the callback the component
 * needs. Keeping these out of the per-node config files lets us share the
 * exact same remove-mention-token regex and edge-deletion logic across
 * generate-image, image-to-video, lip-sync, etc.
 */

import type { WorkflowEdge } from "@/types/nodes"

/**
 * Strip a single `@-mention` token literal (e.g. `@kira:1:smile:face`) from
 * a prompt string. Tries to also remove a leading or trailing space so we
 * don't leave double spaces. Returns the rewritten prompt; if the token
 * isn't found, returns the original prompt unchanged.
 *
 * NB: tokens are removed as exact-literal matches (the user-typed source
 * string), not via the parsed slug — this preserves any non-canonical
 * casing in the displayed prompt UI (though valid mention tokens are
 * lowercase by construction).
 */
export function removeMentionToken(prompt: string, token: string): string {
  if (!token || !prompt.includes(token)) return prompt
  // Try " <token> " → " "  (single-space replacement, prevents double space).
  const withSpaces = ` ${token} `
  if (prompt.includes(withSpaces)) return prompt.split(withSpaces).join(" ")
  // Try " <token>" or "<token> " at the boundaries.
  const trailing = `${token} `
  if (prompt.startsWith(trailing)) return prompt.slice(trailing.length)
  const leading = ` ${token}`
  if (prompt.endsWith(leading)) return prompt.slice(0, prompt.length - leading.length)
  // Fall through: replace bare token.
  return prompt.split(token).join("")
}

/**
 * Build a callback that removes ALL edges pointing FROM `sourceNodeId` TO the
 * consumer node. The InjectedReferenceList × button calls this for wired-raw
 * tiles. We loop because there may be multiple edges into different handles
 * for the same source (e.g. character → references + character → image).
 */
export function makeRemoveWiredSource(
  consumerNodeId: string,
  edges: readonly WorkflowEdge[],
  deleteEdge: (edgeId: string) => void,
): (sourceNodeId: string) => void {
  return (sourceNodeId: string) => {
    const matchingEdges = edges.filter(
      (e) => e.source === sourceNodeId && e.target === consumerNodeId,
    )
    for (const e of matchingEdges) deleteEdge(e.id)
  }
}

/**
 * Add a character slug to the consumer node's `suppressedCanonicalCharacterIds`
 * array (the user has clicked × on the canonical-fallback tile). Dedupes — if
 * the slug is already in the list, the update is a no-op.
 */
export function appendSuppressedSlug(
  current: readonly string[] | undefined,
  slug: string,
): readonly string[] {
  if (current && current.includes(slug)) return current
  return [...(current ?? []), slug]
}
