/**
 * `@nodaro/sdk/workflows` — the `workflows` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type {
  GenericNode,
  GenericEdge,
} from "@nodaro/shared/types"

export type {
  WorkflowExport,
  WorkflowExportCharacter,
  WorkflowExportObject,
  WorkflowExportLocation
} from "@nodaro/shared/workflow"

export { WorkflowsResource } from "../resources/workflows.js"

export type {
  Workflow,
  ListWorkflowsParams,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  RunWorkflowParams,
  RunWorkflowResult,
  RenderFinalParams,
  RenderFinalQuote,
} from "../resources/workflows.js"

export type { Collaborator, AddCollaboratorInput, SharedWorkflow, DroppedCollaborator } from "../resources/workflows.js"
