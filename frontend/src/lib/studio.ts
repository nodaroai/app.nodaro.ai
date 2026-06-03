// frontend/src/lib/studio.ts

const STUDIO_BASE_URL =
  (import.meta.env.VITE_STUDIO_URL as string | undefined)?.replace(/\/+$/, "") ||
  "https://studio.nodaro.ai"

/** A workflow is Studio-origin when its settings carry a `studio` marker. */
export function isStudioWorkflowSettings(settings: unknown): boolean {
  return !!(settings as { studio?: unknown } | null | undefined)?.studio
}

/**
 * A project is the dedicated Studio project when it carries a `studio` marker.
 * The default project is NEVER treated as studio — invariant that prevents
 * ever locking the user out of their primary workspace.
 */
export function isStudioProject(
  project: { settings?: Record<string, unknown> | null; isDefault?: boolean } | null | undefined,
): boolean {
  if (!project || project.isDefault) return false
  return !!(project.settings as { studio?: unknown } | null | undefined)?.studio
}

/** Deep link into studio.nodaro.ai for a given workflow id. */
export function studioWorkflowUrl(workflowId: string): string {
  return `${STUDIO_BASE_URL}/project/${workflowId}`
}
