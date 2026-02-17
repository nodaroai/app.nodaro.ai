import { useParams } from "react-router-dom"
import { WorkflowEditor } from "@/components/editor/workflow-editor"

export default function WorkflowEditorPage() {
  const { id, workflowId } = useParams<{ id: string; workflowId: string }>()

  return <WorkflowEditor projectId={id!} workflowId={workflowId!} />
}
