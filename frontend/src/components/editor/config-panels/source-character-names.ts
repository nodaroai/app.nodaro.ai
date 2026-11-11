import {
  characterMentionSlug,
  characterOwnName,
  wiredCharacterBySlug,
  wiredCharacterNames,
  type ExtraRefCharacterContext,
  type WiredCharacterName,
} from "@nodaro/shared/entities"
import { characterLockToRefLock } from "@nodaro/prompts/doctrine"
import type { CharacterNodeData, WorkflowNode } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

/** The node a source's wire carries (a Teleport Receive's origin), else the node it was drawn from. */
export function sourceOriginId(s: SourceNodeInfo): string {
  return s.originId ?? s.id
}

/**
 * What each Character node wired into a panel's node is called — the rule the
 * editor's Run and the workflow run read (`wiredCharacterNames`), over the
 * panel's sources in wire order and keyed by the ORIGIN node id, so a preview
 * names every character exactly as the run will ("Character 1", "Character 2",
 * … for unnamed nodes). Pass ALL the node's sources, frame wires included: the
 * run numbers over every wire.
 */
export function sourceCharacterNames(sources: ReadonlyArray<SourceNodeInfo>): Map<string, WiredCharacterName> {
  return wiredCharacterNames(
    sources.map((s) => ({ key: sourceOriginId(s), type: s.type, sourceHandle: s.sourceHandle, data: s.nodeData })),
  )
}

/**
 * The extra-reference character context for a slug: the wired character with
 * that slug (named as the run names it), else a named Character node anywhere
 * on the canvas whose own name slugifies to it.
 */
export function characterContextLookup(
  names: ReadonlyMap<string, WiredCharacterName>,
  nodes: ReadonlyArray<WorkflowNode>,
): (slug: string) => ExtraRefCharacterContext | undefined {
  return (slug) => {
    if (!slug) return undefined
    const wired = wiredCharacterBySlug(names, slug)
    const node = wired
      ? nodes.find((n) => n.id === wired.key)
      : nodes.find((n) => n.type === "character" && characterMentionSlug(characterOwnName(n.data)) === slug)
    if (!node) return undefined
    const cd = node.data as CharacterNodeData
    return {
      defaultUsageMode: cd.defaultUsageMode,
      canonicalDescription: cd.canonicalDescription ?? null,
      displayName: wired?.named.name ?? characterOwnName(cd),
      defaultRole: cd.defaultRole,
      identityLock: characterLockToRefLock(cd.identityLock),
    }
  }
}
