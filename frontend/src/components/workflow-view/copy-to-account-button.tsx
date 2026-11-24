import { Copy, Loader2, LogIn } from "lucide-react"
import { Link } from "react-router-dom"
import { useCachedUserId } from "@/hooks/use-auth"
import { useImportWorkflowJson } from "@/hooks/use-import-workflow-json"
import { workflowViewExportPath } from "@/lib/api"
import { useT } from "@/lib/i18n"

const BUTTON =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-cta px-2.5 text-xs font-medium text-primary-foreground hover:bg-cta-hover disabled:opacity-60"

/** The saved copy's text, read without the session: the token is the credential. */
async function readSavedCopy(token: string): Promise<string> {
  const res = await fetch(workflowViewExportPath(token), { credentials: "omit" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * A view page's "make it mine" button, shown where the owner saved a
 * downloadable copy. Signed in: that saved copy (never the live canvas) is
 * imported into the visitor's own account, exactly as the downloaded file
 * would be, and opens in the editor. Signed out: a link to sign in that comes
 * back to this page.
 */
export function CopyToAccountButton({ token }: { readonly token: string }) {
  const t = useT()
  const userId = useCachedUserId()
  const { importFrom, isImporting } = useImportWorkflowJson()

  if (!userId) {
    return (
      <Link to={`/login?redirect=${encodeURIComponent(`/view/${token}`)}`} className={BUTTON} title={t("workflowView.signInToCopy")}>
        <LogIn className="h-3.5 w-3.5" />
        <span className="max-sm:sr-only">{t("workflowView.signInToCopy")}</span>
      </Link>
    )
  }

  return (
    <button type="button" className={BUTTON} disabled={isImporting} onClick={() => void importFrom(() => readSavedCopy(token))}>
      {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="max-sm:sr-only">{isImporting ? t("workflowView.copyingToAccount") : t("workflowView.copyToAccount")}</span>
    </button>
  )
}
