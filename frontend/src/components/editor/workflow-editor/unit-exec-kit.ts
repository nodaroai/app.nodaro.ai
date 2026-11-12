// frontend/src/components/editor/workflow-editor/unit-exec-kit.ts — builds the
// kit a node unit's exec.ts runs with (frontend/src/nodes/kit.ts, §5.8 B,
// decided 2026-10-16). OUTSIDE the editor's import cycle on purpose: the
// engine services that live inside it (poll-job's pollJobWithNodeUpdate, the
// workflow store) are INJECTED by execute-node.ts, so neither this module nor
// a unit ever imports them — C1 (no cycle growth) and G5 (a unit imports no
// engine module) both hold. Everything it imports at run time is a leaf.
// @registry-lookup builds the JSON landing and the side-output landing of the one node unit it runs (unitDefinitionOf(node.type))
import type { UnitExecKit } from "@/nodes/exec-kit"
import type { MessageKey } from "@/lib/i18n"
import { unitDefinitionOf } from "@/lib/unit-definitions"
import { unitJsonJobLanding, unitJsonWorkers, unitSideFields, unitSideJobPatch, type UnitJsonLanding } from "@/lib/unit-compose"
import type { WorkflowNode } from "@/types/nodes"
import type { FrontendResolvedInputs } from "./node-input-resolver"
import type { OutputKeySpec } from "./poll-job"
import type { ExecutionContext } from "./types"
import { nodeRunError } from "./node-run-message"

/** The fields a finished job lands beside its media take, on the node and on the take (poll-job's `extraOutputFields`). */
export type UnitExtraOutputFields = (outputData: Record<string, unknown>) => Record<string, unknown>

/** What execute-node.ts hands in: the run's own state and the engine services. */
export interface UnitExecKitDeps {
  readonly node: WorkflowNode
  readonly ctx: ExecutionContext
  readonly inputs: FrontendResolvedInputs
  readonly overrideMediaUrl: string | undefined
  /** poll-job's pollJobWithNodeUpdate (the legacy runProcessingNode's body); `extraOutputFields` lands a unit's side outputs. */
  readonly poll: (nodeId: string, start: () => Promise<{ jobId: string }>, outputKey: OutputKeySpec, label: string, ctx: ExecutionContext, extraOutputFields?: UnitExtraOutputFields) => Promise<string>
  /** The same poll landing a JSON result (pollJobWithNodeUpdate's `jsonLanding`). */
  readonly pollJson: (nodeId: string, start: () => Promise<{ jobId: string }>, landing: UnitJsonLanding, label: string, ctx: ExecutionContext) => Promise<string>
  readonly setUserPromptTemplate: (template: string | undefined) => void
  readonly getNodeData: (nodeId: string) => Readonly<Record<string, unknown>> | undefined
  readonly updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
}

/** The kit for one run of one unit node. */
export function createUnitExecKit(deps: UnitExecKitDeps): UnitExecKit {
  const { node, ctx } = deps
  const label = (node.data as { label?: string } | undefined)?.label
  return {
    inputs: deps.inputs,
    overrideMediaUrl: deps.overrideMediaUrl,
    userId: ctx.userId,
    runProcessingNode: (start, resultField, jobLabel) => {
      // A unit whose media take carries side outputs (a list, JSON beside it):
      // they are emptied at the start, so an earlier run's never sits beside
      // this one's, and land beside the take (unitSideLanding) — on the node
      // and on the take. Every other unit polls exactly as a legacy node.
      const unit = unitDefinitionOf(node.type)
      const fields = unit ? unitSideFields(unit) : []
      if (!unit || fields.length === 0) return deps.poll(node.id, start, resultField, jobLabel, ctx)
      deps.updateNodeData(node.id, Object.fromEntries(fields.map((f) => [f, undefined])))
      return deps.poll(node.id, start, resultField, jobLabel, ctx, (outputData) => unitSideJobPatch(unit, outputData) ?? {})
    },
    runJsonNode: (start, jobLabel) => {
      const unit = unitDefinitionOf(node.type)
      if (!unit || unitJsonWorkers([unit]).length === 0) return Promise.reject(new Error(`${node.type}: runJsonNode needs a node unit whose outputs are JSON`))
      return deps.pollJson(node.id, start, unitJsonJobLanding(unit), jobLabel, ctx)
    },
    nodeRunError: (key: MessageKey, vars) => nodeRunError(label, key, vars),
    setUserPromptTemplate: deps.setUserPromptTemplate,
    nodeData: () => deps.getNodeData(node.id),
    updateNodeData: (patch) => deps.updateNodeData(node.id, patch),
  }
}
