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
  /** Open a shared media lightbox navigable across all items */
  onOpenMedia?: (nodeId: string) => void
  /** Open config modal for config-type nodes */
  onOpenConfig?: (node: WorkflowNode) => void
}

export interface EditableViewProps extends ViewProps {
  isEditing: boolean
  sensors: SensorDescriptor<SensorOptions>[]
  handleInputDragEnd: (event: DragEndEvent) => void
  handleOutputDragEnd: (event: DragEndEvent) => void
  handleRemoveNode: (nodeId: string) => void
  settings: PresentationSettings
  updateCardMeta: (nodeId: string, field: string, value: unknown) => void
  setPickerSection: (section: "inputs" | "outputs") => void
  renderInputCard: (node: WorkflowNode) => React.ReactNode
  renderOutputCard: (node: WorkflowNode) => React.ReactNode
  getNodeColumns?: (nodeId: string) => number
}
