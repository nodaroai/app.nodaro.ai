import { tx } from "@/lib/i18n"
import { PortsView } from "./ports-view"
import { DEFAULT_VIEW_MODE_ID, registerSubWorkflowViewMode } from "./view-mode-registry"

// Getters, not values: this runs at import time, so a plain tx() here would
// freeze the boot locale — the label resolves on every read instead.
registerSubWorkflowViewMode({
  id: DEFAULT_VIEW_MODE_ID,
  get label() { return tx("cfgext.subwfPorts") },
  get description() { return tx("node.showInputOutputPortHandles") },
  Component: PortsView,
})
