import { wiredCharacterNamesOf, type ExtraRefCharacterContext } from "@nodaro/shared/entities"
import { characterLockToRefLock } from "@nodaro/prompts/doctrine"
import type { CharacterNodeData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * Build a `slug → ExtraRefCharacterContext` lookup for the consumer node from
 * the Character nodes wired into it. Used by the extra-ref expansion
 * (`expandExtraRefsToConnectedReferences`) so character-sourced extras inherit
 * `defaultUsageMode` + `canonicalDescription` from the upstream Character node
 * when the user-typed extra ref doesn't override.
 *
 * The same loop as the workflow run's (`buildExtraRefCharacterContextLookup` in
 * payload-builder.ts): the wired characters only, named by
 * `wiredCharacterNamesOf`, the first node of a character in wire order giving
 * its settings. A node wired only by its plain image pip is no character, so it
 * never supplies them (decided 2026-11-13) — before, it could, when its edge
 * came first, and the editor's Run then read another node's settings than the
 * workflow run.
 *
 * Returns a function that takes a slug and returns the upstream context, or
 * `undefined` if no character matching that slug is wired (e.g. the user
 * disconnected the character after attaching the extra — the extra still
 * carries the slug + URL, but inherits nothing).
 */
export function buildExtraRefCharacterContextLookup(
  consumerNodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): (slug: string) => ExtraRefCharacterContext | undefined {
  const bySlug = new Map<string, ExtraRefCharacterContext>()
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  for (const [id, named] of wiredCharacterNamesOf(consumerNodeId, nodes, edges)) {
    const upstream = byId.get(id)
    if (!upstream || !named.slug || bySlug.has(named.slug)) continue
    const charData = upstream.data as CharacterNodeData
    bySlug.set(named.slug, {
      defaultUsageMode: charData.defaultUsageMode,
      canonicalDescription: charData.canonicalDescription ?? null,
      displayName: named.name,
      defaultRole: charData.defaultRole,
      identityLock: characterLockToRefLock(charData.identityLock),
    })
  }
  return (slug) => bySlug.get(slug)
}
