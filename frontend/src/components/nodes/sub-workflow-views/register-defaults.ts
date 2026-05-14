import { PortsView } from "./ports-view"
import { DEFAULT_VIEW_MODE_ID, registerSubWorkflowViewMode } from "./view-mode-registry"

registerSubWorkflowViewMode({
  id: DEFAULT_VIEW_MODE_ID,
  label: "Ports",
  description: "Show input/output port handles + status + preview",
  Component: PortsView,
})
