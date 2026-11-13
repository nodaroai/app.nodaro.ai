import { getRouteReachableNodeIds, isExpandedClone } from "@nodaro/shared/workflow"
import type { TtsReplica } from "@nodaro/shared/models"
import type { DialogueSpeakerDirection, ReplicaConsentRecord, WorkflowNode } from "@/types/nodes"
import { cloneRunProblem } from "./voice-clone"

/**
 * A one-off voice clone in someone else's graph — a published app, a share
 * link — is the RUNNER's input (decided 2026-11-13): the graph ships with every
 * clone's recordings emptied and no consent, and the server refuses a run until
 * the runner supplies their own two recordings and their own signed consent in
 * the run's `inputOverrides`. Text to Speech node `N`: `{ replica,
 * replicaConsent }` on `N`. Text to Dialogue node `D`: its whole `speakers`
 * list, each cloned speaker with the runner's `replica` and `replicaConsent`.
 *
 * The runner shows one "Your voice" card per such node, whatever the author
 * curated or hid: a synthetic input node (`APP_CLONE_INPUT_TYPE`) appended to
 * the runner's inputs, whose card writes onto the real node's input values.
 * Which clones count follows the server's `sentClones` exactly: a Text to
 * Speech node holding a clone, and a dialogue's cloned speakers a line speaks
 * with — judged on the node's data as the run reads it (the shipped data, then
 * the runner's input values over it).
 */

/** The synthetic input node's type: one "Your voice" card for a clone node. */
export const APP_CLONE_INPUT_TYPE = "voice-clone-input"

const ID_PREFIX = "voice-clone-input:"

/** The synthetic input node's id for clone node `nodeId` (never a real node's id). */
export function appCloneInputId(nodeId: string): string {
  return `${ID_PREFIX}${nodeId}`
}

/** The clone node a synthetic input node writes to, or undefined for any other id. */
export function appCloneTargetId(id: string): string | undefined {
  return id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : undefined
}

/** What the synthetic node carries: the clone node it stands for, as it ships. */
export interface AppCloneInputData {
  readonly [key: string]: unknown
  readonly label: string
  readonly cloneNodeId: string
  readonly cloneNodeType: "text-to-speech" | "text-to-dialogue"
  readonly cloneNodeData: Readonly<Record<string, unknown>>
}

type GraphNode = { readonly id: string; readonly type?: string; readonly data?: unknown }
type InputValues = Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>

const dataOf = (n: GraphNode): Record<string, unknown> =>
  n.data && typeof n.data === "object" && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {}

/** A node's data as the run reads it: what ships, then the runner's input values over it (a shallow merge, as the server's). */
export function appCloneEffectiveData(data: Readonly<Record<string, unknown>>, values: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return values ? { ...data, ...values } : { ...data }
}

/** The voices a dialogue's lines speak with (`dialogue`, else `script`), as the server reads them. */
function lineVoices(data: Readonly<Record<string, unknown>>): Set<string> {
  const lines = Array.isArray(data.dialogue) ? data.dialogue : Array.isArray(data.script) ? data.script : []
  return new Set(lines.map((l) => (l as { voice?: unknown } | null)?.voice).filter((v): v is string => typeof v === "string"))
}

/** A dialogue's cloned speakers a line speaks with, in the order of `speakers` (each label once). */
export function appDialogueCloneLabels(data: Readonly<Record<string, unknown>>): string[] {
  if (!Array.isArray(data.speakers)) return []
  const spoken = lineVoices(data)
  const out: string[] = []
  for (const s of data.speakers) {
    const entry = s as { voice?: unknown; replica?: unknown } | null
    if (!entry || typeof entry.voice !== "string" || !spoken.has(entry.voice) || entry.replica == null) continue
    if (!out.includes(entry.voice)) out.push(entry.voice)
  }
  return out
}

/** The clone node a run sends a clone from, judged on its data as the run reads it. */
function sendsClone(type: string | undefined, data: Readonly<Record<string, unknown>>): type is "text-to-speech" | "text-to-dialogue" {
  if (type === "text-to-speech") return data.replica != null
  if (type === "text-to-dialogue") return appDialogueCloneLabels(data).length > 0
  return false
}

/**
 * The nodes an app's run executes when its settings bake a route in (`runTarget: "route"`), as the server
 * narrows it (`getRouteReachableNodeIds`; an empty or stale route runs the whole graph): undefined = all.
 */
