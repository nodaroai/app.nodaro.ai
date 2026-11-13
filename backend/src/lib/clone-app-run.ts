/**
 * A run of someone else's graph — a published app's or component's, a share link viewer's — whose
 * one-off voice clone the runner has not filled in (decided 2026-11-13: recordings as app inputs).
 * The graph ships with every clone's recordings emptied and no consent (lib/clone-recordings.ts),
 * so a clone speaks only in the voice of the runner's own two recordings, on the runner's own
 * consent: the app's inputs put them onto the node (Text to Speech: `replica` and `replicaConsent`;
 * Text to Dialogue: `speakers`, each cloned speaker with its own). Judged before anything is
 * written, held or spent, as the run would judge it mid-graph after earlier nodes were paid for:
 * - the model the run dispatches clones (Gemini 3.8 Flash): a wired Character's voice model first,
 *   then the node's own (an app's Model card included);
 * - both recordings are given;
 * - the consent is the runner's own record for exactly those recordings (`replicaConsentIsFor`);
 * - the deployment offers one-off clones to the runner (`voice-clone-one-off`);
 * - no voice lock refuses the model;
 * - the recordings themselves: https, allowed, a WAV within 10 MB, the reference 10–30 s, the
 *   consent recording at most 30 s (`readReplica`), read by `cloneRecordingsRefusal` only after the
 *   door's cheaper checks (its daily limit, the runner's credits), so a refused run downloads nothing.
 * Only nodes the run executes are asked (not hidden, not a loop's expanded copy, inside the route it
 * runs). A dialogue's clone is judged only when a line of the node speaks with it (only it is sent). A
 * clone inside a sub-workflow or component the run executes cannot take the runner's recordings —
 * the app's inputs land on its own graph — so such a run is refused up front; any other run refuses
 * a clone inside a component it executes the same way (`unfillableCloneRefusal`).
 */
import { ttsReplicaProblem, ttsTakesReplica, replicaOf } from "@nodaro/shared/model-catalog"
import { dialogueProviderOf, type TtsReplica } from "@nodaro/shared/models"
import { mergeNodeInputOverrides } from "@nodaro/shared/apps"
import { isExpandedClone } from "@nodaro/shared/workflow"
import { ugcComposedKey, ugcComposedPath, ugcComposedPathRuns } from "@nodaro/render-rules"
import { cloneDataWithoutRecordings } from "./clone-recordings.js"
import { loadUgcComposedGraph } from "./ugc-composed-graph.js"
import { replicaConsentIsFor } from "./voice-clone-consent.js"
import { deniedCapabilityForUser } from "./availability-viewer.js"
import { deniedNodeRejectionMessage, dialogueLineVoices } from "./surface-deny.js"
import { judgeNamedVoiceModel } from "./voice-lock.js"
import { voiceNotAvailableBody } from "./voice-policy.js"
import { readReplica, ReplicaRecordingError } from "./voice-replica.js"
import { speechRunsAs } from "./speech-credits.js"

/** A refusal: the HTTP status and the error body. */
export interface CloneRunRefusal {
  readonly status: number
  readonly error: { readonly code: string; readonly message: string }
}

/** The runner gave the clone no recordings. A fixed code, so the app runner says it in the person's language. */
export const CLONE_RECORDINGS_REQUIRED = {
  code: "clone_recordings_required",
  message: "This app speaks in your own voice: add your two recordings (a reference and the consent recording) and tick the consent box, then run it again.",
} as const

/** The consent is not the runner's own record for these recordings. */
export const CLONE_CONSENT_REQUIRED = {
  code: "clone_consent_required",
  message: "Tick the consent box for your recordings yourself, then run it again: a cloned voice runs only on the consent of the person running the app.",
} as const

/** A clone inside a graph the run executes, where the app's inputs cannot reach it. */
export const CLONE_NOT_FILLABLE = {
  code: "clone_not_fillable",
  message: "This app clones a voice inside a sub-workflow or a component, where your recordings can't reach it, so it can't be run.",
} as const

type SnapshotNode = { readonly id: string; readonly type?: string | null; readonly data?: Record<string, unknown> }
type SnapshotEdge = { readonly source?: string; readonly target?: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }
type Overrides = Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
type GraphNode = { readonly id?: unknown; readonly type?: unknown; readonly data?: unknown }

const dataOf = (n: GraphNode | undefined): Record<string, unknown> =>
  n && n.data && typeof n.data === "object" && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {}

