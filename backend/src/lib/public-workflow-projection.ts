import { stripStudioTakeVoiceRecords, stripStudioTransientSettings, STUDIO_DEPENDENT_FRAMES_CAPABILITY } from "@nodaro/shared"
import type { PluginServices } from "./private-plugins/types.js"

type Input = Parameters<NonNullable<PluginServices["publicWorkflow"]>["project"]>[0]
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const declared = (data: Record<string, unknown>) => Array.isArray(data.requiredCapabilities)
  && data.requiredCapabilities.includes(STUDIO_DEPENDENT_FRAMES_CAPABILITY)

/** Recognize protected extensions even when a writer omitted the declaration. */
export function needsPublicWorkflowProjection(input: Input): boolean {
  const studio = object(input.settings.studio)
  return ["keyframes", "sequences", "settledJobIds"].some((key) => Object.hasOwn(studio, key))
    || declared(studio) || input.nodes.some((node) => {
      const data = object(object(node).data)
      return Object.hasOwn(data, "keyframeId") || Object.hasOwn(data, "sequenceBinding") || declared(data)
    })
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
