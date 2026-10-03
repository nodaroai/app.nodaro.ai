import { useState } from "react"
import { ArrowUpRight, CircleHelp } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { nodeDocsLinksShown, nodeDocsSections, useNodeDocsSummary, useNodeDocsUrl } from "@/lib/node-docs/node-docs"
import { NODE_DOCS_SECTION_LABELS } from "./node-docs-context"

/**
 * The "Docs" pill in the settings panel header, left of the expand and close
 * icons. A click opens the page's Settings section (the whole page when it has
 * none). Hovering shows the node's name, its one-line summary (English only),
 * a chip per section of its page, and a link to the whole page. Touch has no
 * hover, so a tap simply opens the page.
 */
export function NodeDocsPill({ nodeType, nodeLabel }: { readonly nodeType: string; readonly nodeLabel: string }) {
  const t = useT()
  const docsUrl = useNodeDocsUrl()
  const [open, setOpen] = useState(false)
  const sections = nodeDocsSections(nodeType)
  const summary = useNodeDocsSummary(nodeType, open)
  const main = sections.includes("settings") ? "settings" : undefined
  if (!nodeDocsLinksShown()) return null

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <a
          href={docsUrl(nodeType, main)}
          target="_blank"
          rel="noopener"
          aria-label={t("nodeDocs.openDocsAria")}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-[#ff0073]/40 px-2 text-xs font-medium text-[#ff0073] transition-colors hover:bg-[#ff0073]/10"
        >
          <CircleHelp className="size-3.5" aria-hidden />
          {t("nodeDocs.docs")}
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold">{nodeLabel}</p>
          {summary && <p className="text-xs leading-relaxed text-muted-foreground">{summary}</p>}
        </div>
        {sections.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sections.map((section) => (
              <a
                key={section}
                href={docsUrl(nodeType, section)}
                target="_blank"
                rel="noopener"
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs transition-colors hover:border-[#ff0073] hover:text-[#ff0073]",
                  section === main && "border-[#ff0073] text-[#ff0073]",
                )}
              >
                {t(NODE_DOCS_SECTION_LABELS[section])}
              </a>
            ))}
          </div>
        )}
        <a
          href={docsUrl(nodeType)}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-between border-t pt-2.5 text-sm font-medium text-[#ff0073] hover:underline"
        >
          {t("nodeDocs.openFullDocs")}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      </HoverCardContent>
    </HoverCard>
  )
}
