/**
 * The content rights box of a node whose OWN link a run hands to a service that
 * fetches it itself — the Dubbing node's Source link — as this page holds it:
 * which node is ticked, for which link. The contract of the Video URL node's box
 * (`video-link-rights.ts`): SESSION state, never node data and never saved, so a
 * workflow saved ticked cannot let the next person's Run confirm for them; every
 * box starts unticked when another workflow opens; a confirmation is one fetch's,
 * made when the run that hands the link on starts.
 *
 * Readers: the node's panel (the box), the editor's pre-run gate (a link whose
 * box is not ticked stops the run before anything starts), the browser's own run
 * of the node (it confirms right before its request) and every server run the
 * editor starts (`withNodeLinkRightsConfirmations`: one confirmation per node,
 * sent as the node's `rightsConfirmationId` in that run's overrides).
 */
import { useSyncExternalStore } from "react"
import { DeclarationChangedError, confirmLink } from "@/lib/content-rights"
import { onDeclarationChanged } from "@/lib/declaration-changes"
import { tx } from "@/lib/i18n"

/** The node types whose own link a run hands on to be fetched, and the field holding it. */
const LINK_FIELD_BY_TYPE: ReadonlyMap<string, string> = new Map([["dubbing", "sourceUrl"]])

export interface LinkRightsNode {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}

type Overrides = Readonly<Record<string, Readonly<Record<string, unknown>>>>

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function fieldOf(type: string | undefined): string | undefined {
  return type === undefined ? undefined : LINK_FIELD_BY_TYPE.get(type)
}

/** The node's own link a run hands on, or "" (another type, or no link). */
export function nodeLinkOf(node: LinkRightsNode): string {
  const field = fieldOf(node.type)
  if (!field) return ""
  return text((node.data as Record<string, unknown> | undefined)?.[field])
}

const ticked = new Map<string, string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Tick the box for `link` on this node; an empty link unticks. */
export function tickNodeLinkRights(nodeId: string, link: string): void {
  const url = link.trim()
  const was = ticked.get(nodeId)
  if (url !== "") ticked.set(nodeId, url)
  else ticked.delete(nodeId)
  if (ticked.get(nodeId) !== was) notify()
}

export function untickNodeLinkRights(nodeId: string): void {
  if (!ticked.delete(nodeId)) return
  notify()
}

/** Whether the box is ticked for exactly this link on this node. */
export function isNodeLinkRightsTicked(nodeId: string, link: string): boolean {
  const url = link.trim()
  return url !== "" && ticked.get(nodeId) === url
}

export function subscribeNodeLinkRights(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The box's state for a node and link, re-rendered when it changes. */
export function useNodeLinkRightsTicked(nodeId: string, link: string): boolean {
  return useSyncExternalStore(
    subscribeNodeLinkRights,
    () => isNodeLinkRightsTicked(nodeId, link),
    () => false,
  )
}

/** Every box unticked: another workflow, another account, a changed declaration, a test. */
export function clearNodeLinkRights(): void {
  if (ticked.size === 0) return
  ticked.clear()
  notify()
}

// Every box was ticked under the text a changed declaration replaced.
onDeclarationChanged(clearNodeLinkRights)

/**
 * Records the confirmation for `link` on this node, now (one fetch's), and
 * answers its id. A changed declaration unticks the box, and every other box
 * with it (the person must see the new text and tick again), and throws, as
 * does any refusal.
 */
export async function confirmNodeLink(nodeId: string, link: string): Promise<string> {
  try {
    return (await confirmLink(link)).id
  } catch (err) {
    if (err instanceof DeclarationChangedError) untickNodeLinkRights(nodeId)
    throw err
  }
}

function labelOf(node: LinkRightsNode): string {
  const label = text((node.data as Record<string, unknown> | undefined)?.label)
  return label || "Dubbing"
}

/**
 * Whether a run that reaches this node hands its own link on under a box on
 * this canvas: not a frozen node (`data.skipped`: a run reads its result and
 * never runs it), and not a sub-workflow's node (`__sub_…`: its box is in the
 * sub-workflow's own editor, so it sends no confirmation and the server
 * answers it as any request without one).
 */
export function hasOwnLinkBox(node: LinkRightsNode): boolean {
  if (node.id.startsWith("__sub_")) return false
  return (node.data as { skipped?: unknown } | undefined)?.skipped !== true
}

/**
 * The first node about to run (`scopeIds`; `null` = every node) whose own link
 * the run would hand on with its box not ticked for that link — what the
 * pre-run gate stops on — or null.
 */
export function findUnconfirmedNodeLink(
  nodes: readonly LinkRightsNode[],
  scopeIds: readonly string[] | null,
): { readonly nodeId: string; readonly label: string } | null {
  const scope = scopeIds === null ? null : new Set(scopeIds)
  for (const node of nodes) {
    if ((scope && !scope.has(node.id)) || !hasOwnLinkBox(node)) continue
    const link = nodeLinkOf(node)
    if (!link || isNodeLinkRightsTicked(node.id, link)) continue
    return { nodeId: node.id, label: labelOf(node) }
  }
  return null
}

/**
 * A server run's overrides with a confirmation for every node about to run
 * (`scopeIds`; `null` = every node) whose own link it hands on (the request's
 * own override of the link wins over the saved one). Confirmed now, for this
 * run, as the node's `rightsConfirmationId`. A node with no link gets nothing.
 * A link whose box is not ticked for it throws, naming the node, before any
 * link is confirmed, and the run does not start: the pre-run gate stops a run
 * for the saved link first, so this is a link the gate did not see. A
 * confirmation the server refuses throws too; a changed declaration also
 * unticks every box.
 */
export async function withNodeLinkRightsConfirmations(
  nodes: readonly LinkRightsNode[],
  scopeIds: readonly string[] | null,
  overrides: Overrides | undefined,
): Promise<Overrides | undefined> {
  const scope = scopeIds === null ? null : new Set(scopeIds)
  const handed = nodes.flatMap((node) => {
    const field = fieldOf(node.type)
    if (!field || (scope && !scope.has(node.id)) || !hasOwnLinkBox(node)) return []
    const own = overrides?.[node.id]
    const link = own && field in own ? text(own[field]) : nodeLinkOf(node)
    return link ? [{ node, link }] : []
  })
  // Every box is asked before any link is confirmed: a run that stops leaves no confirmation behind.
  const unticked = handed.find(({ node, link }) => !isNodeLinkRightsTicked(node.id, link))
  if (unticked) throw new Error(tx("run.videoLinkConfirm", { label: labelOf(unticked.node) }))
  let out = overrides
  for (const { node, link } of handed) {
    const rightsConfirmationId = await confirmNodeLink(node.id, link)
    out = { ...out, [node.id]: { ...out?.[node.id], rightsConfirmationId } }
  }
  return out
}
