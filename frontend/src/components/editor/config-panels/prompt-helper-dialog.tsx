"use client"

import { useState } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { enhancePrompt } from "@/lib/api"
import { useModelCredits } from "@/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro-shared/llm-models"
import { getStylesForNodeType } from "./prompt-helper-styles"
import { LlmModelSelect } from "./llm-model-select"

interface PromptHelperDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly nodeType: string
  readonly currentPrompt: string
  readonly provider?: string
  readonly aspectRatio?: string
  readonly duration?: number
  readonly onAccept: (enhancedPrompt: string) => void
}

export function PromptHelperDialog({
  open,
  onClose,
  nodeType,
  currentPrompt,
  provider,
  aspectRatio,
  duration,
  onAccept,
}: PromptHelperDialogProps) {
  const [style, setStyle] = useState("__none__")
  const [llmModel, setLlmModel] = useState<string | undefined>(undefined)
  const [additionalContext, setAdditionalContext] = useState("")
  const [enhancedPrompt, setEnhancedPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const effectiveModel = llmModel || LLM_FEATURE_DEFAULTS["prompt-helper"]
  const creditCost = useModelCredits(buildLlmCreditIdentifier("prompt-helper", effectiveModel), 1)

  const styles = getStylesForNodeType(nodeType)

  async function handleEnhance() {
    setLoading(true)
    setError("")
    setEnhancedPrompt("")
    try {
      const result = await enhancePrompt({
        nodeType,
        prompt: currentPrompt,
        provider: provider || undefined,
        llmModel,
        style: style !== "__none__" ? style : undefined,
        aspectRatio: aspectRatio || undefined,
        duration: duration || undefined,
        additionalContext: additionalContext || undefined,
      })
      setEnhancedPrompt(result.enhancedPrompt)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enhancement failed")
    } finally {
      setLoading(false)
    }
  }

  function handleAccept() {
    onAccept(enhancedPrompt)
    handleClose()
  }

  function handleClose() {
    setStyle("__none__")
    setLlmModel(undefined)
    setAdditionalContext("")
    setEnhancedPrompt("")
    setError("")
    setLoading(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#ff0073]" />
            AI Prompt Helper
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Node context badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{nodeType}</span>
            {provider && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{provider}</span>}
          </div>

          {/* Current prompt (readonly) */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Current Prompt</label>
            <div className="text-xs bg-muted/50 rounded-md px-2.5 py-2 max-h-20 overflow-y-auto break-words whitespace-pre-wrap border">
              {currentPrompt || <span className="text-muted-foreground/60 italic">Empty — describe what you want below</span>}
            </div>
          </div>

          {/* Style dropdown */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Style</label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="No style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No style</SelectItem>
                {styles.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* AI Model */}
          <LlmModelSelect
            feature="prompt-helper"
            value={llmModel}
            onChange={setLlmModel}
          />

          {/* Additional context */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">What do you want to achieve?</label>
            <Textarea
              rows={2}
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value)}
              placeholder="e.g. make it more dramatic, add golden hour lighting, focus on the eyes..."
              className="text-xs resize-none"
              maxLength={1000}
            />
          </div>

          {/* Enhance button */}
          {!enhancedPrompt && (
            <Button
              onClick={handleEnhance}
              disabled={loading || (!currentPrompt && !additionalContext)}
              className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Enhancing...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Enhance Prompt
                  <span className="ml-1.5 text-[10px] opacity-80 bg-white/20 px-1.5 py-0.5 rounded">{creditCost} CR</span>
                </>
              )}
            </Button>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* Result */}
          {enhancedPrompt && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Enhanced Prompt</label>
              <Textarea
                rows={4}
                value={enhancedPrompt}
                onChange={(e) => setEnhancedPrompt(e.target.value)}
                className="text-xs resize-none"
              />
              <div className="flex gap-2 mt-3">
                <Button
                  onClick={handleAccept}
                  className="flex-1 bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
                >
                  Use This Prompt
                </Button>
                <Button
                  variant="outline"
                  onClick={handleEnhance}
                  disabled={loading}
                  className="flex-shrink-0"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      Retry
                      <span className="ml-1.5 text-[10px] opacity-60">{creditCost} CR</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
