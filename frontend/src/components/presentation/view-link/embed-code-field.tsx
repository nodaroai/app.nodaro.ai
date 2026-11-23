import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { workflowEmbedUrl } from "@/lib/public-links"
import { DEFAULT_EMBED_HEIGHT, DEFAULT_EMBED_WIDTH, workflowEmbedCode } from "@/lib/workflow-view-embed"
import { CopyField } from "./copy-field"

/** The embed snippet, with the size the owner wants it at. */
export function EmbedCodeField({ token, title }: { readonly token: string; readonly title: string }) {
  const t = useT()
  const [width, setWidth] = useState(DEFAULT_EMBED_WIDTH)
  const [height, setHeight] = useState(DEFAULT_EMBED_HEIGHT)
  const code = useMemo(
    () => workflowEmbedCode({ embedUrl: workflowEmbedUrl(token), width, height, title }),
    [token, width, height, title],
  )
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-medium">{t("workflowView.embedLabel")}</p>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t("workflowView.embedWidth")}
          <Input value={width} onChange={(e) => setWidth(e.target.value)} className="h-7 w-16 text-xs" aria-label={t("workflowView.embedWidth")} />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t("workflowView.embedHeight")}
          <Input value={height} onChange={(e) => setHeight(e.target.value)} className="h-7 w-16 text-xs" aria-label={t("workflowView.embedHeight")} />
        </label>
      </div>
      <CopyField value={code} label={t("workflowView.embedLabel")} multiline />
    </div>
  )
}
