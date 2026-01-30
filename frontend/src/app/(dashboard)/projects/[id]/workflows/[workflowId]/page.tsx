"use client"

import { use } from "react"
import { WorkflowEditor } from "@/components/editor/workflow-editor"

export default function WorkflowEditorPage({
  params,
}: {
  readonly params: Promise<{ id: string; workflowId: string }>
}) {
  const { id, workflowId } = use(params)

  return <WorkflowEditor projectId={id} workflowId={workflowId} />
}
