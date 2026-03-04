import type { DragEndEvent } from "@dnd-kit/core"
import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core"
import type { WorkflowNode } from "@/types/nodes"
import type { OutputStatus } from "../output-cards/shared"
import type { PresentationSettings } from "@/hooks/use-workflow-store"

export interface ViewProps {
  orderedInputNodes: WorkflowNode[]
  orderedOutputNodes: WorkflowNode[]
  getNodeStatus: (nodeId: string) => OutputStatus
  getResult: (nodeId: string) => { url?: string; text?: string }
  getCardTitle: (node: WorkflowNode) => string
}

export interface EditableViewProps extends ViewProps {
  isEditing: boolean
  sensors: SensorDescriptor<SensorOptions>[]
  handleInputDragEnd: (event: DragEndEvent) => void
  handleOutputDragEnd: (event: DragEndEvent) => void
  handleRemoveNode: (nodeId: string) => void
  settings: PresentationSettings
  updateCardMeta: (nodeId: string, field: "title" | "description", value: string) => void
  setPickerSection: (section: "inputs" | "outputs") => void
  renderInputCard: (node: WorkflowNode) => React.ReactNode
  renderOutputCard: (node: WorkflowNode) => React.ReactNode
}
