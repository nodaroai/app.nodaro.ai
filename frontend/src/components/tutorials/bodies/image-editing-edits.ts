// Read the fan-out shape of the image-editing template off its snapshot.
//
// This template is not a chain: one base image is generated once and every edit
// reads THAT SAME image. So the graph is derived hub-first — find the node the
// most edges leave, and everything it feeds is an edit. Nothing here is keyed on
// a node id or a provider name, because the lesson has to survive the template
// being re-published with different ids.
//
// Picker labels come from `PICKER_CATALOGS` and model labels from
// `MODEL_CATALOG`, both single sources of truth. A new picker type or a renamed
// model is therefore correct here for free — the alternative, a local
// value->label map, is the drift this repo keeps paying for.

import { getPickerCatalog, type PickerDimension } from "@nodaro/prompts"
import { getModel } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { nodeMedia } from "../derive-tutorial-data"

type NodeData = Record<string, unknown>

/** One driver node feeding an edit — a picker, in every case shipped so far. */
export interface EditDriver {
  nodeId: string
  /** The picker's own name ("Lighting"), from its catalog entry. */
  kind: string
  /** The chosen option's label ("Golden Hour"), from its catalog entry. */
  value: string
}

export interface TutorialEdit {
  nodeId: string
  /** 1-based position in the results grid. */
  index: number
  /** The node's label on the canvas. */
  nodeLabel: string
  /** What produced this edit, as an eyebrow: PROMPT / LIGHTING / STYLE x2 / … */
  driverKind: string
  /** The instruction itself — the prompt text, or the picker labels joined. */
  driverValue: string
  drivers: EditDriver[]
  /** Empty for an edit driven only by picker nodes. */
  prompt: string
  resultUrl: string | null
  /** Human model name, or null for a node that has no model to choose. */
  model: string | null
}

