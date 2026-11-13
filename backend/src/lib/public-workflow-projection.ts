import { isCodecOwnedDocument, stripStudioTakeVoiceRecords, stripStudioTransientSettings } from "@nodaro/shared/pipeline"
import type { PluginServices } from "./private-plugins/types.js"

type Input = Parameters<NonNullable<PluginServices["publicWorkflow"]>["project"]>[0]
/** Recognize protected extensions even when a writer omitted the declaration (`isCodecOwnedDocument`, @nodaro/shared). */
export function needsPublicWorkflowProjection(input: Input): boolean {
  return isCodecOwnedDocument(input.nodes, input.settings)
}

/**
 * Absent/unsupported extension services never expose the stored document.
 *
 * An ordinary document goes out without the owner's working state: the
 * transient studio keys and empty slots off `settings`, and a finished take's
 * voice record (studio ruling T42) off the nodes' result rows, where a
 * settings strip cannot reach it.
 */
export function publicWorkflowProjection(input: Input, services: PluginServices) {
  if (needsPublicWorkflowProjection(input)) return services.publicWorkflow?.project(input) ?? null
  return {
    nodes: stripStudioTakeVoiceRecords(input.nodes) as Input["nodes"],
    edges: input.edges,
    settings: stripStudioTransientSettings(input.settings),
  }
}
