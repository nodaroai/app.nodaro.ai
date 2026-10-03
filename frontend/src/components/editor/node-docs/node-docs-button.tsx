import { CircleHelp } from "lucide-react"
import { useT } from "@/lib/i18n"
import { nodeDocsLinksShown, useNodeDocsUrl } from "@/lib/node-docs/node-docs"

/**
 * The "?" in a node's header toolbar, between PRESET and the ••• menu. It opens
 * the node's docs page in a new tab. `size` follows the toolbar's canvas-zoom
 * scale, like the ••• icon beside it.
 */
export function NodeDocsButton({ nodeType, size }: { readonly nodeType: string; readonly size: number }) {
  const t = useT()
  const docsUrl = useNodeDocsUrl()
  if (!nodeDocsLinksShown()) return null
  return (
    <a
      href={docsUrl(nodeType)}
      target="_blank"
      rel="noopener"
      className="node-more-menu-btn inline-flex text-muted-foreground transition-colors"
      aria-label={t("nodeDocs.openDocsAria")}
      title={t("nodeDocs.learnAboutNode")}
    >
      <CircleHelp size={size} />
    </a>
  )
}
