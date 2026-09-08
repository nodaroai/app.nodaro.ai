/** Public workflow capability marker; creative planning stays in the Studio codec. */
export const STUDIO_DEPENDENT_FRAMES_CAPABILITY = "studio-dependent-frames-v1"

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
