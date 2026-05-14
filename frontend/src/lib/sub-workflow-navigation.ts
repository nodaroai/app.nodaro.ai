/**
 * Shared helpers for navigating into a sub-workflow from anywhere in the UI.
 *
 * Approach A (v1): we push a frame onto the breadcrumb stack and route-navigate
 * to the child workflow's editor URL. The existing editor page re-renders
 * against the child workflow's data; the breadcrumb sits above the canvas
 * whenever the stack is non-empty.
 */

import { useSubWorkflowStack, type SubWorkflowStackFrame } from "@/hooks/use-sub-workflow-stack"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export interface OpenSubWorkflowArgs {
  readonly childWorkflowId: string
  readonly childWorkflowName: string
  readonly childProjectId: string
  /** `useNavigate()` from react-router. Caller supplies it so this stays a pure function. */
  readonly navigate: (href: string) => void
  /** Optional query-string suffix (e.g. `"?focusType=sub-workflow-input"`). */
  readonly extraQuery?: string
}

/**
 * Open a sub-workflow in the editor.
 *
 * - Captures the current workflow as `rootFrame` if the stack is empty
 *   (first push wins, so further nested navigations keep the original parent
 *   as the breadcrumb root).
 * - Pushes the child frame onto the stack.
 * - Navigates to `/projects/<childProjectId>/workflows/<childWorkflowId>`.
 */
export function openSubWorkflow(args: OpenSubWorkflowArgs): void {
  const { childWorkflowId, childWorkflowName, childProjectId, navigate, extraQuery } = args

  const store = useSubWorkflowStack.getState()
  const wfStore = useWorkflowStore.getState()

  // If the stack is empty, capture the CURRENT workflow as the root.
  if (store.stack.length === 0 && store.rootFrame === null) {
    if (wfStore.workflowId) {
      store.setRoot({
        workflowId: wfStore.workflowId,
        workflowName: wfStore.workflowName,
      })
    }
  }

  store.push({
    workflowId: childWorkflowId,
    workflowName: childWorkflowName || "Untitled Workflow",
  })

  navigate(`/projects/${childProjectId}/workflows/${childWorkflowId}${extraQuery ?? ""}`)
}

/**
 * Jump to a specific workflow in the breadcrumb stack — used by intermediate
 * crumb clicks. Pops the stack to (and including) the target, then navigates.
 */
export function jumpToBreadcrumb(args: {
  readonly workflowId: string
  readonly projectId: string
  readonly navigate: (href: string) => void
}): void {
  const { workflowId, projectId, navigate } = args
  useSubWorkflowStack.getState().popTo(workflowId)
  navigate(`/projects/${projectId}/workflows/${workflowId}`)
}

/**
 * Jump to the breadcrumb root (the original parent that opened the FIRST
 * sub-workflow). Clears the stack entirely.
 */
export function jumpToBreadcrumbRoot(args: {
  readonly rootFrame: SubWorkflowStackFrame
  readonly projectId: string
  readonly navigate: (href: string) => void
}): void {
  const { rootFrame, projectId, navigate } = args
  useSubWorkflowStack.getState().clear()
  navigate(`/projects/${projectId}/workflows/${rootFrame.workflowId}`)
}