export function appRunNodeIds(
  nodes: ReadonlyArray<{ id: string; type?: string; data?: unknown }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
  settings: { readonly runTarget?: string; readonly selectedRouteId?: string } | null | undefined,
): ReadonlySet<string> | undefined {
  if (settings?.runTarget !== "route" || !settings.selectedRouteId) return undefined
  const reachable = getRouteReachableNodeIds(nodes as never, edges as never, settings.selectedRouteId)
  return reachable.size > 0 ? reachable : undefined
}

/**
 * Every node of the graph that sends a clone the runner must fill, in graph order: only a node the run
 * executes — not hidden, not a loop's expanded copy, inside the route `runNodeIds` names (the server's check).
 */
export function appCloneNodes<T extends GraphNode>(nodes: readonly T[], inputValues: InputValues, runNodeIds?: ReadonlySet<string>): T[] {
  return nodes.filter(
    (n) =>
      !isExpandedClone(n as never) &&
      !(n as { hidden?: unknown }).hidden &&
      (!runNodeIds || runNodeIds.has(n.id)) &&
      sendsClone(n.type, appCloneEffectiveData(dataOf(n), inputValues[n.id])),
  )
}

/** One synthetic input node for a clone node; `label` names it in the composer and the card. */
export function appCloneInputNode(node: GraphNode, label: string): WorkflowNode {
  const data: AppCloneInputData = {
    label,
    cloneNodeId: node.id,
    cloneNodeType: node.type as "text-to-speech" | "text-to-dialogue",
    cloneNodeData: dataOf(node),
  }
  return { id: appCloneInputId(node.id), type: APP_CLONE_INPUT_TYPE, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

/** The clones of one node, each with its recordings and consent as the run reads them (Text to Speech: one, unlabelled). */
export function appClonesOf(type: string, data: Readonly<Record<string, unknown>>): Array<{ label: string | null; replica: unknown; consent: unknown }> {
  if (type === "text-to-speech") return data.replica == null ? [] : [{ label: null, replica: data.replica, consent: data.replicaConsent }]
  if (type !== "text-to-dialogue" || !Array.isArray(data.speakers)) return []
  const speakers = data.speakers as ReadonlyArray<{ voice?: unknown; replica?: unknown; replicaConsent?: unknown } | null>
  return appDialogueCloneLabels(data).map((label) => {
    const entry = speakers.find((s) => s?.voice === label)
    return { label, replica: entry?.replica, consent: entry?.replicaConsent }
  })
}

/** Every clone the run sends has both recordings and `userId`'s own consent (the server's checks, before the recordings are read). */
export function appClonesReady(nodes: readonly GraphNode[], inputValues: InputValues, userId: string | undefined, runNodeIds?: ReadonlySet<string>): boolean {
  for (const node of appCloneNodes(nodes, inputValues, runNodeIds)) {
    const data = appCloneEffectiveData(dataOf(node), inputValues[node.id])
    for (const clone of appClonesOf(node.type!, data)) {
      if (cloneRunProblem(clone.replica, clone.consent, userId)) return false
    }
  }
  return true
}

/**
 * A synthetic node's clones all have both recordings and a consent record (the
 * composer's chip: "Ready"). Whose record it is the run judges; the runner's
 * input values only ever hold the records their own ticks returned.
 */
export function appCloneInputFilled(node: { readonly data?: unknown }, inputValues: InputValues): boolean {
  const d = (node.data ?? {}) as Partial<AppCloneInputData>
  if (!d.cloneNodeId || !d.cloneNodeType || !d.cloneNodeData) return false
  const data = appCloneEffectiveData(d.cloneNodeData, inputValues[d.cloneNodeId])
  const clones = appClonesOf(d.cloneNodeType, data)
  return clones.length > 0 && clones.every((c) => {
    const record = c.consent as { userId?: unknown; signature?: unknown } | null | undefined
    return !cloneRunProblem(c.replica, c.consent, typeof record?.userId === "string" ? record.userId : undefined)
  })
}

/** What one clone's block writes: its recordings (a change clears the consent) or the consent record. */
export type AppClonePatch = { replica?: TtsReplica; replicaConsent?: ReplicaConsentRecord | undefined }

/**
 * A dialogue's whole `speakers` list with the clone `label` patched: every
 * other speaker exactly as it was. The run's input is the whole list, written
 * in one update (`inputOverrides[D].speakers`).
 */
export function withSpeakerClone(speakers: unknown, label: string, patch: AppClonePatch): DialogueSpeakerDirection[] {
  const list = Array.isArray(speakers) ? (speakers as DialogueSpeakerDirection[]) : []
  return list.map((s) => {
    if (s?.voice !== label) return s
    const next: Record<string, unknown> = { ...s, ...patch }
    if (next.replicaConsent === undefined) delete next.replicaConsent
    return next as unknown as DialogueSpeakerDirection
  })
}
