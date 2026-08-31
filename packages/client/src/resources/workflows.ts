import type { NodaroClient } from "../client.js"
import type {
  GenericNode,
  GenericEdge,
  WorkflowExport,
  WorkflowImportReport,
  WorkflowVisibility,
  CollaboratorRole,
} from "@nodaro/shared"

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
  /**
   * Optimistic concurrency: the `updatedAt` your copy of the workflow was
   * loaded with. When the row has since been written by another tab/device,
   * the update is rejected with HTTP 409 `workflow_conflict`
   * (`WorkflowConflictError`) carrying the current record — re-read/merge and
   * retry instead of last-writer-wins clobbering the other writer's changes.
   * Omit for the legacy unconditional replace.
   */
  expectedUpdatedAt?: string
  /**
   * Optimistic concurrency by monotonic version — preferred over
   * `expectedUpdatedAt` (integer bumped by the DB on every content change).
   */
  expectedVersion?: number
}

export interface RunWorkflowParams {
  /** Optional subset of node IDs to execute. Omit to run the full workflow. */
  nodeIds?: string[]
}

export interface RunWorkflowResult {
  executionId: string
  status: "pending" | "running"
}

/** A person granted access to a workflow. Email is never returned (privacy). */
export interface Collaborator {
  userId: string
  name?: string | null
  avatar?: string | null
  role: CollaboratorRole
}

export interface AddCollaboratorInput {
  /** Provide exactly one of `userId` or `email`. */
  userId?: string
  email?: string
  role: CollaboratorRole
}

/** A workflow someone else shared with you, plus the role you hold on it. */
export interface SharedWorkflow extends Workflow {
  grantedRole: CollaboratorRole
}

/** A grant dropped because a move took the workflow out of the workspace the
 *  access came from. */
export interface DroppedCollaborator {
  userId: string
  name: string | null
}

/**
 * The people a workflow is shared with — reached as `client.workflows.collaborators`.
 * All four endpoints are served by the organizations feature and exist only when
 * it is enabled server-side; against an install without it they 404
 * (→ `NotFoundError`). The active workspace travels on the request like every
 * other call, so a workspace admin's grants apply automatically.
 */
export class WorkflowCollaboratorsResource {
  constructor(private client: NodaroClient) {}

  /** List a workflow's collaborators (id, name, avatar, role — never email). */
  list(workflowId: string): Promise<{ data: Collaborator[] }> {
    return this.client.request(
      "GET",
      `/v1/workflows/${encodeURIComponent(workflowId)}/collaborators`,
    )
  }

  /** Add a collaborator by `userId` OR `email` (exactly one), at the given role. */
  add(
    workflowId: string,
    input: AddCollaboratorInput,
  ): Promise<{ data: { userId: string; role: CollaboratorRole } }> {
    return this.client.request(
      "POST",
      `/v1/workflows/${encodeURIComponent(workflowId)}/collaborators`,
      { body: input },
    )
  }

  /** Change a collaborator's role. */
  update(
    workflowId: string,
    userId: string,
    input: { role: CollaboratorRole },
  ): Promise<{ data: { userId: string; role: CollaboratorRole } }> {
    return this.client.request(
      "PATCH",
      `/v1/workflows/${encodeURIComponent(workflowId)}/collaborators/${encodeURIComponent(userId)}`,
      { body: input },
    )
  }

  /** Remove a collaborator — or yourself. Returns `{ success: true }`. */
  remove(workflowId: string, userId: string): Promise<{ success: true }> {
    return this.client.request(
      "DELETE",
      `/v1/workflows/${encodeURIComponent(workflowId)}/collaborators/${encodeURIComponent(userId)}`,
    )
  }
}

export class WorkflowsResource {
  /** The people this workflow is shared with. See {@link WorkflowCollaboratorsResource}. */
  readonly collaborators: WorkflowCollaboratorsResource

  constructor(private client: NodaroClient) {
    this.collaborators = new WorkflowCollaboratorsResource(client)
  }

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

  /** Delete a workflow. Returns `{ success: true }`. Throws `NotFoundError`
   *  when the id doesn't exist or isn't yours (the delete is not silent). */
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
   * Re-creates any bundled assets (characters, objects, creatures, locations)
   * under your account, and re-points BOTH the entity nodes and every `@`-chip
   * (`ConnectedReference`) bound in the graph at the rows it created.
   * Media the bundle references on other hosts is copied onto this instance's
   * storage where reachable; a bundled entity's images are copied whoever
   * hosts them, because they are the exporter's bytes and their lifecycle is
   * not yours. `importReport` says what was copied, what could not be reached
   * and what was skipped (and why); `assetIdMap` maps each bundled entity id
   * to the row created for it (for chips you hold outside the graph), and
   * `assetsSkipped` names the entities your storage quota left uncreated —
   * the workflow itself still lands.
   */
  import(input: WorkflowExport & { projectId: string }): Promise<{ data: Workflow; importReport?: WorkflowImportReport }> {
    const { projectId, ...workflowJson } = input
    return this.client.request("POST", "/v1/workflows/import", {
      body: { projectId, workflow_json: workflowJson },
    })
  }

  /**
   * Set a workflow's visibility — `"private"` (creator + explicit collaborators)
   * or `"workspace"` (everyone in its workspace). Only the creator or a workspace
   * admin may change it; anyone else gets HTTP 403. Thin wrapper over `update()`:
   * the visibility lever lives on `PATCH /v1/workflows/:id`.
   */
  setVisibility(id: string, visibility: WorkflowVisibility): Promise<{ data: Workflow }> {
    return this.client.request("PATCH", `/v1/workflows/${encodeURIComponent(id)}`, {
      body: { visibility },
    })
  }

  /**
   * Move a workflow to another project (`POST /v1/workflows/:id/move`); its folder
   * is cleared. When the move takes the workflow out of a workspace, collaborator
   * grants that came from that workspace are dropped and returned as
   * `droppedCollaborators`.
   */
  move(
    id: string,
    params: { projectId: string },
  ): Promise<{ data: Workflow; droppedCollaborators: DroppedCollaborator[] }> {
    return this.client.request("POST", `/v1/workflows/${encodeURIComponent(id)}/move`, {
      body: params,
    })
  }

  /**
   * Workflows other people shared with you (`GET /v1/workflows/shared-with-me`) —
   * grants on work that is NOT in a workspace you belong to (workspace work already
   * shows in that workspace's own lists). Each carries the `grantedRole` you hold.
   * Empty when the organizations feature is off server-side.
   */
  sharedWithMe(): Promise<{ data: SharedWorkflow[] }> {
    return this.client.request("GET", "/v1/workflows/shared-with-me")
  }
}
