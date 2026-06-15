import type { DragEndEvent } from "@dnd-kit/core"
import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core"
import type { WorkflowNode } from "@/types/nodes"
import type { PresentationItem } from "@nodaro/shared"
import type { OutputStatus } from "../output-cards/shared"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import type { RunSlot } from "@/components/app-runner/types"

/** Run-slot navigation surface shared by views that page through runs (chat, fullscreen). */
export interface RunSlotsApi {
  slots: RunSlot[]
  activeSlotId: string | null
  handleCreateNew: () => void
  handleDuplicateSlot: (slotId: string) => void
  handleSelectSlot: (slotId: string) => void
}

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
  /** Run-history navigation (app runner) — present for chat + fullscreen. */
  runSlots?: RunSlotsApi
}

export interface EditableViewProps extends ViewProps {
  isEditing: boolean
  sensors: SensorDescriptor<SensorOptions>[]
  handleInputDragEnd: (event: DragEndEvent) => void
  handleOutputDragEnd: (event: DragEndEvent) => void
  handleRemoveNode: (nodeId: string) => void
  /** Remove a specific item (field/node/richtext) from the items list by its sort ID */
  handleRemoveItem: (sortId: string, section: "inputs" | "outputs") => void
  settings: PresentationSettings
  updateCardMeta: (nodeId: string, field: string, value: unknown) => void
  setPickerSection: (section: "inputs" | "outputs") => void
  renderInputCard: (node: WorkflowNode, variant?: "composer") => React.ReactNode
  renderOutputCard: (node: WorkflowNode) => React.ReactNode
  getNodeColumns?: (nodeId: string) => number
  /** Rich items lists (groups, fields, richtext alongside nodes) — null when legacy mode */
  inputItems?: PresentationItem[] | null
  outputItems?: PresentationItem[] | null
  renderInputItem?: (item: PresentationItem) => React.ReactNode
  renderOutputItem?: (item: PresentationItem) => React.ReactNode
  addGroup?: (side: "input" | "output") => void
}
