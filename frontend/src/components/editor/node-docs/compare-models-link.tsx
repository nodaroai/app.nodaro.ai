import { ArrowUpRight } from "lucide-react"
import { useT } from "@/lib/i18n"
import { nodeDocsHasSection, nodeDocsLinksShown, useNodeDocsUrl } from "@/lib/node-docs/node-docs"
import { useNodeDocsType } from "./node-docs-context"

/**
 * "Compare models ↗" beside the heading of a node's model picker, to the
 * `#models` section of its docs page. It shows only inside the editor's
 * settings panel, and only when the node's page has that section.
 */
export function CompareModelsLink() {
  const t = useT()
  const nodeType = useNodeDocsType()
  const docsUrl = useNodeDocsUrl()
  if (!nodeDocsLinksShown() || !nodeType || !nodeDocsHasSection(nodeType, "models")) return null
  return (
    <a
      href={docsUrl(nodeType, "models")}
      target="_blank"
      rel="noopener"
      className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-[#ff0073] hover:underline"
    >
      {t("nodeDocs.compareModels")}
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  )
}
