import { createContext, useContext } from "react"
import type { MessageKey } from "@/lib/i18n"
import type { NodeDocsSection } from "@/lib/node-docs/node-docs"

/**
 * The type of the node whose settings panel is open. The editor's panel
 * provides it, so a docs link deep inside a config panel (the model picker's
 * "Compare models") knows which node's page to open. Outside that panel (a
 * published app's node modal, a dialog of another feature) it is null and the
 * links hide.
 */
export const NodeDocsTypeContext = createContext<string | null>(null)

export function useNodeDocsType(): string | null {
  return useContext(NodeDocsTypeContext)
}

/** The chip label of each page section. */
export const NODE_DOCS_SECTION_LABELS: Readonly<Record<NodeDocsSection, MessageKey>> = {
  "when-to-use": "nodeDocs.sectionWhenToUse",
  "quick-start": "nodeDocs.sectionQuickStart",
  inputs: "nodeDocs.sectionInputs",
  outputs: "nodeDocs.sectionOutputs",
  settings: "nodeDocs.sectionSettings",
  models: "nodeDocs.sectionModels",
  credits: "nodeDocs.sectionCredits",
  tips: "nodeDocs.sectionTips",
  troubleshooting: "nodeDocs.sectionTroubleshooting",
  api: "nodeDocs.sectionApi",
  limits: "nodeDocs.sectionLimits",
  faq: "nodeDocs.sectionFaq",
}