export interface EditFanOut {
  /** The one image every edit reads. Null if the snapshot has no hub. */
  base: {
    nodeId: string
    prompt: string
    imageUrl: string | null
    /** Settings worth showing next to the original, e.g. ["4K", "16:9"]. */
    chips: string[]
  } | null
  /** The critic scoring the base image, when the template has one. */
  critic: {
    nodeId: string
    score: number | null
    threshold: number | null
    approved: boolean
    mode: string | null
  } | null
  edits: TutorialEdit[]
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** "remove-background" -> "REMOVE BACKGROUND". Used only when a node has no
 *  driver and no prompt, so the eyebrow still names what did the work. */
function typeAsEyebrow(type: string | undefined): string {
  return (type ?? "edit").replace(/[-_]/g, " ").toUpperCase()
}

/**
 * Read one picker node as a driver.
 *
 * A picker is either ONE field choosing from one catalog (Style, Era, Lens) or
 * SEVERAL fields each with their own (Lighting carries time of day, quality and
 * direction). Both are read through the same dimension shape, so a picker that
 * gains a dimension later needs no change here — special-casing `valueField`
 * alone is what made the Lighting node read as no driver at all.
 *
 * Returns null for a node that is not a picker.
 */
function readDriver(node: WorkflowNode): EditDriver | null {
  const catalog = node.type ? getPickerCatalog(node.type) : undefined
  if (!catalog) return null

  const dimensions: readonly PickerDimension[] =
    catalog.kind === "multi"
      ? (catalog.dimensions ?? [])
      : catalog.valueField
        ? [{ field: catalog.valueField, label: catalog.label, options: catalog.options ?? [] }]
        : []
  if (dimensions.length === 0) return null

  const data = (node.data ?? {}) as NodeData
  const values: string[] = []
  for (const dimension of dimensions) {
    const id = str(data[dimension.field])
    if (!id) continue
    // An id with no catalog entry is still worth showing — better a raw id than
    // a blank line under an eyebrow that promises one.
    values.push(dimension.options.find((o) => o.id === id)?.label ?? id)
  }

  // A picker wired in but left unset is still the driver — it just has nothing
  // to say yet, and the trace renders that as "No settings".
  return { nodeId: node.id, kind: catalog.label, value: values.join(", ") }
}

/**
 * Collapse the drivers into one eyebrow.
 *
 * Two Style nodes feeding one edit is the template's most non-obvious
 * capability, so it gets said out loud ("STYLE x2") rather than being flattened
 * into a single name.
 */
function driverEyebrow(drivers: EditDriver[], node: WorkflowNode, prompt: string): string {
  if (drivers.length === 0) return prompt ? "PROMPT" : typeAsEyebrow(node.type)

  const kinds = [...new Set(drivers.map((d) => d.kind))]
  if (kinds.length === 1 && drivers.length > 1) {
    return `${kinds[0].toUpperCase()} x${drivers.length}`
  }
  return kinds.map((k) => k.toUpperCase()).join(" + ")
}

/** Settings the original is worth being described by. Missing ones drop out. */
function baseChips(data: NodeData): string[] {
  return [str(data.resolution), str(data.aspectRatio)].filter((v): v is string => v !== null)
}

/**
 * Find the hub — the node the most edges leave.
 *
 * Deliberately structural rather than `type === "generate-image"`: what makes a
 * node the base image here is that everything reads it, and the same tutorial
 * shape works just as well when the original is an upload.
 */
function findHub(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode | null {
  const outgoing = new Map<string, number>()
  for (const edge of edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
  }
  let hub: WorkflowNode | null = null
  let best = 0
  for (const node of nodes) {
    const count = outgoing.get(node.id) ?? 0
    // A hub needs to actually fan out; one downstream node is a chain.
    if (count > best && count > 1) {
      hub = node
      best = count
    }
  }
  return hub
}

/**
 * Derive the whole lesson from the snapshot.
 *
 * `order` is the authored grid order (node ids). Ids it does not mention are
 * appended in canvas order, so an edit added to the template later still shows
 * up — unlabelled, but present.
 */
export function deriveEditFanOut(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  order: readonly string[] = [],
): EditFanOut {
  const hub = findHub(nodes, edges)
  if (!hub) return { base: null, critic: null, edits: [] }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hubData = (hub.data ?? {}) as NodeData

  // Everything the hub feeds, de-duplicated: a node reading the base image twice
  // is still one edit.
  const consumerIds = [...new Set(edges.filter((e) => e.source === hub.id).map((e) => e.target))]

  let critic: EditFanOut["critic"] = null
  const candidates: WorkflowNode[] = []
  for (const id of consumerIds) {
    const node = byId.get(id)
    if (!node) continue
    if (node.type === "image-critic") {
      const data = (node.data ?? {}) as NodeData
      critic = {
        nodeId: node.id,
        score: num(data.score),
        threshold: num(data.threshold),
        approved: data.approved === true,
        mode: str(data.mode),
      }
      continue
    }
    candidates.push(node)
  }

  const rank = new Map(order.map((id, i) => [id, i]))
  candidates.sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return (a.position?.y ?? 0) - (b.position?.y ?? 0)
  })

  const edits = candidates.map((node, i) => {
    const data = (node.data ?? {}) as NodeData
    const prompt = str(data.prompt) ?? ""
    // De-duplicated by SOURCE, for the same reason the hub's consumers are: one
    // picker wired into an edit twice is one driver. Counting the edges instead
    // would report "STYLE x2" for a single Style node — and "two Style nodes at
    // once" is precisely the claim this tutorial makes about edit 4, so a
    // duplicate edge would make it lie about its own headline capability.
    const drivers = [
      ...new Set(
        edges.filter((e) => e.target === node.id && e.source !== hub.id).map((e) => e.source),
      ),
    ]
      .map((sourceId) => byId.get(sourceId))
      .filter((n): n is WorkflowNode => !!n)
      .map(readDriver)
      .filter((d): d is EditDriver => d !== null)

    const provider = str(data.provider)
    return {
      nodeId: node.id,
      index: i + 1,
      nodeLabel: str(data.label) ?? `Edit ${i + 1}`,
      driverKind: driverEyebrow(drivers, node, prompt),
      driverValue: drivers.length > 0 ? drivers.map((d) => d.value).join(" + ") : prompt,
      drivers,
      prompt,
      resultUrl: nodeMedia(node),
      model: provider ? (getModel(provider)?.label ?? provider) : null,
    }
  })

  return {
    base: {
      nodeId: hub.id,
      prompt: str(hubData.prompt) ?? "",
      imageUrl: nodeMedia(hub),
      chips: baseChips(hubData),
    },
    critic,
    edits,
  }
}
