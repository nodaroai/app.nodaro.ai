import type { NodaroClient } from "../client.js"
import type { GenericNode, GenericEdge, WorkflowExport } from "@nodaro/shared"

/**
 * Workflow metadata + (when fetched as a single record) full nodes/edges/settings.
 *
 * The list endpoint returns metadata only; `get`, `create`, and `update` return the
 * full record. `nodes`, `edges`, `settings`, and `sourcePrompt` are present only on
 * full records and omitted in list responses.
 */
export interface Workflow {
  id: string
  projectId: string | null
  userId: string
  name: string
  description?: string | null
  folderId?: string | null
  isTemplate?: boolean
  version?: number
  thumbnailUrl?: string | null
  nodes?: GenericNode[]
  edges?: GenericEdge[]
  settings?: Record<string, unknown>
  sourcePrompt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ListWorkflowsParams {
  /** Required — list endpoint is `/v1/projects/:projectId/workflows`. */
  projectId: string
}

export interface CreateWorkflowInput {
  /** Required — workflow is created under this project. */
  projectId: string
  name: string
  description?: string
  folderId?: string | null
  nodes?: GenericNode[]
  edges?: GenericEdge[]
  settings?: Record<string, unknown>
  sourcePrompt?: string
}

export interface UpdateWorkflowInput {
  name?: string
  description?: string
  folderId?: string | null
  nodes?: GenericNode[]
  edges?: GenericEdge[]
  settings?: Record<string, unknown>
  sourcePrompt?: string
  thumbnailUrl?: string | null
}

export interface RunWorkflowParams {
  /** Optional subset of node IDs to execute. Omit to run the full workflow. */
  nodeIds?: string[]
}

export interface RunWorkflowResult {
  executionId: string
  status: "pending" | "running"
}

export class WorkflowsResource {
  constructor(private client: NodaroClient) {}

  /** List workflows for a project. Returns metadata only — `nodes`/`edges` are not included. */
  list(params: ListWorkflowsParams): Promise<{ data: Workflow[] }> {
    return this.client.request(
      "GET",
      `/v1/projects/${encodeURIComponent(params.projectId)}/workflows`,
    )
  }

  /** Get a workflow including its full nodes/edges/settings. */
  get(id: string): Promise<{ data: Workflow }> {
    return this.client.request("GET", `/v1/workflows/${encodeURIComponent(id)}`)
  }

  /**
   * Get a PUBLICLY-SHARED workflow by id (`GET /v1/public/workflows/:id`) — the
   * unauthenticated share-by-link read. Returns the workflow's nodes/edges/
   * settings ONLY when it's opted into sharing server-side (`settings.studio.shared
   * === true`); otherwise the route 404s (→ `NotFoundError`). No auth required —
   * a share viewer has no session; the SDK omits the bearer when no token exists.
   */
  getPublic(id: string): Promise<{ data: Workflow }> {
    return this.client.request("GET", `/v1/public/workflows/${encodeURIComponent(id)}`)
  }

  /**
   * Create a workflow under a project. Returns the full record.
   * NOTE: server route is `POST /v1/projects/:projectId/workflows`.
   */
  create(input: CreateWorkflowInput): Promise<{ data: Workflow }> {
    const { projectId, ...body } = input
    return this.client.request(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/workflows`,
      { body },
    )
  }

  /** Patch a workflow. Returns the full updated record. */
  update(id: string, input: UpdateWorkflowInput): Promise<{ data: Workflow }> {
    return this.client.request(
      "PATCH",
      `/v1/workflows/${encodeURIComponent(id)}`,
      { body: input },
    )
  }

  /** Delete a workflow. Returns `{ success: true }`. */
  delete(id: string): Promise<{ success: true }> {
    return this.client.request("DELETE", `/v1/workflows/${encodeURIComponent(id)}`)
  }

  /**
   * Run a workflow. Returns the executionId for polling via
   * `client.executions.get(executionId)`.
   */
  run(id: string, params: RunWorkflowParams = {}): Promise<RunWorkflowResult> {
    return this.client.request(
      "POST",
      `/v1/workflows/${encodeURIComponent(id)}/run`,
      { body: params },
    )
  }

  /**
   * Export a workflow as a portable JSON bundle.
   * Pass `opts.assets = true` to include character/object/location entity data.
   */
  export(
    workflowId: string,
    opts?: { assets?: boolean },
  ): Promise<{ data: WorkflowExport }> {
    return this.client.request(
      "GET",
      `/v1/workflows/${encodeURIComponent(workflowId)}/export`,
      { query: { assets: opts?.assets ?? false } },
    )
  }

  /**
   * Import a `WorkflowExport` bundle into the specified project.
   * Re-creates any bundled assets (characters, objects, locations) under your account.
   */
  import(input: WorkflowExport & { projectId: string }): Promise<{ data: Workflow }> {
    const { projectId, ...workflowJson } = input
    return this.client.request("POST", "/v1/workflows/import", {
      body: { projectId, workflow_json: workflowJson },
    })
  }
}
