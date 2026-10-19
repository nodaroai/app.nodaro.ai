// frontend/src/nodes/exec-kit.ts — the run-time half of the node-unit kit
// (§5.8 B, decided 2026-10-16; ./kit.ts holds the definition half). TYPE-ONLY:
// every import is `import type` and nothing here is a value, so a unit that
// imports it adds no run-time edge into the editor's import cycle.
//   config.tsx → `ConfigPanel: UnitConfigPanel`
//   exec.ts    → `executor: UnitExecutor`
import type { ComponentType } from "react"
import type { MessageKey } from "@/lib/i18n"
import type { WorkflowNode } from "@/types/nodes"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import type { FrontendResolvedInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import type { OutputKeySpec } from "@/components/editor/workflow-editor/poll-job"

/**
 * What config.tsx is handed beside its ConfigProps: the editor services it may
 * not import (G5: labels.ts composes every unit's labels, so a unit never
 * imports it). config-panel.tsx builds it.
 */
export interface UnitConfigKit {
  /** A node label in the interface language ("Extract Audio" → its translation). */
  localizeNodeLabel(label: string): string
}

/** config.tsx — the config panel body; `nodeId` is the node the panel shows. */
export type UnitConfigPanel = ComponentType<ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }>

/**
 * The engine services exec.ts reaches. execute-node.ts builds one per run
 * (workflow-editor/unit-exec-kit.ts), so a unit never imports an engine module.
 */
export interface UnitExecKit {
  /** The node's resolved inputs (wired values, field mappings applied). */
  readonly inputs: FrontendResolvedInputs
  /** A list fan-out's per-iteration media URL, which wins over a wired one. */
  readonly overrideMediaUrl: string | undefined
  readonly userId: string | undefined
  /**
   * Start a server job (`start` calls the unit's api.ts) and poll it into the
   * store key `resultField` (generatedVideoUrl, generatedAudioUrl, …); resolves with the result.
   */
  runProcessingNode(start: () => Promise<{ jobId: string }>, resultField: OutputKeySpec, label: string): Promise<string>
  /**
   * Start a server job whose result is JSON (the unit's look outputs) and poll
   * it to completion: each output's value lands on its `from` field, as every
   * server-run lane lands it (unitJobLanding); resolves with the first output
   * as a wire carries it ("" when the job wrote none of it).
   */
  runJsonNode(start: () => Promise<{ jobId: string }>, label: string): Promise<string>
  /** `Node "<label>": <message>` in the interface language, for a toast or an error. */
  nodeRunError(key: MessageKey, vars?: Record<string, string | number>): string
  setUserPromptTemplate(template: string | undefined): void
  /** The node's current data in the store. */
  nodeData(): Readonly<Record<string, unknown>> | undefined
  updateNodeData(patch: Record<string, unknown>): void
}

/** exec.ts — the editor's DAG executor for the unit. */
export interface UnitExecutor {
  execute(node: WorkflowNode, kit: UnitExecKit): Promise<string>
}
