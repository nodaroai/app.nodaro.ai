import { PortsView } from "./ports-view"
import { registerSubWorkflowViewMode } from "./view-mode-registry"

registerSubWorkflowViewMode({
  id: "default",
  label: "Ports",
  description: "Show input/output port handles + status + preview",
  Component: PortsView,
})
