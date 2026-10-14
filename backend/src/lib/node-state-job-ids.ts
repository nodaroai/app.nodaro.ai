/** The job references a node state carries. */
export interface NodeStateJobRefs {
  jobId?: unknown
  jobIds?: unknown
}

/**
 * The job ids an execution's node states name: each node's `jobId`, and a
 * fan-out's `jobIds`. A pointer, not proof — every reader filters the jobs it
 * reads by owner. The way an outer run reaches a use-case node's wrapper
 * (never stamped with the run's `workflow_execution_id`).
 */
export function jobIdsOf(nodeStates: Record<string, unknown> | null | undefined): string[] {
  const ids = new Set<string>()
  for (const raw of Object.values(nodeStates ?? {})) {
    const st = raw as NodeStateJobRefs | null
    if (typeof st?.jobId === "string" && st.jobId) ids.add(st.jobId)
    if (Array.isArray(st?.jobIds)) for (const id of st.jobIds) if (typeof id === "string" && id) ids.add(id)
  }
  return [...ids]
}

