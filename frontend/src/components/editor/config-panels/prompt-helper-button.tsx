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
            className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-[#ff0073]"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">AI Prompt Helper (1 CR)</TooltipContent>
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
