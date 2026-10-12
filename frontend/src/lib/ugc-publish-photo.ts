/**
 * A MiniApp or component holding a UGC Creator set to "My photo" needs the runner's own photo:
 * publishing empties every value that can flow into a creator's photo input, read over the workflow
 * and every sub-workflow graph it references (@nodaro/render-rules), and a run that gives none of
 * the runner's own is refused before anything is spent. This reads, at publish, which such
 * creators, at any depth, the app or component gives no way to receive one, so the author is told
 * before the first run is refused. It mirrors the run's refusal (`ugcCreatorPhotoSources`): a
 * creator the app shows as an input takes the runner's photo there; otherwise an input must be a
 * node that can carry the runner's image into the photo (an upload, a List, a sub-workflow input
 * port that takes an image), or one that sets up a node making the image in the run from nothing an
 * image brings it (a Text node prompting a generator). A value the graph holds never counts (it is
 * the author's, and ships empty), and neither does a Text node or a picker setting up a step whose
 * image comes from an upload.
 */
import {
  appInputNodeIds as appInputNodeIdsOf,
  presentationItemNodeIds,
  ugcComposedCreators,
  ugcComposedKey,
  ugcComposedPathRuns,
  ugcCreatorPhotoSources,
  ugcReadComposedGraph,
  type UgcComposedGraph,
  type UgcGraphPart,
  type UgcPartLoad,
} from "@nodaro/render-rules"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { readWorkflowContent } from "@/lib/workflow-content"
import { SUB_WORKFLOW_MAX_DEPTH } from "@/components/editor/workflow-editor/sub-workflow-route-graph"

export { presentationItemNodeIds }

/** The nodes a published app shows as its inputs — the server's own reading (`appInputNodeIds`, @nodaro/render-rules). */
export function appInputNodeIds(nodes: readonly WorkflowNode[], settings: PresentationSettings | undefined): Set<string> {
  return appInputNodeIdsOf(settings, nodes as unknown as ReadonlyArray<{ id: string; type?: string }>)
}

/** A creator the app gives no way to receive the runner's photo, with the key of the graph it is in (`ugcComposedKey`). */
export interface UgcCreatorWithoutPhoto {
  readonly key: string
  readonly node: WorkflowNode
}

/**
 * The inputs of what is published: the nodes it takes any value on, and those of them it takes an
 * image on (a component's image handles; an app's inputs are both).
 */
export interface PublishedInputs {
  readonly any: ReadonlySet<string>
  readonly image: ReadonlySet<string>
}

/**
 * The UGC Creators set to "My photo", at any depth of the composed graph, that the app gives no way
 * to receive the runner's photo: every run of it would be refused. `inputs` are the published app's
 * input nodes — or a component's input handles' nodes (`PublishedInputs`: its image handles apart),
 * with `creatorTakesPhoto: false`: a component's caller sets only its handles, and a creator's own
 * handle carries its source, never a photo. A creator inside a frozen sub-workflow does not run,
 * and is not named.
 */
export function ugcCreatorsWithoutPhotoInput(
  composed: UgcComposedGraph,
  inputs: ReadonlySet<string> | PublishedInputs,
  opts: { readonly creatorTakesPhoto?: boolean } = {},
): UgcCreatorWithoutPhoto[] {
  const creatorTakesPhoto = opts.creatorTakesPhoto ?? true
  const takes: PublishedInputs = inputs instanceof Set ? { any: inputs, image: inputs } : (inputs as PublishedInputs)
  const root = ugcComposedKey([])
  return ugcComposedCreators(composed).flatMap(({ key, node }) => {
    const creator = node as unknown as WorkflowNode
    if ((creator.data as Record<string, unknown> | undefined)?.source !== "photo" || !ugcComposedPathRuns(composed, key)) return []
    if (key === root && creatorTakesPhoto && takes.any.has(creator.id)) return []
    const sources = ugcCreatorPhotoSources(composed, key, creator.id)
    const image = [...(sources.image.get(root) ?? [])].some((id) => takes.image.has(id))
    const setsUp = [...(sources.originFeeders.get(root) ?? [])].some((id) => takes.any.has(id))
    return image || setsUp ? [] : [{ key, node: creator }]
  })
}

/** One referenced workflow as the editor reads it: loaded, or missing (a read that fails reads as missing). */
async function readPart(referenceId: string): Promise<UgcPartLoad> {
  const content = await readWorkflowContent(referenceId, "id, nodes, edges").catch(() => null)
  if (!content) return { kind: "missing" }
  const row = content.row as { nodes?: unknown; edges?: unknown }
  return {
    kind: "loaded",
    part: {
      nodes: Array.isArray(row.nodes) ? (row.nodes as UgcGraphPart["nodes"]) : [],
      edges: Array.isArray(row.edges) ? (row.edges as UgcGraphPart["edges"]) : [],
    },
  }
}

/**
 * The workflow composed with every sub-workflow graph it references, at any depth — read as the
 * server reads it for publishing (`ugcReadComposedGraph`), each referenced workflow as the editor
 * holds it. A component's snapshot is not read here.
 */
export async function readUgcComposedGraph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  read: (referenceId: string) => Promise<UgcPartLoad> = readPart,
): Promise<UgcComposedGraph> {
  const composed = await ugcReadComposedGraph(nodes as unknown as UgcGraphPart["nodes"], edges as unknown as UgcGraphPart["edges"], { subWorkflow: (ref) => read(ref) }, { maxDepth: SUB_WORKFLOW_MAX_DEPTH })
  return composed.graph
}
