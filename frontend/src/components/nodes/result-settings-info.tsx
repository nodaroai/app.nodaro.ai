"use client"

import { useState, type ReactNode } from "react"
import { Copy, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { copyToClipboard } from "@/lib/utils"
import type { ResultGenerationSettings } from "@/hooks/use-result-generation-settings"

export interface ResultSummaryRow {
  readonly label: string
  readonly value: string
}

interface ResultSettingsInfoProps {
  /** One-line text for the pill (e.g. "Kling 3.0 · 16:9 · 1080p · 5s"). */
  readonly summary: string
  /** Optional glyph rendered after the summary text (e.g. an audio indicator). */
  readonly summaryTrailing?: ReactNode
  /** Rows shown in the apply dialog's settings card. */
  readonly rows: readonly ResultSummaryRow[]
  /** The job's recorded settings — gates the apply buttons + final-prompt block. */
  readonly settings: ResultGenerationSettings | undefined
  readonly isLoading: boolean
  /** Media noun for the dialog copy ("image" / "video"). */
  readonly mediaNoun: string
  /** Apply handler — the caller writes the node-data patch + toasts. */
  readonly onApply: (includePrompt: boolean) => void
}

/**
 * Shared hover-pill + apply dialog used by Generate Image and Generate Video
 * result overlays. Shows the model / aspect / … that produced THIS output
 * (read from its job's `input_data`, so it stays correct after node settings
 * change or across multi-provider runs). Clicking offers to re-apply those
 * settings to the node — configuration only, or configuration plus the prompt.
 *
 * Presentational only: the caller resolves `summary`/`rows` (model labels are
 * per-media) and owns `onApply`; this component owns the open/close state and
 * the dialog chrome so the two nodes can never drift apart.
 */
export function ResultSettingsInfo({
  summary,
  summaryTrailing,
  rows,
  settings,
  isLoading,
  mediaNoun,
  onApply,
}: ResultSettingsInfoProps) {
  const [open, setOpen] = useState(false)

  function apply(includePrompt: boolean) {
    if (!settings) return
    onApply(includePrompt)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Settings used for this output: ${summary}. Click to apply them to this node.`}
        title="Settings used for this output — click to apply to the node"
        className="flex items-center gap-1 max-w-[200px] px-2 py-1 bg-black/55 hover:bg-black/75 border border-white/10 text-white rounded-full shadow-sm backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <Sparkles className="w-3 h-3 shrink-0 opacity-80" />
        <span className="text-[10px] font-medium leading-none truncate">{summary}</span>
        {summaryTrailing}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[440px]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="text-primary">Apply this output&apos;s settings?</DialogTitle>
            <DialogDescription>
              {isLoading
                ? "Loading the settings that produced this output…"
                : settings
                  ? `Override this node's current configuration with the settings that produced this ${mediaNoun}.`
                  : "The original settings for this output are no longer available."}
            </DialogDescription>
          </DialogHeader>

          {settings && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
                {rows.map((r) => (
                  <SummaryRow key={r.label} label={r.label} value={r.value} />
                ))}
              </div>
              {settings.finalPrompt && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Final prompt used
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(settings.finalPrompt!, "Prompt copied")}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy prompt"
                      aria-label="Copy final prompt"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </button>
                  </div>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap break-words text-foreground/90">
                    {settings.finalPrompt}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {settings ? (
              <>
                <Button variant="outline" className="sm:flex-1" onClick={() => apply(true)}>
                  Configuration + Prompt
                </Button>
                <Button className="sm:flex-1" onClick={() => apply(false)}>
                  Configuration only
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
