import { createContext, useContext } from "react"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The node the config panel is currently editing, plus the graph around it.
 *
 * Provided ONCE by `config-panel.tsx` around the node-type config body, and
 * consumed by `PromptInjectionPreview` so the panel preview can compose the
 * fragment the SAME way the injection path does —
 * `getParameterPromptHint(node, { nodes, edges })` — instead of re-deriving it
 * from a bare catalog id (which is blind to `data.hintMode` and to the
 * startState / endState edges that camera-motion, transition and character-fx
 * compose from).
 *
 * Graph context is carried rather than looked up from the store on the spot so
 * the preview stays a plain presentational component wherever it is rendered
 * WITHOUT a provider — see the fallback in `PromptInjectionPreview`.
 */
export interface ParameterPreviewContextValue {
  /** The node being edited. `nodes`/`edges` are the live graph it sits in. */
  readonly node: WorkflowNode
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
}

export const ParameterPreviewContext = createContext<ParameterPreviewContextValue | null>(null)

/** `null` outside the config panel — callers must keep working without it. */
export function useParameterPreviewContext(): ParameterPreviewContextValue | null {
  return useContext(ParameterPreviewContext)
}