/** One clone the run sends: the node it is on, the model it runs on, its recordings field and its consent. */
interface SentClone {
  readonly type: "text-to-speech" | "text-to-dialogue"
  readonly model: string
  readonly replica: unknown
  readonly consent: unknown
}

/** The entity nodes whose stored voice a wired Text to Speech node takes, model included (the run's input resolver). */
const VOICE_SOURCE_NODE_TYPES: ReadonlySet<string> = new Set(["character", "creature"])

/**
 * The model a wired Character or Creature hands a Text to Speech node (`voice.ttsProvider`, read by the run's
 * input resolver when the entity has a voice), or undefined.
 */
function wiredVoiceProvider(nodeId: string, nodes: readonly SnapshotNode[], edges: readonly SnapshotEdge[]): string | undefined {
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const source = nodes.find((n) => n.id === edge.source)
    if (!source || !VOICE_SOURCE_NODE_TYPES.has(source.type ?? "")) continue
    const voice = dataOf(source).voice as { voiceId?: unknown; ttsProvider?: unknown } | undefined
    if (typeof voice?.voiceId === "string" && voice.voiceId) return typeof voice.ttsProvider === "string" && voice.ttsProvider ? voice.ttsProvider : undefined
  }
  return undefined
}

/**
 * The clones a node sends, as the run reads its data: a Text to Speech node's (on the model the run dispatches,
 * `effectiveDispatchProvider`: a wired entity's model first), a dialogue's speakers a line speaks with.
 */
function sentClones(type: unknown, data: Record<string, unknown>, wiredProvider?: string): SentClone[] {
  if (type === "text-to-speech") {
    return data.replica == null ? [] : [{ type, model: speechRunsAs(wiredProvider || data.provider), replica: data.replica, consent: data.replicaConsent }]
  }
  if (type === "text-to-dialogue" && Array.isArray(data.speakers)) {
    const spoken = dialogueLineVoices(data)
    const model = dialogueProviderOf(data.provider)
    return data.speakers.flatMap((s) => {
      const entry = s as { voice?: unknown; replica?: unknown; replicaConsent?: unknown } | null
      if (!entry || typeof entry.voice !== "string" || !spoken.has(entry.voice) || entry.replica == null) return []
      return [{ type, model, replica: entry.replica, consent: entry.replicaConsent }]
    })
  }
  return []
}

/** A node the run executes at all: not hidden, not a loop's expanded copy (the orchestrator drops both). */
const runs = (node: GraphNode): boolean =>
  !(node as { hidden?: unknown }).hidden && !isExpandedClone({ id: typeof node.id === "string" ? node.id : "", data: dataOf(node) } as never)

/** Does any node of this graph that runs hold a clone a run would send? */
const holdsClone = (nodes: readonly GraphNode[]): boolean => nodes.some((n) => runs(n) && sentClones(n.type, dataOf(n)).length > 0)

/** The model refusal: a fixed code, so the app runner says it in the person's language. */
export const CLONE_MODEL_UNSUPPORTED_CODE = "clone_model_unsupported"

/** The first refusal for one clone, cheapest first; the recordings themselves are read later (`cloneRecordingsRefusal`). */
async function cloneRefusal(clone: SentClone, runnerId: string, data: Record<string, unknown>): Promise<CloneRunRefusal | undefined> {
  // A model that does not clone (an app's Model card, a field mapping, a wired voice): refused, never dropped.
  if (!ttsTakesReplica(clone.model)) return { status: 400, error: { code: CLONE_MODEL_UNSUPPORTED_CODE, message: ttsReplicaProblem(clone.model, clone.replica) ?? "" } }
  const links = replicaOf(clone.replica)
  if (!links) return { status: 400, error: { ...CLONE_RECORDINGS_REQUIRED } }
  if (!replicaConsentIsFor(clone.consent, runnerId, links)) return { status: 400, error: { ...CLONE_CONSENT_REQUIRED } }
  const denied = await deniedCapabilityForUser(clone.type, data, runnerId)
  if (denied) return { status: 403, error: { code: "node_not_available", message: deniedNodeRejectionMessage([denied]) } }
  if (!judgeNamedVoiceModel(clone.model).allowed) return { status: 400, ...voiceNotAvailableBody() }
  return undefined
}

/**
 * A clone inside a graph the run executes below its own, where the run's inputs cannot reach it:
 * - a run of someone else's graph (`published`): any sub-workflow or component it executes (each is
 *   loaded as published, its clones emptied);
 * - any other run (the editor's, the API's, MCP's, a trigger's): a component it executes (a published
 *   snapshot, its clones emptied); a sub-workflow is the owner's own graph, its clones as they are.
 * Refused before anything is written or held, so no node upstream of it runs and is charged first.
 */
