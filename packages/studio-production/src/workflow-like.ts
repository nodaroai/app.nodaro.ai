import type { GenericEdge, GenericNode } from "@nodaro/shared"

/**
 * A workflow row, structurally — what the production codec reads and writes.
 *
 * The studio app hands the codec the SDK's `Workflow`; the platform hands it a
 * Supabase row. Neither type may be imported here: the SDK is a CONSUMER of
 * this package (a dependency the other way inverts the direction and pulls a
 * browser client into the backend's import graph), and the database row is the
 * backend's own. A structural type is what both satisfy.
 *
 * `nodes` / `edges` / `settings` are the three fields the codec actually reads —
 * `parseProduction` takes them apart and `serializeProduction` puts them back.
 * The identity fields are optional and present only so a caller can hand the
 * whole row across without narrowing it first; the view (`toProductionView`)
 * asks for the ones it needs by intersection.
 */
export interface WorkflowLike {
  id: string
  name: string
  nodes?: GenericNode[]
  edges?: GenericEdge[]
  settings?: Record<string, unknown>
  thumbnailUrl?: string | null
  projectId?: string | null
  userId?: string
  description?: string | null
  folderId?: string | null
  isTemplate?: boolean
  version?: number
  sourcePrompt?: string | null
  createdAt?: string
  updatedAt?: string
}
