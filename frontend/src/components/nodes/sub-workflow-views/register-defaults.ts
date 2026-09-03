import { tx } from "@/lib/i18n"
import { PortsView } from "./ports-view"
import { DEFAULT_VIEW_MODE_ID, registerSubWorkflowViewMode } from "./view-mode-registry"

registerSubWorkflowViewMode({
  id: DEFAULT_VIEW_MODE_ID,
  label: "Ports",
  description: tx("node.showInputOutputPortHandles"),
  Component: PortsView,
})
