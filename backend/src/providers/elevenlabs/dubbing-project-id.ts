/**
 * The id a project dub is stored under. It lives apart from the module that
 * renders a project dub, so reading an id loads nothing but this file.
 */

// Persist the project itself immediately after create. Language IDs can be
// recovered by reading that project; recovery must never create another target.
export const DUBBING_PROJECT_PREFIX = "project:"
export const isDubbingProject = (id: string): boolean => id.startsWith(DUBBING_PROJECT_PREFIX)

/** What a project dub's stored id names: the project, and for a language added to it later, that language. */
export interface ProjectTaskId {
  readonly projectId: string
  readonly languageId?: string
}

/** `project:<project>` is a dub's first language; `project:<project>:<language>` is one added later. */
export function parseProjectTaskId(id: string): ProjectTaskId {
  const [projectId = "", languageId] = id.slice(DUBBING_PROJECT_PREFIX.length).split(":")
  return languageId ? { projectId, languageId } : { projectId }
}

export function projectTaskId(projectId: string, languageId?: string): string {
  return `${DUBBING_PROJECT_PREFIX}${projectId}${languageId ? `:${languageId}` : ""}`
}
