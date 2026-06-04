"use client"

import { useState } from "react"
import { Copy, Sparkles } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  useResultGenerationSettings,
  buildAppliedConfigPatch,
} from "@/hooks/use-result-generation-settings"
import { IMAGE_GEN_MODELS } from "@/components/editor/config-panels/model-options"
import { copyToClipboard } from "@/lib/utils"
import type { GeneratedResult, GenerateImageData } from "@/types/nodes"

interface GenerateImageResultInfoProps {
  readonly nodeId: string
  /** The active result whose generation settings to surface. */
  readonly result: GeneratedResult | undefined
  /** Current node data — fallback for display when the job is unavailable. */
  readonly data: GenerateImageData
}

function modelLabelFor(provider: string | undefined): string {
  if (!provider) return "—"
  return IMAGE_GEN_MODELS.find((m) => m.value === provider)?.label ?? provider
}

/**
 * Hover-revealed pill at the bottom-right of a Generate Image result. Shows the
 * model / aspect / resolution that produced THIS output (read from its job's
 * `input_data`, so it stays correct even after node settings change or across
 * multi-provider runs). Clicking it offers to re-apply those settings to the
 * node — configuration only, or configuration plus the prompt & negative.
 */
export function GenerateImageResultInfo({
  nodeId,
  result,
  data,
}: GenerateImageResultInfoProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [open, setOpen] = useState(false)
  const jobId = result?.jobId && result.jobId.length > 0 ? result.jobId : undefined
  const { data: settings, isLoading } = useResultGenerationSettings(jobId)

  // Prefer the job's actual settings (drift-proof, correct per-result); fall
  // back to the node's current config for legacy/purged jobs so the pill
  // always shows something sensible.
  const provider = settings?.provider ?? data.provider
  const aspect = settings?.aspectRatio ?? data.aspectRatio
  const resolution = settings?.resolution ?? data.resolution
  const model = modelLabelFor(provider)
  const summary = [model, aspect, resolution].filter(Boolean).join(" · ")

  function apply(includePrompt: boolean) {
    if (!settings) return
    updateNodeData(nodeId, buildAppliedConfigPatch(settings, { includePrompt }))
    toast.success(includePrompt ? "Applied settings + prompt" : "Applied settings")
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
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-[440px]"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="text-primary">Apply this output&apos;s settings?</DialogTitle>
            <DialogDescription>
              {isLoading
                ? "Loading the settings that produced this output…"
                : settings
                  ? "Override this node's current configuration with the settings that produced this image."
                  : "The original settings for this output are no longer available."}
            </DialogDescription>
          </DialogHeader>

          {settings && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
                <SummaryRow label="Model" value={model} />
                {aspect && <SummaryRow label="Aspect" value={aspect} />}
                {resolution && <SummaryRow label="Resolution" value={resolution} />}
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
