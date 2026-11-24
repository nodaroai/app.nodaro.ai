import { Download } from "lucide-react"
import { useT, formatDate } from "@/lib/i18n"
import { workflowViewExportPath, type WorkflowViewExport } from "@/lib/api"
import { publicLinkOrigin } from "@/lib/public-links"
import { surfaceBrandName } from "@/lib/surface-selectors"
import { CopyToAccountButton } from "./copy-to-account-button"

interface ViewTopBarProps {
  readonly token: string
  readonly name: string
  readonly exported: WorkflowViewExport | null
  /** The maker link: left out where the site header above already names the maker. */
  readonly showMadeWith?: boolean
}

/**
 * The view page's slim bar: the workflow's name, the maker link, and, where
 * the owner saved a copy, the file to download and the button that copies it
 * into the visitor's own account.
 */
export function ViewTopBar({ token, name, exported, showMadeWith = true }: ViewTopBarProps) {
  const t = useT()
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-x-3 gap-y-1 border-b border-border bg-background/95 px-4 py-2">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={name}>
        {name || t("common.untitled")}
      </h1>
      {exported && (
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("workflowView.downloadNote", { date: formatDate(exported.exportedAt, { dateStyle: "medium" }) })}
          </span>
          <a
            href={workflowViewExportPath(token)}
            download
            rel="nofollow"
            title={t("workflowView.downloadNote", { date: formatDate(exported.exportedAt, { dateStyle: "medium" }) })}
            aria-label={t("workflowView.downloadWorkflow")}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("workflowView.downloadWorkflow")}</span>
          </a>
          <CopyToAccountButton token={token} />
        </div>
      )}
      {showMadeWith && (
      <a
        href={publicLinkOrigin()}
        target="_blank"
        rel="noopener"
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
      >
        {t("workflowView.madeWith", { brand: surfaceBrandName() })}
      </a>
      )}
    </header>
  )
}
