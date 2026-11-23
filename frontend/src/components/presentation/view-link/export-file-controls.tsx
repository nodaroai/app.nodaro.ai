import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { useT, formatDateTime } from "@/lib/i18n"
import type { WorkflowViewExport } from "@/lib/api"

interface ExportFileControlsProps {
  readonly exported: WorkflowViewExport | null
  readonly busy: boolean
  readonly onSave: (includeAssets: boolean) => void
  readonly onRemove: () => void
}

/**
 * The downloadable copy of the workflow. Off by default; turning it on asks
 * whether the copy carries the characters, locations and objects it uses,
 * then saves it. Viewers get that saved copy, never later edits.
 */
export function ExportFileControls({ exported, busy, onSave, onRemove }: ExportFileControlsProps) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  const [includeAssets, setIncludeAssets] = useState(exported?.includesAssets ?? false)
  const on = exported !== null || asking

  const handleToggle = (checked: boolean) => {
    if (checked) {
      setIncludeAssets(false)
      setAsking(true)
      return
    }
    setAsking(false)
    if (exported) onRemove()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("workflowView.exportLabel")}</p>
          <p className="text-xs text-muted-foreground">{t("workflowView.exportHint")}</p>
        </div>
        <Switch checked={on} disabled={busy} onCheckedChange={handleToggle} aria-label={t("workflowView.exportLabel")} />
      </div>
      {on && (
        <div className="space-y-2 rounded-md border border-border p-2.5">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={includeAssets} onCheckedChange={(v) => setIncludeAssets(v === true)} disabled={busy} />
            {t("workflowView.exportIncludeAssets")}
          </label>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {exported
                ? t("workflowView.exportSavedOn", { date: formatDateTime(exported.exportedAt, { dateStyle: "medium", timeStyle: "short" }) })
                : t("workflowView.exportNotSaved")}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => { setAsking(false); onSave(includeAssets) }}
            >
              {busy && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />}
              {exported ? t("workflowView.exportUpdate") : t("workflowView.exportSave")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