export async function unfillableCloneRefusal(
  nodes: readonly SnapshotNode[],
  edges: readonly SnapshotEdge[],
  nodeIds: readonly string[] | undefined,
  ownerId: string,
  opts: { readonly published: boolean },
): Promise<CloneRunRefusal | undefined> {
  const inRun = nodeIds ? new Set(nodeIds) : undefined
  const nests = (n: SnapshotNode) => runs(n) && (!inRun || inRun.has(n.id)) && (n.type === "component" || (opts.published && n.type === "sub-workflow"))
  if (!nodes.some(nests)) return undefined
  const composed = (await loadUgcComposedGraph(nodes, edges, ownerId)).graph
  const root = ugcComposedKey([])
  for (const [key, part] of composed) {
    if (key === root) continue
    const path = ugcComposedPath(key)
    if (inRun && !inRun.has(path[0]!)) continue
    if (!ugcComposedPathRuns(composed, key)) continue
    // On a run of one's own graph, only what lies in a component (at any depth below it) is published.
    const published = opts.published || path.some((_, i) => composed.get(ugcComposedKey(path.slice(0, i + 1)))?.component === true)
    if (published && holdsClone(part.nodes)) return { status: 400, error: { ...CLONE_NOT_FILLABLE } }
  }
  return undefined
}

/** What a run's clone check found: a refusal, or the runner's recordings to read (`cloneRecordingsRefusal`) before the run. */
export interface CloneRunCheck {
  readonly refusal?: CloneRunRefusal
  readonly recordings: readonly TtsReplica[]
}

/**
 * The checks for a run of `nodes` (someone else's graph, as it ships) with the runner's
 * `inputOverrides`, but the recordings themselves (see the file comment). `nodeIds`: the nodes the run
 * executes, when it runs a part of the graph. `ownerId`: whose graph it is (its sub-workflows are read
 * as theirs). The recordings are read only once the run's cheaper checks (its daily limit, the
 * runner's credits) pass: `cloneRecordingsRefusal`.
 */
export async function cloneRunCheck(
  nodes: readonly SnapshotNode[],
  edges: readonly SnapshotEdge[],
  inputOverrides: Overrides,
  nodeIds: readonly string[] | undefined,
  ownerId: string,
  runnerId: string,
): Promise<CloneRunCheck> {
  const inRun = nodeIds ? new Set(nodeIds) : undefined
  const recordings: TtsReplica[] = []
  for (const node of nodes) {
    if (!runs(node) || (inRun && !inRun.has(node.id))) continue
    // As the run reads it: the author's clone emptied (an older snapshot too), then the runner's inputs.
    const shipped = cloneDataWithoutRecordings(node.type, dataOf(node))
    const override = inputOverrides?.[node.id]
    const data = override ? mergeNodeInputOverrides(node.type ?? undefined, shipped, { ...override }) : shipped
    for (const clone of sentClones(node.type, data, node.type === "text-to-speech" ? wiredVoiceProvider(node.id, nodes, edges) : undefined)) {
      const refusal = await cloneRefusal(clone, runnerId, data)
      if (refusal) return { refusal, recordings: [] }
      recordings.push(replicaOf(clone.replica)!)
    }
  }
  const nested = await unfillableCloneRefusal(nodes, edges, nodeIds, ownerId, { published: true })
  return nested ? { refusal: nested, recordings: [] } : { recordings }
}

/** The recordings themselves (https, allowed, a WAV within 10 MB, their lengths), read last; a refusal, or undefined. */
export async function cloneRecordingsRefusal(recordings: readonly TtsReplica[]): Promise<CloneRunRefusal | undefined> {
  for (const replica of recordings) {
    try {
      await readReplica(replica)
    } catch (err) {
      if (err instanceof ReplicaRecordingError) return { status: 400, error: { code: err.code, message: err.message } }
      throw err
    }
  }
  return undefined
}

/** `cloneRunCheck` and then `cloneRecordingsRefusal`: for a door with no cheaper check to run between them. */
export async function cloneRunRefusal(
  nodes: readonly SnapshotNode[],
  edges: readonly SnapshotEdge[],
  inputOverrides: Overrides,
  nodeIds: readonly string[] | undefined,
  ownerId: string,
  runnerId: string,
): Promise<CloneRunRefusal | undefined> {
  const check = await cloneRunCheck(nodes, edges, inputOverrides, nodeIds, ownerId, runnerId)
  return check.refusal ?? (await cloneRecordingsRefusal(check.recordings))
}
