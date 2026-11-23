import { useCallback, useState } from "react"
import { Eye, Link2Off, Loader2 } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useT, tx } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import {
  enableWorkflowViewLink,
  exportWorkflowViewFile,
  getWorkflowViewLink,
  isNotAvailableError,
  removeWorkflowViewFile,
  revokeWorkflowViewLink,
  setWorkflowViewIndexable,
  type WorkflowViewLinkState,
} from "@/lib/api"
import { workflowViewUrl } from "@/lib/public-links"
import { CopyField } from "./copy-field"
import { EmbedCodeField } from "./embed-code-field"
import { ExportFileControls } from "./export-file-controls"

interface ViewLinkSectionProps {
  readonly workflowId: string
  readonly workflowName: string
  /** Asked only while the share dialog is open. */
  readonly active: boolean
}

function isRefusedError(err: unknown): boolean {
  const code = err instanceof Error ? (err as { code?: unknown }).code : undefined
  return code === "forbidden" || code === "not_found"
}

type Busy = "enable" | "indexable" | "export" | "revoke" | null

/** "Share the canvas (view only)": a read-only link to the whole canvas, its embed, and an optional saved copy to download. */
export function ViewLinkSection({ workflowId, workflowName, active }: ViewLinkSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<Busy>(null)
  const [notAvailable, setNotAvailable] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)

  const { data, error, isLoading } = useQuery({
    queryKey: ["workflow-view-link", workflowId],
    queryFn: () => getWorkflowViewLink(workflowId),
    enabled: active,
    staleTime: 30_000,
    retry: false,
  })

  const run = useCallback(
    async (kind: Exclude<Busy, null>, call: () => Promise<WorkflowViewLinkState>, done?: string) => {
      setBusy(kind)
      try {
        const next = await call()
        queryClient.setQueryData(["workflow-view-link", workflowId], next)
        if (done) toast.success(done)
      } catch (err) {
        if (isNotAvailableError(err)) setNotAvailable(true)
        else toast.error(err instanceof Error ? err.message : tx("workflowView.actionFailed"))
      } finally {
        setBusy(null)
      }
    },
    [queryClient, workflowId],
  )

  const handleEnable = () => run("enable", () => enableWorkflowViewLink(workflowId, useLocaleStore.getState().locale))
  const handleIndexable = (indexable: boolean) => run("indexable", () => setWorkflowViewIndexable(workflowId, indexable))
  const handleSaveFile = (includeAssets: boolean) => run("export", () => exportWorkflowViewFile(workflowId, includeAssets), tx("workflowView.exportSaved"))
  const handleRemoveFile = () => run("export", () => removeWorkflowViewFile(workflowId))
  const handleRevoke = async () => {
    await run("revoke", () => revokeWorkflowViewLink(workflowId), tx("workflowView.revoked"))
    setConfirmingRevoke(false)
  }

  const unavailable = notAvailable || isNotAvailableError(error)
  // Only the workflow's creator manages its view link; a collaborator is
  // refused, and the section is simply not theirs to see.
  if (isRefusedError(error)) return null

  return (
    <section className="space-y-3" aria-labelledby="view-link-heading">
      <div>
        <h3 id="view-link-heading" className="flex items-center gap-1.5 text-sm font-medium">
          <Eye className="h-4 w-4" />
          {t("workflowView.sectionTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("workflowView.sectionDesc")}</p>
      </div>

      {unavailable ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t("workflowView.notAvailableOwner")}</p>
      ) : isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
      ) : error ? (
        <p className="text-xs text-destructive">{t("workflowView.loadStateFailed")}</p>
      ) : !data?.enabled ? (
        <Button variant="outline" size="sm" className="w-full" onClick={handleEnable} disabled={busy !== null}>
          {busy === "enable" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Eye className="me-2 h-4 w-4" />}
          {t("workflowView.enable")}
        </Button>
      ) : (
        <div className="space-y-3">
          <CopyField value={workflowViewUrl(data.token)} label={t("workflowView.linkLabel")} />
          <EmbedCodeField token={data.token} title={workflowName} />

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t("workflowView.indexableLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("workflowView.indexableHint")}</p>
            </div>
            <Switch
              checked={data.indexable}
              disabled={busy !== null}
              onCheckedChange={handleIndexable}
              aria-label={t("workflowView.indexableLabel")}
            />
          </div>

          <ExportFileControls
            exported={data.export}
            busy={busy === "export"}
            onSave={handleSaveFile}
            onRemove={handleRemoveFile}
          />

          {confirmingRevoke ? (
            <div className="space-y-2 rounded-md border border-destructive/40 p-2.5">
              <p className="text-xs">{t("workflowView.revokeConfirm")}</p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" className="flex-1" onClick={handleRevoke} disabled={busy !== null}>
                  {busy === "revoke" && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />}
                  {t("workflowView.revokeConfirmYes")}
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmingRevoke(false)} disabled={busy !== null}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full text-destructive" onClick={() => setConfirmingRevoke(true)} disabled={busy !== null}>
              <Link2Off className="me-2 h-4 w-4" />
              {t("workflowView.revoke")}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
