"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { hasCredits } from "@/lib/edition"
import { PromptHelperDialog } from "./prompt-helper-dialog"

interface PromptHelperButtonProps {
  readonly nodeType: string
  readonly currentPrompt: string
  readonly provider?: string
  readonly aspectRatio?: string
  readonly duration?: number
  readonly onAccept: (enhancedPrompt: string) => void
}

export function PromptHelperButton({
  nodeType,
  currentPrompt,
  provider,
  aspectRatio,
  duration,
  onAccept,
}: PromptHelperButtonProps) {
  const [open, setOpen] = useState(false)

  if (!hasCredits()) return null

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 min-h-[32px] min-w-[32px] sm:min-h-0 sm:min-w-0 justify-center rounded-md border border-[#ff0073]/30 bg-[#ff0073]/5 text-[#ff0073] hover:bg-[#ff0073]/15 hover:border-[#ff0073]/50 transition-colors text-[10px] font-medium"
          >
            <Sparkles className="w-3 h-3" />
            AI
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">AI Prompt Helper</TooltipContent>
      </Tooltip>
      {open && (
        <PromptHelperDialog
          open={open}
          onClose={() => setOpen(false)}
          nodeType={nodeType}
          currentPrompt={currentPrompt}
          provider={provider}
          aspectRatio={aspectRatio}
          duration={duration}
          onAccept={onAccept}
        />
      )}
    </>
  )
}
