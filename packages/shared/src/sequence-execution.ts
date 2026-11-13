/** Public workflow capability marker; creative planning stays in the Studio codec. */
export const STUDIO_DEPENDENT_FRAMES_CAPABILITY = "studio-dependent-frames-v1"

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const declaresDependentFrames = (data: Record<string, unknown>): boolean =>
  Array.isArray(data.requiredCapabilities) && data.requiredCapabilities.includes(STUDIO_DEPENDENT_FRAMES_CAPABILITY)

/**
 * Whether a workflow document is one a server codec owns (Studio): the TS
 * mirror of the database's `workflow_requires_compatible_writer`, whose write
 * guard refuses any change to such a document by any writer but the codec's.
 * Recognized even when a writer omitted the declaration: a Studio settings
 * block holding keyframes, sequences or settled jobs, or declaring dependent
 * frames, or any node carrying `keyframeId`, `sequenceBinding` or that
 * declaration. The one predicate the server's routes and the editor ask.
 */
export function isCodecOwnedDocument(nodes: unknown, settings: unknown): boolean {
  const studio = record(record(settings).studio)
  return ["keyframes", "sequences", "settledJobIds"].some((key) => Object.hasOwn(studio, key))
    || declaresDependentFrames(studio)
    || (Array.isArray(nodes) && nodes.some((node) => {
      const data = record(record(node).data)
      return Object.hasOwn(data, "keyframeId") || Object.hasOwn(data, "sequenceBinding") || declaresDependentFrames(data)
    }))
}

export class SequenceExecutionRequiredError extends Error {
  readonly code = "sequence_execution_required"
  readonly statusCode = 400
  constructor(readonly nodeIds: readonly string[]) {
    super("Generate linked frames and clips in Studio or through its production API so the reviewed images are used.")
    this.name = "SequenceExecutionRequiredError"
  }
}

/** A missing declaration must not make a recognizable dependency node runnable. */
export function requiresSequenceExecution(node: { data?: unknown }): boolean {
  if (!node.data || typeof node.data !== "object" || Array.isArray(node.data)) return false
  const data = node.data as Record<string, unknown>
  return data.keyframeId !== undefined || data.sequenceBinding !== undefined
    || (Array.isArray(data.requiredCapabilities) && data.requiredCapabilities.includes(STUDIO_DEPENDENT_FRAMES_CAPABILITY))
}

export function assertCanvasExecutionAllowed(nodes: readonly { id: string; data?: unknown }[]): void {
  const blocked = nodes.filter(requiresSequenceExecution).map((node) => node.id)
  if (blocked.length) throw new SequenceExecutionRequiredError(blocked)
}
