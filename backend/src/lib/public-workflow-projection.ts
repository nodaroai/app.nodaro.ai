import { stripStudioTransientSettings, STUDIO_DEPENDENT_FRAMES_CAPABILITY } from "@nodaro/shared"
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

/** Absent/unsupported extension services never expose the stored document. */
export function publicWorkflowProjection(input: Input, services: PluginServices) {
  if (needsPublicWorkflowProjection(input)) return services.publicWorkflow?.project(input) ?? null
  return { nodes: input.nodes, edges: input.edges, settings: stripStudioTransientSettings(input.settings) }
}
