"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

interface PromptInjectionPreviewProps {
  /** The hint text(s) that will be injected. Empty string = nothing to preview. */
  readonly hints: ReadonlyArray<string> | string
  readonly className?: string
}

/**
 * Read-only preview block showing the prompt-hint text(s) a parameter node
 * will contribute to a downstream consumer's prompt. Multiple hints render
 * as a comma-joined list in monospace; empty hints render as "(nothing
 * selected)" italic muted text. A copy button copies the joined text to
 * the clipboard.
 */
export function PromptInjectionPreview({ hints, className }: PromptInjectionPreviewProps) {
  const list = typeof hints === "string" ? (hints ? [hints] : []) : hints.filter(Boolean)
  const joined = list.join(", ")
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!joined) return
    void navigator.clipboard.writeText(joined).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          Will inject into prompt
        </p>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!joined}
          aria-label="Copy injected prompt"
          title={joined ? "Copy to clipboard" : "Nothing to copy"}
          className={cn(
            "flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 transition-colors",
            joined
              ? "text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-[#2D2D2D] cursor-pointer"
              : "text-muted-foreground/40 cursor-not-allowed",
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className="rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] p-2">
        {list.length > 0 ? (
          <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
            {joined}
          </p>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">
            (nothing selected — no hint will be injected)
          </p>
        )}
      </div>
    </div>
  )
}
