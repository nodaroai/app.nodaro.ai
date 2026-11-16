/**
 * THE WORKFLOW LANE of the media-input funnel (`lib/input-links.ts`, decided
 * 2026-11-16): a node a run executes has its media inputs judged by the same
 * rule a REST request's are, at two points.
 *
 *  1. Its INPUTS, at dispatch (`executeNode`, after its field mappings and its
 *     Settings input are applied), before anything is read, created or held:
 *     what its own data takes in, read as the workflow import reads a node —
 *     never a run's result (a `generated…` setting), an endpoint or a
 *     preview, nor a setting `NODE_DATA_NOT_INPUT` names — and what its wires
 *     hand it, by field name, less what `NODE_IO_NOT_CONTENT` names.
 *     Every lane a node runs on passes here: a worker job, a route the engine
 *     calls, a use-case node, a component, a sub-workflow.
 *  2. What its BUILD ADDED (`executeWorkerNode` before the restriction gate and
 *     the reservation; `executeSyncHttpNode` before the route is called): an
 *     entity's reference pictures, a preset's, judged by name. A value judged
 *     at 1 is not judged again.
 *
 * A refusal is the switch's own (`LinkImportsDisabledError`, code
 * `link_imports_disabled`), a pure function of the node's inputs, so a retry
 * answers the same. A node type `NODE_TYPES_NOT_JUDGED` names is not judged.
 */
import { LinkImportsDisabledError } from "../../lib/link-imports.js"
import { judgeInputLinks, judgedInputLinks, type InputLinkVerdict } from "../../lib/input-links.js"
import { NODE_DATA_NOT_INPUT, NODE_IO_NOT_CONTENT, NODE_TYPES_NOT_JUDGED, isNodeResultField, type InputLinkReading } from "../../lib/input-link-lanes.js"
import type { ResolvedInputs, SimpleNode } from "./types.js"

/** A node's own data is read as a node (input media only); its wired inputs by name, less what its type names no content. */
function nodeReading(nodeType: string): InputLinkReading {
  const inputs = Object.hasOwn(NODE_IO_NOT_CONTENT, nodeType) ? NODE_IO_NOT_CONTENT[nodeType]!.inputs : undefined
  const notContent = inputs ? Object.fromEntries(Object.entries(inputs).map(([key, why]) => [`inputs.${key}`, why])) : undefined
  return { readers: { node: "workflow-node" }, ...(notContent ? { notContent } : {}) }
}

/** What a node's build sends is read by name, less what its type names no content. */
function payloadReading(nodeType: string): InputLinkReading {
  const payload = Object.hasOwn(NODE_IO_NOT_CONTENT, nodeType) ? NODE_IO_NOT_CONTENT[nodeType]!.payload : undefined
  return payload ? { notContent: payload } : {}
}

const NONE: InputLinkVerdict = Object.freeze({ mode: "allow", found: Object.freeze([]), refusal: null })

/** What the reading of a node takes: its data without the settings that are no input of its own, and its wired inputs. */
function readingOf(node: SimpleNode, resolvedInputs: ResolvedInputs): { node: unknown; inputs: unknown } {
  const notInput = Object.hasOwn(NODE_DATA_NOT_INPUT, node.type) ? NODE_DATA_NOT_INPUT[node.type]! : undefined
  const data = Object.fromEntries(Object.entries(node.data).filter(([key]) => !isNodeResultField(key) && !(notInput && Object.hasOwn(notInput, key))))
  return { node: { id: node.id, type: node.type, data }, inputs: resolvedInputs }
}

const judged = (nodeType: string) => !Object.hasOwn(NODE_TYPES_NOT_JUDGED, nodeType)

/** The verdict on a node's inputs: its data (as a node) and what its wires hand it. */
export function judgeNodeInputLinks(node: SimpleNode, resolvedInputs: ResolvedInputs, userId: string | undefined): InputLinkVerdict {
  if (!judged(node.type)) return NONE
  return judgeInputLinks({ kind: "node", name: node.type }, readingOf(node, resolvedInputs), { reading: nodeReading(node.type), ...(userId ? { userId } : {}) })
}

/**
 * The verdict on what a node's build added: its payload (a worker's job, a
 * route's body) by name, past every value {@link judgeNodeInputLinks} judged.
 */
export function judgeNodePayloadLinks(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  payload: Record<string, unknown>,
  userId: string | undefined,
): InputLinkVerdict {
  if (!judged(node.type)) return NONE
  const skip = new Set(judgedInputLinks(readingOf(node, resolvedInputs), nodeReading(node.type)).map((link) => link.value))
  return judgeInputLinks({ kind: "node", name: node.type }, payload, { reading: payloadReading(node.type), skip, ...(userId ? { userId } : {}) })
}

/** The error a node fails with when its inputs are refused: the switch's own, with the code the run's node state carries. */
export function nodeInputLinkRefusal(): LinkImportsDisabledError & { errorCode: "link_imports_disabled" } {
  return Object.assign(new LinkImportsDisabledError(), { errorCode: "link_imports_disabled" as const })
}
