import type { NodaroClientCore } from "../core.js"
import type { GenericEdge, GenericNode } from "@nodaro/shared/types"
import type { WorkflowExport } from "@nodaro/shared/workflow"

/**
 * A workflow's view link — a read-only page of its canvas that anyone holding
 * the link can open without signing in, and an embed of it for other sites.
 * Reached as `client.workflows.viewLink`. Mirrors the backend's
 * `/v1/workflows/:id/view-link` and `/v1/workflow-views/:token` wire contract
 * (`routes/workflow-view-links.ts`, `routes/workflow-views.ts`).
 *
 * Separate from the presentation link (`/present/<token>`), which lets a
 * viewer RUN the workflow and never shows the canvas. The owner's methods are
 * for the workflow's creator only (anyone else: `NotFoundError`). A server
 * that does not have view links yet answers 503 `not_available`.
 */

/** The downloadable copy a view link offers. */
export interface WorkflowViewExportState {
  /** When the copy was saved. Viewers download this copy, not later edits, until it is saved again. */
  exportedAt: string
  /** Whether it carries the characters, locations, objects and creatures the workflow uses (and the canvas's results). */
  includesAssets: boolean
}

export type WorkflowViewLink =
  | { enabled: false }
  | {
      enabled: true
      /**
       * The capability: 43 characters, base64url. The view is
       * `<app origin>/view/<token>`, the embed (for an iframe) `<app origin>/embed/view/<token>`.
       */
      token: string
      /** Whether search engines may index the view. On by default. */
      indexable: boolean
      /** The downloadable copy, or `null` when none is offered. */
      export: WorkflowViewExportState | null
      createdAt: string
    }

/** What a view link shows: the canvas as the public may see it (no secrets, no destinations, no restricted media). */
export interface PublicWorkflowView {
  name: string
  nodes: GenericNode[]
  edges: GenericEdge[]
  indexable: boolean
  export: WorkflowViewExportState | null
}

export interface EnableWorkflowViewLinkInput {
  /**
   * The interface language (an id like `"en"`, `"de"`, `"pt-BR"`, `"he"`):
   * the link's preview on chats and social networks is written in it. An id
   * the server does not know is ignored.
   */
  locale?: string
}

export class WorkflowViewLinkResource {
  constructor(private client: NodaroClientCore) {}

  private path(workflowId: string): string {
    return `/v1/workflows/${encodeURIComponent(workflowId)}/view-link`
  }

  /** The state of your workflow's view link. */
  get(workflowId: string): Promise<WorkflowViewLink> {
    return this.client.request("GET", this.path(workflowId))
  }

  /**
   * Turn the view link on. Idempotent: calling it again returns the same link.
   * A workflow in a workspace, or a server that does not allow public work,
   * answers 422 `share_not_allowed`.
   */
  enable(workflowId: string, input: EnableWorkflowViewLinkInput = {}): Promise<WorkflowViewLink> {
    return this.client.request("POST", this.path(workflowId), { body: input })
  }

  /** Whether search engines may index the view. */
  update(workflowId: string, input: { indexable: boolean }): Promise<WorkflowViewLink> {
    return this.client.request("PATCH", this.path(workflowId), { body: input })
  }

  /**
   * Save (or replace) the copy of the workflow viewers can download and import
   * into their own account. Frozen: viewers get this copy until you save again.
   */
  saveExport(workflowId: string, input: { includeAssets: boolean }): Promise<WorkflowViewLink> {
    return this.client.request("POST", `${this.path(workflowId)}/export`, { body: input })
  }

  /** Stop offering the downloadable copy. */
  removeExport(workflowId: string): Promise<WorkflowViewLink> {
    return this.client.request("DELETE", `${this.path(workflowId)}/export`)
  }

  /** Turn the view link off: the link, its embed and its download stop answering. Turning it on again makes a new link. */
  disable(workflowId: string): Promise<{ enabled: false }> {
    return this.client.request("DELETE", this.path(workflowId))
  }

  /** What a view link shows (`GET /v1/workflow-views/:token`). Takes no credential. */
  read(token: string): Promise<PublicWorkflowView> {
    return this.client.request("GET", `/v1/workflow-views/${encodeURIComponent(token)}`)
  }

  /**
   * The copy a view link offers, in the export format — pass it to
   * `client.workflows.import` to start working on it. Takes no credential.
   * `NotFoundError` when the link offers no copy.
   */
  readExport(token: string): Promise<WorkflowExport> {
    return this.client.request("GET", `/v1/workflow-views/${encodeURIComponent(token)}/export`)
  }
}
